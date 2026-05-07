/**
 * Live Grid 페이지
 * WebSocket MPEG-TS 라이브 스트림 그리드 뷰
 * - 동적 그리드 레이아웃 (1x1, 2x2, 3x3 자동 계산)
 * - 라이브 뷰 추가 모달 / 녹화 시작 모달
 * - 플로팅 녹화 목록 패널
 * - 공유 컴포넌트 (Modal, FloatingPanel, FormField) 활용
 */
import { useState, useEffect, useCallback } from "react";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import { startRecording, type StartRecordingParams } from "@/api/recording";
import type { Recording } from "@/types/recording";
import Modal from "@/components/Modal";
import FloatingPanel from "@/components/FloatingPanel";
import FormField from "@/components/FormField";
import StatusBadge from "@/components/StatusBadge";
import Toast from "@/components/Toast";
import Button from "@/components/Button";
import LiveCell from "@/pages/live/LiveCell";
import {
  PlusIcon,
  VideoCameraIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import {
  LIVE_REFRESH_INTERVAL_MS,
  MAX_LIVE_STREAMS,
  DEFAULT_RETENTION_DAYS,
} from "@/constants";

/* ────────────────── 스트림 식별 정보 ────────────────── */

/** 활성 스트림 항목 — uniqueId로 그리드 셀 구분 */
interface StreamInfo {
  /** 고유 식별자 (recId-quality-timestamp) */
  uniqueId: string;
  /** 녹화 ID */
  recId: string;
  /** 스트림 품질 (hq / sq) */
  quality: string;
}

/* ────────────────── 메인 컴포넌트 ────────────────── */

export default function LivePage() {
  const { recordings, refresh } = useRecordings(LIVE_REFRESH_INTERVAL_MS);
  const { toast, showToast } = useToast();

  /* 활성 스트림 목록 */
  const [streams, setStreams] = useState<StreamInfo[]>([]);

  /* 모달 상태 */
  const [viewModal, setViewModal] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [viewRecId, setViewRecId] = useState("");
  const [viewQuality, setViewQuality] = useState("hq");

  /* 녹화 시작 모달 폼 */
  const [addForm, setAddForm] = useState({
    recId: "",
    hqUrl: "",
    sqUrl: "",
    mode: "CONTINUOUS",
    codec: "H264",
    retention: String(DEFAULT_RETENTION_DAYS),
  });

  /* 플로팅 패널 접기 상태 */
  const [floatingMinimized, setFloatingMinimized] = useState(false);

  /* 검색 / 레이아웃 / 포커스 모드 / 필터 / 선택 */
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<"auto" | "1x1" | "2x2" | "3x3">("auto");
  const [focusMode, setFocusMode] = useState(false);
  const [filter, setFilter] = useState<"all" | "running" | "event" | "issues">("all");
  const [selectedRecId, setSelectedRecId] = useState<string | null>(null);

  /* URL 파라미터에서 자동 스트림 추가 — ?id=xxx 형식 */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) {
      addStream(id, "hq");
    }
  }, []);

  /* ── 스트림 추가 ── */
  const addStream = useCallback(
    (recId: string, quality: string = "hq") => {
      /* 중복 스트림 방지 */
      if (streams.some((s) => s.recId === recId && s.quality === quality)) {
        showToast(`이미 ${recId} (${quality.toUpperCase()})를 보고 있습니다.`, "error");
        return;
      }
      /* 최대 스트림 수 제한 */
      if (streams.length >= MAX_LIVE_STREAMS) {
        showToast("최대 9개 스트림까지 가능합니다.", "error");
        return;
      }
      const uniqueId = `${recId}-${quality}-${Date.now()}`;
      setStreams((prev) => [...prev, { uniqueId, recId, quality }]);
    },
    [streams, showToast]
  );

  /* ── 스트림 제거 ── */
  const removeStream = useCallback((uniqueId: string) => {
    setStreams((prev) => prev.filter((s) => s.uniqueId !== uniqueId));
  }, []);

  /* ── 녹화 시작 요청 ── */
  const handleStartRecording = async () => {
    if (!addForm.hqUrl || !addForm.sqUrl) {
      showToast("HQ/SQ URL을 입력해주세요.", "error");
      return;
    }
    try {
      const params: StartRecordingParams = {
        serial_number: addForm.recId || `SN-${Date.now()}`,
        hq_url: addForm.hqUrl,
        sq_url: addForm.sqUrl,
        recording_mode: addForm.mode,
        encoding_codec: addForm.codec,
        retention_days: parseInt(addForm.retention) || DEFAULT_RETENTION_DAYS,
      };
      await startRecording(params);
      setAddModal(false);
      refresh();
      showToast("녹화가 시작되었습니다.", "success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`녹화 시작 실패: ${message}`, "error");
    }
  };

  /* ── 카운트 — recordings 기반 ── */
  const isRunning = (r: Recording) => r.state === "RUNNING" || r.state === 2;
  const isEvent = (r: Recording) => r.recording_mode === "EVENT";
  const isError = (r: Recording) =>
    r.state === "ERROR" || r.state === 4 || r.state === "STOPPED" || r.state === 3;
  const runningCount = (recordings as Recording[]).filter(isRunning).length;
  const eventCount = (recordings as Recording[]).filter(isEvent).length;
  const errorCount = (recordings as Recording[]).filter(isError).length;

  /* ── 검색 + 필터 ── */
  const visibleStreams = streams.filter((s) => {
    if (query.trim() && !s.recId.toLowerCase().includes(query.toLowerCase().trim())) return false;
    if (filter !== "all") {
      const rec = (recordings as Recording[]).find((r) => r.recording_id === s.recId);
      if (!rec) return filter === "issues"; /* 매칭 안되면 issues에만 노출 */
      if (filter === "running") return isRunning(rec) && !isEvent(rec);
      if (filter === "event") return isEvent(rec);
      if (filter === "issues") return isError(rec);
    }
    return true;
  });

  /* ── 선택된 카메라 정보 ── */
  const selectedRec = selectedRecId
    ? (recordings as Recording[]).find((r) => r.recording_id === selectedRecId)
    : null;

  /* ── 그리드 크기 계산 — auto일 때는 스트림 수에 따라 자동 ── */
  const count = visibleStreams.length;
  const cols =
    layout === "1x1" ? 1 :
    layout === "2x2" ? 2 :
    layout === "3x3" ? 3 :
    count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows =
    layout === "1x1" ? 1 :
    layout === "2x2" ? 2 :
    layout === "3x3" ? 3 :
    Math.ceil(Math.max(count, 1) / cols);

  /* ── 레이아웃 토글 버튼 */
  const LayoutBtn = ({
    id,
    label,
  }: {
    id: "auto" | "1x1" | "2x2" | "3x3";
    label: string;
  }) => (
    <button
      onClick={() => setLayout(id)}
      className={`h-7 px-2.5 text-[11px] font-mono font-semibold rounded transition-colors ${
        layout === id
          ? "bg-text-primary text-bg-app"
          : "text-text-muted hover:text-text-primary"
      }`}
      title={`Layout ${label}`}
    >
      {label}
    </button>
  );

  /* ── 필터 칩 ── */
  const FilterChip = ({
    id,
    label,
    count,
  }: {
    id: "all" | "running" | "event" | "issues";
    label: string;
    count: number;
  }) => (
    <button
      onClick={() => setFilter(id)}
      className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
        filter === id
          ? "bg-text-primary text-bg-app border-text-primary"
          : "bg-bg-card text-text-secondary border-border hover:bg-bg-hover hover:text-text-primary"
      }`}
    >
      {label}
      <span
        className={`text-[10px] font-mono tabular px-1 py-0.5 rounded ${
          filter === id ? "bg-white/20" : "bg-bg-app text-text-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] bg-bg-app">
      {/* ── 헤더 바 ── */}
      <div className="flex items-center gap-3 px-6 py-3 bg-bg-card border-b border-border">
        <div>
          <h1 className="text-[15px] font-semibold text-text-primary tracking-tight leading-none">Live grid</h1>
          <div className="text-[11px] text-text-muted mt-1 tabular">
            {streams.length} active stream{streams.length === 1 ? "" : "s"}
            {query && ` · ${visibleStreams.length} matching“${query}”`}
          </div>
        </div>

        {/* 검색 */}
        <div className="flex items-center gap-2 ml-6 px-3 h-8 bg-bg-app border border-border rounded-md w-72">
          <MagnifyingGlassIcon className="w-3.5 h-3.5 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by recording ID…"
            className="flex-1 bg-transparent border-none outline-none text-[12px] text-text-primary placeholder-text-muted"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-text-muted hover:text-text-primary">
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 필터 칩 */}
        <div className="flex items-center gap-1.5 ml-2">
          <FilterChip id="all" label="All" count={recordings.length} />
          <FilterChip id="running" label="Continuous" count={Math.max(0, runningCount - eventCount)} />
          <FilterChip id="event" label="Event" count={eventCount} />
          <FilterChip id="issues" label="Issues" count={errorCount} />
        </div>

        <div className="flex-1" />

        {/* 레이아웃 토글 */}
        <div className="flex items-center gap-1 px-1.5 h-8 bg-bg-app border border-border rounded-md">
          <Squares2X2Icon className="w-3.5 h-3.5 text-text-muted ml-1" />
          <LayoutBtn id="auto" label="AUTO" />
          <LayoutBtn id="1x1" label="1×1" />
          <LayoutBtn id="2x2" label="2×2" />
          <LayoutBtn id="3x3" label="3×3" />
        </div>

        {/* 포커스 토글 */}
        <button
          onClick={() => setFocusMode((f) => !f)}
          className={`flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium rounded-md border transition-colors ${
            focusMode
              ? "bg-text-primary text-bg-app border-text-primary"
              : "bg-bg-card text-text-primary border-border hover:bg-bg-hover"
          }`}
        >
          {focusMode ? <ArrowsPointingInIcon className="w-3.5 h-3.5" /> : <ArrowsPointingOutIcon className="w-3.5 h-3.5" />}
          {focusMode ? "Exit" : "Focus"}
        </button>

        {/* 액션 */}
        <button
          onClick={() => {
            setViewRecId("");
            setViewModal(true);
          }}
          className="flex items-center gap-1.5 h-8 px-3 bg-brand-soft text-brand text-[12px] font-medium rounded-md hover:bg-brand hover:text-white transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5" /> Add stream
        </button>
        <button
          onClick={() => {
            setAddForm({
              recId: `SN-${Date.now()}`,
              hqUrl: "",
              sqUrl: "",
              mode: "CONTINUOUS",
              codec: "H264",
              retention: String(DEFAULT_RETENTION_DAYS),
            });
            setAddModal(true);
          }}
          className="flex items-center gap-1.5 h-8 px-3 bg-text-primary text-white text-[12px] font-medium rounded-md hover:bg-text-primary/90 transition-colors"
        >
          <VideoCameraIcon className="w-3.5 h-3.5" /> Start recording
        </button>
      </div>

      {/* ── 그리드 + 우측 상세 패널 ── */}
      <div className="flex-1 flex overflow-hidden">
      <div className={`${focusMode || streams.length === 0 ? "flex-1" : "flex-1"} p-3 overflow-hidden`}>
        {streams.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-text-muted">
            <VideoCameraIcon className="w-10 h-10 text-text-muted opacity-40" />
            <div className="text-[13px]">활성 라이브 스트림이 없습니다</div>
            <button
              onClick={() => {
                setViewRecId("");
                setViewModal(true);
              }}
              className="text-[12px] text-brand hover:underline"
            >
              + Add a stream to start
            </button>
          </div>
        ) : count === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-[13px]">
            검색 결과 없음
            <button onClick={() => setQuery("")} className="ml-2 text-brand hover:underline">Clear</button>
          </div>
        ) : (
          <div
            className="w-full h-full grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            }}
          >
            {visibleStreams.map((stream) => (
              <div
                key={stream.uniqueId}
                onClick={() => setSelectedRecId(stream.recId)}
                className={`relative ${selectedRecId === stream.recId ? "ring-2 ring-brand ring-offset-1 ring-offset-bg-app rounded-md" : ""}`}
              >
                <LiveCell
                  uniqueId={stream.uniqueId}
                  recId={stream.recId}
                  quality={stream.quality}
                  onRemove={removeStream}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 우측 상세 패널 — focusMode가 아닐 때만 ── */}
      {!focusMode && streams.length > 0 && (
        <aside className="w-72 flex-shrink-0 bg-bg-sidebar border-l border-border overflow-y-auto">
          {selectedRec ? (
            <>
              {/* 카메라 정보 */}
              <div className="px-4 py-3 border-b border-border-subtle">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
                  Selected camera
                </div>
                <div className="font-mono text-[13px] font-semibold text-text-primary tracking-tight truncate">
                  {selectedRec.recording_id}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <StatusBadge state={selectedRec.state} />
                  {selectedRec.recording_mode === "EVENT" && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-brand text-white rounded font-semibold uppercase tracking-wider">
                      event
                    </span>
                  )}
                </div>
              </div>

              {/* 메트릭 */}
              <div className="px-4 py-3 grid grid-cols-2 gap-y-3 gap-x-4 border-b border-border-subtle">
                {[
                  ["State", String(selectedRec.state)],
                  ["Mode", selectedRec.recording_mode || "—"],
                  ["FPS", selectedRec.jitter?.recent_fps != null ? selectedRec.jitter.recent_fps.toFixed(1) : "—"],
                  ["NTP", selectedRec.ntp_synced ? "synced" : "—"],
                  ["HQ limit", selectedRec.hq_storage_limit_mbs ? `${selectedRec.hq_storage_limit_mbs} MB` : "—"],
                  ["SQ limit", selectedRec.sq_storage_limit_mbs ? `${selectedRec.sq_storage_limit_mbs} MB` : "—"],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="text-[9px] uppercase tracking-wider text-text-muted font-semibold mb-0.5">{l}</div>
                    <div className="font-mono text-[12px] tabular text-text-primary truncate">{v}</div>
                  </div>
                ))}
              </div>

              {/* 액션 */}
              <div className="px-4 py-3 border-b border-border-subtle flex gap-2">
                <button
                  onClick={() => {
                    sessionStorage.setItem("target_id", selectedRec.recording_id);
                    window.location.hash = "#/tester";
                  }}
                  className="flex-1 h-7 px-2 bg-text-primary text-white text-[11px] font-medium rounded hover:bg-text-primary/90 transition-colors"
                >
                  Snapshot
                </button>
                <button
                  onClick={() => { window.location.hash = "#/playlist"; }}
                  className="flex-1 h-7 px-2 bg-bg-card border border-border text-text-primary text-[11px] font-medium rounded hover:bg-bg-hover transition-colors"
                >
                  Playback
                </button>
              </div>

              {/* 최근 이벤트 — placeholder, 실 데이터는 /events/recent?camera_id= 필요 */}
              <div className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-2">
                  Recent events
                </div>
                <div className="text-[11px] text-text-muted py-3 text-center border border-dashed border-border rounded">
                  no events
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-[12px] text-text-muted px-6 text-center">
              그리드의 카메라를 선택하면<br />상세 정보가 표시됩니다.
            </div>
          )}
        </aside>
      )}
      </div>

      {/* ── 라이브 뷰 추가 모달 ── */}
      <Modal isOpen={viewModal} onClose={() => setViewModal(false)} title="라이브 뷰 추가">
        <div className="space-y-3">
          <FormField
            label="Recording ID"
            value={viewRecId}
            onChange={setViewRecId}
            placeholder="Recording ID 입력"
          />
          <FormField label="Quality" value={viewQuality} onChange={setViewQuality}>
            <option value="hq">HQ (High Quality)</option>
            <option value="sq">SQ (Standard Quality)</option>
          </FormField>
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" size="md" onClick={() => setViewModal(false)}>
            취소
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              if (!viewRecId.trim()) return showToast("Recording ID를 입력하세요.", "error");
              addStream(viewRecId.trim(), viewQuality);
              setViewModal(false);
            }}
          >
            확인
          </Button>
        </div>
      </Modal>

      {/* ── 녹화 시작 모달 ── */}
      <Modal isOpen={addModal} onClose={() => setAddModal(false)} title="녹화 시작">
        <div className="space-y-3">
          <FormField
            label="Serial Number"
            value={addForm.recId}
            onChange={(v) => setAddForm((p) => ({ ...p, recId: v }))}
          />
          <FormField
            label="HQ RTSP URL"
            value={addForm.hqUrl}
            onChange={(v) => setAddForm((p) => ({ ...p, hqUrl: v }))}
            placeholder="rtsp://..."
          />
          <FormField
            label="SQ RTSP URL"
            value={addForm.sqUrl}
            onChange={(v) => setAddForm((p) => ({ ...p, sqUrl: v }))}
            placeholder="rtsp://..."
          />
          <div className="grid grid-cols-3 gap-3">
            <FormField
              label="Mode"
              value={addForm.mode}
              onChange={(v) => setAddForm((p) => ({ ...p, mode: v }))}
            >
              <option value="CONTINUOUS">CONTINUOUS</option>
              <option value="EVENT">EVENT</option>
            </FormField>
            <FormField
              label="Codec"
              value={addForm.codec}
              onChange={(v) => setAddForm((p) => ({ ...p, codec: v }))}
            >
              <option value="H264">H264</option>
              <option value="H265">H265</option>
            </FormField>
            <FormField
              label="Retention"
              value={addForm.retention}
              onChange={(v) => setAddForm((p) => ({ ...p, retention: v }))}
              type="number"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" size="md" onClick={() => setAddModal(false)}>
            취소
          </Button>
          <Button variant="primary" size="md" onClick={handleStartRecording}>
            Start Recording
          </Button>
        </div>
      </Modal>

      {/* ── 플로팅 녹화 목록 패널 ── */}
      <FloatingPanel
        title="Recordings"
        isMinimized={floatingMinimized}
        onToggleMinimize={() => setFloatingMinimized(!floatingMinimized)}
        className="fixed bottom-4 right-4 w-64"
      >
        {/* 새로고침 버튼 — 패널 헤더 내 절대 위치 배치 */}
        <button
          onClick={(e) => { e.stopPropagation(); refresh(); }}
          className="absolute top-2 right-8 text-xs text-text-muted hover:text-text-primary z-10"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
        </button>
        <div className="max-h-52 overflow-y-auto">
          {(recordings as Recording[]).map((rec) => (
            <div
              key={rec.recording_id}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-card-hover cursor-pointer text-xs"
              onClick={() => {
                setViewRecId(rec.recording_id);
                setViewModal(true);
              }}
            >
              <span className="font-mono text-text-primary truncate flex-1">
                {rec.recording_id}
              </span>
              <StatusBadge state={rec.state} />
            </div>
          ))}
        </div>
      </FloatingPanel>

      {/* 토스트 알림 */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
