/**
 * Multi-Snapshot 페이지
 * 멀티 카메라 동기화 스냅샷 캡처 및 뷰어
 * - 좌측: 채널 선택 체크박스 + 동기화 캡처 시작/중지
 * - 중앙: 캡처 히스토리 목록
 * - 우측: 스냅샷 그리드 뷰 (선택된 캡처의 동기화된 이미지들)
 * - 자동 반복 캡처 (인터벌)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import { takeBulkSnapshot } from "@/api/recording";
import Toast from "@/components/Toast";

/* ────────────────── 타입 정의 ────────────────── */
interface SnapshotResult {
  [recordingId: string]: {
    actual_timestamp: { seconds: string; nanos: string };
    image_data: string;
  };
}

interface HistoryItem {
  timeKey: string;
  displayTime: string;
  camCount: number;
  data: SnapshotResult;
}

/* ────────────────── 메인 컴포넌트 ────────────────── */
export default function MultiSnapshotPage() {
  const { recordings } = useRecordings(3000);
  const { toast, showToast } = useToast();

  /* RUNNING 상태 녹화만 필터 */
  const runningRecordings = recordings.filter(
    (r: any) => r.state === "RUNNING" || r.state === 2
  );

  /* 선택된 채널 ID 목록 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* 캡처 상태 */
  const [isCapturing, setIsCapturing] = useState(false);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* 히스토리 */
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTimeKey, setActiveTimeKey] = useState<string | null>(null);
  const historyRef = useRef(new Set<string>()); // 중복 방지용

  /* 최대 히스토리 항목 수 */
  const MAX_HISTORY = 100;

  /* ── 전체 선택 토글 ── */
  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(runningRecordings.map((r: any) => r.recording_id));
      setSelectedIds(allIds);
    } else {
      setSelectedIds(new Set());
    }
  };

  /* ── 개별 채널 토글 ── */
  const toggleChannel = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ── 단일 동기화 스냅샷 촬영 ── */
  const takeSingleCapture = useCallback(
    async (ids: string[]) => {
      try {
        const results = await takeBulkSnapshot(ids);
        if (!results || Object.keys(results).length === 0) return;

        /* 첫 번째 결과에서 타임스탬프 추출 */
        const firstKey = Object.keys(results)[0];
        const ts = results[firstKey].actual_timestamp;
        const seconds = parseInt(ts.seconds || "0");
        const nanos = parseInt(ts.nanos || "0");
        const timeKey = `${seconds}.${nanos}`;

        /* 중복 시점 방지 */
        if (historyRef.current.has(timeKey)) return;
        historyRef.current.add(timeKey);

        const date = new Date(seconds * 1000);
        const displayTime =
          date.toLocaleTimeString() +
          `.${Math.floor(nanos / 1000000)
            .toString()
            .padStart(3, "0")}`;

        const newItem: HistoryItem = {
          timeKey,
          displayTime,
          camCount: Object.keys(results).length,
          data: results,
        };

        setHistory((prev) => {
          const updated = [newItem, ...prev];
          /* 최대 개수 초과 시 가장 오래된 항목 제거 */
          if (updated.length > MAX_HISTORY) {
            const removed = updated.pop();
            if (removed) historyRef.current.delete(removed.timeKey);
          }
          return updated;
        });

        /* 캡처 중이면 최신 항목 자동 선택 */
        setActiveTimeKey(timeKey);
      } catch (err: any) {
        if (err.response?.status === 404) {
          showToast("동기화가 끊어졌습니다. 캡처를 중지합니다.", "error");
          stopCapture();
        }
      }
    },
    [showToast]
  );

  /* ── 선택된 채널 중 가장 낮은 FPS 기반으로 캡처 인터벌 계산 ── */
  const calculateCaptureInterval = useCallback(
    (ids: string[]): number => {
      const selectedRecs = runningRecordings.filter((r: any) =>
        ids.includes(r.recording_id)
      );
      /* jitter.recent_fps 값 수집, 없으면 기본 15fps 사용, 상한 30fps */
      const minFps = Math.min(
        ...selectedRecs.map((r: any) => r.jitter?.recent_fps || 15),
        30
      );
      /* 최소 50ms (20fps), 최대 2000ms (0.5fps) */
      return Math.max(50, Math.min(2000, Math.floor(1000 / minFps)));
    },
    [runningRecordings]
  );

  /* ── 캡처 시작 ── */
  const startCapture = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      showToast("채널을 선택해주세요.", "error");
      return;
    }
    setIsCapturing(true);

    /* 선택된 채널의 최소 FPS 기반 인터벌 계산 */
    const interval = calculateCaptureInterval(ids);
    console.log(`[MultiSnapshot] Capture interval: ${interval}ms (based on min FPS)`);

    /* 즉시 한 번 촬영 + 인터벌 시작 */
    takeSingleCapture(ids);
    captureTimerRef.current = setInterval(() => {
      takeSingleCapture(ids);
    }, interval);
  };

  /* ── 캡처 중지 ── */
  const stopCapture = useCallback(() => {
    setIsCapturing(false);
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
  }, []);

  /* 언마운트 시 타이머 정리 */
  useEffect(() => {
    return () => {
      if (captureTimerRef.current) clearInterval(captureTimerRef.current);
    };
  }, []);

  /* 현재 선택된 히스토리 항목 */
  const activeItem = history.find((h) => h.timeKey === activeTimeKey);

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* ── 좌측: 채널 선택 ── */}
      <div className="w-64 flex-shrink-0 bg-card border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-bold text-text-primary mb-3">Channels</h2>

          {/* 전체 선택 */}
          <label className="flex items-center gap-2 mb-3 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.size > 0 && selectedIds.size === runningRecordings.length}
              onChange={(e) => toggleSelectAll(e.target.checked)}
              disabled={isCapturing}
              className="accent-brand"
            />
            Select All
          </label>

          {/* 채널 목록 */}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {runningRecordings.length === 0 ? (
              <p className="text-xs text-text-muted">활성 카메라가 없습니다.</p>
            ) : (
              runningRecordings.map((rec: any) => (
                <label
                  key={rec.recording_id}
                  className="flex items-center gap-2 p-2 bg-bg-app border border-border rounded text-xs cursor-pointer hover:border-brand/50 transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(rec.recording_id)}
                    onChange={() => toggleChannel(rec.recording_id)}
                    disabled={isCapturing}
                    className="accent-brand"
                  />
                  <span className="text-text-primary font-mono truncate">{rec.recording_id}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* 캡처 제어 버튼 */}
        <div className="p-4">
          {!isCapturing ? (
            <button
              onClick={startCapture}
              disabled={selectedIds.size === 0}
              className="w-full px-4 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition disabled:opacity-50"
            >
              Start Capture
            </button>
          ) : (
            <button
              onClick={stopCapture}
              className="w-full px-4 py-2 bg-status-error text-white rounded-lg font-semibold text-sm hover:bg-status-error/80 transition"
            >
              Stop Capture
            </button>
          )}
        </div>
      </div>

      {/* ── 중앙: 히스토리 목록 ── */}
      <div className="w-56 flex-shrink-0 bg-card border-r border-border flex flex-col">
        <div className="p-3 border-b border-border">
          <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider">
            Capture History
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {history.length === 0 ? (
            <p className="text-xs text-text-muted p-2">캡처 기록이 없습니다.</p>
          ) : (
            history.map((item) => (
              <div
                key={item.timeKey}
                onClick={() => {
                  setActiveTimeKey(item.timeKey);
                  /* 클릭 시 캡처 중지 */
                  if (isCapturing) stopCapture();
                }}
                className={`p-2.5 rounded-lg cursor-pointer transition text-xs ${
                  activeTimeKey === item.timeKey
                    ? "bg-brand/10 border border-brand text-white"
                    : "bg-bg-app border border-border text-text-secondary hover:border-brand/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-brand">{item.displayTime}</span>
                  <span className="text-text-muted text-[10px]">{item.camCount} cams</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 우측: 스냅샷 그리드 뷰 ── */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeItem ? (
          <>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-text-primary">{activeItem.displayTime}</h2>
              <p className="text-xs text-text-muted">
                Channels: {activeItem.camCount}
              </p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {Object.entries(activeItem.data).map(([rid, snap]) => (
                <div
                  key={rid}
                  className="bg-black rounded-lg border border-border overflow-hidden relative"
                >
                  <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded z-10 font-mono">
                    {rid}
                  </div>
                  <img
                    src={snap.image_data}
                    alt={`snapshot-${rid}`}
                    className="w-full aspect-video object-cover"
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">
            캡처를 시작하거나 히스토리에서 항목을 선택하세요.
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
