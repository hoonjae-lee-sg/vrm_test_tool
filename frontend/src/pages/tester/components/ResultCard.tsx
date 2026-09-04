/**
 * 응답 요약 카드
 *
 * [해결하는 문제]
 * 기존에는 모든 응답이 우측 로그의 raw JSON 덤프로만 보였음. 그런데 실제로 확인하고
 * 싶은 값은 대개 서너 개(state / clip_id / healthy / fps)이고, 나머지는 노이즈임.
 * 이 카드가 핵심 필드를 라벨-값으로 구조화하고, 원본 JSON 은 접어 둔 뒤 필요할 때만
 * 펼치게 함(로그 패널의 전체 덤프와 중복되지 않도록 기본 접힘).
 */
import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";

/** 값의 성격 — 색으로 즉시 판단 가능하게 함 */
export type RowTone = "default" | "good" | "warn" | "bad" | "muted";

/** 카드 한 줄 */
export interface ResultRow {
  label: string;
  value: ReactNode;
  /** 값에 monospace 적용 (ID/경로/숫자) */
  mono?: boolean;
  tone?: RowTone;
}

/** ResultCard Props */
interface ResultCardProps {
  /** 카드 제목 */
  title: string;
  /** 표시할 행 목록 — value 가 null/undefined 인 행은 호출부에서 걸러 넣을 것 */
  rows: ResultRow[];
  /** 카드 전체 톤 (성공/실패 테두리) */
  tone?: "success" | "error" | "neutral";
  /** 접어 둘 원본 응답 */
  raw?: unknown;
  /** 표 아래 추가 영역 (이미지 미리보기 등) */
  children?: ReactNode;
}

/** 톤 → 텍스트 색 클래스 */
const TONE_TEXT: Record<RowTone, string> = {
  default: "text-text-primary",
  good: "text-status-running",
  warn: "text-status-pending",
  bad: "text-status-error",
  muted: "text-text-muted",
};

/** 카드 테두리 톤 */
const CARD_TONE: Record<string, string> = {
  success: "border-border",
  error: "border-status-error/40",
  neutral: "border-border",
};

export default function ResultCard({
  title,
  rows,
  tone = "neutral",
  raw,
  children,
}: ResultCardProps) {
  /** 원본 JSON 펼침 상태 */
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-bg-card border rounded-lg overflow-hidden ${CARD_TONE[tone]}`}>
      <div className="px-4 py-2.5 border-b border-border-subtle">
        <h3 className="text-[12px] font-semibold text-text-primary">{title}</h3>
      </div>

      {rows.length > 0 && (
        <dl className="divide-y divide-border-subtle">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-4 px-4 py-1.5">
              <dt className="text-[11px] text-text-secondary w-40 shrink-0 pt-px">{row.label}</dt>
              <dd
                className={`text-[12px] min-w-0 break-all ${
                  row.mono ? "font-mono tabular" : ""
                } ${TONE_TEXT[row.tone ?? "default"]}`}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {children && <div className="px-4 py-3 border-t border-border-subtle">{children}</div>}

      {raw !== undefined && (
        <div className="border-t border-border-subtle">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 w-full px-4 py-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronRightIcon
              className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
            raw response
          </button>
          {expanded && (
            <pre className="px-4 pb-3 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-all max-h-72 overflow-y-auto">
              {JSON.stringify(raw, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
