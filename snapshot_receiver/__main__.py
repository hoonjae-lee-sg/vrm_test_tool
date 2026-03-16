"""
python -m snapshot_receiver 로 직접 실행 지원
"""
import uvicorn
from .config import config

uvicorn.run(
    "snapshot_receiver.main:app",
    host=config.api_host,
    port=config.api_port,
    log_level="info",
)
