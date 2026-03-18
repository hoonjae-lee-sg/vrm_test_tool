/**
 * 토스트 알림 컴포넌트
 * 하단 중앙에 표시 — 글래스 배경 + 좌측 액센트 바 + Heroicon 아이콘
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

/** 타입별 좌측 액센트 바 색상 매핑 */
const ACCENT_MAP: Record<string, string> = {
  success: "bg-status-running",
  error: "bg-status-error",
  info: "bg-brand",
};

/** 타입별 아이콘 색상 매핑 */
const ICON_COLOR_MAP: Record<string, string> = {
  success: "text-status-running",
  error: "text-status-error",
  info: "text-brand",
};

/** 타입별 아이콘 컴포넌트 매핑 */
const ICON_MAP: Record<string, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  info: InformationCircleIcon,
};

export default function Toast({ message, type }: ToastProps) {
  const Icon = ICON_MAP[type];

  return (
    /* 글래스 토스트 — 반투명 배경 + 블러 + 좌측 액센트 바 */
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#0d1220]/90 backdrop-blur-xl border border-white/[0.1] text-text-primary px-5 py-3 rounded-xl font-semibold shadow-[0_8px_30px_rgba(0,0,0,0.4)] z-[2000] animate-slide-in relative overflow-hidden"
    >
      {/* 좌측 액센트 바 — 타입별 색상 */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${ACCENT_MAP[type]}`} />
      {/* 콘텐츠 — 아이콘 + 메시지 */}
      <div className="flex items-center gap-2.5 pl-2">
        <Icon className={`w-5 h-5 shrink-0 ${ICON_COLOR_MAP[type]}`} />
        <span>{message}</span>
      </div>
    </div>
  );
}
