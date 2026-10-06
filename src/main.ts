import "./style.css";
import { BANKS } from "./data";
import { I } from "./icons";
import { clearRun, loadPrefs, loadRun, loadSubject, savePrefs, saveRun, saveSubject, type SavedRun, type SubjectState } from "./store";
import type { LoadedBank, Q } from "./types";

type View = "home" | "subject" | "quiz" | "end" | "review";
type Kind = "all" | "wrong" | "bm";
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
const LABEL: Record<Kind, string> = { all: "문제 풀기", wrong: "오답노트", bm: "북마크" };
const TYPE_LABEL: Record<Q["type"], string> = { ox: "OX 진위형", mc: "4지선다", short: "단답형", essay: "약술형" };
const TYPE_SHORT: Record<Q["type"], string> = { ox: "OX", mc: "4지", short: "단답", essay: "약술" };

/** 단답형 비교용: 띄어쓰기·기호를 지우고 비교 */
const norm = (s: string) => s.replace(/[\s.,·()\[\]'"]/g, "").toLowerCase();
const isAccepted = (q: Q, text: string) => !!norm(text) && (q.accept ?? []).some((a) => norm(a) === norm(text));
const srcText = (q: Q) => q.sources.join(", ");
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

function stats(b: LoadedBank, s: SubjectState) {
  const total = b.questions.length;
  const recs = Object.values(s.rec);
  const done = recs.length;
  const ok = recs.filter((r) => r.last).length;
  return { total, done, rate: done ? Math.round((ok / done) * 100) : null, wrong: s.wrong.length, bm: s.bm.length };
}

const filtered = () =>
  bank.questions.filter(
    (q) => (prefs.type === "all" || q.type === prefs.type) && (prefs.source === "all" || q.sources.includes(prefs.source)),
  );

const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);

function statRow(s: ReturnType<typeof stats>, wrongLabel: string) {
  return `<div class="statrow">
    <div class="stat"><b>${s.done}<span class="num" style="font-size:13px;color:var(--ink-3)">/${s.total}</span></b><span>푼 문제</span></div>
    <div class="stat"><b>${s.rate === null ? "–" : s.rate + "%"}</b><span>정답률</span></div>
    <div class="stat"><b>${s.wrong}</b><span>${wrongLabel}</span></div>
  </div>`;
}

/* ---------- 홈 ---------- */
function renderHome() {
  view = "home";
  const cards = BANKS.map((b) => {
    const s = stats(b, loadSubject(b.id));
    return `<button class="subject" data-open="${esc(b.id)}">
      <div class="top"><div><h2>${esc(b.title)}</h2><div class="meta">${esc(b.org)} · ${s.total}문항</div><div class="meta">출처 ${esc(b.sourceList.join(", "))}</div></div><span class="badge">${esc(b.round)}</span></div>
      <div class="progress" aria-label="진도"><span style="width:${pct(s.done, s.total)}%"></span></div>
      ${statRow(s, "오답노트")}
    </button>`;
  }).join("");
  $app.innerHTML = `
    <div class="bar"><div class="brandline" style="flex:1"><span class="logo">기출<b>노트</b></span></div></div>
    <div class="eyebrow">과목</div>
    <div style="display:grid;gap:12px">${cards}</div>
    <p class="note">풀이 기록과 북마크는 이 기기의 브라우저에 저장됩니다.</p>`;
}

/* ---------- 과목 ---------- */
function renderSubject() {
  view = "subject";
  const s = stats(bank, st);
  const n = filtered().length;
  const chip = (k: "type" | "source", v: string, label: string) =>
    `<button class="chip" data-pref="${k}" data-val="${esc(v)}" aria-pressed="${prefs[k] === v}">${esc(label)}</button>`;
  const tog = (k: "shuffleQ" | "shuffleC", label: string) =>
    `<button class="toggle" data-tog="${k}" aria-pressed="${prefs[k]}"><span>${label}</span><span class="sw"></span></button>`;
  const sub = (kind: Kind, base: string) => {
    const p = runProgress(kind);
    return p ? `<em class="resume">${p.done}/${p.total} 진행 중 · 이어서 풀 수 있어요</em>` : base;
  };
  $app.innerHTML = `
    <div class="bar"><button class="icon-btn" data-act="home" aria-label="홈으로">${I.back}</button><h1>${esc(bank.title)}</h1></div>
    <div class="subject" style="cursor:default">
      <div class="progress"><span style="width:${pct(s.done, s.total)}%"></span></div>
      ${statRow(s, "남은 오답")}
    </div>

    <div class="eyebrow">학습하기</div>
    <div class="modes">
      <button class="mode primary" data-start="all"><span class="ic">${I.play}</span><span class="tx"><b>문제 풀기</b><small>${sub("all", "한 문제씩 풀고 바로 정답·해설 확인")}</small></span><span class="cnt">${n}</span></button>
      <button class="mode" data-start="wrong" ${s.wrong ? "" : "disabled"}><span class="ic">${I.redo}</span><span class="tx"><b>오답노트 다시 풀기</b><small>${sub("wrong", "맞히면 오답노트에서 빠져요")}</small></span><span class="cnt">${s.wrong}</span></button>
      <button class="mode" data-start="bm" ${s.bm ? "" : "disabled"}><span class="ic">${I.bm}</span><span class="tx"><b>북마크 풀기</b><small>${sub("bm", "다시 보고 싶은 문제만 모아 풀기")}</small></span><span class="cnt">${s.bm}</span></button>
      <button class="mode" data-act="review"><span class="ic">${I.book}</span><span class="tx"><b>해설 훑어보기</b><small>문제·정답·해설을 카드로 빠르게 읽기</small></span><span class="cnt">${s.total}</span></button>
    </div>

    <div class="eyebrow">출제 범위</div>
    <div class="filters">
      <div class="frow"><label>유형</label><div class="chips">${chip("type", "all", "전체")}${(["ox", "mc", "short", "essay"] as const).filter((t) => bank.questions.some((q) => q.type === t)).map((t) => chip("type", t, TYPE_LABEL[t])).join("")}</div></div>
      <div class="frow"><label>출처</label><div class="chips">${chip("source", "all", "전체")}${bank.sourceList.map((x) => chip("source", x, x)).join("")}</div></div>
      ${tog("shuffleQ", "문제 순서 섞기")}
      ${tog("shuffleC", "보기 순서 섞기")}
      <div class="fcount">선택한 범위: <b class="num">${n}</b>문항</div>
    </div>`;
}

/* ---------- 풀이 ---------- */
/** 저장된 풀이를 현재 문항으로 복원. 문항이 사라졌으면 그 항목은 건너뛴다 */
function restoreRun(kind: Kind): { kind: Kind; items: Item[]; i: number } | null {
  const r = loadRun(bank.id, kind);
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
  saveRun(bank.id, session.kind, {
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
      enterQuiz();
    } else {
      clearRun(bank.id, kind);
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
  if (kind === "wrong") pool = bank.questions.filter((q) => st.wrong.includes(q.n));
  else if (kind === "bm") pool = bank.questions.filter((q) => st.bm.includes(q.n));
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
type Route = { view: View; bank?: string };
const pushRoute = (v: View) => history.pushState({ view: v, bank: bank.id } satisfies Route, "");
const replaceRoute = (v: View) => history.replaceState({ view: v, bank: bank.id } satisfies Route, "");

function enterQuiz() {
  // 과목 화면에서 시작하면 한 단계 깊어지고, 결과 화면에서 다시 풀면 같은 깊이를 유지
  if (view === "subject") pushRoute("quiz");
  else replaceRoute("quiz");
  renderQuiz();
}

/** 기록에 남은 화면을 그린다. 풀이·결과는 다시 그릴 수 없어서 과목 화면으로 보낸다 */
function showRoute(r: Route | null) {
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
    body = done
      ? `<div class="myans ${correct ? "ok" : "bad"}"><span class="lbl">내 답</span>${esc(it.text || "(빈칸)")}</div>`
      : `<form class="short" id="shortForm" autocomplete="off">
          <input id="shortInput" type="text" placeholder="정답을 입력하세요" enterkeyhint="done" aria-label="정답 입력">
          <button class="next" type="submit">채점</button>
        </form>`;
  } else if (q.type === "essay") {
    body = done
      ? ""
      : it.shown
        ? `<div class="model"><div class="lbl">모범답안</div>${expHtml(q.exp)}</div>
           <p class="selfq">내 답과 비교해 보세요. 핵심을 다 떠올렸나요?</p>
           <div class="ox-btns self"><button class="ox-btn o" data-self="1">맞았어요</button><button class="ox-btn x" data-self="0">틀렸어요</button></div>`
        : `<textarea id="essayDraft" class="draft" rows="5" placeholder="머릿속으로 답해보거나 여기에 적어보세요 (저장되지 않아요)"></textarea>
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
    q.type === "ox" ? (q.answer === 1 ? "O" : "X") : q.type === "mc" ? KNUM[it.order.indexOf(q.answer!)] : q.type === "short" ? (q.accept ?? []).join(" / ") : "";
  const isBm = st.bm.includes(q.n);
  $app.innerHTML = `
    <div class="bar">
      <button class="icon-btn" data-act="subject" aria-label="그만 풀기">${I.close}</button>
      <div class="qhead" style="flex:1"><div class="progress"><span style="width:${pct(session.i + (done ? 1 : 0), total)}%"></span></div><span class="num" style="font-size:13px;color:var(--ink-2)">${session.i + 1}/${total}</span></div>
    </div>
    <div class="qtags"><span class="tag type">${TYPE_LABEL[q.type]}</span>${session.kind !== "all" ? `<span class="tag">${LABEL[session.kind]}</span>` : ""}</div>
    <div class="qno">문제 ${q.n} <span class="qsrc">· ${esc(srcText(q))}</span></div>
    <div class="qtext">${esc(q.q)}</div>
    ${body}
    ${done ? `<div class="result ${correct ? "ok" : "bad"}">
      <div class="rh">${correct ? I.check + " 정답" : I.x + " 오답"}${ansText ? `<span class="ans">정답 ${esc(ansText)}</span>` : ""}</div>
      <div class="rb"><div><div class="lbl">${q.type === "essay" ? "모범답안" : "해설"}</div>${expHtml(q.exp)}</div>
      <div class="src">${I.pg} ${esc(srcText(q))} · 출제원 ${esc(q.src)}</div></div></div>` : ""}
    <div class="qfoot">
      <button class="pill-btn bm" data-flag aria-pressed="${isBm}">${isBm ? I.bmOn : I.bm}북마크</button>
      <button class="next" data-act="next" ${done ? "" : "disabled"}>${session.i === total - 1 ? "결과 보기" : "다음 문제"}</button>
    </div>`;
  window.scrollTo(0, 0);
  if (q.type === "short" && !done) document.getElementById("shortInput")?.focus();
}

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
  const q = it.q;
  const r = st.rec[q.n] ?? { tries: 0, miss: 0, last: false };
  r.tries++;
  if (!ok) r.miss++;
  r.last = ok;
  st.rec[q.n] = r;
  if (!ok && !st.wrong.includes(q.n)) st.wrong.push(q.n);
  if (ok && session.kind === "wrong") st.wrong = st.wrong.filter((n) => n !== q.n);
  saveSubject(bank.id, st);
  persistRun();
  renderQuiz();
  if (ok && session.kind === "wrong") toast("오답노트에서 뺐어요");
  const res = document.querySelector(".result");
  if (res) setTimeout(() => res.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" }), 30);
}

function renderEnd() {
  if (!session) return;
  clearRun(bank.id, session.kind);
  view = "end";
  const items = session.items;
  const total = items.length;
  const ok = items.filter((it) => it.ok === true).length;
  const wrongs = items.filter((it) => it.ok === false);
  const ratio = total ? ok / total : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const retryWrong = wrongs.length > 0 && st.wrong.length > 0;
  $app.innerHTML = `
    <div class="bar"><button class="icon-btn" data-act="subject" aria-label="과목으로">${I.back}</button><h1>${LABEL[session.kind]} 결과</h1></div>
    <div class="score">
      <svg class="ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="10"/>
      <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--brand)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C * ratio} ${C}" transform="rotate(-90 60 60)"/>
      <text x="60" y="68" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="24" font-weight="600" fill="var(--ink)">${Math.round(ratio * 100)}%</text></svg>
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
function renderReview(keepFocus = false) {
  view = "review";
  const term = reviewOpts.q.trim();
  let list = filtered();
  if (reviewOpts.only === "wrong") list = list.filter((q) => st.wrong.includes(q.n));
  if (reviewOpts.only === "bm") list = list.filter((q) => st.bm.includes(q.n));
  if (term) list = list.filter((q) => `${q.q} ${(q.choices ?? []).join(" ")} ${(q.accept ?? []).join(" ")} ${q.exp}`.includes(term));
  const only = (v: Only, l: string) => `<button class="chip" data-only="${v}" aria-pressed="${reviewOpts.only === v}">${l}</button>`;
  const cards = list
    .map((q) => {
      const isBm = st.bm.includes(q.n);
      const opts =
        q.type === "ox"
          ? `<ol><li class="${q.answer === 1 ? "ans" : ""}"><span class="k">O</span>맞다</li><li class="${q.answer === 2 ? "ans" : ""}"><span class="k">X</span>틀리다</li></ol>`
          : q.type === "mc"
            ? `<ol>${q.choices!.map((c, i) => `<li class="${i + 1 === q.answer ? "ans" : ""}"><span class="k">${KNUM[i]}</span><span>${esc(c)}</span></li>`).join("")}</ol>`
            : q.type === "short"
              ? `<div class="ansline"><span class="lbl">정답</span>${esc((q.accept ?? []).join(" / "))}</div>`
              : "";
      return `<article class="rcard ${reviewOpts.hide ? "blur" : ""}" data-reveal>
        <div class="rtop"><span class="qno">${q.n}</span><span class="tag type">${TYPE_SHORT[q.type]}</span>${st.wrong.includes(q.n) ? '<span class="wrongmark">오답</span>' : ""}
          <span class="flags"><button class="mini bm" data-rflag="${q.n}" aria-pressed="${isBm}" aria-label="북마크">${isBm ? I.bmOn : I.bm}</button></span></div>
        <div class="q">${esc(q.q)}</div>${opts}
        <div class="exp"><div class="lbl">${q.type === "essay" ? "모범답안" : "해설"}</div>${expHtml(q.exp)}</div>
        <div class="src">${I.pg} ${esc(srcText(q))} · ${esc(q.src)}</div>
      </article>`;
    })
    .join("");
  $app.innerHTML = `
    <div class="bar"><button class="icon-btn" data-act="subject" aria-label="과목으로">${I.back}</button><h1>해설 훑어보기</h1></div>
    <label class="search">${I.search}<input id="rsearch" type="search" placeholder="키워드 검색 (예: 보험가액, ELS)" value="${esc(reviewOpts.q)}"></label>
    <div class="chips" style="margin-bottom:8px">${only("all", "전체")}${only("wrong", "오답")}${only("bm", "북마크")}</div>
    <button class="toggle" data-hide aria-pressed="${reviewOpts.hide}" style="margin:6px 0 14px"><span style="font-size:13.5px">정답·해설 가리기 <span style="color:var(--ink-3)">(카드를 눌러 확인)</span></span><span class="sw"></span></button>
    <div class="rlist">${cards || '<div class="empty">조건에 맞는 문제가 없어요</div>'}</div>`;
  if (keepFocus) {
    const i = document.getElementById("rsearch") as HTMLInputElement;
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  }
}

/* ---------- 이벤트 ---------- */
function toggleBookmark(n: number) {
  const on = !st.bm.includes(n);
  st.bm = on ? [...st.bm, n] : st.bm.filter((x) => x !== n);
  saveSubject(bank.id, st);
  toast(on ? "북마크했어요" : "북마크를 해제했어요");
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
  if (d.pref === "type" || d.pref === "source") {
    if (d.pref === "type") prefs.type = d.val as typeof prefs.type;
    else prefs.source = d.val!;
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
    return renderReview();
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

$app.addEventListener("submit", (e) => {
  if ((e.target as HTMLElement).id !== "shortForm" || !session) return;
  e.preventDefault();
  const it = session.items[session.i];
  it.text = (document.getElementById("shortInput") as HTMLInputElement).value.trim();
  grade(isAccepted(it.q, it.text));
});

$app.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "rsearch") {
    reviewOpts.q = el.value;
    renderReview(true);
  }
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

window.addEventListener("popstate", (e) => showRoute(e.state as Route | null));

/* ---------- 제스처: 왼쪽 가장자리에서 오른쪽으로 밀면 뒤로, 맨 위에서 당기면 새로고침 ---------- */
const EDGE = 28; // 왼쪽 가장자리 인식 폭(px)
const BACK_AT = 80; // 이만큼 밀면 뒤로
const PULL_AT = 70; // 이만큼 당기면 새로고침
const $edge = document.getElementById("edge")!;
const $ptr = document.getElementById("ptr")!;
let g: { x: number; y: number; mode: "back" | "pull" | null; d: number } | null = null;

document.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length !== 1 || document.querySelector(".sheet-wrap")) return (g = null);
    const t = e.touches[0];
    const mode = t.clientX <= EDGE && view !== "home" ? "back" : window.scrollY <= 0 ? "pull" : null;
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
  if (mode === "back" && d >= BACK_AT) goBack();
  if (mode === "pull" && d >= PULL_AT) {
    $ptr.classList.add("spin");
    location.reload();
  }
});
document.addEventListener("touchcancel", resetGesture);

showRoute(history.state as Route | null);
