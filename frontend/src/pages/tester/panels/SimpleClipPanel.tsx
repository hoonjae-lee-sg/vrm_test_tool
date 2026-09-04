/**
 * 심플 클립 생성(Create Clip) 패널
 * 지정 시각을 포함하는 짧은 클립을 생성함.
 *
 * [이번 개편]
 * · recording_id 입력 제거 — 전역 타겟 사용 + 다중 대상 순차 생성(같은 시각으로 여러
 *   카메라 클립을 뽑는 것이 실제 사용 패턴이라 반복 입력이 사라짐).
 * · epoch 를 손으로 계산하던 부분을 TimestampField(지금/-5s/-30s/-1m/-5m + 미리보기)로 대체.
 * · 응답의 clip_id / file_path / 실제 클립 구간을 구조화해 표시.
 * · seconds 미입력 상태로 요청해 NaN 이 전송되던 문제를 사전 검증으로 차단
 *   (기존 코드는 parseInt("") → NaN 을 그대로 JSON 에 실었고, 서버는 필드 누락으로 처리했음).
 */
import { useState, useEffect, useCallback } from "react";
import PanelShell from "../components/PanelShell";
import ResultCard, { type ResultRow } from "../components/ResultCard";
import TimestampField from "../components/TimestampField";
import { createSimpleClip } from "@/api/recording";
import { fmtIsoTime } from "../lib/format";
import type { SimpleClipResp } from "@/api/recording";
import type { TesterCtx } from "../types";

export default function SimpleClipPanel({ ctx }: { ctx: TesterCtx }) {
  /** 클립 기준 시각 (epoch 초) */
  const [seconds, setSeconds] = useState("");
  /** 나노초 */
  const [nanos, setNanos] = useState("0");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [raw, setRaw] = useState<unknown>(undefined);

  /** 서버는 ts 를 필수로 요구하므로 숫자 여부를 미리 검증 */
  const secNum = Number(seconds);
  const tsInvalid = seconds.trim() === "" || !Number.isFinite(secNum) || secNum <= 0;
  const blocked =
    ctx.targets.length === 0 ? "대상을 선택하세요" : tsInvalid ? "timestamp 필요" : null;

  const handleSubmit = useCallback(async () => {
    if (ctx.targets.length === 0 || tsInvalid) return;
    const nanosNum = Number(nanos) || 0;

    const results = await ctx.runner.runBatch<SimpleClipResp>(ctx.targets, (target) => ({
      label: "Create Clip",
      method: "POST",
      endpoint: "/api/clip/simple",
      target,
      request: { recording_id: target, seconds: secNum, nanos: nanosNum },
      fn: () => createSimpleClip(target, secNum, nanosNum),
    }));

    const next: ResultRow[] = [];
    for (const r of results) {
      if (!r.ok) {
        next.push({ label: r.target ?? "-", value: r.error ?? "실패", tone: "bad", mono: true });
        continue;
      }
      const s = r.data?.success;
      if (!s) {
        next.push({
          label: r.target ?? "-",
          value: r.data?.error?.message ?? "success 페이로드 없음",
          tone: "bad",
          mono: true,
        });
        continue;
      }
      next.push({
        label: `${r.target} · clip_id`,
        value: s.clip_id ?? "—",
        tone: "good",
        mono: true,
      });
      next.push({ label: `${r.target} · file_path`, value: s.file_path ?? "—", mono: true });
      next.push({
        label: `${r.target} · 구간`,
        value: `${fmtIsoTime(s.clip_start_ts)} → ${fmtIsoTime(s.clip_end_ts)} (${
          s.clip_length_ms ?? "?"
        } ms)`,
        mono: true,
      });
    }
    setRows(next);
    setRaw(results[results.length - 1]?.data);

    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0) ctx.showToast(`클립 생성 성공 (${results.length}건)`, "success");
    else ctx.showToast(`클립 생성 실패 ${failed}/${results.length}건`, "error");
  }, [ctx, nanos, secNum, tsInvalid]);

  useEffect(() => {
    ctx.registerSubmit(handleSubmit);
    return () => ctx.registerSubmit(null);
  }, [ctx, handleSubmit]);

  return (
    <PanelShell
      title="Create Clip"
      method="POST"
      endpoint="/api/clip/simple"
      description="지정 시각을 포함하는 짧은 클립을 생성함. 시각은 필수이며 녹화 보관 구간 안이어야 함."
      targets={ctx.targets}
      actionLabel="Create Clip"
      onSubmit={handleSubmit}
      loading={ctx.runner.running}
      blockedReason={blocked}
      result={
        rows.length > 0 ? (
          <ResultCard
            title="Clip 결과"
            rows={rows}
            tone={rows.some((r) => r.tone === "bad") ? "error" : "success"}
            raw={raw}
          />
        ) : null
      }
    >
      <TimestampField
        seconds={seconds}
        setSeconds={setSeconds}
        nanos={nanos}
        setNanos={setNanos}
      />
    </PanelShell>
  );
}
