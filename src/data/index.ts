import type { Bank, LoadedBank } from "../types";

// banks/ 폴더의 JSON 파일 하나가 과목 하나. 파일을 추가하면 홈에 자동으로 나타난다.
const modules = import.meta.glob<Bank>("./banks/*.json", { eager: true, import: "default" });

export const BANKS: LoadedBank[] = Object.values(modules)
  .map((b) => ({
    ...b,
    questions: b.questions.map((q) => ({ ...q, part: b.partOf[q.src.split(" ")[0]] ?? "기타" })),
  }))
  .sort((a, b) => a.title.localeCompare(b.title, "ko"));
