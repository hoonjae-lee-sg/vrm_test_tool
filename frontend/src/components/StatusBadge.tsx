/**
 * 녹화 상태 뱃지 컴포넌트
 * RUNNING / ERROR / PENDING / STOPPED 상태를 시각적으로 표시
 */
interface StatusBadgeProps {
  state: string;
}

/* 상태별 스타일 매핑 — 전체 상태에 네온 글로우 도트 적용 */
const STATE_STYLES: Record<string, { bg: string; dot: string; text: string; label: string }> =
  {
    RUNNING: {
      bg: "bg-white/5 backdrop-blur-sm",
      dot: "bg-status-running shadow-[0_0_8px_#10b981,0_0_16px_rgba(16,185,129,0.5)] animate-breathe",
      text: "text-status-running",
      label: "Running",
    },
    ERROR: {
      bg: "bg-white/5 backdrop-blur-sm",
      dot: "bg-status-error shadow-[0_0_8px_#ef4444,0_0_16px_rgba(239,68,68,0.5)]",
      text: "text-status-error",
      label: "Error",
    },
    PENDING: {
      bg: "bg-white/5 backdrop-blur-sm",
      dot: "bg-status-pending shadow-[0_0_6px_#f59e0b,0_0_12px_rgba(245,158,11,0.3)]",
      text: "text-status-pending",
      label: "Pending",
    },
    STOPPED: {
      bg: "bg-white/5 backdrop-blur-sm",
      dot: "bg-status-stopped shadow-[0_0_4px_#6b7280]",
      text: "text-status-stopped",
      label: "Stopped",
    },
  };

export default function StatusBadge({ state }: StatusBadgeProps) {
  const style = STATE_STYLES[state] ?? STATE_STYLES.STOPPED;

  return (
    /* 글래스 배경 뱃지 — Title Case 표기 + 네온 글로우 도트 */
    <span
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${style.bg} ${style.text}`}
    >
      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
