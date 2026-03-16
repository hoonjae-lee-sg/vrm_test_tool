import axios from "axios";

/**
 * Axios 인스턴스 — FastAPI 백엔드 API 호출용
 * 개발 시 Vite proxy를 통해 localhost:8000으로 프록시됨
 */
const apiClient = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

/* 응답 인터셉터: 에러 로깅 */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("[API Error]", error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default apiClient;
