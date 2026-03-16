"""
녹화(Recording) 관련 API 라우터
- 녹화 시작/중지/상태조회/목록조회
"""
import asyncio
from functools import partial
from fastapi import APIRouter, Depends, HTTPException

from backend.schemas.models import RecordStartRequest, RecordStopRequest
from backend.services.grpc_client import GRPCClientService, get_grpc_client

router = APIRouter(prefix="/api", tags=["recording"])


@router.get("/recordings")
async def list_recordings(client: GRPCClientService = Depends(get_grpc_client)):
    """녹화 목록 조회 — 전체 녹화 상태 + 헬스 정보 반환"""
    try:
        loop = asyncio.get_event_loop()
        recordings = await loop.run_in_executor(None, client.list_recordings)
        return recordings
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start")
async def start_recording(
    req: RecordStartRequest,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """녹화 시작 — gRPC Record/Start 호출"""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                client.start_recording,
                hq_url=req.hq_url,
                sq_url=req.sq_url,
                rtsp_hq_username=req.rtsp_hq_username,
                rtsp_hq_password=req.rtsp_hq_password,
                rtsp_sq_username=req.rtsp_sq_username,
                rtsp_sq_password=req.rtsp_sq_password,
                hq_storage_limit_mbs=req.hq_storage_limit_mbs,
                sq_storage_limit_mbs=req.sq_storage_limit_mbs,
                retention_days=req.retention_days,
                recording_mode=req.recording_mode,
                encoding_codec=req.encoding_codec,
                auth_token=req.auth_token,
                notes=req.notes,
                serial_number=req.serial_number,
            ),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
async def stop_recording(
    req: RecordStopRequest,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """녹화 중지 — gRPC Record/Stop 호출"""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                client.stop_recording,
                recording_id=req.recording_id,
                auth_token=req.auth_token,
            ),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recordings/{recording_id}/status")
async def get_recording_status(
    recording_id: str,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """개별 녹화 상태 조회 — gRPC Record/GetStatus 호출"""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(client.get_recording_status, recording_id=recording_id),
        )
        if result is None:
            raise HTTPException(status_code=404, detail="Recording not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
