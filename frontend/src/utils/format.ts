/**
 * 숫자/시간 포맷팅 유틸리티
 */

/** 숫자 천 단위 콤마 포맷 */
export function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

/** 바이트 → 사람 읽기 쉬운 단위 변환 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 밀리초 → 읽기 쉬운 시간 문자열 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** 밀리초 → ±부호 포함 포맷 (동기화 오차 표시용) */
export function formatOffsetMs(ms: number): string {
  const sign = ms >= 0 ? "+" : "";
  return `${sign}${Math.round(ms)}ms`;
}
