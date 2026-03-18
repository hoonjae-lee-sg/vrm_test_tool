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

/** 녹화 목록 조회 — Recording[] 타입 반환 */
export async function fetchRecordings(): Promise<Recording[]> {
  const res = await apiClient.get<Recording[]>("/recordings");
  return res.data;
}

/** 녹화 시작 */
export async function startRecording(params: StartRecordingParams) {
  const res = await apiClient.post("/start", params);
  return res.data;
}

/** 녹화 중지 */
export async function stopRecording(recordingId: string) {
  const res = await apiClient.post("/stop", { recording_id: recordingId });
  return res.data;
}

/** 녹화 상태 조회 */
export async function getRecordingStatus(recordingId: string) {
  const res = await apiClient.get(`/recordings/${recordingId}/status`);
  return res.data;
}

/** 스냅샷 촬영 */
export async function takeSnapshot(
  recordingId: string,
  seconds?: number,
  nanos?: number
) {
  const res = await apiClient.post("/snapshot", {
    recording_id: recordingId,
    seconds,
    nanos,
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
  const res = await apiClient.post("/clip/event/start", {
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
  const res = await apiClient.post("/clip/event/stop", {
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
  const res = await apiClient.post("/clip/simple", {
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
  const res = await apiClient.get(`/health/${recordingId}`, {
    params: { auth_token: authToken },
  });
  return res.data;
}
