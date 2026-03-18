/**
 * mpegts.js 플레이어 라이프사이클 관리 훅
 * - 플레이어 생성, 로드, 에러 복구, 정리 일괄 처리
 * - 탭 가시성 변경 시 일시정지/재개 처리
 * - WebSocket MPEG-TS 라이브 스트림 전용
 */
import { useState, useEffect, useRef, useCallback } from "react";
import mpegts from "mpegts.js";
import type { MpegtsPlayer, Id3RawPayload } from "@/types/media";
import {
  MPEGTS_STASH_INITIAL_SIZE,
  LIVE_BUFFER_MAX_LATENCY,
  LIVE_BUFFER_MIN_REMAIN,
} from "@/constants";

/** 스트림 연결 상태 문자열 */
export type StreamStatus =
  | "initializing..."
  | "connecting..."
  | "streaming"
  | "playing"
  | "click to play"
  | "reconnecting..."
  | "recovery failed"
  | "MSE not supported"
  | "video ref not ready"
  | string;

/** 훅 반환 타입 정의 */
interface UseMpegtsPlayerReturn {
  /** 현재 스트림 연결 상태 */
  status: StreamStatus;
  /** 상태 직접 설정 (클릭 재생 등 외부 제어용) */
  setStatus: (s: StreamStatus) => void;
  /** 플레이어 인스턴스 ref (외부에서 play() 호출 등에 사용) */
  playerRef: React.MutableRefObject<MpegtsPlayer | null>;
}

/** 훅 옵션 정의 */
interface UseMpegtsPlayerOptions {
  /** 녹화 ID */
  recId: string;
  /** 스트림 품질 (hq / sq) */
  quality: string;
  /** 비디오 엘리먼트 ref */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** ID3 메타데이터 수신 콜백 — raw 바이너리 데이터 전달 */
  onId3Metadata?: (payload: Id3RawPayload) => void;
  /** 탭 복귀 시 PTS 리셋 콜백 */
  onVisibilityReset?: () => void;
}

/**
 * mpegts.js 플레이어 라이프사이클 관리
 * WebSocket URL 자동 생성 (FastAPI 프록시 경유)
 * 에러 발생 시 자동 재연결 시도
 */
export function useMpegtsPlayer({
  recId,
  quality,
  videoRef,
  onId3Metadata,
  onVisibilityReset,
}: UseMpegtsPlayerOptions): UseMpegtsPlayerReturn {
  const [status, setStatus] = useState<StreamStatus>("initializing...");
  const playerRef = useRef<MpegtsPlayer | null>(null);

  /* ── 플레이어 초기화 및 정리 ── */
  useEffect(() => {
    /** StrictMode 더블 마운트 방어용 취소 플래그 */
    let cancelled = false;

    if (!videoRef.current) {
      setStatus("video ref not ready");
      return;
    }

    /* MSE 지원 여부 확인 — 미지원 시 즉시 중단 */
    if (!mpegts.getFeatureList().mseLivePlayback) {
      setStatus("MSE not supported");
      console.error(`[Live] MSE Live Playback not supported`);
      return;
    }

    const video = videoRef.current;

    /* FastAPI WebSocket 프록시 URL 생성 (Docker 환경에서 VRM 직접 접근 불가) */
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/live/${recId}/${quality}`;
    setStatus("connecting...");
    console.log(`[Live] Connecting to: ${wsUrl}`);

    /* mpegts.js 플레이어 인스턴스 생성 — 라이브 MPEG-TS 소스 설정 */
    const player = mpegts.createPlayer(
      { type: "mpegts", isLive: true, hasAudio: false, url: wsUrl },
      {
        enableStashBuffer: true,
        stashInitialSize: MPEGTS_STASH_INITIAL_SIZE,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: LIVE_BUFFER_MAX_LATENCY,
        liveBufferLatencyMinRemain: LIVE_BUFFER_MIN_REMAIN,
        lazyLoad: false,
      }
    );

    /* 에러 이벤트 — 자동 재연결 시도 */
    player.on(mpegts.Events.ERROR, (type: string, detail: string, info: Record<string, unknown>) => {
      if (cancelled) return;
      console.error(`[Live] Player Error (${recId}/${quality}):`, type, detail, info);
      setStatus(`error: ${detail || type}`);

      /* 에러 복구: unload → detach → 재 attach → load */
      try {
        player.unload();
        player.detachMediaElement();
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.src = "";
          videoRef.current.load();
          player.attachMediaElement(videoRef.current);
          player.load();
          setStatus("reconnecting...");
        }
      } catch {
        if (!cancelled) setStatus("recovery failed");
      }
    });

    /* ID3 메타데이터 이벤트 — 외부 콜백으로 전달 */
    player.on(mpegts.Events.TIMED_ID3_METADATA_ARRIVED, (data: Id3RawPayload) => {
      if (cancelled || video.paused || video.ended) return;
      onId3Metadata?.(data);
    });

    /* video 네이티브 이벤트로 상태 관리 — mpegts.js MEDIA_INFO가 프록시 환경에서 누락될 수 있음 */
    const onPlaying = () => {
      if (!cancelled) {
        console.log(`[Live] Video playing: ${recId}/${quality}`);
        setStatus("streaming");
      }
    };
    const onCanPlay = () => {
      if (cancelled) return;
      console.log(`[Live] Video canplay, calling play(): ${recId}/${quality}`);
      video.play().catch(() => {
        if (!cancelled) setStatus("click to play");
      });
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);

    /* 플레이어 미디어 연결 및 로드 시작 */
    player.attachMediaElement(video);
    player.load();
    playerRef.current = player;

    /* 클린업 — 이벤트 리스너 해제 및 플레이어 파괴 */
    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      player.destroy();
      playerRef.current = null;
    };
  }, [recId, quality]); /* recId/quality 변경 시 플레이어 재생성 */

  /* ── 탭 가시성 변경 시 동기화 리셋 ── */
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        /* PTS 오프셋 및 메타데이터 큐 리셋 요청 */
        onVisibilityReset?.();

        /* 라이브 에지로 점프 — 버퍼 끝 지점에서 0.2초 전으로 이동 */
        if (videoRef.current && videoRef.current.buffered.length > 0) {
          const end = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
          videoRef.current.currentTime = end - 0.2;
        }
        playerRef.current?.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [onVisibilityReset]);

  return { status, setStatus, playerRef };
}
