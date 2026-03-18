# VRM Test Tool

`atfr-video-recorder`(VRM) 서버의 기능을 검증하고 모니터링하기 위한 웹 기반 테스트 도구.

- **Frontend**: React + TypeScript + Tailwind CSS (Vite)
- **Backend**: FastAPI (gRPC 프록시 + WebSocket 프록시)
- **Snapshot Receiver**: 고속 멀티스냅샷 큐 기반 수신·저장 서버

## 주요 기능

| 페이지 | 설명 |
|--------|------|
| **Dashboard** | 전 채널 상태 모니터링 + SQ 라이브 프리뷰 + 녹화 시작/중지 |
| **Multi-Snapshot** | 멀티 카메라 동기화 스냅샷 (브라우저 모드 / 서버 모드) |
| **Tester** | gRPC API 직접 호출 (녹화, 스냅샷, 클립, 헬스체크) |
| **Playlist** | HLS 녹화 영상 타임라인 조회 및 재생 |
| **Live Grid** | 다채널 고화질 라이브 스트리밍 그리드 |
| **Sync Viewer** | 서버 모드로 저장된 멀티스냅샷 동기화 검증 뷰어 |

## 아키텍처

```
브라우저 (localhost:5173)
  │
  ├─ /api/*        → FastAPI 백엔드 (localhost:8100) → gRPC (localhost:50000)
  ├─ /api/ws/live/* → FastAPI WebSocket 프록시       → VRM WebSocket (localhost:18071)
  └─ /capture/*    → Snapshot Receiver (localhost:8200) → gRPC (localhost:50000)
```

## 실행 환경

Docker 컨테이너 내부에서 실행 (devcontainer). 브라우저는 호스트에서 포트 포워딩으로 접속.

### 사전 준비

```bash
# 컨테이너 내부에서 의존성 설치 (devcontainer 자동 실행됨, 수동 시)
cd /workspace/vrm_test_tool
pip3 install --user --break-system-packages -r backend/requirements.txt
pip3 install --user --break-system-packages -r snapshot_receiver/requirements.txt
cd frontend && npm install
```

### Protobuf 동기화

VRM 서버의 proto 정의가 변경되었을 때 실행.

```bash
cd /workspace/vrm_test_tool
./sync_protos.sh
```

## 실행 방법

VRM 서버(`atfr-video-recorder`)가 실행 중인 상태에서 아래 3개 서버를 각각 실행.

### 1. 백엔드 (FastAPI) — 포트 8100

```bash
cd /workspace/vrm_test_tool
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8100 --reload
```

gRPC 프록시 API + WebSocket 프록시 + React 정적 파일 서빙.

### 2. 프론트엔드 (Vite 개발 서버) — 포트 5173

```bash
cd /workspace/vrm_test_tool/frontend
npm run dev
```

React HMR 개발 서버. 브라우저에서 `http://localhost:5173` 접속.

### 3. Snapshot Receiver 서버 — 포트 8200

```bash
cd /workspace/vrm_test_tool
python3 -m uvicorn snapshot_receiver.main:app --host 0.0.0.0 --port 8200 --reload
```

멀티스냅샷 고속 캡처 (최대 20채널 × 24fps). Multi-Snapshot 페이지에서 Server Mode 활성화 시 사용.

### 실행 순서 요약

```
1. VRM 서버        (C++ 바이너리, 포트 50000/18071)  ← 이미 실행 중
2. 백엔드          python -m uvicorn backend.main:app --host 0.0.0.0 --port 8100 --reload
3. 스냅샷 서버     python -m uvicorn snapshot_receiver.main:app --host 0.0.0.0 --port 8200 --reload
4. 프론트엔드      cd frontend && npm run dev
```

## 포트 정리

| 서버 | 포트 | 역할 |
|------|------|------|
| VRM (gRPC) | 50000 | C++ 녹화 엔진 gRPC API |
| VRM (REST/WS) | 18071 | REST API + 라이브 MPEG-TS WebSocket |
| FastAPI 백엔드 | 8100 | gRPC/WebSocket 프록시 + UI 서빙 |
| Snapshot Receiver | 8200 | 고속 멀티스냅샷 큐 저장 서버 |
| Vite 개발 서버 | 5173 | React HMR (개발용) |

## 프로젝트 구조

```
vrm_test_tool/
├── backend/                    # FastAPI 백엔드
│   ├── main.py                 #   앱 진입점
│   ├── routers/                #   API 라우터 (recording, snapshot, clip, health, websocket)
│   ├── schemas/                #   Pydantic 모델
│   ├── services/               #   gRPC 클라이언트 서비스
│   └── requirements.txt
├── frontend/                   # React 프론트엔드
│   ├── src/
│   │   ├── pages/              #   페이지 컴포넌트 (Dashboard, MultiSnapshot, SyncViewer 등)
│   │   ├── components/         #   공통 컴포넌트 (Layout, StatusBadge, Toast)
│   │   ├── api/                #   API 클라이언트 (recording, snapshot_receiver)
│   │   ├── hooks/              #   커스텀 훅 (useRecordings, useToast)
│   │   └── index.css           #   Tailwind CSS 테마
│   ├── vite.config.ts          #   Vite 설정 (프록시 포함)
│   └── package.json
├── snapshot_receiver/          # 멀티스냅샷 수신·저장 서버
│   ├── main.py                 #   FastAPI 진입점 + 제어 API
│   ├── config.py               #   서버 설정 (환경변수 지원)
│   ├── receiver.py             #   gRPC 스냅샷 수신 + 동기화 캡처 로직
│   ├── queue_manager.py        #   asyncio.Queue 기반 큐 관리
│   ├── writer.py               #   멀티스레드 디스크 저장 워커
│   ├── models.py               #   데이터 모델 (SnapshotItem, CaptureSession)
│   └── requirements.txt
├── protos/                     # 원본 .proto 정의 파일
├── video_recorder/             # protobuf 생성된 Python 모듈
└── sync_protos.sh              # proto 동기화 스크립트
```

## 스냅샷 저장 경로

Server Mode로 캡처된 스냅샷은 VRM 루트의 `data/` 아래에 저장.

```
data/
├── {recording_id}/
│   └── snapshot/
│       └── {YYYYMMDD}/
│           └── {HH}/
│               ├── {timestamp_ms}_{diff_ms}ms.jpg
│               ├── {timestamp_ms}_{diff_ms}ms.jpg
│               └── ...
```

- `timestamp_ms`: 마스터 카메라 기준 밀리초 타임스탬프 (동일 시점 = 동일 값)
- `diff_ms`: 마스터 대비 실제 프레임 타임스탬프 차이 (동기화 오차)

## 환경변수

Snapshot Receiver 서버는 환경변수로 설정 변경 가능.

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `GRPC_ADDRESS` | `localhost:50000` | VRM gRPC 서버 주소 |
| `SNAPSHOT_STORAGE_PATH` | `../data` (VRM 루트) | 스냅샷 저장 경로 |
| `DEFAULT_FPS` | `24` | 기본 캡처 FPS |
| `MAX_CHANNELS` | `20` | 최대 동시 캡처 채널 수 |
| `QUEUE_MAX_SIZE` | `1000` | 메모리 큐 최대 크기 |
| `WRITER_WORKERS` | `4` | 디스크 저장 워커 스레드 수 |
| `GRPC_TIMEOUT_SEC` | `3.0` | gRPC 호출 타임아웃 (초) |
| `CAPTURE_MAX_RETRIES` | `3` | 채널별 캡처 실패 시 재시도 횟수 |
| `API_PORT` | `8200` | 제어 API 서버 포트 |
