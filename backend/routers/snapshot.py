"""
스냅샷(Snapshot) 관련 API 라우터
- 단일 스냅샷, 멀티 동기화 스냅샷
"""
import asyncio
import base64
import logging
from functools import partial
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException

from backend.schemas.models import SnapshotRequest, BulkSnapshotRequest
from backend.services.grpc_client import GRPCClientService, get_grpc_client

router = APIRouter(prefix="/api", tags=["snapshot"])
logger = logging.getLogger(__name__)


def _build_snapshot_result(f):
    """gRPC SnapshotRespFile → API 응답 딕셔너리 변환"""
    return {
        "image_data": f"data:image/jpeg;base64,{base64.b64encode(f.image_data).decode('utf-8')}",
        "actual_timestamp": {
            "seconds": f.actual_timestamp.seconds,
            "nanos": f.actual_timestamp.nanos,
        },
        # 동기화 메타데이터: 카메라별 PTS 동기화 신뢰도 정보
        "is_pts_synced": getattr(f, "is_pts_synced", True),
        "auto_sync_offset_ms": getattr(f, "auto_sync_offset_ms", 0),
    }


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
            return _build_snapshot_result(resp.file)
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
    멀티 동기화 스냅샷
    1. 마스터 카메라에서 기준 타임스탬프 획득 (PTS 동기화 카메라 우선)
    2. 나머지 카메라에서 동기화 촬영 (strategy=4, PRECISE)
    3. 하나라도 실패 시 전체 에러 반환
    """
    ids = req.recording_ids
    if not ids:
        return {}

    try:
        loop = asyncio.get_event_loop()

        # 1단계: 마스터 카메라 선택 순서 결정
        # master_id 지정 시 해당 카메라를 최우선으로, 미지정 시 recording_ids 순서 유지
        master_order = list(ids)
        if req.master_id and req.master_id in ids:
            master_order = [req.master_id] + [x for x in ids if x != req.master_id]

        # 마스터 카메라에서 기준 타임스탬프 획득
        first_id = None
        sync_ts_obj = None
        results = {}
        master_pts_synced = False

        for rid in master_order:
            try:
                resp = await loop.run_in_executor(
                    None,
                    partial(client.take_snapshot, recording_id=rid),
                )
                if resp.WhichOneof("result") == "file" and resp.file.image_data:
                    f = resp.file
                    is_synced = getattr(f, "is_pts_synced", True)

                    # PTS 비동기화 카메라는 master 부적합 (명시 지정한 경우 제외)
                    # fallback 타임스탬프 기반이므로 기준 시점 정확도 낮음
                    if not is_synced and rid != req.master_id:
                        logger.warning(
                            "[BulkSnapshot] %s skipped as master: PTS not synced", rid
                        )
                        continue

                    sync_ts_obj = f.actual_timestamp
                    first_id = rid
                    master_pts_synced = is_synced
                    results[rid] = _build_snapshot_result(f)

                    # --- [DIAG-BULK-MASTER] 마스터 스냅샷 진단 ---
                    logger.debug(
                        "[DIAG-BULK-MASTER] master=%s actual_ts=%d.%09d pts_synced=%s offset=%dms",
                        rid, sync_ts_obj.seconds, sync_ts_obj.nanos, is_synced,
                        getattr(f, "auto_sync_offset_ms", 0),
                    )

                    if not is_synced:
                        logger.warning(
                            "[BulkSnapshot] Master %s is NOT PTS-synced (forced by master_id)", rid
                        )
                    break
            except Exception:
                continue

        if not first_id:
            raise HTTPException(status_code=404, detail="Sync master failed")

        # 2단계: 슬레이브 동기화 촬영 (strategy=4, PRECISE — 라이브 버퍼만 사용)
        def fetch_one(rid: str):
            """슬레이브 카메라 동기화 스냅샷 촬영 (마스터 타임스탬프 기준)"""
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
                    # --- [DIAG-BULK-SLAVE] 슬레이브 응답 진단 ---
                    slave_ts = r.file.actual_timestamp
                    diff_ms = (slave_ts.seconds * 1000 + slave_ts.nanos // 1_000_000) - \
                              (sync_ts_obj.seconds * 1000 + sync_ts_obj.nanos // 1_000_000)
                    logger.debug(
                        "[DIAG-BULK-SLAVE] slave=%s actual=%d.%09d diff_from_master=%dms pts_synced=%s",
                        rid, slave_ts.seconds, slave_ts.nanos, diff_ms,
                        getattr(r.file, "is_pts_synced", True),
                    )
                    return rid, _build_snapshot_result(r.file)
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

        # 동기화 경고 메타데이터 포함
        # 하나라도 PTS 비동기화 카메라가 있으면 응답에 경고 추가
        warnings = []
        if not master_pts_synced:
            warnings.append(f"Master camera {first_id} is not PTS-synced (reduced accuracy)")
        for rid, data in results.items():
            if isinstance(data, dict) and not data.get("is_pts_synced", True):
                if rid != first_id:
                    warnings.append(f"Camera {rid} is not PTS-synced")

        response = {"snapshots": results, "master_id": first_id}
        if warnings:
            response["sync_warnings"] = warnings
        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
