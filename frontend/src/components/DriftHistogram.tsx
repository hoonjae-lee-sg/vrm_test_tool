/**
 * DriftHistogram — 시간 윈도우 내 frame들의 max_diff_ms 분포를 보여주는 히스토그램
 *
 * Sync Lab에서 "이 시간대 전체적으로 동기화 품질이 어떤가?" 를 한 눈에 보여줄 때 사용.
 * 빈(bin)은 5ms 단위로 0~100ms+ 까지. 각 빈의 색은 sync threshold에 따라 결정.
 */
import {
  SYNC_THRESHOLD_PERFECT_MS,
  SYNC_THRESHOLD_GOOD_MS,
  SYNC_THRESHOLD_WARN_MS,
} from "@/constants";

interface DriftHistogramProps {
  /** 각 frame의 max drift in ms */
  values: number[];
  /** 빈 너비 (ms). 기본 5ms */
  binSize?: number;
  /** 최대 표시 ms (이 값 이상은 마지막 빈에 합산) */
  maxMs?: number;
  /** 컴포넌트 높이 (px) */
  height?: number;
}

export default function DriftHistogram({
  values,
  binSize = 5,
  maxMs = 100,
  height = 80,
}: DriftHistogramProps) {
  if (!values.length) {
    return (
      <div
        className="w-full flex items-center justify-center text-[11px] text-text-muted"
        style={{ height }}
      >
        no data
      </div>
    );
  }

  /* bin 배열 — index 0 = [0,binSize), 마지막 bin은 [maxMs, ∞) overflow */
  const binCount = Math.ceil(maxMs / binSize) + 1;
  const bins = new Array<number>(binCount).fill(0);
  for (const v of values) {
    const idx = Math.min(Math.floor(v / binSize), binCount - 1);
    bins[idx] += 1;
  }
  const peak = Math.max(...bins, 1);

  /* 각 bin의 중심값 → 색상 결정 */
  const binColor = (binIdx: number) => {
    const center = binIdx * binSize + binSize / 2;
    if (center <= SYNC_THRESHOLD_PERFECT_MS) return "bg-status-running";
    if (center <= SYNC_THRESHOLD_GOOD_MS) return "bg-brand";
    if (center <= SYNC_THRESHOLD_WARN_MS) return "bg-status-pending";
    return "bg-status-error";
  };

  /* 임계값 위치 (퍼센트) — 라벨 가이드용 */
  const thresholdAt = (ms: number) => Math.min(100, (ms / (maxMs + binSize)) * 100);

  return (
    <div className="w-full">
      <div
        className="relative w-full flex items-end gap-px"
        style={{ height }}
      >
        {/* 임계값 가이드 라인 (점선) */}
        {[SYNC_THRESHOLD_PERFECT_MS, SYNC_THRESHOLD_GOOD_MS, SYNC_THRESHOLD_WARN_MS].map((t) => (
          <div
            key={t}
            className="absolute top-0 bottom-0 border-l border-dashed border-border-strong/60"
            style={{ left: `${thresholdAt(t)}%` }}
          />
        ))}
        {bins.map((count, i) => (
          <div
            key={i}
            className={`flex-1 ${binColor(i)} rounded-t-sm transition-all`}
            style={{
              height: `${(count / peak) * 100}%`,
              opacity: count === 0 ? 0.12 : 1,
            }}
            title={
              i === binCount - 1
                ? `${maxMs}ms+: ${count}`
                : `${i * binSize}–${(i + 1) * binSize}ms: ${count}`
            }
          />
        ))}
      </div>
      {/* x축 라벨 */}
      <div className="relative h-4 mt-1 text-[9px] text-text-muted font-mono tabular">
        <span className="absolute left-0">0</span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${thresholdAt(SYNC_THRESHOLD_PERFECT_MS)}%` }}
        >
          {SYNC_THRESHOLD_PERFECT_MS}
        </span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${thresholdAt(SYNC_THRESHOLD_GOOD_MS)}%` }}
        >
          {SYNC_THRESHOLD_GOOD_MS}
        </span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${thresholdAt(SYNC_THRESHOLD_WARN_MS)}%` }}
        >
          {SYNC_THRESHOLD_WARN_MS}
        </span>
        <span className="absolute right-0">{maxMs}+ ms</span>
      </div>
    </div>
  );
}
