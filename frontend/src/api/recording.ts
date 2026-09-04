import apiClient from "./client";
import type { Recording } from "@/types/recording";

/**
 * 녹화 관련 API 호출 모듈
 */

/** 녹화 시작 요청 파라미터 */
export interface StartRecordingParams {
  serial_number?: string;
  hq_url: string;
  sq_url: string;
  rtsp_hq_username?: string;
  rtsp_hq_password?: string;
  rtsp_sq_username?: string;
  rtsp_sq_password?: string;
  hq_storage_limit_mbs?: number;
  sq_storage_limit_mbs?: number;
  retention_days?: number;
  recording_mode?: string;
  encoding_codec?: string;
  auth_token?: string;
  notes?: string;
}

/* ────────────────── 응답 타입 ────────────────── */
/* 백엔드는 protobuf → MessageToDict(preserving_proto_field_name=True) 결과를 그대로
   내려주므로 oneof 는 "설정된 쪽 키만" 존재함. 따라서 전 필드를 optional 로 선언하고
   소비 측에서 존재 여부로 분기함. */

/** RtspUrl 메시지 — 목록/상태 응답에서 객체 형태로 내려옴 (문자열 아님) */
export interface RtspUrlValue {
  raw?: string;
  scheme?: string;
  username?: string;
  password?: string;
  host?: string;
  port?: number;
  uri?: string;
}

/** RecordingStatus 메시지 (Start/Restart/GetStatus 공통 페이로드) */
export interface RecordingStatusResp {
  recording_id?: string;
  state?: string;
  created_at?: string;
  start_time?: string;
  end_time?: string;
  rtsp_url_hq?: RtspUrlValue;
  rtsp_url_sq?: RtspUrlValue;
  storage_used_mbs?: number;
  frames_received?: number | string;
  hq_storage_limit_mbs?: number;
  sq_storage_limit_mbs?: number;
  retention_days?: number;
  recording_mode?: string;
  notes?: string;
  jitter?: JitterStatsResp;
}

/** JitterStats 메시지 */
export interface JitterStatsResp {
  recent_fps?: number;
  mean_interarrival_ms?: number;
  jitter_ms_p50?: number;
  jitter_ms_p95?: number;
  last_frame_at?: string;
  healthy?: boolean;
  drift_ms?: number;
  ntp_synced?: boolean;
}

/** RecordStartResp — oneof { created | error } */
export interface StartRecordingResp {
  created?: { status?: RecordingStatusResp };
  error?: { code?: string; message?: string };
}

/** RecordStopResp — oneof { accepted | error } */
export interface StopRecordingResp {
  accepted?: { status?: RecordingStatusResp };
  error?: { code?: string; message?: string };
}

/** RecordRestartResp — oneof { status | error }.
 *  백엔드가 `proto_to_dict(RecordRestartResp)` 를 그대로 내려주므로 Stop 과 달리
 *  래퍼 키가 `accepted` 가 아니라 `status` 임. */
export interface RestartRecordingResp {
  status?: RecordingStatusResp;
  error?: { code?: string; message?: string };
}

/** GetRecordingHealthyResp 의 status 페이로드 (백엔드가 oneof 를 그대로 전달) */
export interface HealthResp {
  status?: { healthy?: boolean; jitter?: JitterStatsResp };
  error?: { code?: string; message?: string };
  /* 서버 버전에 따라 평탄화되어 오는 경우 대비 */
  healthy?: boolean;
  jitter?: JitterStatsResp;
}

/** SimpleClipResp — oneof { success | error } */
export interface SimpleClipResp {
  success?: {
    recording_id?: string;
    clip_id?: string;
    file_path?: string;
    requested_ts?: string;
    clip_start_ts?: string;
    clip_end_ts?: string;
    clip_length_ms?: number;
  };
  error?: { code?: string; message?: string };
}

/** StopEventClipResp */
export interface StopEventClipResp {
  recording_id?: string;
  clip_id?: string;
  clip_path?: string;
}

/** 단일 스냅샷 응답 — backend/routers/snapshot.py `_build_snapshot_result` 형식.
 *  주의: gRPC SnapshotRespFile 의 `path` 는 백엔드가 내려주지 않음. 이미지 본문은
 *  `image_data` 에 data:image/jpeg;base64,... 형태로 인라인됨. */
export interface SnapshotResp {
  image_data: string;
  actual_timestamp: { seconds: number | string; nanos: number | string };
  is_pts_synced?: boolean;
  auto_sync_offset_ms?: number;
  /** 하위호환 슬롯 — gRPC SnapshotRespFile.path 에 해당하지만 현재 FastAPI 프록시는
   *  이 키를 내려주지 않으므로 **항상 undefined** 임. DashboardPage 등 기존 소비자가
   *  `res.file?.path` 를 참조하고 있어 컴파일 호환을 위해 optional 로 남겨 둠.
   *  새 코드는 image_data(data URI)를 사용할 것. */
  file?: { path?: string };
}

/** 프레임 선택 전략 — snapshot.proto FrameSelectionStrategies 열거값 */
export const FRAME_SELECTION_STRATEGIES = [
  { value: "", label: "기본 (NEAREST_KEYFRAME)" },
  { value: "1", label: "NEAREST_KEYFRAME" },
  { value: "2", label: "PREVIOUS_KEYFRAME" },
  { value: "3", label: "NEXT_KEYFRAME" },
  { value: "4", label: "PRECISE" },
] as const;

/* ────────────────── 호출 함수 ────────────────── */

/** 녹화 목록 조회 — Recording[] 타입 반환 */
export async function fetchRecordings(): Promise<Recording[]> {
  const res = await apiClient.get<Recording[]>("/recordings");
  return res.data;
}

/** 녹화 시작 */
export async function startRecording(params: StartRecordingParams) {
  const res = await apiClient.post<StartRecordingResp>("/start", params);
  return res.data;
}

/** 녹화 중지 — auth_token 은 백엔드 RecordStopRequest 가 그대로 받아 gRPC 로 전달함 */
export async function stopRecording(recordingId: string, authToken?: string) {
  const res = await apiClient.post<StopRecordingResp>("/stop", {
    recording_id: recordingId,
    auth_token: authToken,
  });
  return res.data;
}

/** 녹화 재시작 — STOPPED/ERROR 상태의 녹화를 동일 설정으로 재시작 */
export async function restartRecording(recordingId: string, authToken?: string) {
  const res = await apiClient.post<RestartRecordingResp>("/restart", {
    recording_id: recordingId,
    auth_token: authToken,
  });
  return res.data;
}

/** 녹화 상태 조회 */
export async function getRecordingStatus(recordingId: string) {
  const res = await apiClient.get<RecordingStatusResp>(
    `/recordings/${encodeURIComponent(recordingId)}/status`
  );
  return res.data;
}

/** 스냅샷 촬영
 *  @param strategy    FrameSelectionStrategies 열거값 (미지정 시 서버 기본 NEAREST_KEYFRAME)
 *  @param maxOffsetMs 요청 시각에서 허용할 최대 오차 (미지정 시 서버 기본 2000ms)
 */
export async function takeSnapshot(
  recordingId: string,
  seconds?: number,
  nanos?: number,
  strategy?: number,
  maxOffsetMs?: number
) {
  const res = await apiClient.post<SnapshotResp>("/snapshot", {
    recording_id: recordingId,
    seconds,
    nanos,
    strategy,
    max_offset_ms: maxOffsetMs,
  });
  return res.data;
}

/** 멀티 동기화 스냅샷 응답 타입 */
export interface BulkSnapshotResponse {
  snapshots: {
    [recordingId: string]: {
      actual_timestamp: { seconds: string; nanos: string };
      image_data: string;
      is_pts_synced?: boolean;
      auto_sync_offset_ms?: number;
    };
  };
  master_id: string;
  sync_warnings?: string[];
}

/** 멀티 동기화 스냅샷
 * 반환 형식: 새 형식 BulkSnapshotResponse 또는 구 형식 flat dict
 * 프론트엔드에서 양쪽 모두 처리
 */
export async function takeBulkSnapshot(
  recordingIds: string[],
  masterId?: string
) {
  const res = await apiClient.post("/bulk-snapshot", {
    recording_ids: recordingIds,
    master_id: masterId,
  });
  return res.data;
}

/** 이벤트 클립 시작 */
export async function startEventClip(
  recordingId: string,
  authToken?: string
) {
  const res = await apiClient.post<Record<string, never>>("/clip/event/start", {
    recording_id: recordingId,
    auth_token: authToken,
  });
  return res.data;
}

/** 이벤트 클립 중지 */
export async function stopEventClip(
  recordingId: string,
  authToken?: string
) {
  const res = await apiClient.post<StopEventClipResp>("/clip/event/stop", {
    recording_id: recordingId,
    auth_token: authToken,
  });
  return res.data;
}

/** 심플 클립 생성 */
export async function createSimpleClip(
  recordingId: string,
  seconds: number,
  nanos: number
) {
  const res = await apiClient.post<SimpleClipResp>("/clip/simple", {
    recording_id: recordingId,
    seconds,
    nanos,
  });
  return res.data;
}

/** 헬스 체크 */
export async function getRecordingHealth(
  recordingId: string,
  authToken?: string
) {
  const res = await apiClient.get<HealthResp>(
    `/health/${encodeURIComponent(recordingId)}`,
    { params: { auth_token: authToken } }
  );
  return res.data;
}
