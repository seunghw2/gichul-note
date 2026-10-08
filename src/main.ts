import "./style.css";
import { BANKS } from "./data";
import { seenOnboarding, showOnboarding } from "./onboarding";
import { I } from "./icons";
import { addToday, clearRun, loadPrefs, loadTheme, loadToday, saveTheme, type Theme, loadRun, loadSubject, savePrefs, saveRun, saveSubject, type SavedRun, type SubjectState } from "./store";
import type { LoadedBank, Q } from "./types";

type View = "home" | "subject" | "quiz" | "end" | "review";
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
    <div class="stat"><b>${s.rate === null ? "–" : s.rate + "%"}</b><span>정답률</span></div>
    <div class="stat"><b>${s.wrong}</b><span>${wrongLabel}</span></div>
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
function todayLine() {
  const t = loadToday();
  return `<p class="today">${t.n ? `오늘 <b class="num">${t.n}</b>문제 풀었어요 · 정답 <b class="num">${t.ok}</b>` : "오늘은 아직 푼 문제가 없어요"}</p>`;
}

/* ---------- 공지: 온라인 시험 기출 캡처 공유 요청 ---------- */
const NOTICE_KEY = "gichul:notice-hidden:share-v1";
const noticeHidden = () => {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
};
const noticeBanner = () =>
  noticeHidden() ? "" : `<button class="notice" data-act="notice"><span class="ic">📣</span><b>온라인 시험 1차, 2차 내용 공유 부탁드립니다</b><span class="go">›</span></button>`;

function openNotice() {
  const sheet = document.createElement("div");
  sheet.className = "sheet-wrap";
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="notice-title">
      <div class="grab"></div>
      <span class="pin">공지</span>
      <h3 id="notice-title">1차·2차, 한 장씩 모아요</h3>
      <p>시험 본 회차의 문제지나 정답지 캡처를 보내주시면 바로 정리해 올릴게요.</p>
      <ol class="nsteps">
        <li><span>1</span><div><a href="https://www.kbi.or.kr" target="_blank" rel="noopener">www.kbi.or.kr</a> 접속</div></li>
        <li><span>2</span>1차·2차 중 본 회차 캡처 (여러 장 OK)</li>
        <li><span>3</span>카카오톡 단톡방이나 개인톡으로 보내기</li>
      </ol>
      <button class="btn" data-notice="ok">확인</button>
      <button class="linkish" data-notice="hide">다시 보지 않기</button>
    </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-notice]");
    if (!b && e.target !== sheet) return;
    sheet.remove();
    if (b?.dataset.notice === "hide") {
      try {
        localStorage.setItem(NOTICE_KEY, "1");
      } catch {
        /* 무시 */
      }
      if (view === "home") renderHome();
    }
  });
}

function renderHome() {
  view = "home";
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
    <div class="bar"><div class="brandline" style="flex:1"><span class="logo">기출<b>노트</b></span></div>
      <button class="icon-btn" data-act="onboarding" aria-label="사용법 보기">${I.help}</button>
      <button class="icon-btn" data-act="theme" aria-label="화면 테마: ${THEME_LABEL[loadTheme()]}">${I[loadTheme() === "system" ? "auto" : loadTheme() === "light" ? "sun" : "moon"]}</button></div>
    ${todayLine()}
    ${noticeBanner()}
    <div class="eyebrow">과목</div>
    <div style="display:grid;gap:12px">${cards}</div>
    <p class="note">풀이 기록과 북마크는 이 기기의 브라우저에 저장됩니다.</p>`;
}

/* ---------- 과목 ---------- */
function renderSubject() {
  view = "subject";
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
    <div class="bar"><button class="icon-btn" data-act="home" aria-label="홈으로">${I.back}</button><h1>${esc(bank.title)}</h1></div>
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
      <button class="mode" data-act="review"><span class="ic">${I.book}</span><span class="tx"><b>해설 훑어보기</b><small>문제·정답·해설을 카드로 빠르게 읽기</small></span><span class="cnt">${n}</span></button>
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
type Route = { view: View; bank?: string; kind?: Kind; tab?: string };
const route = (v: View): Route => ({ view: v, bank: bank.id, ...(v === "quiz" && session ? { kind: session.kind, tab: tab() } : {}) });
const pushRoute = (v: View) => history.pushState(route(v), "");
const replaceRoute = (v: View) => history.replaceState(route(v), "");

function enterQuiz() {
  // 과목 화면에서 시작하면 한 단계 깊어지고, 결과 화면에서 다시 풀면 같은 깊이를 유지
  if (view === "subject") pushRoute("quiz");
  else replaceRoute("quiz");
  renderQuiz();
}

/** 기록에 남은 화면을 그린다. 풀이·결과는 다시 그릴 수 없어서 과목 화면으로 보낸다 */
function showRoute(r: Route | null, fromPop = false) {
  document.querySelector(".sheet-wrap")?.remove();
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
  const only = (v: Only, l: string) => `<button class="chip" data-only="${v}" aria-pressed="${reviewOpts.only === v}">${l}</button>`;
  $app.innerHTML = `
    <div class="bar"><button class="icon-btn" data-act="subject" aria-label="과목으로">${I.back}</button><h1>해설 훑어보기</h1></div>
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
}

function go(fn: () => void) {
  fn();
  window.scrollTo(0, 0);
}

$app.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("button, [data-reveal]");
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
    return renderEnd();
  }
  if (d.start) return view === "end" ? startSession(d.start as Kind) : chooseSession(d.start as Kind);
  if (d.act === "onboarding") return showOnboarding();
  if (d.act === "notice") return openNotice();
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
const customBack = !(isIOS && !standalone);
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
if (!seenOnboarding()) showOnboarding();
