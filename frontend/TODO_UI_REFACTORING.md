# 프론트엔드 UI 리팩토링 TODO

## Step 1: 공통 타입 정의
- [x] `src/types/recording.ts` — Recording, SnapshotResult, HistoryItem, CameraFrame, SyncGroup 등
- [x] `src/types/media.ts` — MpegtsPlayer, Id3Metadata, HlsInstance 등

## Step 2: 상수 및 환경변수 통합
- [x] `src/constants.ts` — VRM_API_PORT, 갱신 주기, 비디오 해상도, 버퍼 크기 등
- [x] `.env.development` — VITE_API_PORT=18071

## Step 3: 공통 컴포넌트 추출
- [x] `src/components/FormField.tsx` — 3개 중복 컴포넌트 통합
- [x] `src/components/Modal.tsx` — 백드롭 + ESC 닫기 + headerExtra 지원
- [x] `src/components/FloatingPanel.tsx` — 접기/펼치기 플로팅 패널
- [x] `src/components/StatCard.tsx` — 통계 카드
- [x] `src/components/ErrorBoundary.tsx` — React ErrorBoundary + 재시도

## Step 4: TesterPage 분할 (746줄 → 11개 파일)
- [x] `src/pages/tester/TesterPage.tsx` — 레이아웃 셸
- [x] `src/pages/tester/panels/StartPanel.tsx` — 13개 useState → 단일 form 상태
- [x] `src/pages/tester/panels/StopPanel.tsx`
- [x] `src/pages/tester/panels/StatusPanel.tsx`
- [x] `src/pages/tester/panels/SnapshotPanel.tsx`
- [x] `src/pages/tester/panels/EventClipPanel.tsx` — mode prop으로 start/stop 통합
- [x] `src/pages/tester/panels/SimpleClipPanel.tsx`
- [x] `src/pages/tester/panels/HealthPanel.tsx`
- [x] `src/pages/tester/panels/index.ts` — 배럴 export
- [x] `src/pages/tester/components/LogViewer.tsx`
- [x] `src/pages/TesterPage.tsx` — re-export 래퍼 (호환용)

## Step 5: LivePage 분리 (607줄 → 4개 파일)
- [x] `src/pages/live/LivePage.tsx` — 그리드 + Modal/FloatingPanel/FormField 사용
- [x] `src/pages/live/LiveCell.tsx` — 스트림 셀 + 커스텀 훅 사용
- [x] `src/hooks/useMpegtsPlayer.ts` — mpegts 라이프사이클
- [x] `src/hooks/useId3Metadata.ts` — ID3 파싱 + PTS EMA
- [x] `src/pages/LivePage.tsx` — re-export 래퍼 (호환용)

## Step 6: 폼 상태 관리 개선
- [x] StartPanel: 13개 useState → 단일 form 객체 + updateField 헬퍼
- [x] DashboardPage: 모달에서 공유 Modal 컴포넌트 사용

## Step 7: any 타입 제거 (52개 → 2개)
- [x] DashboardPage — Recording 타입, MSEPlayer 타입
- [x] PlaylistPage — HlsInstance 인터페이스, Recording 타입
- [x] MultiSnapshotPage — BulkSnapshotResponse, Recording 타입
- [x] SyncViewerPage — CameraFrame, SyncGroup 공유 타입
- [x] useRecordings 훅 — Recording[] 반환
- [x] api/recording.ts — Recording 타입 반환
- [x] 잔여 any 2개 — media.ts 타입 선언 내 (의도적 사용)

## Step 8: ErrorBoundary 적용
- [x] App.tsx — 모든 Route를 ErrorBoundary로 래핑

## 결과 요약

| 항목 | Before | After |
|------|--------|-------|
| 공유 컴포넌트 | 3개 | **8개** |
| `any` 타입 | 52개+ | **2개** (타입 선언부) |
| TesterPage | 746줄 1파일 | **11파일** |
| LivePage | 607줄 1파일 | **4파일 + 2훅** |
| Magic Numbers | 하드코딩 | **constants.ts 중앙 관리** |
| 에러 경계 | 없음 | **ErrorBoundary 전페이지** |
| 폼 상태 | 13개 useState | **단일 form 객체** |
