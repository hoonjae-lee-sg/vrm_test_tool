/**
 * 단축키 도움말 모달
 * 공용 Modal 을 그대로 쓰고 목록만 채움 — 단축키를 외우지 못해도 `?` 로 즉시 확인 가능.
 */
import Modal from "@/components/Modal";

/** ShortcutHelp Props */
interface ShortcutHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 단축키 정의 — TesterPage 의 키 핸들러와 1:1 대응 (변경 시 양쪽 함께 수정) */
export const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "Ctrl + Enter", desc: "현재 패널 실행" },
  { keys: "Ctrl + K", desc: "Target 입력으로 포커스" },
  { keys: "Ctrl + L", desc: "응답 로그 비우기" },
  { keys: "1 … 9", desc: "API 패널 전환 (입력 중이 아닐 때)" },
  { keys: "R", desc: "녹화 목록 새로고침 (입력 중이 아닐 때)" },
  { keys: "?", desc: "이 도움말 열기" },
  { keys: "Esc", desc: "모달/팝오버 닫기" },
];

export default function ShortcutHelp({ isOpen, onClose }: ShortcutHelpProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="키보드 단축키" maxWidth="max-w-sm">
      <ul className="divide-y divide-border-subtle">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className="flex items-center justify-between py-2">
            <span className="text-[12px] text-text-secondary">{s.desc}</span>
            <kbd className="px-2 py-0.5 rounded border border-border bg-bg-subtle font-mono text-[11px] text-text-primary">
              {s.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
