/**
 * 패널 공통 껍데기
 *
 * [해결하는 문제]
 * 8개 패널이 제목 h2 / 폼 / Button 배치를 각자 복붙하고 있었고, "지금 이 명령이
 * 어떤 엔드포인트로 어느 대상에 나가는지" 는 어디에도 표시되지 않았음.
 * 이 컴포넌트가 헤더(동작명 + METHOD + 경로 + 대상 요약)와 실행 버튼 줄을 통일해
 * 패널 본문은 "그 명령 고유의 입력"만 남기게 함.
 */
import type { ReactNode } from "react";
import Button from "@/components/Button";

/** PanelShell Props */
interface PanelShellProps {
  /** 동작명 */
  title: string;
  /** HTTP 메서드 — 사이드바 메뉴 표기와 동일 */
  method: string;
  /** 호출 경로 */
  endpoint: string;
  /** 이 명령이 무엇을 하는지 한 줄 설명 */
  description: string;
  /** 대상 목록 — 헤더에 요약 표시 */
  targets: string[];
  /** 대상 선택이 필요한 명령인지 (Start 는 false) */
  requiresTarget?: boolean;
  /** 폼 본문 */
  children: ReactNode;
  /** 실행 버튼 라벨 */
  actionLabel: string;
  /** 실행 버튼 스타일 */
  actionVariant?: "primary" | "destructive";
  /** 실행 핸들러 */
  onSubmit: () => void;
  /** 실행 중 */
  loading?: boolean;
  /** 실행 불가 사유 — 있으면 버튼 비활성 + 사유 표시 */
  blockedReason?: string | null;
  /** 실행 버튼 우측 보조 영역 (초기화 버튼 등) */
  actionsExtra?: ReactNode;
  /** 실행 결과 영역 */
  result?: ReactNode;
}

export default function PanelShell({
  title,
  method,
  endpoint,
  description,
  targets,
  requiresTarget = true,
  children,
  actionLabel,
  actionVariant = "primary",
  onSubmit,
  loading = false,
  blockedReason,
  actionsExtra,
  result,
}: PanelShellProps) {
  /* 다중 대상이면 버튼 라벨에 개수를 붙여 "몇 대에 나가는지" 를 누르기 전에 알림 */
  const batch = requiresTarget && targets.length > 1;
  const label = batch ? `${actionLabel} × ${targets.length}` : actionLabel;

  return (
    <div>
      {/* ── 헤더 ── */}
      <div className="mb-5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[17px] font-semibold text-text-primary">{title}</h2>
          <span className="font-mono text-[10px] font-bold text-text-muted">{method}</span>
          <span className="font-mono text-[11px] text-text-muted">{endpoint}</span>
        </div>
        <p className="text-[12px] text-text-secondary mt-1">{description}</p>

        {/* 대상 요약 — 어느 카메라에 나가는 명령인지 패널 안에서도 확인 가능 */}
        {requiresTarget && (
          <div className="mt-2.5 text-[12px]">
            {targets.length === 0 ? (
              <span className="text-status-pending">
                대상 없음 — 상단 Target 에서 recording_id 를 선택하세요 (Ctrl+K)
              </span>
            ) : targets.length === 1 ? (
              <span className="text-text-secondary">
                대상 <span className="font-mono text-text-primary">{targets[0]}</span>
              </span>
            ) : (
              <span className="text-text-secondary">
                대상 <span className="text-brand font-medium">{targets.length}개</span> — 순차 실행됨
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── 폼 ── */}
      <div className="space-y-3">{children}</div>

      {/* ── 실행 ── */}
      <div className="flex items-center gap-2 mt-5">
        <Button
          variant={actionVariant}
          size="md"
          onClick={onSubmit}
          isLoading={loading}
          disabled={!!blockedReason}
        >
          {label}
        </Button>
        {actionsExtra}
        {blockedReason ? (
          <span className="text-[11px] text-status-error">{blockedReason}</span>
        ) : (
          <span className="text-[11px] text-text-muted">Ctrl+Enter</span>
        )}
      </div>

      {/* ── 결과 ── */}
      {result && <div className="mt-6">{result}</div>}
    </div>
  );
}
