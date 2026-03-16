"""
Snapshot Receiver Server — 진입점
11채널 × 24fps 멀티스냅샷 바이너리를 큐 기반으로 수신·저장하는 독립 서버

구성요소:
  - SnapshotReceiver: gRPC로 VRM에서 스냅샷 바이너리 수신 → 큐 적재
  - QueueManager: asyncio.Queue 기반 메모리 버퍼 + 백프레셔
  - SnapshotWriter: 큐에서 꺼내 디스크에 JPEG 파일 저장 (멀티스레드)
  - FastAPI: 캡처 시작/중지/상태 제어 API

실행:
  python -m snapshot_receiver.main
  또는
  uvicorn snapshot_receiver.main:app --host 0.0.0.0 --port 8200
"""
import asyncio
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from .config import config
from .queue_manager import QueueManager
from .receiver import SnapshotReceiver
from .writer import SnapshotWriter

# ── 로깅 설정 ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("snapshot_receiver")

# ── 전역 컴포넌트 ──
queue_manager: Optional[QueueManager] = None
receiver: Optional[SnapshotReceiver] = None
writer: Optional[SnapshotWriter] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI 라이프사이클 — 서버 시작/종료 시 컴포넌트 초기화/정리"""
    global queue_manager, receiver, writer

    # ── 시작 ──
    logger.info("=== Snapshot Receiver Server 시작 ===")
    logger.info(
        f"설정: gRPC={config.grpc_address}, 큐={config.queue_max_size}, "
        f"워커={config.writer_workers}, 저장경로={config.storage_path}"
    )

    queue_manager = QueueManager()
    receiver = SnapshotReceiver(queue=queue_manager.queue)
    writer = SnapshotWriter(queue=queue_manager.queue)

    # 저장 워커는 서버 시작 시 바로 가동 (큐에서 대기)
    await writer.start()

    yield

    # ── 종료 ──
    logger.info("=== Snapshot Receiver Server 종료 ===")
    await receiver.close()
    await writer.stop()


app = FastAPI(
    title="Snapshot Receiver Server",
    description="11채널 × 24fps 멀티스냅샷 큐 기반 수신·저장 서버",
    version="1.0.0",
    lifespan=lifespan,
)


# ── 요청 모델 ──
class CaptureStartRequest(BaseModel):
    """캡처 시작 요청"""
    recording_ids: list[str]            # 캡처 대상 녹화 ID 목록
    fps: Optional[int] = None           # 목표 FPS (None이면 config.default_fps)


class CaptureStopRequest(BaseModel):
    """캡처 중지 요청 (바디 없음, 별도 파라미터 불필요)"""
    pass


# ── API 엔드포인트 ──
@app.post("/capture/start")
async def start_capture(req: CaptureStartRequest):
    """
    캡처 시작 — 지정된 채널 목록에 대해 동기화 멀티스냅샷 반복 캡처 시작

    gRPC를 통해 VRM 서버에서 JPEG 바이너리를 수신하여 큐에 적재,
    별도 워커가 디스크에 저장
    """
    if not req.recording_ids:
        raise HTTPException(status_code=400, detail="recording_ids가 비어있습니다")

    if len(req.recording_ids) > config.max_channels:
        raise HTTPException(
            status_code=400,
            detail=f"최대 {config.max_channels}채널까지 지원합니다",
        )

    try:
        await receiver.start_capture(
            recording_ids=req.recording_ids,
            fps=req.fps,
        )
        session = receiver.session
        return {
            "success": True,
            "session_id": session.session_id,
            "channels": len(req.recording_ids),
            "fps": session.target_fps,
            "interval_ms": round(1000 / session.target_fps, 1),
        }
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/capture/stop")
async def stop_capture():
    """
    캡처 중지 — 현재 진행 중인 캡처 세션 종료

    큐에 남은 이미지는 저장 워커가 모두 처리한 후 종료
    """
    session = await receiver.stop_capture()
    if session is None:
        raise HTTPException(status_code=404, detail="진행 중인 캡처가 없습니다")

    return {
        "success": True,
        "session_id": session.session_id,
        "total_captured": session.total_captured,
        "total_dropped": session.total_dropped,
        "total_failed": session.total_failed,
        "total_groups": session.total_groups,
        "duration_sec": round(session.stopped_at - session.started_at, 1),
    }


@app.get("/capture/status")
async def get_capture_status():
    """
    캡처 상태 조회 — 현재 세션 정보 + 큐 상태 + 저장 워커 통계

    캡처가 진행 중이 아니어도 마지막 세션 정보와 워커 상태를 반환
    """
    session = receiver.session
    q_stats = queue_manager.get_stats()
    w_stats = writer.get_stats()

    session_info = None
    if session:
        session_info = {
            "session_id": session.session_id,
            "state": session.state.value,
            "recording_ids": session.recording_ids,
            "target_fps": session.target_fps,
            "total_captured": session.total_captured,
            "total_saved": session.total_saved,
            "total_dropped": session.total_dropped,
            "total_failed": session.total_failed,
            "total_groups": session.total_groups,
            "capture_rate": round(session.capture_rate, 1),
            "save_rate": round(session.save_rate, 1),
            "drop_rate_pct": round(session.drop_rate_pct, 1),
        }

    return {
        "session": session_info,
        "queue": {
            "current_size": q_stats.current_size,
            "max_size": q_stats.max_size,
            "usage_pct": round(q_stats.current_size / q_stats.max_size * 100, 1)
            if q_stats.max_size > 0
            else 0,
            "total_enqueued": q_stats.total_enqueued,
            "total_dequeued": q_stats.total_dequeued,
            "total_dropped": q_stats.total_dropped,
            "estimated_memory_mb": q_stats.estimated_memory_mb,
        },
        "writer": w_stats,
    }


@app.get("/capture/groups")
async def list_capture_groups():
    """
    카메라별 스냅샷 저장 현황 조회

    디렉토리 구조: data/{recording_id}/snapshot/{YYYYMMDD}/{HH}/
    """
    import os

    cameras = []
    base_path = config.storage_path

    if not os.path.exists(base_path):
        return {"cameras": [], "total": 0}

    # 카메라(recording_id) 디렉토리 순회
    for cam_dir in sorted(os.listdir(base_path)):
        snapshot_path = os.path.join(base_path, cam_dir, "snapshot")
        if not os.path.isdir(snapshot_path):
            continue

        total_images = 0
        total_size = 0
        dates = []

        # 날짜 디렉토리 순회
        for date_dir in sorted(os.listdir(snapshot_path), reverse=True):
            date_path = os.path.join(snapshot_path, date_dir)
            if not os.path.isdir(date_path):
                continue

            date_images = 0
            # 시간대 디렉토리 순회
            for hour_dir in sorted(os.listdir(date_path)):
                hour_path = os.path.join(date_path, hour_dir)
                if not os.path.isdir(hour_path):
                    continue
                files = [f for f in os.listdir(hour_path) if f.endswith(".jpg")]
                date_images += len(files)
                total_size += sum(
                    os.path.getsize(os.path.join(hour_path, f)) for f in files
                )

            total_images += date_images
            dates.append({"date": date_dir, "image_count": date_images})

        cameras.append({
            "recording_id": cam_dir,
            "total_images": total_images,
            "total_size_mb": round(total_size / (1024 * 1024), 1),
            "dates": dates[:30],  # 최근 30일까지만
        })

    return {"cameras": cameras, "total": len(cameras)}


@app.get("/capture/sync-frames")
async def get_sync_frames(date: str, hour: str, offset: int = 0, limit: int = 50):
    """
    동기화 프레임 목록 조회 — 특정 날짜/시간대의 타임스탬프별 그룹화된 프레임 반환

    같은 타임스탬프(±동기화 오차)를 가진 이미지들을 하나의 sync group으로 묶어
    채널 간 동기화 상태를 확인할 수 있게 함

    Args:
        date: 날짜 (YYYYMMDD)
        hour: 시간대 (00~23)
        offset: 페이지네이션 오프셋
        limit: 한 번에 반환할 sync group 수 (기본 50)
    """
    import os

    base_path = config.storage_path
    if not os.path.exists(base_path):
        return {"sync_groups": [], "total": 0, "cameras": []}

    # 카메라 목록 수집 + 해당 날짜/시간대의 파일 목록
    camera_files: dict[str, list[str]] = {}  # {recording_id: [filename, ...]}

    for cam_dir in sorted(os.listdir(base_path)):
        hour_path = os.path.join(base_path, cam_dir, "snapshot", date, hour)
        if not os.path.isdir(hour_path):
            continue
        files = sorted([f for f in os.listdir(hour_path) if f.endswith(".jpg")])
        if files:
            camera_files[cam_dir] = files

    if not camera_files:
        return {"sync_groups": [], "total": 0, "cameras": []}

    # 파일명 파싱: {timestamp_ms}_{diff_ms}ms.jpg → (ts_ms, diff_ms) 추출
    def parse_filename(fname: str) -> tuple[int, int]:
        """파일명에서 마스터 타임스탬프와 diff를 추출"""
        stem = fname.replace(".jpg", "")  # "1710561234567_6ms"
        parts = stem.rsplit("_", 1)       # ["1710561234567", "6ms"]
        ts_ms = int(parts[0])
        diff_ms = int(parts[1].replace("ms", "")) if len(parts) > 1 else 0
        return ts_ms, diff_ms

    # 타임스탬프별 그룹화 — 같은 마스터 타임스탬프끼리 묶음
    # {ts_ms: {cam_id: (filename, diff_ms)}}
    all_timestamps: dict[int, dict[str, tuple[str, int]]] = {}

    for cam_id, files in camera_files.items():
        for fname in files:
            ts_ms, diff_ms = parse_filename(fname)
            if ts_ms not in all_timestamps:
                all_timestamps[ts_ms] = {}
            all_timestamps[ts_ms][cam_id] = (fname, diff_ms)

    # 타임스탬프 정렬
    sorted_timestamps = sorted(all_timestamps.keys())
    total = len(sorted_timestamps)

    # 페이지네이션 적용
    page_timestamps = sorted_timestamps[offset : offset + limit]

    from datetime import datetime

    cameras = sorted(camera_files.keys())
    sync_groups = []
    for ts_ms in page_timestamps:
        group_cameras = all_timestamps[ts_ms]

        # 각 카메라의 diff 절대값 중 최대치
        diffs = [abs(d) for _, d in group_cameras.values()]
        max_diff_ms = max(diffs) if diffs else 0

        frame_time = datetime.fromtimestamp(ts_ms / 1000)

        sync_groups.append({
            "timestamp_ms": ts_ms,
            "display_time": frame_time.strftime("%H:%M:%S") + f".{ts_ms % 1000:03d}",
            "camera_count": len(group_cameras),
            "total_cameras": len(cameras),
            "max_diff_ms": max_diff_ms,
            "cameras": {
                cam_id: {
                    "filename": fname,
                    "diff_ms": diff_ms,
                }
                for cam_id, (fname, diff_ms) in group_cameras.items()
            },
        })

    return {
        "sync_groups": sync_groups,
        "total": total,
        "cameras": cameras,
        "date": date,
        "hour": hour,
    }


@app.get("/capture/image/{recording_id}/{date}/{hour}/{filename}")
async def serve_snapshot_image(recording_id: str, date: str, hour: str, filename: str):
    """
    저장된 스냅샷 이미지 파일 서빙

    경로: data/{recording_id}/snapshot/{date}/{hour}/{filename}
    """
    import os

    filepath = os.path.join(
        config.storage_path, recording_id, "snapshot", date, hour, filename
    )

    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="이미지 파일을 찾을 수 없습니다")

    return FileResponse(filepath, media_type="image/jpeg")


@app.get("/capture/dates")
async def list_available_dates():
    """
    저장된 스냅샷의 날짜 및 시간대 목록 조회

    카메라별로 어떤 날짜/시간대에 스냅샷이 존재하는지 반환
    """
    import os

    base_path = config.storage_path
    if not os.path.exists(base_path):
        return {"dates": {}}

    # {date: [hours]} 형태로 수집 (모든 카메라 통합)
    date_hours: dict[str, set[str]] = {}

    for cam_dir in os.listdir(base_path):
        snapshot_path = os.path.join(base_path, cam_dir, "snapshot")
        if not os.path.isdir(snapshot_path):
            continue
        for date_dir in os.listdir(snapshot_path):
            date_path = os.path.join(snapshot_path, date_dir)
            if not os.path.isdir(date_path):
                continue
            if date_dir not in date_hours:
                date_hours[date_dir] = set()
            for hour_dir in os.listdir(date_path):
                if os.path.isdir(os.path.join(date_path, hour_dir)):
                    date_hours[date_dir].add(hour_dir)

    # set → sorted list 변환
    result = {
        date: sorted(list(hours))
        for date, hours in sorted(date_hours.items(), reverse=True)
    }

    return {"dates": result}


@app.get("/health")
async def health_check():
    """서버 헬스 체크"""
    return {
        "status": "ok",
        "grpc_address": config.grpc_address,
        "storage_path": config.storage_path,
    }


# ── 직접 실행 지원 ──
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "snapshot_receiver.main:app",
        host=config.api_host,
        port=config.api_port,
        log_level="info",
    )
