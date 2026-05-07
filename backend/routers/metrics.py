"""
메트릭(FleetMetrics) 관련 API 라우터 — API_REQUIREMENTS §2.1/§2.2/§2.4/§4.1.
gRPC FleetMetrics 서비스 프록시.
"""
import asyncio
from functools import partial
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.services.grpc_client import GRPCClientService, get_grpc_client

router = APIRouter(prefix="/api", tags=["metrics"])


@router.get("/metrics/fleet")
async def get_fleet_metrics(client: GRPCClientService = Depends(get_grpc_client)):
    """플릿 KPI + 24h sparkline. Dashboard 상단 위젯 백킹."""
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, client.get_fleet_metrics)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/metrics/throughput")
async def get_throughput(
    range: str = Query("1h", description="시간 범위 (1h/6h/24h)"),
    bucket: str = Query("1m", description="bucket 단위 (1m/5m/1h)"),
    client: GRPCClientService = Depends(get_grpc_client),
):
    """시계열 처리량 — Throughput 위젯."""
    bucket_map = {"1m": 60, "5m": 300, "1h": 3600}
    bucket_seconds = bucket_map.get(bucket, 60)
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(client.get_throughput, range_str=range, bucket_seconds=bucket_seconds),
        )
        # API_REQUIREMENTS §2.2 응답 형식 보정 — totals를 nested object로 명시화.
        return {
            "range": range,
            "bucket_seconds": bucket_seconds,
            "points": result.get("points", []) or [],
            "totals": result.get("totals", {"frames_in": 0, "frames_dropped": 0, "drop_rate": 0.0}),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/storage/usage")
async def get_storage_usage(client: GRPCClientService = Depends(get_grpc_client)):
    """디스크 사용량 분류 통계 + retention 정보."""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, client.get_storage_usage)
        # API_REQUIREMENTS §2.4 형식 — by_type 을 nested object 로 재구성.
        return {
            "total_gb": result.get("total_gb", 0.0),
            "used_gb":  result.get("used_gb", 0.0),
            "free_gb":  result.get("free_gb", 0.0),
            "by_type": {
                "hls_segments_gb": result.get("hls_segments_gb", 0.0),
                "snapshots_gb":    result.get("snapshots_gb", 0.0),
                "event_clips_gb":  result.get("event_clips_gb", 0.0),
            },
            "by_recording":      result.get("by_recording", []) or [],
            "oldest_segment_at": result.get("oldest_segment_at"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recordings/{recording_id}/metrics")
async def get_recording_metrics(
    recording_id: str,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """카메라 단일 상세 메트릭 — LivePage 우측 패널 (5s 폴링)."""
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            partial(client.get_recording_metrics, recording_id=recording_id),
        )
    except Exception as e:
        msg = str(e)
        if "not found" in msg.lower() or "NOT_FOUND" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=500, detail=msg)
