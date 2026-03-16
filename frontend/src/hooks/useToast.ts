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
    (message: string, type: "success" | "error" | "info" = "info") => {
      /* 이전 타이머 제거 */
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, type });
      timerRef.current = setTimeout(() => setToast(null), 3000);
    },
    []
  );

  return { toast, showToast };
}
