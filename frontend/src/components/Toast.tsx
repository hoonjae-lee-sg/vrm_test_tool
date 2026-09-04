/**
 * 토스트 — Studio 라이트 톤
 * 화이트 카드 + 좌측 색 액센트, 미세 그림자
 *
 * [2026-09 수정 — 화면 밖 렌더 결함]
 * · 기존 className 에 `fixed` 와 `relative` 가 동시에 있었음. Tailwind 생성 CSS 는
 *   `.relative` 가 `.fixed` 뒤에 오므로 동일 특이도에서 나중 규칙이 승리 →
 *   실제 계산값이 `position:relative` 가 되어 토스트가 문서 흐름 맨 아래(rect.y≈1060)에
 *   배치되고 뷰포트(900) 밖으로 벗어남. 즉 모든 알림이 사용자에게 도달하지 못함.
 *   → `relative` 제거. `fixed` 자체가 절대 위치 자식(좌측 액센트 바)의 컨테이닝 블록이
 *      되므로 액센트 바 동작에는 영향 없음.
 * · createPortal(document.body) 적용 — 조상에 transform/filter/contain 이 걸리면
 *   `position:fixed` 가 그 조상 기준으로 바뀌어 같은 증상이 재발함. body 직속으로
 *   띄워 레이아웃 변경(사이드바 반응형 작업 등)과 무관하게 항상 뷰포트 기준을 유지함.
 * · `max-w-[min(90vw,28rem)]` — 긴 메시지에서 카드가 화면 폭을 넘겨 좌우가 잘리는 것 방지.
 * · role="status" / aria-live="polite" — 스크린리더가 알림을 읽도록 함.
 */
import { createPortal } from "react-dom";
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

  /* SSR/테스트 등 document 가 없는 환경 방어 — 포털 대상이 없으면 렌더 생략 */
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-toast={type}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 max-w-[min(90vw,28rem)] bg-white border border-border text-text-primary px-4 py-2.5 rounded-lg shadow-floating z-[2000] animate-slide-in overflow-hidden text-[13px] font-medium"
    >
      {/* 좌측 색 액센트 바 — 부모의 position:fixed 를 컨테이닝 블록으로 사용 */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${ACCENT_MAP[type]}`} />
      <div className="flex items-center gap-2 pl-2">
        <Icon className={`w-4 h-4 shrink-0 ${ICON_COLOR_MAP[type]}`} />
        <span className="break-words">{message}</span>
      </div>
    </div>,
    document.body
  );
}
