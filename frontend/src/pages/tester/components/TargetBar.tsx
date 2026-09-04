/**
 * 전역 타겟(recording_id) 선택기
 *
 * [해결하는 문제]
 * 기존에는 8개 패널이 각각 "Recording ID" 텍스트 필드를 들고 있었고, 값 채우기는
 * 우하단 플로팅 목록의 [Use] 버튼으로만 가능했음. 그 결과
 *   · 지금 어느 카메라를 조작 중인지 화면 어디에도 고정 표시되지 않고
 *   · 대상의 현재 상태(RUNNING/STOPPED)를 모른 채 Stop 을 누르게 되며
 *   · 여러 카메라에 같은 명령을 걸려면 ID 를 갈아끼우며 N 번 반복해야 했음.
 * 이 바가 페이지 최상단에 고정되어 "대상"을 단일 소스로 관리하고, 다중 선택과
 * 서버 규칙(`[A-Za-z0-9_-]{1,128}`) 검증을 한 곳에서 담당함.
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  XMarkIcon,
  CheckIcon,
} from "@heroicons/react/20/solid";
import StatusBadge from "@/components/StatusBadge";
import type { Recording } from "@/types/recording";
import { identifierError } from "../lib/validation";

/** TargetBar Props */
interface TargetBarProps {
  /** 서버에서 가져온 녹화 목록 */
  recordings: Recording[];
  /** 현재 선택된 대상 목록 */
  targets: string[];
  /** 대상 변경 콜백 */
  setTargets: (ids: string[]) => void;
  /** 최근 사용한 recording_id (localStorage) */
  recentTargets: string[];
  /** 목록 수동 갱신 */
  onRefresh: () => void;
  /** 공통 auth_token */
  authToken: string;
  /** 공통 auth_token 변경 */
  setAuthToken: (token: string) => void;
  /** Ctrl+K 포커스 대상 — 셸이 소유한 ref 를 전달받음 */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** 빠른 폴링 진행 중 여부 — 갱신 아이콘 회전 표시 */
  polling: boolean;
}

/** 녹화 상태 문자열 정규화 — 서버가 enum 숫자를 주는 경우 대비 */
function stateOf(rec: Recording | undefined): string {
  if (!rec) return "UNKNOWN";
  return typeof rec.state === "string" ? rec.state : "UNKNOWN";
}

export default function TargetBar({
  recordings,
  targets,
  setTargets,
  recentTargets,
  onRefresh,
  authToken,
  setAuthToken,
  inputRef,
  polling,
}: TargetBarProps) {
  /** 목록 팝오버 열림 상태 */
  const [open, setOpen] = useState(false);
  /** 팝오버 바깥 클릭 감지용 래퍼 ref */
  const popRef = useRef<HTMLDivElement>(null);

  /** 단일 편집 중인 값 — targets[0] 을 그대로 보여주고, 타이핑 시 단일 선택으로 축약 */
  const single = targets.length === 1 ? targets[0] : "";
  const multi = targets.length > 1;

  /** 팝오버 바깥 클릭 / Esc 로 닫기 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** 체크박스 토글 — 다중 선택 구성 */
  const toggle = (id: string) => {
    setTargets(targets.includes(id) ? targets.filter((t) => t !== id) : [...targets, id]);
  };

  /** 현재 입력값의 서버 규칙 위반 사유 (선택된 대상이 없으면 검증하지 않음) */
  const error = single ? identifierError(single) : null;
  /** 대상이 목록에 실제로 존재하는지 — 오타/삭제된 ID 를 즉시 알아채게 함 */
  const known = single ? recordings.some((r) => r.recording_id === single) : false;
  const currentRec = recordings.find((r) => r.recording_id === single);

  /** RUNNING 상태 전부 선택 — 일괄 Stop/Snapshot 의 가장 흔한 케이스 단축 */
  const selectAllRunning = () => {
    setTargets(recordings.filter((r) => stateOf(r) === "RUNNING").map((r) => r.recording_id));
    setOpen(false);
  };

  return (
    <div className="flex-shrink-0 bg-bg-card border-b border-border">
      {/* ── 1행: 타겟 입력 + 목록 팝오버 + auth_token ── */}
      <div className="flex items-center gap-2 px-4 h-12">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.1em] w-11 shrink-0">
          Target
        </span>

        {/* 단일 대상 입력 — 다중 선택 중에는 비활성화하고 개수만 표시 */}
        <div className="relative w-72 shrink-0">
          <input
            ref={inputRef}
            value={multi ? "" : single}
            placeholder={multi ? `${targets.length}개 선택됨 (아래 칩에서 해제)` : "recording_id 입력 또는 목록에서 선택"}
            disabled={multi}
            onChange={(e) => setTargets(e.target.value ? [e.target.value] : [])}
            className={`w-full h-8 pl-2.5 pr-8 bg-bg-input border rounded-md text-text-primary text-[13px] font-mono transition-colors hover:border-border-strong focus:border-brand placeholder:text-text-muted placeholder:font-sans disabled:bg-bg-subtle disabled:text-text-muted ${
              error ? "border-status-error" : "border-border"
            }`}
          />
          {/* 값 지우기 */}
          {targets.length > 0 && (
            <button
              onClick={() => setTargets([])}
              title="선택 해제"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 녹화 목록 팝오버 */}
        <div className="relative" ref={popRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-white text-[13px] text-text-primary hover:bg-bg-hover hover:border-border-strong transition-colors"
          >
            Recordings
            <span className="tabular text-text-muted">{recordings.length}</span>
            <ChevronDownIcon className="w-4 h-4 text-text-muted" />
          </button>

          {open && (
            <div className="absolute left-0 top-9 z-50 w-[26rem] bg-white border border-border rounded-lg shadow-floating overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
                <span className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.1em]">
                  체크 = 일괄 실행 대상 · 행 클릭 = 단일 선택
                </span>
                <button
                  onClick={selectAllRunning}
                  className="text-[11px] text-brand hover:underline whitespace-nowrap"
                >
                  RUNNING 전체
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto">
                {recordings.length === 0 ? (
                  <p className="text-[12px] text-text-muted px-3 py-6 text-center">
                    녹화가 없습니다. Start Recording 으로 먼저 생성하세요.
                  </p>
                ) : (
                  recordings.map((rec) => {
                    const checked = targets.includes(rec.recording_id);
                    return (
                      <div
                        key={rec.recording_id}
                        className={`flex items-center gap-2 px-3 py-1.5 text-[12px] cursor-pointer transition-colors ${
                          checked ? "bg-brand-soft" : "hover:bg-bg-hover"
                        }`}
                        onClick={() => {
                          setTargets([rec.recording_id]);
                          setOpen(false);
                        }}
                      >
                        {/* 체크박스 — 행 클릭(단일 선택)과 구분하기 위해 전파 차단 */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(rec.recording_id);
                          }}
                          className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                            checked
                              ? "bg-brand border-brand text-white"
                              : "border-border-strong bg-white hover:border-brand"
                          }`}
                        >
                          {checked && <CheckIcon className="w-3 h-3" />}
                        </button>
                        <span className="font-mono truncate flex-1" title={rec.recording_id}>
                          {rec.recording_id}
                        </span>
                        {/* 실측 FPS — 스트림이 실제로 들어오는지 한눈에 */}
                        <span className="tabular text-[11px] text-text-muted w-14 text-right">
                          {rec.jitter?.recent_fps != null
                            ? `${rec.jitter.recent_fps.toFixed(1)} fps`
                            : "—"}
                        </span>
                        <StatusBadge state={stateOf(rec)} />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* 선택 대상의 현재 상태 — Stop 을 눌러도 되는지 판단 근거 */}
        {single && (
          <div className="flex items-center gap-2 min-w-0">
            <StatusBadge state={stateOf(currentRec)} />
            {!known && !error && (
              <span className="text-[11px] text-status-pending whitespace-nowrap">
                목록에 없는 ID
              </span>
            )}
          </div>
        )}
        {multi && (
          <span className="text-[12px] text-brand font-medium whitespace-nowrap">
            {targets.length}개 일괄 실행
          </span>
        )}

        <div className="flex-1" />

        {/* 공통 auth_token — 패널마다 따로 입력하던 필드를 여기로 통합 */}
        <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.1em]">
          auth
        </label>
        <input
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          placeholder="auth_token (optional)"
          className="w-44 h-8 px-2.5 bg-bg-input border border-border rounded-md text-text-primary text-[12px] font-mono hover:border-border-strong focus:border-brand placeholder:text-text-muted placeholder:font-sans"
        />

        {/* 목록 갱신 */}
        <button
          onClick={onRefresh}
          title="녹화 목록 새로고침"
          className="h-8 w-8 flex items-center justify-center rounded-md border border-border bg-white text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <ArrowPathIcon className={`w-4 h-4 ${polling ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ── 2행: 검증 오류 / 다중 선택 칩 / 최근 사용 ── */}
      {(error || multi || (!targets.length && recentTargets.length > 0)) && (
        <div className="flex items-center flex-wrap gap-1.5 px-4 pb-2 -mt-0.5">
          {error && (
            <span className="text-[11px] text-status-error">
              recording_id {error}
            </span>
          )}

          {multi &&
            targets.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-brand-soft text-brand text-[11px] font-mono"
              >
                {id}
                <button
                  onClick={() => toggle(id)}
                  className="hover:text-brand-hover"
                  title="대상에서 제외"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}

          {/* 최근 사용 — 목록 폴링 전이나 서버 재시작 직후에도 바로 되짚어 가게 함 */}
          {!targets.length && recentTargets.length > 0 && (
            <>
              <span className="text-[10px] text-text-muted uppercase tracking-[0.1em] mr-1">
                recent
              </span>
              {recentTargets.map((id) => (
                <button
                  key={id}
                  onClick={() => setTargets([id])}
                  className="px-2 py-0.5 rounded-full bg-bg-subtle text-text-secondary text-[11px] font-mono hover:bg-bg-hover hover:text-text-primary transition-colors"
                >
                  {id}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
