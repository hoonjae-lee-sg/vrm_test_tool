/**
 * Tester 페이지
 * gRPC API 개별 테스트 (Start/Stop/Status/EventClip/Clip/Snapshot/Health)
 * - 좌측: API 메뉴 사이드바
 * - 중앙: 선택된 API별 폼 패널
 * - 우측: Response 로그 패널
 * - 플로팅 녹화 목록 패널
 * - 프리셋 드로어
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import {
  startRecording,
  stopRecording,
  getRecordingStatus,
  takeSnapshot,
  startEventClip,
  stopEventClip,
  createSimpleClip,
  getRecordingHealth,
  type StartRecordingParams,
} from "@/api/recording";
import StatusBadge from "@/components/StatusBadge";
import Toast from "@/components/Toast";

/* ────────────────── API 메뉴 정의 ────────────────── */
type ApiPanel =
  | "start"
  | "stop"
  | "status"
  | "event-start"
  | "event-stop"
  | "clip"
  | "snapshot"
  | "health";

const API_MENU: { id: ApiPanel; label: string; method: string }[] = [
  { id: "start", label: "Start Recording", method: "POST" },
  { id: "stop", label: "Stop Recording", method: "POST" },
  { id: "status", label: "Check Status", method: "GET" },
  { id: "event-start", label: "Start Event Clip", method: "POST" },
  { id: "event-stop", label: "Stop Event Clip", method: "POST" },
  { id: "clip", label: "Create Clip", method: "POST" },
  { id: "snapshot", label: "Take Snapshot", method: "POST" },
  { id: "health", label: "Check Health", method: "GET" },
];

/* ────────────────── 로그 항목 타입 ────────────────── */
interface LogEntry {
  id: number;
  time: string;
  title: string;
  data?: any;
}

/* ────────────────── 메인 컴포넌트 ────────────────── */
export default function TesterPage() {
  const { recordings, refresh } = useRecordings(5000);
  const { toast, showToast } = useToast();

  /* 현재 선택된 API 패널 */
  const [activePanel, setActivePanel] = useState<ApiPanel>("start");

  /* 로그 상태 */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const logContainerRef = useRef<HTMLDivElement>(null);

  /* 공통 recording ID — 하나를 입력하면 모든 폼에 반영 */
  const [recordingId, setRecordingId] = useState("");

  /* 플로팅 패널 최소화 상태 */
  const [floatingMinimized, setFloatingMinimized] = useState(false);

  /* sessionStorage에서 target_id 로드 (Dashboard에서 넘어온 경우) */
  useEffect(() => {
    const targetId = sessionStorage.getItem("target_id");
    if (targetId) {
      setRecordingId(targetId);
      sessionStorage.removeItem("target_id");
    }
  }, []);

  /* ── 로그 추가 ── */
  const addLog = useCallback((title: string, data?: any) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { id: ++logIdRef.current, time, title, data }]);
    /* 스크롤 하단 이동 */
    setTimeout(() => {
      logContainerRef.current?.scrollTo({
        top: logContainerRef.current.scrollHeight,
      });
    }, 50);
  }, []);

  /* ── 플로팅 패널에서 ID 선택 ── */
  const selectRecordingId = (id: string) => {
    setRecordingId(id);
    addLog("Selected Recording ID", { recording_id: id });
  };

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* ── 좌측: API 메뉴 사이드바 ── */}
      <div className="w-48 flex-shrink-0 bg-card border-r border-border overflow-y-auto">
        <div className="p-3">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            API Methods
          </h3>
          <nav className="space-y-1">
            {API_MENU.map((item) => (
              <button
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                  activePanel === item.id
                    ? "bg-brand/10 text-brand font-semibold"
                    : "text-text-secondary hover:bg-card-hover hover:text-text-primary"
                }`}
              >
                <span className="font-mono text-[10px] mr-1.5 opacity-60">
                  {item.method}
                </span>
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ── 중앙: 폼 패널 ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {activePanel === "start" && (
          <StartPanel addLog={addLog} showToast={showToast} refresh={refresh} />
        )}
        {activePanel === "stop" && (
          <StopPanel recordingId={recordingId} setRecordingId={setRecordingId} addLog={addLog} showToast={showToast} refresh={refresh} />
        )}
        {activePanel === "status" && (
          <StatusPanel recordingId={recordingId} setRecordingId={setRecordingId} addLog={addLog} />
        )}
        {activePanel === "event-start" && (
          <EventStartPanel recordingId={recordingId} setRecordingId={setRecordingId} addLog={addLog} />
        )}
        {activePanel === "event-stop" && (
          <EventStopPanel recordingId={recordingId} setRecordingId={setRecordingId} addLog={addLog} />
        )}
        {activePanel === "clip" && (
          <ClipPanel recordingId={recordingId} setRecordingId={setRecordingId} addLog={addLog} />
        )}
        {activePanel === "snapshot" && (
          <SnapshotPanel recordingId={recordingId} setRecordingId={setRecordingId} addLog={addLog} />
        )}
        {activePanel === "health" && (
          <HealthPanel recordingId={recordingId} setRecordingId={setRecordingId} addLog={addLog} />
        )}
      </div>

      {/* ── 우측: Response 로그 ── */}
      <div className="w-80 flex-shrink-0 bg-card border-l border-border flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">
            Response Log
          </h3>
          <button
            onClick={() => setLogs([])}
            className="text-xs text-text-muted hover:text-text-primary"
          >
            Clear
          </button>
        </div>
        <div ref={logContainerRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {logs.length === 0 ? (
            <p className="text-xs text-text-muted">Waiting for commands...</p>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="text-xs">
                <div className="flex gap-2 mb-1">
                  <span className="text-text-muted font-mono">[{entry.time}]</span>
                  <span className="text-brand font-semibold">{entry.title}</span>
                </div>
                {entry.data && (
                  <pre className="bg-bg-app rounded p-2 overflow-x-auto text-text-secondary font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 플로팅 녹화 목록 ── */}
      <div
        className={`fixed bottom-4 right-4 w-72 bg-card border border-border rounded-xl shadow-xl z-40 transition-all ${
          floatingMinimized ? "h-10 overflow-hidden" : "max-h-80"
        }`}
      >
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border"
          onClick={() => setFloatingMinimized(!floatingMinimized)}
        >
          <span className="text-xs font-bold text-text-primary">
            Recordings ({recordings.length})
          </span>
          <div className="flex gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); refresh(); }}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              ↻
            </button>
            <button className="text-xs text-text-muted hover:text-text-primary">
              {floatingMinimized ? "□" : "_"}
            </button>
          </div>
        </div>
        {!floatingMinimized && (
          <div className="max-h-60 overflow-y-auto">
            {recordings.length === 0 ? (
              <p className="text-xs text-text-muted p-3">No recordings found.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {recordings.map((rec: any) => (
                    <tr key={rec.recording_id} className="hover:bg-card-hover">
                      <td className="px-3 py-1.5 font-mono truncate max-w-[120px]" title={rec.recording_id}>
                        {rec.recording_id.substring(0, 12)}...
                      </td>
                      <td className="px-1 py-1.5">
                        <StatusBadge state={rec.state} />
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => selectRecordingId(rec.recording_id)}
                          className="px-2 py-0.5 bg-brand/10 text-brand rounded text-[10px] hover:bg-brand/20"
                        >
                          Use
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

/* ────────────────── 공통 폼 입력 컴포넌트 ────────────────── */
function Field({
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
        className="w-full px-3 py-2 bg-bg-app border border-border rounded text-text-primary text-sm font-mono placeholder:text-text-muted"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

/* ────────────────── Start Recording 패널 ────────────────── */
function StartPanel({
  addLog,
  showToast,
  refresh,
}: {
  addLog: (t: string, d?: any) => void;
  showToast: (m: string, t: "success" | "error" | "info") => void;
  refresh: () => void;
}) {
  const [hqUrl, setHqUrl] = useState("");
  const [sqUrl, setSqUrl] = useState("");
  const [hqStorage, setHqStorage] = useState("");
  const [sqStorage, setSqStorage] = useState("");
  const [retention, setRetention] = useState("7");
  const [mode, setMode] = useState("CONTINUOUS");
  const [codec, setCodec] = useState("H264");
  const [authToken, setAuthToken] = useState("");
  const [notes, setNotes] = useState("");
  const [hqId, setHqId] = useState("");
  const [hqPass, setHqPass] = useState("");
  const [sqId, setSqId] = useState("");
  const [sqPass, setSqPass] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const body: StartRecordingParams = {
      hq_url: hqUrl,
      sq_url: sqUrl,
      rtsp_hq_username: hqId || undefined,
      rtsp_hq_password: hqPass || undefined,
      rtsp_sq_username: sqId || undefined,
      rtsp_sq_password: sqPass || undefined,
      hq_storage_limit_mbs: hqStorage ? parseInt(hqStorage) : undefined,
      sq_storage_limit_mbs: sqStorage ? parseInt(sqStorage) : undefined,
      retention_days: parseInt(retention) || 7,
      recording_mode: mode,
      encoding_codec: codec,
      auth_token: authToken || undefined,
      notes: notes || undefined,
    };
    addLog("Starting recording...", body);
    setLoading(true);
    try {
      const result = await startRecording(body);
      addLog("Start Response:", result);
      showToast("녹화 시작 성공", "success");
      refresh();
    } catch (err: any) {
      addLog("Error:", { message: err.message });
      showToast("녹화 시작 실패", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Start Recording</h2>
      <div className="space-y-3">
        <Field label="HQ RTSP URL" value={hqUrl} onChange={setHqUrl} placeholder="rtsp://..." />
        <Field label="SQ RTSP URL" value={sqUrl} onChange={setSqUrl} placeholder="rtsp://..." />
        <div className="grid grid-cols-2 gap-3">
          <Field label="HQ Username" value={hqId} onChange={setHqId} />
          <Field label="HQ Password" value={hqPass} onChange={setHqPass} type="password" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SQ Username" value={sqId} onChange={setSqId} />
          <Field label="SQ Password" value={sqPass} onChange={setSqPass} type="password" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HQ Storage Limit (MB)" value={hqStorage} onChange={setHqStorage} type="number" />
          <Field label="SQ Storage Limit (MB)" value={sqStorage} onChange={setSqStorage} type="number" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Retention (days)" value={retention} onChange={setRetention} type="number" />
          <div>
            <label className="text-xs text-text-muted mb-1 block">Mode</label>
            <select className="w-full px-3 py-2 bg-bg-app border border-border rounded text-text-primary text-sm" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="CONTINUOUS">CONTINUOUS</option>
              <option value="EVENT">EVENT</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Codec</label>
            <select className="w-full px-3 py-2 bg-bg-app border border-border rounded text-text-primary text-sm" value={codec} onChange={(e) => setCodec(e.target.value)}>
              <option value="H264">H264</option>
              <option value="H265">H265</option>
            </select>
          </div>
        </div>
        <Field label="Auth Token" value={authToken} onChange={setAuthToken} />
        <Field label="Notes" value={notes} onChange={setNotes} />
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-4 px-6 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition disabled:opacity-50"
      >
        {loading ? "Starting..." : "Start Recording"}
      </button>
    </div>
  );
}

/* ────────────────── Stop Recording 패널 ────────────────── */
function StopPanel({
  recordingId,
  setRecordingId,
  addLog,
  showToast,
  refresh,
}: {
  recordingId: string;
  setRecordingId: (v: string) => void;
  addLog: (t: string, d?: any) => void;
  showToast: (m: string, t: "success" | "error" | "info") => void;
  refresh: () => void;
}) {
  const [authToken, setAuthToken] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    addLog("Stopping recording...", { recording_id: recordingId });
    setLoading(true);
    try {
      const result = await stopRecording(recordingId);
      addLog("Stop Response:", result);
      showToast("녹화 중지 성공", "success");
      refresh();
    } catch (err: any) {
      addLog("Error:", { message: err.message });
      showToast("녹화 중지 실패", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Stop Recording</h2>
      <div className="space-y-3">
        <Field label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <Field label="Auth Token (optional)" value={authToken} onChange={setAuthToken} />
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-4 px-6 py-2 bg-status-error text-white rounded-lg font-semibold text-sm hover:bg-status-error/80 transition disabled:opacity-50"
      >
        {loading ? "Stopping..." : "Stop Recording"}
      </button>
    </div>
  );
}

/* ────────────────── Check Status 패널 ────────────────── */
function StatusPanel({
  recordingId,
  setRecordingId,
  addLog,
}: {
  recordingId: string;
  setRecordingId: (v: string) => void;
  addLog: (t: string, d?: any) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    addLog("Checking status...", { recording_id: recordingId });
    setLoading(true);
    try {
      const result = await getRecordingStatus(recordingId);
      addLog("Status Response:", result);
    } catch (err: any) {
      addLog("Error:", { message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Check Status</h2>
      <div className="space-y-3">
        <Field label="Recording ID" value={recordingId} onChange={setRecordingId} />
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-4 px-6 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition disabled:opacity-50"
      >
        {loading ? "Checking..." : "Check Status"}
      </button>
    </div>
  );
}

/* ────────────────── Event Clip Start 패널 ────────────────── */
function EventStartPanel({
  recordingId,
  setRecordingId,
  addLog,
}: {
  recordingId: string;
  setRecordingId: (v: string) => void;
  addLog: (t: string, d?: any) => void;
}) {
  const [authToken, setAuthToken] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    addLog("Starting event clip...", { recording_id: recordingId });
    setLoading(true);
    try {
      const result = await startEventClip(recordingId, authToken || undefined);
      addLog("Start Event Response:", result);
    } catch (err: any) {
      addLog("Error:", { message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Start Event Clip</h2>
      <div className="space-y-3">
        <Field label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <Field label="Auth Token (optional)" value={authToken} onChange={setAuthToken} />
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-4 px-6 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition disabled:opacity-50"
      >
        {loading ? "Starting..." : "Start Event"}
      </button>
    </div>
  );
}

/* ────────────────── Event Clip Stop 패널 ────────────────── */
function EventStopPanel({
  recordingId,
  setRecordingId,
  addLog,
}: {
  recordingId: string;
  setRecordingId: (v: string) => void;
  addLog: (t: string, d?: any) => void;
}) {
  const [authToken, setAuthToken] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    addLog("Stopping event clip...", { recording_id: recordingId });
    setLoading(true);
    try {
      const result = await stopEventClip(recordingId, authToken || undefined);
      addLog("Stop Event Response:", result);
    } catch (err: any) {
      addLog("Error:", { message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Stop Event Clip</h2>
      <div className="space-y-3">
        <Field label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <Field label="Auth Token (optional)" value={authToken} onChange={setAuthToken} />
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-4 px-6 py-2 bg-status-error text-white rounded-lg font-semibold text-sm hover:bg-status-error/80 transition disabled:opacity-50"
      >
        {loading ? "Stopping..." : "Stop Event"}
      </button>
    </div>
  );
}

/* ────────────────── Create Clip 패널 ────────────────── */
function ClipPanel({
  recordingId,
  setRecordingId,
  addLog,
}: {
  recordingId: string;
  setRecordingId: (v: string) => void;
  addLog: (t: string, d?: any) => void;
}) {
  const [seconds, setSeconds] = useState("");
  const [nanos, setNanos] = useState("0");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    addLog("Creating clip...", { recording_id: recordingId, seconds, nanos });
    setLoading(true);
    try {
      const result = await createSimpleClip(recordingId, parseInt(seconds), parseInt(nanos));
      addLog("Clip Response:", result);
    } catch (err: any) {
      addLog("Error:", { message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Create Clip</h2>
      <div className="space-y-3">
        <Field label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seconds (epoch)" value={seconds} onChange={setSeconds} type="number" />
          <Field label="Nanos" value={nanos} onChange={setNanos} type="number" />
        </div>
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-4 px-6 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition disabled:opacity-50"
      >
        {loading ? "Creating..." : "Create Clip"}
      </button>
    </div>
  );
}

/* ────────────────── Take Snapshot 패널 ────────────────── */
function SnapshotPanel({
  recordingId,
  setRecordingId,
  addLog,
}: {
  recordingId: string;
  setRecordingId: (v: string) => void;
  addLog: (t: string, d?: any) => void;
}) {
  const [seconds, setSeconds] = useState("");
  const [nanos, setNanos] = useState("0");
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<{ url: string; time: string }[]>([]);

  const handleSubmit = async () => {
    addLog("Taking snapshot...", { recording_id: recordingId, seconds, nanos });
    setLoading(true);
    try {
      const result = await takeSnapshot(
        recordingId,
        seconds ? parseInt(seconds) : undefined,
        nanos ? parseInt(nanos) : 0
      );
      addLog("Snapshot Response:", result);

      /* 스냅샷 이미지 표시 */
      const imagePath = result.file?.path;
      if (imagePath) {
        const cleanPath = imagePath.startsWith("./") ? imagePath.substring(1) : imagePath;
        const imageUrl = `http://${window.location.hostname}:18071${cleanPath}`;
        const time = seconds
          ? new Date(parseInt(seconds) * 1000).toLocaleTimeString("en-GB")
          : new Date().toLocaleTimeString("en-GB");
        setSnapshots((prev) => [{ url: imageUrl, time }, ...prev]);
      }
    } catch (err: any) {
      addLog("Error:", { message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Take Snapshot</h2>
      <div className="space-y-3">
        <Field label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seconds (epoch, optional)" value={seconds} onChange={setSeconds} type="number" />
          <Field label="Nanos" value={nanos} onChange={setNanos} type="number" />
        </div>
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-4 px-6 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition disabled:opacity-50"
      >
        {loading ? "Taking..." : "Take Snapshot"}
      </button>

      {/* 스냅샷 결과 */}
      {snapshots.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Snapshots</h3>
          <div className="grid grid-cols-3 gap-2">
            {snapshots.map((snap, i) => (
              <div key={i} className="relative">
                <img
                  src={snap.url}
                  alt={`snapshot-${i}`}
                  className="w-full aspect-video object-cover rounded border border-border"
                />
                <span className="absolute bottom-1 left-1 text-[9px] bg-black/70 text-white px-1 rounded">
                  {snap.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────── Check Health 패널 ────────────────── */
function HealthPanel({
  recordingId,
  setRecordingId,
  addLog,
}: {
  recordingId: string;
  setRecordingId: (v: string) => void;
  addLog: (t: string, d?: any) => void;
}) {
  const [authToken, setAuthToken] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    addLog("Checking health...", { recording_id: recordingId });
    setLoading(true);
    try {
      const result = await getRecordingHealth(recordingId, authToken || undefined);
      addLog("Health Response:", result);
    } catch (err: any) {
      addLog("Error:", { message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Check Health</h2>
      <div className="space-y-3">
        <Field label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <Field label="Auth Token (optional)" value={authToken} onChange={setAuthToken} />
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="mt-4 px-6 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition disabled:opacity-50"
      >
        {loading ? "Checking..." : "Check Health"}
      </button>
    </div>
  );
}
