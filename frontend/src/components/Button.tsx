/**
 * 공통 버튼 — Studio 라이트 톤
 * variant: primary (indigo) / secondary (white border) / destructive / ghost
 * size: sm / md / lg
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "destructive" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  children: ReactNode;
}

const VARIANT_STYLES: Record<string, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-hover shadow-sm focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  secondary:
    "bg-white text-text-primary border border-border hover:bg-bg-hover hover:border-border-strong",
  destructive:
    "bg-status-error text-white hover:bg-red-700 shadow-sm",
  ghost:
    "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
};

const SIZE_STYLES: Record<string, string> = {
  sm: "text-[12px] h-7 px-2.5 rounded-md gap-1.5",
  md: "text-[13px] h-8 px-3 rounded-md gap-1.5",
  lg: "text-[14px] h-10 px-4 rounded-lg gap-2 font-semibold",
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
  const isDisabled = disabled || isLoading;

  return (
    <button
      className={[
        "inline-flex items-center justify-center font-medium transition-colors duration-150 outline-none",
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
      {isLoading && (
        <span className="flex gap-1">
          <span className="w-1 h-1 bg-current rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-1 h-1 bg-current rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-1 h-1 bg-current rounded-full animate-bounce [animation-delay:300ms]" />
        </span>
      )}
      {children}
    </button>
  );
}
