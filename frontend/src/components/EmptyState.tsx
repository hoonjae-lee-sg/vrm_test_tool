/**
 * 빈 상태 — Studio 라이트 톤
 * 절제된 회색 톤, 아이콘 + 메시지 + 액션
 */
import type { ReactNode } from "react";
import Button from "./Button";

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ icon, message, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {icon && (
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-bg-subtle text-text-muted mb-3">
          {icon}
        </div>
      )}
      <p className="text-[14px] text-text-primary font-medium">{message}</p>
      {description && <p className="text-[12px] text-text-muted mt-1 max-w-sm">{description}</p>}
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
