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
  /** 해설. essay는 모범답안 */
  exp: string;
  /** 출제원(교재 장·절·쪽) */
  src: string;
  /** 문제 출처(원본 PDF 이름). 여러 PDF에 나온 문제는 모두 적는다 */
  sources: string[];
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
