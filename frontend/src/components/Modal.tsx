/**
 * 공통 모달 — Studio 라이트 톤
 *
 * [2026-09 수정 — z-index 스택 결함]
 * · 기존에는 오버레이가 `z-50` 하드코딩이었음. DashboardPage 의 프리셋 드로어가
 *   `fixed inset-0 z-[60]` 이라, 드로어 안에서 여는 "프리셋 삭제" ConfirmDialog 가
 *   드로어 scrim(z-60) 아래로 깔려 버튼이 히트테스트에서 잡히지 않았음
 *   (elementFromPoint → 드로어 scrim). 즉 프리셋 삭제가 UI 로 불가능했음.
 * · 해결: **열린 순서대로 z 를 부여하는 모달 스택**을 도입함.
 *   - 첫 번째 모달  z=50  (녹화 시작 모달) — 드로어(60)보다 아래여야 드로어가 그 위에 뜸
 *   - 두 번째 모달  z=70  (드로어에서 띄운 확인 다이얼로그) — 드로어(60) 위로 올라옴
 *   step 을 20 으로 잡은 이유: 페이지 레이어(드로어 z-60)가 첫 모달과 둘째 모달 사이에
 *   끼어 있는 현재 구조를 그대로 살리면서, 둘째 모달이 반드시 그 위에 오도록 하기 위함.
 *   z 값은 인라인 style 로 주입하므로 클래스 `z-50` 보다 항상 우선함.
 * · `z-50` 클래스는 **의도적으로 남겨 둠** — TesterPage 의 단축키 가드가
 *   `document.querySelector(".fixed.inset-0.z-50")` 로 모달 열림을 판별하기 때문.
 *   해당 파일을 건드리지 않고 호환을 유지하려는 목적이며, 실제 z 는 인라인 style 이 결정함.
 * · createPortal(document.body) — 조상에 transform/filter 가 걸리면 `position:fixed` 가
 *   그 조상 기준으로 바뀌어 오버레이가 화면을 덮지 못하는 문제를 사전 차단함.
 * · role="dialog" / aria-modal — 보조기술이 모달 컨텍스트를 인지하도록 함.
 */
import { useEffect, useCallback, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/20/solid";

/** 최하위 모달의 z-index — 기존 `z-50` 과 동일하게 유지(드로어 z-60 이 그 위) */
const MODAL_BASE_Z = 50;
/** 모달이 하나 겹칠 때마다 더할 z 증분 — 페이지 레이어(z-60)를 건너뛸 수 있는 폭 */
const MODAL_Z_STEP = 20;

/** 현재 열려 있는 모달 수 — 열린 순서대로 z 를 배정하기 위한 모듈 전역 카운터 */
let openModalDepth = 0;

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
  headerExtra?: ReactNode;
  /** z-index 강제 지정 — 미지정 시 열린 순서 기반 스택 값 사용 */
  zIndex?: number;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
  headerExtra,
  zIndex,
}: ModalProps) {
  /** 스택에서 배정받은 z-index — 열릴 때 확정됨 */
  const [stackZ, setStackZ] = useState(MODAL_BASE_Z);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  /* 열림/닫힘에 맞춰 스택 깊이를 증감하고 z 를 배정함.
     useLayoutEffect 를 쓰는 이유: paint 이전에 z 가 확정되어야 첫 프레임에서
     잘못된 층위로 깜빡이는 것을 막을 수 있음. */
  useLayoutEffect(() => {
    if (!isOpen) return;
    setStackZ(MODAL_BASE_Z + openModalDepth * MODAL_Z_STEP);
    openModalDepth += 1;
    return () => {
      openModalDepth = Math.max(0, openModalDepth - 1);
    };
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      /* `z-50` 클래스는 TesterPage 단축키 가드 셀렉터 호환용 잔존 — 실제 값은 style 이 결정 */
      className="fixed inset-0 bg-text-primary/20 backdrop-blur-sm flex items-center justify-center z-50"
      style={{ zIndex: zIndex ?? stackZ }}
      data-modal-overlay=""
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white border border-border rounded-xl p-6 w-full ${maxWidth} shadow-floating animate-scale-in`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-subtle">
          <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
          <div className="flex items-center gap-2">
            {headerExtra}
            <button
              onClick={onClose}
              aria-label="닫기"
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
