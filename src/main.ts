import "./style.css";
import { BANKS } from "./data";
import { seenOnboarding, showOnboarding } from "./onboarding";
import { anonId, backfillSolved, markActive, pageview, track, trackOnce, trackSolve, sendPendingAlias } from "./stats";
import { CONTRIBUTORS } from "./contributors";
import { applyImport, localSummary, makeLink, readIncoming, readPasted, summarize } from "./transfer";
import { I } from "./icons";
import { addToday, clearRun, loadPrefs, loadTheme, loadToday, saveTheme, type Theme, loadRun, loadSubject, savePrefs, saveRun, saveSubject, type SavedRun, type SubjectState } from "./store";
import type { LoadedBank, Q } from "./types";
import GLOSSARY from "./data/glossary.json";

type View = "home" | "subject" | "quiz" | "end" | "review" | "stats" | "rank" | "more" | "people" | "settings";
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
  /** 60초 제한: 이 문항의 마감 시각(ms), 시간 초과로 채점됐는지 */
  deadline?: number;
  /** 이 문항에 걸린 제한 시간(초) */
  limit?: number;
  timedOut?: boolean;
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
const diffHtml = (q: Q) => (q.diff ? `<div class="diff"><div class="lbl">원본 ${q.variantOf}번과 달라진 점</div>${esc(q.diff)}</div>` : "");
const quoteHtml = (q: Q) => (q.quote ? `<div class="sec"><div class="lbl">원문 인용${q.quoteSrc ? ` <small class="qsrc">${esc(q.quoteSrc)}</small>` : ""}</div><blockquote class="quote">${esc(q.quote)}</blockquote></div>` : "");
/** 용어 풀이(설정 '용어 설명 같이 보기'를 켰을 때만): 교재 정의 우선, 없으면 일반 설명 */
const GLOSS = GLOSSARY as Record<string, { d: string; src?: string }>;
const termsHtml = (q: Q) => {
  const ts = (q.terms ?? []).filter((t) => GLOSS[t]).slice(0, 4);
  return ts.length
    ? `<div class="sec"><div class="lbl">용어 풀이</div><dl class="gl">${ts.map((t) => `<dt>${esc(t)}</dt><dd>${esc(GLOSS[t].d)}${GLOSS[t].src ? ` <small>${esc(GLOSS[t].src)}</small>` : ""}</dd>`).join("")}</dl></div>`
    : "";
};
const memoHtml = (q: Q) => (q.memo ? `<div class="memo"><b>출제 메모</b> · ${esc(q.memo)}</div>` : "");
/** 해설 아래 섹션: 원문 인용 → 변형 차이 → 용어 풀이 → 출제 메모 */
const sectionsHtml = (q: Q) => `${quoteHtml(q)}${diffHtml(q)}${termsHtml(q)}${memoHtml(q)}`;
/** 해설·모범답안: 줄바꿈(\n)은 문단으로, ①②③ 앞에서도 줄바꿈 */
/** 보기를 섞었을 때, 해설·원문 속 '③은…' 같은 원래 보기 번호를 화면에 보이는 번호로 바꾼 문항 */
const KN = "①②③④";
function viewQ(q: Q, order: number[]): Q {
  if (!q.choiceRef || order.every((v, i) => v === i + 1)) return q;
  const fix = (t: string) => t.replace(/[①②③④]/g, (c) => KN[order.indexOf(KN.indexOf(c) + 1)] ?? c);
  return { ...q, exp: q.choiceRef.includes("exp") ? fix(q.exp) : q.exp, quote: q.quote && q.choiceRef.includes("quote") ? fix(q.quote) : q.quote };
}
const expHtml = (t: string) => esc(t).replace(/[ \t]*\n[ \t]*/g, "<br>").replace(/[ \t]+(?=[①-⑨])/g, "<br>");
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
// 단답형 문항을 모두 4지선다·OX로 바꿔서, 유형을 단답형으로 골라 둔 기기는 전체로
if (prefs.type === "short" && !BANKS.some((b) => b.questions.some((q) => q.type === "short"))) prefs.type = "all";
let bank: LoadedBank = BANKS[0];
let st: SubjectState = loadSubject(bank.id);
let view: View = "home";
let session: { kind: Kind; items: Item[]; i: number } | null = null;
const reviewOpts: { q: string; hide: boolean; only: Only } = { q: "", hide: false, only: "all" };

/** 교재 연습문제 출처 이름. 이 출처만 있는 문항은 '교재 연습문제 포함'을 켰을 때만 보인다 */
const BOOK = "교재 연습문제";
/** 원본 기출을 바꿔 만든 연습용 OX 문항의 출처 이름 */
const VAR = "변형";
/** 교재 내용으로 새로 만든 OX 문항의 출처 이름. 설정에서 '챌린지 퀴즈'를 켠 기기에서만 보인다 */
const CHAL = "챌린지";
type Tab = "exam" | "book" | "variant" | "challenge";
const TABS: Record<Tab, string> = { exam: "온라인 기출", book: "교재 문항", variant: "변형 OX", challenge: "챌린지" };
/** 문항이 탭에 속하는지: 교재 문항 = 교재 연습문제가 출처에 있음, 온라인 기출 = 교재 외 출처가 있음(양쪽 공통 문항은 둘 다) */
const inTab = (q: Q, t: Tab) =>
  t === "challenge" ? q.sources.includes(CHAL) : t === "variant" ? q.sources.includes(VAR) : t === "book" ? q.sources.includes(BOOK) : q.sources.some((x) => x !== BOOK && x !== VAR && x !== CHAL);
const tab = (): Tab => (prefs.tab === "book" || prefs.tab === "variant" || (prefs.tab === "challenge" && prefs.challenge) ? prefs.tab : "exam");
/** 변형 OX의 출처 = 원본 문항의 탭(온라인 기출·교재 문항). 양쪽 공통 원본에서 만든 변형은 둘 다 */
const byN = new Map<string, Map<number, Q>>();
const origOf = (b: LoadedBank, q: Q) => {
  let m = byN.get(b.id);
  if (!m) byN.set(b.id, (m = new Map(b.questions.map((x) => [x.n, x]))));
  return q.variantOf ? m.get(q.variantOf) : undefined;
};
type VarSrc = "all" | "exam" | "book";
const varSrc = (): VarSrc => (prefs.varSrc === "exam" || prefs.varSrc === "book" ? prefs.varSrc : "all");
const inVarSrc = (b: LoadedBank, q: Q, s: VarSrc) => {
  if (s === "all") return true;
  const o = origOf(b, q);
  return !!o && inTab(o, s);
};
/** 탭에 보이는 문항. 교재 탭은 '기출과 겹치는 문제 제외'가 켜져 있으면 교재에만 있는 문항만, 변형 탭은 고른 출처만 */
const visible = (b: LoadedBank, t: Tab | null = tab()) =>
  t === "challenge" && !prefs.challenge
    ? []
    : t
      ? b.questions.filter((q) => inTab(q, t) && !(t === "book" && prefs.bookOnlyNew && inTab(q, "exam")) && !(t === "variant" && !inVarSrc(b, q, varSrc())))
      : b.questions.filter((q) => prefs.challenge || !q.sources.includes(CHAL));
/** 진행 중 풀이는 탭마다 따로 저장(온라인 기출은 기존 키 유지) */
const runKind = (kind: Kind) => {
  const k = kind === "all" && prefs.onlyUnsolved ? "unsolved" : kind; // 전체/안 푼 문제만은 이어풀기를 따로 저장
  return tab() === "exam" ? k : `${tab()}-${k}`;
};
const missOf = (n: number) => st.rec[n]?.miss ?? 0;

function stats(b: LoadedBank, s: SubjectState, t: Tab | null = tab()) {
  const vis = visible(b, t);
  const total = vis.length;
  const ns = new Set(vis.map((q) => q.n));
  const recs = Object.entries(s.rec).filter(([n]) => ns.has(Number(n))).map(([, r]) => r);
  const done = recs.length;
  const ok = recs.filter((r) => r.last).length;
  const often = vis.filter((q) => (s.rec[q.n]?.miss ?? 0) >= OFTEN).length;
  const tries = recs.reduce((a, r) => a + (r.tries ?? 0), 0); // 다시 푼 것까지 모든 채점 횟수(누적)
  return { total, done, tries, rate: done ? Math.round((ok / done) * 100) : null, wrong: s.wrong.filter((n) => ns.has(n)).length, bm: s.bm.filter((n) => ns.has(n)).length, often };
}

/** '문제 풀기'에 나오는 문항: 출제 범위 + ('안 푼 문제만'이면) 기록 없는 문항만 */
const playPool = () => (prefs.onlyUnsolved ? filtered().filter((q) => !st.rec[q.n]) : filtered());
const filtered = () => {
  // 변형 OX·챌린지는 전부 OX라 유형 거르기를 쓰지 않는다
  const allOx = tab() === "variant" || tab() === "challenge";
  return visible(bank).filter((q) => allOx || prefs.type === "all" || q.type === prefs.type);
};

const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);

function statRow(s: ReturnType<typeof stats>) {
  return `<div class="statrow">
    <div class="stat"><b>${s.done}<span class="num" style="font-size:14.5px;color:var(--ink-3)">/${s.total.toLocaleString()}</span></b><span>푼 문제</span></div>
    <div class="stat"><b>${s.tries}</b><span>총 풀이</span></div>
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
/** 지금 화면이 다크인지: 직접 고른 값, 아직 안 골랐으면(시스템) 폰 설정 */
const isDark = () => {
  const t = loadTheme();
  return t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
};

/* ---------- 홈 ---------- */
/* ---------- 숨은 통계 화면: 홈 로고를 2초 안에 5번 누르면 열림 (GitHub Actions가 1시간마다 만드는 stats.json) ---------- */
type QStat = { n: number; ok: number; wrong: number };
type StatRange = {
  visitors: number; homescreen: number; browser: number; solved: number; ok?: number; wrong?: number;
  starts: number; startsByTab: { exam: number; book: number }; progress10: number; finishes: number;
  onboardingDone: number; onboardingSkip: number[]; noticeOpen: number; noticeKbi: number;
  hours: number[]; visitHours?: number[]; questions?: QStat[]; devices?: Record<string, number>;
  newVisitors?: number; returning?: number; streak3?: number;
  bookmarks?: { n: number; count: number }[]; modes?: Record<string, { start: number; finish: number }>;
  refs?: { name: string; count: number }[]; prev: { visitors: number; solved: number; ok?: number };
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
  if (view === "rank") renderRank();
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
  box.innerHTML = `<div class="lv-pair"><b class="num">${(x.visitors ?? 0).toLocaleString()}명</b><b class="num">${x.solved.toLocaleString()}문제</b></div><span>${hourLabel(x)} 방문자 · 푼 문제</span>`;
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
        <div><b class="num">${t.visitors.toLocaleString()}</b><span>오늘 방문자</span></div>
        <div><b class="num">${t.solved.toLocaleString()}</b><span>오늘 푼 문제</span></div>
        ${last ? `<div class="lv-last"><div class="lv-pair"><b class="num">${(last.visitors ?? 0).toLocaleString()}명</b><b class="num">${last.solved.toLocaleString()}문제</b></div><span>${hourLabel(last)} 방문자 · 푼 문제</span></div>` : ""}
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
  const delta = (cur: number, prev: number, unit = "") => {
    const d = cur - prev;
    return d === 0 ? '<em class="flat">–</em>' : `<em class="${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}${unit}</em>`;
  };
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
  // 시간대
  const hv = statsUi.hourSeries === "visitors" ? (s.visitHours ?? Array(24).fill(0)) : s.hours;
  const hours = barChart(hv, hv.map((_, i) => `${i}시`));
  const hourToggle = `<span class="st-series">${(["solved", "visitors"] as const).map((k) => `<button data-shour="${k}" aria-pressed="${k === statsUi.hourSeries}">${k === "solved" ? "푼 문제" : "방문자"}</button>`).join("")}</span>`;
  // 기기·실행
  // 기기 × 실행 방식: 기기마다 하루 1번 보내는 device/* 신호 → 사람 수(7일·30일은 하루 사람 수의 합)
  const DEV: [string, string][] = [["ios-app", "아이폰 · 홈 화면 앱"], ["ios-web", "아이폰 · 사파리"], ["android-app", "안드로이드 · 홈 화면 앱"], ["android-web", "안드로이드 · 브라우저"], ["pc-web", "PC · 브라우저"], ["pc-app", "PC · 설치 앱"]];
  const dev = s.devices ?? {};
  const devTotal = Object.values(dev).reduce((a, b) => a + b, 0);
  const kv = (l: string, v: string) => `<div class="st-row"><span>${l}</span><b class="num">${v}</b></div>`;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "–");
  const devices = devTotal
    ? DEV.filter(([k]) => dev[k]).map(([k, l]) => kv(l, `${dev[k]}명 (${pct(dev[k], devTotal)})`)).join("")
    : kv("홈 화면 앱", `${s.homescreen}명`) + kv("브라우저", `${s.browser}명`) + '<p class="st-note">기기 구분은 오늘부터 집계돼요</p>';
  const skips = s.onboardingSkip.map((v, i) => kv(`${i + 1}장에서 건너뜀`, String(v))).join("");
  $app.innerHTML = `${head(`${new Date(data.updated).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 기준`)}
    <div class="chips st-range" style="margin-top:16px">${(Object.keys(RANGE_LABEL) as (keyof typeof RANGE_LABEL)[]).map((k) => `<button class="chip" data-srange="${k}" aria-pressed="${k === statsUi.range}">${RANGE_LABEL[k]}</button>`).join("")}</div>
    <div class="st-tiles">
      ${tile(s.visitors, "방문자", delta(s.visitors, s.prev.visitors))}
      ${tile(s.solved, "푼 문제", delta(s.solved, s.prev.solved))}
    </div>
    <p class="st-note">▲▼는 ${prevName} 같은 시각까지와 비교</p>
    ${card("일별 추이", `<span class="st-series">${(["solved", "visitors"] as const).map((k) => `<button data-sseries="${k}" aria-pressed="${k === statsUi.series}">${k === "solved" ? "푼 문제" : "방문자"}</button>`).join("")}</span>`, trend)}
    ${card("사용 흐름", "방문자 → 끝까지", funnel)}
    ${card("공부하는 시간대", hourToggle, hours)}
    ${card("기기 · 실행 방식", "", devices)}
    ${card("온보딩", "", kv("끝까지 봄", String(s.onboardingDone)) + skips)}
    ${card("공지", "", kv("배너 열람", String(s.noticeOpen)) + kv("kbi 링크 클릭", `${s.noticeKbi} (${pct(s.noticeKbi, s.noticeOpen)})`))}
    ${extraCards(s, kv, card)}
    <p class="st-note">방문자·공지·온보딩은 기기마다 하루 1번(시간대는 한 시간에 1번), 푼 문제·풀이는 전부 셉니다. 7일·30일 방문자는 하루 방문자의 합이에요. 광고 차단기 사용자는 빠져요.</p>`;
}

/* 사용자별 표: stats.json의 users는 STATS_KEY(비밀번호)로 암호화(PBKDF2 + AES-GCM) — 이 폰에서 한 번 입력하면 기억 */
const KEY_STORE = "gichul:stats-pass";
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decryptUsers(enc: { salt: string; iv: string; data: string }, pass: string): Promise<unknown[]> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass.trim().normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(enc.salt), iterations: 100000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
/** 실험실 '사용자 순위' 탭: stats.json의 공개 순위(익명 번호·풀이 수) */
type RankRow = { id: string; total: number; today: number; week: number; last: string };
function renderRank() {
  view = "rank";
  syncTabbar();
  pageview("rank");
  const data = statsUi.data as (StatsData & { ranking?: RankRow[] }) | null | undefined;
  const head = (sub: string) => `<div class="bar tabhead"><h1>사용자 순위</h1><span class="st-upd">${sub}</span></div>`;
  if (data === undefined || (data === null && statsLoading)) {
    $app.innerHTML = head("") + '<p class="st-note">불러오는 중…</p>';
    loadStats();
    return;
  }
  const rows = data?.ranking ?? [];
  const me = anonId();
  const mine = rows.findIndex((r) => r.id === me);
  $app.innerHTML = `${head(data ? `${new Date(data.updated).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 기준` : "")}
    ${mine >= 0 ? `<div class="rk-me"><span>내 순위</span><b class="num">${mine + 1}위</b><small>${rows.length}명 중 · 푼 문제 ${rows[mine].total}</small></div>` : '<p class="st-note">문제를 풀면 다음 갱신(1시간마다) 때 순위에 올라요.</p>'}
    <section class="st-card"><h2>푼 문제 순<small>익명 번호 · 누적</small></h2>
    ${
      rows.length
        ? `<div class="st-users"><div class="hd"><span>#</span><span>번호</span><span>푼 문제</span><span>오늘</span><span>7일</span><span>최근</span></div>
       ${rows.map((r, i) => `<div class="${r.id === me ? "me" : ""}"><span class="num">${i + 1}</span><span>${r.id === me ? "나" : esc(r.id)}</span><b class="num">${r.total}</b><span class="num">${r.today}</span><span class="num">${r.week}</span><span>${esc(r.last.slice(5).replace("-", "/"))}</span></div>`).join("")}</div>
       <p class="st-note">푼 문제·오늘·7일 = 푼 횟수(다시 푼 것 포함) · 기기 기준 · 1시간마다 갱신</p>`
        : '<p class="st-note">아직 순위 데이터가 없어요</p>'
    }</section>`;
}

/** 통계 화면 추가 카드: 새/재방문, 1인당, 유형·기출/교재 정답률, 커버리지, 모드별, 북마크, 유입 */
function extraCards(s: StatRange, kv: (l: string, v: string) => string, card: (t: string, sub: string, body: string) => string) {
  const nv = s.newVisitors ?? 0, rv = s.returning ?? 0, tv = nv + rv;
  const split = tv
    ? `<div class="st-split"><i style="width:${(nv / tv) * 100}%;background:var(--mark)"></i><i style="width:${(rv / tv) * 100}%;background:var(--brand)"></i></div>
       <div class="st-leg"><span><i style="background:var(--mark)"></i>처음 온 사람 ${nv}</span><span><i style="background:var(--brand)"></i>다시 온 사람 ${rv}</span></div>
       <p class="st-note">3일 이상 연속으로 온 사람 ${s.streak3 ?? 0}명</p>`
    : '<p class="st-note">아직 데이터가 없어요</p>';
  const MODE: Record<string, string> = { all: "문제 풀기", wrong: "오답노트", bm: "북마크", often: "자주 틀린 문제" };
  const modes = Object.keys(MODE).map((k) => kv(MODE[k], `${s.modes?.[k]?.start ?? 0}회 → ${s.modes?.[k]?.finish ?? 0}회`)).join("");
  return `${card("새 방문 vs 다시 온 사람", "", split)}
    ${card("모드별 사용", "시작 → 끝까지", modes)}`;
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
type TabKey = "home" | "subject" | "review" | "rank" | "stats" | "more";
/** 순위(실험실에서 켬)·통계(관리자) 탭이 붙으면 '해설 훑어보기'는 '해설'로 줄임 */
const tabList = (): [TabKey, string, string][] => {
  const extra: [TabKey, string, string][] = [];
  if (prefs.ranking) extra.push(["rank", "순위", I.trophy]);
  if (isAdmin()) extra.push(["stats", "통계", I.chart]);
  return [["home", "홈", I.home], ["subject", "문제 풀기", I.play], ["review", extra.length ? "해설" : "해설 훑어보기", I.book], ...extra, ["more", "더보기", I.more]];
};
const $tabbar = document.getElementById("tabbar")!;
function syncTabbar() {
  const show = view === "home" || view === "subject" || view === "review" || view === "more" || view === "stats" || view === "rank" || view === "people" || view === "settings";
  $tabbar.hidden = !show;
  document.body.classList.toggle("has-tabs", show);
  if (!show) return;
  $tabbar.innerHTML = tabList().map(
    ([k, l, ic]) => `<button data-tab-go="${k}" aria-current="${view === k || (k === "more" && (view === "people" || view === "settings")) ? "page" : "false"}">${ic}<span>${l}</span></button>`,
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
  const route = { ...(k === "more" || k === "stats" || k === "rank" ? { view: k as View } : { view: k as View, bank: bank.id }), fromHome };
  if (view === "home") history.pushState(route, "");
  else history.replaceState(route, "");
  if (k === "stats" || k === "rank") loadStats(); // 있던 데이터로 바로 보여주고, 뒤에서 최신 파일 확인
  go(k === "subject" ? renderSubject : k === "review" ? renderReview : k === "stats" ? renderStats : k === "rank" ? renderRank : renderMore);
}
$tabbar.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tab-go]");
  if (b) goTab(b.dataset.tabGo as TabKey);
});

/** 더보기 → 함께 만든 사람들 (이니셜 목록) */
function renderPeople() {
  view = "people";
  syncTabbar();
  pageview("people");
  $app.innerHTML = `
    <div class="bar"><button class="icon-btn" data-act="home" aria-label="더보기로">${I.back}</button><h1>함께 만든 사람들</h1></div>
    <p class="ppl-lead">기출노트는 이분들 덕분에 조금씩 나아지고 있어요.</p>
    <section class="ppl">${CONTRIBUTORS.map(
      (c) => `<div class="ppl-row"><span class="ppl-mono ${c.tone}">${esc(c.name[0])}</span><div><b>${esc(c.name)}</b><small>${esc(c.what)}</small></div><span class="ppl-tag">${esc(c.tag)}</span></div>`,
    ).join("")}</section>`;
  window.scrollTo(0, 0);
}

/** 더보기 → 실험실: 아직 다듬는 기능을 기기별로 켜고 끈다(챌린지 퀴즈, 타이머 기능) */
function renderSettings() {
  view = "settings";
  syncTabbar();
  pageview("settings");
  const nChal = BANKS.reduce((a, b) => a + b.questions.filter((q) => q.sources.includes(CHAL)).length, 0);
  const lab = (act: string, on: boolean, title: string, desc: string) =>
    `<button class="toggle lab-tog" data-act="${act}" aria-pressed="${on}"><span class="t"><b>${title}</b><small>${desc}</small></span><span class="sw"></span></button>`;
  $app.innerHTML = `
    <div class="bar"><button class="icon-btn" data-act="home" aria-label="더보기로">${I.back}</button><h1>실험실</h1></div>
    <p class="lab-lead">${I.flask} 아직 다듬는 중인 기능이에요. 켜 보고 불편하면 언제든 끌 수 있어요.</p>
    <div class="lab-card">
      ${lab("dark-tog", isDark(), "다크 모드", "켜면 다크, 끄면 라이트 모드 · 한 번도 바꾸지 않았다면 폰 설정을 따라요")}
      ${lab("chal-tog", !!prefs.challenge, "챌린지 퀴즈", `교재로 만든 OX ${nChal}문항 · 과목 화면에 '챌린지' 탭이 생겨요`)}
      ${lab("rank-tog", !!prefs.ranking, "사용자 순위", "하단에 '순위' 탭이 생겨요 · 푼 문제 수로 매긴 익명 순위(1시간마다 갱신)")}
      ${lab("timer-tog", !!prefs.timerFeature, "타이머 기능", "출제 범위에 '시간 제한'(문제당 30~60초)과 '해설 시간'(채점 후 15~60초 뒤 자동으로 다음 문제) 칩이 생겨요")}
    </div>`;
  window.scrollTo(0, 0);
}

function renderMore() {
  view = "more";
  syncTabbar();
  pageview("more");
  const row = (act: string, ic: string, label: string, right = "") =>
    `<button class="more-row" data-act="${act}"><span class="ic">${ic}</span><b>${label}</b><span class="r">${right} ›</span></button>`;
  $app.innerHTML = `
    <div class="bar tabhead"><h1>더보기</h1></div>
    <div class="more-list">
      ${row("transfer", I.swap, "기록 옮기기")}
      ${row("settings", I.flask, "실험실")}
      ${row("onboarding", I.help, "사용법 보기")}
      ${row("people", I.heart, "함께 만든 사람들")}
      ${isAdmin() ? row("admin-off", I.lock, "관리자 모드 끄기", "이 기기에서 통계 탭 숨김") : ""}
    </div>
    <section class="keep" aria-label="기록 보관 안내">
      <p><span class="ic" aria-hidden="true">📱</span>기록은 이 기기의 브라우저에만 저장돼요</p>
      <p><span class="ic" aria-hidden="true">🗑</span>캐시·사이트 데이터를 지우면 사라져요</p>
      <p><span class="ic" aria-hidden="true">🔁</span>기기를 바꿀 땐 먼저 기록을 옮기세요</p>
    </section>
    <p class="note">문제은행 ${BANKS.reduce((a, b) => a + visible(b, null).length, 0)}문항 · 익명 방문·학습 통계(푼 문제 수 등)를 수집해요</p>`;
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
      <button class="tr-link" data-tr="paste">받은 링크를 붙여넣어 가져오기 ›</button>
    </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tr]");
    if (!b && e.target === sheet) return sheet.remove();
    if (!b) return;
    if (b.dataset.tr === "paste") {
      sheet.remove();
      return openPaste(false);
    }
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
  showIncoming(p);
  return true;
}

function showIncoming(p: Exclude<Awaited<ReturnType<typeof readIncoming>>, null | "error">) {
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
}

/* ---------- 아이폰 홈 화면 앱: 사파리와 저장 공간이 따로라 처음엔 기록이 비어 보인다 → 붙여넣기로 가져오기 안내 ---------- */
const HS_OFF = "gichul:hs-hint-off";
function hsHintOn() {
  if (!(isIOS && standalone)) return false;
  try {
    if (localStorage.getItem(HS_OFF)) return false;
  } catch {
    return false;
  }
  const x = localSummary();
  return x.solved + x.wrong + x.bm === 0;
}
function hsHintOff() {
  try {
    localStorage.setItem(HS_OFF, "1");
  } catch {
    /* 무시 */
  }
}
const hsBanner = () =>
  hsHintOn()
    ? `<div class="hs-hint"><button class="hs-main" data-act="hs-open"><span class="ic">📲</span><span><b>사파리에서 풀던 기록이 있나요?</b><small>홈 화면 앱은 기록이 따로라 비어 보여요. 눌러서 가져오기</small></span></button><button class="hs-x" data-act="hs-close" aria-label="닫기">✕</button></div>`
    : "";

/** 링크 붙여넣기 시트. hs=true면 홈 화면 앱 안내 문구 */
function openPaste(hs: boolean) {
  const sheet = document.createElement("div");
  sheet.className = "sheet-wrap";
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ps-title">
      <div class="grab"></div>
      <h3 id="ps-title">${hs ? "사파리 기록 가져오기" : "받은 링크로 가져오기"}</h3>
      ${
        hs
          ? `<p>홈 화면 앱과 사파리는 기록을 따로 저장해요. 사파리 기록은 그대로 있으니 한 번만 옮겨 주세요.</p>
             <ol class="nsteps">
               <li><span>1</span>사파리에서 기출노트 열기</li>
               <li><span>2</span>더보기 › 기록 옮기기 › <b>링크 복사</b></li>
               <li><span>3</span>이 앱으로 돌아와 아래 <b>붙여넣기</b></li>
             </ol>`
          : `<p>다른 기기에서 복사한 기록 옮기기 링크를 붙여넣으세요.</p>`
      }
      <textarea class="ps-in" rows="2" placeholder="여기에 링크를 붙여넣어도 돼요" aria-label="기록 옮기기 링크"></textarea>
      <button class="next" data-ps="paste">붙여넣기</button>
      ${hs ? '<button class="btn" data-ps="off">기록이 없어요 · 다시 안 보기</button>' : ""}
    </div>`;
  document.body.appendChild(sheet);
  const $in = sheet.querySelector<HTMLTextAreaElement>(".ps-in")!;
  const tryText = async (text: string) => {
    const p = await readPasted(text);
    if (!p) return toast("기록 옮기기 링크가 아니에요"), false;
    if (p === "error") return toast("링크가 잘렸어요. 다시 복사해 주세요"), false;
    sheet.remove();
    trackOnce(hs ? "transfer/paste-hs" : "transfer/paste", "day");
    showIncoming(p);
    return true;
  };
  $in.addEventListener("input", () => {
    if (/#import=/.test($in.value)) void tryText($in.value);
  });
  sheet.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ps]");
    if (!b && e.target === sheet) return sheet.remove();
    if (!b) return;
    if (b.dataset.ps === "off") {
      hsHintOff();
      sheet.remove();
      if (view === "home") renderHome();
      return;
    }
    if ($in.value.trim()) return void tryText($in.value);
    try {
      const text = await navigator.clipboard.readText();
      if (text) return void tryText(text);
    } catch {
      /* 읽기 막힘 → 칸에 직접 붙여넣기 */
    }
    $in.focus();
    toast("칸을 길게 눌러 붙여넣어 주세요");
  });
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
    // 홈 카드에는 필터(교재 새 문항만·변형 출처)와 상관없는 탭별 전체 수를 보여준다
    const tabAll = (t: Tab) => (t === "challenge" && !prefs.challenge ? 0 : b.questions.filter((q) => inTab(q, t)).length);
    const tabsMeta = (Object.keys(TABS) as Tab[]).filter((t) => tabAll(t)).map((t) => `<span class="nw">${esc(TABS[t])} ${tabAll(t)}</span>`).join(" · ");
    return `<button class="subject" data-open="${esc(b.id)}">
      <div class="top"><div><h2>${esc(b.title)}</h2><div class="meta">${esc(b.org)} · <span class="nw">${s.total.toLocaleString()}문항</span></div><div class="meta">${tabsMeta}</div></div><span class="badge">${esc(b.round)}</span></div>
      <div class="progress" aria-label="진도"><span style="width:${pct(s.done, s.total)}%"></span></div>
      ${statRow(s)}
    </button>`;
  }).join("");
  $app.innerHTML = `
    <div class="bar tabhead"><div class="brandline" style="flex:1"><span class="logo" data-act="logo">기출<b>노트</b></span></div></div>
    ${hsBanner()}
    ${noticeBanner()}
    <div class="eyebrow">과목</div>
    <div style="display:grid;gap:12px">${cards}</div>
    ${liveCard()}
`;
}

/* ---------- 과목 ---------- */
/** 처음 한 번: 다른 문제 종류 탭이 있다는 걸 말풍선으로 알려 준다. 아무 데나 누르면 닫힘 */
const TIP_KEY = "gichul:tab-tip";
function maybeTabTip() {
  const seg = $app.querySelector<HTMLElement>(".seg");
  const to = seg?.querySelector<HTMLElement>('[aria-selected="false"]');
  if (!seg || !to || document.querySelector(".tip, .onb, .sheet-wrap")) return;
  try {
    if (localStorage.getItem(TIP_KEY)) return;
    localStorage.setItem(TIP_KEY, "1");
  } catch {
    return;
  }
  const others = [...seg.querySelectorAll<HTMLElement>('[aria-selected="false"]')].map((b) => b.firstChild?.textContent ?? "").join(" · ");
  const r = to.getBoundingClientRect();
  const w = 236, left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
  seg.classList.add("tip-on");
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="tip-dim"></div><div class="tip" role="status" style="top:${r.bottom + scrollY + 12}px;left:${left}px;--ax:${r.left + r.width / 2 - left}px">여기서 문제 종류를 바꿀 수 있어요<small>${esc(others)}도 풀어 보세요</small></div>`,
  );
  const close = () => {
    document.querySelectorAll(".tip, .tip-dim").forEach((x) => x.remove());
    seg.classList.remove("tip-on");
    document.removeEventListener("click", close, true);
  };
  document.addEventListener("click", close, true);
  trackOnce("tip/tab", "day");
}

function renderSubject() {
  view = "subject";
  syncTabbar();
  pageview(`subject/${tab()}`);
  const s = stats(bank, st);
  const n = playPool().length;
  const chip = (k: "type", v: string, label: string) =>
    `<button class="chip" data-pref="${k}" data-val="${esc(v)}" aria-pressed="${prefs[k] === v}">${esc(label)}</button>`;
  const tog = (k: "shuffleQ" | "shuffleC" | "bookOnlyNew" | "onlyUnsolved", label: string) =>
    `<button class="toggle" data-tog="${k}" aria-pressed="${prefs[k]}"><span>${label}</span><span class="sw"></span></button>`;
  const sub = (kind: Kind, base: string) => {
    const p = runProgress(kind);
    return p ? `<em class="resume">${p.done}/${p.total} 진행 중 · 이어서 풀 수 있어요</em>` : base;
  };
  $app.innerHTML = `
    <div class="bar tabhead"><h1>${esc(bank.title)}</h1></div>
    ${bank.questions.some((q) => !inTab(q, "exam")) ? `<div class="seg" role="tablist">${(Object.keys(TABS) as Tab[]).filter((t) => visible(bank, t).length || t === tab()).map((t) => `<button role="tab" data-tab="${t}" aria-selected="${tab() === t}">${TABS[t]}<small class="num">${visible(bank, t).length}문항</small></button>`).join("")}</div>` : ""}
    ${tab() === "challenge" ? `<div class="varinfo">교재 내용으로 새로 만든 <b>도전용 OX</b>예요. 기출에 아직 안 나온 부분이라, 다음 시험 대비로 풀어 보세요.</div>` : ""}
    ${tab() === "variant" ? `<div class="varinfo">원본 기출을 바꿔 쓰거나 4지선다 보기를 하나씩 OX로 만든 <b>연습용 OX</b>예요. 실제 시험 문장 그대로가 아닐 수 있으니 해설을 꼭 확인하세요.</div>` : ""}
    <div class="subject" style="cursor:default">
      <div class="progress"><span style="width:${pct(s.done, s.total)}%"></span></div>
      ${statRow(s)}
    </div>

    <div class="eyebrow">학습하기</div>
    <div class="modes">
      <button class="mode primary" data-start="all" ${n ? "" : "disabled"}><span class="ic">${I.play}</span><span class="tx"><b>문제 풀기</b><small>${sub("all", prefs.onlyUnsolved ? (n ? "아직 안 푼 문제만 풀어요" : "안 푼 문제를 모두 풀었어요 · 토글을 끄면 전체 풀기") : "한 문제씩 풀고 바로 정답·해설 확인")}</small></span><span class="cnt">${n}</span></button>
      <button class="mode" data-start="wrong" ${s.wrong ? "" : "disabled"}><span class="ic">${I.redo}</span><span class="tx"><b>오답노트 다시 풀기</b><small>${sub("wrong", "맞히면 오답노트에서 빠져요")}</small></span><span class="cnt">${s.wrong}</span></button>
      <button class="mode" data-start="bm" ${s.bm ? "" : "disabled"}><span class="ic">${I.bm}</span><span class="tx"><b>북마크 풀기</b><small>${sub("bm", "다시 보고 싶은 문제만 모아 풀기")}</small></span><span class="cnt">${s.bm}</span></button>
      <button class="mode" data-start="often" ${s.often ? "" : "disabled"}><span class="ic">${I.redo}</span><span class="tx"><b>자주 틀린 문제</b><small>${sub("often", `${OFTEN}번 이상 틀린 문제만 모아 풀기`)}</small></span><span class="cnt">${s.often}</span></button>
    </div>

    <div class="eyebrow">출제 범위</div>
    <div class="filters">
      ${tab() === "variant" ? `<div class="frow"><label>출처</label><div class="chips var-src" role="group" aria-label="변형 OX 출처">${(["all", "exam", "book"] as const).map((k) => `<button class="chip" data-varsrc="${k}" aria-pressed="${varSrc() === k}">${k === "all" ? "전체" : TABS[k]} <small class="num">${bank.questions.filter((q) => inTab(q, "variant") && inVarSrc(bank, q, k)).length}</small></button>`).join("")}</div></div>` : ""}
      ${tab() === "variant" || tab() === "challenge" ? "" : `<div class="frow"><label>유형</label><div class="chips">${chip("type", "all", "전체")}${(["ox", "mc", "short", "essay"] as const).filter((t) => visible(bank).some((q) => q.type === t)).map((t) => chip("type", t, TYPE_LABEL[t])).join("")}</div></div>`}
      ${prefs.timerFeature ? `<div class="frow"><label>시간 제한</label><div class="chips">${LIMITS.map((v) => `<button class="chip" data-limit="${v}" aria-pressed="${limitSec() === v}">${v ? `${v}초` : "끔"}</button>`).join("")}</div></div>
      <div class="frow"><label>해설 시간</label><div class="chips">${EXP_LIMITS.map((v) => `<button class="chip" data-explimit="${v}" aria-pressed="${(prefs.expSec ?? 0) === v}">${v ? `${v}초` : "끔"}</button>`).join("")}</div></div>` : ""}
      <div class="ftoggles">
        ${tog("onlyUnsolved", `안 푼 문제만 풀기 (${filtered().filter((q) => !st.rec[q.n]).length})`)}
        ${tab() === "book" ? tog("bookOnlyNew", `기출과 겹치는 문제 제외 (${bank.questions.filter((q) => inTab(q, "book") && inTab(q, "exam")).length})`) : ""}
        ${tog("shuffleQ", "문제 순서 섞기")}
        ${tog("shuffleC", "보기 순서 섞기")}
      </div>
      <div class="fcount">선택한 범위: <b class="num">${n}</b>문항</div>
    </div>`;
  maybeTabTip();
}

/* ---------- 풀이 ---------- */
/** 저장된 풀이를 현재 문항으로 복원. 문항이 사라졌으면 그 항목은 건너뛴다 */
function restoreRun(kind: Kind): { kind: Kind; items: Item[]; i: number } | null {
  const r = loadRun(bank.id, runKind(kind));
  if (!r) return null;
  // '문제 풀기'는 지금 출제 범위에 맞춘다: 범위 밖 문항은 빼고, 새로 생긴 문항(문항 추가·범위 변경)은 뒤에 붙인다
  const pool = kind === "all" ? new Set(playPool().map((q) => q.n)) : null;
  const items: Item[] = [];
  let i = -1;
  r.ns.forEach((n, idx) => {
    const q = bank.questions.find((x) => x.n === n);
    if (!q) return;
    const pick = r.picks[idx];
    const ok = r.oks?.[idx] ?? (pick === null ? null : pick === q.answer);
    // '안 푼 문제만'으로 풀던 회차는 이번에 푼 문항(이제 기록이 생김)도 남긴다
    if (pool && !pool.has(n) && !(prefs.onlyUnsolved && ok !== null)) return;
    if (idx === r.i) i = items.length;
    // 풀던 사이에 문항이 바뀐 경우(예: OX → 4지선다, 보기 수 변경) 저장된 보기 순서가 맞지 않아 보기가 안 보인다 → 새로 만들고 그 문항은 안 푼 상태로
    const order = r.orders[idx] ?? [];
    const nc = q.choices?.length ?? 0;
    if (order.length !== nc || !order.every((x) => x >= 1 && x <= nc)) {
      items.push(newItem(q));
      return;
    }
    items.push({ q, order, pick, ok, text: r.texts?.[idx] ?? null });
  });
  if (pool) {
    const have = new Set(items.map((it) => it.q.n));
    let added = playPool().filter((q) => !have.has(q.n));
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
  else pool = playPool();
  if (!pool.length) return toast(prefs.onlyUnsolved ? "안 푼 문제를 모두 풀었어요" : "선택한 범위에 문제가 없어요");
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
  if (r?.view === "rank") {
    if (!prefs.ranking) {
      history.replaceState({ view: "home" } satisfies Route, "");
      return go(renderHome);
    }
    loadStats();
    return go(renderRank);
  }
  if (r?.view === "more") return go(renderMore);
  if (r?.view === "people") return go(renderPeople);
  if (r?.view === "settings") return go(renderSettings);
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
    if (r.tab) prefs.tab = r.tab === "book" || r.tab === "variant" || r.tab === "challenge" ? r.tab : "exam";
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

/* ---------- 60초 제한(관리자 기기에서 토글을 켰을 때만) ---------- */
const LIMITS = [0, 30, 45, 60];
/** 예전 '60초 제한' 토글을 켜 둔 기기는 60초로 이어서 쓴다 */
const limitSec = () => prefs.timerSec ?? (prefs.timer ? 60 : 0);
let timerT: number | undefined;
const timerOn = () => !!prefs.timerFeature && limitSec() > 0;
/** 타이머를 멈춘 시각: 폰 홈 화면·다른 앱으로 가거나 풀이 화면을 벗어나면 기록하고, 돌아오면 그만큼 마감을 미룬다 */
let pausedAt: number | null = null;
function pauseTimers() {
  if (pausedAt === null) pausedAt = Date.now();
}
function resumeTimers() {
  if (pausedAt === null) return;
  const gap = Date.now() - pausedAt;
  pausedAt = null;
  const it = session?.items[session.i];
  if (it?.deadline && it.ok === null) it.deadline += gap;
  if (expDl) expDl.at += gap;
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return pauseTimers();
  resumeTimers(); // 숨겨진 동안 interval은 돌기만 하고 아무것도 안 했으므로 그대로 이어진다
});
function tickTimer() {
  const it = session?.items[session.i];
  if (document.hidden) return;
  if (view !== "quiz" || !it || it.ok !== null || !it.deadline) {
    if (view !== "quiz") pauseTimers();
    return void clearInterval(timerT);
  }
  const left = Math.max(0, it.deadline - Date.now());
  const sec = Math.ceil(left / 1000);
  const box = document.querySelector<HTMLElement>(".qtimer:not(.exp)");
  if (box) {
    box.classList.toggle("low", sec <= 15);
    box.querySelector<HTMLElement>("span")!.style.width = `${(left / ((it.limit ?? 60) * 1000)) * 100}%`;
    box.querySelector("b")!.textContent = `${sec}초`;
  }
  if (left <= 0) {
    clearInterval(timerT);
    it.timedOut = true;
    grade(false);
  }
}

/* ---------- 해설 보는 시간 제한(관리자 기기): 채점 후 정한 시간이 지나면 다음 문제로 ---------- */
const EXP_LIMITS = [0, 15, 30, 45, 60];
const expOn = () => !!prefs.timerFeature && (prefs.expSec ?? 0) > 0;
/** 방금 채점한 문항(i)에서 해설 시간이 끝나는 시각 */
let expDl: { i: number; at: number; limit: number } | null = null;
let expT: number | undefined;
function tickExp() {
  const box = document.querySelector<HTMLElement>(".qtimer.exp");
  if (document.hidden) return;
  if (view !== "quiz" || !session || !expDl || expDl.i !== session.i || !box) {
    if (view !== "quiz") pauseTimers();
    return void clearInterval(expT);
  }
  const left = Math.max(0, expDl.at - Date.now());
  const sec = Math.ceil(left / 1000);
  box.classList.toggle("low", sec <= 15);
  box.querySelector<HTMLElement>("span")!.style.width = `${(left / (expDl.limit * 1000)) * 100}%`;
  box.querySelector("b")!.textContent = `${sec}초`;
  if (left <= 0) {
    clearInterval(expT);
    expDl = null;
    document.querySelector<HTMLButtonElement>('[data-act="next"]')?.click();
  }
}

function renderQuiz() {
  if (!session) return;
  clearInterval(timerT);
  clearInterval(expT);
  resumeTimers();
  if (expDl && expDl.i !== session.i) expDl = null;
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
  const timed = timerOn() && !done;
  if (timed && it.deadline === undefined) {
    it.limit = limitSec();
    it.deadline = Date.now() + it.limit * 1000;
  }
  $app.innerHTML = `
    <div class="bar">
      <button class="icon-btn" data-act="subject" aria-label="그만 풀기">${I.close}</button>
      <div class="qhead" style="flex:1"><div class="progress"><span style="width:${pct(session.i + (done ? 1 : 0), total)}%"></span></div><button class="jump num" data-act="jump" aria-label="문제 번호로 이동">${session.i + 1}/${total} ▾</button></div>
    </div>
    ${timed ? `<div class="qtimer" role="timer"><div class="tbar"><span></span></div><b class="num">${it.limit}초</b></div>` : ""}
    <div class="qtags"><span class="tag type">${TYPE_LABEL[q.type]}</span>${q.conv ? `<span class="tag conv">${esc(q.conv)}</span>` : ""}${session.kind !== "all" ? `<span class="tag">${LABEL[session.kind]}</span>` : ""}${missOf(q.n) ? `<span class="tag miss">틀림 ${missOf(q.n)}회</span>` : ""}</div>
    <div class="qno">${q.variantOf ? `<span class="tag var">변형 · 원본 ${q.variantOf}번${q.fromChoice ? ` 보기 ${KNUM[q.fromChoice - 1]}` : ""}</span>` : `문제 ${q.n} <span class="qsrc">· ${esc(srcText(q))}</span>`}</div>
    <div class="qtext">${esc(q.q)}</div>
    ${body}
    ${done ? `<div class="result ${correct ? "ok" : "bad"}">
      <div class="rh">${correct ? I.check + " 정답" : I.x + (it.timedOut ? " 시간 초과" : " 오답")}${ansText ? `<span class="ans">정답 ${esc(ansText)}</span>` : ""}</div>
      <div class="rb"><div><div class="lbl">${q.type === "essay" ? "모범답안" : "해설"}</div>${expHtml(viewQ(q, it.order).exp)}</div>${sectionsHtml(viewQ(q, it.order))}
      <div class="src">${I.pg} ${esc(srcText(q))} · 출제원 ${esc(q.src)}</div></div></div>` : ""}
    ${done && expDl ? `<div class="qtimer exp" role="timer"><small>다음 문제까지</small><div class="tbar"><span></span></div><b class="num">${expDl.limit}초</b></div>` : ""}
    <div class="qfoot">
      <button class="pill-btn bm icon" data-flag aria-pressed="${isBm}" aria-label="북마크">${isBm ? I.bmOn : I.bm}</button>
      <button class="pill-btn prev" data-act="prev" ${session.i === 0 ? "disabled" : ""}>이전</button>
      <button class="next" data-act="next" ${done ? "" : "disabled"}>${session.i === total - 1 ? "결과 보기" : "다음 문제"}</button>
    </div>`;
  window.scrollTo(0, 0);
  if (timed) {
    tickTimer();
    timerT = window.setInterval(tickTimer, 200);
  }
  if (done && expDl) {
    tickExp();
    expT = window.setInterval(tickExp, 200);
  }
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
  // 시간 초과(손대지 않음)로 채점된 문제는 자동으로 넘기지 않는다: 자리를 비운 사이 연달아 오답 처리되는 것을 막음
  if (expOn() && !it.timedOut) expDl = { i: session.i, at: Date.now() + prefs.expSec! * 1000, limit: prefs.expSec! };
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
        <div class="rtop"><span class="qno">${q.n}</span><span class="tag type">${TYPE_SHORT[q.type]}</span>${q.conv ? `<span class="tag conv">${esc(q.conv)}</span>` : ""}${q.variantOf ? `<span class="tag var">원본 ${q.variantOf}번${q.fromChoice ? ` ${KNUM[q.fromChoice - 1]}` : ""}</span>` : ""}${st.wrong.includes(q.n) ? '<span class="wrongmark">오답</span>' : ""}${missOf(q.n) ? `<span class="missmark">틀림 ${missOf(q.n)}회</span>` : ""}
          <span class="flags"><button class="mini bm" data-rflag="${q.n}" aria-pressed="${isBm}" aria-label="북마크">${isBm ? I.bmOn : I.bm}</button></span></div>
        <div class="q">${esc(q.q)}</div>${opts}
        <div class="exp"><div class="lbl">${q.type === "essay" ? "모범답안" : "해설"}</div>${expHtml(q.exp)}${sectionsHtml(q)}</div>
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
  if (d.act === "hs-open") return openPaste(true);
  if (d.act === "hs-close") {
    hsHintOff();
    return renderHome();
  }
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
  if (d.act === "people") {
    history.pushState({ view: "people", fromHome: !!history.state?.fromHome } satisfies Route, "");
    return go(renderPeople);
  }
  if (d.act === "admin-off") {
    try {
      localStorage.removeItem(KEY_STORE);
    } catch {
      /* 무시 */
    }
    toast("관리자 모드를 껐어요");
    return renderMore();
  }
  if (d.act === "settings") {
    history.pushState({ view: "settings", fromHome: !!history.state?.fromHome } satisfies Route, "");
    return go(renderSettings);
  }
  if (d.act === "chal-tog") {
    prefs.challenge = !prefs.challenge;
    savePrefs(prefs);
    toast(prefs.challenge ? "챌린지 탭을 켰어요" : "챌린지 탭을 껐어요");
    return renderSettings();
  }
  if (d.act === "rank-tog") {
    prefs.ranking = !prefs.ranking;
    savePrefs(prefs);
    toast(prefs.ranking ? "하단에 순위 탭이 생겼어요" : "순위 탭을 껐어요");
    return renderSettings();
  }
  if (d.act === "timer-tog") {
    prefs.timerFeature = !prefs.timerFeature;
    savePrefs(prefs);
    toast(prefs.timerFeature ? "출제 범위에 타이머가 생겼어요" : "타이머 기능을 껐어요");
    return renderSettings();
  }
  if (d.act === "dark-tog") {
    const next: Theme = isDark() ? "light" : "dark";
    saveTheme(next);
    applyTheme(next);
    toast(THEME_LABEL[next]);
    return renderSettings();
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
  if (d.varsrc) {
    prefs.varSrc = d.varsrc as VarSrc;
    savePrefs(prefs);
    return renderSubject();
  }
  if (d.tab) {
    prefs.tab = d.tab as Tab;
    savePrefs(prefs);
    return renderSubject();
  }
  if (d.explimit !== undefined) {
    prefs.expSec = Number(d.explimit);
    savePrefs(prefs);
    return renderSubject();
  }
  if (d.limit !== undefined) {
    prefs.timerSec = Number(d.limit);
    savePrefs(prefs);
    return renderSubject();
  }
  if (d.tog === "shuffleQ" || d.tog === "shuffleC" || d.tog === "bookOnlyNew" || d.tog === "onlyUnsolved") {
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
trackOnce(`device/${isIOS ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "pc"}-${standalone ? "app" : "web"}`, "day");
markActive();
sendPendingAlias();
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
