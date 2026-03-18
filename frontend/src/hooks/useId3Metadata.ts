/**
 * ID3 메타데이터 처리 훅
 * - TIMED_ID3_METADATA_ARRIVED 이벤트 데이터 파싱
 * - PTS 오프셋 EMA(지수이동평균) 계산
 * - 메타데이터 큐 관리 (최대 크기 제한, 오래된 항목 정리)
 * - requestAnimationFrame 루프에서 현재 프레임에 맞는 메타데이터 검색
 */
import { useRef, useCallback } from "react";
import type { Id3RawPayload, Id3Metadata, MetadataQueueItem } from "@/types/media";
import {
  METADATA_QUEUE_MAX_SIZE,
  METADATA_CLEANUP_THRESHOLD_SEC,
  BBOX_HOLD_DURATION_SEC,
} from "@/constants";

/** EMA 가중치 — 기존 오프셋 99%, 새 값 1% 반영 */
const EMA_WEIGHT_OLD = 0.99;
const EMA_WEIGHT_NEW = 0.01;

/** 훅 반환 타입 정의 */
interface UseId3MetadataReturn {
  /** ID3 raw 데이터 수신 처리 — useMpegtsPlayer의 onId3Metadata 콜백으로 전달 */
  handleId3Data: (payload: Id3RawPayload) => void;
  /** 현재 video.currentTime 기준으로 그려야 할 메타데이터 조회 */
  getDrawData: (currentTime: number) => Id3Metadata | null;
  /** PTS 오프셋 및 큐 초기화 (탭 복귀 시 호출) */
  reset: () => void;
  /** 메타데이터 큐 ref (외부 직접 접근용) */
  metadataQueueRef: React.MutableRefObject<MetadataQueueItem[]>;
  /** PTS 오프셋 ref */
  ptsOffsetRef: React.MutableRefObject<number | null>;
}

/**
 * ID3 메타데이터 수신, 파싱, PTS 동기화 관리
 * 바운딩 박스 오버레이 렌더링에 필요한 시점별 메타데이터 제공
 */
export function useId3Metadata(): UseId3MetadataReturn {
  /** PTS 오프셋 — video.currentTime과 메타데이터 PTS 간 차이 (EMA 적용) */
  const ptsOffsetRef = useRef<number | null>(null);
  /** 수신된 메타데이터 시간순 큐 */
  const metadataQueueRef = useRef<MetadataQueueItem[]>([]);
  /** 마지막으로 그린 메타데이터 (홀드용) */
  const lastDrawnDataRef = useRef<Id3Metadata | null>(null);
  /** 마지막 그리기 시점의 video.currentTime */
  const lastDrawnTimeRef = useRef(0);

  /**
   * ID3 raw 데이터 수신 처리
   * TextDecoder로 JSON 디코딩 후 큐에 추가
   * 큐 크기 초과 시 가장 오래된 항목 제거
   */
  const handleId3Data = useCallback((payload: Id3RawPayload) => {
    try {
      const jsonStr = new TextDecoder("utf-8").decode(payload.data).trim();
      /* JSON 형식이 아닌 데이터 무시 */
      if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) return;
      const metadata: Id3Metadata = JSON.parse(jsonStr);
      if (metadata.pts !== undefined) {
        metadataQueueRef.current.push({ pts: metadata.pts, data: metadata });
        /* 큐 크기 제한 — 최대 200개 초과 시 선입선출 */
        if (metadataQueueRef.current.length > METADATA_QUEUE_MAX_SIZE) {
          metadataQueueRef.current.shift();
        }
      }
    } catch {
      /* JSON 파싱 실패 무시 */
    }
  }, []);

  /**
   * 현재 video.currentTime 기준 그려야 할 메타데이터 조회
   * PTS 오프셋 EMA 업데이트, 시점 매칭, 홀드 처리, 오래된 항목 정리 일괄 수행
   *
   * @param currentTime - video.currentTime 값
   * @returns 그릴 메타데이터 또는 null
   */
  const getDrawData = useCallback((currentTime: number): Id3Metadata | null => {
    const queue = metadataQueueRef.current;

    /* PTS 오프셋 EMA 계산 — 큐에 데이터가 있고 재생 중일 때만 */
    if (queue.length > 0 && currentTime > 0) {
      const latestMeta = queue[queue.length - 1];
      const newOffset = latestMeta.pts - currentTime;
      if (ptsOffsetRef.current === null) {
        /* 최초 오프셋 — 즉시 적용 */
        ptsOffsetRef.current = newOffset;
      } else {
        /* EMA 적용 — 급격한 변동 방지 */
        ptsOffsetRef.current = ptsOffsetRef.current * EMA_WEIGHT_OLD + newOffset * EMA_WEIGHT_NEW;
      }
    }

    if (ptsOffsetRef.current === null) return null;

    const targetPts = currentTime + ptsOffsetRef.current;

    /* 현재 시점에 맞는 메타데이터 탐색 — 역순 순회로 가장 가까운 항목 선택 */
    let dataToDraw: Id3Metadata | null = null;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].pts <= targetPts) {
        dataToDraw = queue[i].data;
        break;
      }
    }

    /* 바운딩 박스 홀드 처리 — 객체 사라져도 일정 시간 유지 */
    if (dataToDraw) {
      const hasObjects = (dataToDraw.objects?.length ?? 0) > 0;
      if (hasObjects) {
        lastDrawnDataRef.current = dataToDraw;
        lastDrawnTimeRef.current = currentTime;
      } else if (lastDrawnDataRef.current && currentTime - lastDrawnTimeRef.current > BBOX_HOLD_DURATION_SEC) {
        lastDrawnDataRef.current = null;
      }
    } else if (lastDrawnDataRef.current && currentTime - lastDrawnTimeRef.current > BBOX_HOLD_DURATION_SEC) {
      lastDrawnDataRef.current = null;
    }

    /* 오래된 메타데이터 정리 — targetPts 기준 10초 이전 항목 제거 */
    while (queue.length > 0 && queue[0].pts < targetPts - METADATA_CLEANUP_THRESHOLD_SEC) {
      queue.shift();
    }

    return lastDrawnDataRef.current;
  }, []);

  /**
   * PTS 오프셋 및 큐 초기화
   * 탭 가시성 복귀 시 호출 — 동기화 재설정
   */
  const reset = useCallback(() => {
    ptsOffsetRef.current = null;
    metadataQueueRef.current.length = 0;
    lastDrawnDataRef.current = null;
    lastDrawnTimeRef.current = 0;
  }, []);

  return {
    handleId3Data,
    getDrawData,
    reset,
    metadataQueueRef,
    ptsOffsetRef,
  };
}
