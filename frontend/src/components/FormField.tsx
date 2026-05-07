/**
 * 공통 폼 입력 필드 — Studio 라이트 톤
 * input / select 두 가지 모드 지원
 */
import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  children?: ReactNode;
  error?: string;
}

const INPUT_CLASS =
  "w-full h-9 px-3 bg-bg-input border border-border rounded-md text-text-primary text-[13px] transition-colors hover:border-border-strong focus:border-brand placeholder:text-text-muted";

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
  const errorBorderClass = error ? " border-status-error" : "";
  return (
    <div className={className}>
      <label className="text-[11px] text-text-secondary font-medium tracking-wide mb-1 block">
        {label}
      </label>

      {children ? (
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

      {error && <p className="text-[11px] text-status-error mt-1">{error}</p>}
    </div>
  );
}
