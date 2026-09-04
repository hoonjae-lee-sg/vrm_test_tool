"""
Sync Lab 라우터 — API_REQUIREMENTS §3.1 / §3.2.
snapshot_receiver의 디스크 출력을 직접 walk 하여 sync 세션/분포를 산출.
gRPC 경유 없이 FastAPI 단독 동작. 클라이언트 reduce 로직을 백엔드로 이전.

데이터 소스:
  storage_path/{recording_id}/snapshot/{YYYYMMDD}/{HH}/{ts_ms}_{diff_ms}ms.jpg
  (snapshot_receiver/writer.py 참조 — filename에 diff_ms가 포함되어 walk만으로 분포 산출 가능)
"""
import asyncio
import bisect
import logging
import os
import re
import statistics
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from backend.services.grpc_errors import to_http_exception

# snapshot_receiver 의 storage_path 공유 (env / 기본값 동일).
from snapshot_receiver.config import config as sr_config

router = APIRouter(prefix="/api", tags=["sync"])
logger = logging.getLogger(__name__)

# === 캐시 (P2-2) ===
# 디스크 walk 비용이 크므로 결과를 5분 TTL 로 캐싱. 다중 클라이언트가 짧은 간격으로
# 호출해도 매번 walk 하지 않도록. 키: (endpoint, params tuple).
_CACHE_TTL_SEC = 300
_cache_lock = threading.Lock()
_cache: dict = {}  # key → (timestamp, value)


def _cache_get(key):
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        ts, val = entry
        if time.time() - ts > _CACHE_TTL_SEC:
            _cache.pop(key, None)
            return None
        return val


def _cache_set(key, value):
    with _cache_lock:
        _cache[key] = (time.time(), value)

# 임계값 — frontend SYNC_THRESHOLD_* 와 일치 (API_REQUIREMENTS §3.2 Note).
SYNC_THRESHOLD_PERFECT_MS = 10
SYNC_THRESHOLD_GOOD_MS    = 30
SYNC_THRESHOLD_WARN_MS    = 100

# Histogram bin 구성 — 5ms × 21구간 (0~5, 5~10, ..., 100+). 마지막 구간은 100+ 합산.
HIST_BIN_SIZE_MS = 5
HIST_MAX_MS      = 100
HIST_BIN_COUNT   = (HIST_MAX_MS // HIST_BIN_SIZE_MS) + 1   # 21 (0-5, ..., 95-100, 100+)

# filename 패턴: "{ts_ms}_{diff_ms}ms.jpg".
_FILE_RE = re.compile(r"^(\d+)_(-?\d+)ms\.jpg$")


def _storage_root() -> Path:
    return Path(sr_config.storage_path)


def _walk_hour(date: str, hour: Optional[str]):
    """
    storage_path 아래 모든 카메라의 (date, hour) jpg 파일 yield.
    hour 미지정 시 해당 date 의 모든 hour 통합.
    yield: (recording_id, ts_ms, diff_ms, file_path)
    """
    root = _storage_root()
    if not root.is_dir():
        return

    for cam_dir in root.iterdir():
        if not cam_dir.is_dir():
            continue
        date_dir = cam_dir / "snapshot" / date
        if not date_dir.is_dir():
            continue

        hour_dirs = [date_dir / hour] if hour else [d for d in date_dir.iterdir() if d.is_dir()]
        for hdir in hour_dirs:
            if not hdir.is_dir():
                continue
            try:
                for f in hdir.iterdir():
                    if not f.is_file():
                        continue
                    m = _FILE_RE.match(f.name)
                    if not m:
                        continue
                    ts_ms   = int(m.group(1))
                    diff_ms = int(m.group(2))
                    yield (cam_dir.name, ts_ms, diff_ms, f)
            except OSError as e:
                logger.warning("[sync] walk failed at %s: %s", hdir, e)


def _classify_bucket(diff_ms: int) -> str:
    """절대값 기반 sync grade 분류."""
    a = abs(diff_ms)
    if a <= SYNC_THRESHOLD_PERFECT_MS: return "perfect"
    if a <= SYNC_THRESHOLD_GOOD_MS:    return "good"
    if a <= SYNC_THRESHOLD_WARN_MS:    return "warn"
    return "bad"


def _hist_index(diff_ms: int) -> int:
    """절대값 → histogram bin index. 100ms 초과는 마지막 bin."""
    a = abs(diff_ms)
    if a >= HIST_MAX_MS:
        return HIST_BIN_COUNT - 1
    return a // HIST_BIN_SIZE_MS


def _list_dates_hours():
    """storage_path 아래 모든 (date, hour, [cam_dirs]) 조합 yield."""
    root = _storage_root()
    if not root.is_dir():
        return

    # date → hour → set(cam) 누적.
    by_date_hour: dict = {}
    for cam_dir in root.iterdir():
        if not cam_dir.is_dir():
            continue
        snap_dir = cam_dir / "snapshot"
        if not snap_dir.is_dir():
            continue
        for date_dir in snap_dir.iterdir():
            if not date_dir.is_dir():
                continue
            for hour_dir in date_dir.iterdir():
                if not hour_dir.is_dir():
                    continue
                key = (date_dir.name, hour_dir.name)
                by_date_hour.setdefault(key, set()).add(cam_dir.name)

    for (date, hour), cams in by_date_hour.items():
        yield date, hour, cams


def _percentile(values: list, p: float) -> float:
    """간단 백분위수 — values 정렬 가정 X. 빈 리스트 시 0."""
    if not values:
        return 0.0
    arr = sorted(values)
    idx = int(len(arr) * p)
    if idx >= len(arr): idx = len(arr) - 1
    return float(arr[idx])


def _build_sessions_sync():
    """디스크 walk → date+hour 단위 세션 항목 리스트. 동기 함수 (executor에서 실행)."""
    sessions = []
    for date, hour, cams in _list_dates_hours():
        diffs = []
        ts_min = None
        ts_max = None
        size_bytes = 0
        frame_count = 0

        for rid in cams:
            hdir = _storage_root() / rid / "snapshot" / date / hour
            try:
                for f in hdir.iterdir():
                    if not f.is_file():
                        continue
                    m = _FILE_RE.match(f.name)
                    if not m:
                        continue
                    ts_ms   = int(m.group(1))
                    diff_ms = abs(int(m.group(2)))
                    diffs.append(diff_ms)
                    frame_count += 1
                    size_bytes += f.stat().st_size
                    if ts_min is None or ts_ms < ts_min: ts_min = ts_ms
                    if ts_max is None or ts_ms > ts_max: ts_max = ts_ms
            except OSError:
                continue

        if frame_count == 0:
            continue

        avg_diff = int(round(statistics.fmean(diffs))) if diffs else 0
        p95_diff = int(round(_percentile(diffs, 0.95)))

        sessions.append({
            "session_id":      f"{date}_{hour}",
            "name":             f"{date}_{hour}",
            "started_at":       _ms_to_iso(ts_min),
            "ended_at":         _ms_to_iso(ts_max),
            "frame_count":      frame_count,
            "camera_count":     len(cams),
            "max_diff_ms_avg":  avg_diff,
            "max_diff_ms_p95":  p95_diff,
            "path":             str(_storage_root().resolve()),  # 실제 경로 표기 (개별 카메라 root는 하위).
            "size_bytes":       size_bytes,
        })

    # 최신 → 과거 정렬.
    sessions.sort(key=lambda s: s["session_id"], reverse=True)
    return sessions


def _ms_to_iso(ts_ms: Optional[int]) -> Optional[str]:
    if ts_ms is None: return None
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _build_distribution_sync(date: str, hour: Optional[str]):
    """디스크 walk → buckets + histogram + coverage 산출. 동기 함수."""
    buckets = {"perfect": 0, "good": 0, "warn": 0, "bad": 0}
    counts  = [0] * HIST_BIN_COUNT
    total   = 0

    # coverage 산출: ts_ms → set(cam_id) 매핑하여 frame group별 카메라 응답 비율 계산.
    # ±10ms 윈도우로 그룹핑 — 정확 일치 ts가 드물어도 같은 캡처 그룹으로 판정.
    # 메모리 절감 위해 정렬 리스트 + bisect 활용.
    frame_groups: list = []   # (anchor_ts_ms, set(cam_ids))
    anchor_ts_list: list = [] # bisect 검색용 정렬 키.
    GROUP_WINDOW_MS = 10

    all_cams: set = set()

    for rid, ts_ms, diff_ms, _path in _walk_hour(date, hour):
        # buckets / histogram 누적.
        buckets[_classify_bucket(diff_ms)] += 1
        counts[_hist_index(diff_ms)] += 1
        total += 1
        all_cams.add(rid)

        # frame group anchor 매칭 — bisect로 ±GROUP_WINDOW 내 anchor 검색.
        idx = bisect.bisect_left(anchor_ts_list, ts_ms)
        matched = None
        for cand_idx in (idx - 1, idx):
            if 0 <= cand_idx < len(anchor_ts_list):
                if abs(anchor_ts_list[cand_idx] - ts_ms) <= GROUP_WINDOW_MS:
                    matched = cand_idx
                    break
        if matched is not None:
            frame_groups[matched][1].add(rid)
        else:
            # 신규 anchor 삽입 (정렬 유지).
            bisect.insort(anchor_ts_list, ts_ms)
            new_idx = anchor_ts_list.index(ts_ms)
            frame_groups.insert(new_idx, (ts_ms, {rid}))

    # coverage 계산 — group별 (cam 수) / (전체 cam 수).
    cam_total = len(all_cams) if all_cams else 1
    coverages = [(anchor, len(cams) / cam_total) for anchor, cams in frame_groups]

    if coverages:
        avg = sum(c for _, c in coverages) / len(coverages)
        worst_anchor, min_cov = min(coverages, key=lambda x: x[1])
        min_frame_id = str(worst_anchor)
    else:
        avg = 0.0
        min_cov = 0.0
        min_frame_id = ""

    return {
        "scope":        {"date": date, **({"hour": hour} if hour else {})},
        "total_frames": total,
        "buckets":      buckets,
        "histogram": {
            "bin_size_ms": HIST_BIN_SIZE_MS,
            "max_ms":      HIST_MAX_MS,
            "counts":      counts,
        },
        "coverage": {
            "avg":          round(avg, 3),
            "min_frame_id": min_frame_id,
            "min":          round(min_cov, 3),
        },
    }


# ===== Endpoints =====

@router.get("/sync/sessions")
async def get_sync_sessions():
    """서버 모드로 캡처된 세션 목록 — date+hour 단위로 그룹핑. 5분 캐시."""
    cache_key = ("sessions",)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    try:
        loop = asyncio.get_event_loop()
        sessions = await loop.run_in_executor(None, _build_sessions_sync)
        result = {"sessions": sessions, "total": len(sessions)}
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        # gRPC 거절(ALREADY_EXISTS/INVALID_ARGUMENT 등)을 500 으로 뭉개지 않고
        # 대응 HTTP 상태로 변환. detail 에는 서버 사유 문자열만 담음.
        raise to_http_exception(e)


@router.get("/sync/distribution")
async def get_sync_distribution(
    date: str = Query(..., description="YYYYMMDD (필수)"),
    hour: Optional[str] = Query(None, description="HH (선택)"),
    session_id: Optional[str] = Query(None, description="형식: YYYYMMDD_HH"),
):
    """Sync grade 분포 + drift histogram + coverage."""
    # session_id 명시 시 date/hour 자동 파싱.
    if session_id:
        try:
            d, h = session_id.split("_", 1)
            if len(d) == 8 and len(h) == 2:
                date, hour = d, h
        except ValueError:
            pass

    if not (len(date) == 8 and date.isdigit()):
        raise HTTPException(status_code=400, detail="date must be YYYYMMDD")
    # hour 형식 검증 — "00" ~ "23" 만 허용. 잘못된 값은 400 (빈 결과 200 반환 회피).
    if hour is not None:
        if not (len(hour) == 2 and hour.isdigit() and 0 <= int(hour) <= 23):
            raise HTTPException(status_code=400, detail="hour must be HH (00-23)")

    cache_key = ("distribution", date, hour)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _build_distribution_sync, date, hour)
        _cache_set(cache_key, result)
        return result
    except Exception as e:
        # gRPC 거절(ALREADY_EXISTS/INVALID_ARGUMENT 등)을 500 으로 뭉개지 않고
        # 대응 HTTP 상태로 변환. detail 에는 서버 사유 문자열만 담음.
        raise to_http_exception(e)
