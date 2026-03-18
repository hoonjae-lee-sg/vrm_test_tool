/**
 * 이벤트 클립 시작/중지 패널
 * - 기존 EventStartPanel, EventStopPanel 통합
 * - mode prop으로 시작/중지 동작 분기
 * - startEventClip / stopEventClip API 호출
 */
import { useState } from "react";
import FormField from "@/components/FormField";
import Button from "@/components/Button";
import { startEventClip, stopEventClip } from "@/api/recording";

/** EventClipPanel Props 정의 */
interface EventClipPanelProps {
  /** 동작 모드 — 시작 또는 중지 */
  mode: "start" | "stop";
  /** 현재 선택된 Recording ID */
  recordingId: string;
  /** Recording ID 변경 콜백 */
  setRecordingId: (value: string) => void;
  /** 로그 추가 콜백 */
  addLog: (title: string, data?: unknown) => void;
}

export default function EventClipPanel({
  mode,
  recordingId,
  setRecordingId,
  addLog,
}: EventClipPanelProps) {
  /** 인증 토큰 (선택 입력) */
  const [authToken, setAuthToken] = useState("");
  /** API 호출 중 로딩 상태 */
  const [loading, setLoading] = useState(false);

  /** 시작/중지 여부에 따른 표시 텍스트 */
  const isStart = mode === "start";
  const title = isStart ? "Start Event Clip" : "Stop Event Clip";
  const buttonLabel = isStart ? "Start Event" : "Stop Event";

  /** 이벤트 클립 시작/중지 API 호출 핸들러 */
  const handleSubmit = async () => {
    addLog(`${isStart ? "Starting" : "Stopping"} event clip...`, {
      recording_id: recordingId,
    });
    setLoading(true);
    try {
      const apiFn = isStart ? startEventClip : stopEventClip;
      const result = await apiFn(recordingId, authToken || undefined);
      addLog(`${isStart ? "Start" : "Stop"} Event Response:`, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("Error:", { message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">{title}</h2>
      <div className="space-y-3">
        <FormField label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <FormField label="Auth Token (optional)" value={authToken} onChange={setAuthToken} />
      </div>
      {/* 시작: primary, 중지: destructive 버튼 스타일 */}
      <Button
        variant={isStart ? "primary" : "destructive"}
        size="md"
        onClick={handleSubmit}
        isLoading={loading}
        className="mt-4"
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
