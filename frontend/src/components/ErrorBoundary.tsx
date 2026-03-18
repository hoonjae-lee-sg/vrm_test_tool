/**
 * React 에러 바운더리 컴포넌트
 * 하위 컴포넌트 트리에서 발생한 JavaScript 에러를 포착하여 폴백 UI 표시
 * - 에러 메시지 + 재시도 버튼 제공
 * - React ErrorBoundary는 클래스 컴포넌트로만 구현 가능
 */
import { Component, type ReactNode, type ErrorInfo } from "react";

/** ErrorBoundary Props 정의 */
interface ErrorBoundaryProps {
  /** 하위 컴포넌트 트리 */
  children: ReactNode;
}

/** ErrorBoundary 내부 상태 정의 */
interface ErrorBoundaryState {
  /** 에러 발생 여부 */
  hasError: boolean;
  /** 포착된 에러 객체 */
  error: Error | null;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  /** 렌더링 중 에러 발생 시 상태 업데이트 */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /** 에러 정보 로깅 */
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] 에러 포착:", error, errorInfo);
  }

  /** 재시도 핸들러 — 에러 상태 초기화 후 하위 트리 재렌더링 */
  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        /* 폴백 UI — 다크 테마 스타일 */
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full text-center">
            {/* 에러 아이콘 */}
            <div className="mb-3 text-status-error">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 mx-auto">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            {/* 에러 제목 */}
            <h2 className="text-lg font-bold text-text-primary mb-2">
              오류가 발생했습니다
            </h2>
            {/* 에러 메시지 상세 */}
            <p className="text-sm text-text-muted mb-4">
              {this.state.error?.message || "알 수 없는 오류"}
            </p>
            {/* 재시도 버튼 */}
            <button
              onClick={this.handleRetry}
              className="px-4 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand/80 transition"
            >
              다시 시도
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
