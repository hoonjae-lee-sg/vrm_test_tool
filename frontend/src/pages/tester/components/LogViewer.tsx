/**
 * Response 로그 뷰어 컴포넌트
 * TesterPage 우측 패널의 로그 표시 및 자동 스크롤 로직 분리
 * - 로그 목록 렌더링
 * - 자동 하단 스크롤
 * - 로그 초기화 기능
 */
import { useRef, useEffect } from "react";

/** 로그 항목 타입 정의 */
export interface LogEntry {
  /** 고유 식별자 */
  id: number;
  /** 로그 기록 시각 문자열 */
  time: string;
  /** 로그 제목 (API 호출명 등) */
  title: string;
  /** 응답 데이터 (JSON 직렬화 대상) */
  data?: unknown;
}

/** LogViewer Props 정의 */
interface LogViewerProps {
  /** 로그 항목 배열 */
  logs: LogEntry[];
  /** 로그 전체 초기화 콜백 */
  onClear: () => void;
}

export default function LogViewer({ logs, onClear }: LogViewerProps) {
  /** 스크롤 컨테이너 ref — 자동 하단 스크롤 대상 */
  const containerRef = useRef<HTMLDivElement>(null);

  /** 로그 추가 시 자동으로 하단 스크롤 이동 */
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
      });
    }
  }, [logs]);

  return (
    /* 로그 패널 — 터미널 스타일 (다크 배경 + 모노 폰트) */
    <div className="w-80 flex-shrink-0 bg-black/40 border-l border-white/[0.06] flex flex-col">
      {/* 헤더 — 제목 및 초기화 버튼 */}
      <div className="flex items-center justify-between p-3 border-b border-white/[0.06]">
        <h3 className="text-xs font-bold font-mono text-text-muted uppercase tracking-wider">
          Response Log
        </h3>
        <button
          onClick={onClear}
          className="text-xs text-text-muted hover:text-text-primary"
        >
          Clear
        </button>
      </div>

      {/* 로그 목록 — 터미널 스타일 스크롤 영역 */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-sm">
        {logs.length === 0 ? (
          <p className="text-xs text-text-muted">Waiting for commands...</p>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className="text-xs">
              {/* 시각 및 제목 */}
              <div className="flex gap-2 mb-1">
                <span className="text-text-muted font-mono">[{entry.time}]</span>
                <span className="text-brand font-semibold">{entry.title}</span>
              </div>
              {/* 응답 데이터 JSON 표시 */}
              {entry.data && (
                <pre className="bg-bg-app rounded p-2 overflow-x-auto text-text-secondary font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(entry.data, null, 2)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
