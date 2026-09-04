/**
 * 실시간 이벤트 피드 — `GET /api/events/stream` (SSE) 구독 결과 표시.
 *
 * [이 패널의 역할]
 * EventClipPage 의 검증 포인트는 "이벤트 발생 버튼을 눌렀을 때 서버가 실제로 이벤트를
 * 흘려보내는가" 임. 그래서 단순 목록이 아니라
 *   · 연결 상태(연결됨/연결 중/재연결 중/끊김)
 *   · 이번 구독에서 받은 푸시 건수 + 마지막 수신 시각
 * 을 항상 같이 보여줌. 목록이 비어 있을 때 "서버가 안 보낸 것" 인지 "연결이 끊긴 것"
 * 인지 구분되지 않으면 테스트 도구로서 쓸모가 없기 때문임.
 *
 * 프리로드(`/api/events/recent`)로 채워진 과거분과 SSE 푸시가 한 목록에 섞이므로,
 * 구독 시작 이후 도착한 건에는 NEW 표식을 붙여 눈으로 구분 가능하게 함.
 */
import {
  ArrowPathIcon,
  BoltIcon,
  CircleStackIcon,
  ClockIcon,
  FilmIcon,
  SignalIcon,
  SignalSlashIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import type { EventSeverity, FeedEvent } from "@/api/events";
import type { SseStatus } from "@/hooks/useEventStream";
import type { Recording } from "@/types/recording";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";

/** 이벤트 종류별 아이콘/색 — events.py `_TYPE_NAME` 의 7종과 1:1 대응 */
const TYPE_META: Record<
  string,
  { icon: typeof BoltIcon; fg: string; bg: string; label: string }
> = {
  EVENT_TRIGGERED: { icon: BoltIcon, fg: "text-brand", bg: "bg-brand-soft", label: "Triggered" },
  EVENT_CLIP_SAVED: {
    icon: FilmIcon,
    fg: "text-status-running",
    bg: "bg-status-running-soft",
    label: "Clip saved",
  },
  STREAM_LOST: {
    icon: SignalSlashIcon,
    fg: "text-status-error",
    bg: "bg-status-error-soft",
    label: "Stream lost",
  },
  STREAM_RECOVERED: {
    icon: SignalIcon,
    fg: "text-status-running",
    bg: "bg-status-running-soft",
    label: "Recovered",
  },
  DRIFT_WARN: {
    icon: ClockIcon,
    fg: "text-status-pending",
    bg: "bg-status-pending-soft",
    label: "Drift warn",
  },
  DISK_THRESHOLD: {
    icon: CircleStackIcon,
    fg: "text-status-pending",
    bg: "bg-status-pending-soft",
    label: "Disk",
  },
  RESTART: {
    icon: ArrowPathIcon,
    fg: "text-status-stopped",
    bg: "bg-status-stopped-soft",
    label: "Restart",
  },
};

/** 미등록 타입(서버 UNSPECIFIED 포함) 폴백 — 목록이 깨지지 않게 함 */
const FALLBACK_META = {
  icon: QuestionMarkCircleIcon,
  fg: "text-text-muted",
  bg: "bg-bg-subtle",
  label: "Unknown",
};

/** 심각도 배지 스타일 */
const SEV_STYLE: Record<EventSeverity, string> = {
  info: "bg-bg-subtle text-text-secondary",
  warn: "bg-status-pending-soft text-status-pending",
  error: "bg-status-error-soft text-status-error",
};

/** SSE 연결 상태 배지 스타일/문구 */
const STATUS_STYLE: Record<SseStatus, { dot: string; text: string; label: string; pulse: boolean }> = {
  open: { dot: "bg-status-running", text: "text-status-running", label: "연결됨", pulse: true },
  connecting: { dot: "bg-status-pending", text: "text-status-pending", label: "연결 중", pulse: true },
  reconnecting: {
    dot: "bg-status-pending",
    text: "text-status-pending",
    label: "재연결 중",
    pulse: true,
  },
  closed: { dot: "bg-status-error", text: "text-status-error", label: "끊김", pulse: false },
};

/** 심각도 필터 토글에 노출할 값 */
const SEVERITIES: EventSeverity[] = ["info", "warn", "error"];

/** 시:분:초 포맷 옵션 — hour/minute/second 를 명시하지 않고 hour12:false 만 주면
 *  ko-KR 은 "12시 34분 3초" 형태(비고정폭·비제로패딩)를 돌려줌. 우측 정렬 tabular
 *  컬럼이 매초 흔들리므로, useFleetMetrics.fmtEventTime 과 동일하게 필드를 명시해
 *  "12:34:03" 으로 고정함. */
const TIME_FMT: Intl.DateTimeFormatOptions = {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

/** 이벤트 발생 시각 표시 — ts 가 null 인 이벤트(서버가 시각 미설정)도 안전하게 처리 */
function formatEventTime(ts: string | null): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString("ko-KR", TIME_FMT);
}

/** EventFeed Props */
interface EventFeedProps {
  events: FeedEvent[];
  status: SseStatus;
  pushCount: number;
  lastEventAt: number | null;
  /** 구독 시작 시각 — 이보다 나중에 도착한 항목에 NEW 표식 */
  subscribedAt: number;
  /** 필터: 특정 녹화만 (빈 문자열 = 전체) */
  filterRecordingId: string;
  setFilterRecordingId: (id: string) => void;
  /** 필터: 심각도 (빈 배열 = 전체) */
  filterSeverity: EventSeverity[];
  toggleSeverity: (sev: EventSeverity) => void;
  /** 필터 드롭다운에 채울 녹화 목록 */
  recordings: Recording[];
  /** 구독 일시정지 토글 */
  paused: boolean;
  setPaused: (v: boolean) => void;
  /** 화면 목록 비우기 */
  onClear: () => void;
}

export default function EventFeed({
  events,
  status,
  pushCount,
  lastEventAt,
  subscribedAt,
  filterRecordingId,
  setFilterRecordingId,
  filterSeverity,
  toggleSeverity,
  recordings,
  paused,
  setPaused,
  onClear,
}: EventFeedProps) {
  const st = STATUS_STYLE[status];

  return (
    <section className="bg-card border border-border rounded-lg shadow-card flex flex-col min-w-0">
      {/* ── 헤더: 제목 + 연결 상태 ── */}
      <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
            SSE · /api/events/stream
          </div>
          <h2 className="text-[14px] font-semibold font-display text-text-primary tracking-tight">
            실시간 이벤트 피드
          </h2>
        </div>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap bg-bg-subtle ${st.text}`}
          data-testid="sse-status"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${st.dot} ${st.pulse ? "animate-breathe" : ""}`} />
          {paused ? "일시정지" : st.label}
        </span>
      </div>

      {/* ── 필터 + 수신 카운터 ── */}
      <div className="px-4 py-2.5 border-b border-border-subtle flex flex-wrap items-center gap-2">
        <select
          value={filterRecordingId}
          onChange={(e) => setFilterRecordingId(e.target.value)}
          aria-label="이벤트 필터 — 녹화 ID"
          className="h-7 px-2 bg-bg-input border border-border rounded-md text-[12px] text-text-primary hover:border-border-strong focus:border-brand outline-none transition-colors max-w-[160px]"
        >
          <option value="">전체 채널</option>
          {recordings.map((r) => (
            <option key={r.recording_id} value={r.recording_id}>
              {r.recording_id}
            </option>
          ))}
        </select>

        {/* 심각도 토글 — 아무것도 안 켜면 서버 기본(전체) */}
        <div className="flex items-center gap-1">
          {SEVERITIES.map((sev) => {
            const on = filterSeverity.includes(sev);
            return (
              <button
                key={sev}
                onClick={() => toggleSeverity(sev)}
                aria-pressed={on}
                className={`h-7 px-2 rounded-md text-[11px] font-medium uppercase tracking-wide border transition-colors ${
                  on
                    ? "bg-brand-soft border-brand/30 text-brand"
                    : "bg-card border-border text-text-muted hover:border-border-strong hover:text-text-secondary"
                }`}
              >
                {sev}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-text-muted tabular whitespace-nowrap" data-testid="sse-push-count">
            push {pushCount}
            {lastEventAt && ` · ${new Date(lastEventAt).toLocaleTimeString("ko-KR", TIME_FMT)}`}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPaused(!paused)}>
            {paused ? "재개" : "일시정지"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear}>
            비우기
          </Button>
        </div>
      </div>

      {/* ── 목록 ──
          xl 이상에서만 높이를 고정해 페이지가 아니라 목록 안에서 스크롤되게 하고,
          그 미만(세로 스택 레이아웃)에서는 자연 높이로 두어 이중 스크롤을 만들지 않음 */}
      <div className="overflow-y-auto xl:max-h-[calc(100vh-260px)] min-h-[120px]">
        {events.length === 0 ? (
          <EmptyState
            icon={<BoltIcon className="w-5 h-5" />}
            message="이벤트 없음"
            description="이벤트 발생 버튼을 누르면 EVENT_TRIGGERED 가, 종료하면 EVENT_CLIP_SAVED 가 여기에 나타남."
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {events.map((ev) => {
              const meta = TYPE_META[ev.type] ?? FALLBACK_META;
              const Icon = meta.icon;
              /* 구독 이후 도착분 표식 — ts 가 없으면 판정 불가하므로 표식 생략 */
              const isNew = ev.ts ? new Date(ev.ts).getTime() >= subscribedAt : false;
              const metaKeys = Object.keys(ev.meta ?? {});
              return (
                <li key={String(ev.id)} className="px-4 py-2.5 flex gap-2.5 animate-fade-in">
                  <span
                    className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center ${meta.bg} ${meta.fg}`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[12px] font-semibold ${meta.fg}`}>{meta.label}</span>
                      <span
                        className={`px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wide ${
                          SEV_STYLE[ev.severity] ?? SEV_STYLE.info
                        }`}
                      >
                        {ev.severity}
                      </span>
                      {isNew && (
                        <span className="px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wide bg-brand text-white">
                          new
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-text-muted tabular font-mono whitespace-nowrap">
                        {formatEventTime(ev.ts)}
                      </span>
                    </div>
                    <div className="text-[12px] text-text-primary break-words mt-0.5">{ev.message}</div>
                    <div className="text-[11px] text-text-muted font-mono break-all mt-0.5">
                      {ev.recording_id || "-"}
                      {ev.type ? ` · ${ev.type}` : ""}
                    </div>
                    {metaKeys.length > 0 && (
                      <div className="text-[11px] text-text-secondary font-mono break-all mt-1 bg-bg-subtle rounded px-2 py-1">
                        {JSON.stringify(ev.meta)}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
