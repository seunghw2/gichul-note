/* 첫 접속 온보딩: 브랜드 컬러 바탕의 넘겨보기 카드 3장. 처음 한 번만, 홈의 '사용법 다시 보기'로 다시 볼 수 있다 */
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
  <div class="ob-res"><div class="h">✓ 정답</div><div class="b">해설 · 출제원 교재 1권 p.9</div></div>`;

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

const homeMini = `
  <div class="ob-icons">${'<i></i>'.repeat(4)}<b>기출</b></div>
  <div class="ob-hint">공유 ⬆︎ → 홈 화면에 추가</div>`;

const SLIDES = [
  { n: "01 · 바로 채점", h: "풀자마자<br>정답과 해설", p: "해설마다 교재 원문과 쪽수가 함께 나와요.", pip: oxMini },
  { n: "02 · 나눠서 관리", h: "기출과 교재,<br>오답은 따로", p: "틀린 문제는 오답노트에 자동으로 담기고, 맞히면 빠져요.", pip: tabMini },
  { n: "03 · 앱처럼", h: "홈 화면에<br>추가하세요", p: "사파리 공유 → 홈 화면에 추가. 왼쪽 끝에서 밀면 뒤로 가요.", pip: homeMini },
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
  const track = el.querySelector<HTMLElement>(".onb-track")!;
  let i = 0;
  const go = (n: number) => {
    i = Math.max(0, Math.min(SLIDES.length - 1, n));
    track.style.transform = `translateX(${-i * 100}%)`;
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
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-onb]")?.dataset.onb;
    if (a === "skip") close();
    if (a === "next") (i === SLIDES.length - 1 ? close() : go(i + 1));
  });
  // 옆으로 밀어서 넘기기
  let sx = 0;
  let sy = 0;
  el.addEventListener("touchstart", (e) => ((sx = e.touches[0].clientX), (sy = e.touches[0].clientY)), { passive: true });
  el.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.changedTouches[0].clientY - sy)) go(i + (dx < 0 ? 1 : -1));
  });
  go(0);
}
