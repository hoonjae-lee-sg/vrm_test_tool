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
# === FleetMetrics / Events 신규 stub (S2 atfr-core 추가분) ===
# protoc 재생성 필요 — sync_protos.sh 실행 후 사용 가능.
from video_recorder.metrics import fleet_pb2, fleet_pb2_grpc
from video_recorder.events import events_pb2, events_pb2_grpc


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


def _coerce_int(d: dict, *keys: str):
    """proto3 uint64 의 JSON string 직렬화 표준을 int 로 변환 — API_REQUIREMENTS §0.3 정수 규약 준수.
    JS 안전 범위(2^53) 초과 가능성 있는 누적 카운터지만 frontend 사용 패턴(차트/표시)상 정수가 자연스러움.
    """
    if not isinstance(d, dict):
        return d
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.lstrip('-').isdigit():
            d[k] = int(v)
    return d


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
        # 신규 — FleetMetrics / Events 스텁.
        self.fleet_stub = fleet_pb2_grpc.FleetMetricsStub(self.channel)
        self.events_stub = events_pb2_grpc.EventsStub(self.channel)
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

    # ===== FleetMetrics =====
    # API_REQUIREMENTS §2.1 — Dashboard KPI + 24h sparkline.
    # NaN 인코딩 — proxy 단에서 None 으로 직렬화하여 frontend null 매핑.
    def get_fleet_metrics(self):
        request = fleet_pb2.GetFleetMetricsReq()
        response = self.fleet_stub.GetFleetMetrics(request)
        if response.HasField("error"):
            raise Exception(f"FleetMetrics error: {response.error.message}")
        d = proto_to_dict(response.payload)
        # NaN → None 변환 (proto float NaN은 dict 변환 시 'NaN' 문자열로 바뀜).
        sp = d.get("sparklines", {})
        for key in ("bitrate_24h", "drift_24h", "frames_24h"):
            arr = sp.get(key, []) or []
            sp[key] = [None if (isinstance(v, float) and v != v) or v == "NaN" else v for v in arr]
        return d

    # API_REQUIREMENTS §2.2 — 시계열 처리량.
    def get_throughput(self, range_str: str = "1h", bucket_seconds: int = 60):
        # range 문자열 → enum.
        range_map = {
            "1h":  fleet_pb2.RANGE_1H,
            "6h":  fleet_pb2.RANGE_6H,
            "24h": fleet_pb2.RANGE_24H,
        }
        request = fleet_pb2.GetThroughputReq(
            range=range_map.get(range_str, fleet_pb2.RANGE_1H),
            bucket_seconds=bucket_seconds,
        )
        response = self.fleet_stub.GetThroughput(request)
        if response.HasField("error"):
            raise Exception(f"Throughput error: {response.error.message}")
        d = proto_to_dict(response.payload)
        # uint64 JSON string → int (사양 §0.3 정수 규약).
        for p in d.get("points", []) or []:
            _coerce_int(p, "frames_in", "frames_dropped")
        _coerce_int(d.get("totals", {}) or {}, "frames_in", "frames_dropped")
        return d

    # API_REQUIREMENTS §2.4 — 디스크 사용량.
    def get_storage_usage(self):
        request = fleet_pb2.GetStorageUsageReq()
        response = self.fleet_stub.GetStorageUsage(request)
        if response.HasField("error"):
            raise Exception(f"StorageUsage error: {response.error.message}")
        return proto_to_dict(response.payload)

    # API_REQUIREMENTS §4.1 — 카메라 단일 상세 메트릭.
    def get_recording_metrics(self, recording_id: str):
        request = fleet_pb2.GetRecordingMetricsReq(recording_id=recording_id)
        response = self.fleet_stub.GetRecordingMetrics(request)
        if response.HasField("error"):
            raise Exception(f"RecordingMetrics error: {response.error.message}")
        d = proto_to_dict(response.payload)
        # proto3 default 0 omit 보강 — 사양 §0.3 정수 키 명시적 노출.
        d.setdefault("frames_in", 0)
        d.setdefault("frames_dropped", 0)
        d.setdefault("uptime_seconds", 0)
        # uint64 JSON string → int.
        _coerce_int(d, "uptime_seconds", "frames_in", "frames_dropped")
        return d

    # ===== Events =====
    # API_REQUIREMENTS §2.3 보강 — server streaming. 호출자 (FastAPI SSE) 에서 yield.
    # 반환: pb::Event 메시지 yield (filter 그대로 서버로 전달).
    def stream_events(self, recording_id: str = None, severity: list = None):
        kwargs = {}
        if recording_id:
            kwargs["recording_id"] = recording_id
        if severity:
            sev_map = {
                "info":  events_pb2.SEV_INFO,
                "warn":  events_pb2.SEV_WARN,
                "error": events_pb2.SEV_ERROR,
            }
            kwargs["severity"] = [sev_map[s] for s in severity if s in sev_map]
        request = events_pb2.StreamEventsReq(**kwargs)
        # gRPC 응답 stream — generator 그대로 반환. 호출자에서 for-loop iterate.
        return self.events_stub.StreamEvents(request)

    # API_REQUIREMENTS §2.3 — 이벤트 피드.
    def get_recent_events(
        self,
        limit: int = 20,
        recording_id: str = None,
        severity: list = None,
        since_iso: str = None,
    ):
        kwargs = {"limit": limit}
        if recording_id:
            kwargs["recording_id"] = recording_id
        if severity:
            sev_map = {
                "info":  events_pb2.SEV_INFO,
                "warn":  events_pb2.SEV_WARN,
                "error": events_pb2.SEV_ERROR,
            }
            kwargs["severity"] = [sev_map[s] for s in severity if s in sev_map]
        if since_iso:
            from datetime import datetime, timezone
            # ISO8601 ("...Z") 또는 offset 포함 모두 허용. timezone 미지정시 UTC 가정.
            dt = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            ts = timestamp_pb2.Timestamp()
            ts.FromDatetime(dt)
            kwargs["since"] = ts

        request = events_pb2.GetRecentEventsReq(**kwargs)
        response = self.events_stub.GetRecentEvents(request)
        if response.HasField("error"):
            raise Exception(f"Events error: {response.error.message}")

        # 응답 변환 — meta_json 문자열을 dict로 파싱, type/severity enum을 frontend 문자열로.
        import json
        type_name = {
            events_pb2.STREAM_LOST:      "STREAM_LOST",
            events_pb2.STREAM_RECOVERED: "STREAM_RECOVERED",
            events_pb2.EVENT_TRIGGERED:  "EVENT_TRIGGERED",
            events_pb2.EVENT_CLIP_SAVED: "EVENT_CLIP_SAVED",
            events_pb2.DRIFT_WARN:       "DRIFT_WARN",
            events_pb2.DISK_THRESHOLD:   "DISK_THRESHOLD",
            events_pb2.RESTART:          "RESTART",
        }
        sev_name = {
            events_pb2.SEV_INFO:  "info",
            events_pb2.SEV_WARN:  "warn",
            events_pb2.SEV_ERROR: "error",
        }
        events_out = []
        # total 은 uint64 → 응답 시 int 변환.
        total_int = int(response.payload.total) if response.payload.total else 0
        for ev in response.payload.events:
            meta = {}
            if ev.meta_json:
                try:
                    meta = json.loads(ev.meta_json)
                except Exception:
                    meta = {}
            events_out.append({
                "id":           ev.id,
                "ts":           ev.ts.ToDatetime().isoformat().replace("+00:00", "") + "Z" if ev.ts.seconds else None,
                "recording_id": ev.recording_id,
                "type":         type_name.get(ev.type, "UNSPECIFIED"),
                "severity":     sev_name.get(ev.severity, "info"),
                "message":      ev.message,
                "meta":         meta,
            })
        return {"events": events_out, "total": total_int}


def get_grpc_client() -> GRPCClientService:
    """FastAPI Dependency Injection용 팩토리 함수"""
    grpc_address = os.environ.get("GRPC_ADDRESS", "localhost:50000")
    return GRPCClientService(address=grpc_address)
