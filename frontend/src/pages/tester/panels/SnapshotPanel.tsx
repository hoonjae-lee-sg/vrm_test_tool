/**
 * 스냅샷 촬영(Take Snapshot) 패널
 * - Recording ID, 타임스탬프(seconds/nanos) 입력
 * - takeSnapshot API 호출 후 이미지 미리보기 표시
 * - 촬영 이력을 로컬 상태로 관리하여 그리드 렌더링
 */
import { useState } from "react";
import FormField from "@/components/FormField";
import Button from "@/components/Button";
import { takeSnapshot } from "@/api/recording";
import { VRM_API_PORT } from "@/constants";

/** SnapshotPanel Props 정의 */
interface SnapshotPanelProps {
  /** 현재 선택된 Recording ID */
  recordingId: string;
  /** Recording ID 변경 콜백 */
  setRecordingId: (value: string) => void;
  /** 로그 추가 콜백 */
  addLog: (title: string, data?: unknown) => void;
}

/** 스냅샷 이력 항목 */
interface SnapshotItem {
  /** 이미지 URL */
  url: string;
  /** 촬영 시각 표시 문자열 */
  time: string;
}

export default function SnapshotPanel({
  recordingId,
  setRecordingId,
  addLog,
}: SnapshotPanelProps) {
  /** 타임스탬프 초 단위 (epoch, 선택 입력) */
  const [seconds, setSeconds] = useState("");
  /** 타임스탬프 나노초 단위 */
  const [nanos, setNanos] = useState("0");
  /** API 호출 중 로딩 상태 */
  const [loading, setLoading] = useState(false);
  /** 촬영된 스냅샷 이력 배열 (최신 순) */
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);

  /** 스냅샷 촬영 API 호출 핸들러 */
  const handleSubmit = async () => {
    addLog("Taking snapshot...", { recording_id: recordingId, seconds, nanos });
    setLoading(true);
    try {
      const result = await takeSnapshot(
        recordingId,
        seconds ? parseInt(seconds) : undefined,
        nanos ? parseInt(nanos) : 0
      );
      addLog("Snapshot Response:", result);

      /* 스냅샷 이미지 URL 생성 및 이력 추가 */
      const imagePath = result.file?.path as string | undefined;
      if (imagePath) {
        const cleanPath = imagePath.startsWith("./") ? imagePath.substring(1) : imagePath;
        const imageUrl = `http://${window.location.hostname}:${VRM_API_PORT}${cleanPath}`;
        const time = seconds
          ? new Date(parseInt(seconds) * 1000).toLocaleTimeString("en-GB")
          : new Date().toLocaleTimeString("en-GB");
        setSnapshots((prev) => [{ url: imageUrl, time }, ...prev]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("Error:", { message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Take Snapshot</h2>
      <div className="space-y-3">
        <FormField label="Recording ID" value={recordingId} onChange={setRecordingId} />
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Seconds (epoch, optional)" value={seconds} onChange={setSeconds} type="number" />
          <FormField label="Nanos" value={nanos} onChange={setNanos} type="number" />
        </div>
      </div>
      <Button variant="primary" size="md" onClick={handleSubmit} isLoading={loading} className="mt-4">
        Take Snapshot
      </Button>

      {/* 스냅샷 이미지 미리보기 그리드 */}
      {snapshots.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Snapshots</h3>
          <div className="grid grid-cols-3 gap-2">
            {snapshots.map((snap, i) => (
              <div key={i} className="relative">
                <img
                  src={snap.url}
                  alt={`snapshot-${i}`}
                  className="w-full aspect-video object-cover rounded border border-border"
                />
                {/* 촬영 시각 오버레이 */}
                <span className="absolute bottom-1 left-1 text-[9px] bg-black/70 text-white px-1 rounded">
                  {snap.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
