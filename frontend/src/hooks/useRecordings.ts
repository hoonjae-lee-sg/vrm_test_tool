import { useState, useEffect, useCallback } from "react";
import { fetchRecordings } from "@/api/recording";
import { extractApiError } from "@/pages/tester/lib/validation";
import type { Recording } from "@/types/recording";

/**
 * 녹화 목록 자동 갱신 훅
 * @param intervalMs 갱신 주기 (기본 3초)
 * @returns recordings(Recording[]), loading, error, refresh 상태 및 함수
 */
export function useRecordings(intervalMs: number = 3000) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* 녹화 목록 수동 새로고침 */
  const refresh = useCallback(async () => {
    try {
      const data = await fetchRecordings();
      setRecordings(data);
      setError(null);
    } catch (err: unknown) {
      /* axios 응답 본문의 detail 을 우선 노출.
         err.message 만 쓰면 "Request failed with status code 503" 만 남아
         "VRM gRPC(50000) 연결 거부" 같은 실제 사유가 사라짐.
         (소비 측이 없던 필드라 문자열 내용 변경의 파급은 없음) */
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /* 주기적 자동 갱신 */
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { recordings, loading, error, refresh };
}
