/**
 * Live Grid 페이지
 * WebSocket MPEG-TS 라이브 스트림 그리드 뷰
 * - 동적 그리드 레이아웃 (1x1, 2x2, 3x3 자동 계산)
 * - 라이브 뷰 추가 모달 / 녹화 시작 모달
 * - 플로팅 녹화 목록 패널
 * - 공유 컴포넌트 (Modal, FloatingPanel, FormField) 활용
 */
import { useState, useEffect, useCallback } from "react";
import { useRecordings } from "@/hooks/useRecordings";
import { useToast } from "@/hooks/useToast";
import { startRecording, type StartRecordingParams } from "@/api/recording";
import type { Recording } from "@/types/recording";
import Modal from "@/components/Modal";
import FloatingPanel from "@/components/FloatingPanel";
import FormField from "@/components/FormField";
import StatusBadge from "@/components/StatusBadge";
import Toast from "@/components/Toast";
import Button from "@/components/Button";
import LiveCell from "@/pages/live/LiveCell";
import { PlusIcon, VideoCameraIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import {
  LIVE_REFRESH_INTERVAL_MS,
  MAX_LIVE_STREAMS,
  DEFAULT_RETENTION_DAYS,
} from "@/constants";

/* ────────────────── 스트림 식별 정보 ────────────────── */

/** 활성 스트림 항목 — uniqueId로 그리드 셀 구분 */
interface StreamInfo {
  /** 고유 식별자 (recId-quality-timestamp) */
  uniqueId: string;
  /** 녹화 ID */
  recId: string;
  /** 스트림 품질 (hq / sq) */
  quality: string;
}

/* ────────────────── 메인 컴포넌트 ────────────────── */

export default function LivePage() {
  const { recordings, refresh } = useRecordings(LIVE_REFRESH_INTERVAL_MS);
  const { toast, showToast } = useToast();

  /* 활성 스트림 목록 */
  const [streams, setStreams] = useState<StreamInfo[]>([]);

  /* 모달 상태 */
  const [viewModal, setViewModal] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [viewRecId, setViewRecId] = useState("");
  const [viewQuality, setViewQuality] = useState("hq");

  /* 녹화 시작 모달 폼 */
  const [addForm, setAddForm] = useState({
    recId: "",
    hqUrl: "",
    sqUrl: "",
    mode: "CONTINUOUS",
    codec: "H264",
    retention: String(DEFAULT_RETENTION_DAYS),
  });

  /* 플로팅 패널 접기 상태 */
  const [floatingMinimized, setFloatingMinimized] = useState(false);

  /* URL 파라미터에서 자동 스트림 추가 — ?id=xxx 형식 */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) {
      addStream(id, "hq");
    }
  }, []);

  /* ── 스트림 추가 ── */
  const addStream = useCallback(
    (recId: string, quality: string = "hq") => {
      /* 중복 스트림 방지 */
      if (streams.some((s) => s.recId === recId && s.quality === quality)) {
        showToast(`이미 ${recId} (${quality.toUpperCase()})를 보고 있습니다.`, "error");
        return;
      }
      /* 최대 스트림 수 제한 */
      if (streams.length >= MAX_LIVE_STREAMS) {
        showToast("최대 9개 스트림까지 가능합니다.", "error");
        return;
      }
      const uniqueId = `${recId}-${quality}-${Date.now()}`;
      setStreams((prev) => [...prev, { uniqueId, recId, quality }]);
    },
    [streams, showToast]
  );

  /* ── 스트림 제거 ── */
  const removeStream = useCallback((uniqueId: string) => {
    setStreams((prev) => prev.filter((s) => s.uniqueId !== uniqueId));
  }, []);

  /* ── 녹화 시작 요청 ── */
  const handleStartRecording = async () => {
    if (!addForm.hqUrl || !addForm.sqUrl) {
      showToast("HQ/SQ URL을 입력해주세요.", "error");
      return;
    }
    try {
      const params: StartRecordingParams = {
        serial_number: addForm.recId || `SN-${Date.now()}`,
        hq_url: addForm.hqUrl,
        sq_url: addForm.sqUrl,
        recording_mode: addForm.mode,
        encoding_codec: addForm.codec,
        retention_days: parseInt(addForm.retention) || DEFAULT_RETENTION_DAYS,
      };
      await startRecording(params);
      setAddModal(false);
      refresh();
      showToast("녹화가 시작되었습니다.", "success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`녹화 시작 실패: ${message}`, "error");
    }
  };

  /* ── 그리드 크기 계산 — 스트림 수에 따라 1x1, 2x2, 3x3 자동 결정 ── */
  const count = streams.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* ── 헤더 바 — 글래스모피즘 배경 ── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white/[0.02] backdrop-blur-xl border-b border-white/[0.06]">
        <h1 className="text-sm font-bold text-text-primary">Live Grid</h1>
        <div className="flex-1" />
        <button
          onClick={() => {
            setViewRecId("");
            setViewModal(true);
          }}
          className="flex items-center gap-1 px-3 py-1.5 bg-brand/10 text-brand text-xs rounded hover:bg-brand/20 transition"
        >
          <PlusIcon className="w-4 h-4" /> View Live Stream
        </button>
        <button
          onClick={() => {
            setAddForm({
              recId: `SN-${Date.now()}`,
              hqUrl: "",
              sqUrl: "",
              mode: "CONTINUOUS",
              codec: "H264",
              retention: String(DEFAULT_RETENTION_DAYS),
            });
            setAddModal(true);
          }}
          className="flex items-center gap-1 px-3 py-1.5 bg-brand text-white text-xs rounded hover:bg-brand/80 transition"
        >
          <VideoCameraIcon className="w-4 h-4" /> Start Recording
        </button>
      </div>

      {/* ── 그리드 영역 ── */}
      <div className="flex-1 p-2 overflow-hidden">
        {count === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">
            활성 라이브 스트림이 없습니다. &quot;+ View Live Stream&quot;을 클릭하세요.
          </div>
        ) : (
          <div
            className="w-full h-full grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            }}
          >
            {streams.map((stream) => (
              <LiveCell
                key={stream.uniqueId}
                uniqueId={stream.uniqueId}
                recId={stream.recId}
                quality={stream.quality}
                onRemove={removeStream}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 라이브 뷰 추가 모달 ── */}
      <Modal isOpen={viewModal} onClose={() => setViewModal(false)} title="라이브 뷰 추가">
        <div className="space-y-3">
          <FormField
            label="Recording ID"
            value={viewRecId}
            onChange={setViewRecId}
            placeholder="Recording ID 입력"
          />
          <FormField label="Quality" value={viewQuality} onChange={setViewQuality}>
            <option value="hq">HQ (High Quality)</option>
            <option value="sq">SQ (Standard Quality)</option>
          </FormField>
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" size="md" onClick={() => setViewModal(false)}>
            취소
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              if (!viewRecId.trim()) return showToast("Recording ID를 입력하세요.", "error");
              addStream(viewRecId.trim(), viewQuality);
              setViewModal(false);
            }}
          >
            확인
          </Button>
        </div>
      </Modal>

      {/* ── 녹화 시작 모달 ── */}
      <Modal isOpen={addModal} onClose={() => setAddModal(false)} title="녹화 시작">
        <div className="space-y-3">
          <FormField
            label="Serial Number"
            value={addForm.recId}
            onChange={(v) => setAddForm((p) => ({ ...p, recId: v }))}
          />
          <FormField
            label="HQ RTSP URL"
            value={addForm.hqUrl}
            onChange={(v) => setAddForm((p) => ({ ...p, hqUrl: v }))}
            placeholder="rtsp://..."
          />
          <FormField
            label="SQ RTSP URL"
            value={addForm.sqUrl}
            onChange={(v) => setAddForm((p) => ({ ...p, sqUrl: v }))}
            placeholder="rtsp://..."
          />
          <div className="grid grid-cols-3 gap-3">
            <FormField
              label="Mode"
              value={addForm.mode}
              onChange={(v) => setAddForm((p) => ({ ...p, mode: v }))}
            >
              <option value="CONTINUOUS">CONTINUOUS</option>
              <option value="EVENT">EVENT</option>
            </FormField>
            <FormField
              label="Codec"
              value={addForm.codec}
              onChange={(v) => setAddForm((p) => ({ ...p, codec: v }))}
            >
              <option value="H264">H264</option>
              <option value="H265">H265</option>
            </FormField>
            <FormField
              label="Retention"
              value={addForm.retention}
              onChange={(v) => setAddForm((p) => ({ ...p, retention: v }))}
              type="number"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <Button variant="secondary" size="md" onClick={() => setAddModal(false)}>
            취소
          </Button>
          <Button variant="primary" size="md" onClick={handleStartRecording}>
            Start Recording
          </Button>
        </div>
      </Modal>

      {/* ── 플로팅 녹화 목록 패널 ── */}
      <FloatingPanel
        title="Recordings"
        isMinimized={floatingMinimized}
        onToggleMinimize={() => setFloatingMinimized(!floatingMinimized)}
        className="fixed bottom-4 right-4 w-64"
      >
        {/* 새로고침 버튼 — 패널 헤더 내 절대 위치 배치 */}
        <button
          onClick={(e) => { e.stopPropagation(); refresh(); }}
          className="absolute top-2 right-8 text-xs text-text-muted hover:text-text-primary z-10"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
        </button>
        <div className="max-h-52 overflow-y-auto">
          {(recordings as Recording[]).map((rec) => (
            <div
              key={rec.recording_id}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-card-hover cursor-pointer text-xs"
              onClick={() => {
                setViewRecId(rec.recording_id);
                setViewModal(true);
              }}
            >
              <span className="font-mono text-text-primary truncate flex-1">
                {rec.recording_id}
              </span>
              <StatusBadge state={rec.state} />
            </div>
          ))}
        </div>
      </FloatingPanel>

      {/* 토스트 알림 */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
