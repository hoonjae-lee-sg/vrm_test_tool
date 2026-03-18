import { useState, useCallback, useRef } from "react";

/**
 * 토스트 알림 훅
 */
export function useToast() {
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info" = "info", duration?: number) => {
      /* 이전 타이머 제거 */
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, type });
      /** 표시 시간 — error는 5초, 그 외 3초 기본값 */
      const ms = duration ?? (type === "error" ? 5000 : 3000);
      timerRef.current = setTimeout(() => setToast(null), ms);
    },
    []
  );

  return { toast, showToast };
}
