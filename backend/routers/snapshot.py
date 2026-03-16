"""
스냅샷(Snapshot) 관련 API 라우터
- 단일 스냅샷, 멀티 동기화 스냅샷
"""
import asyncio
import base64
from functools import partial
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException

from backend.schemas.models import SnapshotRequest, BulkSnapshotRequest
from backend.services.grpc_client import GRPCClientService, get_grpc_client

router = APIRouter(prefix="/api", tags=["snapshot"])


@router.post("/snapshot")
async def take_snapshot(
    req: SnapshotRequest,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """단일 스냅샷 촬영 — gRPC Snapshot/Take 호출"""
    try:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            partial(
                client.take_snapshot,
                recording_id=req.recording_id,
                seconds=req.seconds,
                nanos=req.nanos,
                strategy=req.strategy,
                max_offset_ms=req.max_offset_ms,
            ),
        )

        # 응답에서 이미지 데이터 추출
        if resp.WhichOneof("result") == "file" and resp.file.image_data:
            f = resp.file
            return {
                "image_data": f"data:image/jpeg;base64,{base64.b64encode(f.image_data).decode('utf-8')}",
                "actual_timestamp": {
                    "seconds": f.actual_timestamp.seconds,
                    "nanos": f.actual_timestamp.nanos,
                },
            }
        else:
            raise HTTPException(status_code=404, detail="Snapshot failed: no image data")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk-snapshot")
async def take_bulk_snapshot(
    req: BulkSnapshotRequest,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """
    멀티 동기화 스냅샷 — 기존 Flask bulk-snapshot 로직 이식
    1. 마스터 카메라에서 기준 타임스탬프 획득
    2. 나머지 카메라에서 동기화 촬영 (strategy=4)
    3. 하나라도 실패 시 전체 에러 반환
    """
    ids = req.recording_ids
    if not ids:
        return {}

    try:
        loop = asyncio.get_event_loop()

        # 1단계: 마스터 카메라에서 기준 타임스탬프 획득
        first_id = None
        sync_ts_obj = None
        results = {}

        for rid in ids:
            try:
                resp = await loop.run_in_executor(
                    None,
                    partial(client.take_snapshot, recording_id=rid),
                )
                if resp.WhichOneof("result") == "file" and resp.file.image_data:
                    f = resp.file
                    sync_ts_obj = f.actual_timestamp
                    first_id = rid
                    results[rid] = {
                        "image_data": f"data:image/jpeg;base64,{base64.b64encode(f.image_data).decode('utf-8')}",
                        "actual_timestamp": {
                            "seconds": f.actual_timestamp.seconds,
                            "nanos": f.actual_timestamp.nanos,
                        },
                    }
                    break
            except Exception:
                continue

        if not first_id:
            raise HTTPException(status_code=404, detail="Sync master failed")

        # 2단계: 동기화 촬영 (하나라도 실패 시 전체 에러)
        def fetch_one(rid: str):
            if rid == first_id:
                return None
            try:
                r = client.take_snapshot(
                    recording_id=rid,
                    seconds=sync_ts_obj.seconds,
                    nanos=sync_ts_obj.nanos,
                    strategy=4,
                )
                if r.WhichOneof("result") == "file" and r.file.image_data:
                    return rid, {
                        "image_data": f"data:image/jpeg;base64,{base64.b64encode(r.file.image_data).decode('utf-8')}",
                        "actual_timestamp": {
                            "seconds": r.file.actual_timestamp.seconds,
                            "nanos": r.file.actual_timestamp.nanos,
                        },
                    }
            except Exception:
                pass
            return rid, "FAILED"

        with ThreadPoolExecutor(max_workers=len(ids)) as executor:
            futures = list(executor.map(fetch_one, ids))
            for res in futures:
                if res:
                    if res[1] == "FAILED":
                        raise HTTPException(
                            status_code=404,
                            detail=f"Camera {res[0]} lost sync",
                        )
                    results[res[0]] = res[1]

        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
