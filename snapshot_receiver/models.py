"""
Snapshot Receiver 데이터 모델 정의
큐에 적재되는 스냅샷 아이템 및 캡처 그룹 관리
"""
from dataclasses import dataclass, field
from enum import Enum
import time
import uuid


class CaptureState(str, Enum):
    """캡처 세션 상태"""
    IDLE = "idle"           # 대기 중
    RUNNING = "running"     # 캡처 진행 중
    STOPPING = "stopping"   # 중지 요청됨
    STOPPED = "stopped"     # 정상 중지


@dataclass
class SnapshotItem:
    """
    큐에 적재되는 개별 스냅샷 이미지
    gRPC 응답에서 추출한 JPEG 바이너리와 메타데이터
    """
    recording_id: str           # VRM 녹화 ID
    timestamp_sec: int          # 마스터 기준 타임스탬프 (seconds, 파일명용)
    timestamp_nano: int         # 마스터 기준 타임스탬프 (nanos, 파일명용)
    image_data: bytes           # JPEG 바이너리 데이터 (base64 변환 없이 원본)
    capture_group_id: str       # 소속 캡처 그룹 ID (동기화 단위)
    diff_ms: int = 0            # 마스터 대비 실제 프레임 타임스탬프 차이 (ms)
    received_at: float = field(default_factory=time.monotonic)  # 수신 시각 (모노토닉)

    @property
    def timestamp_ms(self) -> int:
        """밀리초 단위 타임스탬프 (파일명용)"""
        return self.timestamp_sec * 1000 + self.timestamp_nano // 1_000_000

    @property
    def image_size_kb(self) -> float:
        """이미지 크기 (KB)"""
        return len(self.image_data) / 1024.0


@dataclass
class CaptureGroup:
    """
    동기화 캡처 그룹 — 한 번의 멀티스냅샷 요청 단위
    마스터 타임스탬프 기준으로 11채널이 동기화된 프레임 묶음
    """
    group_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    master_timestamp_sec: int = 0       # 마스터 카메라 기준 타임스탬프
    master_timestamp_nano: int = 0
    channel_count: int = 0              # 이 그룹에 포함된 채널 수
    success_count: int = 0              # 성공적으로 수신된 채널 수
    failed_channels: list = field(default_factory=list)  # 실패한 채널 ID 목록
    created_at: float = field(default_factory=time.time)

    # ── 진단 계측 필드 ──
    max_diff_ms: int = 0                # 그룹 내 최대 동기화 오차 (절대값, ms)
    per_channel_diff: dict = field(default_factory=dict)  # {recording_id: diff_ms} 채널별 오차
    target_timestamp_ms: int = 0        # 동시 캡처 타겟 타임스탬프 (ms)


@dataclass
class CaptureSession:
    """
    캡처 세션 — start ~ stop 사이의 전체 캡처 작업 단위
    여러 CaptureGroup을 포함
    """
    session_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    state: CaptureState = CaptureState.IDLE
    recording_ids: list = field(default_factory=list)    # 대상 녹화 채널 목록
    target_fps: int = 24
    started_at: float = 0.0
    stopped_at: float = 0.0

    # ── 실시간 통계 ──
    total_captured: int = 0         # 총 캡처된 이미지 수
    total_saved: int = 0            # 총 저장 완료된 이미지 수
    total_dropped: int = 0          # 드롭된 이미지 수
    total_failed: int = 0           # gRPC 호출 실패 수
    total_groups: int = 0           # 총 캡처 그룹 수
    total_skipped_bad: int = 0      # BAD 판정(>100ms diff)으로 저장 스킵된 그룹 수
    total_skipped_stale: int = 0    # STALE 판정(동일 프레임 반복)으로 저장 스킵된 그룹 수

    @property
    def capture_rate(self) -> float:
        """현재 캡처율 (images/sec)"""
        elapsed = time.time() - self.started_at if self.started_at > 0 else 0
        if elapsed <= 0:
            return 0.0
        return self.total_captured / elapsed

    @property
    def save_rate(self) -> float:
        """현재 저장율 (images/sec)"""
        elapsed = time.time() - self.started_at if self.started_at > 0 else 0
        if elapsed <= 0:
            return 0.0
        return self.total_saved / elapsed

    @property
    def drop_rate_pct(self) -> float:
        """드롭률 (%)"""
        total = self.total_captured + self.total_dropped
        if total <= 0:
            return 0.0
        return (self.total_dropped / total) * 100.0
