# 기출노트

기출 문제를 한 문제씩 풀고 바로 정답·해설을 확인하는 모바일 웹. Vite + 바닐라 TypeScript, 기록은 브라우저(localStorage)에 저장.

## 실행

```bash
npm install
npm run dev
```

## 과목 추가

`src/data/banks/`에 JSON 파일을 하나 넣으면 홈에 과목이 생긴다. 형식은 `src/types.ts`의 `Bank` 참고. 기존 과목에 문항을 더할 때는 `n`을 이어서 붙인다(풀이 기록이 `n` 기준이라 기존 번호는 바꾸지 않는다).

- `type`: `"ox"`(answer 1=O, 2=X) · `"mc"`(answer=보기 번호, 1부터) · `"short"`(accept=인정 답 목록, 띄어쓰기 무시 자동 채점) · `"essay"`(exp=모범답안, 스스로 채점)
- `sources`: 문제 출처(원본 PDF 이름). 여러 PDF에 나온 문제는 모두 적는다 → 출처 필터에 쓰인다
- `src`: 출제원(교재 쪽수)
- `quote`(선택): 교재 원문 인용 / `answerText`(선택, short): 정답 표시 문구

정답이 자료마다 다른 문항은 `docs/정답-확인필요.md`에 모아 둔다.

## 배포

`main`에 push하면 GitHub Actions가 GitHub Pages(https://seunghw2.github.io/gichul-note/)로 배포한다.
