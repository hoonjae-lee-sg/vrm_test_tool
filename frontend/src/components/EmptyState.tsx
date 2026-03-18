/**
 * 빈 상태 표시 컴포넌트
 * 데이터가 없을 때 일관된 빈 화면 UI 제공
 * - 아이콘(이모지/ReactNode) + 메시지 + 설명 + 액션 버튼 구성
 * - 컨테이너 내 수직/수평 중앙 정렬
 */
import type { ReactNode } from "react";
import Button from "./Button";

/** 빈 상태 Props 정의 */
interface EmptyStateProps {
  /** 아이콘 (Heroicon 등 ReactNode) */
  icon?: ReactNode;
  /** 주요 안내 메시지 */
  message: string;
  /** 보조 설명 텍스트 */
  description?: string;
  /** 액션 버튼 — 라벨과 클릭 핸들러 */
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({
  icon,
  message,
  description,
  action,
}: EmptyStateProps) {
  return (
    /* 컨테이너 중앙 정렬 — 라디얼 그래디언트 배경 + 브리딩 아이콘 */
    <div className="relative flex flex-col items-center justify-center py-12">
      {/* 배경 라디얼 그래디언트 — 은은한 brand 색상 퍼짐 효과 */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.05)_0%,transparent_70%)]" />
      {/* 아이콘 — 브리딩 애니메이션 (불투명도 펄스) */}
      <div className="flex items-center justify-center text-text-muted/50 animate-pulse opacity-60">
        {icon}
      </div>

      {/* 주요 메시지 */}
      <p className="text-sm text-text-muted font-medium mt-3">{message}</p>

      {/* 보조 설명 — 선택적 표시 */}
      {description && (
        <p className="text-xs text-text-muted/70 mt-1">{description}</p>
      )}

      {/* 액션 버튼 — action prop 존재 시 표시 */}
      {action && (
        <div className="mt-4">
          <Button variant="primary" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  );
}
