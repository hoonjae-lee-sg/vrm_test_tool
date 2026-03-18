/**
 * 공통 폼 입력 필드 컴포넌트
 * DashboardPage(FormField), TesterPage(Field), LivePage(InputField) 통합
 * - input / select 두 가지 모드 지원
 * - 다크 테마 Tailwind 스타일 적용
 */
import type { ReactNode } from "react";

/** 폼 필드 Props 정의 */
interface FormFieldProps {
  /** 필드 라벨 텍스트 */
  label: string;
  /** 현재 입력값 */
  value: string;
  /** 값 변경 콜백 */
  onChange: (value: string) => void;
  /** 입력 타입 (text, password, number 등) */
  type?: string;
  /** 플레이스홀더 텍스트 */
  placeholder?: string;
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 필수 입력 여부 */
  required?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
  /** select 모드 시 option 요소 (children이 있으면 select로 렌더링) */
  children?: ReactNode;
  /** 유효성 검증 오류 메시지 */
  error?: string;
}

/** 공통 입력 스타일 — 글래스 배경 + 포커스 글로우 + 호버 보더 강조 */
const INPUT_CLASS =
  "w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded text-text-primary text-sm transition-all duration-200 hover:border-white/[0.15] focus:bg-white/[0.06] focus:border-brand/50 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] placeholder:text-text-muted/40";

export default function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
  required,
  className,
  children,
  error,
}: FormFieldProps) {
  /** 오류 상태 시 입력 필드에 적용할 테두리 클래스 */
  const errorBorderClass = error ? " border-status-error" : "";
  return (
    <div className={className}>
      {/* 라벨 — 레터 스페이싱 + 중간 두께 */}
      <label className="text-xs text-text-secondary font-medium tracking-wide mb-1 block">{label}</label>

      {children ? (
        /* select 모드 — children(option 요소)이 있을 때 */
        <select
          className={`${INPUT_CLASS}${errorBorderClass}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={required}
        >
          {children}
        </select>
      ) : (
        /* input 모드 — 기본 텍스트 입력 */
        <input
          type={type}
          className={`${INPUT_CLASS}${errorBorderClass}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
        />
      )}

      {/* 오류 메시지 — error prop이 존재할 때만 표시 */}
      {error && (
        <p className="text-[11px] text-status-error mt-1">{error}</p>
      )}
    </div>
  );
}
