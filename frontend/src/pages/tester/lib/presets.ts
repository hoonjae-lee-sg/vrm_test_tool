/**
 * Tester 프리셋/최근값 저장소 (localStorage)
 *
 * [왜 필요한가]
 * 같은 RTSP URL·카메라 계정·serial 접두어를 하루에도 수십 번 다시 타이핑하는 것이
 * 이 도구에서 가장 손이 많이 가는 지점임. 브라우저 로컬에만 남기면 되는 값이라
 * 서버 왕복 없이 localStorage 로 처리함.
 *
 * [저장 위치를 한 파일로 모으는 이유]
 * 키 문자열이 여러 컴포넌트에 흩어지면 오타 하나로 조용히 저장이 안 되는 버그가 생김.
 * 모든 읽기/쓰기를 여기서만 하고, JSON 파싱 실패(수동 편집/버전 변경)는 전부
 * 기본값 폴백으로 흡수해 페이지가 깨지지 않게 함.
 */

/** localStorage 키 접두어 — 다른 페이지 값과 충돌 방지 */
const NS = "vrm.tester";

/** 안전한 JSON 읽기 — 파싱 실패/차단(Safari 프라이빗 등) 시 fallback 반환 */
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${NS}.${key}`);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 안전한 JSON 쓰기 — 용량 초과/차단 시 조용히 무시 (부가 기능이므로 실패해도 무해) */
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${NS}.${key}`, JSON.stringify(value));
  } catch {
    /* quota 초과 또는 스토리지 차단 — 프리셋은 부가 기능이라 무시 */
  }
}

/* ────────────────── Start 폼 프리셋 ────────────────── */

/** 저장되는 Start 폼 스냅샷 — 비밀번호 포함 여부는 호출부가 결정함 */
export interface StartPreset {
  /** 프리셋 이름 (사용자 입력) */
  name: string;
  hqUrl: string;
  sqUrl: string;
  hqId: string;
  hqPass: string;
  sqId: string;
  sqPass: string;
  hqStorage: string;
  sqStorage: string;
  retention: string;
  mode: string;
  codec: string;
  /** serial 접두어 — 실제 serial 은 접두어 + 타임스탬프로 생성 */
  serialPrefix: string;
}

/** 프리셋 최대 보관 수 — 목록이 길어지면 고르는 것 자체가 일이 되므로 상한을 둠 */
const MAX_PRESETS = 12;

/** 저장된 Start 프리셋 목록 */
export function loadPresets(): StartPreset[] {
  const list = readJson<StartPreset[]>("presets", []);
  return Array.isArray(list) ? list.filter((p) => p && typeof p.name === "string") : [];
}

/** 프리셋 저장 (같은 이름은 덮어쓰기, 최신이 앞) */
export function savePreset(preset: StartPreset): StartPreset[] {
  const rest = loadPresets().filter((p) => p.name !== preset.name);
  const next = [preset, ...rest].slice(0, MAX_PRESETS);
  writeJson("presets", next);
  return next;
}

/** 프리셋 삭제 */
export function deletePreset(name: string): StartPreset[] {
  const next = loadPresets().filter((p) => p.name !== name);
  writeJson("presets", next);
  return next;
}

/* ────────────────── 마지막 입력값 자동 복원 ────────────────── */

/** 마지막 Start 폼 상태 — 새로고침/탭 이동 후에도 이어서 작업하도록 복원 */
export function loadLastForm<T>(fallback: T): T {
  const saved = readJson<Partial<T> | null>("lastForm", null);
  return saved ? { ...fallback, ...saved } : fallback;
}

/** 마지막 Start 폼 상태 저장 */
export function saveLastForm(form: unknown): void {
  writeJson("lastForm", form);
}

/* ────────────────── 최근 사용 recording_id ────────────────── */

/** 최근 타겟 보관 수 */
const MAX_RECENT = 8;

/** 최근 사용한 recording_id 목록 (최신 순) */
export function loadRecentTargets(): string[] {
  const list = readJson<string[]>("recentTargets", []);
  return Array.isArray(list) ? list.filter((v) => typeof v === "string" && v) : [];
}

/** 최근 타겟 추가 — 중복 제거 후 맨 앞으로 이동 */
export function pushRecentTarget(id: string): string[] {
  if (!id) return loadRecentTargets();
  const next = [id, ...loadRecentTargets().filter((v) => v !== id)].slice(0, MAX_RECENT);
  writeJson("recentTargets", next);
  return next;
}

/* ────────────────── 공통 auth_token ────────────────── */

/** 모든 패널이 공유하는 auth_token — 패널마다 따로 입력하던 값을 하나로 합침 */
export function loadAuthToken(): string {
  return readJson<string>("authToken", "");
}

/** 공통 auth_token 저장 */
export function saveAuthToken(token: string): void {
  writeJson("authToken", token);
}
