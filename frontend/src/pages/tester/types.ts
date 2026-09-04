/**
 * Tester 페이지 공통 타입
 * TesterPage(셸) ↔ 패널 ↔ LogViewer 사이에서 오가는 계약을 한 곳에 모음.
 */
import type { Recording } from "@/types/recording";

/* ────────────────── 로그 ────────────────── */

/** 호출 1건의 기록 — 요청과 응답을 한 엔트리로 묶어 짝을 잃지 않게 함 */
export interface LogEntry {
  /** 증가 카운터 기반 고유 키 */
  id: number;
  /** 기록 시각 (HH:MM:SS) */
  time: string;
  /** 사람이 읽는 동작명 (예: "Stop Recording") */
  label: string;
  /** HTTP 메서드 */
  method: string;
  /** 호출 엔드포인트 (예: /api/stop) */
  endpoint: string;
  /** 대상 recording_id — 일괄 실행 시 어느 카메라의 결과인지 구분 */
  target?: string;
  /** 전송한 요청 본문 (축약 적용됨) */
  request?: unknown;
  /** 응답 본문 (축약 적용됨) */
  response?: unknown;
  /** 실패 시 정규화된 한 줄 메시지 */
  error?: string;
  /** 왕복 소요 시간 (ms) — 비동기 탐색 전환 효과 확인용 */
  durationMs: number;
  /** 성공 여부 */
  ok: boolean;
}

/* ────────────────── 실행 결과 ────────────────── */

/** 단건 실행 결과 */
export interface RunResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  durationMs: number;
  /** 대상 recording_id (일괄 실행 결과 구분용) */
  target?: string;
}

/** 실행 옵션 — 로그 엔트리에 그대로 반영됨 */
export interface RunOptions<T> {
  label: string;
  method: "GET" | "POST";
  endpoint: string;
  target?: string;
  request?: unknown;
  fn: () => Promise<T>;
}

/** useApiRunner 가 제공하는 실행기 */
export interface ApiRunner {
  /** 진행 중 여부 — 버튼 로딩 상태에 사용 */
  running: boolean;
  /** 단건 실행 */
  run<T>(options: RunOptions<T>): Promise<RunResult<T>>;
  /** 여러 타겟에 순차 실행 — 서버 부하와 로그 가독성을 위해 병렬이 아닌 순차 */
  runBatch<T>(
    targets: string[],
    build: (target: string) => RunOptions<T>
  ): Promise<RunResult<T>[]>;
}

/* ────────────────── 패널 컨텍스트 ────────────────── */

/** 모든 패널이 공유하는 컨텍스트 — 패널마다 반복되던 prop 6종을 하나로 묶음 */
export interface TesterCtx {
  /** 선택된 대상 목록 (항상 1개 이상이 되도록 셸이 보장하지 않음 — 빈 배열 가능) */
  targets: string[];
  /** 대표 대상 = targets[0] (단일 대상 패널의 편의 접근자) */
  primaryTarget: string;
  /** 현재 녹화 목록 — 대상의 상태/URL 을 패널에서 참조 */
  recordings: Recording[];
  /** 대상 변경 (Start 성공 직후 새 recording_id 로 전환 등) */
  setTargets: (ids: string[]) => void;
  /** API 실행기 */
  runner: ApiRunner;
  /** 녹화 목록 즉시 갱신 */
  refresh: () => void;
  /** 지정 시간 동안 목록을 빠르게 폴링 (PENDING→RUNNING 전이 관찰용) */
  fastPoll: (durationMs?: number) => void;
  /** 토스트 알림 */
  showToast: (message: string, type: "success" | "error" | "info") => void;
  /** 모든 패널이 공유하는 auth_token */
  authToken: string;
  /** 패널의 주 실행 함수 등록 — Ctrl+Enter 단축키가 이것을 호출 */
  registerSubmit: (fn: (() => void) | null) => void;
}
