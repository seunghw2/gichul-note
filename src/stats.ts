/* 익명 사용 통계(GoatCounter). GoatCounter 세션(같은 사람 묶기)은 꺼져 있어 모든 신호를 횟수로 센다.
   그래서 '사람 수'가 필요한 신호는 앱이 이 기기에서 하루(또는 한 시간)에 한 번만 보낸다(trackOnce). 화면 이름·버튼 이름·문항 번호만 보내고, 풀이 기록 등 localStorage 내용은 보내지 않는다.
   집계 끄기(내 기기): 주소 뒤에 #toggle-goatcounter 를 붙여 한 번 열기 */
type GC = { count: (v: { path: string; title?: string; event?: boolean }) => void };
const gc = () => (window as unknown as { goatcounter?: GC }).goatcounter;

// 스크립트가 비동기로 늦게 뜨므로, 준비 전 신호는 모아 뒀다가 보낸다
const queue: Parameters<GC["count"]>[0][] = [];
function send(v: Parameters<GC["count"]>[0]) {
  const g = gc();
  if (g?.count) g.count(v);
  else queue.push(v);
}
const flush = setInterval(() => {
  const g = gc();
  if (!g?.count) return;
  clearInterval(flush);
  queue.splice(0).forEach((v) => g.count(v));
}, 500);
setTimeout(() => clearInterval(flush), 15000);

let lastView = "";
/** 화면 보기(같은 화면을 다시 그릴 때는 세지 않음) */
export function pageview(view: string) {
  if (view === lastView) return;
  lastView = view;
  send({ path: `/${view}` });
}

/** 버튼·행동 이벤트 */
export const track = (name: string) => send({ path: name, title: name, event: true });

/** 이 기기에서 하루(day) 또는 한 시간(hour)에 한 번만 보내는 신호 → GoatCounter에서 '사람 수'로 읽힘 */
const p2 = (n: number) => String(n).padStart(2, "0");
const dayStr = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** ever = 이 기기에서 딱 한 번 */
export function trackOnce(name: string, per: "day" | "hour" | "ever") {
  const d = new Date();
  const bucket = per === "ever" ? "1" : `${dayStr(d)}${per === "hour" ? ` ${p2(d.getHours())}` : ""}`;
  const key = `gichul:gc-once:${name}`;
  try {
    if (localStorage.getItem(key) === bucket) return;
    localStorage.setItem(key, bucket);
  } catch {
    /* 저장이 안 되면 그냥 보냄 */
  }
  track(name);
}

/** 방문자 신호: 오늘 방문자(하루 1번) + 이 시간 활동한 사람(한 시간 1번)
    하루 첫 방문 때 처음 온 사람인지(visit/new) 다시 온 사람인지(visit/return), 3일 이상 연속인지(streak/3plus)도 함께 */
export function markActive() {
  const today = dayStr(new Date());
  let prev: string | null = null;
  let hasRecords = false;
  try {
    prev = localStorage.getItem("gichul:gc-once:visit/day");
    hasRecords = Object.keys(localStorage).some((k) => /^gichul:[^:]+$/.test(k) && !/^gichul:(prefs|theme|onboarded|today)$/.test(k));
  } catch {
    /* 무시 */
  }
  if (prev !== today) {
    track(prev || hasRecords ? "visit/return" : "visit/new");
    const y = new Date();
    y.setDate(y.getDate() - 1);
    let streak = 1;
    try {
      const last = JSON.parse(localStorage.getItem("gichul:gc-streak") ?? "null") as { d: string; n: number } | null;
      streak = last && last.d === dayStr(y) ? last.n + 1 : 1;
      localStorage.setItem("gichul:gc-streak", JSON.stringify({ d: today, n: streak }));
    } catch {
      /* 무시 */
    }
    if (streak >= 3) track("streak/3plus");
  }
  trackOnce("visit/day", "day");
  trackOnce("visit/hour", "hour");
}

/* ---------- 사용자별 학습량(숨은 통계 전용): 기기마다 무작위 익명 번호 ---------- */
const ID_KEY = "gichul:gc-id";
export function anonId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = "u" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return "u-nostore";
  }
}
const udKey = (n: number) => `gichul:gc-ud:${n}`;
/** 문항을 채점할 때: ua(매번, 푼 횟수) + ud(이 기기에서 그 문항을 처음 풀 때만, 푼 문제 수) */
export function trackSolve(n: number) {
  const id = anonId();
  track(`ua/${id}`);
  try {
    if (localStorage.getItem(udKey(n))) return;
    localStorage.setItem(udKey(n), "1");
  } catch {
    return;
  }
  track(`ud/${id}`);
}
/** 이 기능 전에 이미 푼 문항을 한 번에 맞춰 보냄(문항마다 한 번) */
export function backfillSolved(solved: number[]) {
  const id = anonId();
  const todo: number[] = [];
  try {
    for (const n of solved) if (!localStorage.getItem(udKey(n))) todo.push(n);
    todo.forEach((n) => localStorage.setItem(udKey(n), "1"));
  } catch {
    return;
  }
  todo.forEach((_, i) => setTimeout(() => track(`ud/${id}`), 200 + i * 60));
}
