/**
 * 녹화 시작(Start Recording) 패널
 * - 13개 개별 useState를 단일 form 상태 객체로 통합
 * - HQ/SQ RTSP URL, 인증 정보, 스토리지 제한, 녹화 모드 등 입력
 * - startRecording API 호출 후 로그/토스트 반영
 */
import { useState } from "react";
import FormField from "@/components/FormField";
import Button from "@/components/Button";
import { startRecording, type StartRecordingParams } from "@/api/recording";

/** StartPanel Props 정의 */
interface StartPanelProps {
  /** 로그 추가 콜백 */
  addLog: (title: string, data?: unknown) => void;
  /** 토스트 메시지 표시 콜백 */
  showToast: (message: string, type: "success" | "error" | "info") => void;
  /** 녹화 목록 갱신 콜백 */
  refresh: () => void;
}

/** 폼 상태 타입 — 기존 13개 useState 통합 */
interface StartForm {
  hqUrl: string;
  sqUrl: string;
  hqStorage: string;
  sqStorage: string;
  retention: string;
  mode: string;
  codec: string;
  authToken: string;
  notes: string;
  hqId: string;
  hqPass: string;
  sqId: string;
  sqPass: string;
}

/** 폼 초기값 */
const INITIAL_FORM: StartForm = {
  hqUrl: "",
  sqUrl: "",
  hqStorage: "",
  sqStorage: "",
  retention: "7",
  mode: "CONTINUOUS",
  codec: "H264",
  authToken: "",
  notes: "",
  hqId: "",
  hqPass: "",
  sqId: "",
  sqPass: "",
};

export default function StartPanel({ addLog, showToast, refresh }: StartPanelProps) {
  /** 단일 폼 상태 객체 — 개별 필드 업데이트는 updateField 사용 */
  const [form, setForm] = useState<StartForm>(INITIAL_FORM);
  /** API 호출 중 로딩 상태 */
  const [loading, setLoading] = useState(false);

  /** 특정 필드만 업데이트하는 헬퍼 함수 */
  const updateField = <K extends keyof StartForm>(key: K, value: StartForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  /** 녹화 시작 API 호출 핸들러 */
  const handleSubmit = async () => {
    const body: StartRecordingParams = {
      hq_url: form.hqUrl,
      sq_url: form.sqUrl,
      rtsp_hq_username: form.hqId || undefined,
      rtsp_hq_password: form.hqPass || undefined,
      rtsp_sq_username: form.sqId || undefined,
      rtsp_sq_password: form.sqPass || undefined,
      hq_storage_limit_mbs: form.hqStorage ? parseInt(form.hqStorage) : undefined,
      sq_storage_limit_mbs: form.sqStorage ? parseInt(form.sqStorage) : undefined,
      retention_days: parseInt(form.retention) || 7,
      recording_mode: form.mode,
      encoding_codec: form.codec,
      auth_token: form.authToken || undefined,
      notes: form.notes || undefined,
    };
    addLog("Starting recording...", body);
    setLoading(true);
    try {
      const result = await startRecording(body);
      addLog("Start Response:", result);
      showToast("녹화 시작 성공", "success");
      refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog("Error:", { message });
      showToast("녹화 시작 실패", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary mb-4">Start Recording</h2>
      <div className="space-y-3">
        {/* RTSP URL 입력 */}
        <FormField label="HQ RTSP URL" value={form.hqUrl} onChange={(v) => updateField("hqUrl", v)} placeholder="rtsp://..." />
        <FormField label="SQ RTSP URL" value={form.sqUrl} onChange={(v) => updateField("sqUrl", v)} placeholder="rtsp://..." />

        {/* HQ 인증 정보 */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="HQ Username" value={form.hqId} onChange={(v) => updateField("hqId", v)} />
          <FormField label="HQ Password" value={form.hqPass} onChange={(v) => updateField("hqPass", v)} type="password" />
        </div>

        {/* SQ 인증 정보 */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="SQ Username" value={form.sqId} onChange={(v) => updateField("sqId", v)} />
          <FormField label="SQ Password" value={form.sqPass} onChange={(v) => updateField("sqPass", v)} type="password" />
        </div>

        {/* 스토리지 제한 설정 */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="HQ Storage Limit (MB)" value={form.hqStorage} onChange={(v) => updateField("hqStorage", v)} type="number" />
          <FormField label="SQ Storage Limit (MB)" value={form.sqStorage} onChange={(v) => updateField("sqStorage", v)} type="number" />
        </div>

        {/* 녹화 모드, 코덱, 보관 기간 */}
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Retention (days)" value={form.retention} onChange={(v) => updateField("retention", v)} type="number" />
          <FormField label="Mode" value={form.mode} onChange={(v) => updateField("mode", v)}>
            <option value="CONTINUOUS">CONTINUOUS</option>
            <option value="EVENT">EVENT</option>
          </FormField>
          <FormField label="Codec" value={form.codec} onChange={(v) => updateField("codec", v)}>
            <option value="H264">H264</option>
            <option value="H265">H265</option>
          </FormField>
        </div>

        {/* 인증 토큰 및 메모 */}
        <FormField label="Auth Token" value={form.authToken} onChange={(v) => updateField("authToken", v)} />
        <FormField label="Notes" value={form.notes} onChange={(v) => updateField("notes", v)} />
      </div>

      {/* 제출 버튼 */}
      <Button variant="primary" size="md" onClick={handleSubmit} isLoading={loading} className="mt-4">
        Start Recording
      </Button>
    </div>
  );
}
