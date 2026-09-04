/**
 * epoch 타임스탬프 입력 필드
 *
 * [해결하는 문제]
 * Snapshot / Create Clip 은 `seconds`(epoch) 를 숫자로 요구하는데, 기존 UI 는 빈
 * number 입력 두 칸이 전부였음. 실무에서는 "지금", "30초 전" 을 넣고 싶은 것이므로
 * 매번 `date +%s` 를 계산해 붙여넣는 헛수고가 발생했음.
 * 여기서 상대 시각 버튼과 사람이 읽는 미리보기를 제공해 계산을 없앰.
 */
import { fmtEpochSeconds } from "../lib/format";

/* FormField 와 동일한 입력 스타일 — 여기서는 라벨을 필드 상단에 한 번만 두므로
   FormField(라벨 필수) 대신 순수 input 을 쓰고 클래스만 맞춤. */
const INPUT_CLASS =
  "w-full h-9 px-3 bg-bg-input border border-border rounded-md text-text-primary text-[13px] transition-colors hover:border-border-strong focus:border-brand placeholder:text-text-muted";

/** TimestampField Props */
interface TimestampFieldProps {
  /** epoch 초 (문자열 — 빈 값 허용) */
  seconds: string;
  setSeconds: (value: string) => void;
  /** 나노초 */
  nanos: string;
  setNanos: (value: string) => void;
  /** 비워둘 수 있는지 — Snapshot 은 비우면 "최신 프레임", Clip 은 필수 */
  optional?: boolean;
  /** 비워 뒀을 때의 의미 설명 */
  emptyHint?: string;
}

/** 상대 시각 버튼 정의 — 초 단위 오프셋 */
const OFFSETS: { label: string; delta: number }[] = [
  { label: "지금", delta: 0 },
  { label: "-5s", delta: -5 },
  { label: "-30s", delta: -30 },
  { label: "-1m", delta: -60 },
  { label: "-5m", delta: -300 },
];

export default function TimestampField({
  seconds,
  setSeconds,
  nanos,
  setNanos,
  optional = false,
  emptyHint,
}: TimestampFieldProps) {
  /** 현재 시각 기준 오프셋 적용 — 나노초는 0 으로 정규화 */
  const applyOffset = (delta: number) => {
    setSeconds(String(Math.floor(Date.now() / 1000) + delta));
    setNanos("0");
  };

  const isEmpty = seconds.trim() === "";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] text-text-secondary font-medium tracking-wide">
          Timestamp (epoch seconds)
        </label>
        {/* 상대 시각 단축 버튼 */}
        <div className="flex items-center gap-1">
          {OFFSETS.map((o) => (
            <button
              key={o.label}
              onClick={() => applyOffset(o.delta)}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium text-text-secondary bg-bg-subtle hover:bg-brand-soft hover:text-brand transition-colors"
            >
              {o.label}
            </button>
          ))}
          {optional && (
            <button
              onClick={() => {
                setSeconds("");
                setNanos("0");
              }}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium text-text-muted bg-bg-subtle hover:bg-bg-hover transition-colors"
            >
              비우기
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <input
          type="number"
          className={INPUT_CLASS}
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          placeholder={optional ? "비우면 최신 프레임" : "epoch seconds (필수)"}
        />
        <input
          type="number"
          className={INPUT_CLASS}
          value={nanos}
          onChange={(e) => setNanos(e.target.value)}
          placeholder="nanos"
        />
      </div>

      {/* 사람이 읽는 미리보기 — 자릿수 하나 틀린 epoch 를 바로 잡아냄 */}
      <p className="text-[11px] text-text-muted mt-1">
        {isEmpty ? (emptyHint ?? "미지정") : fmtEpochSeconds(seconds)}
      </p>
    </div>
  );
}
