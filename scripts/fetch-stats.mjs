// GoatCounter API에서 통계를 받아 public/stats.json(숨은 통계 화면용 요약)을 만든다.
// GitHub Actions에서 GOATCOUNTER_TOKEN(통계 읽기 전용) 비밀값으로 실행. 토큰이 없으면 아무것도 하지 않는다.
// GoatCounter 세션은 꺼져 있어 모든 신호를 횟수로 센다. 사람 수가 필요한 신호는 앱이 기기마다 하루/한 시간에 1번만 보낸다:
//   visit/day(오늘 방문자), visit/hour(그 시간 활동한 사람), launch/*, notice/*, onboarding/* (하루 1번)
// 정답/오답은 문항별 경로(ok/q12)로 매번 보낸다.
import { writeFileSync } from "node:fs";

const TOKEN = process.env.GOATCOUNTER_TOKEN;
const BASE = "https://gichul-note.goatcounter.com/api/v0";
if (!TOKEN) {
  console.log("GOATCOUNTER_TOKEN 없음 — 통계 건너뜀");
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, params = new URLSearchParams()) {
  const url = `${BASE}${path}?${params}`;
  for (let tries = 0; ; tries++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
    if (res.status === 429 && tries < 5) {
      await sleep(1000);
      continue;
    }
    // 기간 안에 데이터가 하나도 없으면 404 not found 가 온다 → 빈 결과로 처리
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
    await sleep(300); // 초당 4회 제한
    return res.json();
  }
}

/** 기간 안의 모든 경로(화면·이벤트)별 방문자 수 + 일별·시간별 값. exclude_paths로 페이지를 넘긴다 */
async function allHits(start, end) {
  const out = new Map();
  for (let page = 0; page < 30; page++) {
    const p = new URLSearchParams({ start, end, limit: "100" });
    if (out.size) p.set("exclude_paths", [...out.values()].map((h) => h.path_id).join(","));
    const r = await api("/stats/hits", p);
    if (!r) break;
    const fresh = (r.hits ?? []).filter((h) => !out.has(h.path));
    fresh.forEach((h) => out.set(h.path, h));
    if (!r.more || !fresh.length) break;
  }
  return [...out.values()];
}

const DAY = 24 * 3600e3;
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
const now = new Date();
const endHour = new Date(Math.floor(now.getTime() / 3600e3) * 3600e3 + 3600e3);
// 한국 시간 오늘 0시
const kstNow = new Date(now.getTime() + 9 * 3600e3);
const todayStart = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3600e3);
const kstDay = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

const isVisit = (p) => p === "visit/day";
const isAnswer = (p) => /^(ok|wrong)\/q\d+$/.test(p);

function summarize(hits) {
  const c = (path) => hits.find((h) => h.path === path)?.count ?? 0;
  const sum = (re) => hits.filter((h) => re.test(h.path)).reduce((a, h) => a + h.count, 0);
  const per = new Map();
  for (const h of hits) {
    const m = /^(ok|wrong)\/q(\d+)$/.exec(h.path);
    if (!m) continue;
    const n = Number(m[2]);
    const v = per.get(n) ?? { n, ok: 0, wrong: 0 };
    v[m[1]] += h.count;
    per.set(n, v);
  }
  const qs = [...per.values()].sort((a, b) => a.n - b.n);
  const ok = qs.reduce((a, v) => a + v.ok, 0);
  const wrong = qs.reduce((a, v) => a + v.wrong, 0);
  // 시간대(0~23시)별 푼 문제: 문항 경로들의 hourly 합 (GoatCounter 계정의 시간대 기준)
  const hours = Array(24).fill(0);
  const visitHours = Array(24).fill(0);
  for (const h of hits) {
    const arr = isAnswer(h.path) ? hours : h.path === "visit/hour" ? visitHours : null;
    if (arr) for (const s of h.stats ?? []) (s.hourly ?? []).forEach((v, i) => (arr[i] += v));
  }
  return {
    visitors: c("visit/day"),
    homescreen: c("launch/homescreen"),
    browser: c("launch/browser"),
    solved: ok + wrong,
    ok,
    wrong,
    starts: sum(/^start\//),
    startsByTab: { exam: sum(/^start\/exam\//), book: sum(/^start\/book\//) },
    progress10: c("progress/10"),
    finishes: sum(/^finish\//),
    onboardingDone: c("onboarding/done"),
    onboardingSkip: [1, 2, 3, 4].map((k) => c(`onboarding/skip-${k}`)),
    noticeOpen: c("notice/open"),
    noticeKbi: c("notice/kbi"),
    hours,
    visitHours,
    questions: qs,
  };
}

/** 일별 추이: 문항·실행 경로의 daily 값을 날짜별로 합산 */
function daily(hits, days) {
  const map = new Map(days.map((d) => [d, { day: d, visitors: 0, solved: 0 }]));
  for (const h of hits) {
    const key = isVisit(h.path) ? "visitors" : isAnswer(h.path) ? "solved" : null;
    if (!key) continue;
    for (const s of h.stats ?? []) {
      const v = map.get(s.day);
      if (v) v[key] += s.daily ?? 0;
    }
  }
  return [...map.values()];
}

async function systems(start, end) {
  const r = await api("/stats/systems", new URLSearchParams({ start, end, limit: "6" }));
  return (r?.stats ?? []).map((s) => ({ name: s.name, count: s.count }));
}

const me = await api("/me");
console.log("GoatCounter 시간대:", me?.user?.settings?.timezone ?? me?.settings?.timezone ?? "(알 수 없음)");

const ranges = { today: 1, week: 7, month: 30 };
const out = { updated: now.toISOString(), ranges: {} };
let month = null;
for (const [key, n] of Object.entries(ranges)) {
  const start = new Date(todayStart.getTime() - (n - 1) * DAY);
  const prevStart = new Date(start.getTime() - n * DAY);
  // 지난 기간은 같은 길이·같은 시각까지만 비교(오늘 오후 2시면 어제도 오후 2시까지)
  const prevEnd = new Date(endHour.getTime() - n * DAY);
  const cur = await allHits(iso(start), iso(endHour));
  const prev = await allHits(iso(prevStart), iso(prevEnd));
  const s = summarize(cur);
  const p = summarize(prev);
  out.ranges[key] = {
    ...s,
    prev: { visitors: p.visitors, solved: p.solved, ok: p.ok },
    systems: await systems(iso(start), iso(endHour)),
  };
  if (key === "month") month = cur;
}
// 홈 화면용: 지난 24시간(마지막 '다 지난' 시각까지) 시간별 푼 문제 수. GoatCounter 계정 시간대가 한국(KR.Asia/Seoul)이라 day·hourly가 한국 시간
const lastFull = new Date(Math.floor(now.getTime() / 3600e3) * 3600e3 - 3600e3); // 다 지난 마지막 시각의 시작
const h48 = await allHits(iso(new Date(lastFull.getTime() - 47 * 3600e3)), iso(endHour));
const byHour = new Map(); // "날짜 시" → { solved, visitors }
for (const h of h48) {
  const key = isAnswer(h.path) ? "solved" : h.path === "visit/hour" ? "visitors" : null;
  if (!key) continue;
  for (const st of h.stats ?? [])
    (st.hourly ?? []).forEach((v, i) => {
      const k = `${st.day} ${i}`;
      const o = byHour.get(k) ?? { solved: 0, visitors: 0 };
      o[key] += v;
      byHour.set(k, o);
    });
}
out.last24 = Array.from({ length: 24 }, (_, k) => {
  const t = new Date(lastFull.getTime() - (23 - k) * 3600e3 + 9 * 3600e3); // 한국 시각
  const day = t.toISOString().slice(0, 10);
  const hour = t.getUTCHours();
  const o = byHour.get(`${day} ${hour}`) ?? { solved: 0, visitors: 0 };
  return { hour, solved: o.solved, visitors: o.visitors };
});

const days = Array.from({ length: 30 }, (_, i) => kstDay(new Date(todayStart.getTime() - (29 - i) * DAY)));
out.daily = daily(month ?? [], days);
const t = out.ranges.today;
console.log(`통계 저장: 오늘 방문 ${t.visitors} · 푼 문제 ${t.solved} · 문항 ${t.questions.length}개 / 30일 방문 ${out.ranges.month.visitors}`);
console.log("일별 샘플:", JSON.stringify(out.daily.slice(-3)));
writeFileSync("public/stats.json", JSON.stringify(out));
console.log("24시간:", out.last24.map((x) => `${x.hour}시 ${x.visitors}명/${x.solved}문제`).join(", "));
