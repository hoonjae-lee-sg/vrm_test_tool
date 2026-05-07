/**
 * 토스트 — Studio 라이트 톤
 * 화이트 카드 + 좌측 색 액센트, 미세 그림자
 */
import {
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
} from "@heroicons/react/20/solid";

interface ToastProps {
  message: string;
  type: "success" | "error" | "info";
}

const ACCENT_MAP: Record<string, string> = {
  success: "bg-status-running",
  error: "bg-status-error",
  info: "bg-brand",
};

const ICON_COLOR_MAP: Record<string, string> = {
  success: "text-status-running",
  error: "text-status-error",
  info: "text-brand",
};

const ICON_MAP: Record<string, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  info: InformationCircleIcon,
};

export default function Toast({ message, type }: ToastProps) {
  const Icon = ICON_MAP[type];

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white border border-border text-text-primary px-4 py-2.5 rounded-lg shadow-floating z-[2000] animate-slide-in relative overflow-hidden text-[13px] font-medium">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${ACCENT_MAP[type]}`} />
      <div className="flex items-center gap-2 pl-2">
        <Icon className={`w-4 h-4 shrink-0 ${ICON_COLOR_MAP[type]}`} />
        <span>{message}</span>
      </div>
    </div>
  );
}
