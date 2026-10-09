/** ox: O/X 진위형, mc: 4지선다, short: 단답형(입력 후 자동 채점), essay: 약술형(모범답안 보고 스스로 채점) */
export type QuestionType = "ox" | "mc" | "short" | "essay";

export interface Question {
  n: number;
  type: QuestionType;
  q: string;
  /** mc 전용 */
  choices?: string[];
  /** ox: 1=O, 2=X / mc: 보기 번호(1부터) */
  answer?: number;
  /** short 전용. 인정하는 답(띄어쓰기·기호 무시하고 비교) */
  accept?: string[];
  /** short 전용. 정답 표시용 문구(없으면 accept를 이어 붙여 보여준다) */
  answerText?: string;
  /** 해설. essay는 모범답안 */
  exp: string;
  /** 해설에 덧붙이는 교재 원문 인용(정답지 자료) */
  quote?: string;
  /** 출제원(교재 장·절·쪽) */
  src: string;
  /** 문제 출처(원본 PDF 이름). 여러 PDF에 나온 문제는 모두 적는다 */
  sources: string[];
  /** 변형 문제 전용: 바탕이 된 원본 문항 번호 */
  variantOf?: number;
  /** 변형 문제 전용: 원본과 달라진 점(채점 후 표시) */
  diff?: string;
}

export interface Bank {
  id: string;
  title: string;
  org: string;
  round: string;
  questions: Question[];
}

export type Q = Question;

export interface LoadedBank extends Bank {
  /** 문항에 나온 출처 목록(등장 순) */
  sourceList: string[];
}
