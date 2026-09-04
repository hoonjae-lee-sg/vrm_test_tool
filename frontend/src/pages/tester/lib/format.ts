/**
 * Tester 표시용 포맷 유틸
 * 응답에 섞여 오는 protobuf 표현(RFC3339 문자열, uint64 문자열, RtspUrl 객체)을
 * 화면에 바로 쓸 수 있는 문자열로 바꾸는 얇은 변환 모음.
 */
import type { RtspUrlValue } from "@/api/recording";

/** RFC3339 문자열(google.protobuf.Timestamp 의 MessageToDict 표현) → 로컬 시각 */
export function fmtIsoTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { hour12: false });
}

/** epoch 초 → 로컬 시각 (스냅샷/클립 타임스탬프) */
export function fmtEpochSeconds(seconds?: number | string | null): string {
  if (seconds === null || seconds === undefined || seconds === "") return "—";
  const n = typeof seconds === "string" ? Number(seconds) : seconds;
  if (!Number.isFinite(n)) return String(seconds);
  return new Date(n * 1000).toLocaleString("ko-KR", { hour12: false });
}

/** proto3 uint64/int64 는 JSON 에서 문자열로 오기도 함 — 숫자로 정규화 후 천단위 구분 */
export function fmtCount(value?: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("ko-KR");
}

/** 소수점 고정 표기 — 값이 없으면 대시 */
export function fmtFixed(value?: number | null, digits = 1, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

/** MB 단위 표기 — 0 은 "무제한" 이라는 서버 의미를 그대로 노출 */
export function fmtQuotaMbs(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  return value === 0 ? "0 (무제한)" : `${value.toLocaleString("ko-KR")} MB`;
}

/** RtspUrl 메시지 → 표시용 문자열.
 *  목록/상태 응답의 rtsp_url_hq 는 문자열이 아니라 {raw, host, uri, ...} 객체임. */
export function rtspRaw(url?: RtspUrlValue | string | null): string {
  if (!url) return "";
  if (typeof url === "string") return url;
  if (url.raw) return url.raw;
  /* raw 가 비어 있으면 파싱된 조각으로 재조립 */
  if (url.host) {
    const port = url.port ? `:${url.port}` : "";
    return `${url.scheme ?? "rtsp"}://${url.host}${port}${url.uri ?? ""}`;
  }
  return "";
}

/**
 * 권장 HQ 쿼터(MB) 계산 — 서버 `calculate_recommended_quota_mbs` 와 동일 식.
 *   bitrate(bps) × days × 24h × 3600s / 8 / 1024 / 1024
 * Start 폼에서 "얼마를 넣어야 하는지" 를 서버 왕복 없이 미리 보여주기 위함.
 */
export function recommendedQuotaMbs(retentionDays: number, bitrateBps: number): number {
  if (!Number.isFinite(retentionDays) || !Number.isFinite(bitrateBps)) return 0;
  if (retentionDays <= 0 || bitrateBps <= 0) return 0;
  return Math.ceil((bitrateBps * retentionDays * 24 * 3600) / 8 / 1024 / 1024);
}
