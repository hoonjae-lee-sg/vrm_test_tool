import grpc
from vrm_test_tool.video_recorder.recorder import record_pb2, record_pb2_grpc
from vrm_test_tool.video_recorder.recorder import clip_pb2, clip_pb2_grpc
from vrm_test_tool.video_recorder.recorder import snapshot_pb2, snapshot_pb2_grpc
from vrm_test_tool.video_recorder.health import health_pb2, health_pb2_grpc
from vrm_test_tool.video_recorder.recorder import encoding_pb2
from vrm_test_tool.video_recorder.common import types_pb2
from google.protobuf import timestamp_pb2

class GRPCClient:
    """A client for interacting with the VRM gRPC services."""

    def __init__(self, address: str = 'localhost:50000'):
        """
        Initializes the gRPC client, creates a channel, and sets up stubs.
        """
        self.channel = grpc.insecure_channel(address)
        self.record_stub = record_pb2_grpc.RecordStub(self.channel)
        self.clip_stub = clip_pb2_grpc.ClipStub(self.channel)
        self.snapshot_stub = snapshot_pb2_grpc.SnapshotStub(self.channel)
        self.health_stub = health_pb2_grpc.HealthStub(self.channel)
        print(f"gRPC client connected to {address}")

    def close(self):
        """Closes the gRPC channel."""
        self.channel.close()

    def start_recording(self, hq_url: str, sq_url: str, retention_days: int = None, hq_storage_limit_mbs: int = None, sq_storage_limit_mbs: int = None, recording_mode: str = None, auth_token: str = None, notes: str = None, encoding_codec: str = None, serial_number: str = None):
        """Starts a recording using the Record service."""
        hq_rtsp = types_pb2.RtspUrl(raw=hq_url)
        sq_rtsp = types_pb2.RtspUrl(raw=sq_url)
        
        params = {
            "rtsp_url_hq": hq_rtsp,
            "rtsp_url_sq": sq_rtsp,
        }
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
        return self.record_stub.Start(request)

    def stop_recording(self, recording_id: str, auth_token: str = None):
        """Stops a recording using the Record service."""
        request = record_pb2.RecordStopReq(recording_id=recording_id, auth_token=auth_token)
        return self.record_stub.Stop(request)

    def get_recording_status(self, recording_id):
        request = record_pb2.RecordGetStatusReq(recording_id=recording_id)
        try:
            response = self.record_stub.GetStatus(request)
            if response.HasField('status'):
                return response.status
            elif response.HasField('error'):
                print(f"Error getting recording status: {response.error.message}")
                return None
        except grpc.RpcError as e:
            print(f"RPC Error getting recording status: {e}")
            return None

    def list_recordings(self):
        try:
            request = record_pb2.ListRecordingsReq()
            response = self.record_stub.ListRecordings(request)
            return response.recordings
        except grpc.RpcError as e:
            print(f"Error listing recordings: {e}")
            return []

    def start_event_clip(self, recording_id: str, auth_token: str = None):
        """Starts an event clip using the Record service."""
        request = record_pb2.StartEventClipReq(
            recording_id=recording_id,
            auth_token=auth_token
        )
        return self.record_stub.StartEventClip(request)

    def stop_event_clip(self, recording_id: str, auth_token: str = None):
        """Stops an event clip using the Record service."""
        request = record_pb2.StopEventClipReq(
            recording_id=recording_id,
            auth_token=auth_token
        )
        return self.record_stub.StopEventClip(request)

    def create_simple_clip(self, recording_id: str, timestamp: timestamp_pb2.Timestamp):
        """Creates a simple clip using the Clip service."""
        request = clip_pb2.SimpleClipReq(
            recording_id=recording_id,
            ts=timestamp
        )
        return self.clip_stub.CreateSimpleClip(request)

    def take_snapshot(self, recording_id: str, timestamp: timestamp_pb2.Timestamp = None, strategy: int = None, max_offset_ms: int = None):
        """Takes a snapshot using the Snapshot service."""
        args = {'recording_id': recording_id}
        if timestamp:
            args['ts'] = timestamp
        if strategy is not None:
            args['strategy'] = strategy
        if max_offset_ms is not None:
            args['max_offset_ms'] = max_offset_ms
        request = snapshot_pb2.SnapshotReq(**args)
        return self.snapshot_stub.Take(request)

    def get_recording_healthy(self, recording_id: str, auth_token: str = None):
        """Checks the health of a recording using the Health service."""
        request = health_pb2.GetRecordingHealthyReq(
            recording_id=recording_id,
            auth_token=auth_token
        )
        return self.health_stub.GetRecordingHealthy(request)




if __name__ == '__main__':
    # Example usage for testing the client itself
    try:
        client = GRPCClient()
        # The VRM server needs to be running for this to work
        # health_status = client.health_stub.Check(health_pb2.HealthCheckRequest())
        # print("Health check response:", health_status)
        client.close()
        print("Successfully created gRPC client and stubs.")
    except grpc.RpcError as e:
        print(f"Failed to connect or call gRPC service: {e.status()} - {e.details()}")

