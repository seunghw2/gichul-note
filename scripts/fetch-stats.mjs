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

/** 사이트의 모든 경로 ID 목록(통계 없이 이름만). after 커서로 끝까지 넘겨서 개수 상한이 없다 */
let pathIds = null;
async function allPathIds() {
  if (pathIds) return pathIds;
  const ids = [];
  let after = 0;
  for (let page = 0; page < 500; page++) {
    const p = new URLSearchParams({ limit: "200" });
    if (after) p.set("after", String(after));
    const r = await api("/paths", p);
    const list = r?.paths ?? [];
    list.forEach((x) => ids.push(x.id));
    if (!r?.more || !list.length) break;
    after = list[list.length - 1].id;
  }
  pathIds = ids;
  console.log(`경로 ${ids.length}개`);
  return ids;
}

/** 기간 안의 모든 경로별 값. 경로 ID를 100개씩 묶어 include_paths로 받아서 개수 상한·주소 길이 문제가 없다.
    (경로 목록 API가 실패하면 예전 방식으로) */
async function allHits(start, end) {
  // 경로 목록 방식은 실제 데이터에서 일부 경로만 잡혀(536개, 값 누락) 확인될 때까지 끔 → 예전 방식 사용
  if (!process.env.STATS_PATHLIST) return allHitsLegacy(start, end);
  let ids;
  try {
    ids = await allPathIds();
  } catch (e) {
    console.log("경로 목록 실패 → 예전 방식:", e.message);
    return allHitsLegacy(start, end);
  }
  if (!ids.length) return allHitsLegacy(start, end);
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const p = new URLSearchParams({ start, end, limit: "100", include_paths: ids.slice(i, i + 100).join(",") });
    const r = await api("/stats/hits", p);
    for (const h of r?.hits ?? []) if (!out.has(h.path)) out.set(h.path, h);
  }
  return [...out.values()];
}

/** 예전 방식: 많이 나온 순으로 100개씩 최대 30쪽(3,000개)까지 */
async function allHitsLegacy(start, end) {
  const out = new Map();
  for (let page = 0; page < 100; page++) {
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
const isLaunch = (p) => p === "launch/homescreen" || p === "launch/browser";
const isAnswer = (p) => /^(ok|wrong)\/q\d+$/.test(p); // 예전 문항별 신호(2026-10-10 중단)
const isSolve = (p) => /^ua\/u[\w-]+$/.test(p); // 사람별 풀이 신호 = 푼 문제

function summarize(hits) {
  const c = (path) => hits.find((h) => h.path === path)?.count ?? 0;
  const sum = (re) => hits.filter((h) => re.test(h.path)).reduce((a, h) => a + h.count, 0);
  // 푼 문제: 사람별 풀이 신호(ua/<번호>)의 합. 예전 문항별 신호(ok·wrong/q번호, 2026-10-10 중단)와 비교해 큰 값(ua는 10-08 21시부터)
  const legacy = sum(/^(ok|wrong)\/q\d+$/);
  const uaSum = sum(/^ua\//);
  const solved = Math.max(uaSum, legacy);
  if (process.env.STATS_DEBUG_ONCE !== "done") {
    console.log(`검증: 사람별 풀이 합 ${uaSum} vs 문항별 정답+오답 ${legacy}`);
    process.env.STATS_DEBUG_ONCE = "done";
  }
  // 시간대(0~23시)별 푼 문제·방문자 (GoatCounter 계정의 시간대 기준). 푼 문제는 ua와 예전 신호 중 큰 값
  const hoursUa = Array(24).fill(0);
  const hoursOld = Array(24).fill(0);
  const visitHours = Array(24).fill(0);
  for (const h of hits) {
    const arr = isSolve(h.path) ? hoursUa : isAnswer(h.path) ? hoursOld : h.path === "visit/hour" ? visitHours : null;
    if (arr) for (const s of h.stats ?? []) (s.hourly ?? []).forEach((v, i) => (arr[i] += v));
  }
  const hours = hoursUa.map((v, i) => Math.max(v, hoursOld[i]));
  return {
    // 새 신호(visit/day)가 생기기 전 기록은 예전 앱 실행 신호(launch/*)로 대신 (지금은 둘 다 기기마다 하루 1번이라 같은 값)
    visitors: Math.max(c("visit/day"), c("launch/homescreen") + c("launch/browser")),
    homescreen: c("launch/homescreen"),
    browser: c("launch/browser"),
    solved,
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
    newVisitors: c("visit/new"),
    returning: c("visit/return"),
    streak3: c("streak/3plus"),
    bookmarks: hits
      .map((h) => ({ m: /^bm\/q(\d+)$/.exec(h.path), count: h.count }))
      .filter((x) => x.m)
      .map((x) => ({ n: Number(x.m[1]), count: x.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    devices: Object.fromEntries(hits.filter((h) => /^device\//.test(h.path)).map((h) => [h.path.slice(7), h.count])),
    modes: Object.fromEntries(["all", "wrong", "bm", "often"].map((k) => [k, { start: sum(new RegExp(`^start/[a-z]+/${k}$`)), finish: sum(new RegExp(`^finish/[a-z]+/${k}$`)) }])),
  };
}

/** 일별 추이: 문항·실행 경로의 daily 값을 날짜별로 합산 */
function daily(hits, days) {
  const map = new Map(days.map((d) => [d, { day: d, visitors: 0, solved: 0, old: 0, launches: 0 }]));
  for (const h of hits) {
    const key = isVisit(h.path) ? "visitors" : isSolve(h.path) ? "solved" : isAnswer(h.path) ? "old" : isLaunch(h.path) ? "launches" : null;
    if (!key) continue;
    for (const s of h.stats ?? []) {
      const v = map.get(s.day);
      if (v) v[key] += s.daily ?? 0;
    }
  }
  // 새 신호가 없던 날은 예전 앱 실행 신호로 대신
  return [...map.values()].map(({ launches, old, ...v }) => ({ ...v, solved: Math.max(v.solved, old), visitors: Math.max(v.visitors, launches) }));
}

async function toprefs(start, end) {
  const r = await api("/stats/toprefs", new URLSearchParams({ start, end, limit: "6" }));
  return (r?.stats ?? []).map((s) => ({ name: s.name, count: s.count }));
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
    prev: { visitors: p.visitors, solved: p.solved },
    systems: [],
  };
  if (key === "month") month = cur;
}
// 홈 화면용: 지난 24시간(마지막 '다 지난' 시각까지) 시간별 푼 문제 수. GoatCounter 계정 시간대가 한국(KR.Asia/Seoul)이라 day·hourly가 한국 시간
const lastFull = new Date(Math.floor(now.getTime() / 3600e3) * 3600e3 - 3600e3); // 다 지난 마지막 시각의 시작
const h48 = await allHits(iso(new Date(lastFull.getTime() - 47 * 3600e3)), iso(endHour));
const byHour = new Map(); // "날짜 시" → { solved, visitors }
for (const h of h48) {
  const key = isSolve(h.path) ? "solved" : isAnswer(h.path) ? "old" : h.path === "visit/hour" ? "visitors" : null;
  if (!key) continue;
  for (const st of h.stats ?? [])
    (st.hourly ?? []).forEach((v, i) => {
      const k = `${st.day} ${i}`;
      const o = byHour.get(k) ?? { solved: 0, old: 0, visitors: 0 };
      o[key] += v;
      byHour.set(k, o);
    });
}
out.last24 = Array.from({ length: 24 }, (_, k) => {
  const t = new Date(lastFull.getTime() - (23 - k) * 3600e3 + 9 * 3600e3); // 한국 시각
  const day = t.toISOString().slice(0, 10);
  const hour = t.getUTCHours();
  const o = byHour.get(`${day} ${hour}`) ?? { solved: 0, old: 0, visitors: 0 };
  o.solved = Math.max(o.solved, o.old);
  return { hour, solved: o.solved, visitors: o.visitors };
});

const days = Array.from({ length: 30 }, (_, i) => kstDay(new Date(todayStart.getTime() - (29 - i) * DAY)));
out.daily = daily(month ?? [], days);
// ---- 사용자별(숨은 통계 전용): ud/<익명번호>=처음 푼 문항(누적 푼 문제 수), ua/<익명번호>=푼 횟수
// 표는 STATS_KEY(비밀번호)로 암호화(PBKDF2-SHA256 10만 회 + AES-GCM)해서 넣는다. 키가 없으면 넣지 않음
if (process.env.STATS_KEY) {
  const allStart = iso(new Date("2026-10-01T00:00:00Z"));
  const all = await allHits(allStart, iso(endHour));
  const today = await allHits(iso(todayStart), iso(endHour));
  const week = await allHits(iso(new Date(todayStart.getTime() - 6 * DAY)), iso(endHour));
  // 기록 옮기기로 번호를 이어받은 경우(alias/<예전 번호>/<이어받은 번호>): 예전 번호 줄을 이어받은 번호 줄에 합친다
  const alias = new Map();
  for (const h of all) {
    const m = /^alias\/(u[\w-]+)\/(u[\w-]+)$/.exec(h.path);
    if (m && m[1] !== m[2]) alias.set(m[1], m[2]);
  }
  const resolve = (id) => {
    const seen = new Set([id]);
    while (alias.has(id) && !seen.has(alias.get(id))) seen.add((id = alias.get(id)));
    return id;
  };
  const users = new Map();
  const u = (raw) => {
    const id = resolve(raw);
    return users.get(id) ?? users.set(id, { id, total: 0, distinct: 0, today: 0, week: 0, last: "" }).get(id);
  };
  for (const h of all) {
    const m = /^(ud|ua)\/(u[\w-]+)$/.exec(h.path);
    if (!m) continue;
    const r = u(m[2]);
    if (m[1] === "ud") r.distinct += h.count;
    else r.total += h.count; // 다시 푼 것까지 포함한 누적 풀이 횟수
    for (const st of h.stats ?? []) if ((st.daily ?? 0) > 0 && st.day > r.last) r.last = st.day;
  }
  for (const [list, key] of [[today, "today"], [week, "week"]]) {
    for (const h of list) {
      const m = /^ua\/(u[\w-]+)$/.exec(h.path);
      if (m) u(m[1])[key] += h.count;
    }
  }
  // 순위: 누적 풀이 횟수(다시 푼 것 포함). 사용자별 풀이 신호(ua)는 2026-10-08 21시부터라 그 전 풀이는 '처음 푼 문항' 수로 보정
  for (const r of users.values()) r.total = Math.max(r.total, r.distinct);
  const rows = [...users.values()].sort((a, b) => b.total - a.total || b.week - a.week);
  const { webcrypto } = await import("node:crypto");
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  // 앞뒤 공백·줄바꿈을 지우고 한글 자모 조합 방식(NFC)을 맞춘다 — 폰에서 입력한 값과 같게
  const raw = process.env.STATS_KEY;
  const pass = raw.trim().normalize("NFC");
  console.log(`STATS_KEY 길이 ${raw.length} → 정리 후 ${pass.length} (값은 출력 안 함)`);
  const base = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const data = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(rows))));
  const b64 = (x) => Buffer.from(x).toString("base64");
  out.users = { salt: b64(salt), iv: b64(iv), data: b64(data) };
  console.log(`사용자별: ${rows.length}명 (암호화)`);
} else console.log("STATS_KEY 없음 — 사용자별 표 건너뜀");

const t = out.ranges.today;
console.log(`통계 저장: 오늘 방문 ${t.visitors} · 푼 문제 ${t.solved} / 30일 방문 ${out.ranges.month.visitors}`);
console.log("일별 샘플:", JSON.stringify(out.daily.slice(-3)));
writeFileSync("public/stats.json", JSON.stringify(out));
console.log("24시간:", out.last24.map((x) => `${x.hour}시 ${x.visitors}명/${x.solved}문제`).join(", "));
