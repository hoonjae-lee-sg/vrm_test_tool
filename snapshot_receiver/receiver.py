"""
스냅샷 수신 모듈 — gRPC를 통해 VRM 서버에서 스냅샷 바이너리를 가져오는 역할
11채널 동기화 캡처 로직 + 캡처 루프 구현
"""
import asyncio
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import grpc
from google.protobuf import timestamp_pb2

# protobuf 생성 코드 경로 추가
_VRM_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, _VRM_ROOT)

from video_recorder.recorder import snapshot_pb2, snapshot_pb2_grpc

from .config import config
from .models import CaptureGroup, CaptureSession, CaptureState, SnapshotItem

logger = logging.getLogger("snapshot_receiver.receiver")


class SnapshotReceiver:
    """
    gRPC 기반 스냅샷 수신기
    - 싱글톤 gRPC 채널로 VRM 서버와 통신
    - ThreadPoolExecutor로 11채널 병렬 gRPC 호출
    - 캡처 루프: FPS 기반 인터벌로 반복 동기화 캡처
    """

    def __init__(self, queue: asyncio.Queue):
        """
        Args:
            queue: 수신된 SnapshotItem을 적재할 asyncio.Queue
        """
        self._queue = queue
        self._channel: Optional[grpc.Channel] = None
        self._stub: Optional[snapshot_pb2_grpc.SnapshotStub] = None
        self._executor = ThreadPoolExecutor(
            max_workers=config.grpc_pool_size,
            thread_name_prefix="grpc-snapshot",
        )
        self._session: Optional[CaptureSession] = None
        self._capture_task: Optional[asyncio.Task] = None

    def _ensure_channel(self):
        """gRPC 채널이 없으면 생성 (lazy init)"""
        if self._channel is None:
            # 대용량 메시지 수신을 위해 max_receive_message_length 설정
            options = [
                ("grpc.max_receive_message_length", 10 * 1024 * 1024),  # 10MB
                ("grpc.keepalive_time_ms", 10000),
                ("grpc.keepalive_timeout_ms", 5000),
            ]
            self._channel = grpc.insecure_channel(config.grpc_address, options=options)
            self._stub = snapshot_pb2_grpc.SnapshotStub(self._channel)
            logger.info(f"gRPC 채널 연결: {config.grpc_address}")

    def _take_snapshot_sync(
        self,
        recording_id: str,
        seconds: int = None,
        nanos: int = None,
        strategy: int = None,
    ) -> Optional[tuple]:
        """
        동기 gRPC 스냅샷 호출 (ThreadPoolExecutor에서 실행)

        Returns:
            (recording_id, image_data, actual_seconds, actual_nanos) 또는 None (실패 시)
        """
        self._ensure_channel()
        try:
            args = {"recording_id": recording_id}
            if seconds is not None:
                args["ts"] = timestamp_pb2.Timestamp(seconds=seconds, nanos=nanos or 0)
            if strategy is not None:
                args["strategy"] = strategy

            request = snapshot_pb2.SnapshotReq(**args)
            resp = self._stub.Take(request, timeout=config.grpc_timeout_sec)

            # 응답에서 이미지 바이너리 추출
            if resp.WhichOneof("result") == "file" and resp.file.image_data:
                f = resp.file
                return (
                    recording_id,
                    f.image_data,
                    f.actual_timestamp.seconds,
                    f.actual_timestamp.nanos,
                )
            else:
                logger.warning(f"채널 {recording_id}: 이미지 데이터 없음")
                return None

        except grpc.RpcError as e:
            logger.warning(f"채널 {recording_id} gRPC 에러: {e.code()} - {e.details()}")
            return None
        except Exception as e:
            logger.error(f"채널 {recording_id} 예외: {e}")
            return None

    async def _take_with_retry(
        self,
        recording_id: str,
        seconds: int = None,
        nanos: int = None,
        strategy: int = None,
    ) -> Optional[tuple]:
        """
        재시도 포함 스냅샷 호출

        config.capture_max_retries 횟수만큼 재시도,
        재시도 사이에 capture_retry_delay_sec 대기
        """
        loop = asyncio.get_event_loop()
        for attempt in range(config.capture_max_retries):
            result = await loop.run_in_executor(
                self._executor,
                self._take_snapshot_sync,
                recording_id,
                seconds,
                nanos,
                strategy,
            )
            if result is not None:
                return result
            if attempt < config.capture_max_retries - 1:
                await asyncio.sleep(config.capture_retry_delay_sec)
        return None

    async def capture_once(self, recording_ids: list[str]) -> Optional[CaptureGroup]:
        """
        1회 동기화 멀티스냅샷 캡처 수행 (All-or-Nothing, 2-Phase 동시 캡처)

        Phase 1: 전 채널에 동시 gRPC 호출 (target_ts 없음)
          → 각 서버가 자체 EMA 지연으로 최적 프레임 선택 → 기준 타임스탬프 확보
        Phase 2: 기준 타임스탬프로 전 채널 동시 PRECISE(4) 재요청
          → 동일 시점의 프레임을 반환하여 정밀 동기화 달성

        핵심 설계:
        - 클라이언트 측 하드코딩 지연(250ms)을 사용하지 않음
        - 서버 측 카메라별 EMA 지연이 자동으로 최적 프레임을 선택
        - Phase 2에서 통일된 타겟으로 모든 채널을 정렬

        Args:
            recording_ids: 캡처 대상 녹화 ID 목록

        Returns:
            CaptureGroup (캡처 결과 메타데이터 + 진단 필드) 또는 None
        """
        if not recording_ids:
            return None

        group = CaptureGroup(channel_count=len(recording_ids))

        # ── Phase 1: 전 채널 동시 호출 (target_ts 없음) ──
        # 각 서버 측 Recorder가 자체 EMA 추정 RTSP 지연으로 최적 프레임 선택
        # 클라이언트가 지연을 추정하지 않으므로 "Frame not found" 오류 방지
        phase1_results = await asyncio.gather(
            *(self._take_with_retry(rid)
              for rid in recording_ids),
            return_exceptions=True,
        )

        # Phase 1 전 채널의 actual_timestamp 수집 후 최솟값을 기준 타임스탬프로 선택
        # 최솟값 = 가장 느린 카메라(RTSP 지연 최대)의 프레임 시점
        # → 모든 카메라 버퍼에 이 시점이 반드시 포함됨 (느린 카메라의 최신 = 다른 카메라의 과거)
        # → Phase 2에서 NOT_FOUND 방지
        all_timestamps = []
        for rid, result in zip(recording_ids, phase1_results):
            if isinstance(result, Exception) or result is None:
                continue
            _, _, actual_sec, actual_nano = result
            actual_ms = actual_sec * 1000 + actual_nano // 1_000_000
            all_timestamps.append((actual_sec, actual_nano, actual_ms))

        if all_timestamps:
            # 최솟값 선택: 가장 느린 카메라 기준으로 모든 채널 버퍼 범위 내 보장
            ref_sec, ref_nano, ref_ms = min(all_timestamps, key=lambda x: x[2])
        else:
            ref_sec = None
            ref_nano = None
            ref_ms = None

        if ref_sec is None:
            # 전 채널 Phase 1 실패 → 그룹 폐기
            logger.warning("Phase 1: 전 채널 스냅샷 획득 실패")
            for rid in recording_ids:
                group.failed_channels.append(rid)
            if self._session:
                self._session.total_failed += len(recording_ids)
            return group

        group.master_timestamp_sec = ref_sec
        group.master_timestamp_nano = ref_nano
        group.target_timestamp_ms = ref_ms

        # ── Phase 2: 기준 타임스탬프로 전 채널 동시 PRECISE 요청 ──
        # Phase 1에서 확보한 실제 프레임 타임스탬프를 모든 채널에 전달
        # → 동일 시점의 프레임을 반환하여 카메라 간 동기화
        phase2_results = await asyncio.gather(
            *(self._take_with_retry(rid, ref_sec, ref_nano, 4)
              for rid in recording_ids),
            return_exceptions=True,
        )

        # ── 결과 수집 + 진단 데이터 생성 ──
        captured_items: list[SnapshotItem] = []
        all_success = True

        for rid, result in zip(recording_ids, phase2_results):
            if isinstance(result, Exception):
                logger.warning(f"채널 {rid} 예외: {result} — 그룹 폐기")
                group.failed_channels.append(rid)
                if self._session:
                    self._session.total_failed += 1
                all_success = False
                continue

            if result is None:
                logger.warning(
                    f"채널 {rid} 캡처 실패 "
                    f"({config.capture_max_retries}회 재시도 소진) — 그룹 폐기"
                )
                group.failed_channels.append(rid)
                if self._session:
                    self._session.total_failed += 1
                all_success = False
                continue

            _, image_data, actual_sec, actual_nano = result
            actual_ms = actual_sec * 1000 + actual_nano // 1_000_000
            diff_ms = actual_ms - ref_ms

            # 진단 데이터: 채널별 diff_ms 기록
            group.per_channel_diff[rid] = diff_ms

            captured_items.append(SnapshotItem(
                recording_id=rid,
                timestamp_sec=ref_sec,
                timestamp_nano=ref_nano,
                image_data=image_data,
                capture_group_id=group.group_id,
                diff_ms=diff_ms,
            ))

        if not all_success:
            return group

        # 진단: 그룹 내 최대 동기화 오차 계산
        if group.per_channel_diff:
            group.max_diff_ms = max(abs(d) for d in group.per_channel_diff.values())

        # BAD 그룹(max_diff > 100ms) 저장 스킵: 네트워크 지연 스파이크 구간 제외
        # 타임스탬프 신뢰도가 낮은 프레임이 포함된 그룹은 저장하지 않음
        BAD_THRESHOLD_MS = 100
        if group.max_diff_ms > BAD_THRESHOLD_MS:
            logger.info(
                f"그룹 {group.group_id} BAD 판정 "
                f"(max_diff={group.max_diff_ms}ms) — 저장 스킵"
            )
            if self._session:
                self._session.total_skipped_bad += 1
            return group

        # ── 전 채널 성공 → 큐에 일괄 적재 ──
        for item in captured_items:
            try:
                self._queue.put_nowait(item)
                group.success_count += 1
            except asyncio.QueueFull:
                logger.warning(f"큐 가득 참 — 채널 {item.recording_id} 이미지 드롭")
                if self._session:
                    self._session.total_dropped += 1

        return group

    async def _capture_loop(self, recording_ids: list[str], fps: int):
        """
        반복 캡처 루프 — FPS 기반 정밀 인터벌로 capture_once를 반복 호출

        monotonic clock 기반 드리프트 보정으로 정확한 인터벌 유지
        진단 계측: diff_ms 시계열 로그 수집 + 통계 요약 출력
        """
        interval_sec = 1.0 / fps
        logger.info(
            f"캡처 루프 시작: {len(recording_ids)}채널 × {fps}fps "
            f"(인터벌: {interval_sec*1000:.1f}ms)"
        )

        next_capture_time = time.monotonic()

        # ── 진단 계측: diff_ms CSV 로그 초기화 ──
        diag_csv_writer = None
        diag_csv_file = None
        if config.diag_sync_log_enabled:
            diag_csv_writer, diag_csv_file = self._init_diag_csv(recording_ids)

        # 진단 통계 수집용 변수 (일정 간격으로 요약 출력)
        diag_diff_samples: list[int] = []  # max_diff_ms 수집 (통계용)

        while self._session and self._session.state == CaptureState.RUNNING:
            cycle_start = time.monotonic()

            # 동기화 캡처 1회 수행
            group = await self.capture_once(recording_ids)

            if group:
                self._session.total_groups += 1
                self._session.total_captured += group.success_count

                # ── 진단 계측: diff_ms 시계열 로그 기록 ──
                if config.diag_sync_log_enabled and diag_csv_writer and group.success_count > 0:
                    self._write_diag_csv_row(diag_csv_writer, group, recording_ids)
                    diag_diff_samples.append(group.max_diff_ms)

                # 진단 통계 요약 출력 (diag_stats_interval 주기마다)
                if self._session.total_groups % config.diag_stats_interval == 0:
                    self._log_diag_stats(diag_diff_samples)
                    diag_diff_samples.clear()

                if self._session.total_groups % 100 == 0:
                    logger.info(
                        f"캡처 통계: 그룹={self._session.total_groups}, "
                        f"캡처={self._session.total_captured}, "
                        f"드롭={self._session.total_dropped}, "
                        f"실패={self._session.total_failed}, "
                        f"큐={self._queue.qsize()}/{self._queue.maxsize}"
                    )

            # 큐 백프레셔 경고
            queue_usage = self._queue.qsize() / self._queue.maxsize if self._queue.maxsize > 0 else 0
            if queue_usage >= config.queue_warn_threshold:
                logger.warning(
                    f"큐 사용률 {queue_usage*100:.0f}% — 저장 워커가 느릴 수 있음"
                )

            # ── 정밀 인터벌 대기 (드리프트 보정) ──
            next_capture_time += interval_sec
            sleep_time = next_capture_time - time.monotonic()
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)
            else:
                # 캡처가 인터벌보다 오래 걸림 → 스킵하고 다음 슬롯으로
                missed = int(-sleep_time / interval_sec)
                if missed > 0:
                    next_capture_time += missed * interval_sec
                    logger.warning(f"캡처 지연 — {missed}프레임 스킵")

        # ── 진단 CSV 파일 정리 ──
        if diag_csv_file:
            diag_csv_file.close()
            logger.info("진단 CSV 로그 파일 저장 완료")

        # 남은 진단 통계 출력
        if diag_diff_samples:
            self._log_diag_stats(diag_diff_samples)

        logger.info("캡처 루프 종료")

    async def start_capture(self, recording_ids: list[str], fps: int = None):
        """
        캡처 세션 시작

        Args:
            recording_ids: 캡처 대상 녹화 ID 목록
            fps: 목표 FPS (None이면 config.default_fps 사용)
        """
        if self._session and self._session.state == CaptureState.RUNNING:
            raise RuntimeError("이미 캡처가 진행 중입니다")

        target_fps = fps or config.default_fps
        self._session = CaptureSession(
            recording_ids=recording_ids,
            target_fps=target_fps,
            state=CaptureState.RUNNING,
            started_at=time.time(),
        )

        logger.info(
            f"캡처 세션 시작: session={self._session.session_id}, "
            f"채널={len(recording_ids)}, fps={target_fps}"
        )

        # 비동기 캡처 루프 태스크 생성
        self._capture_task = asyncio.create_task(
            self._capture_loop(recording_ids, target_fps)
        )

    async def stop_capture(self) -> Optional[CaptureSession]:
        """
        캡처 세션 중지

        Returns:
            종료된 CaptureSession (통계 포함) 또는 None
        """
        if not self._session or self._session.state != CaptureState.RUNNING:
            return None

        self._session.state = CaptureState.STOPPING
        logger.info(f"캡처 세션 중지 요청: session={self._session.session_id}")

        # 캡처 루프 태스크 완료 대기
        if self._capture_task:
            try:
                await asyncio.wait_for(self._capture_task, timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning("캡처 루프 종료 타임아웃 — 강제 취소")
                self._capture_task.cancel()

        self._session.state = CaptureState.STOPPED
        self._session.stopped_at = time.time()

        result = self._session
        logger.info(
            f"캡처 세션 완료: 총 {result.total_captured}장 캡처, "
            f"{result.total_dropped}장 드롭, {result.total_failed}건 실패"
        )
        return result

    # ── 진단 계측 헬퍼 메서드 ──

    def _init_diag_csv(self, recording_ids: list[str]):
        """
        진단용 CSV 로그 파일 초기화
        컬럼: timestamp, group_id, target_ts, max_diff_ms, {channel_id}_diff_ms ...

        Returns:
            (csv.writer, file_handle) 또는 (None, None) 실패 시
        """
        import csv
        from datetime import datetime

        try:
            diag_dir = config.diag_sync_log_dir
            os.makedirs(diag_dir, exist_ok=True)

            timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            csv_path = os.path.join(diag_dir, f"sync_diag_{timestamp_str}.csv")

            f = open(csv_path, "w", newline="")
            writer = csv.writer(f)

            # 헤더: 고정 컬럼 + 채널별 diff 컬럼
            header = ["timestamp", "group_id", "target_ts_ms", "max_diff_ms"]
            for rid in recording_ids:
                # recording_id에서 마지막 부분만 사용 (가독성)
                short_id = rid.split("/")[-1] if "/" in rid else rid[-8:]
                header.append(f"{short_id}_diff_ms")
            writer.writerow(header)

            logger.info(f"진단 CSV 로그 시작: {csv_path}")
            return writer, f
        except Exception as e:
            logger.error(f"진단 CSV 초기화 실패: {e}")
            return None, None

    def _write_diag_csv_row(self, writer, group: CaptureGroup, recording_ids: list[str]):
        """진단 CSV에 1행 기록 — 캡처 그룹 1개의 동기화 오차 데이터"""
        import csv
        from datetime import datetime

        try:
            row = [
                datetime.now().strftime("%H:%M:%S.%f")[:-3],  # 밀리초까지
                group.group_id,
                group.target_timestamp_ms,
                group.max_diff_ms,
            ]
            # 채널 순서대로 diff_ms 추가 (없으면 "N/A")
            for rid in recording_ids:
                diff = group.per_channel_diff.get(rid, None)
                row.append(diff if diff is not None else "N/A")
            writer.writerow(row)
        except Exception:
            pass  # 진단 로그 실패가 캡처에 영향을 주면 안 됨

    def _log_diag_stats(self, diff_samples: list[int]):
        """
        진단 통계 요약 로그 출력 — diff_ms 분포 분석

        분석 항목:
        - 평균/중앙값/최대값 → 전체적 동기화 수준 파악
        - 표준편차 → 랜덤 지터 vs 고정 오프셋 판별
        - 10ms/30ms/50ms 이내 비율 → 목표 달성도 확인
        """
        if not diff_samples:
            return

        sorted_samples = sorted(diff_samples)
        n = len(sorted_samples)
        avg = sum(sorted_samples) / n
        median = sorted_samples[n // 2]
        max_val = sorted_samples[-1]
        min_val = sorted_samples[0]

        # 표준편차 계산
        variance = sum((x - avg) ** 2 for x in sorted_samples) / n
        stddev = variance ** 0.5

        # 목표 달성률 (절대값 기준)
        within_10ms = sum(1 for x in sorted_samples if x <= 10) / n * 100
        within_30ms = sum(1 for x in sorted_samples if x <= 30) / n * 100
        within_50ms = sum(1 for x in sorted_samples if x <= 50) / n * 100

        logger.info(
            f"[동기화 진단] n={n} | "
            f"avg={avg:.1f}ms median={median}ms max={max_val}ms min={min_val}ms | "
            f"stddev={stddev:.1f}ms | "
            f"≤10ms:{within_10ms:.0f}% ≤30ms:{within_30ms:.0f}% ≤50ms:{within_50ms:.0f}%"
        )

        # 패턴 분류 힌트
        if stddev < 5 and avg > 30:
            logger.info("[동기화 진단] 패턴: 고정 오프셋 (stddev 낮음, avg 높음) → Step 3 캘리브레이션 권장")
        elif stddev > 20:
            logger.info("[동기화 진단] 패턴: 랜덤 지터 (stddev 높음) → Step 2 RTCP sync 효과 확인 필요")
        elif max_val > 100 and within_30ms > 80:
            logger.info("[동기화 진단] 패턴: 간헐적 스파이크 → GC/스케줄링 지연 의심")

    @property
    def session(self) -> Optional[CaptureSession]:
        """현재 캡처 세션"""
        return self._session

    async def close(self):
        """리소스 정리 — gRPC 채널 및 스레드풀 종료"""
        if self._session and self._session.state == CaptureState.RUNNING:
            await self.stop_capture()
        if self._channel:
            self._channel.close()
            self._channel = None
            self._stub = None
        self._executor.shutdown(wait=False)
        logger.info("SnapshotReceiver 리소스 정리 완료")
