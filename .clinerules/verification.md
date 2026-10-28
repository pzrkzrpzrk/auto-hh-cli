## Verification & Terminal Output Rules
- **NEVER** run full `npm run build` or whole-suite test runners (`npm test`) just to verify a small code change. Full builds pollute the context window with massive log traces.
- **Fast Typecheck**: Use `npx tsc --noEmit` (or `npx vue-tsc --noEmit` for Vue files) to check for type errors.
- **Targeted Tests**: Run only the specific test file related to your changes:
  `npx jest path/to/changed.spec.ts` (or `npx vitest run path/to/changed.spec.ts`).
- **Targeted Linting**: Check only the modified files:
  `npx eslint path/to/changed.ts --max-warnings=0`.
- **Log Hygiene**: If a terminal command produces output longer than 30 lines, pipe it through `| head -n 30` or `| tail -n 30` unless you explicitly need the full trace to diagnose an error.
