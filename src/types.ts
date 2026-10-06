export type QuestionType = "ox" | "mc";

export interface Question {
  n: number;
  type: QuestionType;
  q: string;
  /** mc 전용. ox는 생략 */
  choices?: string[];
  /** ox: 1=O, 2=X / mc: 보기 번호(1부터) */
  answer: number;
  exp: string;
  /** 출제원. 앞부분("1권")이 partOf로 영역에 매핑된다 */
  src: string;
  /** 문제 출처(PDF 이름). 생략하면 과목의 source를 쓴다 */
  source?: string;
}

export interface Bank {
  id: string;
  title: string;
  org: string;
  round: string;
  /** 문제 출처(원본 PDF 이름) */
  source: string;
  parts: string[];
  partOf: Record<string, string>;
  questions: Question[];
}

/** 런타임에 영역(part)을 붙인 문항 */
export interface Q extends Question {
  part: string;
  source: string;
}

export interface LoadedBank extends Omit<Bank, "questions"> {
  questions: Q[];
}
