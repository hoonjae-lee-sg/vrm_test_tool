import { NavLink, Outlet } from "react-router-dom";

/**
 * 공통 레이아웃 — 상단 헤더 네비게이션 + 콘텐츠 영역
 * 기존 Supergate VRM 디자인 재현:
 *  - 반투명 backdrop-blur 헤더
 *  - 로고 글로우 효과
 *  - 액티브 탭 하단 인디케이터 (블루 라인)
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
      {/* 상단 헤더 — 반투명 + backdrop-blur (기존 style.css 재현) */}
      <header className="flex items-center justify-between px-8 h-16 bg-black/80 backdrop-blur-xl border-b border-white/[0.08] shrink-0 z-50 sticky top-0">
        {/* 로고 — 글로우 효과 포함 */}
        <div className="flex items-center gap-3 font-bold text-xl text-white tracking-tight lowercase">
          <svg
            viewBox="0 0 40 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="h-[22px] drop-shadow-[0_0_8px_#3b82f6]"
          >
            <rect x="0" y="4" width="6" height="16" rx="3" fill="#3B82F6" />
            <rect x="10" y="4" width="6" height="16" rx="3" fill="#3B82F6" />
            <rect x="20" y="4" width="6" height="16" rx="3" fill="#3B82F6" />
          </svg>
          supergate
          <span className="text-sm font-normal text-text-muted ml-0">VRM</span>
        </div>

        {/* 네비게이션 — 액티브 탭 하단 블루 라인 포함 */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `relative px-4 py-2 rounded-md text-[13px] font-medium transition-all duration-200 ${
                  isActive
                    ? "text-text-accent bg-brand/[0.12]"
                    : "text-text-secondary hover:text-white hover:bg-white/5"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {item.label}
                  {/* 액티브 탭 하단 인디케이터 — 블루 글로우 라인 */}
                  {isActive && (
                    <span className="absolute -bottom-[17px] left-[20%] right-[20%] h-0.5 bg-brand rounded shadow-[0_0_10px_#3b82f6]" />
                  )}
                </>
              )}
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
