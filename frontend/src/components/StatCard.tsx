/**
 * 통계 카드 컴포넌트
 * DashboardPage의 StatCard 패턴 추출
 * - 아이콘(ReactNode — Heroicons 등) + 수치 + 라벨 표시
 * - 다크 테마 카드 스타일, 호버 시 그림자 강조
 */
import type { ReactNode } from "react";

/** 통계 카드 Props 정의 */
interface StatCardProps {
  /** 아이콘 (ReactNode — Heroicon 컴포넌트 등) */
  icon?: ReactNode;
  /** 표시할 수치 또는 텍스트 */
  value: number | string;
  /** 카드 하단 라벨 */
  label: string;
  /** 수치 색상 Tailwind 클래스 (기본: text-text-primary) */
  colorClass?: string;
  /** 상단 액센트 라인 색상 Tailwind 클래스 (기본: bg-brand) */
  accentColor?: string;
}

export default function StatCard({
  icon,
  value,
  label,
  colorClass = "text-text-primary",
  accentColor = "bg-brand",
}: StatCardProps) {
  return (
    /* 글래스 카드 — 반투명 배경 + 블러 + 호버 글로우 */
    <div className="relative overflow-hidden bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:bg-white/[0.05] hover:border-white/[0.12] hover:shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-200">
      {/* 상단 액센트 라인 — 그래디언트 투명→색상→투명 */}
      <div className={`absolute top-0 inset-x-0 h-0.5 ${accentColor} opacity-60 rounded-t-xl`} />
      {/* 라벨 영역 — 아이콘 글래스 배경 + 텍스트 */}
      <div className="flex items-center gap-1.5 text-xs text-text-muted mb-1">
        {icon && <span className="shrink-0 bg-white/5 rounded-xl p-2.5">{icon}</span>}
        {label}
      </div>
      {/* 수치 — Outfit 디스플레이 폰트, 볼드 */}
      <div className={`text-3xl font-bold font-display ${colorClass}`}>
        {value}
      </div>
    </div>
  );
}
