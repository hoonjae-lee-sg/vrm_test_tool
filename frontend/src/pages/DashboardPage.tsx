/**
 * Dashboard 페이지
 * 카메라 상태 모니터링 + 녹화 시작/중지 + 통계 카드
 * - 3초 주기 자동 갱신
 * - mpegts.js 라이브 프리뷰 (SQ 스트림)
 * - 녹화 시작 모달 (프리셋 지원)
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import { startRecording, restartRecording, takeSnapshot, type StartRecordingParams } from "@/api/recording";
import type { Recording } from "@/types/recording";
import { DASHBOARD_REFRESH_INTERVAL_MS } from "@/constants";
import { formatNumber } from "@/utils/format";
import mpegts from "mpegts.js";
import StatusBadge from "@/components/StatusBadge";
import FormField from "@/components/FormField";
import Modal from "@/components/Modal";
import Toast from "@/components/Toast";
import Button from "@/components/Button";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import Sparkline from "@/components/Sparkline";
import { deriveFleetKpi, useThroughput, useRecentEvents } from "@/hooks/useFleetMetrics";
import {
  VideoCameraIcon,
  CameraIcon,
  PlusIcon,
  XMarkIcon,
  ArrowPathIcon,
  StopIcon,
} from "@heroicons/react/24/outline";

/* ────────────────── 프리셋 관련 유틸 ────────────────── */
interface Preset {
  name: string;
  data: Record<string, string>;
}

/** localStorage에서 프리셋 목록 로드 */
const loadPresets = (): Preset[] =>
  JSON.parse(localStorage.getItem("vrm_favorites") || "[]");

/** localStorage에 프리셋 목록 저장 */
const savePresets = (presets: Preset[]) =>
  localStorage.setItem("vrm_favorites", JSON.stringify(presets));

/* ────────────────── 카메라 그리드 드래그 순서 관리 ────────────────── */
const CAMERA_ORDER_KEY = "vrm_camera_order";

/** localStorage에서 카메라 그리드 순서 로드 */
const loadCameraOrder = (): string[] =>
  JSON.parse(localStorage.getItem(CAMERA_ORDER_KEY) || "[]");

/** localStorage에 카메라 그리드 순서 저장 */
const saveCameraOrder = (order: string[]) =>
  localStorage.setItem(CAMERA_ORDER_KEY, JSON.stringify(order));

/* ────────────────── 녹화 시작 모달 폼 초기값 ────────────────── */
interface ModalFormData {
  serialNumber: string;
  hqUrl: string;
  sqUrl: string;
  hqId: string;
  hqPass: string;
  sqId: string;
  sqPass: string;
  mode: string;
  retention: string;
}

const INITIAL_FORM: ModalFormData = {
  serialNumber: "",
  hqUrl: "",
  sqUrl: "",
  hqId: "",
  hqPass: "",
  sqId: "",
  sqPass: "",
  mode: "CONTINUOUS",
  retention: "7",
};

/* ────────────────── 메인 컴포넌트 ────────────────── */
export default function DashboardPage() {
  const { recordings, refresh } = useRecordings(DASHBOARD_REFRESH_INTERVAL_MS);
  const { toast, showToast } = useToast();

  /* 모달 상태 */
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ModalFormData>({ ...INITIAL_FORM });

  /* 녹화 시작 로딩 상태 */
  const [isStarting, setIsStarting] = useState(false);

  /* 프리셋 삭제 확인 다이얼로그 대상 인덱스 */
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  /* 녹화 중지 확인 다이얼로그 대상 ID */
  const [stopTarget, setStopTarget] = useState<string | null>(null);
  /* 녹화 중지 로딩 상태 */
  const [isStopping, setIsStopping] = useState(false);

  /* 폼 유효성 검증 오류 상태 */
  const [formErrors, setFormErrors] = useState<{ hqUrl?: string; sqUrl?: string }>({});

  /* 프리셋 드로어 상태 */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(loadPresets());

  /* ── 카메라 그리드 드래그 재정렬 ── */
  const [cameraOrder, setCameraOrder] = useState<string[]>(loadCameraOrder);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  /** 드래그 중 화면 가장자리 자동 스크롤용 RAF ID */
  const autoScrollRaf = useRef<number | null>(null);
  /** 현재 드래그 마우스 Y 좌표 */
  const dragClientY = useRef<number>(0);

  /** localStorage 순서 맵 기반 정렬 — API 갱신과 독립적으로 순서 유지 */
  const sortedRecordings = useMemo(() => {
    if (cameraOrder.length === 0) return recordings;
    const orderMap = new Map(cameraOrder.map((id, i) => [id, i]));
    return [...recordings].sort((a, b) => {
      const ai = orderMap.get(a.recording_id) ?? Infinity;
      const bi = orderMap.get(b.recording_id) ?? Infinity;
      return ai - bi;
    });
  }, [recordings, cameraOrder]);

  /** 드래그 중 화면 상/하단 가장자리 자동 스크롤 루프
   *  Layout의 <main class="overflow-y-auto"> 가 실제 스크롤 컨테이너이므로
   *  window.scrollBy 대신 해당 엘리먼트를 직접 스크롤 */
  const startAutoScroll = useCallback(() => {
    const EDGE = 80;     // 가장자리 감지 영역 (px)
    const SPEED = 12;    // 스크롤 속도 (px/frame)

    const tick = () => {
      const y = dragClientY.current;
      const vh = window.innerHeight;
      // Layout의 <main> 엘리먼트 탐색 (overflow-y-auto 스크롤 컨테이너)
      const scrollContainer = document.querySelector("main") || document.scrollingElement || document.documentElement;
      if (y < EDGE) {
        scrollContainer.scrollTop -= SPEED;
      } else if (y > vh - EDGE) {
        scrollContainer.scrollTop += SPEED;
      }
      autoScrollRaf.current = requestAnimationFrame(tick);
    };
    autoScrollRaf.current = requestAnimationFrame(tick);
  }, []);

  /** 자동 스크롤 중지 */
  const stopAutoScroll = useCallback(() => {
    if (autoScrollRaf.current !== null) {
      cancelAnimationFrame(autoScrollRaf.current);
      autoScrollRaf.current = null;
    }
  }, []);

  /** 드래그 시작 — document drag 이벤트로 Y 좌표 추적 + 자동 스크롤 시작 */
  const handleDragStart = (idx: number, e: React.DragEvent) => {
    setDragIdx(idx);
    dragClientY.current = e.clientY;
    // document 레벨 drag 이벤트: 카드 밖 빈 공간에서도 Y 좌표 갱신
    const onDrag = (ev: DragEvent) => { if (ev.clientY > 0) dragClientY.current = ev.clientY; };
    document.addEventListener("drag", onDrag);
    // dragend 시 자동 정리
    const cleanup = () => { document.removeEventListener("drag", onDrag); document.removeEventListener("dragend", cleanup); };
    document.addEventListener("dragend", cleanup);
    startAutoScroll();
  };

  /** 드래그 오버 — 드롭 대상 위치 표시 */
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  /** 드롭 — 순서 변경 후 localStorage 저장 */
  const handleDrop = (idx: number) => {
    stopAutoScroll();
    if (dragIdx === null || dragIdx === idx) return;
    const newOrder = sortedRecordings.map((r) => r.recording_id);
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    saveCameraOrder(newOrder);
    setCameraOrder(newOrder);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  /** 드래그 종료 — 시각적 상태 + 자동 스크롤 초기화 */
  const handleDragEnd = () => {
    stopAutoScroll();
    setDragIdx(null);
    setDragOverIdx(null);
  };

  /** 그리드 순서 초기화 — API 원래 순서로 복원 */
  const resetCameraOrder = () => {
    saveCameraOrder([]);
    setCameraOrder([]);
  };

  /* 통계 */
  const running = recordings.filter((r: Recording) => r.state === "RUNNING").length;
  const errors = recordings.filter((r: Recording) => r.state === "ERROR").length;
  const stopped = recordings.filter((r: Recording) => r.state === "STOPPED").length;

  /* 플리트 메트릭 — KPI / Throughput / 최근 이벤트 (시계열은 API 붙기 전까지 빈 상태) */
  const kpi = useMemo(() => deriveFleetKpi(recordings), [recordings]);
  const throughput = useThroughput();
  const { events: recentEvents } = useRecentEvents(5);

  /* ── 모달 열기 — 폼 초기화 및 오류 상태 클리어 ── */
  const openModal = () => {
    setForm({ ...INITIAL_FORM, serialNumber: `SN-${Date.now()}` });
    setFormErrors({});
    setModalOpen(true);
  };

  /* ── 녹화 시작 ── */
  const handleStart = async () => {
    /* 폼 유효성 검증 — URL 미입력 시 오류 표시 */
    const errors: { hqUrl?: string; sqUrl?: string } = {};
    if (!form.hqUrl) errors.hqUrl = "HQ RTSP URL을 입력해주세요.";
    if (!form.sqUrl) errors.sqUrl = "SQ RTSP URL을 입력해주세요.";
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setIsStarting(true);
    try {
      const params: StartRecordingParams = {
        serial_number: form.serialNumber,
        hq_url: form.hqUrl,
        sq_url: form.sqUrl,
        rtsp_hq_username: form.hqId || undefined,
        rtsp_hq_password: form.hqPass || undefined,
        rtsp_sq_username: form.sqId || undefined,
        rtsp_sq_password: form.sqPass || undefined,
        recording_mode: form.mode,
        retention_days: parseInt(form.retention) || 7,
      };
      await startRecording(params);
      setModalOpen(false);
      showToast("녹화가 시작되었습니다.", "success");
    } catch (err: unknown) {
      /* 에러 객체에서 메시지 추출 */
      const message = err instanceof Error ? err.message : "알 수 없는 오류";
      showToast(`녹화 시작 실패: ${message}`, "error");
    } finally {
      setIsStarting(false);
    }
  };

  /* ── 프리셋 적용 ── */
  const applyPreset = (preset: Preset) => {
    setForm({
      serialNumber: form.serialNumber,
      hqUrl: preset.data["hq-url"] || "",
      sqUrl: preset.data["sq-url"] || "",
      hqId: preset.data["hq-id"] || "",
      hqPass: preset.data["hq-pass"] || "",
      sqId: preset.data["sq-id"] || "",
      sqPass: preset.data["sq-pass"] || "",
      mode: preset.data["recording-mode"] || "CONTINUOUS",
      retention: preset.data["retention-days"] || "7",
    });
    setDrawerOpen(false);
    showToast(`프리셋 '${preset.name}' 적용됨`, "info");
  };

  /* ── 프리셋 저장 ── */
  const saveCurrentAsPreset = () => {
    const name = prompt("프리셋 이름을 입력하세요:");
    if (!name) return;
    const data: Record<string, string> = {
      "hq-url": form.hqUrl,
      "sq-url": form.sqUrl,
      "hq-id": form.hqId,
      "hq-pass": form.hqPass,
      "sq-id": form.sqId,
      "sq-pass": form.sqPass,
      "recording-mode": form.mode,
      "retention-days": form.retention,
    };
    const updated = [...presets, { name, data }];
    setPresets(updated);
    savePresets(updated);
    showToast("프리셋이 저장되었습니다.", "success");
  };

  /* ── 프리셋 삭제 확인 후 실행 ── */
  const confirmDeletePreset = () => {
    if (deleteTarget === null) return;
    const updated = presets.filter((_, i) => i !== deleteTarget);
    setPresets(updated);
    savePresets(updated);
    setDeleteTarget(null);
  };

  /* ── 폼 필드 업데이트 헬퍼 ── */
  const updateField = (key: keyof ModalFormData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="px-4 md:px-6 py-5 max-w-[1400px] mx-auto">
      {/* ── 헤더 ── */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-1">Operations</div>
          <h1 className="text-[24px] leading-tight font-semibold font-display text-text-primary tracking-tight">Camera fleet</h1>
        </div>
        <div className="flex items-center gap-2">
          {cameraOrder.length > 0 && (
            <Button variant="ghost" size="sm" onClick={resetCameraOrder}>
              <ArrowPathIcon className="w-3.5 h-3.5" /> 순서 초기화
            </Button>
          )}
          <Button variant="primary" size="md" onClick={openModal}>
            <PlusIcon className="w-4 h-4" /> 녹화 시작
          </Button>
        </div>
      </div>

      {/* ── KPI 카드 — 4열 + sparkline ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <KpiCard
          label="Cameras online"
          value={formatNumber(kpi.camerasOnline)}
          unit={`/ ${kpi.camerasTotal}`}
          spark={kpi.camerasOnlineSeries}
          color="#16A34A"
        />
        <KpiCard
          label="Aggregate bitrate"
          value={kpi.aggregateBitrateMbps !== null ? kpi.aggregateBitrateMbps.toFixed(1) : "—"}
          unit="Mbps"
          spark={kpi.bitrateSeries}
          color="#1F4FE8"
        />
        <KpiCard
          label="Mean drift (24h)"
          value={kpi.meanDriftMs !== null ? kpi.meanDriftMs.toFixed(1) : "—"}
          unit="ms"
          spark={kpi.driftSeries}
          color="#0E1116"
        />
        <KpiCard
          label="Disk used"
          value={kpi.diskUsedPct !== null ? String(kpi.diskUsedPct) : "—"}
          unit="%"
          spark={kpi.diskSeries}
          color="#F59E0B"
        />
      </div>

      {/* ── Throughput + Recent activity 행 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
        {/* Throughput · last 60 min */}
        <div className="lg:col-span-2 bg-card border border-border rounded-md p-4">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-[13px] font-semibold text-text-primary">Throughput · last 60 min</div>
            {throughput.peakMbps !== null && (
              <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
                peak {throughput.peakMbps.toFixed(1)} Mbps
              </div>
            )}
          </div>
          <div className="relative h-[120px] mb-3 -mx-1">
            {throughput.bitrateSeries ? (
              <svg width="100%" height="120" preserveAspectRatio="none" viewBox="0 0 600 120" className="overflow-visible">
                {(() => {
                  const data = throughput.bitrateSeries;
                  const max = Math.max(...data, 1);
                  const min = Math.min(...data, 0);
                  const range = max - min || 1;
                  const w = 600, h = 120;
                  const pts = data.map((v, i) => {
                    const x = (i / (data.length - 1)) * w;
                    const y = h - ((v - min) / range) * (h - 8) - 4;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(" ");
                  return (
                    <>
                      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="#1F4FE8" opacity="0.12" />
                      <polyline points={pts} fill="none" stroke="#1F4FE8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                    </>
                  );
                })()}
              </svg>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-[10px] font-mono text-text-muted/60 uppercase tracking-wider">throughput series unavailable · GET /metrics/throughput</div>
              </div>
            )}
            {throughput.bitrateSeries === null && (
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px] pt-3 border-t border-border-subtle">
            <div>
              <div className="text-text-muted mb-0.5">Frames in</div>
              <div className="font-mono font-semibold text-text-primary tabular">
                {throughput.framesIn !== null ? formatNumber(throughput.framesIn) : "—"}
              </div>
            </div>
            <div>
              <div className="text-text-muted mb-0.5">Dropped</div>
              <div className="font-mono font-semibold tabular text-status-warning">
                {throughput.framesDropped !== null
                  ? `${formatNumber(throughput.framesDropped)} (${throughput.dropPct?.toFixed(2)}%)`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-text-muted mb-0.5">Active streams</div>
              <div className="font-mono font-semibold text-text-primary tabular">{running}</div>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold text-text-primary">Recent activity</div>
            <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">last 24h</span>
          </div>
          {recentEvents.length === 0 ? (
            <div className="text-[11px] text-text-muted py-6 text-center">
              No events to display.
              <div className="text-[10px] text-text-muted/70 mt-1 font-mono">/events/recent</div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recentEvents.map((e, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="text-[10px] font-mono text-text-muted w-9 pt-0.5">{e.time}</div>
                  <div
                    className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                      e.tone === "ok" ? "bg-status-running"
                      : e.tone === "warn" ? "bg-status-warning"
                      : e.tone === "error" ? "bg-status-error"
                      : e.tone === "info" ? "bg-brand"
                      : "bg-text-muted"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[12px] font-medium text-text-primary truncate ${e.title.startsWith("CAM-") ? "font-mono" : ""}`}>
                      {e.title}
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">{e.subtitle}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 카메라 그리드 헤더 — 상태 칩 ── */}
      {recordings.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-semibold text-text-primary">Cameras</div>
            <div className="flex gap-1.5 text-[10px] font-mono">
              <span className="px-2 py-0.5 rounded-full bg-status-running/10 text-status-running font-semibold">● {running} running</span>
              {errors > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-status-error/10 text-status-error font-semibold">● {errors} error</span>
              )}
              <span className="px-2 py-0.5 rounded-full bg-bg-app text-text-muted font-semibold">● {stopped} stopped</span>
            </div>
          </div>
        </div>
      )}

      {/* ── 카메라 그리드 (드래그 재정렬 지원) ── */}
      {recordings.length === 0 ? (
        <EmptyState
          icon={<VideoCameraIcon className="w-12 h-12 text-text-muted/40" />}
          message="등록된 카메라가 없습니다"
          action={{ label: "녹화 시작", onClick: () => setModalOpen(true) }}
        />
      ) : (
        /* 좌측 사이드바 폭을 모르는 뷰포트 브레이크포인트 대신 컨테이너 폭 기준 auto-fill */
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
        >
          {sortedRecordings.map((rec: Recording, i: number) => (
            <div
              key={rec.recording_id}
              draggable
              onDragStart={(e) => handleDragStart(i, e)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
              className={`transition-all duration-150 cursor-grab active:cursor-grabbing rounded-md ${
                dragOverIdx === i ? "ring-2 ring-brand/40" : ""
              } ${dragIdx === i ? "opacity-40" : ""}`}
            >
            <CameraCard
              recording={rec}
              showToast={showToast}
              refresh={refresh}
              onStop={setStopTarget}
              onSnapshot={async (id) => {
                try {
                  const res = await takeSnapshot(id);
                  const path = res.file?.path;
                  showToast(
                    path
                      ? `스냅샷 캡처: ${path.split("/").pop()}`
                      : "스냅샷 캡처 완료",
                    "success"
                  );
                } catch {
                  showToast("스냅샷 요청 실패", "error");
                }
              }}
            />
            </div>
          ))}
        </div>
      )}

      {/* ── 녹화 시작 모달 (공유 Modal 컴포넌트 사용) ── */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="녹화 시작"
        maxWidth="max-w-lg"
        headerExtra={
          <button
            onClick={() => {
              setDrawerOpen(true);
              setPresets(loadPresets());
            }}
            className="text-[12px] font-semibold text-brand hover:text-brand-hover transition-colors"
          >
            프리셋 관리
          </button>
        }
      >
        {/* 폼 필드 — 공유 FormField 컴포넌트 사용 */}
        <div className="space-y-3">
          <FormField label="Serial Number" value={form.serialNumber} onChange={(v) => updateField("serialNumber", v)} />
          <FormField label="HQ RTSP URL" value={form.hqUrl} onChange={(v) => { updateField("hqUrl", v); setFormErrors((e) => ({ ...e, hqUrl: undefined })); }} placeholder="rtsp://..." error={formErrors.hqUrl} />
          <FormField label="SQ RTSP URL" value={form.sqUrl} onChange={(v) => { updateField("sqUrl", v); setFormErrors((e) => ({ ...e, sqUrl: undefined })); }} placeholder="rtsp://..." error={formErrors.sqUrl} />
          <div className="grid grid-cols-2 gap-3">
            <FormField label="HQ ID" value={form.hqId} onChange={(v) => updateField("hqId", v)} />
            <FormField label="HQ Password" value={form.hqPass} onChange={(v) => updateField("hqPass", v)} type="password" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="SQ ID" value={form.sqId} onChange={(v) => updateField("sqId", v)} />
            <FormField label="SQ Password" value={form.sqPass} onChange={(v) => updateField("sqPass", v)} type="password" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* Mode 필드 — FormField select 모드 (children 전달) */}
            <FormField label="Mode" value={form.mode} onChange={(v) => updateField("mode", v)}>
              <option value="CONTINUOUS">CONTINUOUS</option>
              <option value="EVENT">EVENT</option>
            </FormField>
            <FormField label="Retention (days)" value={form.retention} onChange={(v) => updateField("retention", v)} type="number" />
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-3 mt-6">
          <Button variant="secondary" size="md" onClick={saveCurrentAsPreset}>
            프리셋 저장
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" size="md" onClick={() => setModalOpen(false)}>
            취소
          </Button>
          <Button variant="primary" size="md" isLoading={isStarting} onClick={handleStart}>
            시작
          </Button>
        </div>
      </Modal>

      {/* ── 프리셋 드로어 ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60]" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute right-0 top-0 h-full w-full max-w-xs sm:max-w-sm bg-bg-card border-l border-border p-4 overflow-y-auto shadow-card-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold font-display text-text-primary tracking-tight">프리셋 목록</h3>
              <button
                onClick={() => setDrawerOpen(false)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
            {presets.length === 0 ? (
              <p className="text-text-muted text-[12px]">저장된 프리셋이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {presets.map((p, i) => (
                  <div
                    key={i}
                    className="px-3 py-2.5 bg-card border border-border rounded-md cursor-pointer hover:border-border-strong hover:bg-bg-hover transition-colors"
                    onClick={() => applyPreset(p)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-text-primary font-medium">{p.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(i); }}
                        className="text-[11px] text-status-error hover:underline"
                      >
                        삭제
                      </button>
                    </div>
                    <div className="text-[11px] text-text-muted mt-1 truncate font-mono">
                      {p.data["hq-url"]?.substring(0, 40)}…
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 프리셋 삭제 확인 다이얼로그 */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onConfirm={confirmDeletePreset}
        onCancel={() => setDeleteTarget(null)}
        title="프리셋 삭제"
        message="이 프리셋을 삭제하시겠습니까?"
        confirmLabel="삭제"
        variant="destructive"
      />

      {/* 녹화 중지 확인 다이얼로그 */}
      <ConfirmDialog
        isOpen={stopTarget !== null}
        onConfirm={async () => {
          if (!stopTarget) return;
          setIsStopping(true);
          try {
            const { stopRecording } = await import("@/api/recording");
            await stopRecording(stopTarget);
            showToast("녹화가 중지되었습니다.", "success");
          } catch {
            showToast("녹화 중지 실패", "error");
          } finally {
            setIsStopping(false);
            setStopTarget(null);
          }
        }}
        onCancel={() => setStopTarget(null)}
        title="녹화 중지"
        message="이 녹화를 중지하시겠습니까?"
        confirmLabel="중지"
        variant="destructive"
        isLoading={isStopping}
      />

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

/* ────────────────── KPI 카드 — sparkline 포함 ────────────────── */
function KpiCard({
  label,
  value,
  unit,
  spark,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  spark?: number[] | null;
  color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-md px-4 py-3.5">
      <div className="text-[11px] text-text-muted mb-2">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[28px] leading-none font-semibold tracking-tight tabular text-text-primary truncate">{value}</span>
          {unit && <span className="text-[12px] text-text-muted font-medium">{unit}</span>}
        </div>
        <span className="shrink-0"><Sparkline data={spark} color={color} width={72} height={28} /></span>
      </div>
    </div>
  );
}

/* ────────────────── 카메라 카드 컴포넌트 (페이지 전용 — mpegts.js 라이브 프리뷰 포함) ────────────────── */
function CameraCard({
  recording,
  onSnapshot,
  onStop,
  showToast,
  refresh,
}: {
  recording: Recording;
  onSnapshot: (id: string) => void;
  /** 중지 확인 다이얼로그 열기 — 페이지의 setStopTarget 을 그대로 전달받음.
   *  기존에 stopTarget/ConfirmDialog/stopRecording 은 구현돼 있었으나 이를 여는
   *  호출부가 어디에도 없어 죽은 코드였음(대시보드에서 녹화를 멈출 방법이 없었음). */
  onStop: (id: string) => void;
  showToast: (message: string, type: "success" | "error" | "info") => void;
  refresh: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  /* mpegts.js 플레이어 인스턴스 ref — destroy/play 호출용 */
  /* createPlayer() 는 MSEPlayer|NativePlayer 합집합(Player)을 반환하므로 ref 도 상위 타입으로 선언 */
  const playerRef = useRef<mpegts.Player | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string>("");
  /** 녹화 재시작 로딩 상태 */
  const [isRestarting, setIsRestarting] = useState(false);

  const state = recording.state || "UNKNOWN";
  const recId = recording.recording_id;

  /* mpegts.js SQ 라이브 프리뷰 (RUNNING 상태에서만) */
  useEffect(() => {
    /* StrictMode 이중 마운트 대응: 취소 플래그 */
    let cancelled = false;

    if (state !== "RUNNING" || !videoRef.current) {
      setStreamStatus(state !== "RUNNING" ? "" : "video ref not ready");
      return;
    }

    if (!mpegts.getFeatureList().mseLivePlayback) {
      setStreamStatus("MSE not supported");
      return;
    }

    const video = videoRef.current;
    /* FastAPI WebSocket 프록시 경유 (Docker 환경에서 VRM 직접 접근 불가) */
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/live/${recId}/sq`;
    setStreamStatus("connecting...");
    console.log(`[Dashboard] Connecting: ${wsUrl}`);

    const player = mpegts.createPlayer(
      { type: "mpegts", isLive: true, hasAudio: false, url: wsUrl },
      {
        enableStashBuffer: true,
        stashInitialSize: 128,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 3.0,
        liveBufferLatencyMinRemain: 0.5,
        lazyLoad: false,
      }
    );

    player.on(mpegts.Events.ERROR, (type: unknown, detail: unknown) => {
      if (cancelled) return;
      console.error(`[Dashboard] Error (${recId}):`, type, detail);
      setStreamStatus(`error: ${String(detail || type)}`);
    });

    /* 진단 로깅 — ?debug=1 또는 개발 모드에서만 활성화. useMpegtsPlayer와 동일 기준.
       MEDIA_INFO 도달 시점 · buffered 잔량 · waiting/stalled 발생을 기록해 서버/클라이언트
       버퍼링 원인 분리 근거 확보. */
    const debugEnabled =
      import.meta.env.DEV || new URLSearchParams(window.location.search).get("debug") === "1";
    const t0 = performance.now();
    if (debugEnabled) {
      player.on(mpegts.Events.MEDIA_INFO, (info: unknown) => {
        console.log(`[Dashboard][diag] MEDIA_INFO ${recId} elapsed=${(performance.now() - t0).toFixed(0)}ms`, info);
      });
      let lastStatLog = 0;
      player.on(mpegts.Events.STATISTICS_INFO, (stat: unknown) => {
        const now = performance.now();
        if (now - lastStatLog > 5000) {
          lastStatLog = now;
          console.log(`[Dashboard][diag] STAT ${recId}`, stat);
        }
      });
    }

    /* video 네이티브 이벤트로 상태 관리 — mpegts.js MEDIA_INFO가 프록시 환경에서 누락될 수 있음 */
    const onPlaying = () => {
      if (!cancelled) {
        console.log(`[Dashboard] Video playing: ${recId}`);
        setStreamStatus("streaming");
      }
    };
    const onCanPlay = () => {
      if (cancelled) return;
      console.log(`[Dashboard] Video canplay, calling play(): ${recId}`);
      video.play().catch(() => {
        if (!cancelled) setStreamStatus("click to play");
      });
    };
    const bufferedRemain = () => {
      if (!video.buffered.length) return 0;
      const end = video.buffered.end(video.buffered.length - 1);
      return +(end - video.currentTime).toFixed(3);
    };
    const onWaiting = () => {
      if (cancelled || !debugEnabled) return;
      console.warn(`[Dashboard][diag] waiting ${recId} remain=${bufferedRemain()}s readyState=${video.readyState}`);
    };
    const onStalled = () => {
      if (cancelled || !debugEnabled) return;
      console.warn(`[Dashboard][diag] stalled ${recId} remain=${bufferedRemain()}s readyState=${video.readyState}`);
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    if (debugEnabled) {
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("stalled", onStalled);
    }

    player.attachMediaElement(video);
    player.load();
    playerRef.current = player;

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      if (debugEnabled) {
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("stalled", onStalled);
      }
      player.destroy();
      playerRef.current = null;
    };
  }, [state, recId]);

  /* 스냅샷 촬영 */
  const handleSnapshot = async () => {
    setSnapping(true);
    await onSnapshot(recId);
    setSnapping(false);
  };

  /** 녹화 재시작 — STOPPED/ERROR 상태에서만 호출 가능 */
  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      await restartRecording(recId);
      showToast(`${recId} 재시작 성공`, "success");
      refresh();
    } catch (err: unknown) {
      showToast("재시작 실패", "error");
    } finally {
      setIsRestarting(false);
    }
  };

  const createdAt = recording.created_at
    ? new Date(recording.created_at).toLocaleString("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "N/A";

  return (
    /* 카메라 카드 — Studio 라이트 카드 + RUNNING 시 상단 랜 표시 */
    <div
      className={`bg-card border rounded-md overflow-hidden hover:border-border-strong hover:shadow-card-md transition-shadow duration-150 ${
        state === "RUNNING" ? "border-status-running/30" : "border-border"
      }`}
    >
      {/* 비디오 프리뷰 영역 */}
      <div className="aspect-video bg-black relative">
        <video
          ref={videoRef}
          muted
          playsInline
          className="w-full h-full object-contain"
          onClick={() => {
            /* 자동재생 차단 시 클릭으로 재생 시도 */
            if (videoRef.current?.paused && playerRef.current) {
              playerRef.current.play();
              setStreamStatus("playing");
            }
          }}
        />
        {/* 비디오 하단 그라데이션 페이드 — 텍스트 가독성 확보용 */}
        <div className="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
        {/* 스트림 상태 오버레이 */}
        {state === "RUNNING" && streamStatus && streamStatus !== "streaming" && streamStatus !== "playing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[11px] text-white/80 pointer-events-none uppercase tracking-wider">
            {streamStatus}
          </div>
        )}
      </div>

      {/* 정보 영역 */}
      <div className="px-3 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-mono text-text-primary truncate flex-1" title={recId}>
            {recId}
          </span>
          <StatusBadge state={state} />
        </div>

        <div className="grid grid-cols-2 gap-x-3 text-[11px]">
          <div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-0.5">Created</div>
            <div className="text-text-primary tabular">{createdAt}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-0.5">Mode</div>
            <div className="text-text-primary">{recording.recording_mode || "N/A"}</div>
          </div>
        </div>

        {/* 액션 버튼 */}
        {/* flex-wrap + 최소폭: 카드 폭이 좁아지면 버튼이 다음 줄로 접히고,
            nowrap 라벨이 버튼 밖으로 새는 것을 막음 */}
        <div className="flex flex-wrap gap-1.5 pt-2 mt-1 border-t border-border-subtle">
          {/* RUNNING 상태 전용 버튼 — Live View, Snapshot */}
          {state === "RUNNING" && (
            <>
              <a
                href={`/live?id=${recId}`}
                className="flex-1 min-w-[60px] whitespace-nowrap inline-flex items-center justify-center h-7 px-2 bg-brand-soft text-brand text-[11px] font-medium rounded-md hover:bg-brand hover:text-white transition-colors"
              >
                Live
              </a>
              <button
                onClick={handleSnapshot}
                disabled={snapping}
                className="flex-1 min-w-[60px] whitespace-nowrap inline-flex items-center justify-center gap-1 h-7 px-2 bg-bg-hover text-text-secondary text-[11px] rounded-md hover:bg-card-hover hover:text-text-primary transition-colors disabled:opacity-50"
              >
                {snapping ? <><CameraIcon className="w-3.5 h-3.5 animate-pulse" />…</> : <><CameraIcon className="w-3.5 h-3.5" /> Snap</>}
              </button>
              {/* 녹화 중지 — 실제 중지는 페이지의 ConfirmDialog 확인 후 수행됨(오조작 방지) */}
              <button
                onClick={() => onStop(recId)}
                title="녹화 중지"
                className="flex-1 min-w-[60px] whitespace-nowrap inline-flex items-center justify-center gap-1 h-7 px-2 bg-status-error/10 text-status-error text-[11px] font-medium rounded-md hover:bg-status-error hover:text-white transition-colors"
              >
                <StopIcon className="w-3.5 h-3.5" /> Stop
              </button>
            </>
          )}
          {/* STOPPED/ERROR 상태 전용 버튼 — 재시작 */}
          {(state === "STOPPED" || state === 4 || state === "ERROR" || state === 5) && (
            <Button variant="primary" size="sm" isLoading={isRestarting} onClick={handleRestart} className="flex-1 min-w-[72px] whitespace-nowrap">
              <ArrowPathIcon className="w-3.5 h-3.5" /> Restart
            </Button>
          )}
          <a
            href="/tester"
            onClick={() => sessionStorage.setItem("target_id", recId)}
            className="flex-1 min-w-[60px] whitespace-nowrap inline-flex items-center justify-center h-7 px-2 bg-bg-hover text-text-secondary text-[11px] rounded-md hover:bg-card-hover hover:text-text-primary transition-colors"
          >
            Control
          </a>
        </div>
      </div>
    </div>
  );
}

