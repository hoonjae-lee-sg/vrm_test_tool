import { useState, useEffect, useCallback } from "react";
import { fetchRecordings } from "@/api/recording";
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
      /* 에러 객체에서 메시지 추출 — Error 인스턴스 여부 확인 */
      const message = err instanceof Error ? err.message : "녹화 목록 조회 실패";
      setError(message);
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
