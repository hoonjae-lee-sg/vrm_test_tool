/**
 * Sync Viewer 페이지
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
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { formatOffsetMs } from "@/utils/format";
import {
  SYNC_VIEWER_PAGE_LIMIT,
  SYNC_THRESHOLD_PERFECT_MS,
  SYNC_THRESHOLD_GOOD_MS,
  SYNC_THRESHOLD_WARN_MS,
} from "@/constants";

/* ────────────────── 동기화 상태 배지 색상 판별 — 상수 기반 임계값 비교 ────────────────── */
function getSyncBadge(diffMs: number): SyncBadge & { glow: string } {
  if (diffMs <= SYNC_THRESHOLD_PERFECT_MS) return { label: "PERFECT", color: "text-status-running", glow: "drop-shadow-[0_0_6px_rgba(34,197,94,0.5)]" };
  if (diffMs <= SYNC_THRESHOLD_GOOD_MS) return { label: "GOOD", color: "text-brand", glow: "drop-shadow-[0_0_6px_rgba(59,130,246,0.5)]" };
  if (diffMs <= SYNC_THRESHOLD_WARN_MS) return { label: "WARN", color: "text-status-pending", glow: "drop-shadow-[0_0_6px_rgba(234,179,8,0.5)]" };
  return { label: "BAD", color: "text-status-error", glow: "drop-shadow-[0_0_6px_rgba(239,68,68,0.5)]" };
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
        /* 최신 날짜 자동 선택 */
        const dateKeys = Object.keys(data.dates || {});
        if (dateKeys.length > 0) {
          const latestDate = dateKeys[0];
          setSelectedDate(latestDate);
          const hours = data.dates[latestDate];
          if (hours && hours.length > 0) {
            setSelectedHour(hours[hours.length - 1]); /* 최신 시간대 */
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
        /* 첫 번째 프레임 자동 선택 */
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

  /* 날짜/시간 변경 시 프레임 다시 불러오기 */
  useEffect(() => {
    if (selectedDate && selectedHour) {
      fetchFrames(selectedDate, selectedHour, 0);
    }
  }, [selectedDate, selectedHour, fetchFrames]);

  /* 현재 선택된 sync group */
  const selectedGroup = syncGroups.find((g) => g.timestamp_ms === selectedTs);

  /* 사용 가능한 시간대 */
  const availableHours = selectedDate ? dates[selectedDate] || [] : [];

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* ══════════ 좌측: 날짜/시간 선택 + 프레임 타임라인 — 글래스모피즘 사이드바 ══════════ */}
      <div className="w-72 flex-shrink-0 bg-white/[0.02] backdrop-blur-xl border-r border-white/[0.06] flex flex-col">
        {/* 헤더 */}
        <div className="p-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-bold font-display text-text-primary mb-3">
            Sync Viewer
          </h2>

          {/* 날짜 선택 */}
          <label className="block text-[10px] text-text-muted uppercase tracking-wider mb-1">
            Date
          </label>
          <select
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              const hours = dates[e.target.value] || [];
              setSelectedHour(hours.length > 0 ? hours[hours.length - 1] : "");
            }}
            className="w-full mb-3 px-2 py-1.5 bg-bg-input border border-border rounded text-xs text-text-primary"
          >
            <option value="">날짜 선택</option>
            {Object.keys(dates).map((d) => (
              <option key={d} value={d}>
                {d.slice(0, 4)}-{d.slice(4, 6)}-{d.slice(6, 8)}
              </option>
            ))}
          </select>

          {/* 시간대 선택 */}
          <label className="block text-[10px] text-text-muted uppercase tracking-wider mb-1">
            Hour
          </label>
          <div className="flex flex-wrap gap-1">
            {availableHours.map((h) => (
              <button
                key={h}
                onClick={() => setSelectedHour(h)}
                className={`px-2 py-1 rounded text-[11px] font-mono transition ${
                  selectedHour === h
                    ? "bg-brand text-white"
                    : "bg-bg-app border border-border text-text-secondary hover:border-brand/50"
                }`}
              >
                {h}
              </button>
            ))}
          </div>

          {/* 통계 */}
          {totalGroups > 0 && (
            <p className="mt-3 text-[10px] text-text-muted">
              {totalGroups}개 프레임 · {cameras.length}개 카메라
            </p>
          )}
        </div>

        {/* 프레임 타임라인 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loading ? (
            <p className="text-xs text-text-muted p-3">로딩 중...</p>
          ) : syncGroups.length === 0 ? (
            <p className="text-xs text-text-muted p-3">
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
                  className={`px-3 py-2 rounded cursor-pointer transition text-xs flex items-center justify-between ${
                    isSelected
                      ? "bg-brand/10 border border-brand"
                      : "bg-bg-app border border-transparent hover:border-white/[0.06]"
                  }`}
                >
                  <div>
                    <span className="font-mono text-text-primary">
                      {group.display_time}
                    </span>
                    <span className="ml-2 text-text-muted">
                      {group.camera_count}/{group.total_cameras}ch
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-text-muted">
                      {group.max_diff_ms}ms
                    </span>
                    {/* 동기화 상태 배지 — 네온 글로우 효과 */}
                    <span className={`text-[9px] font-bold ${badge.color} ${badge.glow}`}>
                      {badge.label}
                    </span>
                  </div>
                </div>
              );
            })
          )}

          {/* 페이지네이션 — 넘버링 */}
          {totalGroups > LIMIT && (
            <div className="p-2 pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted">
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
                        className={`min-w-[28px] px-1.5 py-1 rounded text-[11px] font-mono transition ${
                          isCurrent
                            ? "bg-brand text-white"
                            : "bg-bg-app border border-border text-text-secondary hover:border-brand/50"
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
      </div>

      {/* ══════════ 우측: 이미지 그리드 + 동기화 정보 ══════════ */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedGroup ? (
          <>
            {/* 상단 요약 바 */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold font-display text-text-primary">
                  {selectedGroup.display_time}
                </h2>
                <p className="text-xs text-text-muted">
                  {selectedGroup.camera_count} / {selectedGroup.total_cameras}{" "}
                  cameras
                </p>
              </div>

              {/* 동기화 요약 */}
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[10px] text-text-muted uppercase">
                    Max Diff
                  </p>
                  <p
                    className={`text-lg font-bold font-display font-mono ${
                      getSyncBadge(selectedGroup.max_diff_ms).color
                    } ${getSyncBadge(selectedGroup.max_diff_ms).glow}`}
                  >
                    {selectedGroup.max_diff_ms}ms
                  </p>
                </div>
                <div
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                    getSyncBadge(selectedGroup.max_diff_ms).color
                  } bg-current/10`}
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
                  /* 이미지 카드 — 글래스 보더 + 라운딩 */
                  <div
                    key={camId}
                    className={`rounded-xl border overflow-hidden relative ${
                      hasMissing
                        ? "border-status-error/50 bg-status-error/5"
                        : "border-white/[0.08] bg-black"
                    }`}
                  >
                    {/* 카메라 ID 오버레이 */}
                    <div className="absolute top-1.5 left-1.5 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded z-10 font-mono max-w-[90%] truncate">
                      {camId}
                    </div>

                    {/* 타임스탬프 오차 오버레이 */}
                    {frame && (
                      <div
                        className={`absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded z-10 font-mono font-bold ${
                          Math.abs(frame.diff_ms) <= 10
                            ? "bg-status-running/20 text-status-running"
                            : Math.abs(frame.diff_ms) <= 30
                              ? "bg-brand/20 text-brand"
                              : Math.abs(frame.diff_ms) <= 100
                                ? "bg-status-pending/20 text-status-pending"
                                : "bg-status-error/20 text-status-error"
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
                      <div className="w-full aspect-video flex items-center justify-center">
                        <span className="text-xs text-status-error">
                          MISSING
                        </span>
                      </div>
                    )}

                    {/* 하단 타임스탬프 */}
                    {frame && (
                      <div className="px-2 py-1 bg-bg-card text-[9px] text-text-muted font-mono">
                        {frame.filename}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 동기화 오차 상세 테이블 */}
            {/* 동기화 오차 상세 테이블 — 글래스 보더 */}
            <div className="mt-6 border border-white/[0.06] rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-bg-card border-b border-white/[0.06]">
                    <th className="px-3 py-2 text-left text-text-muted font-medium">
                      Camera
                    </th>
                    <th className="px-3 py-2 text-right text-text-muted font-medium">
                      Filename
                    </th>
                    <th className="px-3 py-2 text-right text-text-muted font-medium">
                      Diff (ms)
                    </th>
                    <th className="px-3 py-2 text-center text-text-muted font-medium">
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
                          className="border-b border-white/[0.06] bg-status-error/5"
                        >
                          <td className="px-3 py-1.5 font-mono text-text-primary">
                            {camId}
                          </td>
                          <td className="px-3 py-1.5 text-right text-status-error">
                            —
                          </td>
                          <td className="px-3 py-1.5 text-right text-status-error">
                            —
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <span className="text-status-error font-bold">
                              MISSING
                            </span>
                          </td>
                        </tr>
                      );
                    }
                    const badge = getSyncBadge(Math.abs(frame.diff_ms));
                    return (
                      /* 테이블 행 — 짝수행 글래스 배경 + 글로우 배지 */
                      <tr key={camId} className="border-b border-white/[0.06] even:bg-white/[0.02]">
                        <td className="px-3 py-1.5 font-mono text-text-primary">
                          {camId}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-text-secondary">
                          {frame.filename}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right font-mono font-bold ${badge.color} ${badge.glow}`}
                        >
                          {formatOffsetMs(frame.diff_ms)}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={`font-bold ${badge.color} ${badge.glow}`}>
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
            icon={<MagnifyingGlassIcon className="w-12 h-12 text-text-muted/40" />}
            message="저장된 스냅샷 데이터가 없습니다"
            description="Server Mode로 캡처를 먼저 실행하세요"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">
            좌측에서 날짜/시간을 선택하고 프레임을 클릭하세요.
          </div>
        )}
      </div>
    </div>
  );
}
