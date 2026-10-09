/* 더보기 → 함께 만든 사람들. 별명만 표시(실명 X). 추가할 때 이 목록에 한 줄 넣으면 됨 */
export type Contributor = { name: string; what: string; tag: string; tone: "brand" | "mark" };
export const CONTRIBUTORS: Contributor[] = [
  { name: "포세일돈", what: "온라인 시험 문제 공유", tag: "문항", tone: "brand" },
  { name: "자마균", what: "퀴즈 기능 제안", tag: "아이디어", tone: "mark" },
];
