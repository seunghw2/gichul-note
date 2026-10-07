// 문항 JSON → 읽기용 마크다운(docs/문제-해설-전체.md). 실행: npm run export
import { readFileSync, writeFileSync } from "node:fs";

const bank = JSON.parse(readFileSync("src/data/banks/banca-fund-17.json", "utf8"));
const KNUM = ["①", "②", "③", "④", "⑤"];
const TYPES = [
  ["ox", "OX 진위형"],
  ["mc", "4지선다"],
  ["short", "단답형"],
  ["essay", "약술형"],
];
const breakNums = (t) => t.replace(/\s+(?=[①-⑨])/g, "  \n");

const answerOf = (q) =>
  q.type === "ox" ? (q.answer === 1 ? "O" : "X")
  : q.type === "mc" ? `${KNUM[q.answer - 1]} ${q.choices[q.answer - 1]}`
  : q.type === "short" ? q.answerText ?? q.accept.join(" / ")
  : "모범답안 참고";

const out = [];
const sources = [...new Set(bank.questions.flatMap((q) => q.sources))];
out.push(`# ${bank.title} 문제·해설 전체`, "");
out.push(`- 문제지 버전: **v${bank.version ?? 1}**${bank.versionNote ? ` — ${bank.versionNote}` : ""}`);
out.push(`- 문항 수: **${bank.questions.length}**`);
out.push(`- 유형: ${TYPES.map(([t, l]) => `${l} ${bank.questions.filter((q) => q.type === t).length}`).join(" · ")}`);
out.push(`- 출처: ${sources.map((s) => `${s} ${bank.questions.filter((q) => q.sources.includes(s)).length}`).join(" · ")}`);
out.push(`- 번호는 앱의 문제 번호와 같습니다.`, "");
out.push("## 목차", "", ...TYPES.map(([, l]) => `- [${l}](#${l.replace(/\s/g, "-")})`), "");

for (const [t, label] of TYPES) {
  const qs = bank.questions.filter((q) => q.type === t);
  if (!qs.length) continue;
  out.push("---", "", `## ${label}`, "");
  for (const q of qs) {
    out.push(`### ${q.n}. ${q.q}`, "");
    if (q.type === "mc") {
      q.choices.forEach((c, i) => out.push(`${KNUM[i]} ${c}${i + 1 === q.answer ? " ✅" : ""}  `));
      out.push("");
    }
    if (q.type !== "essay") out.push(`**정답:** ${answerOf(q)}`, "");
    out.push(`**${q.type === "essay" ? "모범답안" : "해설"}:** ${breakNums(q.exp)}`, "");
    if (q.quote) out.push(...q.quote.split("\n").map((l) => `> 원문 인용: ${l}`), "");
    out.push(`<sub>출처: ${q.sources.join(", ")} · 교재 근거: ${q.src.replace(/^교재 /, "")}</sub>`, "");
  }
}
writeFileSync("docs/문제-해설-전체.md", out.join("\n"));
console.log(`docs/문제-해설-전체.md (${bank.questions.length}문항)`);
