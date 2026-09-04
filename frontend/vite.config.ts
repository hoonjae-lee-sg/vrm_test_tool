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
    /* 포트 점유 시 조용히 다음 번호(5174...)로 밀리지 않고 즉시 실패시킴.
       밀리면 브라우저 주소와 실제 포트가 어긋나 원인 파악이 어려움. */
    strictPort: true,
    host: "0.0.0.0", /* Docker 컨테이너 외부에서 접근 허용 */
    /* 개발 시 FastAPI 백엔드로 API 요청 프록시 */
    proxy: {
      "/api": {
        target: "http://localhost:8100",
        changeOrigin: true,
        ws: true, /* /api/ws/live/* WebSocket 프록시 지원 */
        /* SSE(text/event-stream) 응답 헤더 즉시 플러시.
           Vite 의 프록시는 업스트림 헤더를 res 에 setHeader 만 해두고 실제 전송은
           첫 본문 바이트가 흐를 때까지 미룸. /api/events/stream 은 이벤트가 없으면
           sse-starlette 의 15초 주기 `: ping` 이 첫 바이트라, 브라우저 EventSource 의
           onopen 이 최대 15초 늦게 발화함(실측: FastAPI 직결 time_starttransfer 0.001s
           vs Vite 경유 15.002s). 그동안 화면의 연결 상태 배지가 "연결 중" 으로 남아
           연결이 안 된 것처럼 보였음. content-type 이 event-stream 일 때만
           헤더 전송을 앞당겨 실제 연결 시점과 UI 표시를 일치시킴.
           queueMicrotask 인 이유: proxyRes 이벤트는 Vite 가 헤더 복사 pass 를 돌리기
           **전에** 동기 발화하므로, 같은 틱이 끝난 뒤(= 헤더가 res 에 얹힌 뒤)에
           flush 해야 상태코드/헤더가 온전히 나감. */
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            const ct = proxyRes.headers["content-type"];
            if (typeof ct === "string" && ct.includes("text/event-stream")) {
              queueMicrotask(() => {
                try {
                  if (!res.headersSent) res.flushHeaders();
                } catch {
                  /* 이미 종료된 응답 등 — SSE 가 15초 지연으로 되돌아갈 뿐이므로 무시 */
                }
              });
            }
          });
        },
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
      /* VRM 산출물(이벤트 클립 mp4 / 스냅샷) 직접 서빙 프록시.
         VRM 의 `GET /data/*`(recording_controller.hpp ServeData) 가 data_path 하위 파일을
         .ts/.m3u8/.mp4/.jpg/.png 확장자에 한해 내려줌. 이 프록시가 없으면 5173 의 SPA
         fallback 이 index.html 을 200 으로 돌려주어 <video> 가 조용히 재생 실패함
         (실측: 프록시 전 /data/... 요청이 1028B html 반환). */
      "/data": {
        target: "http://localhost:18071",
        changeOrigin: true,
      },
    },
  },
});
