/**
 * 녹화 재시작(Restart Recording) 패널
 * STOPPED/ERROR 상태의 녹화를 DB에 보존된 동일 설정으로 재시작함.
 *
 * [이번 개편]
 * · recording_id 입력 제거(전역 타겟 사용) + 다중 대상 순차 재시작.
 * · 파이프라인을 다시 세우는 동작이므로 ConfirmDialog 로 확인.
 * · 대상 상태가 RUNNING 이면 사전 경고 — 서버가 거절할 가능성이 높은 조합을 미리 알림.
 * · auth_token 전달 (기존에는 API 래퍼가 인자조차 받지 않았음).
 */
import { useState, useEffect, useCallback } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { restartRecording } from "@/api/recording";
import PanelShell from "../components/PanelShell";
import ResultCard, { type ResultRow } from "../components/ResultCard";
import type { RestartRecordingResp } from "@/api/recording";
import type { TesterCtx } from "../types";

export default function RestartPanel({ ctx }: { ctx: TesterCtx }) {
  const [confirming, setConfirming] = useState(false);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [raw, setRaw] = useState<unknown>(undefined);

  /** 대상 중 이미 RUNNING 인 것 — 재시작 대상이 아님을 미리 알림 */
  const runningTargets = ctx.targets.filter((id) => {
    const rec = ctx.recordings.find((r) => r.recording_id === id);
    return rec && rec.state === "RUNNING";
  });

  const execute = useCallback(async () => {
    setConfirming(false);
    const results = await ctx.runner.runBatch<RestartRecordingResp>(ctx.targets, (target) => ({
      label: "Restart Recording",
      method: "POST",
      endpoint: "/api/restart",
      target,
      request: { recording_id: target, auth_token: ctx.authToken || undefined },
      fn: () => restartRecording(target, ctx.authToken || undefined),
    }));

    setRows(
      results.map((r) => ({
        label: r.target ?? "-",
        mono: true,
        tone: r.ok && !r.data?.error ? "good" : "bad",
        /* Restart 응답은 oneof {status|error} 이므로 status.state 를 먼저 읽고,
           서버가 error 를 담아 200 으로 응답한 경우 그 메시지를 노출함. */
        value: r.ok
          ? `${r.data?.status?.state ?? r.data?.error?.message ?? "accepted"} · ${r.durationMs}ms`
          : (r.error ?? "실패"),
      }))
    );
    setRaw(results[results.length - 1]?.data);

    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0) ctx.showToast(`녹화 재시작 성공 (${results.length}건)`, "success");
    else ctx.showToast(`재시작 실패 ${failed}/${results.length}건`, "error");
    ctx.fastPoll(15000);
  }, [ctx]);

  const handleSubmit = useCallback(() => {
    if (ctx.targets.length === 0) return;
    setConfirming(true);
  }, [ctx.targets.length]);

  useEffect(() => {
    ctx.registerSubmit(handleSubmit);
    return () => ctx.registerSubmit(null);
  }, [ctx, handleSubmit]);

  return (
    <>
      <PanelShell
        title="Restart Recording"
        method="POST"
        endpoint="/api/restart"
        description="STOPPED/ERROR 상태의 녹화를 DB에 보존된 동일 설정으로 다시 시작함."
        targets={ctx.targets}
        actionLabel="Restart Recording"
        onSubmit={handleSubmit}
        loading={ctx.runner.running}
        blockedReason={ctx.targets.length === 0 ? "대상을 선택하세요" : null}
        result={
          rows.length > 0 ? (
            <ResultCard
              title="Restart 결과"
              rows={rows}
              tone={rows.some((r) => r.tone === "bad") ? "error" : "success"}
              raw={raw}
            />
          ) : null
        }
      >
        {runningTargets.length > 0 && (
          <p className="text-[12px] text-status-pending">
            이미 RUNNING 인 대상 포함: {runningTargets.join(", ")} — 서버가 거절할 수 있음.
          </p>
        )}
        <p className="text-[12px] text-text-secondary">
          auth_token 은 상단 바의 공용 값이 사용됨.
        </p>
      </PanelShell>

      <ConfirmDialog
        isOpen={confirming}
        onConfirm={execute}
        onCancel={() => setConfirming(false)}
        title="녹화를 재시작할까요?"
        message={`대상 ${ctx.targets.length}건: ${ctx.targets.join(", ")}`}
        confirmLabel="재시작"
        isLoading={ctx.runner.running}
      />
    </>
  );
}
