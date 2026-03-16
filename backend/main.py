"""
FastAPI 메인 앱 — VRM Test Tool 백엔드
gRPC 프록시 + React 정적 파일 서빙
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.routers import recording, snapshot, clip, health

app = FastAPI(
    title="VRM Test Tool API",
    description="ATFR Video Recorder 테스트 도구 — gRPC 프록시 API",
    version="2.0.0",
)

# CORS 설정 — 개발 시 Vite 개발 서버(5173)에서의 요청 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite 개발 서버
        "http://127.0.0.1:5173",
        "http://localhost:8100",   # FastAPI 자체 (프로덕션 빌드 서빙 시)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(recording.router)
app.include_router(snapshot.router)
app.include_router(clip.router)
app.include_router(health.router)

# 프로덕션: React 빌드 결과물 정적 파일 서빙
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8100,
        reload=True,
    )
