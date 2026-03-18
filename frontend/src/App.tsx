import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import ErrorBoundary from "@/components/ErrorBoundary";
import DashboardPage from "@/pages/DashboardPage";
import TesterPage from "@/pages/tester/TesterPage";
import LivePage from "@/pages/LivePage";
import PlaylistPage from "@/pages/PlaylistPage";
import MultiSnapshotPage from "@/pages/MultiSnapshotPage";
import SyncViewerPage from "@/pages/SyncViewerPage";

/**
 * 앱 루트 — 라우팅 설정
 * Layout 컴포넌트가 공통 헤더를 제공하고 Outlet으로 페이지를 렌더링
 * 각 Route에 ErrorBoundary를 래핑하여 페이지 단위 에러 격리
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
          <Route path="/multi-snapshot" element={<ErrorBoundary><MultiSnapshotPage /></ErrorBoundary>} />
          <Route path="/tester" element={<ErrorBoundary><TesterPage /></ErrorBoundary>} />
          <Route path="/playlist" element={<ErrorBoundary><PlaylistPage /></ErrorBoundary>} />
          <Route path="/live" element={<ErrorBoundary><LivePage /></ErrorBoundary>} />
          <Route path="/sync-viewer" element={<ErrorBoundary><SyncViewerPage /></ErrorBoundary>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
