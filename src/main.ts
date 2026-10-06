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
}

const $app = document.getElementById("app")!;
const $toast = document.getElementById("toast")!;

const KNUM = ["①", "②", "③", "④", "⑤"];
const LABEL: Record<Kind, string> = { all: "문제 풀기", wrong: "오답노트", bm: "북마크" };
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
    (q) => (prefs.type === "all" || q.type === prefs.type) && (prefs.part === "all" || q.part === prefs.part),
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
      <div class="top"><div><h2>${esc(b.title)}</h2><div class="meta">${esc(b.org)} · ${s.total}문항</div><div class="meta">출처 ${esc(b.source)}</div></div><span class="badge">${esc(b.round)}</span></div>
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
  const chip = (k: "type" | "part", v: string, label: string) =>
    `<button class="chip" data-pref="${k}" data-val="${esc(v)}" aria-pressed="${prefs[k] === v}">${esc(label)}</button>`;
  const tog = (k: "shuffleQ" | "shuffleC", label: string) =>
    `<button class="toggle" data-tog="${k}" aria-pressed="${prefs[k]}"><span>${label}</span><span class="sw"></span></button>`;
  const partLabel = (p: string) => {
    const vol = Object.keys(bank.partOf).find((k) => bank.partOf[k] === p);
    return vol ? `${p} (${vol})` : p;
  };
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
      <div class="frow"><label>유형</label><div class="chips">${chip("type", "all", "전체")}${chip("type", "ox", "OX 진위형")}${chip("type", "mc", "4지선다")}</div></div>
      <div class="frow"><label>영역</label><div class="chips">${chip("part", "all", "전체")}${bank.parts.map((p) => chip("part", p, partLabel(p))).join("")}</div></div>
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
  const items: Item[] = [];
  let i = 0;
  r.ns.forEach((n, idx) => {
    const q = bank.questions.find((x) => x.n === n);
    if (!q) return;
    if (idx === r.i) i = items.length;
    items.push({ q, order: r.orders[idx], pick: r.picks[idx] });
  });
  // 하나도 안 풀었거나 다 풀었으면 이어 풀 것이 없다
  if (items.every((it) => it.pick === null) || items.every((it) => it.pick !== null)) return null;
  return { kind, items, i };
}

function runProgress(kind: Kind) {
  const r = restoreRun(kind);
  if (!r) return null;
  return { done: r.items.filter((it) => it.pick !== null).length, total: r.items.length };
}

function persistRun() {
  if (!session) return;
  saveRun(bank.id, session.kind, {
    ns: session.items.map((it) => it.q.n),
    orders: session.items.map((it) => it.order),
    picks: session.items.map((it) => it.pick),
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
      renderQuiz();
    } else {
      clearRun(bank.id, kind);
      startSession(kind);
    }
  });
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
    items: pool.map((q) => {
      const base = (q.choices ?? []).map((_, i) => i + 1);
      return { q, order: q.type === "mc" && prefs.shuffleC ? shuffle(base) : base, pick: null };
    }),
  };
  persistRun();
  renderQuiz();
}

function renderQuiz() {
  if (!session) return;
  view = "quiz";
  const it = session.items[session.i];
  const q = it.q;
  const done = it.pick !== null;
  const total = session.items.length;
  const correct = done && it.pick === q.answer;

  let body: string;
  if (q.type === "ox") {
    const cls = (v: number) => (!done ? "" : v === q.answer ? "correct" : v === it.pick ? "wrong" : "");
    body = `
      <div class="ox-btns">
        <button class="ox-btn o ${cls(1)}" data-pick="1" ${done ? "disabled" : ""} aria-label="O 맞음">O</button>
        <button class="ox-btn x ${cls(2)}" data-pick="2" ${done ? "disabled" : ""} aria-label="X 틀림">X</button>
      </div>`;
  } else {
    body = `<div class="choices">${it.order
      .map((orig, idx) => {
        const c = !done ? "" : orig === q.answer ? "correct" : orig === it.pick ? "wrong" : "dim";
        return `<button class="choice ${c}" data-pick="${orig}" ${done ? "disabled" : ""}><span class="k">${idx + 1}</span><span>${esc(q.choices![orig - 1])}</span></button>`;
      })
      .join("")}</div>`;
  }

  const ansText = q.type === "ox" ? (q.answer === 1 ? "O" : "X") : KNUM[it.order.indexOf(q.answer)];
  const isBm = st.bm.includes(q.n);
  $app.innerHTML = `
    <div class="bar">
      <button class="icon-btn" data-act="subject" aria-label="그만 풀기">${I.close}</button>
      <div class="qhead" style="flex:1"><div class="progress"><span style="width:${pct(session.i + (done ? 1 : 0), total)}%"></span></div><span class="num" style="font-size:13px;color:var(--ink-2)">${session.i + 1}/${total}</span></div>
    </div>
    <div class="qtags"><span class="tag type">${q.type === "ox" ? "OX 진위형" : "4지선다"}</span><span class="tag">${esc(q.part)}</span>${session.kind !== "all" ? `<span class="tag">${LABEL[session.kind]}</span>` : ""}</div>
    <div class="qno">문제 ${q.n} <span class="qsrc">· ${esc(q.source)}</span></div>
    <div class="qtext">${esc(q.q)}</div>
    ${body}
    ${done ? `<div class="result ${correct ? "ok" : "bad"}">
      <div class="rh">${correct ? I.check + " 정답" : I.x + " 오답"}<span class="ans">정답 ${ansText}</span></div>
      <div class="rb"><div><div class="lbl">해설</div>${esc(q.exp)}</div>
      <div class="src">${I.pg} ${esc(q.source)} · 출제원 ${esc(q.src)}</div></div></div>` : ""}
    <div class="qfoot">
      <button class="pill-btn bm" data-flag aria-pressed="${isBm}">${isBm ? I.bmOn : I.bm}북마크</button>
      <button class="next" data-act="next" ${done ? "" : "disabled"}>${session.i === total - 1 ? "결과 보기" : "다음 문제"}</button>
    </div>`;
  window.scrollTo(0, 0);
}

function pick(v: number) {
  if (!session) return;
  const it = session.items[session.i];
  if (it.pick !== null) return;
  it.pick = v;
  const q = it.q;
  const ok = v === q.answer;
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
  const ok = items.filter((it) => it.pick === it.q.answer).length;
  const wrongs = items.filter((it) => it.pick !== null && it.pick !== it.q.answer);
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
  if (term) list = list.filter((q) => `${q.q} ${(q.choices ?? []).join(" ")} ${q.exp}`.includes(term));
  const only = (v: Only, l: string) => `<button class="chip" data-only="${v}" aria-pressed="${reviewOpts.only === v}">${l}</button>`;
  const cards = list
    .map((q) => {
      const isBm = st.bm.includes(q.n);
      const opts =
        q.type === "ox"
          ? `<ol><li class="${q.answer === 1 ? "ans" : ""}"><span class="k">O</span>맞다</li><li class="${q.answer === 2 ? "ans" : ""}"><span class="k">X</span>틀리다</li></ol>`
          : `<ol>${q.choices!.map((c, i) => `<li class="${i + 1 === q.answer ? "ans" : ""}"><span class="k">${KNUM[i]}</span><span>${esc(c)}</span></li>`).join("")}</ol>`;
      return `<article class="rcard ${reviewOpts.hide ? "blur" : ""}" data-reveal>
        <div class="rtop"><span class="qno">${q.n}</span><span class="tag type">${q.type === "ox" ? "OX" : "4지"}</span><span class="tag">${esc(q.part)}</span>${st.wrong.includes(q.n) ? '<span class="wrongmark">오답</span>' : ""}
          <span class="flags"><button class="mini bm" data-rflag="${q.n}" aria-pressed="${isBm}" aria-label="북마크">${isBm ? I.bmOn : I.bm}</button></span></div>
        <div class="q">${esc(q.q)}</div>${opts}
        <div class="exp"><div class="lbl">해설</div>${esc(q.exp)}</div>
        <div class="src">${I.pg} ${esc(q.source)} · ${esc(q.src)}</div>
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
    return go(renderSubject);
  }
  if (d.act === "home") return go(renderHome);
  if (d.act === "subject") return go(renderSubject);
  if (d.act === "review") return go(renderReview);
  if (d.act === "next" && session) {
    if (session.i < session.items.length - 1) {
      session.i++;
      persistRun();
      return renderQuiz();
    }
    return renderEnd();
  }
  if (d.start) return view === "end" ? startSession(d.start as Kind) : chooseSession(d.start as Kind);
  if (d.pref === "type" || d.pref === "part") {
    if (d.pref === "type") prefs.type = d.val as typeof prefs.type;
    else prefs.part = d.val!;
    savePrefs(prefs);
    return renderSubject();
  }
  if (d.tog === "shuffleQ" || d.tog === "shuffleC") {
    prefs[d.tog] = !prefs[d.tog];
    savePrefs(prefs);
    return renderSubject();
  }
  if (d.pick) return pick(Number(d.pick));
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

$app.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "rsearch") {
    reviewOpts.q = el.value;
    renderReview(true);
  }
});

document.addEventListener("keydown", (e) => {
  if (view !== "quiz" || !session || (e.target as HTMLElement).tagName === "INPUT") return;
  const it = session.items[session.i];
  if (it.pick === null) {
    if (it.q.type === "ox") {
      if (e.key === "o" || e.key === "ArrowLeft") pick(1);
      if (e.key === "x" || e.key === "ArrowRight") pick(2);
    } else if (/^[1-4]$/.test(e.key)) pick(it.order[Number(e.key) - 1]);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    document.querySelector<HTMLButtonElement>('[data-act="next"]')?.click();
  }
});

renderHome();
