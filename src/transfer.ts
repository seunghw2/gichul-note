/* 기록 옮기기: 이 기기의 기록(localStorage의 gichul:* 항목)을 링크 하나에 담아 다른 기기로 옮긴다.
   링크의 # 뒤(#import=...)는 서버로 전송되지 않고 브라우저 안에서만 읽힌다. 서버 없이 동작. */
import { BANKS } from "./data";
import { trackOnce } from "./stats";

const PREFIX = "gichul:";
/** 사용자 순위용 익명 번호(stats.ts와 같은 키) */
const ID_KEY = "gichul:gc-id";
// 통계용 '오늘 보냄' 표시와 연속 방문 기록은 기기마다 따로 있어야 하므로 옮기지 않는다
const SKIP = /^gichul:(gc-once:|gc-streak$|stats-pass$|gc-alias$)/;

type Payload = { v: 1; t: number; d: Record<string, string> };
type SubjectLike = { rec?: Record<string, { tries: number; miss: number; last: boolean }>; bm?: number[]; wrong?: number[] };

function collect(): Record<string, string> {
  const d: Record<string, string> = {};
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX) && !SKIP.test(k)) d[k] = localStorage.getItem(k) ?? "";
  } catch {
    /* 저장소 접근 불가 */
  }
  return d;
}

/** 과목 기록 요약: 푼 문제·오답노트·북마크 수 */
export function summarize(d: Record<string, string>) {
  let solved = 0, wrong = 0, bm = 0;
  for (const b of BANKS) {
    const raw = d[PREFIX + b.id];
    if (!raw) continue;
    try {
      const s = JSON.parse(raw) as SubjectLike;
      solved += Object.keys(s.rec ?? {}).length;
      wrong += (s.wrong ?? []).length;
      bm += (s.bm ?? []).length;
    } catch {
      /* 깨진 항목은 건너뜀 */
    }
  }
  return { solved, wrong, bm };
}
export const localSummary = () => summarize(collect());

// base64url ↔ 바이트
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** 압축이 되는 브라우저면 z+압축, 아니면 j+그대로 */
async function encode(p: Payload) {
  const raw = new TextEncoder().encode(JSON.stringify(p));
  if (typeof CompressionStream !== "undefined") return "z" + toB64(await pipe(raw, new CompressionStream("deflate-raw")));
  return "j" + toB64(raw);
}
async function decode(code: string): Promise<Payload> {
  const bytes = fromB64(code.slice(1));
  const raw = code[0] === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
  const p = JSON.parse(new TextDecoder().decode(raw)) as Payload;
  if (p.v !== 1 || typeof p.d !== "object") throw new Error("형식이 맞지 않아요");
  return p;
}

export async function makeLink() {
  const code = await encode({ v: 1, t: Date.now(), d: collect() });
  return `${location.origin}${location.pathname}#import=${code}`;
}

/** 붙여넣은 글(링크 전체 또는 일부)에서 #import= 코드를 찾아 푼다. 없으면 null */
export async function readPasted(text: string): Promise<Payload | null | "error"> {
  const m = /#import=([\w-]+)/.exec(text.trim());
  if (!m) return null;
  try {
    return await decode(m[1]);
  } catch {
    return "error";
  }
}

/** 주소에 #import= 가 있으면 꺼내고 주소에서는 지운다 */
export async function readIncoming(): Promise<Payload | null | "error"> {
  const m = /^#import=(.+)$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(history.state, "", location.pathname + location.search);
  try {
    return await decode(m[1]);
  } catch {
    return "error";
  }
}

function mergeSubject(local: string | null, inc: string) {
  if (!local) return inc;
  try {
    const a = JSON.parse(local) as SubjectLike, b = JSON.parse(inc) as SubjectLike;
    const rec = { ...(a.rec ?? {}) };
    for (const [n, r] of Object.entries(b.rec ?? {})) {
      const x = rec[n];
      rec[n] = x ? { tries: x.tries + r.tries, miss: x.miss + r.miss, last: r.last } : r;
    }
    const union = (p?: number[], q?: number[]) => [...new Set([...(p ?? []), ...(q ?? [])])];
    return JSON.stringify({ ...a, rec, bm: union(a.bm, b.bm), wrong: union(a.wrong, b.wrong) });
  } catch {
    return inc;
  }
}

/** 합치기: 과목 기록은 합치고(푼 횟수 더함, 오답·북마크 합집합) 나머지는 이 기기에 없을 때만 채움 / 덮어쓰기: 이 기기 기록을 지우고 받은 기록으로 */
export function applyImport(p: Payload, mode: "merge" | "overwrite") {
  const subjectKeys = new Set(BANKS.map((b) => PREFIX + b.id));
  // 사용자 순위(숨은 통계)도 이어지게: 받은 익명 번호를 이 기기가 이어받고, 이 기기의 예전 번호는 받은 번호로 합치라고 알린다
  const incId = p.d[ID_KEY];
  const curId = localStorage.getItem(ID_KEY);
  // 가져온 직후 새로고침하므로 지금 보내면 사라질 수 있다 → 저장해 두고 다음 실행 때 보낸다(stats.ts sendPendingAlias)
  if (incId && curId && incId !== curId) localStorage.setItem("gichul:gc-alias", `alias/${curId}/${incId}`);
  if (mode === "overwrite") for (const k of Object.keys(collect())) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(p.d)) {
    if (!k.startsWith(PREFIX) || SKIP.test(k)) continue;
    const cur = localStorage.getItem(k);
    if (mode === "overwrite" || cur === null) localStorage.setItem(k, v);
    else if (subjectKeys.has(k)) localStorage.setItem(k, mergeSubject(cur, v));
  }
  if (incId) localStorage.setItem(ID_KEY, incId);
  trackOnce("transfer/import", "day");
}
