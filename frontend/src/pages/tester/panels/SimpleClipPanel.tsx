/**
 * 심플 클립 생성(Create Clip) 패널
 * - Recording ID, 타임스탬프(seconds/nanos) 입력
 * - createSimpleClip API 호출 후 결과를 로그에 출력
 */
import { useState } from "react";
import FormField from "@/components/FormField";
import Button from "@/components/Button";
import { createSimpleClip } from "@/api/recording";

/** SimpleClipPanel Props 정의 */
interface SimpleClipPanelProps {
  /** 현재 선택된 Recording ID */
  recordingId: string;
  /** Recording ID 변경 콜백 */
  setRecordingId: (value: string) => void;
  /** 로그 추가 콜백 */
  addLog: (title: string, data?: unknown) => void;
}

export default function SimpleClipPanel({
  recordingId,
  setRecordingId,
  addLog,
}: SimpleClipPanelProps) {
  /** 클립 시점 초 단위 (epoch) */
  const [seconds, setSeconds] = useState("");
  /** 클립 시점 나노초 단위 */
  const [nanos, setNanos] = useState("0");
  /** API 호출 중 로딩 상태 */
  const [loading, setLoading] = useState(false);

  /** 심플 클립 생성 API 호출 핸들러 */
  const handleSubmit = async () => {
    addLog("Creating clip...", { recording_id: recordingId, seconds, nanos });
    setLoading(true);
    try {
      const result = await createSimpleClip(recordingId, parseInt(seconds), parseInt(nanos));
      addLog("Clip Response:", result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("Error:", { message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Create Clip</h2>
      <div className="space-y-3">
        <FormField label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Seconds (epoch)" value={seconds} onChange={setSeconds} type="number" />
          <FormField label="Nanos" value={nanos} onChange={setNanos} type="number" />
        </div>
      </div>
      <Button variant="primary" size="md" onClick={handleSubmit} isLoading={loading} className="mt-4">
        Create Clip
      </Button>
    </div>
  );
}
