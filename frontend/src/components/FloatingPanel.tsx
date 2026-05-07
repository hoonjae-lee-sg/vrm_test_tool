/**
 * 플로팅 패널 — Studio 라이트 톤
 */
import type { ReactNode } from "react";
import { ChevronUpIcon, ChevronDownIcon } from "@heroicons/react/20/solid";

interface FloatingPanelProps {
  title: string;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  children: ReactNode;
  className?: string;
}

export default function FloatingPanel({
  title,
  isMinimized,
  onToggleMinimize,
  children,
  className = "fixed bottom-4 right-4 w-72",
}: FloatingPanelProps) {
  return (
    <div
      className={`${className} bg-white border border-border rounded-lg shadow-floating z-40 transition-all ${
        isMinimized ? "h-9 overflow-hidden" : "max-h-80"
      }`}
    >
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border-subtle"
        onClick={onToggleMinimize}
      >
        <span className="text-[12px] font-semibold text-text-primary">{title}</span>
        <span className="text-text-muted hover:text-text-primary">
          {isMinimized ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
        </span>
      </div>
      {!isMinimized && children}
    </div>
  );
}
