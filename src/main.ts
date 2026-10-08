import "./style.css";
import { BANKS } from "./data";
import { seenOnboarding, showOnboarding } from "./onboarding";
import { anonId, backfillSolved, markActive, pageview, track, trackOnce, trackSolve } from "./stats";
import { applyImport, localSummary, makeLink, readIncoming, summarize } from "./transfer";
import { I } from "./icons";
import { addToday, clearRun, loadPrefs, loadTheme, loadToday, saveTheme, type Theme, loadRun, loadSubject, savePrefs, saveRun, saveSubject, type SavedRun, type SubjectState } from "./store";
import type { LoadedBank, Q } from "./types";

type View = "home" | "subject" | "quiz" | "end" | "review" | "stats" | "more";
type Kind = "all" | "wrong" | "bm" | "often";
type Only = "all" | "wrong" | "bm";

interface Item {
  q: Q;
  order: number[];
  pick: number | null;
  /** 채점 결과. null이면 아직 안 풂 */
  ok: boolean | null;
  /** 단답형에 입력한 답 */
  text: string | null;
  /** 약술형 모범답안을 펼쳤는지 */
  shown?: boolean;
}

const $app = document.getElementById("app")!;
const $toast = document.getElementById("toast")!;

const KNUM = ["①", "②", "③", "④", "⑤"];
const LABEL: Record<Kind, string> = { all: "문제 풀기", wrong: "오답노트", bm: "북마크", often: "자주 틀린 문제" };
/** 자주 틀린 문제 기준(틀린 횟수) */
const OFTEN = 2;
const TYPE_LABEL: Record<Q["type"], string> = { ox: "OX 진위형", mc: "4지선다", short: "단답형", essay: "약술형" };
const TYPE_SHORT: Record<Q["type"], string> = { ox: "OX", mc: "4지", short: "단답", essay: "약술" };

const srcText = (q: Q) => q.sources.join(", ");
const shortAnswer = (q: Q) => q.answerText ?? (q.accept ?? []).join(" / ");
const quoteHtml = (q: Q) => (q.quote ? `<blockquote class="quote"><div class="lbl">원문 인용</div>${esc(q.quote)}</blockquote>` : "");
/** 해설·모범답안: ①②③ 앞에서 줄바꿈 */
const expHtml = (t: string) => esc(t).replace(/\s+(?=[①-⑨])/g, "<br>");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const esc = (s: string | number) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function shuffle<T>(a: T[]): T[] {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let toastT: number | undefined;
function toast(msg: string) {
  $toast.textContent = msg;
  $toast.classList.add("on");
  clearTimeout(toastT);
  toastT = window.setTimeout(() => $toast.classList.remove("on"), 1400);
}

/* ---------- 상태 ---------- */
const prefs = loadPrefs();
let bank: LoadedBank = BANKS[0];
let st: SubjectState = loadSubject(bank.id);
let view: View = "home";
let session: { kind: Kind; items: Item[]; i: number } | null = null;
const reviewOpts: { q: string; hide: boolean; only: Only } = { q: "", hide: false, only: "all" };

/** 교재 연습문제 출처 이름. 이 출처만 있는 문항은 '교재 연습문제 포함'을 켰을 때만 보인다 */
const BOOK = "교재 연습문제";
type Tab = "exam" | "book";
const TABS: Record<Tab, string> = { exam: "온라인 시험 기출", book: "교재 문항" };
/** 문항이 탭에 속하는지: 교재 문항 = 교재 연습문제가 출처에 있음, 온라인 기출 = 교재 외 출처가 있음(양쪽 공통 문항은 둘 다) */
const inTab = (q: Q, t: Tab) => (t === "book" ? q.sources.includes(BOOK) : q.sources.some((x) => x !== BOOK));
const tab = (): Tab => (prefs.tab === "book" ? "book" : "exam");
const visible = (b: LoadedBank, t: Tab | null = tab()) => (t ? b.questions.filter((q) => inTab(q, t)) : b.questions);
/** 진행 중 풀이는 탭마다 따로 저장(온라인 기출은 기존 키 유지) */
const runKind = (kind: Kind) => (tab() === "book" ? `book-${kind}` : kind);
const missOf = (n: number) => st.rec[n]?.miss ?? 0;

function stats(b: LoadedBank, s: SubjectState, t: Tab | null = tab()) {
  const vis = visible(b, t);
  const total = vis.length;
  const ns = new Set(vis.map((q) => q.n));
  const recs = Object.entries(s.rec).filter(([n]) => ns.has(Number(n))).map(([, r]) => r);
  const done = recs.length;
  const ok = recs.filter((r) => r.last).length;
  const often = vis.filter((q) => (s.rec[q.n]?.miss ?? 0) >= OFTEN).length;
  return { total, done, rate: done ? Math.round((ok / done) * 100) : null, wrong: s.wrong.filter((n) => ns.has(n)).length, bm: s.bm.filter((n) => ns.has(n)).length, often };
}

const filtered = () => {
  return visible(bank).filter((q) => prefs.type === "all" || q.type === prefs.type);
};

const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);

function statRow(s: ReturnType<typeof stats>, wrongLabel: string) {
  return `<div class="statrow">
    <div class="stat"><b>${s.done}<span class="num" style="font-size:14.5px;color:var(--ink-3)">/${s.total}</span></b><span>푼 문제</span></div>
    <div class="stat"><b>${s.wrong}</b><span>${wrongLabel}</span></div>
    <div class="stat"><b>${loadToday().n}</b><span>오늘 푼 문제</span></div>
  </div>`;
}

/* ---------- 테마 ---------- */
const THEME_LABEL: Record<Theme, string> = { system: "폰 설정 따름", light: "라이트 모드", dark: "다크 모드" };
function applyTheme(t: Theme) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
applyTheme(loadTheme());

/* ---------- 홈 ---------- */
/* ---------- 숨은 통계 화면: 홈 로고를 2초 안에 5번 누르면 열림 (GitHub Actions가 1시간마다 만드는 stats.json) ---------- */
type QStat = { n: number; ok: number; wrong: number };
type StatRange = {
  visitors: number; homescreen: number; browser: number; solved: number; ok: number; wrong: number;
  starts: number; startsByTab: { exam: number; book: number }; progress10: number; finishes: number;
  onboardingDone: number; onboardingSkip: number[]; noticeOpen: number; noticeKbi: number;
  hours: number[]; visitHours?: number[]; questions: QStat[];
  newVisitors?: number; returning?: number; streak3?: number;
  bookmarks?: { n: number; count: number }[]; modes?: Record<string, { start: number; finish: number }>;
  refs?: { name: string; count: number }[]; prev: { visitors: number; solved: number; ok: number };
  systems: { name: string; count: number }[];
};
type StatsData = {
  updated: string;
  ranges: Record<"today" | "week" | "month", StatRange>;
  daily: { day: string; visitors: number; solved: number }[];
  last24?: { hour: number; solved: number; visitors?: number }[];
};
const RANGE_LABEL = { today: "오늘", week: "7일", month: "30일" } as const;
const statsUi = { range: "today" as keyof typeof RANGE_LABEL, series: "solved" as "solved" | "visitors", hourSeries: "solved" as "solved" | "visitors", data: undefined as StatsData | null | undefined };
let logoTaps: number[] = [];
function tapLogo() {
  const now = Date.now();
  logoTaps = [...logoTaps.filter((t) => now - t < 2000), now];
  if (logoTaps.length >= 5) {
    logoTaps = [];
    if (isAdmin()) goTab("stats");
    else openAdminSheet();
  }
}

/* ---------- 관리자 모드: 통계 비밀번호를 한 번 맞히면 이 기기에 5번째 '통계' 탭(순위 + 사용 통계)이 생기고 계속 유지 ---------- */
function isAdmin() {
  try {
    return !!localStorage.getItem(KEY_STORE);
  } catch {
    return false;
  }
}
function openAdminSheet() {
  const sheet = document.createElement("div");
  sheet.className = "sheet-wrap";
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="adm-title">
      <div class="grab"></div>
      <h3 id="adm-title">관리자 확인</h3>
      <p>통계 비밀번호를 입력하면 이 기기 하단에 <b>통계</b> 탭이 생겨요. 한 번 입력하면 계속 유지돼요.</p>
      <form class="st-pass"><input type="password" placeholder="통계 비밀번호" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="next" type="submit">확인</button></form>
      <label class="st-show"><input type="checkbox"> 입력한 글자 보기</label>
      <p class="adm-msg" role="alert"></p>
    </div>`;
  document.body.appendChild(sheet);
  const input = sheet.querySelector<HTMLInputElement>(".st-pass input")!;
  const msg = sheet.querySelector<HTMLElement>(".adm-msg")!;
  sheet.querySelector<HTMLInputElement>(".st-show input")!.addEventListener("change", (e) => (input.type = (e.target as HTMLInputElement).checked ? "text" : "password"));
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) sheet.remove();
  });
  sheet.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "확인 중…";
    let enc: { salt: string; iv: string; data: string } | undefined;
    try {
      const r = await fetch(`./stats.json?t=${Date.now()}`, { cache: "no-store" });
      enc = r.ok ? (await r.json()).users : undefined;
    } catch {
      /* 아래 안내 */
    }
    if (!enc) return void (msg.textContent = "통계 데이터를 불러올 수 없어요. 잠시 뒤 다시 해 주세요");
    try {
      await decryptUsers(enc, input.value);
    } catch {
      return void (msg.textContent = "비밀번호가 맞지 않아요");
    }
    try {
      localStorage.setItem(KEY_STORE, input.value);
    } catch {
      /* 무시 */
    }
    sheet.remove();
    toast("관리자 모드를 켰어요");
    goTab("stats");
  });
  setTimeout(() => input.focus(), 50);
}

/** 통계 파일 받기: 받는 중엔 이미 있는 데이터로 그대로 보여주고, 새 파일이 실제로 바뀌었을 때만 다시 그린다(깜빡임 방지) */
let statsLoading = false;
async function loadStats() {
  if (statsLoading) return;
  statsLoading = true;
  let next: StatsData | null = null;
  try {
    const r = await fetch(`./stats.json?t=${Date.now()}`, { cache: "no-store" });
    next = r.ok ? await r.json() : null;
  } catch {
    /* 네트워크 오류: 있던 데이터 유지 */
  }
  statsLoading = false;
  const prev = statsUi.data;
  // 새 파일이 있고 기준 시각이 바뀌었거나, 처음 받는 경우에만 다시 그림
  const changed = next ? !prev || next.updated !== prev.updated : prev === undefined;
  if (next) statsUi.data = next;
  else if (prev === undefined) statsUi.data = null;
  if (!changed) return;
  if (view === "stats") {
    const y = window.scrollY;
    renderStats();
    window.scrollTo(0, y);
  }
  if (view === "home") renderHome();
}

/** 홈 막대를 누르면 오른쪽 위에 그 시간의 방문자·푼 문제. 처음엔 가장 최근 한 시간이 선택돼 있음 */
let lvSel = -1;
const hourLabel = (x: { hour: number }) => `${x.hour}–${(x.hour + 1) % 24}시`;
function pickLiveBar(i: number) {
  const h = statsUi.data?.last24;
  const box = document.querySelector<HTMLElement>(".lv-last");
  if (!h?.[i] || !box) return;
  lvSel = i;
  const x = h[i];
  box.innerHTML = `<div class="lv-pair"><b class="num">${x.visitors ?? 0}명</b><b class="num">${x.solved}문제</b></div><span>${hourLabel(x)} 방문자 · 푼 문제</span>`;
  document.querySelectorAll(".lv-bars button").forEach((b, k) => b.classList.toggle("sel", k === i));
}

/** 홈: 모두에게 보이는 '함께 공부하는 사람들' 카드 (오늘 방문자·푼 문제 + 지난 24시간 시간별 푼 문제) */
function liveCard() {
  if (statsUi.data === undefined) {
    loadStats();
    return "";
  }
  const d = statsUi.data;
  const t = d?.ranges?.today;
  if (!d || !t) return "";
  const h = d.last24 ?? [];
  const m = Math.max(1, ...h.map((x) => x.solved));
  const last = h[h.length - 1];
  const bars = h.length
    ? `<div class="lv-bars" aria-label="지난 24시간 시간별 푼 문제 수">${h.map((x, i) => `<button class="${i === h.length - 1 ? "sel" : ""}" data-lvbar="${i}" aria-label="${x.hour}시 방문자 ${x.visitors ?? 0}명 ${x.solved}문제"><i style="height:${Math.max(4, (x.solved / m) * 100)}%"></i></button>`).join("")}</div>
       <div class="lv-axis">${[0, 6, 12, 18, h.length - 1].map((i) => `<span>${h[i]?.hour ?? ""}시</span>`).join("")}</div>`
    : "";
  return `<div class="eyebrow">함께 공부하는 사람들</div>
    <section class="lv">
      <div class="lv-nums">
        <div><b class="num">${t.visitors}</b><span>오늘 방문자</span></div>
        <div><b class="num">${t.solved}</b><span>오늘 푼 문제</span></div>
        ${last ? `<div class="lv-last"><div class="lv-pair"><b class="num">${last.visitors ?? 0}명</b><b class="num">${last.solved}문제</b></div><span>${hourLabel(last)} 방문자 · 푼 문제</span></div>` : ""}
      </div>
      ${bars}
      <p class="lv-note">막대는 시간별 푼 문제 · 누르면 그 시간 숫자 · ${new Date(d.updated).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })} 기준</p>
    </section>`;
}

function renderStats() {
  view = "stats";
  syncTabbar();
  const head = (sub: string) => `<div class="bar tabhead"><h1>통계</h1><span class="st-upd">${sub}</span></div>`;
  if (statsUi.data === undefined || (statsUi.data === null && statsLoading)) {
    $app.innerHTML = head("") + '<p class="st-note">불러오는 중…</p>';
    loadStats();
    return;
  }
  const data = statsUi.data;
  if (!data?.ranges) {
    $app.innerHTML = head("") + '<p class="st-note">아직 통계가 없어요. GitHub Actions가 1시간마다 만들어요.</p>';
    return;
  }
  const s = data.ranges[statsUi.range];
  const rate = (ok: number, all: number) => (all ? Math.round((ok / all) * 100) : null);
  const delta = (cur: number, prev: number, unit = "") => {
    const d = cur - prev;
    return d === 0 ? '<em class="flat">–</em>' : `<em class="${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}${unit}</em>`;
  };
  const r0 = rate(s.ok, s.solved), r1 = rate(s.prev.ok, s.prev.solved);
  const prevName = statsUi.range === "today" ? "어제" : `지난 ${RANGE_LABEL[statsUi.range]}`;
  const tile = (v: string | number, l: string, d: string) => `<div class="st-tile"><b class="num">${v}</b><span>${l}</span>${d}</div>`;
  const card = (title: string, sub: string, body: string) => `<section class="st-card"><h2>${title}<small>${sub}</small></h2>${body}</section>`;
  const barChart = (vals: number[], labels: string[], hl = -1) => {
    const m = Math.max(1, ...vals);
    return `<div class="st-bars">${vals.map((v, i) => `<i class="${i === hl ? "hl" : ""}" style="height:${Math.max(3, (v / m) * 100)}%" title="${labels[i]} ${v}"></i>`).join("")}</div>
      <div class="st-axis">${labels.filter((_, i) => i === 0 || i === Math.floor(labels.length / 2) || i === labels.length - 1).map((l) => `<span>${l}</span>`).join("")}</div>`;
  };
  // 일별 추이: 오늘·7일은 최근 14일, 30일은 30일
  const days = data.daily.slice(statsUi.range === "month" ? -30 : -14);
  const dayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const trend = barChart(days.map((d) => d[statsUi.series]), days.map((d) => dayLabel(d.day)), days.length - 1);
  // 사용 흐름
  const steps: [string, number, string][] = [["방문자", s.visitors, "명"], ["풀이 시작", s.starts, "회"], ["10문제 이상", s.progress10, "회"], ["끝까지", s.finishes, "회"]];
  const fmax = Math.max(1, ...steps.map(([, v]) => v));
  const funnel = `<div class="st-fun">${steps.map(([l, v, u]) => `<div><span>${l}</span><i style="width:calc((100% - 140px) * ${Math.max(0.02, v / fmax).toFixed(3)})"></i><b class="num">${v}${u}</b></div>`).join("")}</div>
    <p class="st-note">풀이 시작: 기출 ${s.startsByTab.exam} · 교재 ${s.startsByTab.book}</p>`;
  // 오답률 높은 문항: 3명 이상 푼 문항만
  const qText = new Map(BANKS.flatMap((b) => b.questions).map((q) => [q.n, q.q]));
  const qs = s.questions.filter((q) => qText.has(q.n) && q.ok + q.wrong >= 3 && q.wrong).sort((a, b) => b.wrong / (b.ok + b.wrong) - a.wrong / (a.ok + a.wrong) || b.wrong - a.wrong).slice(0, 10);
  const qList = qs.length
    ? qs.map((q) => {
        const r = Math.round((q.wrong / (q.ok + q.wrong)) * 100);
        return `<button class="st-q" data-sq="${q.n}"><span class="n num">${q.n}</span><span class="t">${esc(qText.get(q.n) ?? "")}</span><span class="r"><b class="num">${r}%</b> <small class="num">${q.wrong}/${q.ok + q.wrong}</small><i><u style="width:${r}%"></u></i></span></button>`;
      }).join("")
    : '<p class="st-note">3명 이상 푼 문항이 아직 없어요</p>';
  // 시간대
  const hv = statsUi.hourSeries === "visitors" ? (s.visitHours ?? Array(24).fill(0)) : s.hours;
  const hours = barChart(hv, hv.map((_, i) => `${i}시`));
  const hourToggle = `<span class="st-series">${(["solved", "visitors"] as const).map((k) => `<button data-shour="${k}" aria-pressed="${k === statsUi.hourSeries}">${k === "solved" ? "푼 문제" : "방문자"}</button>`).join("")}</span>`;
  // 기기·실행
  const sysTotal = s.systems.reduce((a, x) => a + x.count, 0);
  const launchTotal = s.homescreen + s.browser;
  const kv = (l: string, v: string) => `<div class="st-row"><span>${l}</span><b class="num">${v}</b></div>`;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "–");
  const devices = `${kv("홈 화면 앱으로 실행", `${s.homescreen} (${pct(s.homescreen, launchTotal)})`)}${kv("브라우저로 실행", `${s.browser} (${pct(s.browser, launchTotal)})`)}
    ${s.systems.map((x) => kv(esc(x.name || "기타"), `${x.count} (${pct(x.count, sysTotal)})`)).join("")}`;
  const skips = s.onboardingSkip.map((v, i) => kv(`${i + 1}장에서 건너뜀`, String(v))).join("");
  $app.innerHTML = `${head(`${new Date(data.updated).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 기준`)}
    ${card("사용자 순위", "푼 문제(누적) 순 · 익명 번호", '<div id="st-users"><p class="st-note">불러오는 중…</p></div>')}
    <div class="chips st-range" style="margin-top:16px">${(Object.keys(RANGE_LABEL) as (keyof typeof RANGE_LABEL)[]).map((k) => `<button class="chip" data-srange="${k}" aria-pressed="${k === statsUi.range}">${RANGE_LABEL[k]}</button>`).join("")}</div>
    <div class="st-tiles">
      ${tile(s.visitors, "방문자", delta(s.visitors, s.prev.visitors))}
      ${tile(s.solved, "푼 문제", delta(s.solved, s.prev.solved))}
      ${tile(r0 === null ? "–" : r0 + "%", "정답률", r0 === null || r1 === null ? '<em class="flat">–</em>' : delta(r0, r1, "%p"))}
    </div>
    <p class="st-note">▲▼는 ${prevName} 같은 시각까지와 비교</p>
    ${card("일별 추이", `<span class="st-series">${(["solved", "visitors"] as const).map((k) => `<button data-sseries="${k}" aria-pressed="${k === statsUi.series}">${k === "solved" ? "푼 문제" : "방문자"}</button>`).join("")}</span>`, trend)}
    ${card("사용 흐름", "방문자 → 끝까지", funnel)}
    ${card("오답률 높은 문항", "3명 이상 푼 문항 · 탭하면 해설", `<div class="st-qs">${qList}</div>`)}
    ${card("공부하는 시간대", hourToggle, hours)}
    ${card("기기 · 실행 방식", "", devices)}
    ${card("온보딩", "", kv("끝까지 봄", String(s.onboardingDone)) + skips)}
    ${card("공지", "", kv("배너 열람", String(s.noticeOpen)) + kv("kbi 링크 클릭", `${s.noticeKbi} (${pct(s.noticeKbi, s.noticeOpen)})`))}
    ${extraCards(s, kv, pct, card)}
    <p class="st-note">방문자·공지·온보딩은 기기마다 하루 1번(시간대는 한 시간에 1번), 푼 문제·풀이는 전부 셉니다. 7일·30일 방문자는 하루 방문자의 합이에요. 광고 차단기 사용자는 빠져요.</p>`;
  drawUsers();
}

/* 사용자별 표: stats.json의 users는 STATS_KEY(비밀번호)로 암호화(PBKDF2 + AES-GCM) — 이 폰에서 한 번 입력하면 기억 */
type UserRow = { id: string; distinct: number; today: number; week: number; last: string };
const KEY_STORE = "gichul:stats-pass";
let usersCache: { data: string; pass: string; rows: UserRow[] } | null = null;
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decryptUsers(enc: { salt: string; iv: string; data: string }, pass: string): Promise<UserRow[]> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass.trim().normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(enc.salt), iterations: 100000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function drawUsers() {
  const box = document.getElementById("st-users");
  const enc = (statsUi.data as unknown as { users?: { salt: string; iv: string; data: string } })?.users;
  if (!box) return;
  if (!enc) {
    box.innerHTML = '<p class="st-note">아직 데이터가 없어요 (비밀값 STATS_KEY 설정 후 다음 갱신부터)</p>';
    return;
  }
  let pass = "";
  try {
    pass = localStorage.getItem(KEY_STORE) ?? "";
  } catch {
    /* 무시 */
  }
  const askPass = (msg = "") => {
    box.innerHTML = `<form class="st-pass"><input type="password" placeholder="통계 비밀번호" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn" type="submit">열기</button></form><label class="st-show"><input type="checkbox"> 입력한 글자 보기</label>${msg ? `<p class="st-note" style="color:var(--bad)">${msg}</p>` : ""}`;
    box.querySelector<HTMLInputElement>(".st-show input")!.addEventListener("change", (e) => {
      box.querySelector<HTMLInputElement>(".st-pass input")!.type = (e.target as HTMLInputElement).checked ? "text" : "password";
    });
    box.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = box.querySelector<HTMLInputElement>(".st-pass input")!.value;
      try {
        localStorage.setItem(KEY_STORE, v);
      } catch {
        /* 무시 */
      }
      drawUsers();
    });
  };
  if (!pass) return askPass();
  let rows: UserRow[];
  try {
    rows = usersCache?.data === enc.data && usersCache.pass === pass ? usersCache.rows : await decryptUsers(enc, pass);
    usersCache = { data: enc.data, pass, rows };
  } catch {
    try {
      localStorage.removeItem(KEY_STORE);
    } catch {
      /* 무시 */
    }
    return askPass("비밀번호가 맞지 않아요");
  }
  const me = anonId();
  box.innerHTML = rows.length
    ? `<div class="st-users"><div class="hd"><span>#</span><span>번호</span><span>푼 문제</span><span>오늘</span><span>7일</span><span>최근</span></div>
       ${rows.map((r, i) => `<div class="${r.id === me ? "me" : ""}"><span class="num">${i + 1}</span><span>${r.id === me ? "나" : esc(r.id)}</span><b class="num">${r.distinct}</b><span class="num">${r.today}</span><span class="num">${r.week}</span><span>${esc(r.last.slice(5).replace("-", "/"))}</span></div>`).join("")}</div>
       <p class="st-note">푼 문제 = 서로 다른 문항(누적) · 오늘·7일 = 푼 횟수(다시 푼 것 포함) · 기기 기준</p>`
    : '<p class="st-note">아직 없어요</p>';
}

/** 통계 화면 추가 카드: 새/재방문, 1인당, 유형·기출/교재 정답률, 커버리지, 모드별, 북마크, 유입 */
function extraCards(s: StatRange, kv: (l: string, v: string) => string, pct: (a: number, b: number) => string, card: (t: string, sub: string, body: string) => string) {
  const allQ = BANKS.flatMap((b) => b.questions);
  const byN = new Map(allQ.map((q) => [q.n, q]));
  const nv = s.newVisitors ?? 0, rv = s.returning ?? 0, tv = nv + rv;
  const split = tv
    ? `<div class="st-split"><i style="width:${(nv / tv) * 100}%;background:var(--mark)"></i><i style="width:${(rv / tv) * 100}%;background:var(--brand)"></i></div>
       <div class="st-leg"><span><i style="background:var(--mark)"></i>처음 온 사람 ${nv}</span><span><i style="background:var(--brand)"></i>다시 온 사람 ${rv}</span></div>
       <p class="st-note">3일 이상 연속으로 온 사람 ${s.streak3 ?? 0}명</p>`
    : '<p class="st-note">아직 데이터가 없어요 (오늘부터 집계)</p>';
  const per = (a: number, b: number) => (b ? (a / b).toFixed(1) : "–");
  const perCap = `<div class="st-mini3"><div><b class="num">${per(s.solved, s.visitors)}</b><span>푼 문제</span></div><div><b class="num">${per(s.starts, s.visitors)}</b><span>풀이 시작</span></div><div><b class="num">${pct(s.finishes, s.starts)}</b><span>끝까지 비율</span></div></div>`;
  // 문항별 숫자를 문제은행과 맞춰 유형별·기출/교재별 정답률 계산
  const agg = (pick: (q: Q) => boolean) => {
    let ok = 0, all = 0;
    for (const x of s.questions) {
      const q = byN.get(x.n);
      if (q && pick(q)) (ok += x.ok), (all += x.ok + x.wrong);
    }
    return all ? `${Math.round((ok / all) * 100)}% (${all})` : "–";
  };
  const types = (["ox", "mc", "short"] as const).map((t) => kv(TYPE_LABEL[t], agg((q) => q.type === t))).join("");
  const tabs = kv("온라인 시험 기출", agg((q) => inTab(q, "exam"))) + kv("교재 문항", agg((q) => inTab(q, "book")));
  const touched = s.questions.filter((x) => byN.has(x.n) && x.ok + x.wrong > 0).length;
  const cover = `<div class="st-split"><i style="width:${(touched / allQ.length) * 100}%;background:var(--brand)"></i></div>
    <div class="st-leg"><span><i style="background:var(--brand)"></i>누군가 푼 문항 ${touched}</span><span><i style="background:var(--surface-2)"></i>아직 아무도 안 푼 ${allQ.length - touched}</span></div>`;
  const MODE: Record<string, string> = { all: "문제 풀기", wrong: "오답노트", bm: "북마크", often: "자주 틀린 문제" };
  const modes = Object.keys(MODE).map((k) => kv(MODE[k], `${s.modes?.[k]?.start ?? 0}회 → ${s.modes?.[k]?.finish ?? 0}회`)).join("");
  const bms = s.bookmarks?.length
    ? s.bookmarks.map((b) => `<button class="st-q" data-sq="${b.n}"><span class="n num">${b.n}</span><span class="t">${esc(byN.get(b.n)?.q ?? "")}</span><b class="num">${b.count}명</b></button>`).join("")
    : '<p class="st-note">아직 없어요</p>';
  const refs = s.refs?.length ? s.refs.map((r) => kv(esc(r.name || "직접 접속(홈 화면 앱·주소 입력)"), String(r.count))).join("") : '<p class="st-note">아직 없어요</p>';
  return `${card("새 방문 vs 다시 온 사람", "", split)}
    ${card("1인당", "", perCap)}
    ${card("유형별 정답률", "", types)}
    ${card("기출 vs 교재 정답률", "", tabs)}
    ${card("문항 커버리지", `전체 ${allQ.length}문항`, cover)}
    ${card("모드별 사용", "시작 → 끝까지", modes)}
    ${card("북마크 많은 문항", "탭하면 해설", `<div class="st-qs">${bms}</div>`)}
    ${card("유입 경로", "", refs)}`;
}

/** 통계 화면에서 문항을 누르면 문제·정답·해설 시트 */
function openStatQuestion(n: number) {
  const q = BANKS.flatMap((b) => b.questions).find((x) => x.n === n);
  if (!q) return;
  const ans = q.type === "ox" ? (q.answer === 1 ? "O" : "X") : q.type === "mc" ? `${KNUM[q.answer! - 1]} ${q.choices![q.answer! - 1]}` : shortAnswer(q);
  const sheet = document.createElement("div");
  sheet.className = "sheet-wrap";
  sheet.innerHTML = `<div class="sheet st-qsheet" role="dialog" aria-modal="true"><div class="grab"></div>
    <p class="st-note">문제 ${q.n} · ${TYPE_LABEL[q.type]} · ${esc(srcText(q))}</p>
    <h3>${esc(q.q)}</h3>
    ${q.type === "mc" ? `<ol class="st-choices">${q.choices!.map((c, i) => `<li class="${i + 1 === q.answer ? "ok" : ""}">${KNUM[i]} ${esc(c)}</li>`).join("")}</ol>` : ""}
    <p><b>정답</b> ${esc(ans)}</p>
    <div class="st-exp">${expHtml(q.exp)}</div>
    <button class="btn" data-close>닫기</button></div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || (e.target as HTMLElement).closest("[data-close]")) sheet.remove();
  });
}

/* ---------- 하단 탭바: 홈 · 문제 풀기 · 해설 훑어보기 · 더보기 (풀이·결과·통계 화면에서는 숨김) ---------- */
type TabKey = "home" | "subject" | "review" | "stats" | "more";
/** 관리자 기기는 5칸(통계 추가, '해설 훑어보기'는 '해설'로 줄임) */
const tabList = (): [TabKey, string, string][] =>
  isAdmin()
    ? [["home", "홈", I.home], ["subject", "문제 풀기", I.play], ["review", "해설", I.book], ["stats", "통계", I.chart], ["more", "더보기", I.more]]
    : [["home", "홈", I.home], ["subject", "문제 풀기", I.play], ["review", "해설 훑어보기", I.book], ["more", "더보기", I.more]];
const $tabbar = document.getElementById("tabbar")!;
function syncTabbar() {
  const show = view === "home" || view === "subject" || view === "review" || view === "more" || view === "stats";
  $tabbar.hidden = !show;
  document.body.classList.toggle("has-tabs", show);
  if (!show) return;
  $tabbar.innerHTML = tabList().map(
    ([k, l, ic]) => `<button data-tab-go="${k}" aria-current="${view === k ? "page" : "false"}">${ic}<span>${l}</span></button>`,
  ).join("");
}
/** 탭 이동: 홈이 맨 아래, 다른 탭은 홈 위에 한 칸만 쌓아서 뒤로가기(밀기)가 항상 홈으로 */
function goTab(k: TabKey) {
  if (k === view) return window.scrollTo({ top: 0, behavior: "smooth" });
  if (k === "home") {
    // 홈 위에 쌓아 둔 탭이면 뒤로, 새로고침 등으로 바로 들어온 탭이면 홈으로 바꿔치기
    if (history.state?.fromHome) return history.back();
    history.replaceState({ view: "home" } satisfies Route, "");
    return go(renderHome);
  }
  const fromHome = view === "home" || !!history.state?.fromHome;
  const route = { ...(k === "more" || k === "stats" ? { view: k as View } : { view: k as View, bank: bank.id }), fromHome };
  if (view === "home") history.pushState(route, "");
  else history.replaceState(route, "");
  if (k === "stats") loadStats(); // 있던 데이터로 바로 보여주고, 뒤에서 최신 파일 확인
  go(k === "subject" ? renderSubject : k === "review" ? renderReview : k === "stats" ? renderStats : renderMore);
}
$tabbar.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tab-go]");
  if (b) goTab(b.dataset.tabGo as TabKey);
});

function renderMore() {
  view = "more";
  syncTabbar();
  pageview("more");
  const t = loadTheme();
  const row = (act: string, ic: string, label: string, right = "") =>
    `<button class="more-row" data-act="${act}"><span class="ic">${ic}</span><b>${label}</b><span class="r">${right} ›</span></button>`;
  $app.innerHTML = `
    <div class="bar tabhead"><h1>더보기</h1></div>
    <div class="more-list">
      ${row("transfer", I.swap, "기록 옮기기")}
      ${row("theme-more", I[t === "system" ? "auto" : t === "light" ? "sun" : "moon"], "화면 테마", THEME_LABEL[t])}
      ${row("onboarding", I.help, "사용법 보기")}
      ${row("notice", I.bell, "공지")}
      ${isAdmin() ? row("admin-off", I.lock, "관리자 모드 끄기", "이 기기에서 통계 탭 숨김") : ""}
    </div>
    <section class="keep" aria-label="기록 보관 안내">
      <p><span class="ic" aria-hidden="true">📱</span>기록은 이 기기의 브라우저에만 저장돼요</p>
      <p><span class="ic" aria-hidden="true">🗑</span>캐시·사이트 데이터를 지우면 사라져요</p>
      <p><span class="ic" aria-hidden="true">🔁</span>기기를 바꿀 땐 먼저 기록을 옮기세요</p>
    </section>
    <p class="note">문제은행 ${BANKS.reduce((a, b) => a + b.questions.length, 0)}문항 · 익명 방문·학습 통계(푼 문제 수 등)를 수집해요</p>`;
}

/* ---------- 공지: 온라인 시험 기출 캡처 공유 요청 ---------- */
const noticeBanner = () =>
  `<button class="notice" data-act="notice"><span class="ic">📣</span><b>온라인 시험 1,2차 문항 공유 부탁드립니다</b><span class="go">›</span></button>`;

/* ---------- 기록 옮기기: 링크 보내기 시트 / 받는 기기 확인 화면 ---------- */
const sumTiles = (x: { solved: number; wrong: number; bm: number }) =>
  `<div class="tr-sum"><div><b class="num">${x.solved}</b><span>푼 문제</span></div><div><b class="num">${x.wrong}</b><span>오답노트</span></div><div><b class="num">${x.bm}</b><span>북마크</span></div></div>`;

function openTransfer() {
  const sheet = document.createElement("div");
  sheet.className = "sheet-wrap";
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="tr-title">
      <div class="grab"></div>
      <h3 id="tr-title">기록 옮기기</h3>
      <p>이 기기의 풀이 기록·오답노트·북마크를 링크 하나로 다른 기기에 옮겨요. 링크를 새 기기에서 열면 가져올 수 있어요.</p>
      ${sumTiles(localSummary())}
      ${typeof navigator.share === "function" ? '<button class="next" data-tr="share">링크 보내기 (카톡 나와의 채팅)</button>' : ""}
      <button class="btn" data-tr="copy">링크 복사</button>
      <p class="tr-warn">⚠︎ 링크를 받은 사람은 이 기록을 가져갈 수 있어요. 나에게만 보내세요.</p>
    </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tr]");
    if (!b && e.target === sheet) return sheet.remove();
    if (!b) return;
    const url = await makeLink();
    trackOnce("transfer/send", "day");
    if (b.dataset.tr === "share") {
      try {
        await navigator.share({ title: "기출노트 기록 옮기기", text: "기출노트 기록 옮기기 — 새 기기에서 이 링크를 여세요", url });
        sheet.remove();
      } catch {
        /* 공유창을 닫은 경우 */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("링크를 복사했어요. 새 기기에서 열어 주세요");
      sheet.remove();
    } catch {
      prompt("아래 링크를 복사하세요", url);
    }
  });
}

/** 받는 기기: #import= 링크로 열렸으면 확인 화면 */
async function checkIncoming(): Promise<boolean> {
  const p = await readIncoming();
  if (!p) return false;
  if (p === "error") {
    toast("링크가 잘려서 가져올 수 없어요. 링크 전체를 다시 열어 주세요");
    return true;
  }
  const inc = summarize(p.d);
  const cur = localSummary();
  const hasLocal = cur.solved + cur.wrong + cur.bm > 0;
  const el = document.createElement("div");
  el.className = "tr-full";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML = `
    <div class="tr-in">
      <span class="pin">기록 가져오기</span>
      <h2>다른 기기의 기록이 도착했어요</h2>
      <p>${new Date(p.t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}에 보낸 기록이에요.</p>
      ${sumTiles(inc)}
      ${
        hasLocal
          ? `<p class="tr-sub">이 기기에도 기록이 있어요 (푼 문제 ${cur.solved})</p>
             <label class="tr-opt"><input type="radio" name="trm" value="merge" checked><span><b>합치기</b><small>오답노트·북마크는 모두 모으고 푼 횟수는 더해요</small></span></label>
             <label class="tr-opt"><input type="radio" name="trm" value="overwrite"><span><b>덮어쓰기</b><small>이 기기 기록을 지우고 받은 기록으로 바꿔요</small></span></label>`
          : ""
      }
      <div class="tr-foot"><button class="next" data-tri="ok">가져오기</button><button class="btn" data-tri="cancel">취소</button></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tri]");
    if (!b) return;
    if (b.dataset.tri === "ok") {
      const mode = (el.querySelector<HTMLInputElement>('input[name="trm"]:checked')?.value ?? "merge") as "merge" | "overwrite";
      applyImport(p, mode);
      try {
        sessionStorage.setItem("gichul:imported", "1");
      } catch {
        /* 무시 */
      }
      location.reload();
    } else el.remove();
  });
  return true;
}

function openNotice() {
  trackOnce("notice/open", "day");
  const sheet = document.createElement("div");
  sheet.className = "sheet-wrap";
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="notice-title">
      <div class="grab"></div>
      <span class="pin">공지</span>
      <h3 id="notice-title">1·2차 결과, 캡처해 주세요</h3>
      <p>아래 순서대로 보내주시면 정리해서 추가할게요.</p>
      <ol class="nsteps">
        <li><span>1</span><div><a href="https://www.kbi.or.kr/platformWeb/Appraisal.do?cmd=appraisalMentGo&pageName=appraisalMentList" target="_blank" rel="noopener">www.kbi.or.kr</a> 평가 결과 페이지 접속</div></li>
        <li><span>2</span>1차, 2차 결과 모두 캡처 (여러 장 OK)</li>
        <li><span>3</span>카카오톡 단톡방이나 개인톡으로 보내기</li>
      </ol>
      <button class="btn" data-notice="ok">확인</button>
    </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) return trackOnce("notice/kbi", "day");
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-notice]");
    if (!b && e.target !== sheet) return;
    sheet.remove();
  });
}

function renderHome() {
  view = "home";
  syncTabbar();
  pageview("home");
  const cards = BANKS.map((b) => {
    const s = stats(b, loadSubject(b.id), null);
    const tabsMeta = (Object.keys(TABS) as Tab[]).filter((t) => visible(b, t).length).map((t) => `${TABS[t]} ${visible(b, t).length}`).join(" · ");
    return `<button class="subject" data-open="${esc(b.id)}">
      <div class="top"><div><h2>${esc(b.title)}</h2><div class="meta">${esc(b.org)} · ${s.total}문항</div><div class="meta">${esc(tabsMeta)}</div></div><span class="badge">${esc(b.round)}</span></div>
      <div class="progress" aria-label="진도"><span style="width:${pct(s.done, s.total)}%"></span></div>
      ${statRow(s, "오답노트")}
    </button>`;
  }).join("");
  $app.innerHTML = `
    <div class="bar tabhead"><div class="brandline" style="flex:1"><span class="logo" data-act="logo">기출<b>노트</b></span></div></div>
    ${noticeBanner()}
    <div class="eyebrow">과목</div>
    <div style="display:grid;gap:12px">${cards}</div>
    ${liveCard()}
`;
}

/* ---------- 과목 ---------- */
function renderSubject() {
  view = "subject";
  syncTabbar();
  pageview(`subject/${tab()}`);
  const s = stats(bank, st);
  const n = filtered().length;
  const chip = (k: "type", v: string, label: string) =>
    `<button class="chip" data-pref="${k}" data-val="${esc(v)}" aria-pressed="${prefs[k] === v}">${esc(label)}</button>`;
  const tog = (k: "shuffleQ" | "shuffleC", label: string) =>
    `<button class="toggle" data-tog="${k}" aria-pressed="${prefs[k]}"><span>${label}</span><span class="sw"></span></button>`;
  const sub = (kind: Kind, base: string) => {
    const p = runProgress(kind);
    return p ? `<em class="resume">${p.done}/${p.total} 진행 중 · 이어서 풀 수 있어요</em>` : base;
  };
  $app.innerHTML = `
    <div class="bar tabhead"><h1>${esc(bank.title)}</h1></div>
    ${bank.questions.some((q) => inTab(q, "book")) ? `<div class="seg" role="tablist">${(Object.keys(TABS) as Tab[]).map((t) => `<button role="tab" data-tab="${t}" aria-selected="${tab() === t}">${TABS[t]}</button>`).join("")}</div>` : ""}
    <div class="subject" style="cursor:default">
      <div class="progress"><span style="width:${pct(s.done, s.total)}%"></span></div>
      ${statRow(s, "남은 오답")}
    </div>

    <div class="eyebrow">학습하기</div>
    <div class="modes">
      <button class="mode primary" data-start="all"><span class="ic">${I.play}</span><span class="tx"><b>문제 풀기</b><small>${sub("all", "한 문제씩 풀고 바로 정답·해설 확인")}</small></span><span class="cnt">${n}</span></button>
      <button class="mode" data-start="wrong" ${s.wrong ? "" : "disabled"}><span class="ic">${I.redo}</span><span class="tx"><b>오답노트 다시 풀기</b><small>${sub("wrong", "맞히면 오답노트에서 빠져요")}</small></span><span class="cnt">${s.wrong}</span></button>
      <button class="mode" data-start="bm" ${s.bm ? "" : "disabled"}><span class="ic">${I.bm}</span><span class="tx"><b>북마크 풀기</b><small>${sub("bm", "다시 보고 싶은 문제만 모아 풀기")}</small></span><span class="cnt">${s.bm}</span></button>
      <button class="mode" data-start="often" ${s.often ? "" : "disabled"}><span class="ic">${I.redo}</span><span class="tx"><b>자주 틀린 문제</b><small>${sub("often", `${OFTEN}번 이상 틀린 문제만 모아 풀기`)}</small></span><span class="cnt">${s.often}</span></button>
    </div>

    <div class="eyebrow">출제 범위</div>
    <div class="filters">
      <div class="frow"><label>유형</label><div class="chips">${chip("type", "all", "전체")}${(["ox", "mc", "short", "essay"] as const).filter((t) => visible(bank).some((q) => q.type === t)).map((t) => chip("type", t, TYPE_LABEL[t])).join("")}</div></div>
      <div class="ftoggles">
        ${tog("shuffleQ", "문제 순서 섞기")}
        ${tog("shuffleC", "보기 순서 섞기")}
      </div>
      <div class="fcount">선택한 범위: <b class="num">${n}</b>문항</div>
    </div>`;
}

/* ---------- 풀이 ---------- */
/** 저장된 풀이를 현재 문항으로 복원. 문항이 사라졌으면 그 항목은 건너뛴다 */
function restoreRun(kind: Kind): { kind: Kind; items: Item[]; i: number } | null {
  const r = loadRun(bank.id, runKind(kind));
  if (!r) return null;
  // '문제 풀기'는 지금 출제 범위에 맞춘다: 범위 밖 문항은 빼고, 새로 생긴 문항(문항 추가·범위 변경)은 뒤에 붙인다
  const pool = kind === "all" ? new Set(filtered().map((q) => q.n)) : null;
  const items: Item[] = [];
  let i = -1;
  r.ns.forEach((n, idx) => {
    const q = bank.questions.find((x) => x.n === n);
    if (!q || (pool && !pool.has(n))) return;
    if (idx === r.i) i = items.length;
    const pick = r.picks[idx];
    const ok = r.oks?.[idx] ?? (pick === null ? null : pick === q.answer);
    items.push({ q, order: r.orders[idx], pick, ok, text: r.texts?.[idx] ?? null });
  });
  if (pool) {
    const have = new Set(items.map((it) => it.q.n));
    let added = filtered().filter((q) => !have.has(q.n));
    if (prefs.shuffleQ) added = shuffle(added);
    items.push(...added.map(newItem));
  }
  // 멈췄던 문항이 범위에서 빠졌으면 처음 안 푼 문항부터
  if (i < 0) i = Math.max(0, items.findIndex((it) => it.ok === null));
  // 하나도 안 풀었거나 다 풀었으면 이어 풀 것이 없다
  if (items.every((it) => it.ok === null) || items.every((it) => it.ok !== null)) return null;
  return { kind, items, i };
}

function runProgress(kind: Kind) {
  const r = restoreRun(kind);
  if (!r) return null;
  return { done: r.items.filter((it) => it.ok !== null).length, total: r.items.length };
}

function persistRun() {
  if (!session) return;
  saveRun(bank.id, runKind(session.kind), {
    ns: session.items.map((it) => it.q.n),
    orders: session.items.map((it) => it.order),
    picks: session.items.map((it) => it.pick),
    oks: session.items.map((it) => it.ok),
    texts: session.items.map((it) => it.text),
    i: session.i,
  });
}

/** 진행 중인 풀이가 있으면 이어서/새로 고르는 시트를 띄운다 */
function chooseSession(kind: Kind) {
  const p = runProgress(kind);
  if (!p) return startSession(kind);
  const sheet = document.createElement("div");
  sheet.className = "sheet-wrap";
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="grab"></div>
      <h3 id="sheet-title">${LABEL[kind]}</h3>
      <p>지난번에 <b class="num">${p.total}</b>문제 중 <b class="num">${p.done}</b>문제까지 풀었어요.</p>
      <div class="progress"><span style="width:${pct(p.done, p.total)}%"></span></div>
      <button class="next" data-sheet="resume">이어서 풀기</button>
      <button class="btn" data-sheet="new">처음부터 새로 풀기</button>
    </div>`;
  document.body.appendChild(sheet);
  sheet.querySelector<HTMLButtonElement>('[data-sheet="resume"]')!.focus();
  sheet.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-sheet]");
    if (!b && e.target !== sheet) return;
    sheet.remove();
    if (!b) return;
    if (b.dataset.sheet === "resume") {
      session = restoreRun(kind);
      persistRun();
      enterQuiz();
    } else {
      clearRun(bank.id, runKind(kind));
      startSession(kind);
    }
  });
}

function newItem(q: Q): Item {
  const base = (q.choices ?? []).map((_, i) => i + 1);
  return { q, order: q.type === "mc" && prefs.shuffleC ? shuffle(base) : base, pick: null, ok: null, text: null };
}

function startSession(kind: Kind) {
  let pool: Q[];
  if (kind === "wrong") pool = visible(bank).filter((q) => st.wrong.includes(q.n));
  else if (kind === "bm") pool = visible(bank).filter((q) => st.bm.includes(q.n));
  else if (kind === "often") pool = visible(bank).filter((q) => missOf(q.n) >= OFTEN);
  else pool = filtered();
  if (!pool.length) return toast("선택한 범위에 문제가 없어요");
  if (prefs.shuffleQ) pool = shuffle(pool);
  session = {
    kind,
    i: 0,
    items: pool.map(newItem),
  };
  persistRun();
  enterQuiz();
}

/* ---------- 화면 기록 ----------
   화면 이동을 브라우저 기록에 남겨서 뒤로가기(제스처·버튼)가 앱 안에서 동작하게 한다.
   깊이: 홈 → 과목 → (풀이 | 결과 | 훑어보기) */
type Route = { view: View; bank?: string; kind?: Kind; tab?: string; fromHome?: boolean };
const route = (v: View): Route => ({ view: v, bank: bank.id, ...(v === "quiz" && session ? { kind: session.kind, tab: tab() } : {}), ...(view === "home" ? { fromHome: true } : {}) });
const pushRoute = (v: View) => history.pushState(route(v), "");
const replaceRoute = (v: View) => history.replaceState(route(v), "");

function enterQuiz() {
  if (session) track(`start/${tab()}/${session.kind}`);
  // 과목 화면에서 시작하면 한 단계 깊어지고, 결과 화면에서 다시 풀면 같은 깊이를 유지
  if (view === "subject") pushRoute("quiz");
  else replaceRoute("quiz");
  renderQuiz();
}

/** 기록에 남은 화면을 그린다. 풀이·결과는 다시 그릴 수 없어서 과목 화면으로 보낸다 */
function showRoute(r: Route | null, fromPop = false) {
  document.querySelector(".sheet-wrap")?.remove();
  if (r?.view === "stats") {
    if (!isAdmin()) {
      history.replaceState({ view: "home" } satisfies Route, "");
      return go(renderHome);
    }
    loadStats();
    return go(renderStats);
  }
  if (r?.view === "more") return go(renderMore);
  const b = r?.bank ? BANKS.find((x) => x.id === r.bank) : undefined;
  if (!r || r.view === "home" || !b) {
    history.replaceState({ view: "home" } satisfies Route, "");
    return go(renderHome);
  }
  if (b !== bank) {
    bank = b;
    st = loadSubject(bank.id);
  }
  if (r.view === "review") return go(renderReview);
  // 새로고침: 풀던 문제는 저장된 진행 상태로 그대로 다시 연다
  if (!fromPop && r.view === "quiz" && r.kind) {
    if (r.tab) prefs.tab = r.tab === "book" ? "book" : "exam";
    session = restoreRun(r.kind);
    if (session) return go(renderQuiz);
  }
  if (r.view === "quiz" || r.view === "end") {
    // 앞으로 가기로 풀이 화면에 돌아온 경우: 풀던 내용이 남아 있으면 다시 보여주고, 없으면 그 기록은 건너뛴다
    if (fromPop && session) return r.view === "quiz" ? renderQuiz() : renderEnd();
    if (fromPop) return history.back();
  }
  replaceRoute("subject");
  go(renderSubject);
}

/** 앱 안에서 한 단계 뒤로 */
function goBack() {
  if (view !== "home") history.back();
}

function renderQuiz() {
  if (!session) return;
  view = "quiz";
  syncTabbar();
  pageview("quiz");
  const it = session.items[session.i];
  const q = it.q;
  const done = it.ok !== null;
  const total = session.items.length;
  const correct = it.ok === true;

  let body: string;
  if (q.type === "ox") {
    const cls = (v: number) => (!done ? "" : v === q.answer ? "correct" : v === it.pick ? "wrong" : "");
    body = `
      <div class="ox-btns">
        <button class="ox-btn o ${cls(1)}" data-pick="1" ${done ? "disabled" : ""} aria-label="O 맞음">O</button>
        <button class="ox-btn x ${cls(2)}" data-pick="2" ${done ? "disabled" : ""} aria-label="X 틀림">X</button>
      </div>`;
  } else if (q.type === "short") {
    // 입력·자동채점 없이 머릿속으로 떠올린 뒤 정답을 보고 스스로 채점
    body = done
      ? ""
      : it.shown
        ? `<div class="model"><div class="lbl">정답</div><b class="shortans">${esc(shortAnswer(q))}</b></div>
           <p class="selfq">떠올린 답이 맞았나요?</p>
           <div class="ox-btns self"><button class="ox-btn o" data-self="1">맞았어요</button><button class="ox-btn x" data-self="0">틀렸어요</button></div>`
        : `<p class="selfq">답을 머릿속으로 떠올려 본 뒤 정답을 확인하세요.</p>
           <button class="next wide" data-show>정답 보기</button>`;
  } else if (q.type === "essay") {
    body = done
      ? myEssay(it)
      : it.shown
        ? `${myEssay(it)}<div class="model"><div class="lbl">모범답안</div>${expHtml(q.exp)}</div>
           <p class="selfq">내 답과 비교해 보세요. 핵심을 다 떠올렸나요?</p>
           <div class="ox-btns self"><button class="ox-btn o" data-self="1">맞았어요</button><button class="ox-btn x" data-self="0">틀렸어요</button></div>`
        : `<textarea id="essayDraft" class="draft" rows="5" placeholder="머릿속으로 답해보거나 여기에 적어보세요">${esc(it.text ?? "")}</textarea>
           <button class="next wide" data-show>모범답안 보기</button>`;
  } else {
    body = `<div class="choices">${it.order
      .map((orig, idx) => {
        const c = !done ? "" : orig === q.answer ? "correct" : orig === it.pick ? "wrong" : "dim";
        return `<button class="choice ${c}" data-pick="${orig}" ${done ? "disabled" : ""}><span class="k">${idx + 1}</span><span>${esc(q.choices![orig - 1])}</span></button>`;
      })
      .join("")}</div>`;
  }

  const ansText =
    q.type === "ox" ? (q.answer === 1 ? "O" : "X") : q.type === "mc" ? KNUM[it.order.indexOf(q.answer!)] : q.type === "short" ? shortAnswer(q) : "";
  const isBm = st.bm.includes(q.n);
  $app.innerHTML = `
    <div class="bar">
      <button class="icon-btn" data-act="subject" aria-label="그만 풀기">${I.close}</button>
      <div class="qhead" style="flex:1"><div class="progress"><span style="width:${pct(session.i + (done ? 1 : 0), total)}%"></span></div><button class="jump num" data-act="jump" aria-label="문제 번호로 이동">${session.i + 1}/${total} ▾</button></div>
    </div>
    <div class="qtags"><span class="tag type">${TYPE_LABEL[q.type]}</span>${session.kind !== "all" ? `<span class="tag">${LABEL[session.kind]}</span>` : ""}${missOf(q.n) ? `<span class="tag miss">틀림 ${missOf(q.n)}회</span>` : ""}</div>
    <div class="qno">문제 ${q.n} <span class="qsrc">· ${esc(srcText(q))}</span></div>
    <div class="qtext">${esc(q.q)}</div>
    ${body}
    ${done ? `<div class="result ${correct ? "ok" : "bad"}">
      <div class="rh">${correct ? I.check + " 정답" : I.x + " 오답"}${ansText ? `<span class="ans">정답 ${esc(ansText)}</span>` : ""}</div>
      <div class="rb"><div><div class="lbl">${q.type === "essay" ? "모범답안" : "해설"}</div>${expHtml(q.exp)}</div>${quoteHtml(q)}
      <div class="src">${I.pg} ${esc(srcText(q))} · 출제원 ${esc(q.src)}</div></div></div>` : ""}
    <div class="qfoot">
      <button class="pill-btn bm icon" data-flag aria-pressed="${isBm}" aria-label="북마크">${isBm ? I.bmOn : I.bm}</button>
      <button class="pill-btn prev" data-act="prev" ${session.i === 0 ? "disabled" : ""}>이전</button>
      <button class="next" data-act="next" ${done ? "" : "disabled"}>${session.i === total - 1 ? "결과 보기" : "다음 문제"}</button>
    </div>`;
  window.scrollTo(0, 0);
}

/** 약술형에 적어 둔 내 답안 */
const myEssay = (it: Item) =>
  it.text?.trim() ? `<div class="model mine"><div class="lbl">내 답안</div>${esc(it.text.trim())}</div>` : "";

function pick(v: number) {
  if (!session) return;
  const it = session.items[session.i];
  if (it.ok !== null) return;
  it.pick = v;
  grade(v === it.q.answer);
}

function grade(ok: boolean) {
  if (!session) return;
  const it = session.items[session.i];
  if (it.ok !== null) return;
  it.ok = ok;
  // GoatCounter는 같은 사람·같은 이름 신호를 몇 시간 안엔 1번으로 세므로 문항 번호를 넣어 문항별로 센다(합계 = 푼 문제 수)
  track(`${ok ? "ok" : "wrong"}/q${it.q.n}`);
  trackSolve(it.q.n);
  markActive();
  if (session.items.filter((x) => x.ok !== null).length === 10) track("progress/10");
  addToday(ok);
  const q = it.q;
  const r = st.rec[q.n] ?? { tries: 0, miss: 0, last: false };
  r.tries++;
  if (!ok) r.miss++;
  r.last = ok;
  st.rec[q.n] = r;
  if (!ok && !st.wrong.includes(q.n)) st.wrong.push(q.n);
  const wasWrong = st.wrong.includes(q.n);
  if (ok) st.wrong = st.wrong.filter((n) => n !== q.n);
  saveSubject(bank.id, st);
  persistRun();
  renderQuiz();
  if (ok && wasWrong) toast("오답노트에서 뺐어요");
  const res = document.querySelector(".result");
  if (res) setTimeout(() => res.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" }), 30);
}

function renderEnd() {
  if (!session) return;
  clearRun(bank.id, runKind(session.kind));
  view = "end";
  syncTabbar();
  pageview("end");
  const items = session.items;
  const total = items.length;
  const ok = items.filter((it) => it.ok === true).length;
  const wrongs = items.filter((it) => it.ok === false);
  const ratio = total ? ok / total : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const retryWrong = wrongs.length > 0 && stats(bank, st).wrong > 0;
  $app.innerHTML = `
    <div class="bar"><button class="icon-btn" data-act="subject" aria-label="과목으로">${I.back}</button><h1>${LABEL[session.kind]} 결과</h1></div>
    <div class="score">
      <svg class="ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="10"/>
      <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--brand)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C * ratio} ${C}" transform="rotate(-90 60 60)"/>
      <text x="60" y="68" text-anchor="middle" font-family="Pretendard Variable, Pretendard, sans-serif" font-size="24" font-weight="600" fill="var(--ink)">${Math.round(ratio * 100)}%</text></svg>
      <div class="big num">${ok}<small>/${total}</small></div>
      <p>${wrongs.length ? `틀린 ${wrongs.length}문제는 오답노트에 담겼어요` : "모두 맞혔어요"}</p>
    </div>
    ${wrongs.length ? `<div class="eyebrow">틀린 문제</div><div class="wlist">${wrongs.map((it) => `<div class="witem"><span class="qno">${it.q.n}</span><span>${esc(it.q.q)}</span></div>`).join("")}</div>` : ""}
    <div class="btnrow">
      <button class="btn" data-act="subject">과목으로</button>
      <button class="btn fill" data-start="${retryWrong ? "wrong" : session.kind}">${retryWrong ? "오답만 다시" : "한 번 더"}</button>
    </div>`;
  window.scrollTo(0, 0);
}

/* ---------- 해설 훑어보기 ---------- */
function reviewCards() {
  const term = reviewOpts.q.trim();
  let list = filtered();
  if (reviewOpts.only === "wrong") list = list.filter((q) => st.wrong.includes(q.n));
  if (reviewOpts.only === "bm") list = list.filter((q) => st.bm.includes(q.n));
  if (term) list = list.filter((q) => `${q.q} ${(q.choices ?? []).join(" ")} ${(q.accept ?? []).join(" ")} ${q.exp} ${q.quote ?? ""}`.includes(term));
  const cards = list
    .map((q) => {
      const isBm = st.bm.includes(q.n);
      const opts =
        q.type === "ox"
          ? `<ol><li class="${q.answer === 1 ? "ans" : ""}"><span class="k">O</span>맞다</li><li class="${q.answer === 2 ? "ans" : ""}"><span class="k">X</span>틀리다</li></ol>`
          : q.type === "mc"
            ? `<ol>${q.choices!.map((c, i) => `<li class="${i + 1 === q.answer ? "ans" : ""}"><span class="k">${KNUM[i]}</span><span>${esc(c)}</span></li>`).join("")}</ol>`
            : q.type === "short"
              ? `<div class="ansline"><span class="lbl">정답</span>${esc(shortAnswer(q))}</div>`
              : "";
      return `<article class="rcard ${reviewOpts.hide ? "blur" : ""}" data-reveal>
        <div class="rtop"><span class="qno">${q.n}</span><span class="tag type">${TYPE_SHORT[q.type]}</span>${st.wrong.includes(q.n) ? '<span class="wrongmark">오답</span>' : ""}${missOf(q.n) ? `<span class="missmark">틀림 ${missOf(q.n)}회</span>` : ""}
          <span class="flags"><button class="mini bm" data-rflag="${q.n}" aria-pressed="${isBm}" aria-label="북마크">${isBm ? I.bmOn : I.bm}</button></span></div>
        <div class="q">${esc(q.q)}</div>${opts}
        <div class="exp"><div class="lbl">${q.type === "essay" ? "모범답안" : "해설"}</div>${expHtml(q.exp)}${quoteHtml(q)}</div>
        <div class="src">${I.pg} ${esc(srcText(q))} · ${esc(q.src)}</div>
      </article>`;
    })
    .join("");
  return cards || '<div class="empty">조건에 맞는 문제가 없어요</div>';
}

function renderReview() {
  view = "review";
  syncTabbar();
  pageview("review");
  const only = (v: Only, l: string) => `<button class="chip" data-only="${v}" aria-pressed="${reviewOpts.only === v}">${l}</button>`;
  $app.innerHTML = `
    <div class="bar tabhead"><h1>해설 훑어보기</h1></div>
    <label class="search">${I.search}<input id="rsearch" type="search" placeholder="키워드 검색 (예: 보험가액, ELS)" value="${esc(reviewOpts.q)}"></label>
    <div class="chips" style="margin-bottom:8px">${only("all", "전체")}${only("wrong", "오답")}${only("bm", "북마크")}</div>
    <button class="toggle" data-hide aria-pressed="${reviewOpts.hide}" style="margin:6px 0 14px"><span style="font-size:15px">정답·해설 가리기 <span style="color:var(--ink-3)">(카드를 눌러 확인)</span></span><span class="sw"></span></button>
    <div class="rlist">${reviewCards()}</div>`;
}

/** 문제 번호 목록에서 골라 바로 이동 */
function openJump() {
  if (!session) return;
  const s = session;
  const sheet = document.createElement("div");
  sheet.className = "sheet-wrap";
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="jump-title">
      <div class="grab"></div>
      <h3 id="jump-title">문제 이동</h3>
      <div class="jlegend"><span><i class="ok"></i>정답</span><span><i class="bad"></i>오답</span><span><i></i>안 푼 문제</span></div>
      <div class="jgrid">${s.items
        .map((it, idx) => `<button data-jump="${idx}" class="${it.ok === true ? "ok" : it.ok === false ? "bad" : ""} ${idx === s.i ? "cur" : ""}">${idx + 1}</button>`)
        .join("")}</div>
    </div>`;
  document.body.appendChild(sheet);
  sheet.querySelector<HTMLElement>(".cur")?.scrollIntoView({ block: "center" });
  sheet.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-jump]");
    if (!b && e.target !== sheet) return;
    sheet.remove();
    if (!b) return;
    s.i = Number(b.dataset.jump);
    persistRun();
    renderQuiz();
  });
}

/* ---------- 이벤트 ---------- */
function toggleBookmark(n: number) {
  const on = !st.bm.includes(n);
  st.bm = on ? [...st.bm, n] : st.bm.filter((x) => x !== n);
  saveSubject(bank.id, st);
  if (on) trackOnce(`bm/q${n}`, "ever"); // 문항마다 이 기기에서 한 번만 → '북마크한 사람 수'
}

function go(fn: () => void) {
  fn();
  window.scrollTo(0, 0);
}

$app.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("button, [data-reveal], [data-act=\"logo\"]");
  if (!t) return;
  const d = t.dataset;
  if (d.open) {
    bank = BANKS.find((b) => b.id === d.open)!;
    st = loadSubject(bank.id);
    pushRoute("subject");
    return go(renderSubject);
  }
  if (d.act === "home" || d.act === "subject") return goBack();
  if (d.act === "review") {
    pushRoute("review");
    return go(renderReview);
  }
  if (d.act === "prev" && session && session.i > 0) {
    session.i--;
    persistRun();
    return renderQuiz();
  }
  if (d.act === "jump" && session) return openJump();
  if (d.act === "next" && session) {
    if (session.i < session.items.length - 1) {
      session.i++;
      persistRun();
      return renderQuiz();
    }
    replaceRoute("end");
    track(`finish/${tab()}/${session.kind}`);
    return renderEnd();
  }
  if (d.start) return view === "end" ? startSession(d.start as Kind) : chooseSession(d.start as Kind);
  if (d.act === "onboarding") return showOnboarding();
  if (d.act === "notice") return openNotice();
  if (d.act === "transfer") return openTransfer();
  if (d.act === "logo") return tapLogo();
  if (d.lvbar) return pickLiveBar(Number(d.lvbar));
  if (d.shour) {
    statsUi.hourSeries = d.shour as typeof statsUi.hourSeries;
    return renderStats();
  }
  if (d.srange) {
    statsUi.range = d.srange as typeof statsUi.range;
    return renderStats();
  }
  if (d.sseries) {
    statsUi.series = d.sseries as typeof statsUi.series;
    return renderStats();
  }
  if (d.sq) return openStatQuestion(Number(d.sq));
  if (d.act === "admin-off") {
    try {
      localStorage.removeItem(KEY_STORE);
    } catch {
      /* 무시 */
    }
    toast("관리자 모드를 껐어요");
    return renderMore();
  }
  if (d.act === "theme-more") {
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(loadTheme()) + 1) % 3];
    saveTheme(next);
    applyTheme(next);
    return renderMore();
  }
  if (d.act === "theme") {
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(loadTheme()) + 1) % 3];
    saveTheme(next);
    applyTheme(next);
    toast(THEME_LABEL[next]);
    return renderHome();
  }
  if (d.pref === "type") {
    prefs.type = d.val as typeof prefs.type;
    savePrefs(prefs);
    return renderSubject();
  }
  if (d.tab) {
    prefs.tab = d.tab as Tab;
    savePrefs(prefs);
    return renderSubject();
  }
  if (d.tog === "shuffleQ" || d.tog === "shuffleC") {
    prefs[d.tog] = !prefs[d.tog];
    savePrefs(prefs);
    return renderSubject();
  }
  if (d.pick) return pick(Number(d.pick));
  if ("show" in d && session) {
    session.items[session.i].shown = true;
    return renderQuiz();
  }
  if (d.self) return grade(d.self === "1");
  if ("flag" in d && session) {
    toggleBookmark(session.items[session.i].q.n);
    return renderQuiz();
  }
  if (d.rflag) {
    toggleBookmark(Number(d.rflag));
    const on = st.bm.includes(Number(d.rflag));
    t.setAttribute("aria-pressed", String(on));
    t.innerHTML = on ? I.bmOn : I.bm;
    return;
  }
  if (d.only) {
    reviewOpts.only = d.only as Only;
    return renderReview();
  }
  if ("hide" in d) {
    reviewOpts.hide = !reviewOpts.hide;
    return renderReview();
  }
  if ("reveal" in d) t.classList.toggle("revealed");
});

$app.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "rsearch") {
    reviewOpts.q = el.value;
    document.querySelector(".rlist")!.innerHTML = reviewCards();
  }
  if (el.id === "essayDraft" && session) session.items[session.i].text = el.value;
});

document.addEventListener("keydown", (e) => {
  if (view !== "quiz" || !session || ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
  const it = session.items[session.i];
  if (it.ok === null) {
    if (it.q.type === "ox") {
      if (e.key === "o" || e.key === "ArrowLeft") pick(1);
      if (e.key === "x" || e.key === "ArrowRight") pick(2);
    } else if (/^[1-4]$/.test(e.key)) pick(it.order[Number(e.key) - 1]);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    document.querySelector<HTMLButtonElement>('[data-act="next"]')?.click();
  }
});

window.addEventListener("popstate", (e) => {
  popAt = Date.now();
  const r = e.state as Route | null;
  // 새로고침으로 같은 과목 화면 기록이 두 번 쌓인 경우: 한 번 더 뒤로 가서 항상 이전 화면으로
  if (view === "subject" && r?.view === "subject" && r.bank === bank.id) return history.back();
  showRoute(r, true);
});

/* ---------- 제스처: 왼쪽 가장자리에서 오른쪽으로 밀면 뒤로, 맨 위에서 당기면 새로고침 ---------- */
const EDGE = 28; // 왼쪽 가장자리 인식 폭(px)
const BACK_AT = 80; // 이만큼 밀면 뒤로
const PULL_AT = 70; // 이만큼 당기면 새로고침
const $edge = document.getElementById("edge")!;
const $ptr = document.getElementById("ptr")!;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
// 아이폰 홈 화면 앱(상태바 투명)에서는 100%·100vh·100lvh가 실제 화면보다 상태바만큼 짧게 잡혀
// 아래 고정 요소(탭바·시트)가 화면마다 위로 떠 보인다 → 실제 화면 높이(screen)로 맞춘다
function syncFullHeight() {
  if (!standalone) return;
  const full = innerWidth < innerHeight ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
  document.documentElement.classList.add("standalone");
  document.documentElement.style.setProperty("--full-h", `${full}px`);
}
syncFullHeight();
addEventListener("resize", syncFullHeight);
addEventListener("orientationchange", () => setTimeout(syncFullHeight, 300));
const customBack = !(isIOS && !standalone);
trackOnce(standalone ? "launch/homescreen" : "launch/browser", "day");
markActive();
backfillSolved(BANKS.flatMap((b) => Object.keys(loadSubject(b.id).rec).map(Number)));
let popAt = 0;
let g: { x: number; y: number; mode: "back" | "pull" | null; d: number } | null = null;

document.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length !== 1 || document.querySelector(".sheet-wrap, .onb")) return (g = null);
    const t = e.touches[0];
    const inField = !!(e.target as HTMLElement).closest?.("input, textarea");
    const mode = customBack && t.clientX <= EDGE && view !== "home" ? "back" : window.scrollY <= 0 && !inField ? "pull" : null;
    g = mode ? { x: t.clientX, y: t.clientY, mode, d: 0 } : null;
  },
  { passive: true },
);

document.addEventListener(
  "touchmove",
  (e) => {
    if (!g) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (g.mode === "back") {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) return resetGesture();
      g.d = Math.max(0, dx);
      $edge.style.transform = `translate(${Math.min(g.d, BACK_AT) - 48}px, -50%)`;
      $edge.classList.toggle("ready", g.d >= BACK_AT);
    } else {
      if (window.scrollY > 0 || dy <= 0 || Math.abs(dx) > dy) return resetGesture();
      g.d = dy * 0.5; // 손가락보다 덜 따라오게
      if (e.cancelable) e.preventDefault(); // 브라우저 기본 당김 동작과 겹치지 않게
      $ptr.style.transform = `translate(-50%, ${Math.min(g.d, PULL_AT + 20) - 44}px) rotate(${g.d * 3}deg)`;
      $ptr.classList.toggle("ready", g.d >= PULL_AT);
    }
  },
  { passive: false },
);

function resetGesture() {
  g = null;
  $edge.style.transform = "";
  $edge.classList.remove("ready");
  $ptr.style.transform = "";
  $ptr.classList.remove("ready");
}

document.addEventListener("touchend", () => {
  if (!g) return;
  const { mode, d } = g;
  resetGesture();
  if (mode === "back" && d >= BACK_AT) {
    // 브라우저 기본 뒤로가기도 같이 일어났으면 한 번만 뒤로
    const at = Date.now();
    setTimeout(() => popAt < at && goBack(), 250);
  }
  if (mode === "pull" && d >= PULL_AT) {
    $ptr.classList.add("spin");
    location.reload();
  }
});
document.addEventListener("touchcancel", resetGesture);

showRoute(history.state as Route | null);
// 기록 옮기기 링크로 열렸으면 온보딩 대신 가져오기 확인
checkIncoming().then((incoming) => {
  if (!incoming && !seenOnboarding()) showOnboarding();
});
try {
  if (sessionStorage.getItem("gichul:imported")) {
    sessionStorage.removeItem("gichul:imported");
    setTimeout(() => toast("기록을 가져왔어요"), 300);
  }
} catch {
  /* 무시 */
}
