# 기출노트

기출 문제를 한 문제씩 풀고 바로 정답·해설을 확인하는 모바일 웹. Vite + 바닐라 TypeScript, 기록은 브라우저(localStorage)에 저장.

## 실행

```bash
npm install
npm run dev
```

## 과목 추가

`src/data/banks/`에 JSON 파일을 하나 넣으면 홈에 과목이 생긴다. 형식은 `src/types.ts`의 `Bank` 참고.

- `type`: `"ox"`(answer 1=O, 2=X) 또는 `"mc"`(answer=보기 번호, 1부터)
- `src`: 출제원(예: `"1권 9p"`). 앞부분이 `partOf`로 영역(펀드/방카슈랑스 등)에 매핑된다.

## 배포

`main`에 push하면 GitHub Actions가 GitHub Pages(https://seunghw2.github.io/gichul-note/)로 배포한다.
