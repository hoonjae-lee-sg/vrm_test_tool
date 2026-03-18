/**
 * 공통 버튼 컴포넌트
 * 4가지 variant(primary, secondary, destructive, ghost)와
 * 3가지 size(sm, md, lg) 조합으로 일관된 버튼 스타일 제공
 * - isLoading 상태 시 스피너 표시 및 자동 비활성화
 * - disabled 상태 시 반투명 처리
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** 버튼 Props 정의 */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 버튼 스타일 변형 (기본: primary) */
  variant?: "primary" | "secondary" | "destructive" | "ghost";
  /** 버튼 크기 (기본: md) */
  size?: "sm" | "md" | "lg";
  /** 로딩 상태 — true 시 스피너 표시 및 비활성화 */
  isLoading?: boolean;
  /** 버튼 내부 콘텐츠 */
  children: ReactNode;
}

/** variant별 색상/배경 스타일 매핑 — 그래디언트 + 네온 글로우 효과 */
const VARIANT_STYLES: Record<string, string> = {
  primary: "bg-gradient-to-r from-brand to-blue-500 text-white hover:shadow-[0_0_20px_rgba(59,130,246,0.3)] active:scale-[0.98]",
  secondary: "bg-white/5 border border-white/10 text-text-secondary hover:bg-white/10 hover:border-white/20 active:scale-[0.98]",
  destructive: "bg-status-error text-white hover:bg-status-error/80 hover:shadow-[0_0_20px_rgba(239,68,68,0.3)] active:scale-[0.98]",
  ghost: "text-text-secondary hover:bg-white/5 active:scale-[0.98]",
};

/** size별 패딩/폰트/라운드 스타일 매핑 */
const SIZE_STYLES: Record<string, string> = {
  sm: "text-xs px-3 py-1.5 rounded",
  md: "text-sm px-4 py-2 rounded-lg",
  lg: "text-base px-6 py-2.5 rounded-lg font-semibold",
};

export default function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  /** 로딩 중이면 강제 비활성화 */
  const isDisabled = disabled || isLoading;

  return (
    <button
      className={[
        "inline-flex items-center justify-center transition-all duration-200",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        isDisabled && "opacity-50 cursor-not-allowed",
        isLoading && "opacity-70",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={isDisabled}
      {...rest}
    >
      {/* 로딩 인디케이터 — 3개 바운스 도트 애니메이션 */}
      {isLoading && (
        <span className="flex gap-1 mr-2">
          <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:300ms]" />
        </span>
      )}
      {children}
    </button>
  );
}
