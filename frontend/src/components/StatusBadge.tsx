/**
 * 녹화 상태 뱃지 — Studio 라이트 톤
 * 작은 도트 + Title Case 라벨, 상태별 soft bg + saturated fg
 */
interface StatusBadgeProps {
  state: string;
}

const STATE_STYLES: Record<string, { bg: string; dot: string; text: string; label: string; pulse?: boolean }> = {
  RUNNING: {
    bg: "bg-status-running-soft",
    dot: "bg-status-running",
    text: "text-status-running",
    label: "Running",
    pulse: true,
  },
  ERROR: {
    bg: "bg-status-error-soft",
    dot: "bg-status-error",
    text: "text-status-error",
    label: "Error",
  },
  PENDING: {
    bg: "bg-status-pending-soft",
    dot: "bg-status-pending",
    text: "text-status-pending",
    label: "Pending",
  },
  STOPPING: {
    bg: "bg-status-pending-soft",
    dot: "bg-status-pending",
    text: "text-status-pending",
    label: "Stopping",
  },
  STOPPED: {
    bg: "bg-status-stopped-soft",
    dot: "bg-status-stopped",
    text: "text-status-stopped",
    label: "Stopped",
  },
  UNKNOWN: {
    bg: "bg-status-stopped-soft",
    dot: "bg-status-stopped",
    text: "text-status-stopped",
    label: "Unknown",
  },
};

export default function StatusBadge({ state }: StatusBadgeProps) {
  const style = STATE_STYLES[state] ?? STATE_STYLES.UNKNOWN;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${style.bg} ${style.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot} ${style.pulse ? "animate-breathe" : ""}`} />
      {style.label}
    </span>
  );
}
