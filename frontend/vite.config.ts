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
  server: {
    port: 5173,
    host: "0.0.0.0", /* Docker 컨테이너 외부에서 접근 허용 */
    /* 개발 시 FastAPI 백엔드로 API 요청 프록시 */
    proxy: {
      "/api": {
        target: "http://localhost:8100",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8100",
        ws: true,
      },
    },
  },
});
