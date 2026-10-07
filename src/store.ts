export interface Rec {
  tries: number;
  miss: number;
  last: boolean;
}

export interface SubjectState {
  rec: Record<number, Rec>;
  bm: number[];
  wrong: number[];
}

export interface Prefs {
  type: "all" | "ox" | "mc" | "short" | "essay";
  /** 과목 화면 탭: 온라인 시험 기출 / 교재 문항 (마지막으로 본 탭 기억) */
  tab: "exam" | "book";
  shuffleQ: boolean;
  shuffleC: boolean;
}

const key = (id: string) => `gichul:${id}`;

function read<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 저장 불가(사파리 개인정보 보호 모드 등)면 이번 세션만 유지 */
  }
}

export function loadSubject(id: string): SubjectState {
  const v = read<SubjectState & { un?: number[] }>(key(id));
  if (!v) return { rec: {}, bm: [], wrong: [] };
  // 예전 목업의 '헷갈림' 기록은 북마크로 합친다
  const bm = [...new Set([...(v.bm ?? []), ...(v.un ?? [])])];
  return { rec: v.rec ?? {}, bm, wrong: v.wrong ?? [] };
}

export const saveSubject = (id: string, s: SubjectState) => write(key(id), s);

export function loadPrefs(): Prefs {
  return { type: "all", tab: "exam", shuffleQ: false, shuffleC: false, ...read<Partial<Prefs>>("gichul:prefs") };
}

export const savePrefs = (p: Prefs) => write("gichul:prefs", p);

/** 중간에 그만둔 풀이. 과목·모드(문제 풀기/오답/북마크)별로 하나씩 보관 */
export interface SavedRun {
  ns: number[];
  orders: number[][];
  picks: (number | null)[];
  /** 채점 결과(단답·약술형 포함). 예전 기록엔 없을 수 있다 */
  oks?: (boolean | null)[];
  texts?: (string | null)[];
  i: number;
}

const runKey = (id: string, kind: string) => `gichul:${id}:run:${kind}`;

export const loadRun = (id: string, kind: string) => read<SavedRun>(runKey(id, kind));
export const saveRun = (id: string, kind: string, r: SavedRun) => write(runKey(id, kind), r);
export function clearRun(id: string, kind: string) {
  try {
    localStorage.removeItem(runKey(id, kind));
  } catch {
    /* 무시 */
  }
}
