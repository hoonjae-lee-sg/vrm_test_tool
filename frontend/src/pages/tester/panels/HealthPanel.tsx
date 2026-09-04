/**
 * 헬스 체크(Check Health) 패널
 *
 * [이번 개편]
 * · recording_id / auth_token 입력 제거 — 전역 타겟과 공용 auth_token 사용.
 * · 다중 대상 순차 조회 — 여러 카메라의 healthy 를 한 화면에서 비교.
 * · healthy 를 색 배지로 크게 보여주고 jitter 지표를 구조화 (기존엔 raw JSON 뿐).
 * · 응답의 oneof(status/error)와, 서버 버전에 따라 평탄화되어 오는 형태를 모두 수용.
 */
import { useState, useEffect, useCallback } from "react";
import { getRecordingHealth } from "@/api/recording";
import PanelShell from "../components/PanelShell";
import ResultCard, { type ResultRow } from "../components/ResultCard";
import { fmtCount, fmtFixed, fmtIsoTime } from "../lib/format";
import type { HealthResp, JitterStatsResp } from "@/api/recording";
import type { TesterCtx } from "../types";

/** 조회 결과 한 건 */
interface HealthItem {
  target: string;
  data?: HealthResp;
  error?: string;
}

/** oneof / 평탄화 두 형태를 모두 받아 (healthy, jitter) 로 정규화 */
function normalize(resp?: HealthResp): { healthy: boolean; jitter: JitterStatsResp } {
  const healthy = resp?.status?.healthy ?? resp?.healthy ?? false;
  const jitter = resp?.status?.jitter ?? resp?.jitter ?? {};
  return { healthy, jitter };
}

/** 정규화 결과 → 카드 행 */
function toRows(resp?: HealthResp): ResultRow[] {
  const { healthy, jitter } = normalize(resp);
  return [
    {
      label: "healthy",
      value: healthy ? "HEALTHY" : "UNHEALTHY",
      tone: healthy ? "good" : "bad",
    },
    { label: "recent_fps", value: fmtFixed(jitter.recent_fps, 2, " fps"), mono: true },
    { label: "mean_interarrival", value: fmtFixed(jitter.mean_interarrival_ms, 1, " ms"), mono: true },
    {
      label: "jitter p50 / p95",
      value: `${fmtFixed(jitter.jitter_ms_p50, 1)} / ${fmtFixed(jitter.jitter_ms_p95, 1)} ms`,
      mono: true,
    },
    {
      label: "drift / ntp",
      value: `${fmtCount(jitter.drift_ms)} ms · ${jitter.ntp_synced ? "synced" : "not synced"}`,
      mono: true,
      tone: jitter.ntp_synced ? "default" : "warn",
    },
    { label: "last_frame_at", value: fmtIsoTime(jitter.last_frame_at), mono: true },
  ];
}

export default function HealthPanel({ ctx }: { ctx: TesterCtx }) {
  const [items, setItems] = useState<HealthItem[]>([]);

  const handleSubmit = useCallback(async () => {
    if (ctx.targets.length === 0) return;
    const results = await ctx.runner.runBatch<HealthResp>(ctx.targets, (target) => ({
      label: "Check Health",
      method: "GET",
      endpoint: `/api/health/${target}`,
      target,
      request: { auth_token: ctx.authToken || undefined },
      fn: () => getRecordingHealth(target, ctx.authToken || undefined),
    }));
    setItems(results.map((r) => ({ target: r.target ?? "", data: r.data, error: r.error })));
  }, [ctx]);

  useEffect(() => {
    ctx.registerSubmit(handleSubmit);
    return () => ctx.registerSubmit(null);
  }, [ctx, handleSubmit]);

  return (
    <PanelShell
      title="Check Health"
      method="GET"
      endpoint="/api/health/{id}"
      description="스트림 건강 상태(JitterStats 기반)를 조회함."
      targets={ctx.targets}
      actionLabel="Check Health"
      onSubmit={handleSubmit}
      loading={ctx.runner.running}
      blockedReason={ctx.targets.length === 0 ? "대상을 선택하세요" : null}
      result={
        items.length > 0 ? (
          <div className="space-y-4">
            {items.map((item) =>
              item.error ? (
                <ResultCard
                  key={item.target}
                  title={item.target}
                  tone="error"
                  rows={[{ label: "error", value: item.error, tone: "bad" }]}
                />
              ) : (
                <ResultCard
                  key={item.target}
                  title={item.target}
                  tone={normalize(item.data).healthy ? "success" : "error"}
                  rows={toRows(item.data)}
                  raw={item.data}
                />
              )
            )}
          </div>
        ) : null
      }
    >
      <p className="text-[12px] text-text-secondary">
        auth_token 은 상단 바의 공용 값이 쿼리 파라미터로 전달됨.
      </p>
    </PanelShell>
  );
}
