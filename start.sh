#!/bin/bash
# ============================================================================
# VRM Test Tool 통합 실행 스크립트
# 백엔드(FastAPI) + 프론트엔드(Vite) + 스냅샷 수신 서버를 한번에 실행.
# proto 동기화 옵션 포함.
#
# 사용법:
#   ./start.sh                    # 전체 서비스 실행
#   ./start.sh --sync-protos      # proto 동기화 후 실행
#   ./start.sh --no-frontend      # 프론트엔드 제외
#   ./start.sh --no-snapshot      # 스냅샷 서버 제외
#   ./start.sh --only-backend     # 백엔드만 실행
# ============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- 옵션 파싱 ---
SYNC_PROTOS=false
RUN_FRONTEND=true
RUN_SNAPSHOT=true
RUN_BACKEND=true

for arg in "$@"; do
    case "$arg" in
        --sync-protos)   SYNC_PROTOS=true ;;
        --no-frontend)   RUN_FRONTEND=false ;;
        --no-snapshot)   RUN_SNAPSHOT=false ;;
        --no-backend)    RUN_BACKEND=false ;;
        --only-backend)  RUN_FRONTEND=false; RUN_SNAPSHOT=false ;;
        --only-frontend) RUN_BACKEND=false; RUN_SNAPSHOT=false ;;
        --help|-h)
            echo "사용법: ./start.sh [옵션]"
            echo ""
            echo "옵션:"
            echo "  --sync-protos    실행 전 protobuf 코드 재생성"
            echo "  --no-frontend    프론트엔드(Vite) 제외"
            echo "  --no-snapshot    스냅샷 수신 서버 제외"
            echo "  --no-backend     백엔드(FastAPI) 제외"
            echo "  --only-backend   백엔드만 실행"
            echo "  --only-frontend  프론트엔드만 실행"
            echo "  -h, --help       도움말 출력"
            exit 0
            ;;
        *)
            echo "알 수 없는 옵션: $arg"
            echo "./start.sh --help 로 사용법을 확인하세요."
            exit 1
            ;;
    esac
done

# --- ANSI 색상 코드 (로그 구분용) ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# --- 자식 프로세스 PID 저장 배열 ---
PIDS=()

# --- Ctrl+C 시 전체 프로세스 종료 ---
cleanup() {
    echo ""
    echo -e "${RED}[launcher] 모든 서비스를 종료합니다...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null
        fi
    done
    # 자식 프로세스 종료 대기 (최대 5초)
    for pid in "${PIDS[@]}"; do
        timeout 5 tail --pid="$pid" -f /dev/null 2>/dev/null || kill -9 "$pid" 2>/dev/null
    done
    echo -e "${RED}[launcher] 종료 완료.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# --- Proto 동기화 (옵션) ---
if [ "$SYNC_PROTOS" = true ]; then
    echo -e "${CYAN}[launcher] Protobuf 코드 동기화 중...${NC}"
    bash "$SCRIPT_DIR/sync_protos.sh"
    echo -e "${CYAN}[launcher] Proto 동기화 완료.${NC}"
    echo ""
fi

# --- 서비스 헤더 출력 ---
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  VRM Test Tool 통합 실행${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

SERVICES_INFO=""
if [ "$RUN_BACKEND" = true ]; then
    SERVICES_INFO+="  백엔드 (FastAPI)       → http://0.0.0.0:8100\n"
fi
if [ "$RUN_FRONTEND" = true ]; then
    SERVICES_INFO+="  프론트엔드 (Vite)      → http://localhost:5173\n"
fi
if [ "$RUN_SNAPSHOT" = true ]; then
    SERVICES_INFO+="  스냅샷 수신 서버       → http://0.0.0.0:8200\n"
fi

echo -e "$SERVICES_INFO"
echo -e "${GREEN}--------------------------------------------${NC}"
echo -e "  Ctrl+C 로 전체 종료"
echo -e "${GREEN}--------------------------------------------${NC}"
echo ""

# --- 백엔드 실행 (FastAPI, 포트 8100) ---
if [ "$RUN_BACKEND" = true ]; then
    (
        python3 -m uvicorn backend.main:app \
            --host 0.0.0.0 --port 8100 --reload 2>&1 \
        | while IFS= read -r line; do
            echo -e "${BLUE}[backend]  ${NC}$line"
        done
    ) &
    PIDS+=($!)
    echo -e "${BLUE}[launcher] 백엔드 시작됨 (PID: $!)${NC}"
fi

# --- 스냅샷 수신 서버 실행 (포트 8200) ---
if [ "$RUN_SNAPSHOT" = true ]; then
    (
        python3 -m uvicorn snapshot_receiver.main:app \
            --host 0.0.0.0 --port 8200 --reload 2>&1 \
        | while IFS= read -r line; do
            echo -e "${YELLOW}[snapshot] ${NC}$line"
        done
    ) &
    PIDS+=($!)
    echo -e "${YELLOW}[launcher] 스냅샷 수신 서버 시작됨 (PID: $!)${NC}"
fi

# --- 프론트엔드 실행 (Vite, 포트 5173) ---
if [ "$RUN_FRONTEND" = true ]; then
    (
        cd "$SCRIPT_DIR/frontend"
        npm run dev 2>&1 \
        | while IFS= read -r line; do
            echo -e "${GREEN}[frontend] ${NC}$line"
        done
    ) &
    PIDS+=($!)
    echo -e "${GREEN}[launcher] 프론트엔드 시작됨 (PID: $!)${NC}"
fi

echo ""
echo -e "${CYAN}[launcher] 모든 서비스가 시작되었습니다.${NC}"
echo ""

# --- 모든 자식 프로세스 대기 ---
# 하나라도 종료되면 나머지도 정리
wait -n 2>/dev/null || true
echo -e "${RED}[launcher] 서비스 중 하나가 종료되었습니다. 전체 종료...${NC}"
cleanup
