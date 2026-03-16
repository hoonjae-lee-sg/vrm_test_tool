"""
클립(Clip) 관련 API 라우터
- 이벤트 클립 시작/중지, 심플 클립 생성
"""
import asyncio
from functools import partial
from fastapi import APIRouter, Depends, HTTPException

from backend.schemas.models import EventClipRequest, SimpleClipRequest
from backend.services.grpc_client import GRPCClientService, get_grpc_client

router = APIRouter(prefix="/api/clip", tags=["clip"])


@router.post("/event/start")
async def start_event_clip(
    req: EventClipRequest,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """이벤트 클립 시작 — gRPC Record/StartEventClip 호출"""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                client.start_event_clip,
                recording_id=req.recording_id,
                auth_token=req.auth_token,
            ),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/event/stop")
async def stop_event_clip(
    req: EventClipRequest,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """이벤트 클립 중지 — gRPC Record/StopEventClip 호출"""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                client.stop_event_clip,
                recording_id=req.recording_id,
                auth_token=req.auth_token,
            ),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/simple")
async def create_simple_clip(
    req: SimpleClipRequest,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """심플 클립 생성 — gRPC Clip/CreateSimpleClip 호출"""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                client.create_simple_clip,
                recording_id=req.recording_id,
                seconds=req.seconds,
                nanos=req.nanos,
            ),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
