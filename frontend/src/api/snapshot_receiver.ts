import axios from "axios";

/**
 * Snapshot Receiver Server API 클라이언트
 * 큐 기반 멀티스냅샷 수신·저장 서버 (포트 8200) 제어용
 * Vite 프록시: /capture → http://localhost:8200/capture
 */
const receiverClient = axios.create({
  baseURL: "/capture",
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

/** 캡처 시작 요청 */
export async function startReceiverCapture(
  recordingIds: string[],
  fps?: number
) {
  const res = await receiverClient.post("/start", {
    recording_ids: recordingIds,
    fps,
  });
  return res.data;
}

/** 캡처 중지 요청 */
export async function stopReceiverCapture() {
  const res = await receiverClient.post("/stop");
  return res.data;
}

/** 캡처 상태 조회 */
export async function getReceiverStatus() {
  const res = await receiverClient.get("/status");
  return res.data;
}

/** 캡처 그룹 목록 조회 */
export async function getReceiverGroups() {
  const res = await receiverClient.get("/groups");
  return res.data;
}

/** 저장된 날짜/시간대 목록 조회 */
export async function getAvailableDates() {
  const res = await receiverClient.get("/dates");
  return res.data;
}

/** 동기화 프레임 목록 조회 */
export async function getSyncFrames(
  date: string,
  hour: string,
  offset: number = 0,
  limit: number = 50
) {
  const res = await receiverClient.get("/sync-frames", {
    params: { date, hour, offset, limit },
  });
  return res.data;
}

/** 스냅샷 이미지 URL 생성 (직접 <img src>에 사용) */
export function getSnapshotImageUrl(
  recordingId: string,
  date: string,
  hour: string,
  filename: string
): string {
  return `/capture/image/${recordingId}/${date}/${hour}/${filename}`;
}
