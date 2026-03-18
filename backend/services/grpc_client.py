"""
gRPC 클라이언트 서비스
기존 test_runner/grpc_client.py 기반으로 FastAPI 서비스 레이어로 이식
싱글톤 패턴으로 gRPC 채널 재사용
"""
import os
import sys
import grpc
from google.protobuf.json_format import MessageToDict
from google.protobuf import timestamp_pb2

# 기존 protobuf 생성 코드 경로 추가
_VRM_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, _VRM_ROOT)

from video_recorder.recorder import record_pb2, record_pb2_grpc
from video_recorder.recorder import clip_pb2, clip_pb2_grpc
from video_recorder.recorder import snapshot_pb2, snapshot_pb2_grpc
from video_recorder.recorder import encoding_pb2
from video_recorder.health import health_pb2, health_pb2_grpc
from video_recorder.common import types_pb2


def proto_to_dict(message):
    """Protobuf 메시지를 딕셔너리로 변환"""
    if message is None:
        return None
    try:
        return MessageToDict(
            message,
            preserving_proto_field_name=True,
            including_default_value_fields=True,
        )
    except Exception:
        return MessageToDict(message, preserving_proto_field_name=True)


class GRPCClientService:
    """
    gRPC 클라이언트 서비스 (싱글톤)
    VRM 서버와의 gRPC 통신을 담당
    """

    _instance = None

    def __new__(cls, address: str = "localhost:50000"):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._init_channel(address)
        return cls._instance

    def _init_channel(self, address: str):
        """gRPC 채널 및 스텁 초기화"""
        self.address = address
        self.channel = grpc.insecure_channel(address)
        self.record_stub = record_pb2_grpc.RecordStub(self.channel)
        self.clip_stub = clip_pb2_grpc.ClipStub(self.channel)
        self.snapshot_stub = snapshot_pb2_grpc.SnapshotStub(self.channel)
        self.health_stub = health_pb2_grpc.HealthStub(self.channel)
        print(f"[GRPCClientService] Connected to {address}")

    def start_recording(
        self,
        hq_url: str,
        sq_url: str,
        rtsp_hq_username: str = None,
        rtsp_hq_password: str = None,
        rtsp_sq_username: str = None,
        rtsp_sq_password: str = None,
        hq_storage_limit_mbs: int = None,
        sq_storage_limit_mbs: int = None,
        retention_days: int = None,
        recording_mode: str = None,
        auth_token: str = None,
        notes: str = None,
        encoding_codec: str = None,
        serial_number: str = None,
    ):
        """녹화 시작"""
        hq_rtsp = types_pb2.RtspUrl(raw=hq_url)
        if rtsp_hq_username:
            hq_rtsp.username = rtsp_hq_username
        if rtsp_hq_password:
            hq_rtsp.password = rtsp_hq_password

        sq_rtsp = types_pb2.RtspUrl(raw=sq_url)
        if rtsp_sq_username:
            sq_rtsp.username = rtsp_sq_username
        if rtsp_sq_password:
            sq_rtsp.password = rtsp_sq_password

        params = {"rtsp_url_hq": hq_rtsp, "rtsp_url_sq": sq_rtsp}
        if auth_token:
            params["auth_token"] = auth_token
        if notes:
            params["notes"] = notes
        if serial_number:
            params["serial_number"] = serial_number
        if retention_days is not None:
            params["retention_days"] = retention_days
        if hq_storage_limit_mbs is not None:
            params["hq_storage_limit_mbs"] = hq_storage_limit_mbs
        if sq_storage_limit_mbs is not None:
            params["sq_storage_limit_mbs"] = sq_storage_limit_mbs
        if recording_mode is not None:
            params["recording_mode"] = record_pb2.RecordingMode.Value(recording_mode)
        if encoding_codec is not None:
            codec_enum = encoding_pb2.Codec.Value(encoding_codec)
            params["encoding_option"] = encoding_pb2.EncodingOption(encoding_codec=codec_enum)

        request = record_pb2.RecordStartReq(**params)
        response = self.record_stub.Start(request)
        return proto_to_dict(response)

    def restart_recording(self, recording_id: str, auth_token: str = None):
        """녹화 재시작 — STOPPED/ERROR 상태의 녹화를 동일 설정으로 재시작"""
        request = record_pb2.RecordRestartReq(
            recording_id=recording_id, auth_token=auth_token
        )
        response = self.record_stub.Restart(request)
        return proto_to_dict(response)

    def stop_recording(self, recording_id: str, auth_token: str = None):
        """녹화 중지"""
        request = record_pb2.RecordStopReq(
            recording_id=recording_id, auth_token=auth_token
        )
        response = self.record_stub.Stop(request)
        return proto_to_dict(response)

    def get_recording_status(self, recording_id: str):
        """녹화 상태 조회"""
        request = record_pb2.RecordGetStatusReq(recording_id=recording_id)
        response = self.record_stub.GetStatus(request)
        if response.HasField("status"):
            return proto_to_dict(response.status)
        elif response.HasField("error"):
            raise Exception(f"Status error: {response.error.message}")
        return None

    def list_recordings(self):
        """녹화 목록 조회"""
        request = record_pb2.ListRecordingsReq()
        response = self.record_stub.ListRecordings(request)
        recordings = []
        for rec in response.recordings:
            try:
                rec_dict = proto_to_dict(rec)
                healthy = rec_dict.get("jitter", {}).get("healthy", False)
                rec_dict["ntp_synced"] = healthy
                recordings.append(rec_dict)
            except Exception:
                pass
        return recordings

    def take_snapshot(
        self,
        recording_id: str,
        seconds: int = None,
        nanos: int = None,
        strategy: int = None,
        max_offset_ms: int = None,
    ):
        """스냅샷 촬영 — 바이너리 이미지와 메타데이터 반환"""
        args = {"recording_id": recording_id}
        if seconds is not None:
            ts = timestamp_pb2.Timestamp(seconds=seconds, nanos=nanos or 0)
            args["ts"] = ts
        if strategy is not None:
            args["strategy"] = strategy
        if max_offset_ms is not None:
            args["max_offset_ms"] = max_offset_ms

        request = snapshot_pb2.SnapshotReq(**args)
        return self.snapshot_stub.Take(request)

    def start_event_clip(self, recording_id: str, auth_token: str = None):
        """이벤트 클립 시작"""
        request = record_pb2.StartEventClipReq(
            recording_id=recording_id, auth_token=auth_token
        )
        response = self.record_stub.StartEventClip(request)
        return proto_to_dict(response)

    def stop_event_clip(self, recording_id: str, auth_token: str = None):
        """이벤트 클립 중지"""
        request = record_pb2.StopEventClipReq(
            recording_id=recording_id, auth_token=auth_token
        )
        response = self.record_stub.StopEventClip(request)
        return proto_to_dict(response)

    def create_simple_clip(self, recording_id: str, seconds: int, nanos: int):
        """심플 클립 생성"""
        ts = timestamp_pb2.Timestamp(seconds=seconds, nanos=nanos)
        request = clip_pb2.SimpleClipReq(recording_id=recording_id, ts=ts)
        response = self.clip_stub.CreateSimpleClip(request)
        return proto_to_dict(response)

    def get_recording_health(self, recording_id: str, auth_token: str = None):
        """녹화 헬스 체크"""
        request = health_pb2.GetRecordingHealthyReq(
            recording_id=recording_id, auth_token=auth_token
        )
        response = self.health_stub.GetRecordingHealthy(request)
        return proto_to_dict(response)


def get_grpc_client() -> GRPCClientService:
    """FastAPI Dependency Injection용 팩토리 함수"""
    grpc_address = os.environ.get("GRPC_ADDRESS", "localhost:50000")
    return GRPCClientService(address=grpc_address)
