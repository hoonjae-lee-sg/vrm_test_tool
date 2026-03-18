/**
 * 녹화 중지(Stop Recording) 패널
 * - Recording ID와 Auth Token 입력
 * - stopRecording API 호출 후 로그/토스트 반영
 */
import { useState } from "react";
import FormField from "@/components/FormField";
import Button from "@/components/Button";
import { stopRecording } from "@/api/recording";

/** StopPanel Props 정의 */
interface StopPanelProps {
  /** 현재 선택된 Recording ID */
  recordingId: string;
  /** Recording ID 변경 콜백 */
  setRecordingId: (value: string) => void;
  /** 로그 추가 콜백 */
  addLog: (title: string, data?: unknown) => void;
  /** 토스트 메시지 표시 콜백 */
  showToast: (message: string, type: "success" | "error" | "info") => void;
  /** 녹화 목록 갱신 콜백 */
  refresh: () => void;
}

export default function StopPanel({
  recordingId,
  setRecordingId,
  addLog,
  showToast,
  refresh,
}: StopPanelProps) {
  /** 인증 토큰 (선택 입력) */
  const [authToken, setAuthToken] = useState("");
  /** API 호출 중 로딩 상태 */
  const [loading, setLoading] = useState(false);

  /** 녹화 중지 API 호출 핸들러 */
  const handleSubmit = async () => {
    addLog("Stopping recording...", { recording_id: recordingId });
    setLoading(true);
    try {
      const result = await stopRecording(recordingId);
      addLog("Stop Response:", result);
      showToast("녹화 중지 성공", "success");
      refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("Error:", { message });
      showToast("녹화 중지 실패", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Stop Recording</h2>
      <div className="space-y-3">
        <FormField label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <FormField label="Auth Token (optional)" value={authToken} onChange={setAuthToken} />
      </div>
      {/* 중지 버튼 — destructive 스타일 */}
      <Button variant="destructive" size="md" onClick={handleSubmit} isLoading={loading} className="mt-4">
        Stop Recording
      </Button>
    </div>
  );
}
