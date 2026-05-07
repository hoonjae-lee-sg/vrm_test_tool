/**
 * 공통 모달 — Studio 라이트 톤
 */
import { useEffect, useCallback, type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
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
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-text-primary/20 backdrop-blur-sm flex items-center justify-center z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-white border border-border rounded-xl p-6 w-full ${maxWidth} shadow-floating animate-scale-in`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-subtle">
          <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
          <div className="flex items-center gap-2">
            {headerExtra}
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
