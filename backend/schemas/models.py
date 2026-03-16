"""
Pydantic 요청/응답 모델 정의
FastAPI의 자동 Swagger 문서 생성을 위한 스키마
"""
from pydantic import BaseModel
from typing import Optional


class RecordStartRequest(BaseModel):
    """녹화 시작 요청"""
    serial_number: Optional[str] = None
    hq_url: str
    sq_url: str
    rtsp_hq_username: Optional[str] = None
    rtsp_hq_password: Optional[str] = None
    rtsp_sq_username: Optional[str] = None
    rtsp_sq_password: Optional[str] = None
    hq_storage_limit_mbs: Optional[int] = None
    sq_storage_limit_mbs: Optional[int] = None
    retention_days: Optional[int] = None
    recording_mode: Optional[str] = None
    encoding_codec: Optional[str] = None
    auth_token: Optional[str] = None
    notes: Optional[str] = None


class RecordStopRequest(BaseModel):
    """녹화 중지 요청"""
    recording_id: str
    auth_token: Optional[str] = None


class SnapshotRequest(BaseModel):
    """스냅샷 촬영 요청"""
    recording_id: str
    seconds: Optional[int] = None
    nanos: Optional[int] = None
    strategy: Optional[int] = None
    max_offset_ms: Optional[int] = None


class BulkSnapshotRequest(BaseModel):
    """멀티 동기화 스냅샷 요청"""
    recording_ids: list[str]


class EventClipRequest(BaseModel):
    """이벤트 클립 시작/중지 요청"""
    recording_id: str
    auth_token: Optional[str] = None


class SimpleClipRequest(BaseModel):
    """심플 클립 생성 요청"""
    recording_id: str
    seconds: int
    nanos: int = 0


class HealthCheckRequest(BaseModel):
    """헬스 체크 요청"""
    recording_id: str
    auth_token: Optional[str] = None


class ApiResponse(BaseModel):
    """통일된 API 응답 형식"""
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None
