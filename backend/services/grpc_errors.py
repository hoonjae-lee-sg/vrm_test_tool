"""gRPC 상태 코드를 HTTP 상태 코드로 변환하는 공통 계층.

배경: 각 라우터가 `except Exception: raise HTTPException(500, str(e))` 로 모든 예외를 뭉개
      gRPC 의 정상적인 거절(ALREADY_EXISTS, INVALID_ARGUMENT 등)까지 500 Internal Server Error
      로 표시됨. 서버는 멀쩡한데 장애처럼 보이고, detail 에는 `<_InactiveRpcError of RPC that
      terminated with: ...>` 라는 파이썬 객체 덤프가 실려 UI 에서 읽을 수 없었음.

정책: gRPC 상태 → 대응하는 HTTP 상태로 매핑하고, detail 에는 서버가 보낸 사유 문자열만 담음.
      매핑에 없는 코드는 500 으로 두어 진짜 내부 오류와 구분 가능하게 유지.
"""
import grpc
from fastapi import HTTPException

# gRPC canonical code → HTTP status.
# 미등재 코드는 500 으로 폴백(= 예상치 못한 내부 오류로 취급).
_GRPC_TO_HTTP = {
    grpc.StatusCode.OK:                  200,
    grpc.StatusCode.INVALID_ARGUMENT:    400,   # 필수값 누락·형식 위반
    grpc.StatusCode.FAILED_PRECONDITION: 409,   # 상태 전제 불충족
    grpc.StatusCode.OUT_OF_RANGE:        400,
    grpc.StatusCode.UNAUTHENTICATED:     401,
    grpc.StatusCode.PERMISSION_DENIED:   403,
    grpc.StatusCode.NOT_FOUND:           404,   # 녹화·프레임 없음
    grpc.StatusCode.ALREADY_EXISTS:      409,   # 동일 serial 로 이미 녹화 중
    grpc.StatusCode.ABORTED:             409,
    grpc.StatusCode.RESOURCE_EXHAUSTED:  429,
    grpc.StatusCode.CANCELLED:           499,   # 클라이언트 취소(nginx 관례 코드)
    grpc.StatusCode.UNIMPLEMENTED:       501,
    grpc.StatusCode.UNAVAILABLE:         503,   # VRM 서버 미기동·연결 불가
    grpc.StatusCode.DEADLINE_EXCEEDED:   504,
}


def grpc_http_status(err: grpc.RpcError) -> int:
    """RpcError 의 상태 코드를 HTTP 상태로 변환. 미등재 코드는 500."""
    try:
        return _GRPC_TO_HTTP.get(err.code(), 500)
    except Exception:
        # code() 자체가 실패하는 비정상 객체 방어.
        return 500


def grpc_detail(err: grpc.RpcError) -> str:
    """서버가 보낸 사유 문자열만 추출. details() 가 비면 코드명으로 대체."""
    try:
        d = err.details()
        if d:
            return d
        return err.code().name
    except Exception:
        return str(err)


def to_http_exception(err: Exception) -> HTTPException:
    """예외를 적절한 HTTPException 으로 변환.

    gRPC 거절은 의미 있는 상태 코드로, 그 외는 500 으로 넘김.
    이미 HTTPException 이면 그대로 통과시켜 라우터가 의도한 상태를 보존.
    """
    if isinstance(err, HTTPException):
        return err
    if isinstance(err, grpc.RpcError):
        return HTTPException(status_code=grpc_http_status(err), detail=grpc_detail(err))
    return HTTPException(status_code=500, detail=str(err))
