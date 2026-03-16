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
    },
  },
});
