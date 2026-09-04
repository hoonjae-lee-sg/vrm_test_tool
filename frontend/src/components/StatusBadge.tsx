/**
 * 녹화 상태 뱃지 — Studio 라이트 톤
 * 작은 도트 + Title Case 라벨, 상태별 soft bg + saturated fg
 */
interface StatusBadgeProps {
  /**
   * 녹화 상태 — 문자열("RUNNING" 등) 또는 proto3 enum 숫자 모두 수용.
   * REST 직렬화 경로에 따라 숫자 그대로 내려오는 응답이 있어 컴포넌트 단에서 정규화.
   */
  state: string | number;
}

/**
 * proto3 enum(common/types.proto RecordingState) 숫자 → 상태 문자열 대응표.
 * 0=UNSPECIFIED 은 UNKNOWN 으로 흡수하여 뱃지가 빈 값으로 깨지지 않도록 처리.
 */
const NUMERIC_STATES: Record<number, string> = {
  0: "UNKNOWN",
  1: "PENDING",
  2: "RUNNING",
  3: "STOPPING",
  4: "STOPPED",
  5: "ERROR",
};

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
  /** 숫자 enum 정규화 후 스타일 조회 — 미지의 값은 UNKNOWN 으로 폴백 */
  const key = typeof state === "number" ? (NUMERIC_STATES[state] ?? "UNKNOWN") : state;
  const style = STATE_STYLES[key] ?? STATE_STYLES.UNKNOWN;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${style.bg} ${style.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot} ${style.pulse ? "animate-breathe" : ""}`} />
      {style.label}
    </span>
  );
}
