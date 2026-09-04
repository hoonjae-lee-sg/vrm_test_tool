/**
 * Tester 페이지 레이아웃 셸 — gRPC API 개별 테스트 "리모콘 패널"
 *
 * [구조]
 *  ┌───────────────────────────────────────────────────────────┐
 *  │ TargetBar — 전역 recording_id 선택기(단일/다중) + auth_token │
 *  ├────────┬──────────────────────────┬───────────────────────┤
 *  │ 메뉴   │ 선택된 API 패널           │ Response log          │
 *  └────────┴──────────────────────────┴───────────────────────┘
 *
 * [기존 대비 바뀐 점]
 * · recording_id 를 패널마다 입력하던 구조를 TargetBar 단일 소스로 통합하고,
 *   다중 선택 시 모든 패널이 순차 일괄 실행되도록 함.
 * · 우하단 플로팅 녹화 목록은 TargetBar 팝오버로 흡수(같은 정보의 중복 제거).
 * · 실행/로깅/에러추출을 useApiRunner 로 일원화 — 소요 시간과 요청/응답 짝이 남음.
 * · 키보드 단축키 도입(Ctrl+Enter 실행, Ctrl+K 타겟, Ctrl+L 로그 비우기, 1~9 패널 전환).
 * · 녹화 목록 폴링 주기를 상황에 따라 가변 — Start/Stop 직후에는 1초로 당겨
 *   PENDING→RUNNING→STOPPED 전이를 즉시 확인할 수 있게 함(비동기 Start 대응).
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import { TESTER_REFRESH_INTERVAL_MS } from "@/constants";
import Toast from "@/components/Toast";
import { QuestionMarkCircleIcon, CommandLineIcon } from "@heroicons/react/24/outline";

import LogViewer from "./components/LogViewer";
import TargetBar from "./components/TargetBar";
import ShortcutHelp from "./components/ShortcutHelp";
import { useApiRunner } from "./hooks/useApiRunner";
import { isValidIdentifier } from "./lib/validation";
import { loadAuthToken, saveAuthToken, loadRecentTargets, pushRecentTarget } from "./lib/presets";
import type { LogEntry, TesterCtx } from "./types";

/* 패널 컴포넌트 임포트 */
import StartPanel from "./panels/StartPanel";
import StopPanel from "./panels/StopPanel";
import RestartPanel from "./panels/RestartPanel";
import StatusPanel from "./panels/StatusPanel";
import SnapshotPanel from "./panels/SnapshotPanel";
import EventClipPanel from "./panels/EventClipPanel";
import SimpleClipPanel from "./panels/SimpleClipPanel";
import HealthPanel from "./panels/HealthPanel";

/* ────────────────── API 메뉴 정의 ────────────────── */

/** API 패널 식별 타입 */
type ApiPanel =
  | "start"
  | "stop"
  | "restart"
  | "status"
  | "event-start"
  | "event-stop"
  | "clip"
  | "snapshot"
  | "health";

/** 사이드바 메뉴 항목 — 배열 순서가 곧 1~9 단축키 번호임 */
const API_MENU: { id: ApiPanel; label: string; method: string }[] = [
  { id: "start", label: "Start Recording", method: "POST" },
  { id: "stop", label: "Stop Recording", method: "POST" },
  { id: "restart", label: "Restart Recording", method: "POST" },
  { id: "status", label: "Check Status", method: "GET" },
  { id: "event-start", label: "Start Event Clip", method: "POST" },
  { id: "event-stop", label: "Stop Event Clip", method: "POST" },
  { id: "clip", label: "Create Clip", method: "POST" },
  { id: "snapshot", label: "Take Snapshot", method: "POST" },
  { id: "health", label: "Check Health", method: "GET" },
];

/** 로그 보관 상한 — DOM 노드 폭증 방지 (오래된 것부터 버림) */
const MAX_LOGS = 300;

/** 빠른 폴링 주기 — 상태 전이 관찰용 */
const FAST_POLL_INTERVAL_MS = 1000;

/* ────────────────── 메인 컴포넌트 ────────────────── */
export default function TesterPage() {
  /** 녹화 목록 폴링 주기 — fastPoll 로 일시 단축됨 */
  const [pollMs, setPollMs] = useState(TESTER_REFRESH_INTERVAL_MS);
  /** 녹화 목록 자동 갱신 훅 */
  const { recordings, refresh } = useRecordings(pollMs);
  /** 토스트 알림 훅 */
  const { toast, showToast } = useToast();

  /** 현재 선택된 API 패널 */
  const [activePanel, setActivePanel] = useState<ApiPanel>("start");
  /** 단축키 도움말 모달 */
  const [helpOpen, setHelpOpen] = useState(false);
  /**
   * xl 미만에서 로그를 하단 드로어로 볼지 여부.
   * 고정 3단(240+224+432=896px)이 안 줄어 1024px 에서 중앙 폼이 80px 로 찌그러졌으므로,
   * xl(1280px) 미만에서는 우측 로그 컬럼을 걷어내고 필요할 때만 하단에서 올려 봄.
   */
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);

  /** 로그 목록 */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  /** 로그 ID 카운터 */
  const logIdRef = useRef(0);

  /** 전역 타겟 목록 — 모든 패널이 이 값을 대상으로 실행됨 */
  const [targets, setTargets] = useState<string[]>([]);
  /** 최근 사용한 recording_id (localStorage) */
  const [recentTargets, setRecentTargets] = useState<string[]>(() => loadRecentTargets());
  /** 모든 패널이 공유하는 auth_token */
  const [authToken, setAuthTokenState] = useState<string>(() => loadAuthToken());

  /** Ctrl+K 로 포커스할 타겟 입력 ref */
  const targetInputRef = useRef<HTMLInputElement>(null);
  /** 현재 패널의 실행 함수 — Ctrl+Enter 가 호출 */
  const submitRef = useRef<(() => void) | null>(null);
  /** fastPoll 종료 타이머 */
  const fastPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 패널이 자기 실행 함수를 등록/해제 */
  const registerSubmit = useCallback((fn: (() => void) | null) => {
    submitRef.current = fn;
  }, []);

  /** auth_token 변경 — 다음 방문에도 유지되도록 localStorage 반영 */
  const setAuthToken = useCallback((token: string) => {
    setAuthTokenState(token);
    saveAuthToken(token);
  }, []);

  /**
   * 로그 추가.
   * 실행된 대상(target)이 유효 식별자면 "최근 사용" 목록에도 반영함 —
   * 입력 도중의 미완성 문자열이 들어가지 않도록 "실행 시점"에만 기록함.
   */
  const pushLog = useCallback((entry: Omit<LogEntry, "id" | "time">) => {
    const time = new Date().toLocaleTimeString("en-GB");
    setLogs((prev) => {
      const next = [...prev, { ...entry, id: ++logIdRef.current, time }];
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
    });
    if (entry.target && isValidIdentifier(entry.target)) {
      setRecentTargets(pushRecentTarget(entry.target));
    }
  }, []);

  /** API 실행기 */
  const runner = useApiRunner(pushLog);

  /**
   * 일정 시간 동안 녹화 목록을 빠르게 폴링.
   * RecordStart 가 비동기 탐색으로 바뀌어 응답은 즉시 오지만 상태는 PENDING 으로
   * 시작해 잠시 뒤 RUNNING 이 됨. 기본 5초 폴링으로는 전이가 늦게 보이므로
   * 명령 직후에만 1초로 당겼다가 원복함.
   */
  const fastPoll = useCallback((durationMs = 12000) => {
    setPollMs(FAST_POLL_INTERVAL_MS);
    if (fastPollTimerRef.current) clearTimeout(fastPollTimerRef.current);
    fastPollTimerRef.current = setTimeout(
      () => setPollMs(TESTER_REFRESH_INTERVAL_MS),
      durationMs
    );
  }, []);

  /** 언마운트 시 fastPoll 타이머 정리 */
  useEffect(() => {
    return () => {
      if (fastPollTimerRef.current) clearTimeout(fastPollTimerRef.current);
    };
  }, []);

  /** sessionStorage 의 target_id 로드 (Dashboard 에서 넘어온 경우) */
  useEffect(() => {
    const targetId = sessionStorage.getItem("target_id");
    if (targetId) {
      setTargets([targetId]);
      sessionStorage.removeItem("target_id");
    }
  }, []);

  /** 전역 단축키 — 입력 중에는 숫자/문자 단축키를 비활성화해 타이핑을 방해하지 않음 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const editing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "SELECT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);

      /* 조합키 단축키는 입력 중에도 동작해야 함 (폼을 채우다 바로 실행하는 흐름) */
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "Enter") {
          e.preventDefault();
          submitRef.current?.();
        } else if (e.key === "k" || e.key === "K") {
          e.preventDefault();
          targetInputRef.current?.focus();
          targetInputRef.current?.select();
        } else if (e.key === "l" || e.key === "L") {
          e.preventDefault();
          setLogs([]);
        }
        return;
      }
      if (e.altKey || editing) return;

      /* 모달(ConfirmDialog / 단축키 도움말)이 열려 있으면 단일키 단축키를 무시함.
         확인 다이얼로그 뒤에서 패널이 바뀌어 "무엇을 확인했는지" 가 어긋나는 혼란을 막기 위함.
         공용 Modal 의 오버레이 클래스(fixed inset-0 z-50)로 판별 — Modal 을 수정하지 않고
         감지하기 위한 선택이며, 클래스가 바뀌어도 단축키가 살아있을 뿐 기능은 깨지지 않음. */
      if (document.querySelector(".fixed.inset-0.z-50")) return;

      if (e.key === "?") {
        setHelpOpen(true);
        return;
      }
      if (e.key === "r" || e.key === "R") {
        refresh();
        return;
      }
      /* 1~9 → 메뉴 순서대로 패널 전환 */
      const index = Number(e.key);
      if (Number.isInteger(index) && index >= 1 && index <= API_MENU.length) {
        setActivePanel(API_MENU[index - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh]);

  /** 패널에 넘길 공통 컨텍스트 */
  const ctx: TesterCtx = useMemo(
    () => ({
      targets,
      primaryTarget: targets[0] ?? "",
      recordings,
      setTargets,
      runner,
      refresh,
      fastPoll,
      showToast,
      authToken,
      registerSubmit,
    }),
    [targets, recordings, runner, refresh, fastPoll, showToast, authToken, registerSubmit]
  );

  /** 실패 로그 수 — 하단 드로어 진입 버튼 배지 */
  const failCount = logs.filter((l) => !l.ok).length;

  return (
    /* h-full — Layout <main> 이 높이를 확정하므로 calc(100vh-56px) 불필요.
       min-h-0 없이는 내부 flex-1 컬럼이 스크롤되지 않고 부모를 밀어냄 */
    <div className="flex flex-col h-full min-h-0 relative">
      {/* ── 상단: 전역 타겟 선택기 ──
          TargetBar 내부는 고정폭(w-72 입력 + w-44 토큰)이라 390px 에서 745px 를 요구함.
          그 넘침이 페이지 루트까지 전파되지 않도록 자체 가로 스크롤 스트립으로 감쌈 —
          TargetBar 자체는 다른 그룹 담당 파일이므로 손대지 않고 담는 그릇만 조정 */}
      <div className="shrink-0 overflow-x-auto">
      <TargetBar
        recordings={recordings}
        targets={targets}
        setTargets={setTargets}
        recentTargets={recentTargets}
        onRefresh={refresh}
        authToken={authToken}
        setAuthToken={setAuthToken}
        inputRef={targetInputRef}
        polling={pollMs === FAST_POLL_INTERVAL_MS}
      />
      </div>

      {/* md 미만에서는 좌측 메뉴가 상단 가로 탭으로 바뀌므로 컬럼 방향을 전환 */}
      <div className="flex flex-1 min-h-0 min-w-0 flex-col md:flex-row overflow-hidden">
        {/* ── 좌측: API 메뉴 사이드바 ──
            md 미만: 가로 스크롤 탭(폭을 점유하지 않음) / md 이상: 세로 사이드바 */}
        <div className="shrink-0 md:w-48 lg:w-56 bg-bg-card border-b md:border-b-0 md:border-r border-border md:overflow-y-auto flex flex-col min-w-0">
          <div className="px-3 py-2 md:py-4 flex-1 min-w-0">
            <h3 className="hidden md:block text-[10px] font-semibold text-text-muted uppercase tracking-[0.1em] px-2 mb-2.5">
              API methods
            </h3>
            {/* 모바일: 가로 스크롤 · 데스크톱: 세로 스택 */}
            <nav className="flex flex-row md:flex-col gap-1 md:gap-0.5 overflow-x-auto md:overflow-x-visible">
              {API_MENU.map((item, i) => (
                <button
                  key={item.id}
                  onClick={() => setActivePanel(item.id)}
                  /* 활성 시 다크 반전 배경 — Studio 톤 유지.
                     모바일 탭에서는 라벨이 줄바꿈되지 않도록 nowrap + shrink-0 */
                  className={`text-left px-2.5 py-2 rounded-md text-[13px] transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 md:w-full ${
                    activePanel === item.id
                      ? "bg-text-primary text-bg-app font-medium"
                      : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                >
                  <span
                    className={`font-mono text-[9px] font-bold tabular w-9 shrink-0 ${
                      activePanel === item.id ? "opacity-70" : "text-text-muted"
                    }`}
                  >
                    {item.method}
                  </span>
                  <span className="truncate md:flex-1">{item.label}</span>
                  {/* 단축키 번호 — 외우지 않아도 보이게 (모바일 탭에서는 생략) */}
                  <span
                    className={`hidden md:inline font-mono text-[9px] tabular ${
                      activePanel === item.id ? "opacity-50" : "text-text-muted/70"
                    }`}
                  >
                    {i + 1}
                  </span>
                </button>
              ))}
            </nav>
          </div>

          {/* 단축키 도움말 진입점 — 물리 키보드가 있는 md 이상에서만 의미 있음 */}
          <button
            onClick={() => setHelpOpen(true)}
            className="hidden md:flex items-center gap-1.5 px-5 py-3 text-[11px] text-text-muted hover:text-text-primary border-t border-border-subtle transition-colors whitespace-nowrap"
          >
            <QuestionMarkCircleIcon className="w-4 h-4" />
            단축키 보기 (?)
          </button>
        </div>

        {/* ── 중앙: 선택된 API 폼 패널 ── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex justify-center">
          <div className="w-full max-w-2xl pb-16 xl:pb-12">
            {activePanel === "start" && <StartPanel ctx={ctx} />}
            {activePanel === "stop" && <StopPanel ctx={ctx} />}
            {activePanel === "restart" && <RestartPanel ctx={ctx} />}
            {activePanel === "status" && <StatusPanel ctx={ctx} />}
            {activePanel === "event-start" && <EventClipPanel mode="start" ctx={ctx} />}
            {activePanel === "event-stop" && <EventClipPanel mode="stop" ctx={ctx} />}
            {activePanel === "clip" && <SimpleClipPanel ctx={ctx} />}
            {activePanel === "snapshot" && <SnapshotPanel ctx={ctx} />}
            {activePanel === "health" && <HealthPanel ctx={ctx} />}
          </div>
        </div>

        {/* ── 우측: Response 로그 뷰어 — xl 이상에서만 고정 컬럼 ── */}
        <LogViewer
          logs={logs}
          onClear={() => setLogs([])}
          className="hidden xl:flex w-[27rem] flex-shrink-0 border-l border-border"
        />
      </div>

      {/* ── xl 미만: 로그 하단 드로어 + 진입 버튼 ──
          중앙 폼 폭을 잡아먹지 않으면서도 응답 확인 경로를 남기기 위한 구성 */}
      {!logDrawerOpen && (
        <button
          onClick={() => setLogDrawerOpen(true)}
          className="xl:hidden absolute bottom-4 right-4 z-30 flex items-center gap-1.5 h-9 px-3 rounded-full bg-[#0E1116] text-white/90 text-[12px] font-medium shadow-floating hover:bg-[#171c24] transition-colors"
        >
          <CommandLineIcon className="w-4 h-4" />
          로그
          <span className="tabular text-[11px] text-white/50">{logs.length}</span>
          {failCount > 0 && (
            <span className="tabular text-[11px] text-red-300">·{failCount}</span>
          )}
        </button>
      )}
      {logDrawerOpen && (
        <LogViewer
          logs={logs}
          onClear={() => setLogs([])}
          onClose={() => setLogDrawerOpen(false)}
          className="xl:hidden absolute inset-x-0 bottom-0 z-30 h-[55%] border-t border-border shadow-floating"
        />
      )}

      {/* 단축키 도움말 */}
      <ShortcutHelp isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* 토스트 알림 */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
