/**
 * 녹화 상태 확인(Check Status) 패널
 * - Recording ID 입력 후 상태 조회
 * - getRecordingStatus API 호출 결과를 로그에 출력
 */
import { useState } from "react";
import FormField from "@/components/FormField";
import Button from "@/components/Button";
import { getRecordingStatus } from "@/api/recording";

/** StatusPanel Props 정의 */
interface StatusPanelProps {
  /** 현재 선택된 Recording ID */
  recordingId: string;
  /** Recording ID 변경 콜백 */
  setRecordingId: (value: string) => void;
  /** 로그 추가 콜백 */
  addLog: (title: string, data?: unknown) => void;
}

export default function StatusPanel({
  recordingId,
  setRecordingId,
  addLog,
}: StatusPanelProps) {
  /** API 호출 중 로딩 상태 */
  const [loading, setLoading] = useState(false);

  /** 상태 조회 API 호출 핸들러 */
  const handleSubmit = async () => {
    addLog("Checking status...", { recording_id: recordingId });
    setLoading(true);
    try {
      const result = await getRecordingStatus(recordingId);
      addLog("Status Response:", result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("Error:", { message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Check Status</h2>
      <div className="space-y-3">
        <FormField label="Recording ID" value={recordingId} onChange={setRecordingId} />
      </div>
      <Button variant="primary" size="md" onClick={handleSubmit} isLoading={loading} className="mt-4">
        Check Status
      </Button>
    </div>
  );
}
