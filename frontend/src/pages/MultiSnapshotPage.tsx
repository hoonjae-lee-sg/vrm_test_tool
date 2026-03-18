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
import {
  startReceiverCapture,
  stopReceiverCapture,
  getReceiverStatus,
} from "@/api/snapshot_receiver";
import Toast from "@/components/Toast";

/* ────────────────── 타입 정의 ────────────────── */
interface SnapshotResult {
  [recordingId: string]: {
    actual_timestamp: { seconds: string; nanos: string };
    image_data: string;
    is_pts_synced?: boolean;
    auto_sync_offset_ms?: number;
  };
}

interface HistoryItem {
  timeKey: string;
  displayTime: string;
  camCount: number;
  data: SnapshotResult;
  masterId?: string;
  syncWarnings?: string[];
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

  /* ── 서버 모드 (Snapshot Receiver) 상태 ── */
  const [serverMode, setServerMode] = useState(false);
  const [serverStatus, setServerStatus] = useState<any>(null);
  const serverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        const raw = await takeBulkSnapshot(ids);

        /* 응답 형식 호환: 새 형식(snapshots 래핑) / 구 형식(flat) 모두 지원 */
        const snapshots: SnapshotResult =
          (raw as any).snapshots ?? (raw as unknown as SnapshotResult);
        const masterId: string | undefined = (raw as any).master_id;
        const syncWarnings: string[] | undefined = (raw as any).sync_warnings;

        if (!snapshots || Object.keys(snapshots).length === 0) return;

        /* 마스터 카메라 기준 타임스탬프 추출 */
        const firstKey = masterId && snapshots[masterId] ? masterId : Object.keys(snapshots)[0];
        const ts = snapshots[firstKey].actual_timestamp;
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

        /* 동기화 경고 토스트 표시 (첫 1회만) */
        if (syncWarnings && syncWarnings.length > 0) {
          showToast(syncWarnings[0], "error");
        }

        const newItem: HistoryItem = {
          timeKey,
          displayTime,
          camCount: Object.keys(snapshots).length,
          data: snapshots,
          masterId,
          syncWarnings,
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
  const startCapture = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      showToast("채널을 선택해주세요.", "error");
      return;
    }

    if (serverMode) {
      /* ── 서버 모드: Snapshot Receiver에 캡처 위임 ── */
      try {
        const result = await startReceiverCapture(ids);
        setIsCapturing(true);
        showToast(
          `서버 캡처 시작: ${ids.length}ch × ${result.fps}fps (${result.interval_ms}ms)`,
          "success"
        );
        /* 상태 폴링 시작 (1초 간격) */
        serverPollRef.current = setInterval(async () => {
          try {
            const status = await getReceiverStatus();
            setServerStatus(status);
          } catch {
            /* 폴링 에러 무시 */
          }
        }, 1000);
      } catch (err: any) {
        const detail = err.response?.data?.detail || err.message;
        showToast(`서버 캡처 시작 실패: ${detail}`, "error");
      }
      return;
    }

    /* ── 브라우저 모드: 기존 방식 ── */
    setIsCapturing(true);
    const interval = calculateCaptureInterval(ids);
    console.log(`[MultiSnapshot] Capture interval: ${interval}ms (based on min FPS)`);

    takeSingleCapture(ids);
    captureTimerRef.current = setInterval(() => {
      takeSingleCapture(ids);
    }, interval);
  };

  /* ── 캡처 중지 ── */
  const stopCapture = useCallback(async () => {
    if (serverMode && isCapturing) {
      /* 서버 모드 중지 */
      try {
        const result = await stopReceiverCapture();
        showToast(
          `서버 캡처 종료: ${result.total_captured}장 캡처, ${result.total_dropped}장 드롭`,
          "success"
        );
      } catch {
        /* 중지 실패해도 UI는 정리 */
      }
      if (serverPollRef.current) {
        clearInterval(serverPollRef.current);
        serverPollRef.current = null;
      }
    }

    setIsCapturing(false);
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
  }, [serverMode, isCapturing, showToast]);

  /* 언마운트 시 타이머 정리 */
  useEffect(() => {
    return () => {
      if (captureTimerRef.current) clearInterval(captureTimerRef.current);
      if (serverPollRef.current) clearInterval(serverPollRef.current);
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

        {/* ── 서버 모드 토글 ── */}
        <div className="px-4 pt-3 pb-1">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-text-secondary">Server Mode</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={serverMode}
                onChange={(e) => setServerMode(e.target.checked)}
                disabled={isCapturing}
                className="sr-only"
              />
              <div
                onClick={() => !isCapturing && setServerMode(!serverMode)}
                className={`w-9 h-5 rounded-full transition-colors ${
                  serverMode ? "bg-brand" : "bg-bg-hover"
                } ${isCapturing ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    serverMode ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </div>
            </div>
          </label>
          {serverMode && (
            <p className="text-[10px] text-text-muted mt-1">
              24fps 고속 캡처 → 디스크 저장
            </p>
          )}
        </div>

        {/* ── 서버 상태 표시 (서버 모드 + 캡처 중일 때) ── */}
        {serverMode && isCapturing && serverStatus?.session && (
          <div className="px-4 py-2 text-[10px] space-y-1 border-t border-border">
            <div className="flex justify-between text-text-secondary">
              <span>캡처</span>
              <span className="font-mono text-text-primary">
                {serverStatus.session.total_captured}장
              </span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>저장</span>
              <span className="font-mono text-status-running">
                {serverStatus.writer?.total_saved ?? 0}장
              </span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>드롭</span>
              <span className="font-mono text-status-error">
                {serverStatus.session.total_dropped}장
              </span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>큐</span>
              <span className="font-mono">
                {serverStatus.queue?.current_size}/{serverStatus.queue?.max_size}
              </span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>속도</span>
              <span className="font-mono">
                {serverStatus.session.capture_rate} img/s
              </span>
            </div>
          </div>
        )}

        {/* 캡처 제어 버튼 */}
        <div className="p-4">
          {!isCapturing ? (
            <button
              onClick={startCapture}
              disabled={selectedIds.size === 0}
              className="w-full px-4 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition disabled:opacity-50"
            >
              {serverMode ? "Start Server Capture" : "Start Capture"}
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
            {/* 동기화 경고 배너 */}
            {activeItem.syncWarnings && activeItem.syncWarnings.length > 0 && (
              <div className="mb-3 p-2 bg-status-error/10 border border-status-error/30 rounded-lg">
                {activeItem.syncWarnings.map((w, i) => (
                  <p key={i} className="text-xs text-status-error">{w}</p>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {Object.entries(activeItem.data).map(([rid, snap]) => (
                <div
                  key={rid}
                  className={`bg-black rounded-lg border overflow-hidden relative ${
                    snap.is_pts_synced === false ? "border-status-error/50" : "border-border"
                  }`}
                >
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1 z-10">
                    <span className="bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                      {rid}
                    </span>
                    {rid === activeItem.masterId && (
                      <span className="bg-brand/80 text-white text-[9px] px-1 py-0.5 rounded font-bold">
                        MASTER
                      </span>
                    )}
                    {snap.is_pts_synced === false && (
                      <span className="bg-status-error/80 text-white text-[9px] px-1 py-0.5 rounded font-bold">
                        NO SYNC
                      </span>
                    )}
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
