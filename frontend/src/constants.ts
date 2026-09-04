/**
 * 프론트엔드 공유 상수 정의
 * 매직 넘버 및 하드코딩 값 중앙 관리
 */

/* ────────────────── 네트워크/포트 ────────────────── */

/** VRM 서버 REST/WebSocket 포트 (기본값) */
export const VRM_API_PORT = 18071;

/** Snapshot Receiver 서버 포트 */
export const SNAPSHOT_RECEIVER_PORT = 8200;

/** API 클라이언트 타임아웃 (ms) — apiClient 기본값 */
export const API_TIMEOUT_MS = 30000;

/** Snapshot Receiver 클라이언트 타임아웃 (ms) */
export const RECEIVER_TIMEOUT_MS = 10000;

/* ────────────────── 자동 갱신 주기 ────────────────── */

/** Dashboard 녹화 목록 갱신 주기 (ms) */
export const DASHBOARD_REFRESH_INTERVAL_MS = 3000;

/** TesterPage / MultiSnapshotPage 녹화 목록 갱신 주기 (ms) */
export const DEFAULT_REFRESH_INTERVAL_MS = 3000;

/** LivePage 녹화 목록 갱신 주기 (ms) */
export const LIVE_REFRESH_INTERVAL_MS = 5000;

/** TesterPage 녹화 목록 갱신 주기 (ms) */
export const TESTER_REFRESH_INTERVAL_MS = 5000;

/** Snapshot Receiver 상태 폴링 주기 (ms) */
export const RECEIVER_STATUS_POLL_INTERVAL_MS = 1000;

/* ────────────────── 비디오 해상도 ────────────────── */

/** 원본 영상 가로 해상도 (바운딩 박스 좌표 기준) */
export const SOURCE_VIDEO_WIDTH = 3840;

/** 원본 영상 세로 해상도 (바운딩 박스 좌표 기준) */
export const SOURCE_VIDEO_HEIGHT = 2160;

/* ────────────────── mpegts.js 버퍼 설정 ────────────────── */

/** mpegts.js stash 초기 버퍼 크기 (바이트) */
export const MPEGTS_STASH_INITIAL_SIZE = 128;

/** Dashboard용 라이브 버퍼 최대 지연 (초) */
export const DASHBOARD_LIVE_BUFFER_MAX_LATENCY = 3.0;

/** LivePage용 라이브 버퍼 최대 지연 (초) */
export const LIVE_BUFFER_MAX_LATENCY = 5.0;

/** 라이브 버퍼 최소 잔여량 (초) */
export const LIVE_BUFFER_MIN_REMAIN = 0.5;

/* ────────────────── 메타데이터/오버레이 ────────────────── */

/** ID3 메타데이터 큐 최대 크기 */
export const METADATA_QUEUE_MAX_SIZE = 200;

/** 바운딩 박스 홀드 유지 시간 (초) — 객체 사라진 후 표시 유지 */
export const BBOX_HOLD_DURATION_SEC = 0.5;

/** 메타데이터 큐 오래된 항목 정리 기준 (초) — targetPts 이전 */
export const METADATA_CLEANUP_THRESHOLD_SEC = 10;

/* ────────────────── 라이브 그리드 ────────────────── */

/** LivePage 최대 동시 스트림 수 */
export const MAX_LIVE_STREAMS = 9;

/* ────────────────── Playlist (HLS 재생) ────────────────── */

/** Playlist 그리드 채널 수 */
export const PLAYLIST_NUM_CHANNELS = 9;

/** 타임바 캔버스 너비 (px) */
export const TIMEBAR_CANVAS_WIDTH = 260;

/* ────────────────── Multi Snapshot ────────────────── */

/** 멀티 스냅샷 히스토리 최대 보관 수 */
export const MAX_SNAPSHOT_HISTORY = 100;

/** 캡처 인터벌 기본 FPS (jitter 정보 없을 때) */
export const DEFAULT_CAPTURE_FPS = 15;

/** 캡처 인터벌 상한 FPS */
export const MAX_CAPTURE_FPS = 30;

/** 캡처 인터벌 최소값 (ms) — 20fps 상한 */
export const MIN_CAPTURE_INTERVAL_MS = 50;

/** 캡처 인터벌 최대값 (ms) — 0.5fps 하한 */
export const MAX_CAPTURE_INTERVAL_MS = 2000;

/* ────────────────── Sync Viewer ────────────────── */

/** Sync Viewer 페이지네이션 페이지 크기 */
export const SYNC_VIEWER_PAGE_LIMIT = 50;

/** 동기화 오차 기준값 (ms) — PERFECT */
export const SYNC_THRESHOLD_PERFECT_MS = 10;

/** 동기화 오차 기준값 (ms) — GOOD */
export const SYNC_THRESHOLD_GOOD_MS = 30;

/** 동기화 오차 기준값 (ms) — WARN */
export const SYNC_THRESHOLD_WARN_MS = 100;

/* ────────────────── 녹화 기본값 ────────────────── */

/** 녹화 보관 기간 기본값 (일) */
export const DEFAULT_RETENTION_DAYS = 7;

/* ────────────────── Event Clip (이벤트 클립) ──────────────────
 * 값의 출처는 서버 상수임 — src/media/recording/recorder.cpp 상단
 * (kClipBufferMaxFrames / kClipBufferMaxBytes / kEventClipMaxDurationSec).
 * UI 는 이 값을 "안내와 경고"에만 사용하고 강제하지 않음. 실제 회수 주체는
 * 서버 감독 루프의 check_event_clip_watchdog 임. */

/** 이벤트 클립 최대 지속시간 (초) — 초과 시 서버가 force_stop_event_clip 으로 강제 회수 */
export const EVENT_CLIP_MAX_DURATION_SEC = 600;

/** 이벤트 클립 버퍼 프레임 수 상한 — 30fps × 600초 기준 */
export const EVENT_CLIP_MAX_FRAMES = 18000;

/** 이벤트 클립 버퍼 바이트 상한 (MB) */
export const EVENT_CLIP_MAX_BYTES_MB = 512;

/** 경과 시간이 상한의 이 비율을 넘으면 UI 경고 전환 */
export const EVENT_CLIP_WARN_RATIO = 0.8;

/** 이벤트 피드에 유지할 최대 항목 수 — 장시간 구독 시 메모리 무한 증가 방지 */
export const EVENT_FEED_MAX_ITEMS = 300;

/** 페이지 진입 시 미리 불러올 최근 이벤트 개수 (서버 상한 100) */
export const EVENT_FEED_PRELOAD_LIMIT = 50;

/** EventClipPage 녹화 목록 갱신 주기 (ms) */
export const EVENT_CLIP_REFRESH_INTERVAL_MS = 5000;
