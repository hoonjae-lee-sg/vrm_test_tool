/**
 * 확인 다이얼로그 컴포넌트
 * Modal 컴포넌트 기반의 확인/취소 선택 다이얼로그
 * - variant로 일반(primary) / 위험(destructive) 스타일 구분
 * - isLoading 상태 시 확인 버튼에 스피너 표시
 */
import Modal from "./Modal";
import Button from "./Button";

/** 확인 다이얼로그 Props 정의 */
interface ConfirmDialogProps {
  /** 다이얼로그 표시 여부 */
  isOpen: boolean;
  /** 확인 버튼 클릭 콜백 */
  onConfirm: () => void;
  /** 취소 버튼 클릭 콜백 */
  onCancel: () => void;
  /** 다이얼로그 제목 */
  title: string;
  /** 안내 메시지 */
  message: string;
  /** 확인 버튼 텍스트 (기본: "확인") */
  confirmLabel?: string;
  /** 취소 버튼 텍스트 (기본: "취소") */
  cancelLabel?: string;
  /** 확인 버튼 스타일 변형 (기본: primary) */
  variant?: "primary" | "destructive";
  /** 로딩 상태 — 확인 버튼에 스피너 표시 */
  isLoading?: boolean;
}

export default function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  variant = "primary",
  isLoading = false,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} maxWidth="max-w-sm">
      {/* 안내 메시지 — 중앙 정렬 */}
      <p className="text-sm text-text-secondary text-center py-4">{message}</p>

      {/* 하단 버튼 영역 — 취소(좌) | 확인(우) 배치 */}
      <div className="flex gap-3 mt-2">
        <Button
          variant="secondary"
          size="md"
          className="flex-1"
          onClick={onCancel}
          disabled={isLoading}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={variant}
          size="md"
          className="flex-1"
          onClick={onConfirm}
          isLoading={isLoading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
