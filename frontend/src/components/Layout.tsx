import { NavLink, Outlet } from "react-router-dom";

/**
 * 공통 레이아웃 — 상단 헤더 네비게이션 + 콘텐츠 영역
 * 기존 supergate VRM 디자인을 유지
 */
export default function Layout() {
  /* 네비게이션 항목 정의 */
  const navItems = [
    { to: "/", label: "Dashboard" },
    { to: "/multi-snapshot", label: "Multi-Snapshot" },
    { to: "/tester", label: "Tester" },
    { to: "/playlist", label: "Playlist" },
    { to: "/live", label: "Live Grid" },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* 상단 헤더 */}
      <header className="flex items-center justify-between px-6 h-[60px] bg-bg-sidebar border-b border-border-subtle shrink-0 z-10">
        {/* 로고 */}
        <div className="flex items-center gap-2 font-semibold text-lg text-text-primary">
          <svg
            viewBox="0 0 40 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-10 h-6"
          >
            <rect x="0" y="4" width="6" height="16" rx="3" fill="#3B82F6" />
            <rect x="10" y="4" width="6" height="16" rx="3" fill="#3B82F6" />
            <rect x="20" y="4" width="6" height="16" rx="3" fill="#3B82F6" />
          </svg>
          supergate
          <span className="text-sm text-text-muted ml-1">VRM</span>
        </div>

        {/* 네비게이션 */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? "bg-brand/10 text-text-accent"
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* 메인 콘텐츠 영역 — 각 페이지가 Outlet으로 렌더링됨 */}
      <main className="flex-1 overflow-y-auto bg-bg-app">
        <Outlet />
      </main>
    </div>
  );
}
