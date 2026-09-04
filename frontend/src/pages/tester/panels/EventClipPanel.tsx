/**
 * 이벤트 클립 시작/중지 패널
 * mode prop 으로 start / stop 동작을 분기함.
 *
 * [이번 개편]
 * · recording_id / auth_token 입력 제거 — 전역 타겟과 공용 auth_token 사용.
 * · 다중 대상 순차 실행 — 여러 카메라에 동시에 이벤트 구간을 걸 수 있음.
 * · stop 응답의 clip_id / clip_path 를 구조화해 표시 (기존엔 raw JSON 뿐이라
 *   생성된 클립 경로를 눈으로 찾아야 했음). start 는 빈 응답이므로 수락 여부만 표시.
 * · EVENT 모드가 아닌 대상이 섞여 있으면 실행 전에 경고 — 서버가 거절할 조합을 미리 알림.
 */
import { useState, useEffect, useCallback } from "react";
import { startEventClip, stopEventClip } from "@/api/recording";
import PanelShell from "../components/PanelShell";
import ResultCard, { type ResultRow } from "../components/ResultCard";
import type { StopEventClipResp } from "@/api/recording";
import type { TesterCtx } from "../types";

/** EventClipPanel Props */
interface EventClipPanelProps {
  /** 동작 모드 */
  mode: "start" | "stop";
  ctx: TesterCtx;
}

export default function EventClipPanel({ mode, ctx }: EventClipPanelProps) {
  const isStart = mode === "start";
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [raw, setRaw] = useState<unknown>(undefined);

  /** 대상 중 recording_mode 가 EVENT 가 아닌 것 — 서버 거절 예상 조합 */
  const nonEventTargets = ctx.targets.filter((id) => {
    const rec = ctx.recordings.find((r) => r.recording_id === id);
    return rec?.recording_mode !== undefined && rec.recording_mode !== "EVENT";
  });

  const handleSubmit = useCallback(async () => {
    if (ctx.targets.length === 0) return;
    const endpoint = isStart ? "/api/clip/event/start" : "/api/clip/event/stop";
    const results = await ctx.runner.runBatch<StopEventClipResp | Record<string, never>>(
      ctx.targets,
      (target) => ({
        label: isStart ? "Start Event Clip" : "Stop Event Clip",
        method: "POST",
        endpoint,
        target,
        request: { recording_id: target, auth_token: ctx.authToken || undefined },
        fn: () =>
          isStart
            ? startEventClip(target, ctx.authToken || undefined)
            : stopEventClip(target, ctx.authToken || undefined),
      })
    );

    setRows(
      results.map((r) => {
        if (!r.ok) {
          return { label: r.target ?? "-", value: r.error ?? "실패", tone: "bad", mono: true };
        }
        /* stop 응답에는 clip_id/clip_path 가 담김. start 응답은 빈 메시지라 수락만 표기. */
        const d = r.data as StopEventClipResp | undefined;
        const detail = isStart
          ? `accepted · ${r.durationMs}ms`
          : `${d?.clip_id || "clip_id 없음"} · ${d?.clip_path || "path 없음"}`;
        return { label: r.target ?? "-", value: detail, tone: "good", mono: true };
      })
    );
    setRaw(results[results.length - 1]?.data);

    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0)
      ctx.showToast(`${isStart ? "이벤트 시작" : "이벤트 종료"} 성공 (${results.length}건)`, "success");
    else ctx.showToast(`실패 ${failed}/${results.length}건`, "error");
  }, [ctx, isStart]);

  useEffect(() => {
    ctx.registerSubmit(handleSubmit);
    return () => ctx.registerSubmit(null);
  }, [ctx, handleSubmit]);

  return (
    <PanelShell
      title={isStart ? "Start Event Clip" : "Stop Event Clip"}
      method="POST"
      endpoint={isStart ? "/api/clip/event/start" : "/api/clip/event/stop"}
      description={
        isStart
          ? "EVENT 모드 녹화에서 이벤트 구간 기록을 시작함. 응답 본문은 비어 있음(수락 여부만)."
          : "이벤트 구간을 종료하고 HLS 클립을 생성함. 응답에 clip_id 와 clip_path 가 담김."
      }
      targets={ctx.targets}
      actionLabel={isStart ? "Start Event" : "Stop Event"}
      actionVariant={isStart ? "primary" : "destructive"}
      onSubmit={handleSubmit}
      loading={ctx.runner.running}
      blockedReason={ctx.targets.length === 0 ? "대상을 선택하세요" : null}
      result={
        rows.length > 0 ? (
          <ResultCard
            title={isStart ? "Start Event 결과" : "Stop Event 결과"}
            rows={rows}
            tone={rows.some((r) => r.tone === "bad") ? "error" : "success"}
            raw={raw}
          />
        ) : null
      }
    >
      {nonEventTargets.length > 0 && (
        <p className="text-[12px] text-status-pending">
          recording_mode 가 EVENT 가 아닌 대상 포함: {nonEventTargets.join(", ")} — 서버가 거절할 수
          있음.
        </p>
      )}
      <p className="text-[12px] text-text-secondary">
        auth_token 은 상단 바의 공용 값이 사용됨.
      </p>
    </PanelShell>
  );
}
