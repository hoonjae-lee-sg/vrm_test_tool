/**
 * Event Clip 테스트 페이지 — 이벤트를 실제로 발생시키고 그 결과를 눈으로 확인하는 도구.
 *
 * [이 페이지가 검증하려는 것]
 *   버튼(StartEventClip) → 서버 EventBus → SSE 피드 → 종료(StopEventClip) → mp4 산출물
 * 이 한 줄기가 끊김 없이 이어지는가. 그래서 좌측(조작)과 우측(피드)을 한 화면에 두고,
 * 버튼을 누른 직후 우측에 EVENT_TRIGGERED 가 뜨는지를 즉시 대조할 수 있게 배치함.
 *
 * [서버 동작 — 코드와 실측으로 확인한 사실]
 * · recording_mode 는 **검사되지 않음**. recorder_service.cc DoStartEventClip 은
 *   `{recording_id}/hq` 레코더 존재만 확인하므로 CONTINUOUS 녹화도 HTTP 200 으로 수락됨
 *   (실측: 101/CONTINUOUS 에 start → 200, EVENT_TRIGGERED 발행).
 *   문서상 전제는 EVENT 모드지만 UI 가 CONTINUOUS 를 막으면 실제와 어긋나므로,
 *   막지 않고 "모드 검사 없음" 을 안내로 노출함.
 * · HQ 레코더가 없으면(STOPPED/미존재) 404 + detail "HQ recorder not found or not running."
 * · 클립에는 항상 pre_buffer_(최대 300프레임 프리롤)가 앞에 붙음
 *   (recorder.cpp on_h264_sample). 그래서 4초만 걸어도 산출물은 10초 이상이 됨.
 * · start 없이 stop 을 부르면 서버는 거절하지 않고 프리롤만으로 클립을 만들어 200 을 돌려줌.
 *   "이벤트 구간이 아닌 클립" 이 조용히 생기는 셈이라 UI 단에서 순서를 강제함.
 * · 진행 중인 클립에는 3축 상한(프레임 18000 / 512MB / 600초)과 감독 루프 워치독이 있어
 *   stop 이 늦으면 서버가 강제 회수함. 경과 시간과 남은 여유를 화면에 계속 보여줌.
 *
 * [반응형]
 * xl 이상에서 조작/피드 2단, 그 미만은 세로 스택. 카드 폭은 minmax(0,1fr) 로 잡아
 * 내부 mono 경로 문자열이 그리드 트랙을 밀어내지 않게 함(390px 가로 스크롤 방지).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BoltIcon,
  StopIcon,
  FilmIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import { useEventStream } from "@/hooks/useEventStream";
import { startEventClip, stopEventClip } from "@/api/recording";
import { clipPathToUrl } from "@/api/events";
import type { EventSeverity } from "@/api/events";
import { extractApiError } from "@/pages/tester/lib/validation";
import type { Recording } from "@/types/recording";
import {
  EVENT_CLIP_MAX_BYTES_MB,
  EVENT_CLIP_MAX_DURATION_SEC,
  EVENT_CLIP_MAX_FRAMES,
  EVENT_CLIP_REFRESH_INTERVAL_MS,
  EVENT_CLIP_WARN_RATIO,
} from "@/constants";
import Button from "@/components/Button";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import Toast from "@/components/Toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import EventFeed from "./event-clip/EventFeed";

/* ────────────────── 보조 타입/유틸 ────────────────── */

/** 이번 세션에서 생성한 클립 1건 */
interface ClipResult {
  /** 목록 key — clip_id 가 비는 응답도 있을 수 있어 별도 발급 */
  key: string;
  recordingId: string;
  clipId: string;
  /** 서버가 돌려준 원본 파일시스템 경로 */
  clipPath: string;
  /** 재생 가능한 URL (`/data/...`), 변환 불가 시 null */
  url: string | null;
  /** 버튼 기준 이벤트 구간 길이(초) — 서버 산출물은 프리롤만큼 더 김 */
  triggeredSec: number;
  at: number;
}

/** 상태 문자열 정규화 — REST 경로에 따라 enum 숫자로 내려오는 응답 대비 */
function isRunning(rec: Recording): boolean {
  return rec.state === "RUNNING" || rec.state === 2;
}

/** 시:분:초 포맷 — hour/minute/second 를 명시하지 않으면 ko-KR 이
 *  "12시 34분 3초" 형태를 돌려주어 tabular 정렬이 무너짐. 필드를 고정해 "12:34:03" 유지. */
function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** 경과 초 → "M:SS" — 진행 중 카운터 표시용 */
function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ────────────────── 메인 컴포넌트 ────────────────── */

export default function EventClipPage() {
  const { recordings, loading, error: listError, refresh } = useRecordings(EVENT_CLIP_REFRESH_INTERVAL_MS);
  const { toast, showToast } = useToast();

  /** 선택된 대상 — 다중 선택으로 여러 채널에 동시에 이벤트를 걸 수 있음 */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 진행 중인 이벤트 구간 — recording_id → 시작 시각(epoch ms) */
  const [active, setActive] = useState<Record<string, number>>({});
  /** 이번 세션에서 만든 클립 (최신순) */
  const [clips, setClips] = useState<ClipResult[]>([]);
  /** 요청 진행 중 — 버튼 중복 클릭 차단 */
  const [busy, setBusy] = useState(false);
  /** 전체 종료 확인 다이얼로그 */
  const [confirmStopAll, setConfirmStopAll] = useState(false);

  /* ── 피드 필터 ── */
  const [filterRecordingId, setFilterRecordingId] = useState("");
  const [filterSeverity, setFilterSeverity] = useState<EventSeverity[]>([]);
  const [paused, setPaused] = useState(false);

  /** 구독 시작 시각 — 피드의 NEW 표식 기준. 마운트 시 한 번만 고정 */
  const subscribedAtRef = useRef(Date.now());

  const { events, status, pushCount, lastEventAt, clear } = useEventStream({
    recordingId: filterRecordingId,
    severity: filterSeverity,
    enabled: !paused,
  });

  /* ── 경과 시간 틱 ──
     진행 중인 클립이 있을 때만 타이머를 돌림. 상시 500ms 리렌더는 피드 목록까지
     같이 다시 그리게 되어 불필요한 비용이 큼. */
  const [now, setNow] = useState(() => Date.now());
  const hasActive = Object.keys(active).length > 0;
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [hasActive]);

  /* ── 파생 값 ── */
  const runningIds = useMemo(
    () => new Set(recordings.filter(isRunning).map((r) => r.recording_id)),
    [recordings]
  );

  /** 시작 가능한 대상 — 선택됨 + RUNNING + 아직 진행 중이 아님 */
  const startable = useMemo(
    () => [...selected].filter((id) => runningIds.has(id) && active[id] === undefined),
    [selected, runningIds, active]
  );
  /** 종료 가능한 대상 — 선택됨 + 진행 중 */
  const stoppable = useMemo(() => [...selected].filter((id) => active[id] !== undefined), [selected, active]);
  /** 선택했지만 RUNNING 이 아닌 대상 — 서버가 404 로 거절할 조합 */
  const notRunning = useMemo(
    () => [...selected].filter((id) => !runningIds.has(id)),
    [selected, runningIds]
  );
  /** 선택 대상 중 CONTINUOUS 모드 — 거절되지는 않으나 전제와 다르므로 안내 */
  const continuousTargets = useMemo(
    () =>
      [...selected].filter((id) => {
        const rec = recordings.find((r) => r.recording_id === id);
        return rec?.recording_mode !== undefined && rec.recording_mode !== "EVENT";
      }),
    [selected, recordings]
  );
  const activeIds = useMemo(() => Object.keys(active), [active]);

  /* ── 선택 토글 ── */
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllRunning = useCallback(() => {
    setSelected(new Set(recordings.filter(isRunning).map((r) => r.recording_id)));
  }, [recordings]);

  const toggleSeverity = useCallback((sev: EventSeverity) => {
    setFilterSeverity((prev) => (prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]));
  }, []);

  /* ── 이벤트 발생 (StartEventClip) ──
     순차 실행: 같은 VRM 프로세스의 버퍼/락을 건드리는 호출이라 병렬로 던지면
     실패가 서로를 오염시키고 SSE 순서도 뒤섞여 원인 추적이 어려워짐. */
  const handleStart = useCallback(async () => {
    if (startable.length === 0 || busy) return;
    setBusy(true);
    let okCount = 0;
    let lastError = "";
    for (const id of startable) {
      try {
        await startEventClip(id);
        /* 성공한 대상만 진행 중으로 등록 — 실패분이 카운터에 남아 종료를 유도하면 안 됨 */
        setActive((prev) => ({ ...prev, [id]: Date.now() }));
        okCount += 1;
      } catch (err) {
        lastError = `${id}: ${extractApiError(err)}`;
      }
    }
    setBusy(false);
    const failed = startable.length - okCount;
    if (failed === 0) showToast(`이벤트 발생 ${okCount}건 — 피드에서 EVENT_TRIGGERED 확인`, "success");
    else showToast(`실패 ${failed}/${startable.length}건 · ${lastError}`, "error");
  }, [startable, busy, showToast]);

  /* ── 이벤트 종료 (StopEventClip) ── */
  const runStop = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || busy) return;
      setBusy(true);
      const produced: ClipResult[] = [];
      let lastError = "";
      let failed = 0;
      for (const id of ids) {
        const startedAt = active[id];
        try {
          const res = await stopEventClip(id);
          const clipPath = res?.clip_path ?? "";
          produced.push({
            key: `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            recordingId: res?.recording_id || id,
            clipId: res?.clip_id || "",
            clipPath,
            url: clipPathToUrl(clipPath),
            triggeredSec: startedAt ? (Date.now() - startedAt) / 1000 : 0,
            at: Date.now(),
          });
        } catch (err) {
          failed += 1;
          lastError = `${id}: ${extractApiError(err)}`;
        }
        /* 성공/실패와 무관하게 진행 중 표시는 해제 — 실패 시 서버 상태가 불명확하므로
           카운터를 계속 돌리면 워치독 잔여 시간이 거짓이 됨. 다시 걸려면 재시작. */
        setActive((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
      if (produced.length > 0) setClips((prev) => [...produced, ...prev]);
      setBusy(false);
      if (failed === 0) showToast(`이벤트 종료 ${produced.length}건 — 클립 생성됨`, "success");
      else showToast(`실패 ${failed}/${ids.length}건 · ${lastError}`, "error");
    },
    [active, busy, showToast]
  );

  const handleStop = useCallback(() => runStop(stoppable), [runStop, stoppable]);
  const handleStopAll = useCallback(() => {
    setConfirmStopAll(false);
    void runStop(activeIds);
  }, [runStop, activeIds]);

  /* ── 실행 차단 사유 — 순서 오류를 버튼 비활성 + 문구로 막음 ── */
  const startBlocked: string | null =
    selected.size === 0
      ? "대상을 먼저 선택하세요"
      : startable.length === 0
        ? notRunning.length === selected.size
          ? "선택한 대상이 모두 RUNNING 이 아님 — 보낼 수 있는 대상이 없음"
          : /* RUNNING 이 아닌 대상은 애초에 요청에서 빠지므로, 남은 RUNNING 대상 기준으로 사유를 씀 */
            "선택한 RUNNING 대상이 모두 이미 이벤트 진행 중임"
        : null;

  const stopBlocked: string | null =
    selected.size === 0
      ? "대상을 먼저 선택하세요"
      : stoppable.length === 0
        ? "진행 중인 이벤트가 없음 — 먼저 이벤트를 발생시키세요"
        : null;

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-4 min-w-0">
      {/* ══════════ 페이지 헤더 ══════════ */}
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-0.5">
            Event clip
          </div>
          <h1 className="text-[18px] sm:text-[20px] font-semibold font-display text-text-primary tracking-tight">
            이벤트 클립 테스트
          </h1>
          <p className="text-[12px] text-text-secondary mt-1 max-w-2xl">
            버튼으로 이벤트 구간을 열고 닫으면서, 서버가 실제로 이벤트를 발행하고 mp4 클립을
            만들어 내는지 우측 실시간 피드와 대조해 확인함.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-text-muted tabular whitespace-nowrap">
            진행 중 {activeIds.length} · 클립 {clips.length}
          </span>
          <Button variant="secondary" size="sm" onClick={refresh}>
            <ArrowPathIcon className="w-3.5 h-3.5" />
            목록 갱신
          </Button>
        </div>
      </header>

      {/* ══════════ 본문 2단 ══════════ */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
        {/* ────────── 좌: 조작 ────────── */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* ── 1. 대상 선택 ── */}
          <section className="bg-card border border-border rounded-lg shadow-card min-w-0">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2 flex-wrap">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                  Step 1 · GET /api/recordings
                </div>
                <h2 className="text-[14px] font-semibold font-display text-text-primary tracking-tight">
                  대상 선택
                </h2>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={selectAllRunning}>
                  RUNNING 전체
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  선택 해제
                </Button>
              </div>
            </div>

            {/* 갱신 실패 배너 — 목록 자체는 마지막 성공분이 남으므로, 표시된 RUNNING 이
                이미 과거 정보일 수 있음을 알림. 이 상태에서 이벤트 발생을 누르면 실패함. */}
            {listError && recordings.length > 0 && (
              <div className="mx-3 mt-3 flex gap-2 items-start px-3 py-2 rounded-md bg-status-error-soft text-status-error">
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-[12px] break-words">
                  목록 갱신 실패 — <span className="font-mono">{listError}</span>. 아래 상태는 마지막
                  성공 시점의 값이라 실제와 다를 수 있음.
                </p>
              </div>
            )}

            <div className="p-3">
              {loading && recordings.length === 0 ? (
                <p className="text-[12px] text-text-muted px-1 py-4">녹화 목록 불러오는 중…</p>
              ) : recordings.length === 0 ? (
                /* 조회 실패와 "정말 녹화가 없음" 을 구분함.
                   VRM(gRPC 50000)이 죽으면 /api/recordings 가 503 을 돌려주는데,
                   이때도 "녹화 없음" 을 띄우면 테스터가 서버 장애를 데이터 없음으로
                   오인함(실측: VRM 중단 시 503 + detail "failed to connect ... :50000"). */
                listError ? (
                  <EmptyState
                    icon={<ExclamationTriangleIcon className="w-5 h-5" />}
                    message="녹화 목록 조회 실패"
                    description={`GET /api/recordings — ${listError}. VRM(gRPC 50000 / HTTP 18071) 이 떠 있는지 확인할 것.`}
                    action={{ label: "다시 조회", onClick: refresh }}
                  />
                ) : (
                  <EmptyState
                    icon={<VideoCameraIcon className="w-5 h-5" />}
                    message="녹화 없음"
                    description="RUNNING 상태의 녹화가 있어야 이벤트 클립을 걸 수 있음."
                    action={{ label: "다시 조회", onClick: refresh }}
                  />
                )
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                  {recordings.map((rec) => {
                    const id = rec.recording_id;
                    const on = selected.has(id);
                    const running = isRunning(rec);
                    const activeSince = active[id];
                    const elapsedSec = activeSince ? (now - activeSince) / 1000 : 0;
                    const ratio = Math.min(1, elapsedSec / EVENT_CLIP_MAX_DURATION_SEC);
                    const warn = ratio >= EVENT_CLIP_WARN_RATIO;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleSelect(id)}
                        aria-pressed={on}
                        data-testid={`target-${id}`}
                        className={`text-left px-3 py-2 rounded-md border transition-colors min-w-0 ${
                          on
                            ? "bg-brand-soft border-brand/30"
                            : "bg-card border-border hover:border-border-strong hover:bg-bg-hover"
                        } ${running ? "" : "opacity-60"}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {/* 체크 표식 — 클릭 대상은 카드 전체이므로 input 은 두지 않음 */}
                          <span
                            className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center ${
                              on ? "bg-brand border-brand" : "bg-card border-border-strong"
                            }`}
                          >
                            {on && (
                              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-white" fill="none">
                                <path
                                  d="M1.5 5.2 3.9 7.5 8.5 2.6"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </span>
                          <span className="text-[13px] font-medium text-text-primary font-mono truncate">
                            {id}
                          </span>
                          <span className="ml-auto shrink-0">
                            <StatusBadge state={rec.state} />
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span
                            className={`px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wide ${
                              rec.recording_mode === "EVENT"
                                ? "bg-brand-soft text-brand"
                                : "bg-bg-subtle text-text-secondary"
                            }`}
                          >
                            {rec.recording_mode || "MODE?"}
                          </span>
                          {rec.jitter?.recent_fps !== undefined && (
                            <span className="text-[10px] text-text-muted tabular">
                              {rec.jitter.recent_fps.toFixed(1)} fps
                            </span>
                          )}
                          {activeSince && (
                            <span
                              className={`ml-auto text-[11px] font-mono tabular font-semibold ${
                                warn ? "text-status-error" : "text-status-running"
                              }`}
                            >
                              ● REC {formatElapsed(elapsedSec)}
                            </span>
                          )}
                        </div>
                        {/* 워치독 진행 바 — 600초 상한 대비 소진율 */}
                        {activeSince && (
                          <div className="mt-1.5 h-1 rounded-full bg-bg-subtle overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-[width] duration-500 ${
                                warn ? "bg-status-error" : "bg-status-running"
                              }`}
                              style={{ width: `${ratio * 100}%` }}
                            />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ── 2. 이벤트 발생/종료 ── */}
          <section className="bg-card border border-border rounded-lg shadow-card min-w-0">
            <div className="px-4 py-3 border-b border-border-subtle">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                Step 2 · POST /api/clip/event/start · stop
              </div>
              <h2 className="text-[14px] font-semibold font-display text-text-primary tracking-tight">
                이벤트 발생
              </h2>
            </div>

            <div className="p-4 flex flex-col gap-3">
              {/* 실행 버튼 줄 — 390px 에서도 두 버튼이 나란히 들어가도록 wrap 허용 */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleStart}
                  disabled={startBlocked !== null}
                  isLoading={busy}
                  data-testid="btn-start-event"
                >
                  <BoltIcon className="w-4 h-4" />
                  이벤트 발생
                  {startable.length > 1 && ` (${startable.length})`}
                </Button>
                <Button
                  variant="destructive"
                  size="lg"
                  onClick={handleStop}
                  disabled={stopBlocked !== null}
                  isLoading={busy}
                  data-testid="btn-stop-event"
                >
                  <StopIcon className="w-4 h-4" />
                  이벤트 종료
                  {stoppable.length > 1 && ` (${stoppable.length})`}
                </Button>
                {activeIds.length > 0 && (
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => setConfirmStopAll(true)}
                    disabled={busy}
                  >
                    진행 중 전체 종료 ({activeIds.length})
                  </Button>
                )}
              </div>

              {/* 차단 사유 — 순서 오류를 문구로 설명 */}
              {(startBlocked || stopBlocked) && (
                <div className="flex flex-col gap-0.5">
                  {startBlocked && (
                    <p className="text-[12px] text-text-muted">
                      <span className="font-medium text-text-secondary">발생 불가</span> — {startBlocked}
                    </p>
                  )}
                  {stopBlocked && (
                    <p className="text-[12px] text-text-muted">
                      <span className="font-medium text-text-secondary">종료 불가</span> — {stopBlocked}
                    </p>
                  )}
                </div>
              )}

              {/* RUNNING 아닌 대상 경고 — 서버가 404 로 거절할 조합 */}
              {notRunning.length > 0 && (
                <div className="flex gap-2 items-start px-3 py-2 rounded-md bg-status-error-soft text-status-error">
                  <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-[12px] break-words">
                    RUNNING 이 아닌 대상 포함: <span className="font-mono">{notRunning.join(", ")}</span> —
                    보낼 경우 서버가 404 <span className="font-mono">
                      HQ recorder not found or not running.
                    </span>{" "}
                    로 거절하므로, <strong>요청 대상에서 제외</strong>하고 RUNNING 인 대상에만 보냄.
                  </p>
                </div>
              )}

              {/* CONTINUOUS 안내 — 거절되지는 않으나 전제와 다름 */}
              {continuousTargets.length > 0 && (
                <div className="flex gap-2 items-start px-3 py-2 rounded-md bg-status-pending-soft text-status-pending">
                  <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-[12px] break-words">
                    CONTINUOUS 모드 대상 포함:{" "}
                    <span className="font-mono">{continuousTargets.join(", ")}</span> — 서버는
                    recording_mode 를 검사하지 않아 <strong>그대로 수락(200)</strong>하고 클립도 생성됨.
                    이벤트 클립의 본래 전제는 EVENT 모드이므로 결과 해석에 주의.
                  </p>
                </div>
              )}

              {/* 서버 상한 안내 — 워치독 강제 회수 조건 */}
              <p className="text-[11px] text-text-muted leading-relaxed border-t border-border-subtle pt-3">
                서버는 진행 중인 클립 버퍼에 3축 상한을 둠 — 프레임{" "}
                <span className="tabular">{EVENT_CLIP_MAX_FRAMES.toLocaleString("ko-KR")}</span>개 ·{" "}
                <span className="tabular">{EVENT_CLIP_MAX_BYTES_MB}MB</span> · 최대{" "}
                <span className="tabular">{EVENT_CLIP_MAX_DURATION_SEC}초</span>. 하나라도 넘으면 감독
                루프가 강제로 회수하므로 종료를 오래 미루면 클립이 서버 판단으로 끊김. 또한 모든 클립
                앞에는 최대 300프레임의 프리롤이 붙어, 짧게 걸어도 산출물은 그보다 길게 나옴.
              </p>
            </div>
          </section>

          {/* ── 3. 생성된 클립 ── */}
          <section className="bg-card border border-border rounded-lg shadow-card min-w-0">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                  Step 3 · clip_id · clip_path
                </div>
                <h2 className="text-[14px] font-semibold font-display text-text-primary tracking-tight">
                  생성된 클립
                </h2>
              </div>
              {clips.length > 0 && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setClips([])}>
                  목록 비우기
                </Button>
              )}
            </div>

            {clips.length === 0 ? (
              <EmptyState
                icon={<FilmIcon className="w-5 h-5" />}
                message="아직 만든 클립 없음"
                description="이벤트를 발생시킨 뒤 종료하면 응답의 clip_id / clip_path 가 여기에 쌓임."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {clips.map((c) => (
                  <li key={c.key} className="px-4 py-3 min-w-0" data-testid="clip-result">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-text-primary font-mono">
                        {c.recordingId}
                      </span>
                      <span className="text-[11px] text-text-muted tabular">
                        {formatClock(c.at)}
                      </span>
                      {c.triggeredSec > 0 && (
                        <span className="text-[11px] text-text-muted tabular">
                          구간 {c.triggeredSec.toFixed(1)}s + 프리롤
                        </span>
                      )}
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto inline-flex items-center gap-1 text-[12px] text-brand hover:text-brand-hover font-medium"
                        >
                          재생
                          <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                        </a>
                      ) : (
                        <span className="ml-auto text-[11px] text-status-error">
                          재생 URL 변환 불가
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-muted font-mono break-all mt-1">
                      clip_id {c.clipId || "(없음)"}
                    </div>
                    <div className="text-[11px] text-text-secondary font-mono break-all mt-0.5">
                      {c.clipPath || "(clip_path 비어 있음 — 서버가 클립을 만들지 못함)"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ────────── 우: 실시간 피드 ────────── */}
        <EventFeed
          events={events}
          status={status}
          pushCount={pushCount}
          lastEventAt={lastEventAt}
          subscribedAt={subscribedAtRef.current}
          filterRecordingId={filterRecordingId}
          setFilterRecordingId={setFilterRecordingId}
          filterSeverity={filterSeverity}
          toggleSeverity={toggleSeverity}
          recordings={recordings}
          paused={paused}
          setPaused={setPaused}
          onClear={clear}
        />
      </div>

      {/* 전체 종료 확인 — 선택 밖의 진행 중 대상까지 끊으므로 되돌릴 수 없음을 알림 */}
      <ConfirmDialog
        isOpen={confirmStopAll}
        onCancel={() => setConfirmStopAll(false)}
        onConfirm={handleStopAll}
        title="진행 중 이벤트 전체 종료"
        message={`진행 중인 ${activeIds.length}건을 모두 종료하고 각각 클립을 생성함. 녹화 자체는 중지되지 않음.`}
        confirmLabel="전체 종료"
        variant="destructive"
        isLoading={busy}
      />

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
