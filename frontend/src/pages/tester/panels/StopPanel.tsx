/**
 * 녹화 중지(Stop Recording) 패널
 *
 * [이번 개편]
 * · recording_id 입력 필드 제거 — 상단 TargetBar 가 단일 소스.
 * · 다중 대상 순차 중지 지원 (여러 카메라를 하나씩 멈추던 반복 작업 제거).
 * · 되돌릴 수 없는 동작이므로 ConfirmDialog 로 한 단계 확인 — 대상 목록을 명시해
 *   "엉뚱한 카메라를 멈추는" 사고를 막음.
 * · auth_token 을 실제로 전달 (기존 API 래퍼는 인자로 받지도 않아 조용히 버려졌음).
 */
import { useState, useEffect, useCallback } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { stopRecording } from "@/api/recording";
import PanelShell from "../components/PanelShell";
import ResultCard, { type ResultRow } from "../components/ResultCard";
import type { StopRecordingResp } from "@/api/recording";
import type { TesterCtx } from "../types";

export default function StopPanel({ ctx }: { ctx: TesterCtx }) {
  /** 확인 다이얼로그 표시 여부 */
  const [confirming, setConfirming] = useState(false);
  /** 대상별 실행 결과 — 일괄 실행 시 어느 카메라가 실패했는지 표시 */
  const [rows, setRows] = useState<ResultRow[]>([]);
  /** raw 응답 보관 (마지막 대상 기준) */
  const [raw, setRaw] = useState<unknown>(undefined);

  /** 실제 중지 실행 — 확인 후에만 호출됨 */
  const execute = useCallback(async () => {
    setConfirming(false);
    const results = await ctx.runner.runBatch<StopRecordingResp>(ctx.targets, (target) => ({
      label: "Stop Recording",
      method: "POST",
      endpoint: "/api/stop",
      target,
      request: { recording_id: target, auth_token: ctx.authToken || undefined },
      fn: () => stopRecording(target, ctx.authToken || undefined),
    }));

    setRows(
      results.map((r) => ({
        label: r.target ?? "-",
        mono: true,
        tone: r.ok ? "good" : "bad",
        value: r.ok
          ? `${r.data?.accepted?.status?.state ?? "accepted"} · ${r.durationMs}ms`
          : (r.error ?? "실패"),
      }))
    );
    setRaw(results[results.length - 1]?.data);

    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0) ctx.showToast(`녹화 중지 성공 (${results.length}건)`, "success");
    else ctx.showToast(`중지 실패 ${failed}/${results.length}건`, "error");
    /* STOPPING → STOPPED 전이를 바로 보여주기 위해 잠시 빠른 폴링 */
    ctx.fastPoll(10000);
  }, [ctx]);

  /** 버튼/단축키 진입점 — 대상이 없으면 아무것도 하지 않음 */
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
        title="Stop Recording"
        method="POST"
        endpoint="/api/stop"
        description="선택한 녹화를 중지함. 되돌릴 수 없으므로 실행 전 확인을 요구함."
        targets={ctx.targets}
        actionLabel="Stop Recording"
        actionVariant="destructive"
        onSubmit={handleSubmit}
        loading={ctx.runner.running}
        blockedReason={ctx.targets.length === 0 ? "대상을 선택하세요" : null}
        result={
          rows.length > 0 ? (
            <ResultCard
              title="Stop 결과"
              rows={rows}
              tone={rows.some((r) => r.tone === "bad") ? "error" : "success"}
              raw={raw}
            />
          ) : null
        }
      >
        <p className="text-[12px] text-text-secondary">
          auth_token 은 상단 바의 공용 값이 사용됨.
        </p>
      </PanelShell>

      {/* 위험 동작 확인 — 대상 목록을 그대로 노출해 오조작 방지 */}
      <ConfirmDialog
        isOpen={confirming}
        onConfirm={execute}
        onCancel={() => setConfirming(false)}
        title="녹화를 중지할까요?"
        message={`대상 ${ctx.targets.length}건: ${ctx.targets.join(", ")}`}
        confirmLabel="중지"
        variant="destructive"
        isLoading={ctx.runner.running}
      />
    </>
  );
}
