/**
 * 공통 모달 컴포넌트
 * DashboardPage, LivePage의 모달 패턴 통합
 * - 백드롭 클릭으로 닫기
 * - ESC 키로 닫기
 * - fade-in 애니메이션 (index.css 정의)
 */
import { useEffect, useCallback, type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";

/** 모달 Props 정의 */
interface ModalProps {
  /** 모달 표시 여부 */
  isOpen: boolean;
  /** 닫기 콜백 */
  onClose: () => void;
  /** 모달 제목 */
  title: string;
  /** 모달 내부 콘텐츠 */
  children: ReactNode;
  /** 최대 너비 Tailwind 클래스 (기본: max-w-md) */
  maxWidth?: string;
  /** 헤더 우측 추가 요소 (버튼 등) */
  headerExtra?: ReactNode;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
  headerExtra,
}: ModalProps) {
  /** ESC 키 이벤트 핸들러 — 모달 열림 상태에서만 동작 */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  /** ESC 키 리스너 등록/해제 */
  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  /* 비표시 상태일 때 렌더링 생략 */
  if (!isOpen) return null;

  return (
    /* 백드롭 — 클릭 시 모달 닫기 (onMouseDown으로 드래그 시 닫힘 방지) */
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-lg flex items-center justify-center z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 모달 본체 — fade-in 애니메이션 적용 */}
      <div
        className={`bg-[#0d1220]/90 backdrop-blur-2xl border border-white/[0.08] rounded-2xl p-6 w-full ${maxWidth} shadow-[0_0_60px_rgba(0,0,0,0.5),0_0_20px_rgba(59,130,246,0.05)] animate-scale-in`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 — 제목 + headerExtra + 닫기 버튼, 하단 보더 구분선 */}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.06]">
          <h2 className="text-lg font-bold text-text-primary">{title}</h2>
          <div className="flex items-center gap-2">
            {headerExtra}
            {/* 닫기 버튼 — XMarkIcon Heroicon */}
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        {/* 모달 콘텐츠 */}
        {children}
      </div>
    </div>
  );
}
