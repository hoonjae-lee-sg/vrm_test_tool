/**
 * Live Grid 페이지
 * WebSocket MPEG-TS 라이브 스트림 그리드 뷰
 * - 동적 그리드 레이아웃 (최대 9개)
 * - mpegts.js 연동 + ID3 메타데이터 바운딩 박스 오버레이
 * - PTS 동기화 및 자동 복구
 * - 녹화 시작 모달 / 라이브 뷰 추가 모달
 * - 플로팅 녹화 목록
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import mpegts from "mpegts.js";
import { startRecording, type StartRecordingParams } from "@/api/recording";
import StatusBadge from "@/components/StatusBadge";
import Toast from "@/components/Toast";

/* ────────────────── 스트림 상태 ────────────────── */
interface StreamInfo {
  uniqueId: string;
  recId: string;
  quality: string;
}

/* ────────────────── 메인 컴포넌트 ────────────────── */
export default function LivePage() {
  const { recordings, refresh } = useRecordings(5000);
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
    retention: "7",
  });

  /* 플로팅 패널 */
  const [floatingMinimized, setFloatingMinimized] = useState(false);

  /* URL 파라미터에서 자동 스트림 추가 */
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
      if (streams.some((s) => s.recId === recId && s.quality === quality)) {
        showToast(`이미 ${recId} (${quality.toUpperCase()})를 보고 있습니다.`, "error");
        return;
      }
      if (streams.length >= 9) {
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

  /* ── 녹화 시작 ── */
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
        retention_days: parseInt(addForm.retention) || 7,
      };
      await startRecording(params);
      setAddModal(false);
      refresh();
      showToast("녹화가 시작되었습니다.", "success");
    } catch (err: any) {
      showToast(`녹화 시작 실패: ${err.message}`, "error");
    }
  };

  /* ── 그리드 크기 계산 ── */
  const count = streams.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* ── 헤더 바 ── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-card border-b border-border">
        <h1 className="text-sm font-bold text-text-primary">Live Grid</h1>
        <div className="flex-1" />
        <button
          onClick={() => {
            setViewRecId("");
            setViewModal(true);
          }}
          className="px-3 py-1.5 bg-brand/10 text-brand text-xs rounded hover:bg-brand/20 transition"
        >
          + View Live Stream
        </button>
        <button
          onClick={() => {
            setAddForm({ recId: `SN-${Date.now()}`, hqUrl: "", sqUrl: "", mode: "CONTINUOUS", codec: "H264", retention: "7" });
            setAddModal(true);
          }}
          className="px-3 py-1.5 bg-brand text-white text-xs rounded hover:bg-brand/80 transition"
        >
          + Start Recording
        </button>
      </div>

      {/* ── 그리드 영역 ── */}
      <div className="flex-1 p-2 overflow-hidden">
        {count === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">
            활성 라이브 스트림이 없습니다. "+ View Live Stream"을 클릭하세요.
          </div>
        ) : (
          <div
            className="w-full h-full grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            }}
          >
            {streams.map((stream) => (
              <LiveCell
                key={stream.uniqueId}
                uniqueId={stream.uniqueId}
                recId={stream.recId}
                quality={stream.quality}
                onRemove={removeStream}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── View Live Modal ── */}
      {viewModal && (
        <Modal title="라이브 뷰 추가" onClose={() => setViewModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-text-muted mb-1 block">Recording ID</label>
              <input
                className="w-full px-3 py-2 bg-bg-app border border-border rounded text-text-primary text-sm font-mono"
                value={viewRecId}
                onChange={(e) => setViewRecId(e.target.value)}
                placeholder="Recording ID 입력"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Quality</label>
              <select
                className="w-full px-3 py-2 bg-bg-app border border-border rounded text-text-primary text-sm"
                value={viewQuality}
                onChange={(e) => setViewQuality(e.target.value)}
              >
                <option value="hq">HQ (High Quality)</option>
                <option value="sq">SQ (Standard Quality)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button
              onClick={() => setViewModal(false)}
              className="px-4 py-2 border border-border rounded text-text-secondary text-sm hover:bg-card-hover"
            >
              취소
            </button>
            <button
              onClick={() => {
                if (!viewRecId.trim()) return showToast("Recording ID를 입력하세요.", "error");
                addStream(viewRecId.trim(), viewQuality);
                setViewModal(false);
              }}
              className="px-4 py-2 bg-brand text-white rounded text-sm hover:bg-brand/80"
            >
              확인
            </button>
          </div>
        </Modal>
      )}

      {/* ── Add Recording Modal ── */}
      {addModal && (
        <Modal title="녹화 시작" onClose={() => setAddModal(false)}>
          <div className="space-y-3">
            <InputField label="Serial Number" value={addForm.recId} onChange={(v) => setAddForm((p) => ({ ...p, recId: v }))} />
            <InputField label="HQ RTSP URL" value={addForm.hqUrl} onChange={(v) => setAddForm((p) => ({ ...p, hqUrl: v }))} placeholder="rtsp://..." />
            <InputField label="SQ RTSP URL" value={addForm.sqUrl} onChange={(v) => setAddForm((p) => ({ ...p, sqUrl: v }))} placeholder="rtsp://..." />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">Mode</label>
                <select className="w-full px-3 py-2 bg-bg-app border border-border rounded text-text-primary text-sm" value={addForm.mode} onChange={(e) => setAddForm((p) => ({ ...p, mode: e.target.value }))}>
                  <option value="CONTINUOUS">CONTINUOUS</option>
                  <option value="EVENT">EVENT</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">Codec</label>
                <select className="w-full px-3 py-2 bg-bg-app border border-border rounded text-text-primary text-sm" value={addForm.codec} onChange={(e) => setAddForm((p) => ({ ...p, codec: e.target.value }))}>
                  <option value="H264">H264</option>
                  <option value="H265">H265</option>
                </select>
              </div>
              <InputField label="Retention" value={addForm.retention} onChange={(v) => setAddForm((p) => ({ ...p, retention: v }))} type="number" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setAddModal(false)} className="px-4 py-2 border border-border rounded text-text-secondary text-sm hover:bg-card-hover">
              취소
            </button>
            <button onClick={handleStartRecording} className="px-4 py-2 bg-brand text-white rounded text-sm hover:bg-brand/80">
              Start Recording
            </button>
          </div>
        </Modal>
      )}

      {/* ── 플로팅 녹화 목록 ── */}
      <div
        className={`fixed bottom-4 right-4 w-64 bg-card border border-border rounded-xl shadow-xl z-40 transition-all ${
          floatingMinimized ? "h-10 overflow-hidden" : "max-h-72"
        }`}
      >
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border"
          onClick={() => setFloatingMinimized(!floatingMinimized)}
        >
          <span className="text-xs font-bold text-text-primary">Recordings</span>
          <div className="flex gap-1">
            <button onClick={(e) => { e.stopPropagation(); refresh(); }} className="text-xs text-text-muted hover:text-text-primary">↻</button>
            <span className="text-xs text-text-muted">{floatingMinimized ? "□" : "_"}</span>
          </div>
        </div>
        {!floatingMinimized && (
          <div className="max-h-52 overflow-y-auto">
            {recordings.map((rec: any) => (
              <div
                key={rec.recording_id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-card-hover cursor-pointer text-xs"
                onClick={() => {
                  setViewRecId(rec.recording_id);
                  setViewModal(true);
                }}
              >
                <span className="font-mono text-text-primary truncate flex-1">{rec.recording_id}</span>
                <StatusBadge state={rec.state} />
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

/* ────────────────── 라이브 셀 컴포넌트 ────────────────── */
function LiveCell({
  uniqueId,
  recId,
  quality,
  onRemove,
}: {
  uniqueId: string;
  recId: string;
  quality: string;
  onRemove: (id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<any>(null);
  const [streamStatus, setStreamStatus] = useState<string>("initializing...");

  /* PTS 동기화 상태 */
  const ptsOffsetRef = useRef<number | null>(null);
  const metadataQueueRef = useRef<{ pts: number; data: any }[]>([]);
  const lastDrawnDataRef = useRef<any>(null);
  const lastDrawnTimeRef = useRef(0);
  const animFrameRef = useRef<number>(0);

  /* mpegts.js 플레이어 초기화 */
  useEffect(() => {
    let cancelled = false; /* StrictMode 더블 마운트 방어용 플래그 */

    if (!videoRef.current) {
      setStreamStatus("video ref not ready");
      return;
    }
    if (!mpegts.getFeatureList().mseLivePlayback) {
      setStreamStatus("MSE not supported");
      console.error(`[Live] MSE Live Playback not supported`);
      return;
    }

    const video = videoRef.current;
    /* FastAPI WebSocket 프록시 경유 (Docker 환경에서 VRM 직접 접근 불가) */
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/live/${recId}/${quality}`;
    setStreamStatus("connecting...");
    console.log(`[Live] Connecting to: ${wsUrl}`);

    const player = mpegts.createPlayer(
      { type: "mpegts", isLive: true, hasAudio: false, url: wsUrl },
      {
        enableStashBuffer: true,
        stashInitialSize: 128,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 5.0,
        liveBufferLatencyMinRemain: 0.5,
        lazyLoad: false,
      }
    );

    player.on(mpegts.Events.ERROR, (type: any, detail: any, info: any) => {
      if (cancelled) return;
      console.error(`[Live] Player Error (${recId}/${quality}):`, type, detail, info);
      setStreamStatus(`error: ${detail || type}`);
      try {
        player.unload();
        player.detachMediaElement();
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.src = "";
          videoRef.current.load();
          player.attachMediaElement(videoRef.current);
          player.load();
          setStreamStatus("reconnecting...");
        }
      } catch {
        if (!cancelled) setStreamStatus("recovery failed");
      }
    });

    player.on(mpegts.Events.TIMED_ID3_METADATA_ARRIVED, (data: any) => {
      if (cancelled || videoRef.current?.paused || videoRef.current?.ended) return;
      try {
        const jsonStr = new TextDecoder("utf-8").decode(data.data).trim();
        if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) return;
        const metadata = JSON.parse(jsonStr);
        if (metadata.pts !== undefined) {
          metadataQueueRef.current.push({ pts: metadata.pts, data: metadata });
          if (metadataQueueRef.current.length > 200) metadataQueueRef.current.shift();
        }
      } catch {
        /* 파싱 실패 무시 */
      }
    });

    /* video 네이티브 이벤트로 상태 관리 — mpegts.js MEDIA_INFO가 프록시 환경에서 누락될 수 있음 */
    const onPlaying = () => {
      if (!cancelled) {
        console.log(`[Live] Video playing: ${recId}/${quality}`);
        setStreamStatus("streaming");
      }
    };
    const onCanPlay = () => {
      if (cancelled) return;
      console.log(`[Live] Video canplay, calling play(): ${recId}/${quality}`);
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
      cancelAnimationFrame(animFrameRef.current);
      player.destroy();
      playerRef.current = null;
    };
  }, [recId, quality]);

  /* 렌더 루프 (바운딩 박스 그리기) */
  useEffect(() => {
    const renderLoop = () => {
      animFrameRef.current = requestAnimationFrame(renderLoop);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.paused || video.ended) return;

      const currentTime = video.currentTime;
      const queue = metadataQueueRef.current;

      /* PTS 오프셋 동기화 */
      if (queue.length > 0 && currentTime > 0) {
        const latestMeta = queue[queue.length - 1];
        const newOffset = latestMeta.pts - currentTime;
        if (ptsOffsetRef.current === null) {
          ptsOffsetRef.current = newOffset;
        } else {
          ptsOffsetRef.current = ptsOffsetRef.current * 0.99 + newOffset * 0.01;
        }
      }

      if (ptsOffsetRef.current === null) return;

      const targetPts = currentTime + ptsOffsetRef.current;

      /* 현재 시점에 맞는 메타데이터 찾기 */
      let dataToDraw: any = null;
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].pts <= targetPts) {
          dataToDraw = queue[i].data;
          break;
        }
      }

      const HOLD_DURATION = 0.5;
      if (dataToDraw) {
        const hasObjects = dataToDraw.objects?.length > 0;
        if (hasObjects) {
          lastDrawnDataRef.current = dataToDraw;
          lastDrawnTimeRef.current = currentTime;
        } else if (lastDrawnDataRef.current && currentTime - lastDrawnTimeRef.current > HOLD_DURATION) {
          lastDrawnDataRef.current = null;
        }
      } else if (lastDrawnDataRef.current && currentTime - lastDrawnTimeRef.current > HOLD_DURATION) {
        lastDrawnDataRef.current = null;
      }

      /* 캔버스에 바운딩 박스 그리기 */
      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;
      if (vWidth > 0 && vHeight > 0) {
        if (canvas.width !== vWidth || canvas.height !== vHeight) {
          canvas.width = vWidth;
          canvas.height = vHeight;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (lastDrawnDataRef.current?.objects?.length > 0) {
          ctx.strokeStyle = "red";
          ctx.lineWidth = 2;
          const sourceWidth = 3840;
          const sourceHeight = 2160;
          const scaleX = vWidth / sourceWidth;
          const scaleY = vHeight / sourceHeight;
          lastDrawnDataRef.current.objects.forEach((obj: any) => {
            if (obj.bbox && Array.isArray(obj.bbox)) {
              const [left, top, right, bottom] = obj.bbox;
              ctx.strokeRect(left * scaleX, top * scaleY, (right - left) * scaleX, (bottom - top) * scaleY);
            }
          });
        }
      }

      /* 오래된 메타데이터 정리 */
      while (queue.length > 0 && queue[0].pts < targetPts - 10) {
        queue.shift();
      }
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  /* 탭 가시성 변경 시 동기화 리셋 */
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        ptsOffsetRef.current = null;
        metadataQueueRef.current.length = 0;
        /* 라이브 에지로 점프 */
        if (videoRef.current && videoRef.current.buffered.length > 0) {
          const end = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
          videoRef.current.currentTime = end - 0.2;
        }
        playerRef.current?.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return (
    <div className="relative bg-black rounded overflow-hidden group">
      <video
        ref={videoRef}
        controls
        autoPlay
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
      {streamStatus && streamStatus !== "streaming" && streamStatus !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-text-muted pointer-events-none">
          {streamStatus}
        </div>
      )}
      {/* 바운딩 박스 오버레이 캔버스 */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 10 }}
      />
      {/* 정보 표시 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-xs text-white flex items-center justify-between">
        <span className="font-mono">
          {recId} [{quality.toUpperCase()}]
        </span>
        <button
          onClick={() => onRemove(uniqueId)}
          className="px-2 py-0.5 bg-status-error/80 text-white text-[10px] rounded hover:bg-status-error opacity-0 group-hover:opacity-100 transition"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/* ────────────────── 모달 래퍼 ────────────────── */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-text-primary mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* ────────────────── 입력 필드 ────────────────── */
function InputField({
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
