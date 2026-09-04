"""
이벤트 피드 API 라우터 — API_REQUIREMENTS §2.3.
gRPC Events 서비스 프록시 — 폴링(GET /events/recent) + SSE(GET /events/stream).
"""
import asyncio
import json
import logging
from functools import partial
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sse_starlette.sse import EventSourceResponse

from backend.services.grpc_client import GRPCClientService, get_grpc_client
from backend.services.grpc_errors import to_http_exception
from video_recorder.events import events_pb2

router = APIRouter(prefix="/api", tags=["events"])
logger = logging.getLogger(__name__)

# enum → frontend 문자열 변환 — grpc_client 와 동일.
_TYPE_NAME = {
    events_pb2.STREAM_LOST:      "STREAM_LOST",
    events_pb2.STREAM_RECOVERED: "STREAM_RECOVERED",
    events_pb2.EVENT_TRIGGERED:  "EVENT_TRIGGERED",
    events_pb2.EVENT_CLIP_SAVED: "EVENT_CLIP_SAVED",
    events_pb2.DRIFT_WARN:       "DRIFT_WARN",
    events_pb2.DISK_THRESHOLD:   "DISK_THRESHOLD",
    events_pb2.RESTART:          "RESTART",
}
_SEV_NAME = {
    events_pb2.SEV_INFO:  "info",
    events_pb2.SEV_WARN:  "warn",
    events_pb2.SEV_ERROR: "error",
}


def _pb_to_dict(ev) -> dict:
    """pb::Event → frontend dict (events/recent 응답 형식과 동일)."""
    meta = {}
    if ev.meta_json:
        try:
            meta = json.loads(ev.meta_json)
        except Exception:
            meta = {}
    return {
        "id":           ev.id,
        "ts":           ev.ts.ToDatetime().isoformat().replace("+00:00", "") + "Z" if ev.ts.seconds else None,
        "recording_id": ev.recording_id,
        "type":         _TYPE_NAME.get(ev.type, "UNSPECIFIED"),
        "severity":     _SEV_NAME.get(ev.severity, "info"),
        "message":      ev.message,
        "meta":         meta,
    }


@router.get("/events/recent")
async def get_recent_events(
    limit: int = Query(20, ge=1, le=100),
    recording_id: Optional[str] = Query(None, description="특정 카메라만"),
    severity: Optional[str] = Query(None, description="콤마 구분 (info,warn,error)"),
    since: Optional[str] = Query(None, description="ISO8601 — 이 시각 이후만"),
    client: GRPCClientService = Depends(get_grpc_client),
):
    """최근 이벤트 N개 — Dashboard 이벤트 피드 + LivePage 우측 패널."""
    sev_list = None
    if severity:
        sev_list = [s.strip() for s in severity.split(",") if s.strip()]
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            partial(
                client.get_recent_events,
                limit=limit,
                recording_id=recording_id,
                severity=sev_list,
                since_iso=since,
            ),
        )
    except Exception as e:
        # gRPC 거절(ALREADY_EXISTS/INVALID_ARGUMENT 등)을 500 으로 뭉개지 않고
        # 대응 HTTP 상태로 변환. detail 에는 서버 사유 문자열만 담음.
        raise to_http_exception(e)


@router.get("/events/stream")
async def stream_events(
    request: Request,
    recording_id: Optional[str] = Query(None),
    severity: Optional[str] = Query(None, description="콤마 구분 (info,warn,error)"),
    client: GRPCClientService = Depends(get_grpc_client),
):
    """
    이벤트 SSE 푸시 — text/event-stream.
    gRPC server streaming 응답을 SSE 메시지로 변환하여 클라이언트에 전달.

    클라이언트 disconnect: request.is_disconnected() 폴링 + 큐 wait_for 대기 사이클로 검출.
    백엔드 disconnect: gRPC stream 종료 시 generator 자동 종료.
    """
    sev_list = None
    if severity:
        sev_list = [s.strip() for s in severity.split(",") if s.strip()]

    async def event_publisher():
        """gRPC server streaming → SSE 메시지 yield."""
        # gRPC iterator 는 sync — asyncio 이벤트 루프 블로킹 회피 위해 별도 스레드에서 polling.
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)

        # outer scope에서 stream 핸들 보관 — disconnect 시 cancel용.
        # gRPC sync stream은 cancel() 호출 시 다음 iter에서 RpcError 발생.
        grpc_stream_holder: dict = {"stream": None}

        def grpc_thread():
            """gRPC stream iterate — blocking. 큐에 push, 종료 시 sentinel."""
            try:
                stream = client.stream_events(
                    recording_id=recording_id, severity=sev_list,
                )
                grpc_stream_holder["stream"] = stream
                for ev in stream:
                    asyncio.run_coroutine_threadsafe(queue.put(ev), loop)
            except Exception as e:
                logger.warning("[SSE] gRPC stream ended: %s", e)
            finally:
                # sentinel — None 으로 publisher 루프 종료 신호.
                asyncio.run_coroutine_threadsafe(queue.put(None), loop)

        # 별도 스레드 시작.
        import threading
        worker = threading.Thread(target=grpc_thread, name="sse-grpc-worker", daemon=True)
        worker.start()

        try:
            while True:
                # 클라이언트 disconnect 체크 — 1초 단위 polling.
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if ev is None:
                    break  # gRPC stream 종료.
                yield {
                    "event": "message",
                    "data": json.dumps(_pb_to_dict(ev)),
                }
        finally:
            # gRPC stream cancel — worker 스레드 정리 (다음 iter 호출 시 예외 발생 후 종료).
            stream = grpc_stream_holder.get("stream")
            if stream is not None:
                try:
                    stream.cancel()
                except Exception:
                    pass

    return EventSourceResponse(event_publisher())
