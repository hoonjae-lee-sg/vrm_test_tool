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
 * 공통 레이아웃 — 상단 헤더 네비게이션 + 콘텐츠 영역
 * 기존 Supergate VRM 디자인 재현:
 *  - 반투명 backdrop-blur 헤더 + shadow-md 깊이감
 *  - 로고 글로우 효과
 *  - Heroicon 아이콘 + 텍스트 네비게이션
 *  - 액티브 탭 하단 인디케이터 (블루 라인)
 */
export default function Layout() {
  /* 네비게이션 항목 정의 — 아이콘(Heroicon) + 라벨 + 경로 */
  const navItems = [
    { to: "/", label: "Dashboard", icon: Squares2X2Icon },
    { to: "/multi-snapshot", label: "Multi-Snapshot", icon: CameraIcon },
    { to: "/tester", label: "Tester", icon: WrenchScrewdriverIcon },
    { to: "/playlist", label: "Playlist", icon: PlayCircleIcon },
    { to: "/live", label: "Live Grid", icon: VideoCameraIcon },
    { to: "/sync-viewer", label: "Sync Viewer", icon: ArrowsPointingInIcon },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* 상단 헤더 — 딥 네이비 글래스 + 그래디언트 하단 보더 */}
      <header className="flex flex-col shrink-0 z-50 sticky top-0">
        <div className="flex items-center justify-between px-8 h-16 bg-[#0a0e1a]/80 backdrop-blur-2xl shadow-[0_1px_30px_rgba(0,0,0,0.5)]">
        {/* 로고 — 글로우 효과 + Outfit 디스플레이 폰트 */}
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
          <span className="text-lg font-bold text-text-muted ml-0 font-display">VRM</span>
        </div>

        {/* 네비게이션 — 액티브 탭 배경 필 (라운드 lg) */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                    isActive
                      ? "text-brand bg-brand/10"
                      : "text-text-muted hover:text-text-secondary hover:bg-white/5"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {/* 네비게이션 아이콘 — 액티브 시 brand 색상 적용 */}
                    <Icon className={`w-4 h-4 ${isActive ? "text-brand" : ""}`} />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
        </div>
        {/* 그래디언트 하단 보더 — 중앙 brand 글로우 */}
        <div className="h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" />
      </header>

      {/* 메인 콘텐츠 영역 — 각 페이지가 Outlet으로 렌더링됨 */}
      <main className="flex-1 overflow-y-auto bg-bg-app">
        <Outlet />
      </main>
    </div>
  );
}
