import { NavLink, Outlet } from "react-router-dom";
import {
  Squares2X2Icon,
  WrenchScrewdriverIcon,
  VideoCameraIcon,
  PlayCircleIcon,
  CameraIcon,
  ArrowsPointingInIcon,
} from "@heroicons/react/24/outline";

/**
 * 공통 레이아웃 — 좌측 사이드 nav + 메인 영역
 * Studio 라이트 톤:
 *  - 화이트 사이드바 (240px 고정)
 *  - 섹션 라벨 + 일관된 nav item, 활성 시 indigo soft bg
 *  - 환경 표기(env pill) 하단에
 *  - 메인 영역은 bg-bg-app(off-white)
 */
export default function Layout() {
  /* 네비게이션 항목 — 시안 순서: Dashboard / Live / Snapshot / Sync / API / Playback */
  const navItems = [
    { to: "/", label: "Dashboard", icon: Squares2X2Icon, hint: "Fleet" },
    { to: "/live", label: "Live", icon: VideoCameraIcon, hint: "12-channel wall" },
    { to: "/multi-snapshot", label: "Multi-snapshot", icon: CameraIcon, hint: "ML capture" },
    { to: "/sync-viewer", label: "Sync Lab", icon: ArrowsPointingInIcon, hint: "Drift verify" },
    { to: "/tester", label: "API console", icon: WrenchScrewdriverIcon, hint: "gRPC tester" },
    { to: "/playlist", label: "Playback", icon: PlayCircleIcon, hint: "HLS timeline" },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-bg-app">
      {/* ── 사이드바 ── */}
      <aside className="flex flex-col shrink-0 w-[240px] bg-bg-sidebar border-r border-border">
        {/* 로고 */}
        <div className="h-14 flex items-center gap-2.5 px-5 border-b border-border-subtle">
          <svg viewBox="0 0 40 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[18px]">
            <rect x="0" y="4" width="6" height="16" rx="2" fill="#4F46E5" />
            <rect x="10" y="4" width="6" height="16" rx="2" fill="#4F46E5" />
            <rect x="20" y="4" width="6" height="16" rx="2" fill="#4F46E5" />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight text-text-primary lowercase">
            supergate
          </span>
          <span className="text-[11px] font-semibold tracking-wider text-text-muted ml-auto">VRM</span>
        </div>

        {/* 환경 정보 */}
        <div className="px-5 py-3 border-b border-border-subtle">
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
          <div className="px-5 mb-2 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
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
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors ${
                      isActive
                        ? "bg-brand-soft text-brand"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={`w-4 h-4 ${isActive ? "text-brand" : "text-text-muted"}`} />
                      <span className="text-[13px] font-medium">{item.label}</span>
                      <span
                        className={`ml-auto text-[10px] ${
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
        <div className="px-5 py-3 border-t border-border-subtle text-[11px] text-text-muted tabular">
          v1.0.0 · build 2026.04
        </div>
      </aside>

      {/* ── 메인 영역 ── */}
      <main className="flex-1 overflow-y-auto bg-bg-app">
        <Outlet />
      </main>
    </div>
  );
}
