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
import { startRecording, takeSnapshot, type StartRecordingParams } from "@/api/recording";
import mpegts from "mpegts.js";
import StatusBadge from "@/components/StatusBadge";
import Toast from "@/components/Toast";

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
  const { recordings } = useRecordings(3000);
  const { toast, showToast } = useToast();

  /* 모달 상태 */
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ModalFormData>({ ...INITIAL_FORM });

  /* 프리셋 드로어 상태 */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(loadPresets());

  /* 통계 */
  const total = recordings.length;
  const running = recordings.filter((r: any) => r.state === "RUNNING").length;
  const errors = recordings.filter((r: any) => r.state === "ERROR").length;

  /* ── 모달 열기 ── */
  const openModal = () => {
    setForm({ ...INITIAL_FORM, serialNumber: `SN-${Date.now()}` });
    setModalOpen(true);
  };

  /* ── 녹화 시작 ── */
  const handleStart = async () => {
    if (!form.hqUrl || !form.sqUrl) {
      showToast("HQ/SQ URL을 입력해주세요.", "error");
      return;
    }
    setModalOpen(false);
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
      showToast("녹화가 시작되었습니다.", "success");
    } catch (err: any) {
      showToast(`녹화 시작 실패: ${err.message}`, "error");
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

  /* ── 프리셋 삭제 ── */
  const deletePreset = (index: number) => {
    if (!confirm("이 프리셋을 삭제하시겠습니까?")) return;
    const updated = presets.filter((_, i) => i !== index);
    setPresets(updated);
    savePresets(updated);
  };

  /* ── 폼 필드 업데이트 헬퍼 ── */
  const updateField = (key: keyof ModalFormData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <button
          onClick={openModal}
          className="px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand/80 transition font-semibold text-sm"
        >
          + 녹화 시작
        </button>
      </div>

      {/* ── 통계 카드 ── */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Cameras" value={total} color="text-text-primary" />
        <StatCard label="Active" value={running} color="text-status-running" />
        <StatCard label="Errors" value={errors} color="text-status-error" />
      </div>

      {/* ── 카메라 그리드 ── */}
      {recordings.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <div className="text-4xl mb-3">📹</div>
          <div>등록된 카메라가 없습니다.</div>
          <div className="text-xs mt-2">Tester 탭에서 녹화를 시작하세요.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {recordings.map((rec: any) => (
            <CameraCard
              key={rec.recording_id}
              recording={rec}
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

      {/* ── 녹화 시작 모달 ── */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onMouseDown={(e) => {
            /* 백드롭 자체를 직접 클릭했을 때만 닫기 (입력칸 드래그 시 닫힘 방지) */
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-text-primary">녹화 시작</h2>
              <button
                onClick={() => {
                  setDrawerOpen(true);
                  setPresets(loadPresets());
                }}
                className="text-xs text-brand hover:underline"
              >
                프리셋 관리
              </button>
            </div>

            {/* 폼 필드 */}
            <div className="space-y-3">
              <FormField label="Serial Number" value={form.serialNumber} onChange={(v) => updateField("serialNumber", v)} />
              <FormField label="HQ RTSP URL" value={form.hqUrl} onChange={(v) => updateField("hqUrl", v)} placeholder="rtsp://..." />
              <FormField label="SQ RTSP URL" value={form.sqUrl} onChange={(v) => updateField("sqUrl", v)} placeholder="rtsp://..." />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="HQ ID" value={form.hqId} onChange={(v) => updateField("hqId", v)} />
                <FormField label="HQ Password" value={form.hqPass} onChange={(v) => updateField("hqPass", v)} type="password" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="SQ ID" value={form.sqId} onChange={(v) => updateField("sqId", v)} />
                <FormField label="SQ Password" value={form.sqPass} onChange={(v) => updateField("sqPass", v)} type="password" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">Mode</label>
                  <select
                    className="w-full px-3 py-2 bg-bg-app border border-border rounded text-text-primary text-sm"
                    value={form.mode}
                    onChange={(e) => updateField("mode", e.target.value)}
                  >
                    <option value="CONTINUOUS">CONTINUOUS</option>
                    <option value="EVENT">EVENT</option>
                  </select>
                </div>
                <FormField label="Retention (days)" value={form.retention} onChange={(v) => updateField("retention", v)} type="number" />
              </div>
            </div>

            {/* 액션 버튼 */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={saveCurrentAsPreset}
                className="px-4 py-2 border border-border rounded-lg text-text-secondary text-sm hover:bg-card-hover transition"
              >
                프리셋 저장
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 border border-border rounded-lg text-text-secondary text-sm hover:bg-card-hover transition"
              >
                취소
              </button>
              <button
                onClick={handleStart}
                className="px-6 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition"
              >
                시작
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 프리셋 드로어 ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60]" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute right-0 top-0 h-full w-80 bg-card border-l border-border p-4 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-text-primary">프리셋 목록</h3>
              <button onClick={() => setDrawerOpen(false)} className="text-text-muted hover:text-text-primary">✕</button>
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
                        onClick={(e) => { e.stopPropagation(); deletePreset(i); }}
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

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

/* ────────────────── 통계 카드 컴포넌트 ────────────────── */
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className={`text-3xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}

/* ────────────────── 카메라 카드 컴포넌트 ────────────────── */
function CameraCard({
  recording,
  onSnapshot,
}: {
  recording: any;
  onSnapshot: (id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const [snapping, setSnapping] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string>("");

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

    player.on(mpegts.Events.ERROR, (type: any, detail: any) => {
      if (cancelled) return;
      console.error(`[Dashboard] Error (${recId}):`, type, detail);
      setStreamStatus(`error: ${detail || type}`);
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

  const createdAt = recording.created_at
    ? new Date(recording.created_at).toLocaleString("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "N/A";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-brand/50 transition">
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
            <div className="font-mono text-text-primary">{createdAt}</div>
          </div>
          <div>
            <span className="text-text-secondary">Mode</span>
            <div className="font-mono text-text-primary">{recording.recording_mode || "N/A"}</div>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-2 pt-1">
          <a
            href={`/live?id=${recId}`}
            className="flex-1 text-center px-2 py-1.5 bg-brand/10 text-brand text-xs rounded hover:bg-brand/20 transition"
          >
            Live View
          </a>
          <button
            onClick={handleSnapshot}
            disabled={snapping}
            className="flex-1 px-2 py-1.5 bg-card-hover text-text-secondary text-xs rounded hover:text-text-primary transition disabled:opacity-50"
          >
            {snapping ? "📸..." : "Snapshot"}
          </button>
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

/* ────────────────── 폼 필드 컴포넌트 ────────────────── */
function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      <input
        type={type}
        className="w-full px-3 py-2 bg-bg-app border border-border rounded text-text-primary text-sm placeholder:text-text-muted"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
