/**
 * 통계 카드 — Studio 라이트 톤
 * 화이트 카드 + subtle border, 숫자 강조 (tabular nums + display font)
 */
import type { ReactNode } from "react";

interface StatCardProps {
  icon?: ReactNode;
  value: number | string;
  label: string;
  /** 보조 정보 (예: "+3 since 1h") */
  hint?: string;
  /** 수치 색상 클래스 (기본: text-text-primary) */
  colorClass?: string;
  /** 상단 액센트 (기본 없음) */
  accentColor?: string;
}

export default function StatCard({
  icon,
  value,
  label,
  hint,
  colorClass = "text-text-primary",
  accentColor,
}: StatCardProps) {
  return (
    <div className="relative overflow-hidden bg-card border border-border rounded-lg p-4 hover:border-border-strong transition-colors">
      {accentColor && (
        <div className={`absolute top-0 left-0 w-0.5 h-full ${accentColor}`} />
      )}
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="shrink-0 text-text-muted">{icon}</span>}
        <span className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">
          {label}
        </span>
      </div>
      <div className={`text-[28px] leading-none font-semibold font-display tabular ${colorClass}`}>
        {value}
      </div>
      {hint && <div className="mt-2 text-[11px] text-text-muted tabular">{hint}</div>}
    </div>
  );
}
