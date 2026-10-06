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
  type: "all" | "ox" | "mc";
  part: string;
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
  return { type: "all", part: "all", shuffleQ: false, shuffleC: false, ...read<Partial<Prefs>>("gichul:prefs") };
}

export const savePrefs = (p: Prefs) => write("gichul:prefs", p);
