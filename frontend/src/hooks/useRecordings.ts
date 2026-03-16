import { useState, useEffect, useCallback } from "react";
import { fetchRecordings } from "@/api/recording";

/**
 * 녹화 목록 자동 갱신 훅
 * @param intervalMs 갱신 주기 (기본 3초)
 */
export function useRecordings(intervalMs: number = 3000) {
  const [recordings, setRecordings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* 녹화 목록 수동 새로고침 */
  const refresh = useCallback(async () => {
    try {
      const data = await fetchRecordings();
      setRecordings(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || "녹화 목록 조회 실패");
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
