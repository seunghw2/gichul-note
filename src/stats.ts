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
export function trackOnce(name: string, per: "day" | "hour") {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const bucket = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}${per === "hour" ? ` ${p2(d.getHours())}` : ""}`;
  const key = `gichul:gc-once:${name}`;
  try {
    if (localStorage.getItem(key) === bucket) return;
    localStorage.setItem(key, bucket);
  } catch {
    /* 저장이 안 되면 그냥 보냄 */
  }
  track(name);
}

/** 방문자 신호: 오늘 방문자(하루 1번) + 이 시간 활동한 사람(한 시간 1번) */
export function markActive() {
  trackOnce("visit/day", "day");
  trackOnce("visit/hour", "hour");
}
