/**
 * 녹화(Recording) 관련 공유 타입 정의
 * 전체 페이지에서 사용되는 Recording 객체 및 관련 인터페이스 통합 관리
 */

/* ────────────────── 녹화 상태 열거 ────────────────── */

/** 녹화 상태 문자열 리터럴 (서버 응답 기준) */
export type RecordingState =
  | "PENDING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "ERROR"
  | "UNKNOWN";

/** 녹화 모드 */
export type RecordingMode = "CONTINUOUS" | "EVENT";

/** 인코딩 코덱 */
export type EncodingCodec = "H264" | "H265";

/* ────────────────── 지터 통계 ────────────────── */

/** 녹화 스트림 지터 정보 (jitter 필드) */
export interface JitterInfo {
  /** 최근 측정 FPS */
  recent_fps: number;
  /** 스트림 정상 여부 */
  healthy: boolean;
}

/* ────────────────── 녹화 메인 인터페이스 ────────────────── */

/** 녹화 객체 — 서버 /recordings API 응답 항목 */
export interface Recording {
  /** 녹화 고유 식별자 */
  recording_id: string;
  /** 녹화 상태 (문자열 또는 숫자 enum 값) */
  state: RecordingState | number;
  /** HQ RTSP 스트림 URL */
  rtsp_url_hq?: string;
  /** SQ RTSP 스트림 URL */
  rtsp_url_sq?: string;
  /** 녹화 모드 */
  recording_mode?: RecordingMode | string;
  /** NTP 동기화 여부 */
  ntp_synced?: boolean;
  /** 녹화 시작 시각 (ISO 8601 또는 epoch) */
  start_time?: string;
  /** 녹화 생성 시각 */
  created_at?: string;
  /** 비고/메모 */
  notes?: string;
  /** HQ 스토리지 제한 (MB) */
  hq_storage_limit_mbs?: number;
  /** SQ 스토리지 제한 (MB) */
  sq_storage_limit_mbs?: number;
  /** 스트림 지터 통계 (선택적) */
  jitter?: JitterInfo;
}

/* ────────────────── 스냅샷 관련 타입 ────────────────── */

/** 단일 스냅샷 타임스탬프 */
export interface SnapshotTimestamp {
  seconds: string;
  nanos: string;
}

/** 개별 녹화 채널의 스냅샷 데이터 (멀티 스냅샷 응답 내부 항목) */
export interface SnapshotEntry {
  /** 실제 캡처 시각 */
  actual_timestamp: SnapshotTimestamp;
  /** base64 인코딩 이미지 데이터 */
  image_data: string;
  /** PTS 동기화 여부 */
  is_pts_synced?: boolean;
  /** 자동 동기화 보정 오프셋 (ms) */
  auto_sync_offset_ms?: number;
}

/** 멀티 스냅샷 결과 — recordingId를 키로 하는 스냅샷 맵 */
export interface SnapshotResult {
  [recordingId: string]: SnapshotEntry;
}

/** 멀티 스냅샷 캡처 히스토리 항목 (MultiSnapshotPage용) */
export interface HistoryItem {
  /** 시점 식별 키 (seconds.nanos) */
  timeKey: string;
  /** 화면 표시용 시각 문자열 */
  displayTime: string;
  /** 캡처된 카메라 수 */
  camCount: number;
  /** 스냅샷 데이터 맵 */
  data: SnapshotResult;
  /** 마스터 카메라 ID */
  masterId?: string;
  /** 동기화 경고 메시지 목록 */
  syncWarnings?: string[];
}

/* ────────────────── 동기화 뷰어 관련 타입 (SyncViewerPage) ────────────────── */

/** 개별 카메라 프레임 정보 */
export interface CameraFrame {
  /** 저장된 이미지 파일명 */
  filename: string;
  /** 기준 타임스탬프 대비 오차 (ms) */
  diff_ms: number;
}

/** 동기화 그룹 — 같은 시점에 촬영된 멀티카메라 프레임 묶음 */
export interface SyncGroup {
  /** 타임스탬프 (밀리초) */
  timestamp_ms: number;
  /** 화면 표시용 시각 문자열 */
  display_time: string;
  /** 해당 시점에 캡처된 카메라 수 */
  camera_count: number;
  /** 전체 등록 카메라 수 */
  total_cameras: number;
  /** 최대 동기화 오차 (ms) */
  max_diff_ms: number;
  /** 카메라별 프레임 데이터 (recordingId → CameraFrame) */
  cameras: Record<string, CameraFrame>;
}

/** 동기화 상태 배지 정보 */
export interface SyncBadge {
  /** 배지 라벨 (PERFECT / GOOD / WARN / BAD) */
  label: string;
  /** TailwindCSS 색상 클래스 */
  color: string;
}
