"""
큐 관리 모듈 — asyncio.Queue 기반 메모리 큐 + 모니터링
수신된 스냅샷 바이너리를 저장 워커에게 전달하는 중간 버퍼 역할
"""
import asyncio
import logging
import time
from dataclasses import dataclass, field

from .config import config
from .models import SnapshotItem

logger = logging.getLogger("snapshot_receiver.queue")


@dataclass
class QueueStats:
    """큐 상태 통계"""
    current_size: int = 0           # 현재 큐에 대기 중인 아이템 수
    max_size: int = 0               # 큐 최대 용량
    total_enqueued: int = 0         # 총 적재된 아이템 수
    total_dequeued: int = 0         # 총 꺼낸 아이템 수
    total_dropped: int = 0          # 큐 가득 참으로 드롭된 수
    estimated_memory_mb: float = 0  # 추정 메모리 사용량 (MB)


class QueueManager:
    """
    asyncio.Queue 래퍼 — 백프레셔 + 모니터링 기능 포함

    큐가 가득 찰 경우:
    - queue_warn_threshold(80%) 도달 시 경고 로그
    - 100% 도달 시 신규 아이템 드롭 (non-blocking put)
    """

    def __init__(self, max_size: int = None):
        """
        Args:
            max_size: 큐 최대 크기 (None이면 config.queue_max_size 사용)
        """
        self._max_size = max_size or config.queue_max_size
        self._queue: asyncio.Queue[SnapshotItem] = asyncio.Queue(maxsize=self._max_size)

        # 통계 카운터
        self._total_enqueued = 0
        self._total_dequeued = 0
        self._total_dropped = 0
        self._total_bytes_enqueued = 0

    @property
    def queue(self) -> asyncio.Queue:
        """내부 asyncio.Queue 인스턴스 (receiver/writer가 직접 접근용)"""
        return self._queue

    def try_put(self, item: SnapshotItem) -> bool:
        """
        큐에 아이템 적재 시도 (non-blocking)

        Returns:
            True: 적재 성공
            False: 큐 가득 참으로 드롭
        """
        try:
            self._queue.put_nowait(item)
            self._total_enqueued += 1
            self._total_bytes_enqueued += len(item.image_data)
            return True
        except asyncio.QueueFull:
            self._total_dropped += 1
            logger.warning(
                f"큐 가득 참 ({self._queue.qsize()}/{self._max_size}) "
                f"— 이미지 드롭: {item.recording_id}"
            )
            return False

    async def get(self) -> SnapshotItem:
        """큐에서 아이템 꺼내기 (blocking)"""
        item = await self._queue.get()
        self._total_dequeued += 1
        return item

    def task_done(self):
        """큐 태스크 완료 알림"""
        self._queue.task_done()

    def get_stats(self) -> QueueStats:
        """현재 큐 상태 통계 반환"""
        current_size = self._queue.qsize()
        # 추정 메모리: 평균 이미지 크기 × 현재 큐 크기
        avg_size = (
            self._total_bytes_enqueued / self._total_enqueued
            if self._total_enqueued > 0
            else 100 * 1024  # 기본 100KB 추정
        )
        estimated_mb = (current_size * avg_size) / (1024 * 1024)

        return QueueStats(
            current_size=current_size,
            max_size=self._max_size,
            total_enqueued=self._total_enqueued,
            total_dequeued=self._total_dequeued,
            total_dropped=self._total_dropped,
            estimated_memory_mb=round(estimated_mb, 1),
        )

    @property
    def usage_ratio(self) -> float:
        """큐 사용률 (0.0 ~ 1.0)"""
        if self._max_size <= 0:
            return 0.0
        return self._queue.qsize() / self._max_size

    @property
    def is_warning(self) -> bool:
        """백프레셔 경고 상태 여부"""
        return self.usage_ratio >= config.queue_warn_threshold

    @property
    def is_full(self) -> bool:
        """큐 가득 참 여부"""
        return self._queue.full()
