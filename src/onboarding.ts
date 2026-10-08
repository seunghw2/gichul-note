/* 첫 접속 온보딩: 브랜드 컬러 바탕의 넘겨보기 카드 4장. 기기에서 처음 한 번만, 홈의 ? 버튼으로 다시 보기 */
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
  <div class="ob-ox"><div class="o">O</div><div class="x">X</div></div>`;

/** 첫 장: 문제 아래에서 미리보기 밖으로 떠오르는 정답 카드 (장에 들어올 때마다 팝업 애니메이션) */
const answerCard = `
  <div class="ob-fc" aria-hidden="true">
    <div class="h">✓ 정답<span>정답 O</span></div>
    <div class="b">
      <div><div class="l">해설</div>증권은 손실이 원금까지만 나는 금융투자상품이에요.<br>원금 넘게 손실이 날 수 있으면 파생상품이에요.</div>
      <div class="qt"><div class="l">원문 인용 · 교재 1권 p.9</div>증권이란 투자자의 최대손실이 투자원금으로 한정되는 금융투자상품…</div>
    </div>
  </div>`;

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
const isAndroid = /Android/.test(navigator.userAgent);
const ADD_STEPS = isAndroid
  ? [["메뉴 버튼", "크롬 오른쪽 위 ⋮", "⋮"], ["홈 화면에 추가", "또는 '앱 설치'", "⊞"], ["홈에서 열기", "앱처럼 전체 화면", ""]]
  : [["공유 버튼", "사파리 아래 가운데", "⬆︎"], ["홈 화면에 추가", "목록에서 선택", "⊞"], ["홈에서 열기", "앱처럼 전체 화면", ""]];
const ADD_OTHER = isAndroid ? "아이폰은 사파리 공유 버튼에서 추가해요." : "안드로이드는 크롬 메뉴 ⋮에서 추가해요.";
const stepsMini = ADD_STEPS.map(
  ([t, d, i], k) =>
    `<div class="ob-step"><span class="k">${k + 1}</span><span><b>${t}</b><small>${d}</small></span>${i ? `<span class="i">${i}</span>` : '<span class="app">기출</span>'}</div>`,
).join("");

const SLIDES = [
  { n: "01 · 바로 채점", h: "풀자마자<br>정답과 해설", p: "NotebookLM과 Claude Code로<br>교재를 대조해 쓴 해설이에요.<br>원문과 쪽수도 함께 나와요.", pip: oxMini + answerCard },
  { n: "02 · 나눠서 관리", h: "기출과 교재,<br>오답은 따로", p: "틀린 문제는 오답노트에 자동으로,<br>맞히면 바로 빠져요.", pip: tabMini },
  { n: "03 · 앱처럼", h: "홈 화면에<br>추가하세요", p: `세 번만 누르면 앱처럼 써요.<br>${ADD_OTHER}`, pip: stepsMini },
  {
    n: "04 · 서버리스",
    h: "계정 없이,<br>이 기기에만",
    p: '백엔드 없는 정적 웹앱(GitHub Pages)이라<br>가입·로그인 없이 바로 써요.<br>풀이 기록은 이 브라우저의<br>localStorage에만 저장돼요.<span class="ob-warn">⚠︎ 사이트 데이터를 지우면<br>기록도 함께 지워져요.</span>',
  },
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
      (s) =>
        `<section class="onb-slide"><div class="ob-num">${s.n}</div><h2>${s.h}</h2><p>${s.p}</p>${s.pip ? `<div class="ob-pip">${s.pip}</div>` : ""}</section>`,
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
    io.disconnect();
    el.classList.add("out");
    document.documentElement.classList.remove("onb-open");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-onb]")?.dataset.onb;
    if (a === "skip") close();
    if (a === "next") (i === SLIDES.length - 1 ? close() : go(i + 1));
  });
  // 장이 화면에 어느 정도 보이면 그 장의 등장 애니메이션을 한 번만 재생(다시 돌아와도 반복하지 않음)
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.intersectionRatio >= 0.15) {
          en.target.classList.add("play");
          io.unobserve(en.target);
        }
      }),
    { root: track, threshold: 0.15 },
  );
  el.querySelectorAll(".onb-slide").forEach((sl) => io.observe(sl));
  track.addEventListener("scroll", sync, { passive: true });
  sync();
}
