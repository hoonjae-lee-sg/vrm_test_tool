import apiClient from "./client";

/**
 * 이벤트 피드 API 호출 모듈
 * 백엔드 `/api/events/recent` (gRPC Events.GetRecentEvents 프록시) 래퍼.
 *
 * Tester 에서의 용도:
 *   RecordStart 의 HQ 쿼터 검증이 비동기(백그라운드 RTSP 탐색)로 바뀌면서
 *   "쿼터 부족" 은 Start 응답이 아니라 사후 DISK_THRESHOLD/WARN 이벤트로만 통보됨
 *   (src/grpc/recorder_service.cc — meta.reason = "quota_insufficient_for_bitrate").
 *   Start 직후 이 API 를 짧게 폴링해 경고를 UI 로 끌어올림.
 */

/** 이벤트 심각도 — 백엔드 _SEV_NAME 매핑 값 */
export type EventSeverity = "info" | "warn" | "error";

/** 이벤트 항목 — backend/routers/events.py `_pb_to_dict` 형식 */
export interface FeedEvent {
  /** 이벤트 시퀀스 ID */
  id: number | string;
  /** 발생 시각 (ISO8601, 미설정 시 null) */
  ts: string | null;
  /** 대상 녹화 ID */
  recording_id: string;
  /** 이벤트 종류 (STREAM_LOST / DISK_THRESHOLD / ...) */
  type: string;
  /** 심각도 */
  severity: EventSeverity;
  /** 사람이 읽는 메시지 */
  message: string;
  /** 부가 메타데이터 — DISK_THRESHOLD 의 경우 reason/configured_mb/recommended_mb 등 */
  meta: Record<string, unknown>;
}

/** `/api/events/recent` 응답 래퍼 */
export interface RecentEventsResp {
  events: FeedEvent[];
  total?: number;
}

/** 최근 이벤트 조회
 *  @param recordingId 특정 녹화만 필터 (미지정 시 전체)
 *  @param severity    콤마 조인용 배열 — 미지정 시 서버 기본(전체)
 *  @param sinceIso    이 시각 이후 발생분만 — Start 이전 과거 경고 오탐 방지용
 */
export async function fetchRecentEvents(opts: {
  limit?: number;
  recordingId?: string;
  severity?: EventSeverity[];
  sinceIso?: string;
}): Promise<FeedEvent[]> {
  const res = await apiClient.get<RecentEventsResp | FeedEvent[]>("/events/recent", {
    params: {
      limit: opts.limit ?? 20,
      recording_id: opts.recordingId,
      severity: opts.severity?.join(","),
      since: opts.sinceIso,
    },
  });
  /* 실측 응답은 {events: [...], total: N} 래퍼 형태임(2026-09 서버 확인).
     구버전/변형이 배열을 그대로 줄 가능성에도 대비해 양쪽을 모두 수용하고,
     그 외에는 빈 배열로 정규화해 소비 측 map() 이 깨지지 않게 함. */
  if (Array.isArray(res.data)) return res.data;
  const events = (res.data as RecentEventsResp | undefined)?.events;
  return Array.isArray(events) ? events : [];
}

/* ────────────────── SSE (실시간 이벤트 푸시) ────────────────── */

/**
 * `/api/events/stream` 구독 URL 조립.
 *
 * axios(apiClient) 를 쓰지 않는 이유: SSE 는 브라우저 기본 `EventSource` 로 열어야
 * 자동 재연결(retry) 과 `Last-Event-ID` 처리를 무료로 얻음. EventSource 는 절대/상대
 * 경로 문자열만 받으므로 apiClient 의 baseURL("/api") 을 여기서 직접 붙임.
 *
 * 서버(backend/routers/events.py stream_events)는 `event: message` 로 프레임을 보내므로
 * 소비 측은 `onmessage` 로 받으면 됨. 15초 주기 `: ping` 주석 프레임은 EventSource 가
 * 조용히 버리며, 이 하트비트가 중간 프록시의 유휴 타임아웃 절단을 막아 줌.
 *
 * @param recordingId 특정 녹화만 — 미지정 시 전체
 * @param severity    심각도 필터 — 미지정/빈 배열이면 전체
 */
export function buildEventStreamUrl(opts: {
  recordingId?: string;
  severity?: EventSeverity[];
}): string {
  const qs = new URLSearchParams();
  if (opts.recordingId) qs.set("recording_id", opts.recordingId);
  if (opts.severity && opts.severity.length > 0) qs.set("severity", opts.severity.join(","));
  const q = qs.toString();
  return `/api/events/stream${q ? `?${q}` : ""}`;
}

/**
 * 서버가 돌려주는 클립 경로를 브라우저에서 열 수 있는 URL 로 변환.
 *
 * [실측 형태] StopEventClip 응답의 clip_path 는 **서버 파일시스템 경로** 임:
 *   "./data/101/events/1788405303/clip.mp4"
 * (recorder.cpp flush_event_clip → `{data_path}/{rid}/events/{epoch}/clip.mp4`,
 *  data_path 기본값은 options.h 의 "./data")
 *
 * VRM 은 `GET /data/*` 로 data_path 하위를 서빙하므로(recording_controller.hpp ServeData),
 * data 루트 이후 구간만 잘라 `/data/...` 로 다시 붙임. `--data-path` 를 절대경로로 띄운
 * 배포에서도 동작하도록 "마지막 /data/ 이후" 가 아니라 "경로 안의 data 컴포넌트 이후"를
 * 기준으로 자름. 대응되지 않는 형태면 null 을 반환해 호출 측이 링크를 감추게 함.
 */
export function clipPathToUrl(clipPath: string | undefined | null): string | null {
  if (!clipPath) return null;
  /* 윈도우 구분자 방어 + "./" 접두 제거 */
  const norm = clipPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = norm.split("/").filter((p) => p.length > 0 && p !== ".");
  const dataIdx = parts.lastIndexOf("data");
  /* data 컴포넌트가 없거나 그 뒤가 비면 서빙 URL 을 만들 수 없음 */
  if (dataIdx < 0 || dataIdx === parts.length - 1) return null;
  return `/data/${parts.slice(dataIdx + 1).map(encodeURIComponent).join("/")}`;
}
