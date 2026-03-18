/**
 * 플로팅 패널 컴포넌트
 * TesterPage, LivePage의 플로팅 녹화 목록 패턴 통합
 * - 접기/펼치기(chevron) 지원
 * - 고정 위치(fixed) 배치
 * - 다크 테마 스타일
 */
import type { ReactNode } from "react";
import { ChevronUpIcon, ChevronDownIcon } from "@heroicons/react/20/solid";

/** 플로팅 패널 Props 정의 */
interface FloatingPanelProps {
  /** 패널 제목 */
  title: string;
  /** 최소화(접힘) 상태 */
  isMinimized: boolean;
  /** 최소화 토글 콜백 */
  onToggleMinimize: () => void;
  /** 패널 내부 콘텐츠 */
  children: ReactNode;
  /** 추가 CSS 클래스 (위치, 너비 등) */
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
      className={`${className} bg-[#0d1220]/90 backdrop-blur-xl border border-white/[0.08] rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.4)] z-40 transition-all ${
        isMinimized ? "h-10 overflow-hidden" : "max-h-80"
      }`}
    >
      {/* 헤더 — 클릭 시 접기/펼치기 토글 */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer border-b border-white/[0.06]"
        onClick={onToggleMinimize}
      >
        <span className="text-xs font-bold text-text-primary">{title}</span>
        {/* 접기/펼치기 셰브론 — Heroicon 사용 */}
        <span className="text-text-muted hover:text-text-primary">
          {isMinimized ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
        </span>
      </div>

      {/* 콘텐츠 영역 — 최소화 상태가 아닐 때만 표시 */}
      {!isMinimized && children}
    </div>
  );
}
