/**
 * 미디어 플레이어 관련 타입 정의
 * mpegts.js / hls.js 라이브러리의 주요 사용 패턴에 대한 타입 보조
 *
 * 참고: 두 라이브러리 모두 자체 타입 선언 파일을 번들에 포함.
 *   - mpegts.js: node_modules/mpegts.js/d.ts/mpegts.d.ts
 *   - hls.js:    node_modules/hls.js/dist/hls.d.ts
 * 이 파일은 코드에서 `any`로 사용되는 부분의 명시적 타입 참조를 위한 보조 선언.
 */

import type mpegts from "mpegts.js";

/* ────────────────── mpegts.js 플레이어 타입 ────────────────── */

/** mpegts.js 플레이어 인스턴스 (createPlayer 반환값) */
export type MpegtsPlayer = ReturnType<typeof mpegts.createPlayer>;

/** mpegts.js 미디어 데이터 소스 설정 */
export type MpegtsMediaDataSource = Parameters<typeof mpegts.createPlayer>[0];

/** mpegts.js 플레이어 설정 옵션 */
export type MpegtsConfig = Parameters<typeof mpegts.createPlayer>[1];

/* ────────────────── mpegts.js 이벤트/에러 콜백 파라미터 ────────────────── */

/** mpegts.js ERROR 이벤트 콜백 파라미터 */
export interface MpegtsErrorInfo {
  /** 에러 타입 문자열 */
  type: string;
  /** 에러 상세 설명 */
  detail: string;
  /** 추가 정보 (선택적) */
  info?: Record<string, unknown>;
}

/* ────────────────── ID3 메타데이터 (MPEG-TS 내장) ────────────────── */

/** TIMED_ID3_METADATA_ARRIVED 이벤트로 수신되는 raw 데이터 */
export interface Id3RawPayload {
  /** 바이너리 데이터 (TextDecoder로 JSON 문자열 디코딩) */
  data: Uint8Array;
}

/** 디코딩된 ID3 메타데이터 JSON 구조 (바운딩 박스 오버레이용) */
export interface Id3Metadata {
  /** Presentation Timestamp (초 단위) */
  pts: number;
  /** 감지된 객체 목록 */
  objects?: Id3DetectedObject[];
}

/** ID3 메타데이터 내 감지 객체 정보 */
export interface Id3DetectedObject {
  /** 바운딩 박스 좌표 [left, top, right, bottom] — 원본 해상도 기준 */
  bbox: [number, number, number, number];
}

/** PTS 동기화를 위한 메타데이터 큐 항목 */
export interface MetadataQueueItem {
  /** PTS 값 (초 단위) */
  pts: number;
  /** 파싱된 메타데이터 원본 */
  data: Id3Metadata;
}

/* ────────────────── hls.js 타입 ────────────────── */

/**
 * hls.js 인스턴스 타입
 * PlaylistPage에서 CDN 스크립트로 로드 시 `declare const Hls: any` 사용 중.
 * 모듈 import 방식 전환 시에는 아래와 같이 사용 가능:
 *   import Hls from "hls.js";
 *   type HlsInstance = InstanceType<typeof Hls>;
 */
export type HlsInstance = import("hls.js").default;

/** hls.js 에러 데이터 (Events.ERROR 콜백 두 번째 파라미터) */
export interface HlsErrorData {
  /** 치명적 에러 여부 */
  fatal: boolean;
  /** 에러 상세 코드 문자열 */
  details: string;
  /** 에러 타입 */
  type?: string;
}
