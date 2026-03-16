"""
WebSocket 프록시 라우터
- FastAPI ↔ VRM 서버(oatpp, 포트 18071) 간 WebSocket 중계
- 클라이언트가 /api/ws/live/{recording_id}/{quality} 로 연결하면
  VRM 서버의 /recording/{recording_id}/{quality} WebSocket으로 프록시
"""
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

# VRM 서버 WebSocket 호스트 (동일 Docker 네트워크 내 localhost)
VRM_WS_HOST = "localhost"
VRM_WS_PORT = 18071


@router.websocket("/api/ws/live/{recording_id}/{quality}")
async def websocket_live_proxy(
    websocket: WebSocket,
    recording_id: str,
    quality: str,
):
    """
    라이브 스트림 WebSocket 프록시

    클라이언트 → FastAPI → VRM 서버(oatpp)로 MPEG-TS 데이터를 중계합니다.
    quality: 'hq' (고화질) 또는 'sq' (표준 화질)

    VRM 서버 측 WebSocket 엔드포인트:
      ws://localhost:18071/recording/{recording_id}/{quality}
    """
    # 1. 클라이언트 WebSocket 연결 수락
    await websocket.accept()

    # 2. VRM 서버로의 업스트림 WebSocket 연결
    upstream_url = f"ws://{VRM_WS_HOST}:{VRM_WS_PORT}/recording/{recording_id}/{quality}"
    logger.info(f"[WS Proxy] 연결 시도: {upstream_url}")

    try:
        import websockets
    except ImportError:
        logger.error("[WS Proxy] 'websockets' 패키지가 필요합니다. pip install websockets")
        await websocket.close(code=1011, reason="Server missing websockets package")
        return

    try:
        async with websockets.connect(
            upstream_url,
            # 대용량 MPEG-TS 프레임 수신을 위해 버퍼 크기 확대
            max_size=10 * 1024 * 1024,  # 10MB
            ping_interval=20,
            ping_timeout=20,
        ) as upstream_ws:
            logger.info(f"[WS Proxy] VRM 서버 연결 성공: {recording_id}/{quality}")

            # 양방향 프록시: 두 방향을 동시에 처리
            # - upstream → client: VRM 서버에서 MPEG-TS 데이터 수신 → 클라이언트로 전달
            # - client → upstream: 클라이언트 메시지 → VRM 서버로 전달 (제어 메시지 등)

            async def upstream_to_client():
                """VRM 서버 → 클라이언트 방향 데이터 전달"""
                try:
                    async for message in upstream_ws:
                        if isinstance(message, bytes):
                            await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)
                except websockets.exceptions.ConnectionClosed:
                    logger.info(f"[WS Proxy] VRM 서버 연결 종료: {recording_id}/{quality}")
                except Exception as e:
                    logger.error(f"[WS Proxy] upstream→client 오류: {e}")

            async def client_to_upstream():
                """클라이언트 → VRM 서버 방향 데이터 전달"""
                try:
                    while True:
                        # 클라이언트로부터 메시지 수신 (텍스트 또는 바이너리)
                        data = await websocket.receive()
                        if "text" in data:
                            await upstream_ws.send(data["text"])
                        elif "bytes" in data:
                            await upstream_ws.send(data["bytes"])
                except WebSocketDisconnect:
                    logger.info(f"[WS Proxy] 클라이언트 연결 종료: {recording_id}/{quality}")
                except Exception as e:
                    logger.error(f"[WS Proxy] client→upstream 오류: {e}")

            # 두 태스크를 동시에 실행, 하나가 끝나면 나머지도 취소
            tasks = [
                asyncio.create_task(upstream_to_client()),
                asyncio.create_task(client_to_upstream()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

            # 남은 태스크 정리
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    except websockets.exceptions.InvalidStatusCode as e:
        logger.error(f"[WS Proxy] VRM 서버 연결 실패 (HTTP {e.status_code}): {upstream_url}")
        await websocket.close(code=1011, reason=f"Upstream connection failed: HTTP {e.status_code}")
    except ConnectionRefusedError:
        logger.error(f"[WS Proxy] VRM 서버 연결 거부: {upstream_url}")
        await websocket.close(code=1011, reason="VRM server connection refused")
    except Exception as e:
        logger.error(f"[WS Proxy] 예상치 못한 오류: {e}")
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception:
            pass
    finally:
        logger.info(f"[WS Proxy] 프록시 세션 종료: {recording_id}/{quality}")
