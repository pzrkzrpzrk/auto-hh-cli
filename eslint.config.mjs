// ESLint (flat config). Проверяем корректность кода, а не форматирование:
// Prettier в проекте нет, стиль держим вручную по .editorconfig.
// Границы слоёв проверяет dependency-cruiser (`npm run arch`), а не ESLint:
// правила про импорты между слоями живут в .dependency-cruiser.js.
// bin/auto-hh — CommonJS-обёртка над tsx, dist/ и data/ — артефакты, их не линтим.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "data/**", "node_modules/**", "bin/**", "packages/**", ".playwright-mcp/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      // `any` осознанно остаётся на границах портов и в DTO парсинга hh.ru:
      // его сужение — отдельная задача, линтер не должен шуметь каждый прогон.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Печать в консоль — дело presentation (команды, меню, репортёры)
      // и консольного sink логгера; остальные слои говорят через log/порты.
      "no-console": "error",
    },
  },
  {
    files: [
      "src/presentation/**/*.ts",
      "src/shared/logger.ts",
      "src/infrastructure/logging/**/*.ts",
      "tests/**/*.ts",
    ],
    rules: { "no-console": "off" },
  },
);
