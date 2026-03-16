"""
디스크 저장 워커 — 큐에서 SnapshotItem을 꺼내 JPEG 파일로 저장
멀티스레드 배치 쓰기로 I/O 처리량 최적화
"""
import asyncio
import logging
import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional

from .config import config
from .models import SnapshotItem

logger = logging.getLogger("snapshot_receiver.writer")


class SnapshotWriter:
    """
    디스크 저장 워커
    - asyncio.Queue에서 SnapshotItem을 비동기로 꺼냄
    - ThreadPoolExecutor로 실제 파일 I/O 수행 (GIL 우회)
    - 배치 쓰기: N장 모아서 한번에 flush

    저장 디렉토리 구조:
        data/{recording_id}/snapshot/{YYYYMMDD}/{HH}/{timestamp_ms}.jpg
        예: data/abc123/snapshot/20260316/14/1710561234567.jpg
    """

    def __init__(self, queue: asyncio.Queue):
        """
        Args:
            queue: SnapshotItem을 꺼낼 asyncio.Queue
        """
        self._queue = queue
        self._executor = ThreadPoolExecutor(
            max_workers=config.writer_workers,
            thread_name_prefix="snapshot-writer",
        )
        self._storage_path = os.path.realpath(config.storage_path)
        self._running = False
        self._draining = False  # True이면 큐를 비우는 중 (새 아이템 없이 남은 것만 처리)
        self._worker_tasks: list[asyncio.Task] = []

        # 통계
        self._total_saved = 0
        self._total_errors = 0
        self._total_bytes_written = 0
        self._start_time = 0.0

        # 디렉토리 캐시 — 이미 생성된 디렉토리를 추적하여 중복 mkdir 방지
        self._dir_cache: set[str] = set()

    def _ensure_dir(self, dir_path: str):
        """디렉토리 생성 — 없으면 전체 경로를 재귀적으로 생성"""
        if dir_path in self._dir_cache:
            return
        os.makedirs(dir_path, exist_ok=True)
        self._dir_cache.add(dir_path)

    def _write_single(self, item: SnapshotItem) -> bool:
        """
        단일 이미지를 디스크에 저장 (동기, ThreadPoolExecutor에서 실행)

        저장 경로: data/{recording_id}/snapshot/{YYYYMMDD}/{HH}/{timestamp_ms}.jpg
        예: data/abc123/snapshot/20260316/14/1710561234567.jpg

        Returns:
            True: 저장 성공
            False: 저장 실패
        """
        try:
            # 타임스탬프에서 날짜/시간 추출
            frame_time = datetime.fromtimestamp(item.timestamp_sec)
            date_str = frame_time.strftime("%Y%m%d")    # 예: 20260316
            hour_str = frame_time.strftime("%H")         # 예: 14 (00~23)

            # 경로: data/{recording_id}/snapshot/{YYYYMMDD}/{HH}/
            hour_dir = os.path.join(
                self._storage_path,
                item.recording_id,
                "snapshot",
                date_str,
                hour_str,
            )
            self._ensure_dir(hour_dir)

            # 파일명: {timestamp_ms}_{diff_ms}ms.jpg (diff로 동기화 오차 즉시 확인 가능)
            filename = f"{item.timestamp_ms}_{item.diff_ms}ms.jpg"
            filepath = os.path.join(hour_dir, filename)

            # 원시 바이너리 직접 쓰기 (최소 오버헤드)
            with open(filepath, "wb") as f:
                f.write(item.image_data)

            return True

        except OSError as e:
            logger.error(f"파일 저장 실패: {e}")
            return False

    def _write_batch(self, items: list[SnapshotItem]) -> int:
        """
        배치 이미지 저장 (동기, ThreadPoolExecutor에서 실행)

        Args:
            items: 저장할 SnapshotItem 리스트

        Returns:
            성공적으로 저장된 이미지 수
        """
        success_count = 0
        for item in items:
            if self._write_single(item):
                success_count += 1
        return success_count

    async def _worker_loop(self, worker_id: int):
        """
        개별 워커 루프 — 큐에서 아이템을 꺼내 배치로 묶어 저장

        배치 크기(config.writer_batch_size)만큼 모으거나,
        50ms 타임아웃 시 현재까지 모인 아이템을 즉시 저장
        """
        batch_size = config.writer_batch_size
        logger.info(f"저장 워커 #{worker_id} 시작 (배치 크기: {batch_size})")

        while self._running or self._draining:
            batch: list[SnapshotItem] = []

            try:
                # 첫 번째 아이템은 blocking 대기
                item = await asyncio.wait_for(self._queue.get(), timeout=1.0)
                batch.append(item)

                # 나머지는 non-blocking으로 배치 크기까지 수집
                while len(batch) < batch_size:
                    try:
                        item = self._queue.get_nowait()
                        batch.append(item)
                    except asyncio.QueueEmpty:
                        break

            except asyncio.TimeoutError:
                # 드레이닝 중이고 큐가 비었으면 → 워커 종료
                if self._draining and self._queue.empty():
                    break
                continue

            if not batch:
                continue

            # ThreadPoolExecutor에서 배치 쓰기 실행
            loop = asyncio.get_event_loop()
            try:
                saved = await loop.run_in_executor(
                    self._executor, self._write_batch, batch
                )
                self._total_saved += saved
                self._total_errors += len(batch) - saved
                self._total_bytes_written += sum(
                    len(item.image_data) for item in batch[:saved]
                )

                # task_done 호출 (큐 join 지원)
                for _ in batch:
                    self._queue.task_done()

            except Exception as e:
                logger.error(f"워커 #{worker_id} 배치 쓰기 예외: {e}")
                self._total_errors += len(batch)
                for _ in batch:
                    self._queue.task_done()

        logger.info(f"저장 워커 #{worker_id} 종료")

    def _check_disk_space(self) -> bool:
        """
        디스크 여유 공간 확인

        Returns:
            True: 충분한 공간 있음
            False: 공간 부족 (config.disk_min_free_gb 미만)
        """
        try:
            stat = shutil.disk_usage(self._storage_path)
            free_gb = stat.free / (1024 ** 3)
            if free_gb < config.disk_min_free_gb:
                logger.error(
                    f"디스크 공간 부족: {free_gb:.1f}GB 남음 "
                    f"(최소 {config.disk_min_free_gb}GB 필요)"
                )
                return False
            return True
        except OSError:
            return True  # 확인 불가 시 계속 진행

    async def start(self):
        """저장 워커들 시작"""
        if self._running:
            return

        # 저장 디렉토리 생성
        os.makedirs(self._storage_path, exist_ok=True)

        # 디스크 공간 사전 확인
        if not self._check_disk_space():
            raise RuntimeError("디스크 공간 부족으로 시작할 수 없습니다")

        self._running = True
        self._start_time = time.time()
        self._worker_tasks = []

        for i in range(config.writer_workers):
            task = asyncio.create_task(self._worker_loop(i))
            self._worker_tasks.append(task)

        logger.info(f"저장 워커 {config.writer_workers}개 시작")

    async def stop(self):
        """저장 워커들 중지 — 큐에 남은 아이템 모두 처리한 뒤 종료"""
        if not self._running:
            return

        remaining = self._queue.qsize()
        logger.info(
            f"저장 워커 중지 요청 — 큐에 남은 {remaining}장 저장 후 종료합니다..."
        )

        # 1) 새 캡처 중지 + 드레이닝 모드 진입 (큐에 남은 것만 처리)
        self._running = False
        self._draining = True

        # 2) 워커가 큐를 완전히 비울 때까지 대기 (최대 60초)
        if self._worker_tasks:
            done, pending = await asyncio.wait(
                self._worker_tasks, timeout=60.0
            )
            for task in pending:
                logger.warning("워커 드레이닝 타임아웃 — 강제 종료")
                task.cancel()

        self._draining = False

        self._executor.shutdown(wait=False)
        logger.info(
            f"저장 워커 종료: 총 {self._total_saved}장 저장, "
            f"{self._total_errors}건 에러, "
            f"{self._total_bytes_written / (1024*1024):.1f}MB 기록"
        )

    def get_stats(self) -> dict:
        """저장 워커 통계 반환"""
        elapsed = time.time() - self._start_time if self._start_time > 0 else 0
        save_rate = self._total_saved / elapsed if elapsed > 0 else 0

        return {
            "total_saved": self._total_saved,
            "total_errors": self._total_errors,
            "total_bytes_written_mb": round(
                self._total_bytes_written / (1024 * 1024), 1
            ),
            "save_rate_per_sec": round(save_rate, 1),
            "elapsed_sec": round(elapsed, 1),
            "disk_ok": self._check_disk_space(),
        }
