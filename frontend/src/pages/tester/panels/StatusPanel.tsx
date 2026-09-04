/**
 * 녹화 상태 확인(Check Status) 패널
 *
 * [이번 개편]
 * · 응답을 raw JSON 덤프 대신 핵심 지표(state / frames / storage / jitter / drift)로 구조화.
 *   RecordingStatus 는 필드가 16개라 덤프만 봐서는 필요한 값을 눈으로 찾아야 했음.
 * · 다중 대상 순차 조회 — 여러 카메라 상태를 한 번에 비교.
 * · 자동 갱신(watch) 토글 — frames_received 가 실제로 늘고 있는지 지켜보는 것이
 *   이 패널의 주 용도인데, 기존에는 버튼을 계속 눌러야 했음.
 *   watch 중의 폴링은 로그를 오염시키지 않도록 로그를 남기지 않음(수동 실행만 기록).
 *
 * [2026-09 수정 — 결측 필드를 '부정'으로 단정하던 결함]
 * 실측 결과 `/api/recordings/{id}/status` 응답에는 `jitter` 하위 통계와 `ntp_synced` 가
 * **아예 없음**(recording_id/state/created_at/rtsp_url_hq/rtsp_url_sq/storage_used_mbs/
 * start_time 만 옴). 그런데 기존 코드가 `j.healthy ? "true" : "false"` 처럼 undefined 를
 * false 로 접어, 정상 녹화인데도 healthy=false(빨강) / not synced(주황)로 표시했음.
 * 같은 녹화의 `/api/recordings` 는 healthy=true, ntp_synced=true 이고 옆 Check Health
 * 패널은 HEALTHY 를 보여주므로, 진단 도구가 정반대 결론 2개를 동시에 내보이는 상태였음.
 *   → (1) 3-상태 포맷터 boolRow() 도입: 결측 "—"(muted) / true(good) / false(bad|warn) 분리.
 *   → (2) status 응답에 없는 필드는 목록 응답(ctx.recordings)의 같은 녹화 값으로 보강하고,
 *          보강된 값에는 "· 목록" 배지를 붙여 출처를 명시함(추정값으로 오독되지 않게).
 */
import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { getRecordingStatus } from "@/api/recording";
import PanelShell from "../components/PanelShell";
import ResultCard, { type ResultRow, type RowTone } from "../components/ResultCard";
import { extractApiError } from "../lib/validation";
import { fmtCount, fmtFixed, fmtIsoTime, fmtQuotaMbs, rtspRaw } from "../lib/format";
import type { RecordingStatusResp } from "@/api/recording";
import type { Recording } from "@/types/recording";
import type { TesterCtx } from "../types";

/** 조회 결과 한 건 */
interface StatusItem {
  target: string;
  data?: RecordingStatusResp;
  error?: string;
}

/** watch 모드 폴링 주기 */
const WATCH_INTERVAL_MS = 2000;

/** 목록 응답에서 보강한 값임을 알리는 접미 배지 — 출처를 숨기지 않기 위함 */
function listMark(node: ReactNode): ReactNode {
  return (
    <>
      {node} <span className="text-[10px] text-text-muted">· 목록</span>
    </>
  );
}

/**
 * 3-상태 불리언 행.
 * 핵심은 **undefined(결측)를 false 로 접지 않는 것** — 서버가 값을 주지 않은 것과
 * 서버가 "아니오"라고 답한 것은 진단상 전혀 다른 의미임.
 *   undefined → "—" (muted)  /  true → "true"(good)  /  false → "false"(falseTone)
 * @param fromList 목록 응답에서 보강한 값이면 true (배지 표시)
 * @param falseTone false 일 때 색 — healthy 는 bad(빨강), ntp_synced 는 warn(주황)
 */
function boolRow(
  label: string,
  value: boolean | undefined,
  opts: { fromList?: boolean; falseTone?: RowTone } = {}
): ResultRow {
  if (value === undefined) {
    return { label, value: "—", tone: "muted", mono: true };
  }
  const text = value ? "true" : "false";
  return {
    label,
    value: opts.fromList ? listMark(text) : text,
    tone: value ? "good" : (opts.falseTone ?? "bad"),
    mono: true,
  };
}

/**
 * RecordingStatus → 결과 카드 행.
 * @param s  /recordings/{id}/status 응답
 * @param fb 같은 녹화의 목록(/recordings) 항목 — status 가 주지 않는 필드 보강용
 */
function toRows(s: RecordingStatusResp, fb?: Recording): ResultRow[] {
  const j = s.jitter ?? {};

  /* jitter 관련 값 병합 — status 우선, 없으면 목록 값(보강 여부를 함께 기록) */
  const fps = j.recent_fps ?? fb?.jitter?.recent_fps;
  const fpsFromList = j.recent_fps === undefined && fps !== undefined;

  const healthy = j.healthy ?? fb?.jitter?.healthy;
  const healthyFromList = j.healthy === undefined && healthy !== undefined;

  const ntpSynced = j.ntp_synced ?? fb?.ntp_synced;
  const ntpFromList = j.ntp_synced === undefined && ntpSynced !== undefined;

  const fpsText = fmtFixed(fps, 2, " fps");

  return [
    {
      label: "state",
      value: s.state ?? "—",
      tone: s.state === "RUNNING" ? "good" : s.state === "ERROR" ? "bad" : "warn",
    },
    { label: "frames_received", value: fmtCount(s.frames_received), mono: true },
    { label: "storage_used", value: `${fmtCount(s.storage_used_mbs)} MB`, mono: true },
    { label: "hq / sq limit", value: `${fmtQuotaMbs(s.hq_storage_limit_mbs)} / ${fmtQuotaMbs(s.sq_storage_limit_mbs)}`, mono: true },
    { label: "retention_days", value: s.retention_days ?? "—", mono: true },
    { label: "recording_mode", value: s.recording_mode ?? fb?.recording_mode ?? "—" },
    { label: "created_at", value: fmtIsoTime(s.created_at ?? fb?.created_at), mono: true },
    { label: "start_time", value: fmtIsoTime(s.start_time ?? fb?.start_time), mono: true },
    {
      label: "jitter.recent_fps",
      value: fpsFromList ? listMark(fpsText) : fpsText,
      mono: true,
      /* 결측이면 판단 불가 → muted. 0 이하일 때만 warn(스트림 정지 의심) */
      tone: fps === undefined ? "muted" : fps > 0 ? "good" : "warn",
    },
    {
      label: "jitter p50 / p95",
      value:
        j.jitter_ms_p50 === undefined && j.jitter_ms_p95 === undefined
          ? "—"
          : `${fmtFixed(j.jitter_ms_p50, 1)} / ${fmtFixed(j.jitter_ms_p95, 1)} ms`,
      mono: true,
      tone: j.jitter_ms_p50 === undefined && j.jitter_ms_p95 === undefined ? "muted" : "default",
    },
    boolRow("healthy", healthy, { fromList: healthyFromList, falseTone: "bad" }),
    boolRow("ntp_synced", ntpSynced, { fromList: ntpFromList, falseTone: "warn" }),
    {
      label: "drift_ms",
      value: j.drift_ms === undefined ? "—" : `${fmtCount(j.drift_ms)} ms`,
      mono: true,
      tone: j.drift_ms === undefined ? "muted" : "default",
    },
    { label: "last_frame_at", value: fmtIsoTime(j.last_frame_at), mono: true },
    { label: "rtsp_url_hq", value: rtspRaw(s.rtsp_url_hq) || rtspRaw(fb?.rtsp_url_hq) || "—", mono: true },
    { label: "notes", value: s.notes || fb?.notes || "—" },
  ];
}

export default function StatusPanel({ ctx }: { ctx: TesterCtx }) {
  /** 대상별 조회 결과 */
  const [items, setItems] = useState<StatusItem[]>([]);
  /** 자동 갱신 여부 */
  const [watching, setWatching] = useState(false);
  /** 자동 갱신 타이머 */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 타이머 콜백이 항상 최신 타겟을 보도록 하는 ref (setInterval 클로저 고착 방지) */
  const targetsRef = useRef<string[]>(ctx.targets);
  targetsRef.current = ctx.targets;

  /** 로그를 남기지 않는 조용한 조회 — watch 모드 전용 */
  const silentFetch = useCallback(async () => {
    const next: StatusItem[] = [];
    for (const target of targetsRef.current) {
      try {
        next.push({ target, data: await getRecordingStatus(target) });
      } catch (err) {
        next.push({ target, error: extractApiError(err) });
      }
    }
    setItems(next);
  }, []);

  /** watch 토글에 따른 타이머 관리 — 언마운트/토글 해제 시 반드시 정리 */
  useEffect(() => {
    if (!watching) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    void silentFetch();
    timerRef.current = setInterval(() => void silentFetch(), WATCH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [watching, silentFetch]);

  /** 수동 조회 — 이쪽만 로그에 기록됨 */
  const handleSubmit = useCallback(async () => {
    if (ctx.targets.length === 0) return;
    const results = await ctx.runner.runBatch<RecordingStatusResp>(ctx.targets, (target) => ({
      label: "Check Status",
      method: "GET",
      endpoint: `/api/recordings/${target}/status`,
      target,
      fn: () => getRecordingStatus(target),
    }));
    setItems(results.map((r) => ({ target: r.target ?? "", data: r.data, error: r.error })));
  }, [ctx]);

  useEffect(() => {
    ctx.registerSubmit(handleSubmit);
    return () => ctx.registerSubmit(null);
  }, [ctx, handleSubmit]);

  return (
    <PanelShell
      title="Check Status"
      method="GET"
      endpoint="/api/recordings/{id}/status"
      description="RecordingStatus 전체를 조회함. 핵심 지표를 구조화해 보여주고 원본은 접어 둠."
      targets={ctx.targets}
      actionLabel="Check Status"
      onSubmit={handleSubmit}
      loading={ctx.runner.running}
      blockedReason={ctx.targets.length === 0 ? "대상을 선택하세요" : null}
      actionsExtra={
        <button
          onClick={() => setWatching((v) => !v)}
          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium border transition-colors ${
            watching
              ? "bg-brand-soft border-brand/30 text-brand"
              : "bg-white border-border text-text-secondary hover:bg-bg-hover"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              watching ? "bg-brand animate-breathe" : "bg-text-muted"
            }`}
          />
          watch 2s
        </button>
      }
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
                  rows={
                    item.data
                      ? toRows(
                          item.data,
                          /* 같은 녹화의 목록 항목 — status 가 생략한 필드 보강용 */
                          ctx.recordings.find((r) => r.recording_id === item.target)
                        )
                      : []
                  }
                  raw={item.data}
                />
              )
            )}
          </div>
        ) : null
      }
    >
      <p className="text-[12px] text-text-secondary">
        watch 를 켜면 2초마다 조용히 재조회함 (로그에는 기록되지 않음). frames_received 가 실제로
        증가하는지 확인할 때 사용.
      </p>
      <p className="text-[12px] text-text-secondary mt-1.5">
        <span className="text-text-muted">—</span> 는 서버가 해당 필드를 <b>주지 않았다</b>는
        뜻이며 &quot;아니오&quot;가 아님. <span className="font-mono text-[11px]">· 목록</span>{" "}
        배지는 status 응답에 없어 <span className="font-mono text-[11px]">/api/recordings</span>{" "}
        값으로 보강했음을 뜻함.
      </p>
    </PanelShell>
  );
}
