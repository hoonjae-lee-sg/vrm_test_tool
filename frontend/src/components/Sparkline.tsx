/**
 * 미니 라인/영역 차트 — Studio KPI 카드, Throughput 위젯에 사용
 * 데이터가 없으면 빈 placeholder 점선만 표시
 */

interface SparklineProps {
  /** 시계열 값 (0-100 정규화 권장). null/undefined면 빈 상태 */
  data?: number[] | null;
  /** SVG 너비 */
  width?: number;
  /** SVG 높이 */
  height?: number;
  /** 선/면 색상 (CSS color) */
  color?: string;
  /** 영역 채우기 여부 */
  fill?: boolean;
  /** 빈 상태 메시지 */
  emptyLabel?: string;
}

export default function Sparkline({
  data,
  width = 72,
  height = 28,
  color = "#1F4FE8",
  fill = false,
  emptyLabel = "no data",
}: SparklineProps) {
  /* 빈 상태 — 점선 베이스라인만 렌더 */
  if (!data || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[9px] text-text-muted/60 font-mono uppercase tracking-wider"
        style={{ width, height }}
      >
        <svg width={width} height={height} className="absolute">
          <line
            x1="0"
            y1={height / 2}
            x2={width}
            y2={height / 2}
            stroke="currentColor"
            strokeDasharray="2 3"
            opacity="0.3"
          />
        </svg>
        <span className="relative">{emptyLabel}</span>
      </div>
    );
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height}>
      {fill && <polygon points={areaPoints} fill={color} opacity="0.12" />}
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
