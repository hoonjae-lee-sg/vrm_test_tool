/**
 * 라이브 스트림 개별 셀 컴포넌트
 * - mpegts.js 플레이어를 통한 WebSocket MPEG-TS 재생
 * - ID3 메타데이터 기반 바운딩 박스 캔버스 오버레이
 * - requestAnimationFrame 루프로 실시간 렌더링
 * - 스트림 상태 표시 및 닫기 버튼
 */
import { useRef, useEffect } from "react";
import { useMpegtsPlayer } from "@/hooks/useMpegtsPlayer";
import { useId3Metadata } from "@/hooks/useId3Metadata";
import { SOURCE_VIDEO_WIDTH, SOURCE_VIDEO_HEIGHT } from "@/constants";

/** LiveCell Props 정의 */
interface LiveCellProps {
  /** 스트림 고유 식별자 (recId-quality-timestamp) */
  uniqueId: string;
  /** 녹화 ID */
  recId: string;
  /** 스트림 품질 (hq / sq) */
  quality: string;
  /** 셀 제거 콜백 */
  onRemove: (id: string) => void;
}

/**
 * 라이브 스트림 개별 셀
 * 비디오 재생 + 바운딩 박스 오버레이를 하나의 셀로 구성
 */
export default function LiveCell({ uniqueId, recId, quality, onRemove }: LiveCellProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** requestAnimationFrame ID — 클린업 시 취소용 */
  const animFrameRef = useRef<number>(0);

  /* ID3 메타데이터 처리 훅 — PTS 동기화 및 큐 관리 */
  const { handleId3Data, getDrawData, reset: resetMetadata } = useId3Metadata();

  /* mpegts.js 플레이어 훅 — 생성, 에러 복구, 탭 가시성 처리 */
  const { status: streamStatus, setStatus: setStreamStatus, playerRef } = useMpegtsPlayer({
    recId,
    quality,
    videoRef,
    onId3Metadata: handleId3Data,
    onVisibilityReset: resetMetadata,
  });

  /* ── 바운딩 박스 렌더 루프 ── */
  useEffect(() => {
    /**
     * requestAnimationFrame 기반 렌더 루프
     * 매 프레임마다 현재 video.currentTime에 맞는 메타데이터를 조회하여
     * 캔버스에 바운딩 박스 그리기
     */
    const renderLoop = () => {
      animFrameRef.current = requestAnimationFrame(renderLoop);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.paused || video.ended) return;

      const currentTime = video.currentTime;

      /* 현재 시점에 맞는 메타데이터 조회 (PTS 오프셋 EMA 업데이트 포함) */
      const drawData = getDrawData(currentTime);

      /* 캔버스 크기를 비디오 해상도에 맞춤 — 변경 시에만 업데이트 */
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

        /* 바운딩 박스 그리기 — 원본 해상도(3840x2160) 좌표를 비디오 해상도로 스케일링 */
        if (drawData?.objects && drawData.objects.length > 0) {
          ctx.strokeStyle = "red";
          ctx.lineWidth = 2;
          const scaleX = vWidth / SOURCE_VIDEO_WIDTH;
          const scaleY = vHeight / SOURCE_VIDEO_HEIGHT;
          drawData.objects.forEach((obj) => {
            if (obj.bbox && Array.isArray(obj.bbox)) {
              const [left, top, right, bottom] = obj.bbox;
              ctx.strokeRect(
                left * scaleX,
                top * scaleY,
                (right - left) * scaleX,
                (bottom - top) * scaleY
              );
            }
          });
        }
      }
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
    /* 클린업 — 렌더 루프 중단 */
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []); /* 마운트 시 1회 시작, 언마운트 시 정리 */

  return (
    /* 라이브 셀 컨테이너 — 글래스 보더 + 라운딩 */
    <div className="relative bg-black/50 border border-white/[0.08] rounded-xl overflow-hidden group">
      {/* 비디오 엘리먼트 — mpegts.js 플레이어가 연결됨 */}
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

      {/* 스트림 상태 오버레이 — streaming/playing 외 상태일 때 글래스 배경으로 표시 */}
      {streamStatus && streamStatus !== "streaming" && streamStatus !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs text-text-muted">
            {streamStatus}
          </span>
        </div>
      )}

      {/* 바운딩 박스 오버레이 캔버스 — 비디오 위에 절대 위치 */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 10 }}
      />

      {/* 정보 표시 바 — 녹화 ID, 품질, 닫기 버튼 (글래스 배경) */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-xs text-white flex items-center justify-between">
        <span className="font-mono bg-black/60 backdrop-blur-sm rounded-lg px-2 py-0.5">
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
