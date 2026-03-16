"""
Snapshot Receiver 서버 설정 모듈
환경 변수 또는 기본값으로 설정을 관리
"""
import os
from dataclasses import dataclass, field


@dataclass
class Config:
    """서버 전체 설정"""

    # ── gRPC 서버 연결 ──
    grpc_address: str = os.environ.get("GRPC_ADDRESS", "localhost:50000")

    # ── 큐 설정 ──
    queue_max_size: int = int(os.environ.get("QUEUE_MAX_SIZE", "1000"))
    # 백프레셔 경고 임계치 (큐 사용률 %)
    queue_warn_threshold: float = 0.8

    # ── 저장 경로 (VRM 루트의 data/ 디렉토리 기준) ──
    storage_path: str = os.path.abspath(os.environ.get(
        "SNAPSHOT_STORAGE_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data"),
    ))

    # ── 캡처 설정 ──
    default_fps: int = int(os.environ.get("DEFAULT_FPS", "24"))
    max_channels: int = int(os.environ.get("MAX_CHANNELS", "20"))

    # ── 워커 설정 ──
    writer_workers: int = int(os.environ.get("WRITER_WORKERS", "4"))
    # 배치 쓰기: 한번에 모아서 flush할 이미지 수
    writer_batch_size: int = int(os.environ.get("WRITER_BATCH_SIZE", "10"))

    # ── gRPC 호출 설정 ──
    grpc_timeout_sec: float = float(os.environ.get("GRPC_TIMEOUT_SEC", "3.0"))
    # gRPC 동시 호출용 스레드풀 크기
    grpc_pool_size: int = int(os.environ.get("GRPC_POOL_SIZE", "24"))
    # 채널별 스냅샷 실패 시 재시도 횟수
    capture_max_retries: int = int(os.environ.get("CAPTURE_MAX_RETRIES", "3"))
    # 재시도 간 대기 시간 (초)
    capture_retry_delay_sec: float = float(os.environ.get("CAPTURE_RETRY_DELAY_SEC", "0.3"))

    # ── 제어 API 서버 ──
    api_host: str = os.environ.get("API_HOST", "0.0.0.0")
    api_port: int = int(os.environ.get("API_PORT", "8200"))

    # ── 디스크 용량 안전 마진 (GB) ──
    disk_min_free_gb: float = float(os.environ.get("DISK_MIN_FREE_GB", "5.0"))

    @property
    def capture_interval_ms(self) -> float:
        """FPS 기반 캡처 인터벌 (밀리초)"""
        return 1000.0 / self.default_fps


# 전역 싱글톤 설정 인스턴스
config = Config()
