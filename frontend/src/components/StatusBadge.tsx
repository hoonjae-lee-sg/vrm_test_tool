/**
 * 녹화 상태 뱃지 컴포넌트
 * RUNNING / ERROR / PENDING / STOPPED 상태를 시각적으로 표시
 */
interface StatusBadgeProps {
  state: string;
}

/* 상태별 스타일 매핑 */
const STATE_STYLES: Record<string, { bg: string; dot: string; text: string }> =
  {
    RUNNING: {
      bg: "bg-status-running/10",
      dot: "bg-status-running shadow-[0_0_8px_#10b981]",
      text: "text-status-running",
    },
    ERROR: {
      bg: "bg-status-error/10",
      dot: "bg-status-error shadow-[0_0_8px_#ef4444]",
      text: "text-status-error",
    },
    PENDING: {
      bg: "bg-status-pending/10",
      dot: "bg-status-pending",
      text: "text-status-pending",
    },
    STOPPED: {
      bg: "bg-status-stopped/10",
      dot: "bg-status-stopped",
      text: "text-status-stopped",
    },
  };

export default function StatusBadge({ state }: StatusBadgeProps) {
  const style = STATE_STYLES[state] ?? STATE_STYLES.STOPPED;

  return (
    <span
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase ${style.bg} ${style.text}`}
    >
      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
      {state}
    </span>
  );
}
