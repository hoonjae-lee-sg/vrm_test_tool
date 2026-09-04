# TODO — Tester 페이지("리모콘 패널") 고도화

## 진단 (코드/백엔드 계약 대조 결과)

| # | 문제 | 근거 |
|---|------|------|
| P0-1 | **Start 가 항상 실패 ①** — 폼에 `serial_number` 입력이 없음. 서버는 `serial_number` 를 그대로 `recording_id` 로 쓰고 `[A-Za-z0-9_-]{1,128}` 를 강제 (`src/grpc/recorder_service.cc` DoStart) | StartPanel.tsx 폼 필드 부재 · 실서버 확인: `INVALID_ARGUMENT: serial_number must be 1-128 characters of [A-Za-z0-9_-].` |
| P0-1b | **Start 가 항상 실패 ②** — 코덱 드롭다운 값이 `H264`/`H265` 인데 `encoding.proto` 의 `Codec` enum 에는 `COPY`/`H264_SW`/`H264_NVENC` 만 존재. 백엔드 `Codec.Value(name)` 에서 터짐 | 실서버 확인: `Enum Codec has no value defined for name 'H264'` |
| P0-2 | **스냅샷 미리보기가 절대 안 뜸** — 패널이 `result.file.path` 를 읽지만 `/api/snapshot` 응답은 `{image_data, actual_timestamp, is_pts_synced, auto_sync_offset_ms}` | backend/routers/snapshot.py `_build_snapshot_result` |
| P0-3 | **로그 패널 마비** — base64 data URI 전체를 `JSON.stringify` 로 덤프 | LogViewer.tsx |
| P1-1 | 에러 메시지가 "Request failed with status code 500" 뿐. 실제 gRPC 사유는 `response.data.detail` 에 있는데 버려짐 | 모든 패널의 `err.message` |
| P1-2 | recording_id 를 패널마다 다시 입력. 전역 선택기 없음, 대상의 현재 상태도 안 보임 | 8개 패널 공통 |
| P1-3 | 응답이 raw JSON 덤프뿐 — 요청/응답 짝, 소요시간, 성공/실패 구분, 필터 없음 | LogViewer.tsx |
| P1-4 | Stop/Restart 에 확인 없음 (ConfirmDialog 는 이미 존재하는데 미사용) | StopPanel/RestartPanel |
| P1-5 | RTSP URL/serial/인증정보를 매번 타이핑. 프리셋·최근값 없음 | StartPanel |
| P1-6 | 여러 카메라에 같은 명령 반복 불가 | 전 패널 |
| P1-7 | 단축키 없음 | TesterPage |
| P2-1 | `hq_storage_limit_mbs` 의 0=무제한 의미, 비동기 쿼터 검증 경고 동작이 UI 에 전혀 안 드러남 | 백엔드 신규 동작 |
| P2-2 | Start 가 이제 즉시 반환되는데 UI 는 긴 로딩 전제 | 백엔드 신규 동작 |
| P2-3 | epoch seconds 를 손으로 계산해서 입력 | Snapshot/SimpleClip |
| P2-4 | stop/restart 의 auth_token 이 API 레이어에서 버려짐, snapshot strategy/max_offset_ms 미노출 | api/recording.ts |

## 작업 목록

- [x] 1. api/recording.ts — auth_token 전달, snapshot strategy/max_offset_ms, 응답 타입 명시
- [x] 2. api/events.ts 신규 — `/api/events/recent` (쿼터 경고 이벤트 수신용)
- [x] 3. tester/lib/validation.ts — 식별자 검증 + gRPC 에러 메시지 추출
- [x] 4. tester/lib/presets.ts — localStorage 프리셋/최근값
- [x] 5. tester/lib/sanitize.ts — 로그용 대용량 필드 축약
- [x] 6. tester/types.ts — LogEntry / TesterCtx 공통 타입
- [x] 7. tester/hooks/useApiRunner.ts — 실행 래퍼(타이밍·로그·에러추출·일괄실행)
- [x] 8. tester/components/TargetBar.tsx — 전역 타겟 선택기(단일/다중, 상태 배지, 검증)
- [x] 9. tester/components/PanelShell.tsx — 패널 공통 헤더/액션/결과 영역
- [x] 10. tester/components/ResultCard.tsx — 응답 핵심 필드 구조화
- [x] 11. tester/components/TimestampField.tsx — epoch 입력 + Now/-5s/-30s
- [x] 12. tester/components/LogViewer.tsx — 요청/응답 쌍, 소요시간, 필터, 접기, 복사
- [x] 13. tester/components/ShortcutHelp.tsx — 단축키 도움말
- [x] 14. 8개 패널 개편 (recording_id 필드 제거, 일괄 실행, 결과 카드, 확인 다이얼로그)
- [x] 15. TesterPage.tsx 셸 재구성 + 단축키
- [x] 16. `npx tsc --noEmit` 통과
- [x] 17. `npm run build` 통과
- [x] 18. dev 서버(5199) 로 실제 렌더링 확인


## 실서버 검증 결과 (VRM 18113/50063 + FastAPI 8100 + RTSP rtsp://192.168.2.17:8554/proxy4)

| 항목 | 결과 |
|------|------|
| `POST /api/start` (serial 없음) | `INVALID_ARGUMENT: serial_number must be 1-128 characters of [A-Za-z0-9_-].` → 기존 UI 는 시작 자체가 불가능했음을 확증 |
| `POST /api/start` (`encoding_codec: "H264"`) | `Enum Codec has no value defined for name 'H264'` → 기존 드롭다운 값이 무효였음을 확증 |
| `POST /api/start` (COPY, 유효 serial) | **10~33ms** 반환, `state: PENDING` → 비동기 탐색 확인. 이후 목록 폴링에서 RUNNING 전이 확인 |
| `hq_storage_limit_mbs: 10` + 7일 | 약 17초 뒤 `DISK_THRESHOLD/warn` 이벤트 수신, meta `{reason: quota_insufficient_for_bitrate, configured_mb: 10, recommended_mb: 59622, bitrate_bps: 826967}` |
| 권장 쿼터 계산기 | `recommendedQuotaMbs(7, 826967) = 59623` (서버 59622, ceil 차이 1MB) |
| `POST /api/snapshot` | `{image_data: "data:image/jpeg;base64,…"(320KB), actual_timestamp, is_pts_synced, auto_sync_offset_ms}` — **`file` 키 없음** → 기존 미리보기 코드가 죽어 있었음을 확증 |
| 로그 축약 | 900KB base64 → `‹image/jpeg · 659.2 KB 생략›` (JSON 124바이트) |
| `GET /api/events/recent` | `{events: [...], total: N}` 래퍼 — 배열이 아님. api/events.ts 에서 언랩 처리 |
| `GET /api/health/{id}` | `{status: {healthy, jitter}}` oneof 형태 |
| `POST /api/clip/simple` | `{success: {clip_id, file_path, requested_ts, clip_start_ts, clip_end_ts, clip_length_ms}}` |
| `POST /api/clip/event/stop` | `{recording_id, clip_id}` — `clip_path` 는 빈 값이라 생략됨 |
| 렌더 검증 | `renderToString(<TesterPage/>)` 성공(17KB), 8개 패널 개별 렌더 성공 |
| 타입 검사 | 내 담당 파일 에러 0건 (전체 잔여 10건은 모두 담당 외 파일의 기존 에러) |
| 프로덕션 번들 | `vite build` 성공 (778 modules, 1.2MB / gzip 348KB) |
