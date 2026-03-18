/**
 * 헬스 체크(Check Health) 패널
 * - Recording ID와 Auth Token 입력
 * - getRecordingHealth API 호출 후 결과를 로그에 출력
 */
import { useState } from "react";
import FormField from "@/components/FormField";
import Button from "@/components/Button";
import { getRecordingHealth } from "@/api/recording";

/** HealthPanel Props 정의 */
interface HealthPanelProps {
  /** 현재 선택된 Recording ID */
  recordingId: string;
  /** Recording ID 변경 콜백 */
  setRecordingId: (value: string) => void;
  /** 로그 추가 콜백 */
  addLog: (title: string, data?: unknown) => void;
}

export default function HealthPanel({
  recordingId,
  setRecordingId,
  addLog,
}: HealthPanelProps) {
  /** 인증 토큰 (선택 입력) */
  const [authToken, setAuthToken] = useState("");
  /** API 호출 중 로딩 상태 */
  const [loading, setLoading] = useState(false);

  /** 헬스 체크 API 호출 핸들러 */
  const handleSubmit = async () => {
    addLog("Checking health...", { recording_id: recordingId });
    setLoading(true);
    try {
      const result = await getRecordingHealth(recordingId, authToken || undefined);
      addLog("Health Response:", result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("Error:", { message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Check Health</h2>
      <div className="space-y-3">
        <FormField label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <FormField label="Auth Token (optional)" value={authToken} onChange={setAuthToken} />
      </div>
      <Button variant="primary" size="md" onClick={handleSubmit} isLoading={loading} className="mt-4">
        Check Health
      </Button>
    </div>
  );
}
