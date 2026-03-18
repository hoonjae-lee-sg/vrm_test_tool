/**
 * Tester 페이지 레이아웃 셸
 * gRPC API 개별 테스트 (Start/Stop/Status/EventClip/Clip/Snapshot/Health)
 * - 좌측: API 메뉴 사이드바
 * - 중앙: 선택된 API별 폼 패널
 * - 우측: Response 로그 패널
 * - 플로팅 녹화 목록 패널
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import { TESTER_REFRESH_INTERVAL_MS } from "@/constants";
import StatusBadge from "@/components/StatusBadge";
import FloatingPanel from "@/components/FloatingPanel";
import Toast from "@/components/Toast";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import LogViewer, { type LogEntry } from "./components/LogViewer";

/* 패널 컴포넌트 임포트 */
import StartPanel from "./panels/StartPanel";
import StopPanel from "./panels/StopPanel";
import RestartPanel from "./panels/RestartPanel";
import StatusPanel from "./panels/StatusPanel";
import SnapshotPanel from "./panels/SnapshotPanel";
import EventClipPanel from "./panels/EventClipPanel";
import SimpleClipPanel from "./panels/SimpleClipPanel";
import HealthPanel from "./panels/HealthPanel";

/* ────────────────── API 메뉴 정의 ────────────────── */

/** API 패널 식별 타입 */
type ApiPanel =
  | "start"
  | "stop"
  | "restart"
  | "status"
  | "event-start"
  | "event-stop"
  | "clip"
  | "snapshot"
  | "health";

/** 사이드바 메뉴 항목 배열 — 패널 ID, 표시 라벨, HTTP 메서드 */
const API_MENU: { id: ApiPanel; label: string; method: string }[] = [
  { id: "start", label: "Start Recording", method: "POST" },
  { id: "stop", label: "Stop Recording", method: "POST" },
  { id: "restart", label: "Restart Recording", method: "POST" },
  { id: "status", label: "Check Status", method: "GET" },
  { id: "event-start", label: "Start Event Clip", method: "POST" },
  { id: "event-stop", label: "Stop Event Clip", method: "POST" },
  { id: "clip", label: "Create Clip", method: "POST" },
  { id: "snapshot", label: "Take Snapshot", method: "POST" },
  { id: "health", label: "Check Health", method: "GET" },
];

/* ────────────────── 메인 컴포넌트 ────────────────── */
export default function TesterPage() {
  /** 녹화 목록 자동 갱신 훅 */
  const { recordings, refresh } = useRecordings(TESTER_REFRESH_INTERVAL_MS);
  /** 토스트 알림 훅 */
  const { toast, showToast } = useToast();

  /** 현재 선택된 API 패널 */
  const [activePanel, setActivePanel] = useState<ApiPanel>("start");

  /** 로그 상태 관리 */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  /** 로그 ID 카운터 — 고유 식별자 생성용 */
  const logIdRef = useRef(0);

  /** 공통 recording ID — 하나를 입력하면 모든 폼에 반영 */
  const [recordingId, setRecordingId] = useState("");

  /** 플로팅 패널 최소화 상태 */
  const [floatingMinimized, setFloatingMinimized] = useState(false);

  /** sessionStorage에서 target_id 로드 (Dashboard에서 넘어온 경우) */
  useEffect(() => {
    const targetId = sessionStorage.getItem("target_id");
    if (targetId) {
      setRecordingId(targetId);
      sessionStorage.removeItem("target_id");
    }
  }, []);

  /** 로그 추가 함수 — 타임스탬프 자동 부여 및 하단 스크롤 */
  const addLog = useCallback((title: string, data?: unknown) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { id: ++logIdRef.current, time, title, data }]);
  }, []);

  /** 플로팅 패널에서 Recording ID 선택 시 공통 ID 반영 */
  const selectRecordingId = (id: string) => {
    setRecordingId(id);
    addLog("Selected Recording ID", { recording_id: id });
  };

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* ── 좌측: API 메뉴 사이드바 — 글래스모피즘 배경 ── */}
      <div className="w-56 flex-shrink-0 bg-white/[0.02] backdrop-blur-xl border-r border-white/[0.06] overflow-y-auto">
        <div className="p-3">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            API Methods
          </h3>
          <nav className="space-y-1">
            {API_MENU.map((item) => (
              <button
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                /* API 메뉴 버튼 — 활성 시 브랜드 좌측 보더 표시 */
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                  activePanel === item.id
                    ? "bg-brand/10 text-brand font-semibold border-l-2 border-brand"
                    : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary"
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

      {/* ── 중앙: 선택된 API 폼 패널 — max-w 제한으로 과도한 확장 방지 ── */}
      <div className="flex-1 min-w-0 overflow-y-auto p-6 flex justify-center">
      <div className="w-full max-w-2xl">
        {activePanel === "start" && (
          <StartPanel addLog={addLog} showToast={showToast} refresh={refresh} />
        )}
        {activePanel === "stop" && (
          <StopPanel
            recordingId={recordingId}
            setRecordingId={setRecordingId}
            addLog={addLog}
            showToast={showToast}
            refresh={refresh}
          />
        )}
        {activePanel === "restart" && (
          <RestartPanel
            recordingId={recordingId}
            setRecordingId={setRecordingId}
            addLog={addLog}
            showToast={showToast}
            refresh={refresh}
          />
        )}
        {activePanel === "status" && (
          <StatusPanel
            recordingId={recordingId}
            setRecordingId={setRecordingId}
            addLog={addLog}
          />
        )}
        {activePanel === "event-start" && (
          <EventClipPanel
            mode="start"
            recordingId={recordingId}
            setRecordingId={setRecordingId}
            addLog={addLog}
          />
        )}
        {activePanel === "event-stop" && (
          <EventClipPanel
            mode="stop"
            recordingId={recordingId}
            setRecordingId={setRecordingId}
            addLog={addLog}
          />
        )}
        {activePanel === "clip" && (
          <SimpleClipPanel
            recordingId={recordingId}
            setRecordingId={setRecordingId}
            addLog={addLog}
          />
        )}
        {activePanel === "snapshot" && (
          <SnapshotPanel
            recordingId={recordingId}
            setRecordingId={setRecordingId}
            addLog={addLog}
          />
        )}
        {activePanel === "health" && (
          <HealthPanel
            recordingId={recordingId}
            setRecordingId={setRecordingId}
            addLog={addLog}
          />
        )}
      </div>
      </div>

      {/* ── 우측: Response 로그 뷰어 ── */}
      <LogViewer logs={logs} onClear={() => setLogs([])} />

      {/* ── 플로팅 녹화 목록 패널 ── */}
      <FloatingPanel
        title={`Recordings (${recordings.length})`}
        isMinimized={floatingMinimized}
        onToggleMinimize={() => setFloatingMinimized(!floatingMinimized)}
      >
        {/* 새로고침 버튼 — FloatingPanel 헤더 외부에 별도 배치 */}
        <div className="flex justify-end px-3 pt-1">
          <button
            onClick={refresh}
            className="text-xs text-text-muted hover:text-text-primary"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        {recordings.length === 0 ? (
          <p className="text-xs text-text-muted p-3">No recordings found.</p>
        ) : (
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {recordings.map((rec) => (
                  <tr key={rec.recording_id} className="hover:bg-card-hover">
                    {/* Recording ID — 앞 12자 표시 */}
                    <td
                      className="px-3 py-1.5 font-mono truncate max-w-[120px]"
                      title={rec.recording_id}
                    >
                      {rec.recording_id.substring(0, 12)}...
                    </td>
                    {/* 녹화 상태 배지 */}
                    <td className="px-1 py-1.5">
                      <StatusBadge state={rec.state} />
                    </td>
                    {/* 선택 버튼 */}
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
          </div>
        )}
      </FloatingPanel>

      {/* 토스트 알림 */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
