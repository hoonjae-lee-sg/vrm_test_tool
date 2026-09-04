/**
 * SyncDistribution — Perfect/Good/Warn/Bad 분포를 stacked bar + 4-stat 카드로 표시
 *
 * Sync Lab 상단 요약 카드. 시간 범위 내 전체 frame들의 sync grade를 한눈에 보게 한다.
 */
import {
  SYNC_THRESHOLD_PERFECT_MS,
  SYNC_THRESHOLD_GOOD_MS,
  SYNC_THRESHOLD_WARN_MS,
} from "@/constants";

interface SyncDistributionProps {
  /** 각 frame의 max_diff_ms 배열 */
  values: number[];
}

interface Bucket {
  key: "perfect" | "good" | "warn" | "bad";
  label: string;
  count: number;
  color: string;
  text: string;
}

function classify(ms: number): Bucket["key"] {
  if (ms <= SYNC_THRESHOLD_PERFECT_MS) return "perfect";
  if (ms <= SYNC_THRESHOLD_GOOD_MS) return "good";
  if (ms <= SYNC_THRESHOLD_WARN_MS) return "warn";
  return "bad";
}

export default function SyncDistribution({ values }: SyncDistributionProps) {
  const total = values.length;
  const counts = { perfect: 0, good: 0, warn: 0, bad: 0 };
  for (const v of values) counts[classify(v)] += 1;

  const buckets: Bucket[] = [
    {
      key: "perfect",
      label: "Perfect",
      count: counts.perfect,
      color: "bg-status-running",
      text: "text-status-running",
    },
    {
      key: "good",
      label: "Good",
      count: counts.good,
      color: "bg-brand",
      text: "text-brand",
    },
    {
      key: "warn",
      label: "Warn",
      count: counts.warn,
      color: "bg-status-pending",
      text: "text-status-pending",
    },
    {
      key: "bad",
      label: "Bad",
      count: counts.bad,
      color: "bg-status-error",
      text: "text-status-error",
    },
  ];

  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  return (
    <div className="bg-card border border-border rounded-md p-4">
      {/* 요약 라벨 */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
        <h3 className="text-[12px] font-semibold text-text-primary tracking-tight">
          Sync grade distribution
        </h3>
        <span className="text-[11px] text-text-muted tabular">
          {total} frame{total === 1 ? "" : "s"}
        </span>
      </div>

      {/* stacked bar */}
      <div className="w-full h-2 rounded-sm overflow-hidden flex bg-bg-app mb-4">
        {buckets.map((b) => (
          <div
            key={b.key}
            className={`${b.color} h-full transition-all`}
            style={{ width: `${pct(b.count)}%` }}
            title={`${b.label}: ${b.count}`}
          />
        ))}
      </div>

      {/* 4-stat — 뷰포트가 아니라 **카드 자신의 폭** 기준으로 접힘.
          컬럼 하한 72px 를 두어 "100.0%" 같은 최장 문자열이 셀 밖으로 새지 않게 함
          (뷰포트 기준 grid-cols-4 는 좌측 사이드바 폭을 몰라 1024px 에서 28px 셀을 만들었음) */}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))" }}>
        {buckets.map((b) => (
          <div key={b.key} className="border border-border-subtle rounded-md px-2 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full ${b.color}`} />
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold truncate">
                {b.label}
              </span>
            </div>
            <div className={`text-[16px] font-display font-semibold tabular ${b.text}`}>
              {b.count}
            </div>
            <div className="text-[10px] text-text-muted tabular">
              {pct(b.count).toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
