"""
헬스(Health) 관련 API 라우터
- 녹화 헬스 체크
"""
import asyncio
from functools import partial
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.services.grpc_client import GRPCClientService, get_grpc_client

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health/{recording_id}")
async def get_recording_health(
    recording_id: str,
    auth_token: str = Query(None),
    client: GRPCClientService = Depends(get_grpc_client),
):
    """녹화 헬스 체크 — gRPC Health/GetRecordingHealthy 호출"""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                client.get_recording_health,
                recording_id=recording_id,
                auth_token=auth_token,
            ),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
