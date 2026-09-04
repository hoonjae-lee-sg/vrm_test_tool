import { useState, useRef, useCallback, useMemo } from "react";
import { extractApiError } from "../lib/validation";
import { sanitizeForLog } from "../lib/sanitize";
import type { ApiRunner, LogEntry, RunOptions, RunResult } from "../types";

/**
 * API 실행 래퍼 훅
 *
 * [해결하는 문제]
 * 기존에는 8개 패널이 각각 `setLoading(true) → try → addLog → catch → err.message → finally`
 * 를 복붙하고 있었음. 그 결과
 *   · 소요 시간이 어디에도 남지 않고(비동기 탐색 전환 효과를 눈으로 확인할 수 없음)
 *   · 실패 사유가 axios 의 "status code 500" 으로 뭉개지고
 *   · 요청 본문과 응답이 서로 다른 로그 줄로 흩어져 짝을 잃음.
 * 이 훅이 그 세 가지를 한 번에 처리하고, 패널은 "무엇을 부를지"만 기술하게 함.
 *
 * [순차 실행을 택한 이유 — runBatch]
 * 일괄 실행은 대개 8~11채널에 Stop/Snapshot 을 거는 용도임. 병렬로 던지면 VRM 서버의
 * 동일 자원(파이프라인 락, 디스크)에 동시 접근이 몰려 실패가 서로를 오염시키고,
 * 로그 순서도 뒤섞여 원인 추적이 어려워짐. 순차 실행이 테스트 도구에 더 맞음.
 */
export function useApiRunner(
  pushLog: (entry: Omit<LogEntry, "id" | "time">) => void
): ApiRunner {
  const [running, setRunning] = useState(false);
  /** 중첩 실행 카운터 — runBatch 내부의 run 호출로 running 이 조기에 false 가 되는 것 방지 */
  const depthRef = useRef(0);

  /** 실행 시작/종료 시 깊이를 세어 최외곽에서만 로딩 상태를 토글 */
  const enter = useCallback(() => {
    depthRef.current += 1;
    if (depthRef.current === 1) setRunning(true);
  }, []);
  const leave = useCallback(() => {
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setRunning(false);
  }, []);

  const run = useCallback(
    async <T,>(options: RunOptions<T>): Promise<RunResult<T>> => {
      enter();
      /* performance.now() 사용 — Date.now() 와 달리 시스템 시계 변경에 영향받지 않음 */
      const started = performance.now();
      try {
        const data = await options.fn();
        const durationMs = Math.round(performance.now() - started);
        pushLog({
          label: options.label,
          method: options.method,
          endpoint: options.endpoint,
          target: options.target,
          request: sanitizeForLog(options.request),
          response: sanitizeForLog(data),
          durationMs,
          ok: true,
        });
        return { ok: true, data, durationMs, target: options.target };
      } catch (err: unknown) {
        const durationMs = Math.round(performance.now() - started);
        const message = extractApiError(err);
        pushLog({
          label: options.label,
          method: options.method,
          endpoint: options.endpoint,
          target: options.target,
          request: sanitizeForLog(options.request),
          error: message,
          durationMs,
          ok: false,
        });
        return { ok: false, error: message, durationMs, target: options.target };
      } finally {
        leave();
      }
    },
    [enter, leave, pushLog]
  );

  const runBatch = useCallback(
    async <T,>(
      targets: string[],
      build: (target: string) => RunOptions<T>
    ): Promise<RunResult<T>[]> => {
      enter();
      try {
        const results: RunResult<T>[] = [];
        for (const target of targets) {
          /* 한 대상이 실패해도 나머지는 계속 진행 — run 이 예외를 던지지 않고 결과로 반환함 */
          results.push(await run(build(target)));
        }
        return results;
      } finally {
        leave();
      }
    },
    [enter, leave, run]
  );

  return useMemo(() => ({ running, run, runBatch }), [running, run, runBatch]);
}
