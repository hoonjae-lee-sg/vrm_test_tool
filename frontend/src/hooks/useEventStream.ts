import { useCallback, useEffect, useRef, useState } from "react";
import { buildEventStreamUrl, fetchRecentEvents } from "@/api/events";
import type { EventSeverity, FeedEvent } from "@/api/events";
import { EVENT_FEED_MAX_ITEMS, EVENT_FEED_PRELOAD_LIMIT } from "@/constants";

/**
 * 이벤트 SSE 구독 훅 — `GET /api/events/stream` (text/event-stream).
 *
 * [설계 근거]
 * · **선(先) 프리로드 + 후(後) 구독**: SSE 는 "구독 이후 발생분"만 흘려주므로 구독만
 *   걸면 화면이 빈 채로 시작함. 진입 시 `/api/events/recent` 로 과거분을 한 번 채운 뒤
 *   푸시를 이어 붙임.
 * · **id 기준 중복 제거**: 프리로드와 푸시가 경계에서 같은 이벤트를 중복 전달할 수 있음
 *   (구독 직전에 발생한 건). 서버 id("evt_65430a1d" 형태 문자열)로 Set 중복을 막음.
 * · **필터 변경 = 재구독**: recording_id / severity 는 쿼리스트링으로만 적용되므로
 *   값이 바뀌면 기존 EventSource 를 close 하고 새로 연다. close 를 빠뜨리면 백엔드의
 *   gRPC 스트림 워커 스레드가 남아 필터를 바꿀 때마다 서버 측 구독이 누적됨.
 * · **언마운트 정리**: effect cleanup 에서 반드시 close. 페이지 이탈 후에도 연결이
 *   남으면 backend/routers/events.py 의 `request.is_disconnected()` 폴링이 끊김을
 *   감지하기 전까지 스레드가 유지됨.
 * · **재연결 표시**: EventSource 는 끊기면 브라우저가 알아서 재시도하므로 우리가 다시
 *   열 필요는 없음. 다만 onerror 시 readyState 로 "재연결 중(CONNECTING)" 과
 *   "완전 종료(CLOSED)" 를 구분해 화면에 그대로 노출함.
 * · **재구독 디바운스**: 심각도 토글은 INFO/WARN/ERROR 를 연달아 누르기 쉬운 UI 라
 *   한 번의 의도에 재구독이 여러 번 발생함. 재구독 1회는 프론트 입장에선 EventSource
 *   교체지만 서버에서는 FastAPI 워커 스레드 + VRM gRPC StreamEvents 구독의
 *   생성/취소 왕복이며, 실측에서 이 연타 구간에 VRM 프로세스가 내려간 정황이 있었음
 *   (2026-09-03 12:35:01 세그먼트 기록 중단 · events.db 에 종료 이벤트 없음).
 *   원인 확정은 서버 몫이지만, 프론트는 "확정된 필터 1개 = 구독 1개" 로 맞춰
 *   불필요한 왕복을 만들지 않는 것이 맞으므로 짧게 눌러 담아 연다.
 */

/** 필터 확정 대기 시간(ms) — 이 시간 안의 추가 변경은 앞선 구독 시도를 취소함 */
const RESUBSCRIBE_DEBOUNCE_MS = 400;

/** SSE 연결 상태 — UI 배지에 그대로 대응 */
export type SseStatus = "connecting" | "open" | "reconnecting" | "closed";

/** useEventStream 옵션 */
export interface UseEventStreamOptions {
  /** 특정 녹화만 구독 — 빈 문자열이면 전체 */
  recordingId?: string;
  /** 심각도 필터 — 빈 배열이면 전체 */
  severity?: EventSeverity[];
  /** false 면 구독을 열지 않음 (일시 정지) */
  enabled?: boolean;
}

/** useEventStream 반환 */
export interface UseEventStreamResult {
  /** 최신순 이벤트 목록 (프리로드 + 푸시 병합) */
  events: FeedEvent[];
  /** SSE 연결 상태 */
  status: SseStatus;
  /** 이번 구독에서 수신한 푸시 건수 — "버튼을 눌렀더니 실제로 왔는가" 의 카운터 */
  pushCount: number;
  /** 마지막 수신 시각 (epoch ms) — 없으면 null */
  lastEventAt: number | null;
  /** 화면 목록 비우기 (서버 이력은 건드리지 않음) */
  clear: () => void;
}

export function useEventStream(opts: UseEventStreamOptions): UseEventStreamResult {
  const { recordingId, severity, enabled = true } = opts;

  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [status, setStatus] = useState<SseStatus>("connecting");
  const [pushCount, setPushCount] = useState(0);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  /** 이미 화면에 올린 이벤트 id 집합 — 프리로드/푸시 중복 차단 */
  const seenRef = useRef<Set<string>>(new Set());
  /** 현재 열려 있는 EventSource — cleanup 에서 close 하기 위해 보관 */
  const esRef = useRef<EventSource | null>(null);

  /** severity 배열은 매 렌더 새 참조가 되므로 문자열로 접어 effect 의존성으로 씀 */
  const sevKey = (severity ?? []).join(",");

  const clear = useCallback(() => {
    seenRef.current = new Set();
    setEvents([]);
    setPushCount(0);
    setLastEventAt(null);
  }, []);

  /** 중복을 걸러 최신순 목록 앞에 끼워 넣음 (상한 초과분은 뒤에서 잘라냄) */
  const pushEvents = useCallback((incoming: FeedEvent[], newestFirst: boolean) => {
    const fresh = incoming.filter((ev) => {
      const key = String(ev.id);
      if (seenRef.current.has(key)) return false;
      seenRef.current.add(key);
      return true;
    });
    if (fresh.length === 0) return 0;
    /* SSE 는 오래된 것부터 도착하므로 뒤집어 최신이 앞에 오게 맞춤 */
    const ordered = newestFirst ? fresh : [...fresh].reverse();
    setEvents((prev) => [...ordered, ...prev].slice(0, EVENT_FEED_MAX_ITEMS));
    return fresh.length;
  }, []);

  /* ── 필터가 바뀌면 목록을 비우고 과거분을 새로 프리로드 ── */
  useEffect(() => {
    let cancelled = false;
    seenRef.current = new Set();
    setEvents([]);
    const sevList = sevKey ? (sevKey.split(",") as EventSeverity[]) : undefined;
    fetchRecentEvents({
      limit: EVENT_FEED_PRELOAD_LIMIT,
      recordingId: recordingId || undefined,
      severity: sevList,
    })
      .then((list) => {
        /* 필터가 또 바뀐 뒤 늦게 도착한 응답이 새 목록을 오염시키지 않도록 폐기 */
        if (cancelled) return;
        pushEvents(list, true);
      })
      .catch(() => {
        /* 프리로드 실패는 치명적이지 않음 — SSE 로 이후 분은 계속 들어옴 */
      });
    return () => {
      cancelled = true;
    };
  }, [recordingId, sevKey, pushEvents]);

  /* ── SSE 구독 ── */
  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      setStatus("closed");
      return;
    }

    /* 직전 구독은 즉시 끊음 — 디바운스 대기 동안 옛 필터의 이벤트가 계속 들어와
       화면과 필터가 어긋나는 것을 막기 위함. 새 구독만 늦춰서 연다. */
    esRef.current?.close();
    esRef.current = null;
    setStatus("connecting");

    const sevList = sevKey ? (sevKey.split(",") as EventSeverity[]) : undefined;
    const url = buildEventStreamUrl({ recordingId: recordingId || undefined, severity: sevList });

    const timer = setTimeout(() => {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setStatus("open");

      es.onmessage = (msg: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(msg.data) as FeedEvent;
          const added = pushEvents([parsed], false);
          if (added > 0) {
            setPushCount((n) => n + added);
            setLastEventAt(Date.now());
          }
        } catch {
          /* 파싱 불가 프레임은 무시 — 한 건의 파손이 스트림 전체를 끊지 않게 함 */
        }
      };

      es.onerror = () => {
        /* EventSource 는 CONNECTING 으로 되돌아가며 브라우저가 자동 재시도함.
           CLOSED 는 더 이상 재시도하지 않는 종료 상태. */
        setStatus(es.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
      };
    }, RESUBSCRIBE_DEBOUNCE_MS);

    return () => {
      /* 타이머가 아직 안 터졌으면 구독 자체가 없던 일이 됨(= 서버 왕복 0회),
         이미 열렸으면 close 로 서버 스트림을 끊음. 언마운트 경로도 동일하게 탐. */
      clearTimeout(timer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [enabled, recordingId, sevKey, pushEvents]);

  return { events, status, pushCount, lastEventAt, clear };
}
