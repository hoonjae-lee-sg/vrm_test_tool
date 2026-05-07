/**
 * Sync Viewer 페이지 — Studio 라이트 톤
 * 서버 모드로 저장된 멀티스냅샷의 동기화 상태를 시각적으로 검증
 *
 * 구성:
 *  - 좌측: 날짜/시간 선택기 + 프레임 타임라인
 *  - 우측: 선택된 타임스탬프의 전 채널 이미지 그리드 + 동기화 오차 표시
 */
import { useState, useEffect, useCallback } from "react";
import {
  getAvailableDates,
  getSyncFrames,
  getSnapshotImageUrl,
} from "@/api/snapshot_receiver";
import type { CameraFrame, SyncGroup, SyncBadge } from "@/types/recording";
import EmptyState from "@/components/EmptyState";
import DriftHistogram from "@/components/DriftHistogram";
import SyncDistribution from "@/components/SyncDistribution";
import DriftBar from "@/components/DriftBar";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { formatOffsetMs } from "@/utils/format";
import {
  SYNC_VIEWER_PAGE_LIMIT,
  SYNC_THRESHOLD_PERFECT_MS,
  SYNC_THRESHOLD_GOOD_MS,
  SYNC_THRESHOLD_WARN_MS,
} from "@/constants";

/* ────────────────── 동기화 상태 배지 (라이트 톤) ────────────────── */
function getSyncBadge(diffMs: number): SyncBadge & { tone: string } {
  if (diffMs <= SYNC_THRESHOLD_PERFECT_MS)
    return { label: "Perfect", color: "text-status-running", tone: "bg-status-running-soft" };
  if (diffMs <= SYNC_THRESHOLD_GOOD_MS)
    return { label: "Good", color: "text-brand", tone: "bg-brand-soft" };
  if (diffMs <= SYNC_THRESHOLD_WARN_MS)
    return { label: "Warn", color: "text-status-pending", tone: "bg-status-pending-soft" };
  return { label: "Bad", color: "text-status-error", tone: "bg-status-error-soft" };
}

/* ────────────────── 메인 컴포넌트 ────────────────── */
export default function SyncViewerPage() {
  /* ── 날짜/시간 선택 상태 ── */
  const [dates, setDates] = useState<Record<string, string[]>>({});
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedHour, setSelectedHour] = useState<string>("");

  /* ── 프레임 데이터 ── */
  const [syncGroups, setSyncGroups] = useState<SyncGroup[]>([]);
  const [cameras, setCameras] = useState<string[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const LIMIT = SYNC_VIEWER_PAGE_LIMIT;

  /* ── 선택된 프레임 ── */
  const [selectedTs, setSelectedTs] = useState<number | null>(null);

  /* ── 날짜 목록 불러오기 ── */
  useEffect(() => {
    getAvailableDates()
      .then((data) => {
        setDates(data.dates || {});
        const dateKeys = Object.keys(data.dates || {});
        if (dateKeys.length > 0) {
          const latestDate = dateKeys[0];
          setSelectedDate(latestDate);
          const hours = data.dates[latestDate];
          if (hours && hours.length > 0) {
            setSelectedHour(hours[hours.length - 1]);
          }
        }
      })
      .catch(() => {});
  }, []);

  /* ── 프레임 데이터 불러오기 ── */
  const fetchFrames = useCallback(
    async (date: string, hour: string, newOffset: number) => {
      if (!date || !hour) return;
      setLoading(true);
      try {
        const data = await getSyncFrames(date, hour, newOffset, LIMIT);
        setSyncGroups(data.sync_groups || []);
        setCameras(data.cameras || []);
        setTotalGroups(data.total || 0);
        setOffset(newOffset);
        if (data.sync_groups?.length > 0 && newOffset === 0) {
          setSelectedTs(data.sync_groups[0].timestamp_ms);
        }
      } catch {
        setSyncGroups([]);
        setCameras([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedDate && selectedHour) {
      fetchFrames(selectedDate, selectedHour, 0);
    }
  }, [selectedDate, selectedHour, fetchFrames]);

  const selectedGroup = syncGroups.find((g) => g.timestamp_ms === selectedTs);
  const availableHours = selectedDate ? dates[selectedDate] || [] : [];

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* ══════════ 좌측: 날짜/시간 선택 + 프레임 타임라인 ══════════ */}
      <aside className="w-72 flex-shrink-0 bg-bg-sidebar border-r border-border flex flex-col">
        {/* 헤더 */}
        <div className="px-4 py-4 border-b border-border-subtle">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
            Sync Lab
          </div>
          <h2 className="text-[15px] font-semibold font-display text-text-primary tracking-tight mb-3">
            Drift inspector
          </h2>

          {/* 날짜 */}
          <label className="block text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1">
            Date
          </label>
          <select
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              const hours = dates[e.target.value] || [];
              setSelectedHour(hours.length > 0 ? hours[hours.length - 1] : "");
            }}
            className="w-full mb-3 h-8 px-2 bg-bg-input border border-border rounded-md text-[12px] text-text-primary hover:border-border-strong focus:border-brand outline-none transition-colors"
          >
            <option value="">날짜 선택</option>
            {Object.keys(dates).map((d) => (
              <option key={d} value={d}>
                {d.slice(0, 4)}-{d.slice(4, 6)}-{d.slice(6, 8)}
              </option>
            ))}
          </select>

          {/* 시간대 */}
          <label className="block text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1">
            Hour
          </label>
          <div className="flex flex-wrap gap-1">
            {availableHours.map((h) => (
              <button
                key={h}
                onClick={() => setSelectedHour(h)}
                className={`px-2 py-1 rounded-md text-[11px] font-mono tabular transition-colors border ${
                  selectedHour === h
                    ? "bg-brand border-brand text-white"
                    : "bg-card border-border text-text-secondary hover:border-border-strong hover:bg-bg-hover"
                }`}
              >
                {h}
              </button>
            ))}
          </div>

          {totalGroups > 0 && (
            <p className="mt-3 text-[11px] text-text-muted tabular">
              {totalGroups} frames · {cameras.length} cameras
            </p>
          )}
        </div>

        {/* 프레임 타임라인 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <p className="text-[12px] text-text-muted px-2 py-3">로딩 중…</p>
          ) : syncGroups.length === 0 ? (
            <p className="text-[12px] text-text-muted px-2 py-3">
              스냅샷 데이터가 없습니다.
            </p>
          ) : (
            syncGroups.map((group) => {
              const badge = getSyncBadge(group.max_diff_ms);
              const isSelected = selectedTs === group.timestamp_ms;
              return (
                <div
                  key={group.timestamp_ms}
                  onClick={() => setSelectedTs(group.timestamp_ms)}
                  className={`px-3 py-2 rounded-md cursor-pointer transition-colors text-[12px] flex items-center justify-between border ${
                    isSelected
                      ? "bg-brand-soft border-brand/30"
                      : "bg-card border-border hover:border-border-strong hover:bg-bg-hover"
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono tabular text-text-primary">
                      {group.display_time}
                    </span>
                    <span className="text-text-muted text-[11px] tabular">
                      {group.camera_count}/{group.total_cameras}ch
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-text-muted tabular">
                      {group.max_diff_ms}ms
                    </span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${badge.color}`}>
                      {badge.label}
                    </span>
                  </div>
                </div>
              );
            })
          )}

          {/* 페이지네이션 */}
          {totalGroups > LIMIT && (
            <div className="p-2 pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-muted tabular">
                  {offset + 1}–{Math.min(offset + LIMIT, totalGroups)} / {totalGroups}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {Array.from(
                  { length: Math.ceil(totalGroups / LIMIT) },
                  (_, i) => {
                    const pageOffset = i * LIMIT;
                    const isCurrent = pageOffset === offset;
                    return (
                      <button
                        key={i}
                        onClick={() => fetchFrames(selectedDate, selectedHour, pageOffset)}
                        className={`min-w-[28px] px-1.5 py-1 rounded-md text-[11px] font-mono tabular transition-colors border ${
                          isCurrent
                            ? "bg-brand border-brand text-white"
                            : "bg-card border-border text-text-secondary hover:border-border-strong"
                        }`}
                      >
                        {i + 1}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ══════════ 우측: 이미지 그리드 + 동기화 정보 ══════════ */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {selectedGroup ? (
          <>
            {/* Sync grade 분포 + drift histogram */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <SyncDistribution values={syncGroups.map((g) => g.max_diff_ms)} />
              <div className="bg-card border border-border rounded-md p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="text-[12px] font-semibold text-text-primary tracking-tight">
                    Drift histogram
                  </h3>
                  <span className="text-[11px] text-text-muted tabular">
                    max diff per frame
                  </span>
                </div>
                <DriftHistogram values={syncGroups.map((g) => g.max_diff_ms)} height={70} />
              </div>
            </div>

            {/* 상단 요약 바 */}
            <div className="flex items-end justify-between mb-5">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
                  Frame
                </div>
                <h2 className="text-[22px] font-semibold font-display text-text-primary tracking-tight">
                  {selectedGroup.display_time}
                </h2>
                <p className="text-[12px] text-text-muted tabular mt-0.5">
                  {selectedGroup.camera_count} / {selectedGroup.total_cameras} cameras present
                  {" · "}
                  <span className={selectedGroup.camera_count === selectedGroup.total_cameras ? "text-status-running" : "text-status-error"}>
                    {((selectedGroup.camera_count / Math.max(1, selectedGroup.total_cameras)) * 100).toFixed(0)}% coverage
                  </span>
                </p>
              </div>

              <div className="flex items-stretch gap-3">
                <div className="text-right">
                  <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                    Max drift
                  </p>
                  <p
                    className={`text-[26px] leading-none font-semibold font-display font-mono tabular mt-1 ${
                      getSyncBadge(selectedGroup.max_diff_ms).color
                    }`}
                  >
                    {selectedGroup.max_diff_ms}<span className="text-[14px] text-text-muted ml-0.5">ms</span>
                  </p>
                </div>
                <div
                  className={`px-3 py-2 rounded-md text-[12px] font-semibold uppercase tracking-wider ${
                    getSyncBadge(selectedGroup.max_diff_ms).color
                  } ${getSyncBadge(selectedGroup.max_diff_ms).tone}`}
                >
                  {getSyncBadge(selectedGroup.max_diff_ms).label}
                </div>
              </div>
            </div>

            {/* 이미지 그리드 */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {cameras.map((camId) => {
                const frame = selectedGroup.cameras[camId];
                const hasMissing = !frame;

                return (
                  <div
                    key={camId}
                    className={`bg-card rounded-md border overflow-hidden ${
                      hasMissing
                        ? "border-status-error/30"
                        : "border-border"
                    }`}
                  >
                    <div className="relative bg-black">
                      {/* 카메라 ID */}
                      <div className="absolute top-2 left-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded z-10 font-mono max-w-[90%] truncate">
                        {camId}
                      </div>

                      {/* 오차 배지 */}
                      {frame && (
                        <div
                          className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded z-10 font-mono font-semibold tabular ${
                            Math.abs(frame.diff_ms) <= 10
                              ? "bg-status-running text-white"
                              : Math.abs(frame.diff_ms) <= 30
                                ? "bg-brand text-white"
                                : Math.abs(frame.diff_ms) <= 100
                                  ? "bg-status-pending text-white"
                                  : "bg-status-error text-white"
                          }`}
                        >
                          {formatOffsetMs(frame.diff_ms)}
                        </div>
                      )}

                      {frame ? (
                        <img
                          src={getSnapshotImageUrl(
                            camId,
                            selectedDate,
                            selectedHour,
                            frame.filename
                          )}
                          alt={`${camId}-${frame.filename}`}
                          className="w-full aspect-video object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full aspect-video flex items-center justify-center bg-status-error-soft">
                          <span className="text-[12px] text-status-error font-semibold uppercase tracking-wider">
                            Missing
                          </span>
                        </div>
                      )}
                    </div>

                    {frame && (
                      <div className="px-2 py-1.5 bg-bg-subtle text-[10px] text-text-muted font-mono truncate border-t border-border-subtle">
                        {frame.filename}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 동기화 오차 상세 테이블 */}
            <div className="mt-6 bg-card border border-border rounded-md overflow-hidden">
              <div className="px-4 py-3 border-b border-border-subtle">
                <h3 className="text-[13px] font-semibold text-text-primary tracking-tight">
                  Per-camera offsets
                </h3>
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-bg-subtle border-b border-border-subtle">
                    <th className="px-3 py-2 text-left text-text-muted font-medium uppercase tracking-wider text-[10px]">
                      Camera
                    </th>
                    <th className="px-3 py-2 text-left text-text-muted font-medium uppercase tracking-wider text-[10px]">
                      Drift
                    </th>
                    <th className="px-3 py-2 text-right text-text-muted font-medium uppercase tracking-wider text-[10px]">
                      Filename
                    </th>
                    <th className="px-3 py-2 text-right text-text-muted font-medium uppercase tracking-wider text-[10px]">
                      Diff (ms)
                    </th>
                    <th className="px-3 py-2 text-center text-text-muted font-medium uppercase tracking-wider text-[10px]">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cameras.map((camId) => {
                    const frame = selectedGroup.cameras[camId];
                    if (!frame) {
                      return (
                        <tr
                          key={camId}
                          className="border-b border-border-subtle bg-status-error-soft/40"
                        >
                          <td className="px-3 py-2 font-mono text-text-primary">
                            {camId}
                          </td>
                          <td className="px-3 py-2 text-status-error text-[11px]">
                            <div className="h-2 bg-status-error-soft rounded-sm border border-dashed border-status-error/30" />
                          </td>
                          <td className="px-3 py-2 text-right text-status-error">
                            —
                          </td>
                          <td className="px-3 py-2 text-right text-status-error">
                            —
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-status-error font-semibold uppercase tracking-wider text-[11px]">
                              Missing
                            </span>
                          </td>
                        </tr>
                      );
                    }
                    const badge = getSyncBadge(Math.abs(frame.diff_ms));
                    return (
                      <tr key={camId} className="border-b border-border-subtle hover:bg-bg-hover transition-colors">
                        <td className="px-3 py-2 font-mono text-text-primary">
                          {camId}
                        </td>
                        <td className="px-3 py-2 w-[40%]">
                          <DriftBar diffMs={frame.diff_ms} maxScaleMs={Math.max(50, selectedGroup.max_diff_ms * 1.2)} />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-text-secondary tabular text-[11px] truncate max-w-[140px]">
                          {frame.filename}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono font-semibold tabular ${badge.color}`}
                        >
                          {formatOffsetMs(frame.diff_ms)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`font-semibold uppercase tracking-wider text-[11px] ${badge.color}`}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : Object.keys(dates).length === 0 ? (
          <EmptyState
            icon={<MagnifyingGlassIcon className="w-12 h-12" />}
            message="저장된 스냅샷 데이터가 없습니다"
            description="Server Mode로 캡처를 먼저 실행하세요"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-[13px]">
            좌측에서 날짜/시간을 선택하고 프레임을 클릭하세요.
          </div>
        )}
      </div>
    </div>
  );
}
