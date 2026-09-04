/**
 * Response 로그 뷰어
 *
 * [기존 대비 개선점]
 * 1. 요청과 응답을 **한 엔트리**로 묶음 — 예전에는 "Starting recording..." 과
 *    "Start Response:" 가 별도 줄로 쌓여, 여러 호출이 섞이면 짝을 찾기 어려웠음.
 * 2. 소요 시간(ms) 표시 — RecordStart 가 비동기 탐색으로 바뀌어 수십 ms 로 떨어진 것을
 *    눈으로 확인할 수 있어야 회귀를 잡을 수 있음.
 * 3. 성공/실패 색 구분 + "실패만" 필터 + 텍스트 필터.
 * 4. 본문 기본 접힘 — 로그가 길어져도 스크롤 탐색이 가능. 클릭 시 요청/응답 전개.
 * 5. 복사 버튼 — 이슈 리포트에 그대로 붙여넣기.
 * 6. 자동 스크롤은 "사용자가 하단에 있을 때만" 수행 — 과거 로그를 읽는 중에
 *    새 응답이 도착해 화면이 튀는 문제를 방지.
 */
import { useRef, useEffect, useState, useMemo } from "react";
import { ChevronRightIcon, ClipboardIcon } from "@heroicons/react/20/solid";
import type { LogEntry } from "../types";
import { stringifyForCopy } from "../lib/sanitize";

export type { LogEntry };

/** LogViewer Props */
interface LogViewerProps {
  logs: LogEntry[];
  onClear: () => void;
  /**
   * 바깥 배치(폭·표시여부·테두리)를 호출부가 결정하도록 위임하는 클래스.
   * 기존에는 `w-[27rem] flex-shrink-0` 이 컴포넌트 안에 박혀 있어 1024px 이하에서
   * 중앙 폼을 80px 까지 밀어냈음. 데스크톱은 우측 고정 컬럼, 그 미만은 하단 드로어로
   * 같은 컴포넌트를 재사용하기 위해 분리함.
   */
  className?: string;
  /** 하단 드로어에서 쓰는 닫기 버튼 — 넘기지 않으면 렌더되지 않음 */
  onClose?: () => void;
}

/** 소요 시간 색 — 느린 호출을 눈에 띄게 함 */
function durationTone(ms: number): string {
  if (ms < 300) return "text-emerald-300/70";
  if (ms < 1500) return "text-amber-300/70";
  return "text-red-300/80";
}

export default function LogViewer({
  logs,
  onClear,
  className = "w-[27rem] flex-shrink-0 border-l border-border",
  onClose,
}: LogViewerProps) {
  /** 스크롤 컨테이너 ref */
  const containerRef = useRef<HTMLDivElement>(null);
  /** 사용자가 하단에 붙어 있는지 — 자동 스크롤 여부 판단 */
  const stickRef = useRef(true);
  /** 펼쳐진 엔트리 ID 집합 */
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  /** 실패만 보기 */
  const [onlyErrors, setOnlyErrors] = useState(false);
  /** 텍스트 필터 (동작명/엔드포인트/대상/에러 메시지 대상) */
  const [query, setQuery] = useState("");
  /** 복사 완료 표시 대상 */
  const [copiedId, setCopiedId] = useState<number | null>(null);

  /** 필터 적용된 목록 */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((e) => {
      if (onlyErrors && e.ok) return false;
      if (!q) return true;
      return (
        e.label.toLowerCase().includes(q) ||
        e.endpoint.toLowerCase().includes(q) ||
        (e.target ?? "").toLowerCase().includes(q) ||
        (e.error ?? "").toLowerCase().includes(q)
      );
    });
  }, [logs, onlyErrors, query]);

  /** 실패 건수 — 필터 버튼에 함께 표기 */
  const errorCount = useMemo(() => logs.filter((e) => !e.ok).length, [logs]);

  /** 새 로그 도착 시, 사용자가 하단에 있을 때만 따라 내려감 */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [visible]);

  /** 스크롤 위치 추적 — 하단 24px 이내면 "붙어 있음" 으로 간주 */
  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  /** 엔트리 펼침 토글 */
  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 엔트리 전체를 클립보드로 — navigator.clipboard 미지원/비보안 컨텍스트는 조용히 무시 */
  const copy = async (entry: LogEntry) => {
    try {
      await navigator.clipboard.writeText(stringifyForCopy(entry));
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((c) => (c === entry.id ? null : c)), 1200);
    } catch {
      /* 클립보드 권한 없음 — 부가 기능이므로 무시 */
    }
  };

  return (
    /* 로그 패널 — 터미널 스타일 (코드 로그 영역은 다크 유지).
       배치 클래스는 className 으로 주입받아 데스크톱 우측 컬럼 / 하단 드로어를 겸함 */
    <div className={`bg-[#0E1116] flex flex-col min-w-0 ${className}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
        <h3 className="text-[10px] font-semibold font-mono text-white/50 uppercase tracking-[0.15em]">
          Response log
          <span className="ml-2 text-white/30 normal-case tracking-normal">{logs.length}</span>
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={onClear}
            className="text-[11px] text-white/50 hover:text-white transition-colors whitespace-nowrap"
            title="Ctrl+L"
          >
            Clear
          </button>
          {/* 드로어 모드에서만 노출되는 닫기 */}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="로그 닫기"
              className="text-[11px] text-white/50 hover:text-white transition-colors whitespace-nowrap"
            >
              닫기
            </button>
          )}
        </div>
      </div>

      {/* 필터 줄 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter…"
          className="flex-1 min-w-0 h-7 px-2 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] text-white/80 font-mono placeholder:text-white/30 focus:border-white/25 outline-none"
        />
        <button
          onClick={() => setOnlyErrors((v) => !v)}
          className={`h-7 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
            onlyErrors
              ? "bg-red-500/20 text-red-300 border border-red-400/30"
              : "text-white/50 border border-white/[0.08] hover:text-white/80"
          }`}
        >
          errors {errorCount > 0 && <span className="tabular">({errorCount})</span>}
        </button>
      </div>

      {/* 로그 목록 */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1 font-mono text-[11px]"
      >
        {visible.length === 0 ? (
          <p className="text-[11px] text-white/40 px-1 py-2">
            {logs.length === 0 ? "Waiting for commands…" : "필터에 맞는 로그 없음"}
          </p>
        ) : (
          visible.map((entry) => {
            const isOpen = expanded.has(entry.id);
            return (
              <div
                key={entry.id}
                className={`rounded border transition-colors ${
                  entry.ok
                    ? "border-white/[0.06] bg-white/[0.02]"
                    : "border-red-400/25 bg-red-500/[0.06]"
                }`}
              >
                {/* 요약 줄 — 클릭으로 상세 토글 */}
                <button
                  onClick={() => toggle(entry.id)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left min-w-0"
                >
                  <ChevronRightIcon
                    className={`w-3 h-3 shrink-0 text-white/30 transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
                  <span className="text-white/35 tabular shrink-0">{entry.time}</span>
                  <span
                    className={`font-semibold truncate ${entry.ok ? "text-[#7FA9FF]" : "text-red-300"}`}
                  >
                    {entry.label}
                  </span>
                  {entry.target && (
                    <span className="text-white/45 truncate max-w-[7rem]" title={entry.target}>
                      {entry.target}
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className={`tabular ${durationTone(entry.durationMs)}`}>
                    {entry.durationMs}ms
                  </span>
                  <span
                    className={`text-[10px] font-bold shrink-0 ${
                      entry.ok ? "text-emerald-400/80" : "text-red-400"
                    }`}
                  >
                    {entry.ok ? "OK" : "FAIL"}
                  </span>
                </button>

                {/* 실패 사유는 접힌 상태에서도 항상 보임 — 가장 알고 싶은 정보이므로 */}
                {!entry.ok && entry.error && (
                  <p className="px-2 pb-1.5 pl-6 text-red-200/90 break-all whitespace-pre-wrap">
                    {entry.error}
                  </p>
                )}

                {isOpen && (
                  <div className="px-2 pb-2 pl-6 space-y-1.5">
                    <div className="flex items-center gap-2 text-white/35">
                      <span className="font-bold">{entry.method}</span>
                      <span className="truncate">{entry.endpoint}</span>
                      <span className="flex-1" />
                      <button
                        onClick={() => copy(entry)}
                        className="flex items-center gap-1 text-white/40 hover:text-white transition-colors"
                        title="엔트리 복사"
                      >
                        <ClipboardIcon className="w-3 h-3" />
                        {copiedId === entry.id ? "copied" : "copy"}
                      </button>
                    </div>

                    {entry.request !== undefined && entry.request !== null && (
                      <div>
                        <div className="text-white/30 mb-0.5">request</div>
                        <pre className="bg-black/40 rounded p-2 overflow-x-auto text-white/60 leading-relaxed whitespace-pre-wrap break-all">
                          {JSON.stringify(entry.request, null, 2)}
                        </pre>
                      </div>
                    )}

                    {entry.response !== undefined && (
                      <div>
                        <div className="text-white/30 mb-0.5">response</div>
                        <pre className="bg-black/40 rounded p-2 overflow-x-auto text-white/70 leading-relaxed whitespace-pre-wrap break-all">
                          {JSON.stringify(entry.response, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
