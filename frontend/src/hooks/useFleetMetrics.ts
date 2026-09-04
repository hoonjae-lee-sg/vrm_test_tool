import { useEffect, useRef, useState } from "react";
import type { Recording } from "@/types/recording";
import {
  fetchFleetMetrics,
  fetchThroughput,
  type FleetMetricsResp,
  type FleetSparklinesRaw,
} from "@/api/metrics";
import { fetchRecentEvents, type FeedEvent } from "@/api/events";

/**
 * 플리트 메트릭 훅 — Dashboard KPI / Throughput / Recent activity 위젯용
 *
 * [2026-09 개편 — 미배선 결함 수정]
 * 이전 주석은 "백엔드에 메트릭 전용 엔드포인트가 없어서" 라고 적혀 있었으나 **사실이 아님**.
 * 실측(2026-09-02) 결과 아래 3종이 모두 HTTP 200 + 실데이터로 응답하고 있었고,
 * 프론트가 호출을 아예 하지 않아 대시보드 본체가 빈 값(—)으로만 보였음:
 *   - GET /api/metrics/fleet              → KPI + 24h 스파크라인
 *   - GET /api/metrics/throughput?range=1h → 분 단위 bitrate 시계열 + totals
 *   - GET /api/events/recent?limit=N      → 최근 이벤트 피드
 * 이 파일에서 위 3종을 실제로 호출하도록 배선함.
 *
 * [deriveFleetKpi 가 훅이 아닌 이유]
 * 호출부(DashboardPage)는 `useMemo(() => deriveFleetKpi(recordings), [recordings])` 형태라
 * 시그니처를 바꿀 수 없음(해당 파일은 다른 작업 범위). 그래서 fleet 스냅샷은
 * **모듈 전역 캐시 + 지연 시작 폴러**로 유지하고 deriveFleetKpi 는 그 캐시를 동기 조회함.
 * 재렌더는 호출부의 녹화 목록 폴링(3초)이 이미 매번 새 배열을 만들어 useMemo 를
 * 무효화하므로, fetch 완료 후 최대 3초 안에 화면에 반영됨.
 * 폴러는 소비자가 사라지면(마지막 조회 후 IDLE_STOP_MS 경과) 스스로 멈춤 — 페이지를
 * 떠난 뒤에도 타이머가 영원히 도는 것을 방지함.
 */

/* ────────────────── 공개 타입 ────────────────── */

export interface FleetKpi {
  /** RUNNING 카메라 수 */
  camerasOnline: number;
  /** 전체 카메라 수 */
  camerasTotal: number;
  /** 합산 비트레이트 Mbps. null = 데이터 없음 */
  aggregateBitrateMbps: number | null;
  /** 24시간 평균 sync drift (ms). null = 데이터 없음 */
  meanDriftMs: number | null;
  /** 디스크 사용률 0-100. null = 데이터 없음 */
  diskUsedPct: number | null;

  /** 카메라 온라인 추이 sparkline */
  camerasOnlineSeries: number[] | null;
  /** 비트레이트 추이 sparkline */
  bitrateSeries: number[] | null;
  /** drift 추이 sparkline */
  driftSeries: number[] | null;
  /** 디스크 추이 sparkline */
  diskSeries: number[] | null;
}

export interface ThroughputData {
  /** 60분 비트레이트 Mbps 시계열 */
  bitrateSeries: number[] | null;
  /** 피크 Mbps */
  peakMbps: number | null;
  /** 누적 frames in */
  framesIn: number | null;
  /** 누적 dropped frames */
  framesDropped: number | null;
  /** drop ratio (%) */
  dropPct: number | null;
}

export interface RecentEvent {
  /** HH:MM 또는 ISO */
  time: string;
  /** 짧은 제목 (e.g. CAM-D09-301) */
  title: string;
  /** 부가 설명 */
  subtitle: string;
  /** 의미 색상 */
  tone: "ok" | "warn" | "error" | "info" | "muted";
}

/* ────────────────── 폴링 주기 상수 ────────────────── */

/** fleet 스냅샷 갱신 주기 — KPI 는 시간 버킷 단위라 잦게 받을 이유가 없음 */
const FLEET_POLL_MS = 15_000;
/** 마지막 조회 후 이 시간이 지나면 폴러 자동 정지 (소비자 언마운트 감지) */
const FLEET_IDLE_STOP_MS = 30_000;
/** throughput / events 기본 폴링 주기 */
const THROUGHPUT_POLL_MS = 30_000;
const EVENTS_POLL_MS = 20_000;

/* ────────────────── fleet 스냅샷 모듈 캐시 ────────────────── */

/** 최근 성공한 /metrics/fleet 응답 */
let fleetSnapshot: FleetMetricsResp | null = null;
/** 폴링 타이머 — null 이면 정지 상태 */
let fleetTimer: ReturnType<typeof setInterval> | null = null;
/** deriveFleetKpi 가 마지막으로 호출된 시각 (idle 판정용) */
let fleetLastAccessAt = 0;
/** 중복 요청 방지 플래그 — 느린 응답이 겹쳐 큐가 쌓이는 것 방지 */
let fleetInFlight = false;

/** fleet 스냅샷 1회 갱신 — 실패는 조용히 무시하고 직전 스냅샷을 유지함 */
async function refreshFleetSnapshot(): Promise<void> {
  if (fleetInFlight) return;
  fleetInFlight = true;
  try {
    fleetSnapshot = await fetchFleetMetrics();
  } catch {
    /* 네트워크 오류 시 이전 값 유지 — KPI 가 순간적으로 —로 깜빡이지 않게 함 */
  } finally {
    fleetInFlight = false;
  }
}

/** 폴러 지연 시작 + idle 자동 정지 */
function ensureFleetPolling(): void {
  fleetLastAccessAt = Date.now();
  if (fleetTimer !== null) return;
  void refreshFleetSnapshot();
  fleetTimer = setInterval(() => {
    /* 소비자가 사라진 경우(대시보드 언마운트) 스스로 종료 */
    if (Date.now() - fleetLastAccessAt > FLEET_IDLE_STOP_MS) {
      if (fleetTimer !== null) clearInterval(fleetTimer);
      fleetTimer = null;
      return;
    }
    /* 백그라운드 탭에서는 요청 생략 — 서버 부하 절약 */
    if (typeof document !== "undefined" && document.hidden) return;
    void refreshFleetSnapshot();
  }, FLEET_POLL_MS);
}

/* ────────────────── 스파크라인 정규화 ────────────────── */

/**
 * "관측된 버킷" 마스크 계산.
 * bitrate_24h 는 관측 이전 구간이 **null**, 녹화가 없던 구간이 **0** 으로 내려옴.
 * 두 경우 모두 "값이 없음"이므로 평균/차트에서 제외해야 실제 추세가 왜곡되지 않음.
 * (예: 24버킷 중 앞 8개가 null/0 인데 그대로 평균 내면 drift 가 과소평가됨)
 */
function observedIndices(sp: FleetSparklinesRaw | undefined): number[] {
  const bitrate = sp?.bitrate_24h;
  if (!Array.isArray(bitrate)) return [];
  const idx: number[] = [];
  bitrate.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) idx.push(i);
  });
  return idx;
}

/** 지정 인덱스만 뽑아 유한 숫자 배열로 정규화 (null/문자열/NaN 제거) */
function pickFinite(
  series: (number | string | null)[] | undefined,
  indices: number[]
): number[] {
  if (!Array.isArray(series)) return [];
  const out: number[] = [];
  for (const i of indices) {
    const raw = series[i];
    const n = typeof raw === "string" ? Number(raw) : raw;
    if (typeof n === "number" && Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** 소수 1자리 반올림 — 호출부가 String(...) 으로 그대로 찍는 값(diskUsedPct)에 필요 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 스파크라인은 점이 2개 이상일 때만 의미가 있음 (Sparkline 컴포넌트 규약) */
function seriesOrNull(values: number[]): number[] | null {
  return values.length >= 2 ? values : null;
}

/* ────────────────── KPI 도출 ────────────────── */

/**
 * recordings 배열 + /metrics/fleet 스냅샷을 합쳐 KPI 산출.
 *
 * · camerasOnline/Total 은 **목록 응답 기준**을 우선함 — 바로 아래 카메라 그리드,
 *   상태 칩(running/error/stopped)과 숫자가 어긋나면 오독을 유발하기 때문.
 *   목록이 아직 비어 있으면 서버 집계값으로 대체함.
 * · meanDriftMs 는 관측된 버킷만 평균낸 값(카드 라벨 "Mean drift (24h)" 의미에 맞춤).
 *   관측 버킷이 하나도 없으면 서버가 준 drift_max_ms 로 대체함.
 * · diskUsedPct 는 used/total × 100. 호출부가 String() 으로 찍으므로 미리 반올림함.
 * · camerasOnlineSeries / diskSeries 는 서버가 해당 시계열을 제공하지 않아 null 유지
 *   (Sparkline 이 "no data" placeholder 를 렌더함).
 */
export function deriveFleetKpi(recordings: Recording[]): FleetKpi {
  ensureFleetPolling();

  const total = recordings.length;
  const running = recordings.filter((r) => r.state === "RUNNING").length;

  const kpi = fleetSnapshot?.kpi;
  const sparks = fleetSnapshot?.sparklines;
  const idx = observedIndices(sparks);

  const bitrateSeries = pickFinite(sparks?.bitrate_24h, idx);
  const driftSeries = pickFinite(sparks?.drift_24h, idx);

  /* 24h 평균 drift — 관측 버킷 평균, 없으면 서버 최대치로 대체 */
  const meanDrift =
    driftSeries.length > 0
      ? round1(driftSeries.reduce((a, b) => a + b, 0) / driftSeries.length)
      : typeof kpi?.drift_max_ms === "number"
        ? round1(kpi.drift_max_ms)
        : null;

  /* 디스크 사용률 — total 이 0/미제공이면 계산 불가 */
  const diskUsedPct =
    typeof kpi?.disk_used_gb === "number" &&
    typeof kpi?.disk_total_gb === "number" &&
    kpi.disk_total_gb > 0
      ? round1((kpi.disk_used_gb / kpi.disk_total_gb) * 100)
      : null;

  return {
    camerasOnline: total > 0 ? running : (kpi?.cameras_running ?? 0),
    camerasTotal: total > 0 ? total : (kpi?.cameras_total ?? 0),
    aggregateBitrateMbps:
      typeof kpi?.bitrate_total_mbps === "number" ? kpi.bitrate_total_mbps : null,
    meanDriftMs: meanDrift,
    diskUsedPct,
    /* 서버 미제공 시계열 — 값이 생기면 여기만 채우면 됨 */
    camerasOnlineSeries: null,
    bitrateSeries: seriesOrNull(bitrateSeries),
    driftSeries: seriesOrNull(driftSeries),
    diskSeries: null,
  };
}

/* ────────────────── Throughput ────────────────── */

/** 빈 상태 — fetch 실패/미도착 시 카드가 "—" 로 표시되도록 전 필드 null */
const EMPTY_THROUGHPUT: ThroughputData = {
  bitrateSeries: null,
  peakMbps: null,
  framesIn: null,
  framesDropped: null,
  dropPct: null,
};

/**
 * Throughput 위젯 데이터 훅 — GET /api/metrics/throughput?range=1h&bucket=1m.
 * totals.frames_dropped 는 서버 구현에 따라 없을 수 있어, 없으면 null 을 유지해
 * 카드가 "0" 이 아닌 "—"(미측정)로 표시되게 함. 0 과 미측정을 섞으면 오독이 생김.
 */
export function useThroughput(intervalMs: number = THROUGHPUT_POLL_MS): ThroughputData {
  const [data, setData] = useState<ThroughputData>(EMPTY_THROUGHPUT);
  /* 언마운트 후 setState 방지 플래그 */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    const load = async () => {
      /* 백그라운드 탭에서는 요청 생략 */
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const resp = await fetchThroughput("1h", "1m");
        if (!aliveRef.current) return;

        const points = Array.isArray(resp.points) ? resp.points : [];
        const series = points
          .map((p) => p.bitrate_mbps)
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

        const framesIn =
          typeof resp.totals?.frames_in === "number" ? resp.totals.frames_in : null;
        const framesDropped =
          typeof resp.totals?.frames_dropped === "number"
            ? resp.totals.frames_dropped
            : null;
        /* drop 비율 — 서버가 drop_rate 를 주면 그대로(비율→%), 아니면 직접 계산 */
        const dropPct =
          typeof resp.totals?.drop_rate === "number"
            ? resp.totals.drop_rate * 100
            : framesDropped !== null && framesIn !== null && framesIn > 0
              ? (framesDropped / framesIn) * 100
              : null;

        setData({
          bitrateSeries: seriesOrNull(series),
          peakMbps: series.length > 0 ? Math.max(...series) : null,
          framesIn,
          framesDropped,
          dropPct,
        });
      } catch {
        /* 실패 시 직전 값 유지 — 순간적인 빈 화면 깜빡임 방지 */
      }
    };

    void load();
    const timer = setInterval(() => void load(), intervalMs);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return data;
}

/* ────────────────── Recent activity ────────────────── */

/** 백엔드 severity → 카드 색상 톤 */
const SEVERITY_TONE: Record<string, RecentEvent["tone"]> = {
  error: "error",
  warn: "warn",
  info: "info",
};

/** 이벤트 발생 시각 → HH:MM (좁은 w-9 칸에 들어가도록 시:분만) */
function fmtEventTime(ts: string | null | undefined): string {
  if (!ts) return "--:--";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** FeedEvent → 위젯 표시용 RecentEvent */
function toRecentEvent(e: FeedEvent): RecentEvent {
  return {
    time: fmtEventTime(e.ts),
    /* 제목은 어느 카메라인지가 가장 중요 — 없으면 이벤트 종류로 대체 */
    title: e.recording_id || e.type || "(unknown)",
    /* 부제는 사람이 읽는 메시지, 없으면 종류 표기 */
    subtitle: e.message || e.type || "",
    tone: SEVERITY_TONE[e.severity] ?? "muted",
  };
}

/**
 * 최근 이벤트 피드 훅 — GET /api/events/recent?limit=N.
 * 응답은 {events:[...], total} 래퍼이며 api/events.ts 가 배열로 정규화해 줌.
 */
export function useRecentEvents(limit: number = 5): {
  events: RecentEvent[];
  loading: boolean;
} {
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const feed = await fetchRecentEvents({ limit });
        if (!aliveRef.current) return;
        setEvents(feed.map(toRecentEvent));
      } catch {
        /* 실패 시 직전 목록 유지 */
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    };

    void load();
    const timer = setInterval(() => void load(), EVENTS_POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [limit]);

  return { events, loading };
}
