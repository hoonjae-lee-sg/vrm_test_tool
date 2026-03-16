/**
 * 토스트 알림 컴포넌트
 * 하단 중앙에 표시되는 알림 메시지
 */
interface ToastProps {
  message: string;
  type: "success" | "error" | "info";
}

export default function Toast({ message, type }: ToastProps) {
  /* 타입별 배경색 */
  const bgColor = {
    success: "bg-status-running",
    error: "bg-status-error",
    info: "bg-brand",
  }[type];

  return (
    <div
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 ${bgColor} text-white px-6 py-3 rounded-full font-semibold shadow-lg z-[2000] animate-toast`}
    >
      {message}
    </div>
  );
}
