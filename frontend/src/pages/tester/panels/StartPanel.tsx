/**
 * 녹화 시작(Start Recording) 패널
 *
 * [이번 개편에서 고친 것 — 중요]
 * 1. **serial_number 입력 추가.** 서버는 `serial_number` 를 그대로 `recording_id` 로 쓰고
 *    `<data_path>/<recording_id>/...` 경로 컴포넌트로 사용하므로 `[A-Za-z0-9_-]{1,128}`
 *    를 강제하며, 비어 있으면 INVALID_ARGUMENT 로 거절함
 *    (src/grpc/recorder_service.cc DoStart). 기존 폼에는 이 필드 자체가 없어서
 *    Start 가 **항상 실패**하는 상태였음. 필드 추가 + 클라이언트 선검증으로 왕복 제거.
 * 2. **비동기 탐색 반영.** RecordStart 는 RTSP 탐색을 백그라운드로 넘겨 수십 ms 만에
 *    반환함. 따라서 "오래 걸리는 작업" UI 가 아니라, 반환 즉시 대상 전환 →
 *    PENDING→RUNNING 전이를 빠른 폴링으로 보여주는 흐름으로 바꿈.
 * 3. **쿼터 안내/검증.** `hq_storage_limit_mbs` 는 0 이면 무제한이고 탐색 자체를 생략함.
 *    0 보다 크면 백그라운드 검증 후 부족할 때만 DISK_THRESHOLD/WARN 이벤트로 통보됨
 *    (Start 는 성공). 이 규칙을 입력 옆 힌트로 적고, 시작 직후 `/api/events/recent` 를
 *    짧게 폴링해 경고가 오면 화면으로 끌어올림.
 * 4. **프리셋/최근값.** RTSP URL·계정·쿼터 조합을 저장/복원하여 반복 타이핑 제거.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import FormField from "@/components/FormField";
import Button from "@/components/Button";
import { startRecording, type StartRecordingParams } from "@/api/recording";
import { fetchRecentEvents, type FeedEvent } from "@/api/events";
import { DEFAULT_RETENTION_DAYS } from "@/constants";
import PanelShell from "../components/PanelShell";
import ResultCard, { type ResultRow } from "../components/ResultCard";
import { identifierError, rtspUrlError } from "../lib/validation";
import { fmtIsoTime, fmtQuotaMbs, recommendedQuotaMbs, rtspRaw } from "../lib/format";
import {
  loadPresets,
  savePreset,
  deletePreset,
  loadLastForm,
  saveLastForm,
  type StartPreset,
} from "../lib/presets";
import type { RecordingStatusResp } from "@/api/recording";
import type { TesterCtx } from "../types";

/** 폼 상태 타입 */
interface StartForm {
  serial: string;
  hqUrl: string;
  sqUrl: string;
  hqStorage: string;
  sqStorage: string;
  retention: string;
  mode: string;
  codec: string;
  notes: string;
  hqId: string;
  hqPass: string;
  sqId: string;
  sqPass: string;
  /** 권장 쿼터 계산용 예상 비트레이트 (Mbps) — 요청 본문에는 포함되지 않음 */
  bitrateMbps: string;
}

/** 폼 초기값 */
const INITIAL_FORM: StartForm = {
  serial: "",
  hqUrl: "",
  sqUrl: "",
  hqStorage: "0",
  sqStorage: "0",
  retention: String(DEFAULT_RETENTION_DAYS),
  mode: "CONTINUOUS",
  codec: "COPY",
  notes: "",
  hqId: "",
  hqPass: "",
  sqId: "",
  sqPass: "",
  bitrateMbps: "4",
};

/** 서버 encoding.proto Codec enum 에 존재하는 값 — 이 외의 이름은 백엔드에서 거절됨 */
const VALID_CODECS = ["COPY", "H264_SW", "H264_NVENC"];

/** 쿼터 경고 폴링 주기/총 시간 — 백그라운드 탐색은 통상 3~7초에 끝나므로 45초면 충분함 */
const QUOTA_POLL_INTERVAL_MS = 3000;
const QUOTA_POLL_DURATION_MS = 45000;

export default function StartPanel({ ctx }: { ctx: TesterCtx }) {
  /** 폼 상태 — 마지막 입력값을 localStorage 에서 복원.
   *  단 코덱은 유효 enum 이 아니면 COPY 로 교정함 — 이전 버전이 저장해 둔
   *  "H264"/"H265" 가 그대로 복원되면 다시 Start 가 실패하기 때문. */
  const [form, setForm] = useState<StartForm>(() => {
    const restored = loadLastForm(INITIAL_FORM);
    return VALID_CODECS.includes(restored.codec) ? restored : { ...restored, codec: "COPY" };
  });
  /** 저장된 프리셋 목록 */
  const [presets, setPresets] = useState<StartPreset[]>(() => loadPresets());
  /** 프리셋 저장용 이름 입력 */
  const [presetName, setPresetName] = useState("");
  /** 드롭다운에서 선택된 프리셋 이름 — 삭제 대상 지정에도 사용 */
  const [selectedPreset, setSelectedPreset] = useState("");
  /** 마지막 실행 결과 */
  const [result, setResult] = useState<RecordingStatusResp | null>(null);
  /** 마지막 실행 실패 메시지 */
  const [failure, setFailure] = useState<string | null>(null);
  /** 백그라운드 쿼터 검증 상태 — "감시 중" / 수신된 경고 */
  const [quotaWatch, setQuotaWatch] = useState<{ watching: boolean; events: FeedEvent[] }>({
    watching: false,
    events: [],
  });
  /** 쿼터 폴링 타이머 — 언마운트/재실행 시 정리 대상 */
  const quotaTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 필드 부분 업데이트 */
  const updateField = <K extends keyof StartForm>(key: K, value: StartForm[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      /* 새로고침 후에도 이어서 작업하도록 즉시 영속화 (비밀번호 포함 — 내부 테스트 도구 전제) */
      saveLastForm(next);
      return next;
    });
  };

  /** 언마운트 시 폴링 타이머 정리 — 패널을 떠난 뒤에도 네트워크가 계속 도는 것 방지 */
  useEffect(() => {
    return () => {
      if (quotaTimerRef.current) clearInterval(quotaTimerRef.current);
    };
  }, []);

  /* ────────────────── 검증 ────────────────── */

  const serialError = identifierError(form.serial);
  const hqError = rtspUrlError(form.hqUrl);
  /* 서버는 rtsp_url_hq/sq 둘 다 비어 있지 않을 것을 요구함 (RTSP URLs cannot be empty) */
  const sqError = rtspUrlError(form.sqUrl);
  const blocked = serialError ? "serial_number 확인" : hqError || sqError ? "RTSP URL 확인" : null;

  /** 권장 HQ 쿼터 — 서버 계산식과 동일 */
  const recommended = recommendedQuotaMbs(
    Number(form.retention) || 0,
    (Number(form.bitrateMbps) || 0) * 1_000_000
  );
  /** 사용자가 입력한 HQ 쿼터가 권장치에 못 미치는지 (0 = 무제한이므로 제외) */
  const hqQuota = Number(form.hqStorage) || 0;
  const quotaShort = hqQuota > 0 && recommended > 0 && hqQuota < recommended;

  /* ────────────────── 보조 동작 ────────────────── */

  /** serial 자동 생성 — 허용 문자만 사용 (콜론/점이 들어가면 서버가 거절함) */
  const generateSerial = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
      now.getHours()
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    updateField("serial", `cam-${stamp}`);
  };

  /** 선택된 대상의 RTSP URL 을 폼으로 복사 — 같은 카메라를 다른 serial 로 재시작할 때 사용 */
  const copyFromTarget = () => {
    const rec = ctx.recordings.find((r) => r.recording_id === ctx.primaryTarget) as
      | { rtsp_url_hq?: unknown; rtsp_url_sq?: unknown }
      | undefined;
    if (!rec) {
      ctx.showToast("복사할 대상이 없습니다 — 상단 Target 을 먼저 선택하세요", "info");
      return;
    }
    const hq = rtspRaw(rec.rtsp_url_hq as never);
    const sq = rtspRaw(rec.rtsp_url_sq as never);
    setForm((prev) => {
      const next = { ...prev, hqUrl: hq || prev.hqUrl, sqUrl: sq || prev.sqUrl };
      saveLastForm(next);
      return next;
    });
    ctx.showToast("대상의 RTSP URL 을 복사했습니다", "success");
  };

  /** 프리셋 적용 — serial 은 접두어만 복원하고 타임스탬프를 새로 붙여 중복 ID 를 피함 */
  const applyPreset = (name: string) => {
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setForm((prev) => {
      const next: StartForm = {
        ...prev,
        hqUrl: p.hqUrl,
        sqUrl: p.sqUrl,
        hqId: p.hqId,
        hqPass: p.hqPass,
        sqId: p.sqId,
        sqPass: p.sqPass,
        hqStorage: p.hqStorage,
        sqStorage: p.sqStorage,
        retention: p.retention,
        mode: p.mode,
        codec: p.codec,
        serial: p.serialPrefix ? `${p.serialPrefix}-${Date.now().toString(36)}` : prev.serial,
      };
      saveLastForm(next);
      return next;
    });
  };

  /** 현재 폼을 프리셋으로 저장 */
  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) {
      ctx.showToast("프리셋 이름을 입력하세요", "info");
      return;
    }
    /* serial 은 매번 달라야 하므로 마지막 하이픈 뒤(타임스탬프)를 떼고 접두어만 저장 */
    const serialPrefix = form.serial.replace(/-[^-]*$/, "") || form.serial;
    setPresets(
      savePreset({
        name,
        hqUrl: form.hqUrl,
        sqUrl: form.sqUrl,
        hqId: form.hqId,
        hqPass: form.hqPass,
        sqId: form.sqId,
        sqPass: form.sqPass,
        hqStorage: form.hqStorage,
        sqStorage: form.sqStorage,
        retention: form.retention,
        mode: form.mode,
        codec: form.codec,
        serialPrefix,
      })
    );
    setPresetName("");
    setSelectedPreset(name);
    ctx.showToast(`프리셋 "${name}" 저장됨`, "success");
  };

  /**
   * 시작 직후 쿼터 경고 감시.
   * 서버가 백그라운드 RTSP 탐색을 끝낸 뒤 쿼터가 부족하면 DISK_THRESHOLD/WARN 이벤트를
   * EventStore 에 발행함. Start 응답만 보면 알 수 없으므로 여기서 짧게 폴링해 노출함.
   */
  const watchQuota = useCallback(
    (recordingId: string, sinceIso: string) => {
      if (quotaTimerRef.current) clearInterval(quotaTimerRef.current);
      setQuotaWatch({ watching: true, events: [] });
      const startedAt = Date.now();

      const tick = async () => {
        try {
          const events = await fetchRecentEvents({
            recordingId,
            severity: ["warn", "error"],
            sinceIso,
            limit: 20,
          });
          /* 저장공간 계열만 채택 — 서버가 쿼터 부족을 DISK_THRESHOLD 로 발행함 */
          const hits = events.filter((e) => e.type === "DISK_THRESHOLD");
          if (hits.length > 0) {
            setQuotaWatch({ watching: false, events: hits });
            if (quotaTimerRef.current) clearInterval(quotaTimerRef.current);
            ctx.showToast("HQ 쿼터 경고가 도착했습니다 (녹화는 계속됨)", "error");
            return;
          }
        } catch {
          /* Events API 미가용(구버전 서버 등) — 감시는 부가 기능이므로 조용히 종료 */
          if (quotaTimerRef.current) clearInterval(quotaTimerRef.current);
          setQuotaWatch({ watching: false, events: [] });
          return;
        }
        if (Date.now() - startedAt > QUOTA_POLL_DURATION_MS) {
          if (quotaTimerRef.current) clearInterval(quotaTimerRef.current);
          setQuotaWatch({ watching: false, events: [] });
        }
      };

      quotaTimerRef.current = setInterval(tick, QUOTA_POLL_INTERVAL_MS);
      void tick();
    },
    [ctx]
  );

  /* ────────────────── 실행 ────────────────── */

  const handleSubmit = useCallback(async () => {
    if (identifierError(form.serial) || rtspUrlError(form.hqUrl) || rtspUrlError(form.sqUrl)) {
      ctx.showToast("입력값을 확인하세요", "error");
      return;
    }

    const body: StartRecordingParams = {
      serial_number: form.serial,
      hq_url: form.hqUrl,
      sq_url: form.sqUrl,
      rtsp_hq_username: form.hqId || undefined,
      rtsp_hq_password: form.hqPass || undefined,
      rtsp_sq_username: form.sqId || undefined,
      rtsp_sq_password: form.sqPass || undefined,
      /* 0 은 "무제한" 이라는 서버 의미가 있으므로 undefined 로 지우지 않고 그대로 보냄 */
      hq_storage_limit_mbs: Number(form.hqStorage) || 0,
      sq_storage_limit_mbs: Number(form.sqStorage) || 0,
      retention_days: Number(form.retention) || DEFAULT_RETENTION_DAYS,
      recording_mode: form.mode,
      encoding_codec: form.codec,
      auth_token: ctx.authToken || undefined,
      notes: form.notes || undefined,
    };

    /* 이벤트 조회 기준 시각 — 이 시점 이전의 과거 경고를 오탐하지 않도록 미리 확보 */
    const sinceIso = new Date(Date.now() - 1000).toISOString();

    const res = await ctx.runner.run({
      label: "Start Recording",
      method: "POST",
      endpoint: "/api/start",
      target: form.serial,
      /* 비밀번호는 로그에 남기지 않음 — 값 유무만 표시 */
      request: {
        ...body,
        rtsp_hq_password: body.rtsp_hq_password ? "***" : undefined,
        rtsp_sq_password: body.rtsp_sq_password ? "***" : undefined,
      },
      fn: () => startRecording(body),
    });

    if (!res.ok) {
      setFailure(res.error ?? "실패");
      setResult(null);
      ctx.showToast("녹화 시작 실패", "error");
      return;
    }

    setFailure(null);
    const status = res.data?.created?.status ?? null;
    setResult(status);

    if (res.data?.error) {
      /* HTTP 200 이지만 oneof 가 error 인 경우 — gRPC 레벨 거절 */
      setFailure(res.data.error.message ?? "서버가 error 응답을 반환함");
      ctx.showToast("녹화 시작 실패 (서버 error 응답)", "error");
      return;
    }

    const newId = status?.recording_id || form.serial;
    ctx.setTargets([newId]);
    /* 비동기 탐색이므로 응답은 즉시 오지만 상태는 PENDING → RUNNING 으로 뒤늦게 전이됨.
       목록을 잠시 빠르게 폴링해 그 전이를 눈으로 확인할 수 있게 함. */
    ctx.fastPoll(15000);
    ctx.showToast(`녹화 시작 요청 완료 (${res.durationMs}ms) — ${newId}`, "success");

    /* 쿼터를 지정한 경우에만 백그라운드 검증 결과를 감시 (0 이면 서버가 탐색 자체를 생략) */
    if ((Number(form.hqStorage) || 0) > 0) watchQuota(newId, sinceIso);
    else setQuotaWatch({ watching: false, events: [] });
  }, [ctx, form, watchQuota]);

  /** Ctrl+Enter 연결 */
  useEffect(() => {
    ctx.registerSubmit(handleSubmit);
    return () => ctx.registerSubmit(null);
  }, [ctx, handleSubmit]);

  /* ────────────────── 결과 카드 ────────────────── */

  const resultRows: ResultRow[] = result
    ? [
        { label: "recording_id", value: result.recording_id ?? "—", mono: true },
        {
          label: "state",
          value: result.state ?? "—",
          tone: result.state === "RUNNING" ? "good" : "warn",
        },
        { label: "created_at", value: fmtIsoTime(result.created_at), mono: true },
        { label: "hq_storage_limit", value: fmtQuotaMbs(result.hq_storage_limit_mbs), mono: true },
        { label: "sq_storage_limit", value: fmtQuotaMbs(result.sq_storage_limit_mbs), mono: true },
        { label: "retention_days", value: result.retention_days ?? "—", mono: true },
      ]
    : [];

  const resultNode =
    failure || result ? (
      <ResultCard
        title={failure ? "Start 실패" : "Start 응답"}
        tone={failure ? "error" : "success"}
        rows={
          failure ? [{ label: "error", value: failure, tone: "bad" }] : resultRows
        }
        raw={result ?? undefined}
      >
        {/* 백그라운드 쿼터 검증 진행/결과 */}
        {quotaWatch.watching && (
          <p className="text-[11px] text-text-secondary">
            백그라운드 RTSP 탐색 기반 HQ 쿼터 검증 감시 중… (최대 45초, 부족할 때만 경고가 옴)
          </p>
        )}
        {quotaWatch.events.length > 0 && (
          <div className="space-y-1.5">
            {quotaWatch.events.map((e) => (
              <div key={String(e.id)} className="text-[11px]">
                <span className="text-status-error font-medium">{e.type}</span>{" "}
                <span className="text-text-secondary">{e.message}</span>
                <div className="font-mono text-[10px] text-text-muted mt-0.5 break-all">
                  {JSON.stringify(e.meta)}
                </div>
              </div>
            ))}
            <p className="text-[11px] text-text-muted">
              녹화는 계속 진행됨 — 보존 정책이 예상보다 일찍 오래된 세그먼트를 회수함.
            </p>
          </div>
        )}
      </ResultCard>
    ) : null;

  /* ────────────────── 렌더 ────────────────── */

  return (
    <PanelShell
      title="Start Recording"
      method="POST"
      endpoint="/api/start"
      description="새 녹화를 생성함. serial_number 가 그대로 recording_id 가 되며, 응답은 비동기 탐색 덕분에 즉시 돌아옴."
      targets={ctx.targets}
      requiresTarget={false}
      actionLabel="Start Recording"
      onSubmit={handleSubmit}
      loading={ctx.runner.running}
      blockedReason={blocked}
      actionsExtra={
        <Button variant="secondary" size="md" onClick={copyFromTarget}>
          대상 URL 복사
        </Button>
      }
      result={resultNode}
    >
      {/* ── 프리셋 ── */}
      <div className="flex items-end gap-2 pb-1">
        {/* 선택 즉시 폼에 적용됨. 선택 상태를 유지해 삭제 대상 지정에도 재사용함. */}
        <FormField
          label="프리셋 불러오기"
          value={selectedPreset}
          onChange={(v) => {
            setSelectedPreset(v);
            applyPreset(v);
          }}
          className="w-52"
        >
          <option value="">{presets.length ? "선택…" : "저장된 프리셋 없음"}</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </FormField>
        <FormField
          label="현재 설정 저장"
          value={presetName}
          onChange={setPresetName}
          placeholder="프리셋 이름"
          className="flex-1"
        />
        <Button variant="secondary" size="md" onClick={handleSavePreset}>
          저장
        </Button>
        <Button
          variant="ghost"
          size="md"
          disabled={!selectedPreset}
          onClick={() => {
            if (!selectedPreset) return;
            setPresets(deletePreset(selectedPreset));
            ctx.showToast(`프리셋 "${selectedPreset}" 삭제됨`, "info");
            setSelectedPreset("");
          }}
        >
          선택 삭제
        </Button>
      </div>

      {/* ── serial_number (필수) ── */}
      <div className="flex items-end gap-2">
        <FormField
          label="Serial Number → recording_id (필수)"
          value={form.serial}
          onChange={(v) => updateField("serial", v)}
          placeholder="cam-01"
          error={form.serial ? serialError ?? undefined : undefined}
          className="flex-1"
        />
        <Button variant="secondary" size="md" onClick={generateSerial}>
          자동 생성
        </Button>
      </div>
      <p className="text-[11px] text-text-muted -mt-1.5">
        서버가 <span className="font-mono">[A-Za-z0-9_-]</span> 1~128자만 허용함 (경로 컴포넌트로
        사용되기 때문). 위반 시 INVALID_ARGUMENT.
      </p>

      {/* ── RTSP URL ── */}
      <FormField
        label="HQ RTSP URL (필수)"
        value={form.hqUrl}
        onChange={(v) => updateField("hqUrl", v)}
        placeholder="rtsp://192.168.2.17:8554/proxy4"
        error={form.hqUrl ? hqError ?? undefined : undefined}
      />
      <FormField
        label="SQ RTSP URL (필수)"
        value={form.sqUrl}
        onChange={(v) => updateField("sqUrl", v)}
        placeholder="rtsp://192.168.2.17:8554/proxy4"
        error={form.sqUrl ? sqError ?? undefined : undefined}
      />

      {/* ── 인증 정보 ── */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="HQ Username" value={form.hqId} onChange={(v) => updateField("hqId", v)} />
        <FormField
          label="HQ Password"
          value={form.hqPass}
          onChange={(v) => updateField("hqPass", v)}
          type="password"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="SQ Username" value={form.sqId} onChange={(v) => updateField("sqId", v)} />
        <FormField
          label="SQ Password"
          value={form.sqPass}
          onChange={(v) => updateField("sqPass", v)}
          type="password"
        />
      </div>

      {/* ── 모드 / 코덱 / 보관기간 ── */}
      <div className="grid grid-cols-3 gap-3">
        <FormField
          label="Retention (days)"
          value={form.retention}
          onChange={(v) => updateField("retention", v)}
          type="number"
        />
        <FormField label="Mode" value={form.mode} onChange={(v) => updateField("mode", v)}>
          <option value="CONTINUOUS">CONTINUOUS</option>
          <option value="EVENT">EVENT</option>
        </FormField>
        {/* encoding.proto 의 Codec enum 이름과 정확히 일치해야 함 — 백엔드가
            record_pb2 로 넘기기 전 `Codec.Value(name)` 로 변환하므로, 이전 값이던
            "H264"/"H265" 는 enum 에 없어 `Enum Codec has no value defined for name 'H264'`
            로 **Start 가 항상 실패**했음. COPY = 재인코딩 없이 그대로 저장(서버 기본값). */}
        <FormField label="Codec" value={form.codec} onChange={(v) => updateField("codec", v)}>
          <option value="COPY">COPY (재인코딩 없음)</option>
          <option value="H264_SW">H264_SW</option>
          <option value="H264_NVENC">H264_NVENC</option>
        </FormField>
      </div>

      {/* ── 스토리지 쿼터 + 권장값 계산기 ── */}
      <div className="grid grid-cols-3 gap-3">
        <FormField
          label="HQ Storage Limit (MB)"
          value={form.hqStorage}
          onChange={(v) => updateField("hqStorage", v)}
          type="number"
        />
        <FormField
          label="SQ Storage Limit (MB)"
          value={form.sqStorage}
          onChange={(v) => updateField("sqStorage", v)}
          type="number"
        />
        <FormField
          label="예상 비트레이트 (Mbps)"
          value={form.bitrateMbps}
          onChange={(v) => updateField("bitrateMbps", v)}
          type="number"
        />
      </div>
      <div className="rounded-md bg-bg-subtle border border-border-subtle px-3 py-2 space-y-1">
        <p className="text-[11px] text-text-secondary">
          <span className="font-semibold text-text-primary">0 = 무제한</span> — 이 경우 서버는 쿼터
          검증용 RTSP 탐색 자체를 생략함.
        </p>
        <p className="text-[11px] text-text-secondary">
          0 보다 크면 Start 는 즉시 성공하고, 백그라운드 탐색이 끝난 뒤 부족할 때만
          <span className="font-mono"> DISK_THRESHOLD/WARN </span>이벤트로 통보됨 (녹화는 계속됨).
        </p>
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[11px] text-text-secondary">
            권장 HQ 쿼터 ≈{" "}
            <span className="font-mono tabular text-text-primary">
              {recommended.toLocaleString("ko-KR")} MB
            </span>{" "}
            ({form.retention}일 × {form.bitrateMbps}Mbps)
          </span>
          <button
            onClick={() => updateField("hqStorage", String(recommended))}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium text-brand bg-brand-soft hover:bg-brand hover:text-white transition-colors"
          >
            적용
          </button>
          {quotaShort && (
            <span className="text-[11px] text-status-pending">
              현재 값이 권장치보다 작음 — 시작 후 경고가 올 수 있음
            </span>
          )}
        </div>
      </div>

      <FormField label="Notes" value={form.notes} onChange={(v) => updateField("notes", v)} />
    </PanelShell>
  );
}
