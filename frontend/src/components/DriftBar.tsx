/**
 * DriftBar — 시안의 per-camera drift 가로 막대 차트
 *
 * 0ms 기준선이 가운데에 있고, 양의 drift는 오른쪽으로 음의 drift는 왼쪽으로 뻗어나간다.
 * |drift|가 임계값을 넘으면 색이 바뀐다.
 */
import {
  SYNC_THRESHOLD_PERFECT_MS,
  SYNC_THRESHOLD_GOOD_MS,
  SYNC_THRESHOLD_WARN_MS,
} from "@/constants";

interface DriftBarProps {
  /** drift in ms (음수/양수 모두 가능) */
  diffMs: number;
  /** 시각적으로 그릴 수 있는 최대 |drift|. 이 값을 1.0(=가장자리)로 매핑 */
  maxScaleMs?: number;
  /** master 표시 여부 */
  isMaster?: boolean;
  /** 추가 클래스 */
  className?: string;
}

export default function DriftBar({
  diffMs,
  maxScaleMs = 100,
  isMaster = false,
  className = "",
}: DriftBarProps) {
  const abs = Math.abs(diffMs);
  const tone =
    abs <= SYNC_THRESHOLD_PERFECT_MS
      ? "bg-status-running"
      : abs <= SYNC_THRESHOLD_GOOD_MS
        ? "bg-brand"
        : abs <= SYNC_THRESHOLD_WARN_MS
          ? "bg-status-pending"
          : "bg-status-error";

  /* 0~maxScaleMs를 0~50%로 매핑 (반쪽 트랙). master는 0%로 고정 */
  const pct = isMaster
    ? 0
    : Math.min(50, (abs / maxScaleMs) * 50);
  const isNegative = diffMs < 0;

  return (
    <div className={`relative h-2 bg-bg-app rounded-sm ${className}`}>
      {/* 0ms 기준선 */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-strong" />
      {/* drift 바 */}
      <div
        className={`absolute top-0 bottom-0 ${tone} rounded-sm transition-all`}
        style={{
          left: isNegative ? `${50 - pct}%` : "50%",
          width: `${pct}%`,
        }}
      />
    </div>
  );
}
