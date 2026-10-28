// Vitest: тесты лежат в tests/, алиас @/ повторяет tsconfig, БД адаптеров — в памяти.
// Расширения .js в импортах исходников (nodenext) срезаются: Vite ищет .ts.
import path from "path";
import { defineConfig } from "vitest/config";

const src = path.resolve(process.cwd(), "src");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)\.js$/, replacement: `${src}/$1` },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
  },
});
