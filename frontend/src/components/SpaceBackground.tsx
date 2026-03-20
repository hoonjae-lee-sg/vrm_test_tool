import { useMemo, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * 우주 배경 — 은하(SVG) + Canvas 행성(절차적 질감) + 랜덤 별
 * 행성은 Canvas 2D로 펄린 노이즈 기반 표면 렌더링
 */

/* ── 별 생성 ── */
interface Star { id: number; x: number; y: number; size: number; delay: number; duration: number; type: "dot" | "glow" | "cross"; }

function generateStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.random;
    const type = r() < 0.06 ? "cross" : r() < 0.25 ? "glow" : "dot";
    stars.push({ id: i, x: r() * 100, y: r() * 100, size: type === "cross" ? 3 : type === "glow" ? 2 : 1 + r() * 1.2, delay: r() * 8, duration: 2 + r() * 5, type });
  }
  return stars;
}

/* ── 경로 기반 위치 ── */
function seededRandom(seed: string, index: number): number {
  let h = 0;
  const s = seed + ":" + index;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return ((h & 0x7fffffff) % 10000) / 10000;
}
interface PlanetPos { x: number; y: number; }
interface PlanetPositions { gas: PlanetPos; rock: PlanetPos; moon: PlanetPos; }

function getPlanetPositions(path: string): PlanetPositions {
  if (path === "/") return { gas: { x: -18, y: 58 }, rock: { x: 82, y: 8 }, moon: { x: 70, y: 50 } };
  return {
    gas: { x: -10 + seededRandom(path, 0) * 40, y: 20 + seededRandom(path, 1) * 65 },
    rock: { x: 55 + seededRandom(path, 2) * 40, y: 3 + seededRandom(path, 3) * 55 },
    moon: { x: 30 + seededRandom(path, 4) * 60, y: 25 + seededRandom(path, 5) * 60 },
  };
}

/* ── 심플 노이즈 (2D value noise) ── */
function createNoise(seed: number) {
  // 해시 기반 의사 랜덤
  const hash = (x: number, y: number) => {
    let h = seed + x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h & 0x7fffffff) / 0x7fffffff;
  };
  // 보간된 노이즈
  const lerp = (a: number, b: number, t: number) => a + (b - a) * (t * t * (3 - 2 * t));
  return (x: number, y: number, octaves: number = 4) => {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      const ix = Math.floor(x * freq), iy = Math.floor(y * freq);
      const fx = (x * freq) - ix, fy = (y * freq) - iy;
      const tl = hash(ix, iy), tr = hash(ix + 1, iy);
      const bl = hash(ix, iy + 1), br = hash(ix + 1, iy + 1);
      val += lerp(lerp(tl, tr, fx), lerp(bl, br, fx), fy) * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return val / max;
  };
}

/* ── Canvas 행성 렌더링 ── */
interface PlanetConfig {
  radius: number;
  colors: [number, number, number][];   // RGB 팔레트
  bandStrength: number;                  // 밴드 줄무늬 강도 (0~1)
  noiseScale: number;                    // 노이즈 스케일
  seed: number;
  atmoColor: string;                     // 대기 글로우 색상
  atmoOpacity: number;
  specX: number; specY: number;          // 스펙큘러 위치 (0~1)
  hasRing?: boolean;
  ringColor?: string;
}

function renderPlanet(canvas: HTMLCanvasElement, config: PlanetConfig) {
  const { radius, colors, bandStrength, noiseScale, seed, atmoColor, atmoOpacity, specX, specY, hasRing, ringColor } = config;
  const size = (radius + 40) * 2;  // 대기 포함 여유
  const ringExtra = hasRing ? radius * 0.7 : 0;
  canvas.width = size + ringExtra * 2;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const noise = createNoise(seed);

  // 뒷쪽 링 (행성 뒤)
  if (hasRing && ringColor) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.35);
    ctx.scale(1, 0.18);
    const ringGrad = ctx.createLinearGradient(-radius * 1.6, 0, radius * 1.6, 0);
    ringGrad.addColorStop(0, "transparent");
    ringGrad.addColorStop(0.15, ringColor);
    ringGrad.addColorStop(0.5, ringColor.replace(/[\d.]+\)$/, "0.4)"));
    ringGrad.addColorStop(0.85, ringColor);
    ringGrad.addColorStop(1, "transparent");
    // 뒷쪽 반원만
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.6, radius * 1.6, 0, Math.PI, Math.PI * 2);
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = radius * 0.12;
    ctx.stroke();
    ctx.restore();
  }

  // 대기 글로우
  const atmoGrad = ctx.createRadialGradient(cx, cy, radius * 0.85, cx, cy, radius + 35);
  atmoGrad.addColorStop(0, "transparent");
  atmoGrad.addColorStop(0.5, atmoColor.replace(/[\d.]+\)$/, `${atmoOpacity})`));
  atmoGrad.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 35, 0, Math.PI * 2);
  ctx.fillStyle = atmoGrad;
  ctx.fill();

  // 행성 본체 — 픽셀별 노이즈 + 밴드
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  const imgData = ctx.createImageData(canvas.width, canvas.height);
  const d = imgData.data;

  for (let py = cy - radius; py < cy + radius; py++) {
    for (let px = cx - radius; px < cx + radius; px++) {
      const dx = px - cx, dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      // 구면 좌표 (3D 느낌)
      const nx = dx / radius, ny = dy / radius;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));

      // 노이즈 값 (구면 투영)
      const u = Math.atan2(nx, nz) / Math.PI;
      const v = ny;
      const n = noise(u * noiseScale, v * noiseScale, 5);

      // 밴드 패턴 (수평 줄무늬)
      const band = (Math.sin(v * 30) * 0.5 + 0.5) * bandStrength;

      // 팔레트 인덱스
      const t = Math.min(1, Math.max(0, n * 0.6 + band * 0.4));
      const ci = Math.min(colors.length - 2, Math.floor(t * (colors.length - 1)));
      const ct = t * (colors.length - 1) - ci;
      const c0 = colors[ci], c1 = colors[ci + 1];

      let r = c0[0] + (c1[0] - c0[0]) * ct;
      let g = c0[1] + (c1[1] - c0[1]) * ct;
      let b = c0[2] + (c1[2] - c0[2]) * ct;

      // 조명 (램버트 디퓨즈)
      const lightX = -0.4, lightY = -0.5, lightZ = 0.7;
      const lightLen = Math.sqrt(lightX * lightX + lightY * lightY + lightZ * lightZ);
      const dot = Math.max(0, (nx * lightX + ny * lightY + nz * lightZ) / lightLen);
      const ambient = 0.15;
      const lit = ambient + dot * 0.85;

      r *= lit; g *= lit; b *= lit;

      // 가장자리 어두워짐 (림 다크닝)
      const edge = 1 - Math.pow(dist / radius, 3);
      r *= edge; g *= edge; b *= edge;

      // 알파 (가장자리 안티앨리어싱)
      const alpha = Math.min(1, (radius - dist) * 2) * 255;

      const idx = (Math.floor(py) * canvas.width + Math.floor(px)) * 4;
      d[idx] = Math.min(255, r);
      d[idx + 1] = Math.min(255, g);
      d[idx + 2] = Math.min(255, b);
      d[idx + 3] = alpha;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 스펙큘러 하이라이트
  const sx = cx + (specX - 0.5) * radius * 1.2;
  const sy = cy + (specY - 0.5) * radius * 1.2;
  const specGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 0.5);
  specGrad.addColorStop(0, "rgba(255,255,255,0.35)");
  specGrad.addColorStop(0.3, "rgba(255,255,255,0.1)");
  specGrad.addColorStop(1, "transparent");
  ctx.fillStyle = specGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.restore();

  // 앞쪽 링 (행성 앞)
  if (hasRing && ringColor) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.35);
    ctx.scale(1, 0.18);
    const ringGrad = ctx.createLinearGradient(-radius * 1.6, 0, radius * 1.6, 0);
    ringGrad.addColorStop(0, "transparent");
    ringGrad.addColorStop(0.1, ringColor);
    ringGrad.addColorStop(0.3, ringColor.replace(/[\d.]+\)$/, "0.5)"));
    ringGrad.addColorStop(0.5, ringColor);
    ringGrad.addColorStop(0.7, ringColor.replace(/[\d.]+\)$/, "0.5)"));
    ringGrad.addColorStop(0.9, ringColor);
    ringGrad.addColorStop(1, "transparent");
    // 앞쪽 반원만
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.6, radius * 1.6, 0, 0, Math.PI);
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = radius * 0.12;
    ctx.stroke();
    // 밝은 내부 링
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.4, radius * 1.4, 0, 0, Math.PI);
    ctx.strokeStyle = ringColor.replace(/[\d.]+\)$/, "0.15)");
    ctx.lineWidth = radius * 0.03;
    ctx.stroke();
    ctx.restore();
  }
}

/* ── Canvas 행성 컴포넌트 ── */
function CanvasPlanet({ pos, config, floatDuration, floatDelay }: {
  pos: PlanetPos; config: PlanetConfig; floatDuration: string; floatDelay: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) renderPlanet(canvasRef.current, config);
  }, [config]);

  return (
    <div className="planet-wrap" style={{ transform: `translate(${pos.x}vw, ${pos.y}vh)` }}>
      <div className="planet-float-inner" style={{ animationDuration: floatDuration, animationDelay: floatDelay }}>
        <canvas ref={canvasRef} style={{ imageRendering: "auto" }} />
      </div>
    </div>
  );
}

/* ── 행성 설정 프리셋 ── */
const SATURN_CONFIG: PlanetConfig = {
  radius: 150,
  // 밝은 하늘색 팔레트 — 하이라이트~코어 모두 밝게
  colors: [[220, 235, 255], [170, 210, 255], [120, 175, 255], [80, 140, 230], [50, 100, 200], [30, 60, 150]],
  bandStrength: 0.6,
  noiseScale: 4,
  seed: 42,
  atmoColor: "rgba(130,190,255,0.4)",
  atmoOpacity: 0.2,
  specX: 0.3, specY: 0.25,
  hasRing: true,
  ringColor: "rgba(180,215,255,0.35)",
};

const ROCKY_CONFIG: PlanetConfig = {
  radius: 55,
  // 보라색 — 기존보다 밝게 (하이라이트 강화)
  colors: [[240, 215, 255], [200, 130, 255], [150, 70, 210], [100, 40, 160], [50, 15, 80]],
  bandStrength: 0.1,
  noiseScale: 6,
  seed: 77,
  atmoColor: "rgba(190,120,255,0.35)",
  atmoOpacity: 0.12,
  specX: 0.3, specY: 0.25,
};

const MOON_CONFIG: PlanetConfig = {
  radius: 24,
  // 초록색 — 기존보다 밝게 (하이라이트 강화)
  colors: [[190, 250, 225], [80, 220, 170], [20, 140, 100], [5, 70, 50]],
  bandStrength: 0.05,
  noiseScale: 8,
  seed: 123,
  atmoColor: "rgba(50,210,150,0.35)",
  atmoOpacity: 0.15,
  specX: 0.3, specY: 0.28,
};

/* ── 은하 ── */
function Galaxy() {
  return (
    <div className="galaxy-wrap">
      <svg viewBox="0 0 1000 1000" style={{ width: "110vmax", height: "110vmax", overflow: "visible" }}>
        <defs>
          <radialGradient id="g-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff8ee" stopOpacity="0.7" />
            <stop offset="5%" stopColor="#fde68a" stopOpacity="0.55" />
            <stop offset="12%" stopColor="#fbbf24" stopOpacity="0.35" />
            <stop offset="22%" stopColor="#f59e0b" stopOpacity="0.2" />
            <stop offset="35%" stopColor="#d97706" stopOpacity="0.1" />
            <stop offset="55%" stopColor="#92400e" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#1c1917" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="g-arm-pink" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fda4af" stopOpacity="0" />
            <stop offset="20%" stopColor="#fb7185" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#c084fc" stopOpacity="0.12" />
            <stop offset="80%" stopColor="#818cf8" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>
          <filter id="g-blur-lg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30" /></filter>
          <filter id="g-blur-md" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="15" /></filter>
          <filter id="g-blur-sm" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <g transform="rotate(-35, 500, 500)">
          <ellipse cx="500" cy="500" rx="420" ry="120" fill="rgba(139,92,246,0.06)" filter="url(#g-blur-lg)" />
          <ellipse cx="500" cy="500" rx="380" ry="100" fill="none" stroke="rgba(167,139,250,0.18)" strokeWidth="40" filter="url(#g-blur-lg)" />
          <ellipse cx="500" cy="500" rx="300" ry="80" fill="url(#g-arm-pink)" filter="url(#g-blur-md)" />
          <ellipse cx="500" cy="500" rx="220" ry="60" fill="none" stroke="rgba(251,113,133,0.15)" strokeWidth="50" filter="url(#g-blur-md)" />
          <ellipse cx="500" cy="508" rx="200" ry="8" fill="rgba(0,0,0,0.12)" filter="url(#g-blur-sm)" />
          <ellipse cx="500" cy="500" rx="180" ry="65" fill="url(#g-core)" filter="url(#g-blur-lg)" />
          <ellipse cx="500" cy="500" rx="120" ry="45" fill="url(#g-core)" filter="url(#g-blur-md)" />
          <ellipse cx="500" cy="500" rx="50" ry="20" fill="rgba(255,251,235,0.55)" filter="url(#g-blur-sm)" />
          <ellipse cx="500" cy="500" rx="15" ry="7" fill="rgba(255,255,255,0.7)" filter="url(#g-blur-sm)" />
        </g>
      </svg>
    </div>
  );
}

/* ── 메인 ── */
export default function SpaceBackground() {
  const location = useLocation();
  const stars = useMemo(() => generateStars(150), []);
  const positions = useMemo(() => getPlanetPositions(location.pathname), [location.pathname]);
  const isDashboard = location.pathname === "/";

  // 대시보드에서 가스 행성 크기 조절
  const saturnConfig = useMemo(() => ({
    ...SATURN_CONFIG,
    radius: isDashboard ? 300 : 150,
  }), [isDashboard]);

  return (
    <div className="space-bg">
      <Galaxy />
      <CanvasPlanet pos={positions.gas} config={saturnConfig} floatDuration="28s" floatDelay="0s" />
      <CanvasPlanet pos={positions.rock} config={ROCKY_CONFIG} floatDuration="20s" floatDelay="-5s" />
      <CanvasPlanet pos={positions.moon} config={MOON_CONFIG} floatDuration="16s" floatDelay="-8s" />
      {stars.map((s) => (
        <div key={s.id} className={`star--${s.type}`}
          style={{ top: `${s.y}%`, left: `${s.x}%`, width: `${s.size}px`, height: `${s.size}px`, animationDelay: `${s.delay}s`, animationDuration: `${s.duration}s` }} />
      ))}
    </div>
  );
}
