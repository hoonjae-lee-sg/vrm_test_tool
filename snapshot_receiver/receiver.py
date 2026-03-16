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
        1회 동기화 멀티스냅샷 캡처 수행 (All-or-Nothing)

        1. 마스터 채널에서 기준 타임스탬프 획득 (재시도 포함)
        2. 나머지 채널에서 strategy=PRECISE(4)로 동기화 캡처 (재시도 포함)
        3. 하나라도 실패하면 그룹 전체 폐기 — 큐에 적재하지 않음

        Args:
            recording_ids: 캡처 대상 녹화 ID 목록

        Returns:
            CaptureGroup (캡처 결과 메타데이터) 또는 None
        """
        if not recording_ids:
            return None

        group = CaptureGroup(channel_count=len(recording_ids))

        # ── 1단계: 마스터 채널 스냅샷 → 기준 타임스탬프 획득 (재시도) ──
        master_id = recording_ids[0]
        master_result = await self._take_with_retry(master_id)

        if master_result is None:
            logger.warning(
                f"마스터 채널 {master_id} 캡처 실패 "
                f"({config.capture_max_retries}회 재시도 소진)"
            )
            group.failed_channels.append(master_id)
            if self._session:
                self._session.total_failed += 1
            return group

        _, master_image, ref_sec, ref_nano = master_result
        group.master_timestamp_sec = ref_sec
        group.master_timestamp_nano = ref_nano
        ref_ms = ref_sec * 1000 + ref_nano // 1_000_000

        # ── 2단계: 나머지 채널 동기화 캡처 (병렬, 재시도 포함) ──
        # 결과를 임시 버퍼에 모은 후, 전부 성공해야 큐에 적재
        captured_items: list[SnapshotItem] = []

        # 마스터 이미지 먼저 추가
        captured_items.append(SnapshotItem(
            recording_id=master_id,
            timestamp_sec=ref_sec,
            timestamp_nano=ref_nano,
            image_data=master_image,
            capture_group_id=group.group_id,
            diff_ms=0,
        ))

        if len(recording_ids) > 1:
            remaining_ids = recording_ids[1:]

            # asyncio.gather로 전 채널 동시 호출 — 순차 await 시 마스터 TS가 stale 됨
            gather_results = await asyncio.gather(
                *(self._take_with_retry(rid, ref_sec, ref_nano, 4)
                  for rid in remaining_ids),
                return_exceptions=True,
            )

            all_success = True
            for rid, result in zip(remaining_ids, gather_results):
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

        # ── 3단계: 전 채널 성공 → 큐에 일괄 적재 ──
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
        """
        interval_sec = 1.0 / fps
        logger.info(
            f"캡처 루프 시작: {len(recording_ids)}채널 × {fps}fps "
            f"(인터벌: {interval_sec*1000:.1f}ms)"
        )

        next_capture_time = time.monotonic()

        while self._session and self._session.state == CaptureState.RUNNING:
            cycle_start = time.monotonic()

            # 동기화 캡처 1회 수행
            group = await self.capture_once(recording_ids)

            if group:
                self._session.total_groups += 1
                self._session.total_captured += group.success_count
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
