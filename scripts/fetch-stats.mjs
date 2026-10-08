// GoatCounter API에서 통계를 받아 public/stats.json(숨은 통계 화면용 요약)을 만든다.
// GitHub Actions에서 GOATCOUNTER_TOKEN(통계 읽기 전용) 비밀값으로 실행. 토큰이 없으면 아무것도 하지 않는다.
import { writeFileSync } from "node:fs";

const TOKEN = process.env.GOATCOUNTER_TOKEN;
const BASE = "https://gichul-note.goatcounter.com/api/v0";
if (!TOKEN) {
  console.log("GOATCOUNTER_TOKEN 없음 — 통계 건너뜀");
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, params) {
  const url = `${BASE}${path}?${params}`;
  for (let tries = 0; ; tries++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
    if (res.status === 429 && tries < 5) {
      await sleep(1000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
    await sleep(300); // 초당 4회 제한
    return res.json();
  }
}

/** 기간 안의 모든 경로(화면·이벤트)별 방문자 수. exclude_paths로 페이지를 넘긴다 */
async function allHits(start, end) {
  const out = new Map();
  for (let page = 0; page < 30; page++) {
    const p = new URLSearchParams({ start, end, limit: "100" });
    if (out.size) p.set("exclude_paths", [...out.values()].map((h) => h.path_id).join(","));
    const r = await api("/stats/hits", p);
    const fresh = (r.hits ?? []).filter((h) => !out.has(h.path));
    fresh.forEach((h) => out.set(h.path, h));
    if (!r.more || !fresh.length) break;
  }
  return [...out.values()];
}

const hourFloor = (d) => new Date(Math.floor(d.getTime() / 3600e3) * 3600e3);
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");

function summarize(hits) {
  const c = (path) => hits.find((h) => h.path === path)?.count ?? 0;
  const sum = (re) => hits.filter((h) => re.test(h.path)).reduce((a, h) => a + h.count, 0);
  // 문항별 정답/오답: ok/q12, wrong/q12 (같은 사람·몇 시간 안 중복은 GoatCounter가 1번으로 셈)
  const per = new Map();
  for (const h of hits) {
    const m = /^(ok|wrong)\/q(\d+)$/.exec(h.path);
    if (!m) continue;
    const n = Number(m[2]);
    const v = per.get(n) ?? { n, ok: 0, wrong: 0 };
    v[m[1]] += h.count;
    per.set(n, v);
  }
  const ok = [...per.values()].reduce((a, v) => a + v.ok, 0);
  const wrong = [...per.values()].reduce((a, v) => a + v.wrong, 0);
  return {
    visitors: c("launch/homescreen") + c("launch/browser"),
    homescreen: c("launch/homescreen"),
    solved: ok + wrong,
    ok,
    wrong,
    starts: sum(/^start\//),
    finishes: sum(/^finish\//),
    startsByTab: { exam: sum(/^start\/exam\//), book: sum(/^start\/book\//) },
    onboardingDone: c("onboarding/done"),
    onboardingSkip: sum(/^onboarding\/skip-/),
    noticeOpen: c("notice/open"),
    noticeKbi: c("notice/kbi"),
    topWrong: [...per.values()].filter((v) => v.wrong).sort((a, b) => b.wrong - a.wrong || a.n - b.n).slice(0, 10),
  };
}

const now = new Date();
const end = iso(new Date(hourFloor(now).getTime() + 3600e3));
// 오늘 = 한국 시간 0시부터
const kstMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 9 * 3600e3);
const todayStart = now.getTime() - kstMidnight.getTime() >= 24 * 3600e3 ? new Date(kstMidnight.getTime() + 24 * 3600e3) : kstMidnight;
const weekStart = new Date(todayStart.getTime() - 6 * 24 * 3600e3);

const [today, week] = [await allHits(iso(todayStart), end), await allHits(iso(weekStart), end)];
const out = { updated: now.toISOString(), today: summarize(today), week: summarize(week) };
writeFileSync("public/stats.json", JSON.stringify(out));
console.log(`통계 저장: 오늘 방문 ${out.today.visitors} · 푼 문제 ${out.today.solved} / 7일 방문 ${out.week.visitors} · 푼 문제 ${out.week.solved} (경로 ${week.length}개)`);
