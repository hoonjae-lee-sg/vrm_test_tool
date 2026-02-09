# VRM Test Tool

`atfr-video-recorder` 서버의 기능을 검증하고 모니터링하기 위한 Python 기반 웹 대시보드 및 테스트 도구입니다.

## 주요 기능

*   **Dashboard:** 현재 등록된 모든 카메라의 상태(Running, Error 등)와 통계(용량, 프레임 수)를 한눈에 모니터링하며, 저화질(SQ) 실시간 미리보기를 제공합니다.
*   **Live View (HQ):** 개별 카메라의 고화질 영상 및 ID3 메타데이터(객체 박스)를 시각화합니다.
*   **Tester:** gRPC API를 직접 호출하여 녹화 시작/중지, 스냅샷 촬영, 이벤트 클립 생성 등의 기능을 테스트합니다.
*   **Playlist:** 녹화된 HLS 영상을 타임라인 기반으로 조회하고 재생합니다.

## 설치 및 실행 방법

### 1. 가상환경 생성 및 의존성 설치 (권장)
Python 3.10 이상 환경이 필요합니다. 프로젝트의 독립성을 위해 가상환경 사용을 권장합니다.

```bash
# 가상환경 생성
python3 -m venv venv

# 가상환경 활성화
source venv/bin/activate

# 의존성 설치
pip install -r requirements.txt
```

### 2. Protobuf 동기화 (필수)
서버의 최신 인터페이스를 반영하기 위해 실행 전 반드시 동기화 스크립트를 실행해야 합니다. 이 과정에서 필요한 `.proto` 파일 복사 및 Python 코드 생성이 자동으로 이루어집니다.
```bash
./sync_protos.sh
```

### 3. 실행
```bash
python app.py
```
기본적으로 `http://localhost:5001` 주소로 접속 가능합니다.

## 서버 연결 정보
*   **gRPC 서버:** `localhost:50051` (기본값)
*   **Web/WebSocket 서버:** `localhost:18071` (기본값)

## 프로젝트 구조
*   `app.py`: Flask 웹 서버 메인.
*   `sync_protos.sh`: 서버 프로토콜 동기화 및 코드 생성 스크립트.
*   `static/`: 디자인 및 프론트엔드 로직 (dashboard.js, live.js 등).
*   `templates/`: 화면 구성용 HTML 템플릿.
*   `test_runner/`: gRPC 통신을 담당하는 클라이언트 클래스.

## 주의사항
*   **SQ 라이브 미리보기:** 브라우저 성능에 따라 여러 개의 영상을 동시에 띄울 때 부하가 발생할 수 있습니다.
*   **데이터 경로:** `app.py`는 `../data` 디렉토리를 참조하여 녹화된 세그먼트 정보를 확인합니다. 서버의 저장 경로 설정을 확인하십시오.