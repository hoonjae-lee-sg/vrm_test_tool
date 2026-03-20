import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  /* 프로덕션 빌드: dist/ 디렉토리에 출력 → FastAPI static files로 서빙 */
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: "0.0.0.0", /* Docker 컨테이너 외부에서 접근 허용 */
    /* 개발 시 FastAPI 백엔드로 API 요청 프록시 */
    proxy: {
      "/api": {
        target: "http://localhost:8100",
        changeOrigin: true,
        ws: true, /* /api/ws/live/* WebSocket 프록시 지원 */
      },
      /* Snapshot Receiver 서버 프록시 (포트 8200) */
      "/capture": {
        target: "http://localhost:8200",
        changeOrigin: true,
      },
      /* VRM 서버 HLS 재생 프록시 — Docker 환경에서 직접 포트 접근 불가하므로 프록시 경유 */
      "/recording": {
        target: "http://localhost:18071",
        changeOrigin: true,
      },
      "/static/hls": {
        target: "http://localhost:18071",
        changeOrigin: true,
      },
    },
  },
});
