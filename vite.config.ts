import { defineConfig } from "vite";

// 상대 경로로 빌드해서 GitHub Pages의 /gichul-note/ 하위 경로에서도 그대로 동작
export default defineConfig({
  base: "./",
});
