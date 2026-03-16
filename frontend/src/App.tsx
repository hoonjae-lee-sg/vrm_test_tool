import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import DashboardPage from "@/pages/DashboardPage";
import TesterPage from "@/pages/TesterPage";
import LivePage from "@/pages/LivePage";
import PlaylistPage from "@/pages/PlaylistPage";
import MultiSnapshotPage from "@/pages/MultiSnapshotPage";

/**
 * 앱 루트 — 라우팅 설정
 * Layout 컴포넌트가 공통 헤더를 제공하고 Outlet으로 페이지를 렌더링
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/multi-snapshot" element={<MultiSnapshotPage />} />
          <Route path="/tester" element={<TesterPage />} />
          <Route path="/playlist" element={<PlaylistPage />} />
          <Route path="/live" element={<LivePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
