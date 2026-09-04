/**
 * Tester 입력 검증 · 에러 메시지 정규화 유틸
 *
 * [왜 클라이언트에서 검증하는가]
 * serial_number / recording_id 는 서버에서 `<data_path>/<recording_id>/...` 경로
 * 컴포넌트로 그대로 쓰이므로 `src/grpc/rpc_guard.h::is_valid_identifier` 가
 * "1~128자의 [A-Za-z0-9_-]" 만 허용하고 위반 시 INVALID_ARGUMENT 로 거절함.
 * 같은 규칙을 폼에서 먼저 적용해 실패하는 왕복(프론트→FastAPI→gRPC→역순) 을 제거함.
 */
import axios from "axios";

/** 서버 is_valid_identifier 와 동일한 허용 문자 집합 */
const IDENTIFIER_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** 식별자 유효성 — 서버 규칙과 1:1 대응 */
export function isValidIdentifier(id: string): boolean {
  return IDENTIFIER_RE.test(id);
}

/**
 * 식별자 검증 실패 사유 반환 (유효하면 null).
 * 폼 하단 인라인 에러 문구로 그대로 사용함 — 원인별로 다른 문구를 주어
 * "왜 거절됐는지" 를 서버 왕복 없이 알 수 있게 함.
 */
export function identifierError(id: string): string | null {
  if (id.length === 0) return "필수 입력";
  if (id.length > 128) return `128자 초과 (현재 ${id.length}자)`;
  if (!IDENTIFIER_RE.test(id)) {
    /* 위반 문자를 중복 제거해 최대 6개까지 보여줌 — 어떤 글자가 문제인지 즉시 파악 */
    const bad = Array.from(new Set(id.split("").filter((c) => !/[A-Za-z0-9_-]/.test(c))));
    return `허용되지 않는 문자: ${bad.slice(0, 6).map((c) => (c === " " ? "␣" : c)).join(" ")} — [A-Za-z0-9_-] 만 가능`;
  }
  return null;
}

/** RTSP URL 형식 간이 검증 — 서버 parse_rtsp_url 이 거절하기 전에 오타를 잡음 */
export function rtspUrlError(url: string): string | null {
  if (!url) return "필수 입력";
  if (!/^rtsps?:\/\/[^\s/]+/i.test(url)) return "rtsp://host[:port]/path 형식이어야 함";
  return null;
}

/**
 * gRPC 오류 문자열에서 사람이 읽을 부분만 추출함.
 *
 * FastAPI 는 `HTTPException(500, detail=str(grpc_error))` 로 예외를 감싸므로
 * detail 이 아래 같은 파이썬 repr 덩어리가 됨:
 *   <_InactiveRpcError ... status = StatusCode.INVALID_ARGUMENT
 *    details = "serial_number must be 1-128 characters of [A-Za-z0-9_-]." ...>
 * 이 중 details 본문과 StatusCode 만 뽑아 "INVALID_ARGUMENT: ..." 로 압축함.
 */
function condenseGrpcDetail(detail: string): string {
  const details = detail.match(/details\s*=\s*"([^"]*)"/);
  const code = detail.match(/StatusCode\.([A-Z_]+)/);
  if (details) return code ? `${code[1]}: ${details[1]}` : details[1];
  if (code) return code[1];
  return detail;
}

/**
 * 임의의 예외를 UI 표시용 한 줄 메시지로 변환함.
 *
 * 기존 패널들은 `err.message` 만 읽어 "Request failed with status code 500" 만
 * 남았음 — 실제 원인은 axios 응답 본문의 `detail` 에 있으므로 그 쪽을 우선함.
 */
export function extractApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.code === "ECONNABORTED") return "요청 시간 초과 — VRM 서버 응답 없음";
    if (!err.response) return `네트워크 오류 — FastAPI(8100) 응답 없음 (${err.message})`;

    const data = err.response.data as unknown;
    if (typeof data === "string" && data) return condenseGrpcDetail(data);
    if (data && typeof data === "object") {
      const detail = (data as { detail?: unknown }).detail;
      if (typeof detail === "string" && detail) return condenseGrpcDetail(detail);
      if (detail) return JSON.stringify(detail);
    }
    return `HTTP ${err.response.status} ${err.response.statusText}`;
  }
  return err instanceof Error ? err.message : String(err);
}
