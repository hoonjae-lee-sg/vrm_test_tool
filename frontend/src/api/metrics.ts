import apiClient from "./client";

/**
 * 플리트 메트릭 API 호출 모듈
 *
 * 백엔드(FastAPI) 라우터 `backend/routers/metrics.py` 가 gRPC FleetMetrics 서비스를
 * 프록시하는 3종 엔드포인트를 감쌈. 타입은 2026-09-02 실측 응답을 그대로 반영함
 * (`curl http://localhost:8100/api/metrics/fleet` 등).
 *
 * 주의 — 실측에서 확인된 결측/부분 응답 특성:
 *  · `sparklines.bitrate_24h` 는 관측 이전 구간이 **null 원소**로 채워져 옴.
 *    → 소비 측에서 반드시 null 을 걸러야 차트 좌표 계산이 NaN 으로 깨지지 않음.
 *  · `sparklines.frames_24h` 는 proto uint64 라 **문자열**로 내려옴.
 *  · `/metrics/throughput` 의 `totals` 는 서버 구현에 따라 `frames_in` 만 존재하고
 *    `frames_dropped` / `drop_rate` 가 빠질 수 있음 → 전부 optional 로 선언함.
 */

/* ────────────────── /api/metrics/fleet ────────────────── */

/** 플리트 집계 KPI */
export interface FleetKpiRaw {
  /** RUNNING 상태 카메라 수 */
  cameras_running?: number;
  /** 등록된 전체 카메라 수 */
  cameras_total?: number;
  /** 전체 합산 비트레이트 (Mbps) */
  bitrate_total_mbps?: number;
  /** 최근 최대 sync drift (ms) */
  drift_max_ms?: number;
  /** drift 최대치를 낸 녹화 ID */
  drift_max_recording_id?: string;
  /** 사용 중 디스크 (GB) */
  disk_used_gb?: number;
  /** 전체 디스크 (GB) */
  disk_total_gb?: number;
}

/** 24시간 시계열 (1시간 버킷 × 24) */
export interface FleetSparklinesRaw {
  /** 시간당 평균 비트레이트 Mbps — 관측 이전 버킷은 null */
  bitrate_24h?: (number | null)[];
  /** 시간당 drift ms */
  drift_24h?: (number | null)[];
  /** 누적 수신 프레임 수 (uint64 → 문자열) */
  frames_24h?: (string | number | null)[];
}

/** `/api/metrics/fleet` 응답 */
export interface FleetMetricsResp {
  kpi?: FleetKpiRaw;
  sparklines?: FleetSparklinesRaw;
  /** 스냅샷 생성 시각 (ISO8601) */
  generated_at?: string;
}

/** 플리트 KPI + 24h 스파크라인 조회 */
export async function fetchFleetMetrics(): Promise<FleetMetricsResp> {
  const res = await apiClient.get<FleetMetricsResp>("/metrics/fleet");
  return res.data ?? {};
}

/* ────────────────── /api/metrics/throughput ────────────────── */

/** 처리량 시계열 한 점 */
export interface ThroughputPoint {
  /** 버킷 시작 시각 (ISO8601) */
  ts?: string;
  /** 해당 버킷 평균 비트레이트 (Mbps) */
  bitrate_mbps?: number;
  /** 해당 버킷 수신 프레임 수 */
  frames_in?: number;
  /** 해당 버킷 드롭 프레임 수 (서버가 제공하지 않을 수 있음) */
  frames_dropped?: number;
}

/** `/api/metrics/throughput` 응답 */
export interface ThroughputResp {
  range?: string;
  bucket_seconds?: number;
  points?: ThroughputPoint[];
  totals?: {
    frames_in?: number;
    frames_dropped?: number;
    drop_rate?: number;
  };
}

/** 시계열 처리량 조회
 *  @param range  1h / 6h / 24h
 *  @param bucket 1m / 5m / 1h
 */
export async function fetchThroughput(
  range: string = "1h",
  bucket: string = "1m"
): Promise<ThroughputResp> {
  const res = await apiClient.get<ThroughputResp>("/metrics/throughput", {
    params: { range, bucket },
  });
  return res.data ?? {};
}

/* ────────────────── /api/storage/usage ────────────────── */

/** 녹화별 디스크 사용량 */
export interface StorageByRecording {
  recording_id?: string;
  used_gb?: number;
  retention_days?: number;
}

/** `/api/storage/usage` 응답 */
export interface StorageUsageResp {
  total_gb?: number;
  used_gb?: number;
  free_gb?: number;
  by_type?: {
    hls_segments_gb?: number;
    snapshots_gb?: number;
    event_clips_gb?: number;
  };
  by_recording?: StorageByRecording[];
  /** 가장 오래된 세그먼트 시각 (ISO8601) */
  oldest_segment_at?: string | null;
}

/** 디스크 사용량 분류 통계 조회 */
export async function fetchStorageUsage(): Promise<StorageUsageResp> {
  const res = await apiClient.get<StorageUsageResp>("/storage/usage");
  return res.data ?? {};
}
