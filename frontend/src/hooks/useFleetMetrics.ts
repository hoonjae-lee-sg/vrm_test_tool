import { useEffect, useState } from "react";
import type { Recording } from "@/types/recording";

/**
 * 플리트 메트릭 훅 — Dashboard KPI / Throughput 위젯용
 *
 * 현재 백엔드에 메트릭 전용 엔드포인트가 없어서 클라이언트에서
 * /recordings 응답 + jitter 필드로 대략적인 값만 도출하고,
 * 시계열(스파크라인/throughput)은 비워둡니다.
 *
 * 정식 데이터가 들어오면 아래 TODO 위치만 채우면 됩니다:
 *   - GET /metrics/fleet              → 집계 KPI + 24h 시계열
 *   - GET /metrics/throughput?range=1h → 분 단위 bitrate 시계열
 *   - GET /events/recent?limit=5      → 최근 이벤트 피드
 */

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

/**
 * recordings 배열에서 합성 KPI 추출.
 * 시계열이 필요한 필드는 모두 null — 정식 메트릭 API가 붙기 전까진
 * 카드에 빈 sparkline placeholder가 렌더됩니다.
 */
export function deriveFleetKpi(recordings: Recording[]): FleetKpi {
  const total = recordings.length;
  const running = recordings.filter((r) => r.state === "RUNNING").length;

  return {
    camerasOnline: running,
    camerasTotal: total,
    aggregateBitrateMbps: null,
    meanDriftMs: null,
    diskUsedPct: null,
    camerasOnlineSeries: null,
    bitrateSeries: null,
    driftSeries: null,
    diskSeries: null,
  };
}

/**
 * Throughput 위젯 데이터 훅.
 * TODO: GET /metrics/throughput?range=1h 가 생기면 여기서 fetch.
 */
export function useThroughput(_intervalMs: number = 30_000): ThroughputData {
  return {
    bitrateSeries: null,
    peakMbps: null,
    framesIn: null,
    framesDropped: null,
    dropPct: null,
  };
}

/**
 * 최근 이벤트 피드 훅.
 * TODO: GET /events/recent?limit=5 가 생기면 여기서 fetch.
 */
export function useRecentEvents(_limit: number = 5): {
  events: RecentEvent[];
  loading: boolean;
} {
  const [events] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    /* placeholder: 실제 API 붙으면 여기서 fetch */
    setLoading(false);
  }, []);
  return { events, loading };
}
