/* 첫 접속 온보딩: 브랜드 컬러 바탕의 넘겨보기 카드 3장. 기기에서 처음 한 번만 */
const KEY = "gichul:onboarded";

export function seenOnboarding() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // 저장이 안 되는 환경이면 매번 띄우지 않는다
  }
}

const oxMini = `
  <span class="ob-chip">OX 진위형</span>
  <div class="ob-q">자본시장법상 증권은 최대손실이 원금으로 한정된다.</div>
  <div class="ob-ox"><div class="o on">O</div><div class="x">X</div></div>
  <div class="ob-res"><div class="h">✓ 정답<span>정답 O</span></div><div class="b">
    <div class="l">해설</div>증권에 대한 맞는 설명이다.
    <div class="qt"><div class="l">원문 인용</div>증권이란 최대손실이 투자원금으로 한정되는 금융투자상품…</div>
    <div class="src">출제원 교재 1권 p.9</div></div></div>`;

const tabMini = `
  <div class="ob-seg"><div class="on">온라인 기출</div><div>교재 문항</div></div>
  ${[
    ["▶", "문제 풀기", "154", "var(--brand)"],
    ["✕", "오답노트", "12", "var(--bad)"],
    ["↻", "자주 틀린 문제", "4", "var(--mark)"],
    ["★", "북마크", "7", "var(--ink-2)"],
  ]
    .map(([i, t, n, c]) => `<div class="ob-row"><span style="color:${c}">${i}</span>${t}<span class="n">${n}</span></div>`)
    .join("")}`;

/** 홈 화면 추가 방법은 기기마다 다르다: 아이폰=사파리 공유, 안드로이드=크롬 메뉴 */
const ua = navigator.userAgent;
const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const ADD_HINT = isIOS ? "공유 ⬆︎ → 홈 화면에 추가" : isAndroid ? "메뉴 ⋮ → 홈 화면에 추가" : "아이폰: 공유 ⬆︎ · 안드로이드: 메뉴 ⋮";

const storeMini = `
  ${[
    [`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d='M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z'/><path d='M4 4l16 16'/></svg>`, "서버 없음", "문제와 앱이 모두 이 페이지 안에"],
    [`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx='12' cy='8' r='4'/><path d='M4 21a8 8 0 0 1 16 0'/></svg>`, "가입·로그인 없음", "열자마자 바로 풀기"],
    [`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x='6' y='2.5' width='12' height='19' rx='2.5'/><path d='M11 18.5h2'/></svg>`, "이 기기에 저장", "사이트 데이터를 지우면 기록도 지워져요"],
  ]
    .map(([i, t, d]) => `<div class="ob-row ob-store"><span class="i">${i}</span><span><b>${t}</b><small>${d}</small></span></div>`)
    .join("")}
  <div class="ob-add"><b>기출</b><span>홈 화면에 추가하면 앱처럼<br><em>${ADD_HINT}</em></span></div>`;

const SLIDES = [
  { n: "01 · 바로 채점", h: "풀자마자<br>정답과 해설", p: "해설마다 교재 원문과 쪽수가 함께 나와요.", pip: oxMini },
  { n: "02 · 나눠서 관리", h: "기출과 교재,<br>오답은 따로", p: "틀린 문제는 오답노트에 자동으로 담기고, 맞히면 빠져요.", pip: tabMini },
  { n: "03 · 가입 없이", h: "로그인 없이,<br>이 기기에 저장", p: "서버 없이 동작해요. 풀이 기록은 이 기기 브라우저에만 저장돼요.", pip: storeMini },
];

export function showOnboarding() {
  if (document.querySelector(".onb")) return;
  const el = document.createElement("div");
  el.className = "onb";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "기출노트 사용법");
  el.innerHTML = `
    <button class="onb-skip" data-onb="skip">건너뛰기</button>
    <div class="onb-track">${SLIDES.map(
      (s) => `<section class="onb-slide"><div class="ob-num">${s.n}</div><h2>${s.h}</h2><p>${s.p}</p><div class="ob-pip">${s.pip}</div></section>`,
    ).join("")}</div>
    <div class="onb-foot"><div class="onb-dots">${SLIDES.map(() => "<i></i>").join("")}</div><button class="onb-cta" data-onb="next"></button></div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add("onb-open");
  const track = el.querySelector<HTMLElement>(".onb-track")!;
  let i = -1;
  // 손가락을 따라 움직이는 브라우저 기본 가로 스크롤(스냅)로 넘기고, 버튼은 같은 스크롤을 부드럽게 움직인다
  const go = (n: number) => track.scrollTo({ left: Math.max(0, Math.min(SLIDES.length - 1, n)) * track.clientWidth, behavior: "smooth" });
  const sync = () => {
    const n = Math.round(track.scrollLeft / track.clientWidth);
    if (n === i) return;
    i = n;
    el.querySelectorAll(".onb-dots i").forEach((d, k) => d.classList.toggle("on", k === i));
    el.querySelector(".onb-cta")!.textContent = i === SLIDES.length - 1 ? "시작하기" : "다음";
    el.querySelector<HTMLElement>(".onb-skip")!.hidden = i === SLIDES.length - 1;
  };
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* 무시 */
    }
    el.classList.add("out");
    document.documentElement.classList.remove("onb-open");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-onb]")?.dataset.onb;
    if (a === "skip") close();
    if (a === "next") (i === SLIDES.length - 1 ? close() : go(i + 1));
  });
  track.addEventListener("scroll", sync, { passive: true });
  sync();
}
