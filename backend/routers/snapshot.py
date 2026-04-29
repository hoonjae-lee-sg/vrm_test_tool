"""
스냅샷(Snapshot) 관련 API 라우터
- 단일 스냅샷, 멀티 동기화 스냅샷 (P1+MIN+P2 2-Phase 병렬 캡처)
"""
import asyncio
import base64
import logging
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from fastapi import APIRouter, Depends, HTTPException

from backend.schemas.models import SnapshotRequest, BulkSnapshotRequest
from backend.services.grpc_client import GRPCClientService, get_grpc_client

router = APIRouter(prefix="/api", tags=["snapshot"])
logger = logging.getLogger(__name__)

# === 모듈 수준 ThreadPoolExecutor ===
# bulk-snapshot은 N채널 fan-out gRPC 호출 패턴이라 매 요청마다 ThreadPoolExecutor를
# 신규 생성/소멸시키는 비용이 누적됨 (특히 짧은 캡처 인터벌, 다채널 운용 시).
# FastAPI 프로세스 수명 동안 1개 풀을 재사용하여 풀 lifecycle 오버헤드 제거.
# 워커 수 16 = 실 운용 8~11채널 동시 호출 + 단일 /snapshot API 동시성 마진 포함.
_BULK_EXECUTOR = ThreadPoolExecutor(max_workers=16, thread_name_prefix="bulk-snapshot")


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


def _ts_to_ms(ts) -> int:
    """google.protobuf.Timestamp → epoch ms 변환 (정렬·diff 계산용)"""
    return ts.seconds * 1000 + ts.nanos // 1_000_000


async def _take_one(
    client: GRPCClientService,
    rid: str,
    *,
    seconds: int = None,
    nanos: int = None,
    strategy: int = None,
    max_offset_ms: int = None,
):
    """
    단일 채널 비동기 스냅샷 호출 — 모듈 수준 풀 재사용.
    예외는 그대로 전파 (단일 /snapshot 엔드포인트의 500 응답 경로 유지).
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _BULK_EXECUTOR,
        partial(
            client.take_snapshot,
            recording_id=rid,
            seconds=seconds,
            nanos=nanos,
            strategy=strategy,
            max_offset_ms=max_offset_ms,
        ),
    )


async def _take_one_safe(client: GRPCClientService, rid: str, **kwargs):
    """
    예외/실패를 None으로 정규화한 호출.
    asyncio.gather에서 부분 실패를 허용해야 하는 경로에서만 사용.
    성공 시 SnapshotRespFile 반환, 실패/예외 시 None.
    """
    try:
        resp = await _take_one(client, rid, **kwargs)
        if resp.WhichOneof("result") == "file" and resp.file.image_data:
            return resp.file
    except Exception as e:
        logger.warning("[BulkSnapshot] %s call failed: %s", rid, e)
    return None


@router.post("/snapshot")
async def take_snapshot(
    req: SnapshotRequest,
    client: GRPCClientService = Depends(get_grpc_client),
):
    """단일 스냅샷 촬영 — gRPC Snapshot/Take 호출"""
    try:
        resp = await _take_one(
            client,
            req.recording_id,
            seconds=req.seconds,
            nanos=req.nanos,
            strategy=req.strategy,
            max_offset_ms=req.max_offset_ms,
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
    멀티 동기화 스냅샷 — 2-Phase 병렬 캡처

    snapshot_receiver/receiver.py::capture_once와 동일한 알고리즘으로 통일.
    브라우저 모드와 서버 모드의 동기화 신뢰도 일관성 확보.

    Phase 1: 전 채널 동시 호출 (target_ts 없음, 마스터 후보 병렬 폴링)
      - 각 서버 측 Recorder가 자체 EMA 추정 RTSP 지연으로 최신 프레임 선택.
      - 클라이언트가 지연을 추정/지정하지 않으므로 NOT_FOUND 위험 최소.
      - 직렬 master 폴링(N2) 제거 → 마스터 후보 전수 병렬 호출로 latency 누적 회피.

    Master ts 결정:
      - master_id 명시 + Phase 1 성공 시: 해당 카메라 actual_ts를 ref로 강제(사용자 의도 존중).
      - 미명시: PTS-synced 카메라들의 actual_ts 중 MIN을 ref로 채택.
        MIN = 가장 느린 카메라의 최신 시점 → 모든 카메라 라이브 버퍼 범위에 반드시 포함.
        → Phase 2 NOT_FOUND 위험 최소화 (느린 카메라의 최신 = 다른 카메라의 과거).
      - PTS-synced 후보 없음 + master_id 미지정: 전체 P1 success 중 MIN으로 fallback (경고 로그).

    Phase 2: 동일 ref ts로 전 채널 PRECISE(strategy=4) 동시 재요청
      - 모든 채널이 같은 시점의 라이브 프레임을 PTS 기반으로 선택 → 카메라 간 정렬.
      - 한 채널이라도 실패 시 404 반환 (all-or-nothing). 그룹 단위 데이터 품질 보장.
    """
    ids = req.recording_ids
    if not ids:
        return {}

    try:
        # ── Phase 1: 전 채널 무 ts 동시 호출 (마스터 후보 병렬 폴링) ──
        phase1 = await asyncio.gather(*(_take_one_safe(client, rid) for rid in ids))
        # rid → SnapshotRespFile or None
        p1_files = dict(zip(ids, phase1))

        # ── 마스터 ts 결정 ──
        ref_ts = None
        master_id: str = None
        master_pts_synced = False

        # 1) master_id 명시 + Phase 1 성공 → 해당 카메라 강제 사용
        if req.master_id and p1_files.get(req.master_id) is not None:
            f = p1_files[req.master_id]
            ref_ts = f.actual_timestamp
            master_id = req.master_id
            master_pts_synced = getattr(f, "is_pts_synced", True)
            logger.debug(
                "[BulkSnapshot] Master forced by master_id=%s pts_synced=%s",
                master_id, master_pts_synced,
            )
        else:
            # 2) PTS-synced 카메라들의 actual_ts 중 MIN 채택
            synced_candidates = [
                (rid, f)
                for rid, f in p1_files.items()
                if f is not None and getattr(f, "is_pts_synced", True)
            ]
            if synced_candidates:
                master_id, master_file = min(
                    synced_candidates,
                    key=lambda kv: _ts_to_ms(kv[1].actual_timestamp),
                )
                ref_ts = master_file.actual_timestamp
                master_pts_synced = True
            else:
                # 3) PTS-synced 후보 부재 → 전체 P1 성공 중 MIN으로 fallback
                fallback = [(rid, f) for rid, f in p1_files.items() if f is not None]
                if fallback:
                    master_id, master_file = min(
                        fallback,
                        key=lambda kv: _ts_to_ms(kv[1].actual_timestamp),
                    )
                    ref_ts = master_file.actual_timestamp
                    master_pts_synced = False
                    logger.warning(
                        "[BulkSnapshot] No PTS-synced master available — using non-synced %s",
                        master_id,
                    )

        if ref_ts is None or master_id is None:
            # Phase 1에서 어떤 카메라도 응답 없음 → 마스터 선출 불가
            raise HTTPException(
                status_code=404,
                detail="Sync master failed (Phase 1: all channels returned no frame)",
            )

        ref_ms = _ts_to_ms(ref_ts)

        # --- [DIAG-BULK-P1] Phase 1 분포 진단 ---
        # 채널 간 actual_ts spread → 카메라별 RTSP 지연 편차 가시화.
        all_ms = [_ts_to_ms(f.actual_timestamp) for f in p1_files.values() if f is not None]
        spread_ms = (max(all_ms) - min(all_ms)) if all_ms else 0
        logger.debug(
            "[DIAG-BULK-P1] master=%s ref_ms=%d spread=%dms succeeded=%d/%d",
            master_id, ref_ms, spread_ms, len(all_ms), len(ids),
        )

        # ── Phase 2: 동일 ref_ts로 전 채널 PRECISE 동시 호출 ──
        # strategy=4(PRECISE)는 라이브 버퍼만 사용(저장소 fallback 비활성).
        phase2 = await asyncio.gather(
            *(
                _take_one_safe(
                    client, rid,
                    seconds=ref_ts.seconds,
                    nanos=ref_ts.nanos,
                    strategy=4,
                )
                for rid in ids
            )
        )

        # ── 결과 수집 (all-or-nothing) ──
        # 한 채널이라도 실패 시 그룹 전체 폐기 — 동기화된 멀티스냅샷의 의미 보존.
        results: dict = {}
        for rid, f in zip(ids, phase2):
            if f is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Camera {rid} lost sync",
                )
            results[rid] = _build_snapshot_result(f)

            # --- [DIAG-BULK-P2] Phase 2 채널별 진단 ---
            slave_ms = _ts_to_ms(f.actual_timestamp)
            logger.debug(
                "[DIAG-BULK-P2] ch=%s actual=%d diff_from_master=%dms pts_synced=%s",
                rid, slave_ms, slave_ms - ref_ms,
                getattr(f, "is_pts_synced", True),
            )

        # ── 동기화 경고 메타데이터 ──
        # 마스터/슬레이브 중 PTS-synced=false인 채널 누적해 응답에 포함.
        warnings: list = []
        if not master_pts_synced:
            warnings.append(
                f"Master camera {master_id} is not PTS-synced (reduced accuracy)"
            )
        for rid, data in results.items():
            if rid != master_id and not data.get("is_pts_synced", True):
                warnings.append(f"Camera {rid} is not PTS-synced")

        response = {"snapshots": results, "master_id": master_id}
        if warnings:
            response["sync_warnings"] = warnings
        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
