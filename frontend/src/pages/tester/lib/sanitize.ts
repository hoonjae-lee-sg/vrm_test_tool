/**
 * 로그 표시용 페이로드 축약 유틸
 *
 * [왜 필요한가]
 * `/api/snapshot` 응답의 `image_data` 는 `data:image/jpeg;base64,...` 형태로 한 장에
 * 수백 KB~수 MB 의 문자열임. 이를 그대로 JSON.stringify 해서 로그 패널에 넣으면
 * DOM 텍스트 노드가 폭증해 페이지가 사실상 멈춤(기존 SnapshotPanel 의 실제 증상).
 * 그래서 로그에 넣기 전에 "긴 문자열"과 "긴 배열"을 요약 토큰으로 치환함.
 * 원본 응답 객체 자체는 건드리지 않고 새 구조를 만들어 반환함(불변 유지).
 */

/** 이 길이를 넘는 문자열은 축약 대상 */
const MAX_STRING_LEN = 240;
/** 이 개수를 넘는 배열은 앞부분만 남김 */
const MAX_ARRAY_LEN = 30;
/** 순환 참조·과도한 중첩 방어용 최대 깊이 */
const MAX_DEPTH = 8;

/** base64 문자 수 → 대략적인 바이트 수 (4문자당 3바이트) */
function base64Bytes(len: number): number {
  return Math.floor((len * 3) / 4);
}

/** 사람이 읽는 크기 표기 */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 긴 문자열 하나를 요약 토큰으로 치환 */
function condenseString(value: string): string {
  if (value.length <= MAX_STRING_LEN) return value;
  /* data URI 는 종류/크기만 남기면 로그에서의 가치가 충분함 */
  const dataUri = value.match(/^data:([^;,]+)[^,]*,/);
  if (dataUri) return `‹${dataUri[1]} · ${humanSize(base64Bytes(value.length - dataUri[0].length))} 생략›`;
  return `${value.slice(0, MAX_STRING_LEN)}… ‹${value.length - MAX_STRING_LEN}자 생략›`;
}

/** 로그 표시용으로 안전하게 축약된 복사본 반환 */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return condenseString(value);
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "‹깊이 제한›";

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY_LEN).map((v) => sanitizeForLog(v, depth + 1));
    return value.length > MAX_ARRAY_LEN
      ? [...head, `‹${value.length - MAX_ARRAY_LEN}개 생략›`]
      : head;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    /* undefined 키는 요청 본문 디버깅에 방해만 되므로 제거 */
    if (v === undefined) continue;
    out[k] = sanitizeForLog(v, depth + 1);
  }
  return out;
}

/** 로그 엔트리 하나를 클립보드용 텍스트로 직렬화 */
export function stringifyForCopy(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
