/**
 * 스냅샷 촬영(Take Snapshot) 패널
 *
 * [이번 개편에서 고친 것 — 중요]
 * 1. **미리보기가 전혀 뜨지 않던 버그 수정.** 기존 코드는 `result.file.path` 를 읽어
 *    `http://host:18071<path>` 를 만들었지만, 백엔드 `/api/snapshot` 응답은
 *    `_build_snapshot_result` 가 만드는 `{image_data, actual_timestamp, is_pts_synced,
 *    auto_sync_offset_ms}` 이며 `file` 키 자체가 없음. 따라서 imagePath 는 항상
 *    undefined 였고 그리드는 영원히 비어 있었음. 이제 `image_data`(data URI)를 직접 씀.
 * 2. **로그 폭주 차단.** 성공 응답에는 수백 KB~수 MB 의 base64 문자열이 들어 있는데
 *    이를 그대로 로그에 JSON.stringify 하면 페이지가 멈춤. 로그로 넘기기 전에
 *    이미지 본문을 요약 토큰으로 치환함(lib/sanitize.ts).
 * 3. **strategy / max_offset_ms 노출.** 프레임 선택 전략은 스냅샷 정확도 테스트의 핵심
 *    변수인데 UI 에 없어 curl 로만 바꿔볼 수 있었음.
 * 4. 다중 대상 순차 촬영 + 촬영 이력에 대상/전략/PTS 동기화 여부 표기.
 */
import { useState, useEffect, useCallback } from "react";
import FormField from "@/components/FormField";
import Button from "@/components/Button";
import PanelShell from "../components/PanelShell";
import TimestampField from "../components/TimestampField";
import { takeSnapshot, FRAME_SELECTION_STRATEGIES } from "@/api/recording";
import { fmtEpochSeconds } from "../lib/format";
import type { SnapshotResp } from "@/api/recording";
import type { TesterCtx } from "../types";

/** 촬영 이력 항목 */
interface SnapshotItem {
  /** 렌더 키 */
  key: number;
  /** 대상 recording_id */
  target: string;
  /** data:image/jpeg;base64,... */
  url: string;
  /** 서버가 실제로 고른 프레임의 시각 (표시용) */
  actual: string;
  /** PTS 기반 동기화 여부 — false 면 폴백 타임스탬프라 신뢰도가 낮음 */
  ptsSynced: boolean;
  /** 자동 학습된 동기화 오프셋 (ms) */
  offsetMs: number;
  /** 사용한 프레임 선택 전략 라벨 */
  strategy: string;
}

/** 이력 최대 보관 수 — 이미지가 data URI 라 메모리를 먹으므로 상한을 둠 */
const MAX_HISTORY = 12;

export default function SnapshotPanel({ ctx }: { ctx: TesterCtx }) {
  /** 타임스탬프 (비우면 최신 프레임) */
  const [seconds, setSeconds] = useState("");
  const [nanos, setNanos] = useState("0");
  /** 프레임 선택 전략 (빈 문자열 = 서버 기본값) */
  const [strategy, setStrategy] = useState("");
  /** 허용 오차 (ms, 빈 문자열 = 서버 기본 2000) */
  const [maxOffsetMs, setMaxOffsetMs] = useState("");
  /** 촬영 이력 (최신 순) */
  const [history, setHistory] = useState<SnapshotItem[]>([]);
  /** 이력 키 카운터 */
  const [seq, setSeq] = useState(0);

  const handleSubmit = useCallback(async () => {
    if (ctx.targets.length === 0) return;

    const secNum = seconds.trim() === "" ? undefined : Number(seconds);
    const nanosNum = seconds.trim() === "" ? undefined : Number(nanos) || 0;
    const strategyNum = strategy === "" ? undefined : Number(strategy);
    const offsetNum = maxOffsetMs.trim() === "" ? undefined : Number(maxOffsetMs);
    const strategyLabel =
      FRAME_SELECTION_STRATEGIES.find((s) => s.value === strategy)?.label ?? "기본";

    const results = await ctx.runner.runBatch<SnapshotResp>(ctx.targets, (target) => ({
      label: "Take Snapshot",
      method: "POST",
      endpoint: "/api/snapshot",
      target,
      request: {
        recording_id: target,
        seconds: secNum,
        nanos: nanosNum,
        strategy: strategyNum,
        max_offset_ms: offsetNum,
      },
      fn: () => takeSnapshot(target, secNum, nanosNum, strategyNum, offsetNum),
    }));

    /* 성공 건만 이력 앞쪽에 추가 — 오래된 항목은 잘라 메모리 상한 유지 */
    const added: SnapshotItem[] = [];
    let key = seq;
    for (const r of results) {
      if (!r.ok || !r.data?.image_data) continue;
      key += 1;
      added.push({
        key,
        target: r.target ?? "",
        url: r.data.image_data,
        actual: fmtEpochSeconds(r.data.actual_timestamp?.seconds),
        ptsSynced: r.data.is_pts_synced !== false,
        offsetMs: Number(r.data.auto_sync_offset_ms ?? 0),
        strategy: strategyLabel,
      });
    }
    setSeq(key);
    if (added.length > 0) setHistory((prev) => [...added, ...prev].slice(0, MAX_HISTORY));

    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0) ctx.showToast(`스냅샷 ${results.length}장 촬영 완료`, "success");
    else ctx.showToast(`스냅샷 실패 ${failed}/${results.length}건`, "error");
  }, [ctx, maxOffsetMs, nanos, seconds, seq, strategy]);

  useEffect(() => {
    ctx.registerSubmit(handleSubmit);
    return () => ctx.registerSubmit(null);
  }, [ctx, handleSubmit]);

  return (
    <PanelShell
      title="Take Snapshot"
      method="POST"
      endpoint="/api/snapshot"
      description="지정 시각(또는 최신) 프레임을 JPEG 로 추출함. 응답의 image_data(data URI)를 그대로 미리보기에 사용."
      targets={ctx.targets}
      actionLabel="Take Snapshot"
      onSubmit={handleSubmit}
      loading={ctx.runner.running}
      blockedReason={ctx.targets.length === 0 ? "대상을 선택하세요" : null}
      actionsExtra={
        history.length > 0 ? (
          <Button variant="secondary" size="md" onClick={() => setHistory([])}>
            이력 비우기
          </Button>
        ) : undefined
      }
      result={
        history.length > 0 ? (
          <div>
            <h3 className="text-[12px] font-semibold text-text-primary mb-2">
              촬영 이력 ({history.length})
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {history.map((snap) => (
                <figure key={snap.key} className="relative">
                  <img
                    src={snap.url}
                    alt={`${snap.target} snapshot`}
                    className="w-full aspect-video object-cover rounded border border-border bg-bg-canvas"
                  />
                  {/* 대상 ID — 다중 촬영 시 어느 카메라인지 구분 */}
                  <span className="absolute top-1 left-1 text-[9px] bg-black/70 text-white px-1 rounded font-mono max-w-[90%] truncate">
                    {snap.target}
                  </span>
                  {/* PTS 동기화 실패는 타임스탬프 신뢰도 문제이므로 눈에 띄게 */}
                  {!snap.ptsSynced && (
                    <span className="absolute top-1 right-1 text-[9px] bg-status-error text-white px-1 rounded">
                      PTS?
                    </span>
                  )}
                  <figcaption className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1">
                    <span className="text-[9px] bg-black/70 text-white px-1 rounded tabular truncate">
                      {snap.actual}
                    </span>
                    {snap.offsetMs !== 0 && (
                      <span className="text-[9px] bg-black/70 text-white px-1 rounded tabular">
                        {snap.offsetMs > 0 ? "+" : ""}
                        {snap.offsetMs}ms
                      </span>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="text-[11px] text-text-muted mt-2">
              전략: {history[0].strategy} · 최대 {MAX_HISTORY}장 보관 (초과분은 자동 삭제)
            </p>
          </div>
        ) : null
      }
    >
      <TimestampField
        seconds={seconds}
        setSeconds={setSeconds}
        nanos={nanos}
        setNanos={setNanos}
        optional
        emptyHint="비어 있음 — 서버가 가장 최근 프레임을 선택함"
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Frame Selection Strategy" value={strategy} onChange={setStrategy}>
          {FRAME_SELECTION_STRATEGIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </FormField>
        <FormField
          label="max_offset_ms (기본 2000)"
          value={maxOffsetMs}
          onChange={setMaxOffsetMs}
          type="number"
          placeholder="2000"
        />
      </div>

      <p className="text-[11px] text-text-muted">
        PRECISE 는 요청 시각에 가장 가까운 프레임을 디코딩해 반환하므로 키프레임 전략보다 느릴 수
        있음. max_offset_ms 를 넘어서면 서버가 실패로 응답함.
      </p>
    </PanelShell>
  );
}
