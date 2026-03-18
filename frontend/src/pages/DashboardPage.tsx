/**
 * Dashboard 페이지
 * 카메라 상태 모니터링 + 녹화 시작/중지 + 통계 카드
 * - 3초 주기 자동 갱신
 * - mpegts.js 라이브 프리뷰 (SQ 스트림)
 * - 녹화 시작 모달 (프리셋 지원)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import { startRecording, restartRecording, takeSnapshot, type StartRecordingParams } from "@/api/recording";
import type { Recording } from "@/types/recording";
import { DASHBOARD_REFRESH_INTERVAL_MS } from "@/constants";
import { formatNumber } from "@/utils/format";
import mpegts from "mpegts.js";
import StatusBadge from "@/components/StatusBadge";
import StatCard from "@/components/StatCard";
import FormField from "@/components/FormField";
import Modal from "@/components/Modal";
import Toast from "@/components/Toast";
import Button from "@/components/Button";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import {
  VideoCameraIcon,
  ExclamationTriangleIcon,
  CameraIcon,
  PlusIcon,
  XMarkIcon,
  ArrowPathIcon,
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

  /* 통계 */
  const total = recordings.length;
  const running = recordings.filter((r: Recording) => r.state === "RUNNING").length;
  const errors = recordings.filter((r: Recording) => r.state === "ERROR").length;

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
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between mb-6">
        {/* 페이지 제목 — Mission Control 디스플레이 폰트 적용 */}
        <h1 className="text-2xl font-bold font-display text-text-primary">Dashboard</h1>
        <Button variant="primary" size="md" onClick={openModal}>
          <PlusIcon className="w-4 h-4" /> 녹화 시작
        </Button>
      </div>

      {/* ── 통계 카드 — 상단 브랜드 그라데이션 배경 영역 ── */}
      <div className="bg-gradient-to-b from-brand/[0.03] to-transparent pb-6 -mx-6 px-6">
      <div className="grid grid-cols-3 gap-4 mb-0">
        <StatCard icon={<VideoCameraIcon className="w-5 h-5 text-brand" />} label="Total Cameras" value={formatNumber(total)} colorClass="text-text-primary" />
        <StatCard icon={<VideoCameraIcon className="w-5 h-5 text-status-running" />} label="Active" value={formatNumber(running)} colorClass="text-status-running" />
        <StatCard icon={<ExclamationTriangleIcon className="w-5 h-5 text-status-error" />} label="Errors" value={formatNumber(errors)} colorClass="text-status-error" />
      </div>
      </div>

      {/* ── 카메라 그리드 ── */}
      {recordings.length === 0 ? (
        <EmptyState
          icon={<VideoCameraIcon className="w-12 h-12 text-text-muted/40" />}
          message="등록된 카메라가 없습니다"
          action={{ label: "녹화 시작", onClick: () => setModalOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {recordings.map((rec: Recording) => (
            <CameraCard
              key={rec.recording_id}
              recording={rec}
              showToast={showToast}
              refresh={refresh}
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
            className="text-xs text-brand hover:underline"
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
          <div className="absolute inset-0 bg-black/40" />
          {/* 프리셋 드로어 — 글래스모피즘 배경 */}
          <div
            className="absolute right-0 top-0 h-full w-80 bg-[#0d1220]/95 backdrop-blur-xl border-l border-white/[0.08] p-4 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-text-primary">프리셋 목록</h3>
              <button onClick={() => setDrawerOpen(false)} className="text-text-muted hover:text-text-primary"><XMarkIcon className="w-4 h-4" /></button>
            </div>
            {presets.length === 0 ? (
              <p className="text-text-muted text-xs">저장된 프리셋이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {presets.map((p, i) => (
                  <div
                    key={i}
                    className="p-3 bg-bg-app border border-border rounded-lg cursor-pointer hover:border-brand transition"
                    onClick={() => applyPreset(p)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-primary font-medium">★ {p.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(i); }}
                        className="text-xs text-status-error hover:underline"
                      >
                        삭제
                      </button>
                    </div>
                    <div className="text-xs text-text-muted mt-1 truncate">
                      {p.data["hq-url"]?.substring(0, 40)}...
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

/* ────────────────── 카메라 카드 컴포넌트 (페이지 전용 — mpegts.js 라이브 프리뷰 포함) ────────────────── */
function CameraCard({
  recording,
  onSnapshot,
  showToast,
  refresh,
}: {
  recording: Recording;
  onSnapshot: (id: string) => void;
  showToast: (message: string, type: "success" | "error" | "info") => void;
  refresh: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  /* mpegts.js 플레이어 인스턴스 ref — destroy/play 호출용 */
  const playerRef = useRef<mpegts.MSEPlayer | null>(null);
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
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);

    player.attachMediaElement(video);
    player.load();
    playerRef.current = player;

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
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
    /* 카메라 카드 — 글래스모피즘 스타일 + RUNNING 시 녹색 보더 글로우 */
    <div className={`bg-white/[0.03] backdrop-blur-xl border rounded-2xl overflow-hidden hover:bg-white/[0.05] hover:border-white/[0.15] hover:shadow-[0_8px_30px_rgba(0,0,0,0.3)] hover:-translate-y-0.5 transition-all duration-200 ${state === "RUNNING" ? "border-status-running/20" : "border-white/[0.08]"}`}>
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
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] text-text-muted pointer-events-none">
            {streamStatus}
          </div>
        )}
      </div>

      {/* 정보 영역 */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-mono text-text-primary truncate max-w-[60%]" title={recId}>
            {recId}
          </span>
          <StatusBadge state={state} />
        </div>

        <div className="grid grid-cols-2 gap-x-4 text-xs text-text-muted">
          <div>
            <span className="text-text-secondary">Created</span>
            <div className="text-text-primary">{createdAt}</div>
          </div>
          <div>
            <span className="text-text-secondary">Mode</span>
            <div className="text-text-primary">{recording.recording_mode || "N/A"}</div>
          </div>
        </div>

        {/* 액션 버튼 — 글래스 구분선 영역 */}
        <div className="flex gap-2 pt-2 mt-1 border-t border-white/[0.06]">
          {/* RUNNING 상태 전용 버튼 — Live View, Snapshot */}
          {state === "RUNNING" && (
            <>
              <a
                href={`/live?id=${recId}`}
                className="flex-1 text-center px-2 py-1.5 bg-brand/10 text-brand text-xs rounded hover:bg-brand/20 transition"
              >
                Live View
              </a>
              <button
                onClick={handleSnapshot}
                disabled={snapping}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-card-hover text-text-secondary text-xs rounded hover:text-text-primary transition disabled:opacity-50"
              >
                {snapping ? <><CameraIcon className="w-3.5 h-3.5 animate-pulse" />...</> : <><CameraIcon className="w-3.5 h-3.5" /> Snapshot</>}
              </button>
            </>
          )}
          {/* STOPPED/ERROR 상태 전용 버튼 — 재시작 */}
          {(state === "STOPPED" || state === 4 || state === "ERROR" || state === 5) && (
            <Button variant="primary" size="sm" isLoading={isRestarting} onClick={handleRestart} className="flex-1">
              <ArrowPathIcon className="w-3.5 h-3.5" /> Restart
            </Button>
          )}
          <a
            href="/tester"
            onClick={() => sessionStorage.setItem("target_id", recId)}
            className="flex-1 text-center px-2 py-1.5 bg-card-hover text-text-secondary text-xs rounded hover:text-text-primary transition"
          >
            Control
          </a>
        </div>
      </div>
    </div>
  );
}

