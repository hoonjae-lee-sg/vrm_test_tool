import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Squares2X2Icon,
  WrenchScrewdriverIcon,
  VideoCameraIcon,
  PlayCircleIcon,
  CameraIcon,
  ArrowsPointingInIcon,
  BoltIcon,
  Bars3Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

/**
 * 공통 레이아웃 — 좌측 사이드 nav + 메인 영역
 * Studio 라이트 톤:
 *  - 화이트 사이드바
 *  - 섹션 라벨 + 일관된 nav item, 활성 시 indigo soft bg
 *  - 환경 표기(env pill) 하단에
 *  - 메인 영역은 bg-bg-app(off-white)
 *
 * [반응형 3단 구성 — 1024px 이하 전 페이지 붕괴의 루트 원인 제거]
 *  · < md(768px)  : 사이드바를 화면 밖으로 밀어낸 오프캔버스 드로어. 상단 모바일 바의
 *                   햄버거로 열고, 오버레이 클릭·라우트 이동 시 닫힘.
 *                   → 본문이 사이드바 240px 를 빼앗기지 않고 전체 폭 확보.
 *  · md ~ lg      : 아이콘 전용 레일(w-16). 라벨/힌트/환경/푸터를 `md:hidden lg:*` 로 감춰
 *                   768~1023px 구간에서 본문에 176px 를 되돌려줌.
 *  · >= lg(1024px): 기존 240px 풀 사이드바 — 데스크톱 시안 그대로 유지.
 *
 *  드로어가 열렸을 때는 `md:hidden` 이 아니라 폭 240px 를 그대로 쓰므로,
 *  라벨 표시 조건은 "기본 노출 → md 에서 감춤 → lg 에서 재노출"(`md:hidden lg:block`) 형태임.
 *
 * [가로 스크롤 확보]
 *  루트의 `overflow-hidden` 이 390px 에서 화면 밖 콘텐츠 도달을 원천 차단했으므로 제거하고,
 *  본문 <main> 에 `overflow-auto` + `min-w-0` 을 부여함. 세로 스크롤은 유지하되
 *  최소 폭을 넘는 콘텐츠는 가로 스크롤로 도달 가능해짐.
 */
export default function Layout() {
  /* 네비게이션 항목 — 시안 순서: Dashboard / Live / Snapshot / Sync / Event / API / Playback */
  const navItems = [
    { to: "/", label: "Dashboard", icon: Squares2X2Icon, hint: "Fleet" },
    { to: "/live", label: "Live", icon: VideoCameraIcon, hint: "12-channel wall" },
    { to: "/multi-snapshot", label: "Multi-snapshot", icon: CameraIcon, hint: "ML capture" },
    { to: "/sync-viewer", label: "Sync Lab", icon: ArrowsPointingInIcon, hint: "Drift verify" },
    /* 이벤트 클립 테스트 — Sync Lab(검증 계열) 과 API console(도구 계열) 사이에 둠 */
    { to: "/event-clip", label: "Event clip", icon: BoltIcon, hint: "Trigger test" },
    { to: "/tester", label: "API console", icon: WrenchScrewdriverIcon, hint: "gRPC tester" },
    { to: "/playlist", label: "Playback", icon: PlayCircleIcon, hint: "HLS timeline" },
  ];

  /* 모바일 드로어 열림 상태 — md 이상에서는 사용되지 않음 */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  /* 라우트 이동 시 드로어 자동 닫힘 — 메뉴를 고른 뒤 오버레이가 남아 조작을 막는 것을 방지 */
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  /* 현재 경로에 해당하는 메뉴 라벨 — 모바일 상단 바 제목으로 사용 */
  const currentLabel =
    navItems.find((n) => (n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)))
      ?.label ?? "VRM";

  return (
    <div className="flex h-screen bg-bg-app">
      {/* ── 모바일 드로어 오버레이 — md 이상에서는 렌더 자체를 하지 않음 ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── 사이드바 ──
          md 미만: fixed 오프캔버스(translate-x)로 본문 폭을 점유하지 않음
          md 이상: static 레일/풀 사이드바 */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[240px] flex flex-col shrink-0 bg-bg-sidebar border-r border-border
          transition-transform duration-200 ease-out
          md:static md:z-auto md:w-16 md:translate-x-0 lg:w-[240px]
          ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* 로고 — 레일(md~lg)에서는 아이콘만 남기고 가운데 정렬 */}
        <div className="h-14 flex items-center gap-2.5 px-5 md:px-0 md:justify-center lg:px-5 lg:justify-start border-b border-border-subtle shrink-0">
          <svg viewBox="0 0 40 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[18px] shrink-0">
            <rect x="0" y="4" width="6" height="16" rx="2" fill="#4F46E5" />
            <rect x="10" y="4" width="6" height="16" rx="2" fill="#4F46E5" />
            <rect x="20" y="4" width="6" height="16" rx="2" fill="#4F46E5" />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight text-text-primary lowercase md:hidden lg:inline">
            supergate
          </span>
          <span className="text-[11px] font-semibold tracking-wider text-text-muted ml-auto md:hidden lg:inline">
            VRM
          </span>
          {/* 드로어 닫기 — 모바일에서만 노출 */}
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="메뉴 닫기"
            className="md:hidden ml-1 h-7 w-7 inline-flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* 환경 정보 — 레일 폭(64px)에는 들어가지 않으므로 md 구간에서만 숨김 */}
        <div className="px-5 py-3 border-b border-border-subtle md:hidden lg:block shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
            Environment
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-text-primary font-medium">staging</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-status-running">
              <span className="w-1.5 h-1.5 rounded-full bg-status-running animate-breathe" />
              healthy
            </span>
          </div>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 overflow-y-auto py-3">
          <div className="px-5 mb-2 text-[10px] uppercase tracking-wider text-text-muted font-semibold md:hidden lg:block">
            Workspace
          </div>
          <div className="px-2 flex flex-col gap-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  /* 레일 구간에서는 아이콘만 남으므로 title 로 라벨을 보조 제공 */
                  title={item.label}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors md:justify-center md:px-0 lg:justify-start lg:px-3 ${
                      isActive
                        ? "bg-brand-soft text-brand"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-brand" : "text-text-muted"}`} />
                      <span className="text-[13px] font-medium md:hidden lg:inline">{item.label}</span>
                      <span
                        className={`ml-auto text-[10px] md:hidden lg:inline ${
                          isActive ? "text-brand/70" : "text-text-muted"
                        }`}
                      >
                        {item.hint}
                      </span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* 푸터 — 버전 */}
        <div className="px-5 py-3 border-t border-border-subtle text-[11px] text-text-muted tabular md:hidden lg:block shrink-0">
          v1.0.0 · build 2026.04
        </div>
      </aside>

      {/* ── 메인 컬럼 — 모바일 상단 바 + 본문 ──
          min-w-0 이 없으면 내부 고정폭 콘텐츠가 flex 아이템을 밀어 화면 밖으로 넘침 */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 모바일 상단 바 — 드로어 진입점. md 이상에서는 사이드바가 상시 노출되므로 숨김 */}
        <header className="md:hidden h-14 shrink-0 flex items-center gap-2 px-4 bg-bg-sidebar border-b border-border">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="메뉴 열기"
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <Bars3Icon className="w-5 h-5" />
          </button>
          <span className="text-[14px] font-semibold tracking-tight text-text-primary truncate">
            {currentLabel}
          </span>
          <span className="ml-auto text-[11px] font-semibold tracking-wider text-text-muted">VRM</span>
        </header>

        <main className="flex-1 min-w-0 overflow-auto bg-bg-app">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
