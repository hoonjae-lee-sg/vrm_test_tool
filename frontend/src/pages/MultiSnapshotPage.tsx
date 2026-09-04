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
import { takeBulkSnapshot, type BulkSnapshotResponse } from "@/api/recording";
import {
  startReceiverCapture,
  stopReceiverCapture,
  getReceiverStatus,
} from "@/api/snapshot_receiver";
import type { Recording, SnapshotResult, HistoryItem } from "@/types/recording";
import {
  DEFAULT_REFRESH_INTERVAL_MS,
  MAX_SNAPSHOT_HISTORY,
  DEFAULT_CAPTURE_FPS,
  MAX_CAPTURE_FPS,
  MIN_CAPTURE_INTERVAL_MS,
  MAX_CAPTURE_INTERVAL_MS,
  RECEIVER_STATUS_POLL_INTERVAL_MS,
} from "@/constants";
import Toast from "@/components/Toast";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import DriftBar from "@/components/DriftBar";
import { CameraIcon, PhotoIcon } from "@heroicons/react/24/outline";
import { formatNumber } from "@/utils/format";

/* ────────────────── 메인 컴포넌트 ────────────────── */
export default function MultiSnapshotPage() {
  const { recordings } = useRecordings(DEFAULT_REFRESH_INTERVAL_MS);
  const { toast, showToast } = useToast();

  /* RUNNING 상태 녹화만 필터 */
  const runningRecordings = recordings.filter(
    (r: Recording) => r.state === "RUNNING" || r.state === 2
  );

  /* 선택된 채널 ID 목록 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* 캡처 상태 */
  const [isCapturing, setIsCapturing] = useState(false);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── 서버 모드 (Snapshot Receiver) 상태 ── */
  const [serverMode, setServerMode] = useState(false);
  /* Snapshot Receiver 상태 응답 타입 */
  const [serverStatus, setServerStatus] = useState<{
    session?: { total_captured: number; total_dropped: number; capture_rate: number };
    writer?: { total_saved: number };
    queue?: { current_size: number; max_size: number };
  } | null>(null);
  const serverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* 히스토리 */
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTimeKey, setActiveTimeKey] = useState<string | null>(null);
  const historyRef = useRef(new Set<string>()); // 중복 방지용

  /* 최대 히스토리 항목 수 — 상수 모듈에서 가져온 값 */
  const MAX_HISTORY = MAX_SNAPSHOT_HISTORY;

  /* ── 전체 선택 토글 ── */
  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(runningRecordings.map((r: Recording) => r.recording_id));
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

        /* 응답 형식 호환: 새 형식(BulkSnapshotResponse 래핑) / 구 형식(flat) 모두 지원 */
        const typed = raw as Partial<BulkSnapshotResponse> & SnapshotResult;
        const snapshots: SnapshotResult =
          typed.snapshots ?? (raw as unknown as SnapshotResult);
        const masterId: string | undefined = typed.master_id;
        const syncWarnings: string[] | undefined = typed.sync_warnings;

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
      } catch (err: unknown) {
        /* axios 에러 응답에서 status 코드 추출 */
        const axiosErr = err as { response?: { status?: number } };
        if (axiosErr.response?.status === 404) {
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
      const selectedRecs = runningRecordings.filter((r: Recording) =>
        ids.includes(r.recording_id)
      );
      /* jitter.recent_fps 값 수집, 없으면 기본 FPS 사용, 상한 FPS 적용 */
      const minFps = Math.min(
        ...selectedRecs.map((r: Recording) => r.jitter?.recent_fps || DEFAULT_CAPTURE_FPS),
        MAX_CAPTURE_FPS
      );
      /* 캡처 인터벌 범위 제한 (MIN~MAX ms) */
      return Math.max(MIN_CAPTURE_INTERVAL_MS, Math.min(MAX_CAPTURE_INTERVAL_MS, Math.floor(1000 / minFps)));
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
        /* 상태 폴링 시작 — RECEIVER_STATUS_POLL_INTERVAL_MS 간격 */
        serverPollRef.current = setInterval(async () => {
          try {
            const status = await getReceiverStatus();
            setServerStatus(status);
          } catch {
            /* 폴링 에러 무시 */
          }
        }, RECEIVER_STATUS_POLL_INTERVAL_MS);
      } catch (err: unknown) {
        /* axios 에러 응답에서 상세 메시지 추출 */
        const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
        const detail = axiosErr.response?.data?.detail || axiosErr.message || "알 수 없는 오류";
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
    /* 3단 고정(256+240+본문)이 1024px 이하에서 본문을 288px 까지 밀어내 썸네일이
       68x38px 로 소멸했으므로, lg 미만에서는 두 사이드바를 본문 위로 세로 스택함.
       lg 이상에서만 기존 3단 + 내부 스크롤 구조를 유지 */
    <div className="flex flex-col lg:flex-row h-auto lg:h-full lg:min-h-0 lg:overflow-hidden">
      {/* ── 좌측: 채널 선택 — Studio 라이트 사이드바 ── */}
      <div className="w-full lg:w-60 xl:w-64 flex-shrink-0 bg-bg-sidebar border-b lg:border-b-0 lg:border-r border-border flex flex-col">
        <div className="p-4 border-b border-border-subtle">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
            Step 1
          </div>
          <h2 className="text-[15px] font-semibold font-display text-text-primary mb-3 tracking-tight">
            Channels
          </h2>

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
              <EmptyState icon={<CameraIcon className="w-10 h-10 text-text-muted/40" />} message="활성 카메라가 없습니다" />
            ) : (
              runningRecordings.map((rec: Recording) => (
                <label
                  key={rec.recording_id}
                  className="flex items-center gap-2 p-2 bg-card border border-border rounded-md text-[12px] cursor-pointer hover:border-border-strong hover:bg-bg-hover transition-colors"
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
          <div className="px-4 py-2 text-[11px] space-y-1 border-t border-border-subtle bg-bg-subtle">
            <div className="flex justify-between text-text-secondary">
              <span>캡처</span>
              <span className="font-mono text-text-primary">
                {formatNumber(serverStatus.session.total_captured)}장
              </span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>저장</span>
              <span className="font-mono text-status-running">
                {formatNumber(serverStatus.writer?.total_saved ?? 0)}장
              </span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>드롭</span>
              <span className="font-mono text-status-error">
                {formatNumber(serverStatus.session.total_dropped)}장
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
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={startCapture}
              disabled={selectedIds.size === 0}
            >
              {serverMode ? "Start Server Capture" : "Start Capture"}
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="md"
              className="w-full"
              onClick={stopCapture}
            >
              Stop Capture
            </Button>
          )}
        </div>
      </div>

      {/* ── 중앙: 히스토리 목록 — 라이트 패널 ── */}
      <div className="w-full lg:w-52 xl:w-60 flex-shrink-0 bg-bg-sidebar border-b lg:border-b-0 lg:border-r border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border-subtle">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
            Step 2
          </div>
          <h3 className="text-[13px] font-semibold text-text-primary tracking-tight">
            Capture history
          </h3>
        </div>
        <div className="flex-1 max-h-48 lg:max-h-none overflow-y-auto p-2 space-y-1">
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
                /* 히스토리 항목 — 라이트 카드, 활성 시 indigo soft */
                className={`px-3 py-2 rounded-md cursor-pointer transition-colors text-[12px] border ${
                  activeTimeKey === item.timeKey
                    ? "bg-brand-soft border-brand/30 text-text-primary"
                    : "bg-card border-border text-text-secondary hover:border-border-strong hover:bg-bg-hover"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-mono tabular ${activeTimeKey === item.timeKey ? "text-brand font-semibold" : "text-text-primary"}`}>
                    {item.displayTime}
                  </span>
                  <span className="text-text-muted text-[10px] tabular shrink-0">{item.camCount}ch</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 우측: 스냅샷 그리드 뷰 ── */}
      <div className="flex-1 min-w-0 lg:overflow-y-auto px-4 md:px-6 py-5">
        {activeItem ? (
          <>
            <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-[20px] font-semibold font-display text-text-primary tracking-tight">
                {activeItem.displayTime}
              </h2>
              <span className="text-[12px] text-text-muted tabular">
                {activeItem.camCount} channels captured
              </span>
              {activeItem.masterId && (
                <span className="sm:ml-auto text-[11px] text-text-muted tabular truncate max-w-full">
                  master · <span className="font-mono text-text-secondary">{activeItem.masterId}</span>
                </span>
              )}
            </div>
            {/* 동기화 경고 배너 */}
            {activeItem.syncWarnings && activeItem.syncWarnings.length > 0 && (
              <div className="mb-4 px-3 py-2 bg-status-error-soft border border-status-error/20 rounded-md">
                {activeItem.syncWarnings.map((w, i) => (
                  <p key={i} className="text-[12px] text-status-error">{w}</p>
                ))}
              </div>
            )}
            {/* 뷰포트가 아니라 **컨테이너 폭** 기준으로 열 수를 정함.
                lg:grid-cols-3 같은 뷰포트 기준은 좌측 496px 를 모르기 때문에
                1024px 에서 3열 → 셀 68px 로 무너졌음 */}
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
            >
              {Object.entries(activeItem.data).map(([rid, snap]) => (
                /* 스냅샷 이미지 카드 — 라이트 카드 + 동기화 실패 시 에러 보더 + master에 강조 보더 */
                <div
                  key={rid}
                  className={`bg-card rounded-md border-2 overflow-hidden ${
                    snap.is_pts_synced === false
                      ? "border-status-error/40"
                      : rid === activeItem.masterId
                        ? "border-brand"
                        : "border-border"
                  }`}
                >
                  <div className="relative bg-black">
                    <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                      <span className="bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                        {rid}
                      </span>
                      {rid === activeItem.masterId && (
                        <span className="bg-brand text-white text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider">
                          Master
                        </span>
                      )}
                      {snap.is_pts_synced === false && (
                        <span className="bg-status-error text-white text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider">
                          No sync
                        </span>
                      )}
                    </div>
                    {snap.auto_sync_offset_ms != null && (
                      <span className="absolute top-2 right-2 z-10 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono tabular">
                        {snap.auto_sync_offset_ms > 0 ? "+" : ""}
                        {snap.auto_sync_offset_ms}ms
                      </span>
                    )}
                    <img
                      src={snap.image_data}
                      alt={`snapshot-${rid}`}
                      className="w-full aspect-video object-cover"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Per-camera drift 차트 */}
            {(() => {
              /* master ID와 각 카메라의 offset 추출 */
              const masterId = activeItem.masterId;
              const rows = Object.entries(activeItem.data).map(([rid, snap]) => {
                const offset = snap.auto_sync_offset_ms ?? 0;
                return { rid, offset, isMaster: rid === masterId, synced: snap.is_pts_synced !== false };
              });
              const maxAbs = Math.max(10, ...rows.map((r) => Math.abs(r.offset)));
              return (
                <div className="mt-6 bg-card border border-border rounded-md overflow-hidden">
                  <div className="px-4 py-3 border-b border-border-subtle flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-[13px] font-semibold text-text-primary tracking-tight">
                      Per-camera drift
                    </h3>
                    <span className="text-[11px] text-text-muted tabular">
                      relative to master · max |drift| {maxAbs}ms
                    </span>
                  </div>
                  <div className="px-4 py-3 space-y-1.5">
                    {rows.map((r) => (
                      <div
                        key={r.rid}
                        /* 고정 140/60/70px + 1fr 조합은 좁은 폭에서 DriftBar 컬럼을 0px 로
                           소멸시켰음. 전 컬럼을 minmax 로 바꿔 막대가 최소 56px 를 확보하게 함 */
                        className="grid grid-cols-[minmax(0,1.8fr)_minmax(48px,1.2fr)_auto_auto] gap-2 sm:gap-3 items-center text-[12px] py-1"
                      >
                        <div className="font-mono text-text-primary truncate flex items-center gap-1.5">
                          {r.rid}
                          {r.isMaster && (
                            <span className="text-[8px] px-1.5 py-0.5 bg-brand text-white rounded font-semibold uppercase tracking-wider">
                              ref
                            </span>
                          )}
                        </div>
                        <DriftBar
                          diffMs={r.offset}
                          maxScaleMs={maxAbs * 1.1}
                          isMaster={r.isMaster}
                        />
                        <div className="text-right font-mono tabular text-text-secondary whitespace-nowrap">
                          {r.isMaster ? "0" : (r.offset > 0 ? "+" : "")}
                          {r.offset}<span className="text-text-muted ml-0.5">ms</span>
                        </div>
                        <div className={`text-center text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${
                          !r.synced ? "text-status-error" : Math.abs(r.offset) <= 10 ? "text-status-running" : Math.abs(r.offset) <= 30 ? "text-brand" : "text-status-pending"
                        }`}>
                          {!r.synced ? "no sync" : Math.abs(r.offset) <= 10 ? "perfect" : Math.abs(r.offset) <= 30 ? "good" : "warn"}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Session metadata 푸터 */}
                  <div className="px-4 py-2 border-t border-border-subtle bg-bg-subtle text-[10px] text-text-muted font-mono tabular flex flex-wrap justify-between gap-x-3">
                    <span className="truncate">
                      /sessions/{activeItem.timeKey}/
                    </span>
                    <span>
                      {Object.keys(activeItem.data).length} files · JPEG
                    </span>
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          <EmptyState icon={<PhotoIcon className="w-12 h-12 text-text-muted/40" />} message="캡처를 시작하거나 히스토리에서 항목을 선택하세요" />
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
