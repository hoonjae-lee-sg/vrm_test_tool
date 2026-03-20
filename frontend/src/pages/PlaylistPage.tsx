/**
 * Playlist 페이지
 * HLS 녹화 재생 (3x3 비디오 그리드 + 타임라인)
 * - 9개 채널 비디오 그리드
 * - 우측: 날짜 네비게이터 + 세로 타임바 캔버스
 * - hls.js 기반 HLS 재생
 * - 타임바: 줌, 드래그 스크롤, 클릭으로 시간 이동
 */
import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import apiClient from "@/api/client";
import type { Recording } from "@/types/recording";
import { PLAYLIST_NUM_CHANNELS, TIMEBAR_CANVAS_WIDTH } from "@/constants";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";

/* ────────────────── 상수 (공유 상수 모듈에서 가져온 값의 로컬 별칭) ────────────────── */
const NUM_CHANNELS = PLAYLIST_NUM_CHANNELS;
const CANVAS_WIDTH = TIMEBAR_CANVAS_WIDTH;

/* ────────────────── 세그먼트 타입 ────────────────── */
interface Segment {
  start: number;
  duration: number;
}

/* ────────────────── 메인 컴포넌트 ────────────────── */
export default function PlaylistPage() {
  /* 채널별 녹화 ID */
  const [channelIds, setChannelIds] = useState<(string | null)[]>(
    Array(NUM_CHANNELS).fill(null)
  );

  /* 녹화 목록 */
  const [recordingList, setRecordingList] = useState<string[]>([]);

  /* 오버레이 표시 상태 (채널별 녹화 선택 UI) */
  const [overlayVisible, setOverlayVisible] = useState<boolean[]>(
    Array(NUM_CHANNELS).fill(true)
  );

  /* 날짜 */
  const [currentDate, setCurrentDate] = useState(() => new Date());

  /* 세그먼트 데이터 (recordingId → Segment[]) */
  const segmentDataRef = useRef<Record<string, Segment[]>>({});

  /* hls.js 인스턴스 배열 — 채널별 HLS 재생 관리 */
  const hlsInstancesRef = useRef<(Hls | null)[]>(Array(NUM_CHANNELS).fill(null));

  /* 비디오 요소 refs */
  const videoRefs = useRef<(HTMLVideoElement | null)[]>(Array(NUM_CHANNELS).fill(null));

  /* 타임바 상태 */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const scrollOffsetRef = useRef(0);
  const hoverYRef = useRef(-1);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);

  /* 상태 메시지 */
  const [statusMsg, setStatusMsg] = useState("Loading...");

  /* ── 초기화: 녹화 목록 로드 ── */
  useEffect(() => {
    const load = async () => {
      try {
        setStatusMsg("Fetching recordings list...");
        const res = await apiClient.get("/recordings");
        const data = Array.isArray(res.data) ? res.data : [];
        const ids = data.map((r: Recording) => r.recording_id);
        setRecordingList(ids);
        setStatusMsg(ids.length > 0 ? `Found ${ids.length} recordings.` : "No recordings found.");
      } catch {
        setStatusMsg("Error loading recording list.");
      }
    };
    load();
  }, []);

  /* ── 세그먼트 로드 ── */
  /* VRM 서버의 index.m3u8을 파싱하여 세그먼트 시간 정보 추출 */
  const loadSegments = useCallback(async (recordingId: string) => {
    if (segmentDataRef.current[recordingId]) return;
    try {
      const res = await fetch(`/recording/${recordingId}/playback/index.m3u8`);
      if (!res.ok) return;
      const text = await res.text();
      const segments: Segment[] = [];
      const lines = text.split("\n");
      let currentDuration = 0;

      for (const line of lines) {
        if (line.startsWith("#EXTINF:")) {
          /* #EXTINF:5.000, 형식에서 duration 추출 */
          currentDuration = parseFloat(line.substring(8));
        } else if (line.trim().endsWith(".ts") && !line.startsWith("#")) {
          /* 세그먼트 경로에서 타임스탬프 파일명 추출
             예: /static/hls/105/14/1773901878500.ts → 1773901878500 */
          const filename = line.trim().split("/").pop()?.replace(".ts", "");
          if (filename) {
            const startMs = parseInt(filename, 10);
            if (!isNaN(startMs)) {
              segments.push({ start: Math.floor(startMs / 1000), duration: currentDuration });
            }
          }
        }
      }

      segmentDataRef.current[recordingId] = segments;
    } catch (err) {
      console.warn(`Segments not available for ${recordingId}:`, err);
    }
  }, []);

  /* ── 채널 로드 ── */
  const loadChannel = useCallback(
    async (index: number, recId: string) => {
      setChannelIds((prev) => {
        const next = [...prev];
        next[index] = recId;
        return next;
      });
      setOverlayVisible((prev) => {
        const next = [...prev];
        next[index] = false;
        return next;
      });
      await loadSegments(recId);
      drawTimebar();
    },
    [loadSegments]
  );

  /* ── HLS 재생 ── */
  const playHls = useCallback(
    (channelIndex: number, url: string, startTime: number = 0) => {
      const video = videoRefs.current[channelIndex];
      if (!video || !Hls.isSupported()) return;

      /* 기존 인스턴스 파괴 */
      if (hlsInstancesRef.current[channelIndex]) {
        hlsInstancesRef.current[channelIndex]!.destroy();
      }

      const hls = new Hls({ debug: false, enableWorker: true, lowLatencyMode: true });
      hlsInstancesRef.current[channelIndex] = hls;
      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.currentTime = startTime > 0 ? startTime : (hls.startPosition > 0 ? hls.startPosition : 0);
        /* 브라우저 자동재생 정책: muted 상태에서만 자동재생 허용 */
        video.muted = true;
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_: unknown, data: unknown) => {
        /* hls.js 에러 데이터 구조 — fatal 여부 및 상세 정보 */
        const errData = data as { fatal?: boolean; details?: string };
        if (errData.fatal) console.error(`CH ${channelIndex + 1} Fatal:`, errData.details);
      });
    },
    []
  );

  /* ── 특정 시간에 재생 ── */
  /* 타임바 클릭 시 해당 시각에 가장 가까운 세그먼트부터 HLS 재생 시작.
     index.m3u8은 전체 통합 플레이리스트이므로, 클릭 시각 이전까지의
     세그먼트 duration을 누적하여 HLS 미디어 시간(startTime)을 계산함. */
  const playAt = useCallback(
    (hour: number, minute: number, second: number) => {
      const clickedTimestamp = new Date(currentDate);
      clickedTimestamp.setHours(hour, minute, second, 0);
      const clickedTime = Math.floor(clickedTimestamp.getTime() / 1000);

      console.log(`[playAt] clickedTime=${clickedTime}, channels=`, channelIds);

      channelIds.forEach((recId, index) => {
        if (!recId) return;

        const segments = segmentDataRef.current[recId] || [];
        console.log(`[playAt] CH${index} recId=${recId}, segments=${segments.length}`);
        if (segments.length === 0) return;

        /* 클릭 시각이 세그먼트 범위 내인지 확인 (10초 허용 오차) */
        const sorted = [...segments].sort((a, b) => a.start - b.start);
        const firstStart = sorted[0].start;
        const lastEnd = sorted[sorted.length - 1].start + sorted[sorted.length - 1].duration;
        if (clickedTime < firstStart - 10 || clickedTime > lastEnd + 10) return;

        /* 클릭 시각에 해당하는 세그먼트 탐색 */
        let targetIdx = sorted.findIndex(
          (s) => clickedTime >= s.start && clickedTime < s.start + s.duration
        );
        /* 정확히 세그먼트 안에 없으면 가장 가까운 이전 세그먼트 사용 */
        if (targetIdx === -1) {
          for (let i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].start <= clickedTime) {
              targetIdx = i;
              break;
            }
          }
        }
        if (targetIdx === -1) return;

        /* HLS 미디어 시간 계산: 첫 세그먼트부터 클릭 지점까지의 duration 누적 */
        let mediaTime = 0;
        for (let i = 0; i < targetIdx; i++) {
          mediaTime += sorted[i].duration;
        }
        /* 클릭이 세그먼트 중간인 경우 오프셋 추가 */
        const targetSeg = sorted[targetIdx];
        const offset = Math.max(0, clickedTime - targetSeg.start);
        mediaTime += Math.min(offset, targetSeg.duration);

        /* 오버레이 닫기 + 즉시 재생 (setTimeout 없이 user gesture 체인 유지) */
        setOverlayVisible((prev) => {
          const next = [...prev];
          next[index] = false;
          return next;
        });

        const hlsUrl = `/recording/${recId}/playback/master.m3u8`;
        playHls(index, hlsUrl, mediaTime);
      });
    },
    [currentDate, channelIds, playHls]
  );

  /* ── 타임바 그리기 ── */
  const drawTimebar = useCallback(() => {
    const canvas = canvasRef.current;
    const scrollArea = scrollAreaRef.current;
    if (!canvas || !scrollArea) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const PIXELS_PER_MINUTE = zoomLevel;
    const TOTAL_HEIGHT = 1440 * zoomLevel;
    canvas.width = CANVAS_WIDTH;
    canvas.height = TOTAL_HEIGHT;

    const visibleHeight = scrollArea.clientHeight;
    const scrollOffset = scrollOffsetRef.current;

    ctx.clearRect(0, 0, CANVAS_WIDTH, TOTAL_HEIGHT);
    /* 전체 캔버스에 배경색 채우기 — 드래그 시 빈 영역 방지 */
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, CANVAS_WIDTH, TOTAL_HEIGHT);
    ctx.save();
    ctx.translate(0, -scrollOffset);

    /* 시간 그리드 및 라벨 */
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const totalMinutes = 24 * 60;
    for (let minute = 0; minute < totalMinutes; minute++) {
      const y = minute * PIXELS_PER_MINUTE;
      if (minute % 60 === 0) {
        ctx.beginPath();
        ctx.moveTo(50, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.strokeStyle = "#555";
        ctx.stroke();
        ctx.fillStyle = "#888";
        ctx.fillText(`${String(minute / 60).padStart(2, "0")}:00`, 40, y);
      } else if (zoomLevel >= 4 && minute % 10 === 0) {
        ctx.beginPath();
        ctx.moveTo(50, y);
        ctx.lineTo(60, y);
        ctx.strokeStyle = "#444";
        ctx.stroke();
        ctx.fillStyle = "#888";
        ctx.fillText(
          `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
          40,
          y
        );
      } else if (zoomLevel >= 2 && minute % 30 === 0) {
        ctx.beginPath();
        ctx.moveTo(50, y);
        ctx.lineTo(70, y);
        ctx.strokeStyle = "#444";
        ctx.stroke();
        ctx.fillStyle = "#888";
        ctx.fillText(
          `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
          40,
          y
        );
      }
    }

    /* 채널별 세그먼트 그리기 — 인접 세그먼트를 병합하여 연속 막대로 렌더링 */
    const colors = ["#4caf50", "#2196f3", "#ffc107", "#e91e63", "#9c27b0", "#00bcd4", "#ff9800", "#795548", "#607d8b"];
    const startOfDay = new Date(currentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(currentDate);
    endOfDay.setHours(23, 59, 59, 999);
    const startTs = Math.floor(startOfDay.getTime() / 1000);
    const endTs = Math.floor(endOfDay.getTime() / 1000);
    const channelWidth = (CANVAS_WIDTH - 80) / NUM_CHANNELS;

    channelIds.forEach((recId, index) => {
      if (!recId || !segmentDataRef.current[recId]) return;

      ctx.fillStyle = colors[index % colors.length];
      const daySegments = segmentDataRef.current[recId]
        .filter((s) => s.start + s.duration > startTs && s.start < endTs)
        .sort((a, b) => a.start - b.start);

      /* 인접 세그먼트 병합 (gap < 10초면 연속으로 간주) */
      const merged: { start: number; end: number }[] = [];
      for (const seg of daySegments) {
        const segStart = Math.max(seg.start, startTs);
        const segEnd = Math.min(seg.start + seg.duration, endTs);
        if (merged.length > 0 && segStart - merged[merged.length - 1].end < 10) {
          merged[merged.length - 1].end = segEnd;
        } else {
          merged.push({ start: segStart, end: segEnd });
        }
      }

      /* 병합된 구간을 직사각형으로 렌더링 */
      const barX = 80 + channelWidth * index + channelWidth * 0.15;
      const barW = channelWidth * 0.7;
      for (const m of merged) {
        const startPx = ((m.start - startTs) / 60) * PIXELS_PER_MINUTE;
        const heightPx = Math.max(1, ((m.end - m.start) / 60) * PIXELS_PER_MINUTE);
        ctx.fillRect(barX, startPx, barW, heightPx);
      }
    });

    /* 호버 인디케이터 */
    if (hoverYRef.current >= 0) {
      const absoluteY = scrollOffset + hoverYRef.current;
      ctx.strokeStyle = "rgba(255, 100, 100, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, absoluteY);
      ctx.lineTo(CANVAS_WIDTH, absoluteY);
      ctx.stroke();

      const totalSeconds = (absoluteY / PIXELS_PER_MINUTE) * 60;
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = Math.floor(totalSeconds % 60);
      ctx.fillStyle = "rgba(255, 100, 100, 1)";
      ctx.font = "bold 13px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
        60,
        absoluteY + 15
      );
    }

    ctx.restore();
  }, [zoomLevel, currentDate, channelIds]);

  /* 날짜/줌 변경 시 타임바 다시 그리기 */
  useEffect(() => {
    drawTimebar();
  }, [drawTimebar]);

  /* ── 타임바 이벤트 핸들러 ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const scrollArea = scrollAreaRef.current;
    if (!canvas || !scrollArea) return;

    let ignoreClick = false;

    /* 클릭으로 시간 이동 */
    const handleClick = (e: MouseEvent) => {
      if (ignoreClick) {
        ignoreClick = false;
        return;
      }
      if (isDraggingRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const absoluteY = y + scrollOffsetRef.current;
      const PIXELS_PER_MINUTE = zoomLevel;
      const totalSeconds = (absoluteY / PIXELS_PER_MINUTE) * 60;
      const hour = Math.floor(totalSeconds / 3600);
      const minute = Math.floor((totalSeconds % 3600) / 60);
      const second = Math.floor(totalSeconds % 60);

      console.log(`[Timebar] Click → ${hour}:${minute}:${second}, channels:`, channelIds);

      if (hour >= 0 && hour < 24) {
        playAt(hour, minute, second);
      }
    };

    /* 휠 줌 — 줌 변경 시 스크롤 위치를 비례 조정하여 점프 방지 */
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 2 : 0.5;
      const newZoom = Math.max(1, Math.min(8, zoomLevel * zoomFactor));
      if (newZoom !== zoomLevel) {
        const oldTotal = 1440 * zoomLevel;
        const newTotal = 1440 * newZoom;
        const visibleH = scrollArea.clientHeight;
        /* 현재 스크롤 비율을 유지하면서 새 줌에 맞게 offset 조정 */
        const ratio = oldTotal > 0 ? scrollOffsetRef.current / oldTotal : 0;
        scrollOffsetRef.current = Math.max(0, Math.min(ratio * newTotal, newTotal - visibleH));
        setZoomLevel(newZoom);
      }
    };

    /* 드래그 스크롤 — 캔버스가 뷰포트보다 클 때 항상 활성화 */
    const handleMouseDown = (e: MouseEvent) => {
      const TOTAL_HEIGHT = 1440 * zoomLevel;
      if (TOTAL_HEIGHT > scrollArea.clientHeight) {
        isDraggingRef.current = true;
        dragStartYRef.current = e.clientY;
        dragStartOffsetRef.current = scrollOffsetRef.current;
        canvas.style.cursor = "grabbing";
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const deltaY = e.clientY - dragStartYRef.current;
        if (Math.abs(deltaY) > 5) ignoreClick = true;
        const TOTAL_HEIGHT = 1440 * zoomLevel;
        const visibleHeight = scrollArea.clientHeight;
        scrollOffsetRef.current = Math.max(
          0,
          Math.min(dragStartOffsetRef.current - deltaY, TOTAL_HEIGHT - visibleHeight)
        );
        drawTimebar();
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        canvas.style.cursor = "pointer";
      }
    };

    /* 호버 */
    const handleCanvasMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      hoverYRef.current = e.clientY - rect.top;
      drawTimebar();
    };

    const handleCanvasLeave = () => {
      hoverYRef.current = -1;
      drawTimebar();
    };

    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleCanvasMove);
    canvas.addEventListener("mouseleave", handleCanvasLeave);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleCanvasMove);
      canvas.removeEventListener("mouseleave", handleCanvasLeave);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [zoomLevel, playAt, drawTimebar]);

  /* ── 날짜 변경 ── */
  const changeDate = (days: number) => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + days);
      return next;
    });
  };

  const dateStr = currentDate.toISOString().split("T")[0];

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* ── 메인: 3x3 비디오 그리드 ── */}
      <div className="flex-1 p-2 overflow-hidden">
        <div className="grid grid-cols-3 grid-rows-3 gap-1 h-full">
          {/* 비디오 그리드 셀 — 글래스 보더 + 라운딩 */}
          {Array.from({ length: NUM_CHANNELS }, (_, i) => (
            <div key={i} className="relative bg-black rounded-xl overflow-hidden border border-white/[0.08]">
              {/* 비디오 */}
              {/* visibility:hidden으로 항상 DOM에 존재 — display:none은 play() 차단 */}
              <video
                ref={(el) => { videoRefs.current[i] = el; }}
                controls
                muted
                playsInline
                autoPlay
                className="w-full h-full object-contain absolute inset-0"
                style={{ visibility: overlayVisible[i] ? "hidden" : "visible" }}
              />

              {/* 오버레이: 녹화 선택 */}
              {overlayVisible[i] && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-4">
                  <span className="text-xs text-text-muted mb-2">CH {i + 1}</span>
                  <select
                    className="w-full px-2 py-1.5 bg-bg-app border border-border rounded text-text-primary text-xs mb-2"
                    defaultValue=""
                    id={`rec-select-${i}`}
                  >
                    <option value="">-- Select Recording --</option>
                    {recordingList.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const select = document.getElementById(`rec-select-${i}`) as HTMLSelectElement;
                      if (select?.value) loadChannel(i, select.value);
                    }}
                    className="px-3 py-1 bg-brand text-white text-xs rounded hover:bg-brand/80"
                  >
                    Load
                  </button>
                </div>
              )}

              {/* 채널 변경 버튼 */}
              {!overlayVisible[i] && (
                <button
                  onClick={() => {
                    setOverlayVisible((prev) => {
                      const next = [...prev];
                      next[i] = true;
                      return next;
                    });
                  }}
                  className="absolute top-1 right-1 px-2 py-0.5 bg-black/60 text-white text-[10px] rounded hover:bg-black/80 z-10"
                >
                  Change
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 우측: 날짜 네비게이터 + 타임바 — 글래스모피즘 사이드바 ── */}
      <div className="w-72 flex-shrink-0 bg-white/[0.02] backdrop-blur-xl border-l border-white/[0.06] flex flex-col">
        {/* 날짜 네비게이터 — 글래스 버튼 스타일 */}
        <div className="flex items-center justify-between p-3 border-b border-white/[0.06]">
          <button
            onClick={() => changeDate(-1)}
            className="px-2 py-1 bg-white/[0.05] hover:bg-white/[0.1] rounded-lg text-text-secondary hover:text-text-primary text-sm transition"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <span className="text-sm font-mono text-text-primary cursor-pointer" onClick={() => {
            const el = document.getElementById("playlist-date-picker") as HTMLInputElement;
            el?.showPicker();
          }}>
            {dateStr}
          </span>
          <input
            id="playlist-date-picker"
            type="date"
            className="hidden"
            value={dateStr}
            onChange={(e) => {
              if (e.target.value) setCurrentDate(new Date(e.target.value));
            }}
          />
          <button
            onClick={() => changeDate(1)}
            className="px-2 py-1 bg-white/[0.05] hover:bg-white/[0.1] rounded-lg text-text-secondary hover:text-text-primary text-sm transition"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>

        {/* 상태 바 */}
        <div className="px-3 py-1 text-[10px] text-text-muted border-b border-white/[0.06]">
          {statusMsg}
        </div>

        {/* 타임바 캔버스 */}
        <div ref={scrollAreaRef} className="flex-1 overflow-hidden relative">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            className="cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
