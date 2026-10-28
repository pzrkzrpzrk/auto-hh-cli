// Команда resume из меню: ошибки выставляют exitCode, а не завершают процесс (R2, T-29).
// Заглушки портов подменяют composition root и сценарии: тест не читает .env и файлы.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listResumesForCli: vi.fn(),
  registerResumeByName: vi.fn(),
  loadResumeForShow: vi.fn(),
}));

vi.mock("@/composition.js", () => ({ resumeDeps: {} }));
vi.mock("@/application/resume.js", () => ({
  listResumesForCli: mocks.listResumesForCli,
  registerResumeByName: mocks.registerResumeByName,
  loadResumeForShow: mocks.loadResumeForShow,
  getResumeRegistration: vi.fn(),
}));

import cmdResume from "@/presentation/cli/commands/cmd-resume";

let exitCode: number | string | null | undefined;
let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitCode = process.exitCode;
  process.exitCode = undefined;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.exitCode = exitCode;
  errorSpy.mockRestore();
  logSpy.mockRestore();
  vi.clearAllMocks();
});

describe("cmdResume", () => {
  it("show без резюме: код возврата вместо завершения процесса", async () => {
    mocks.loadResumeForShow.mockReturnValue({ kind: "not-found" });

    await expect(cmdResume({ action: "show", name: "нет-такого" })).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Резюме не найдено"));
  });

  it("register без имени: подсказка и код возврата", async () => {
    mocks.registerResumeByName.mockResolvedValue({ kind: "missing-name" });

    await cmdResume({ action: "register" });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Укажите имя резюме"));
  });

  it("register с неизвестным именем: имя попадает в сообщение", async () => {
    mocks.registerResumeByName.mockResolvedValue({ kind: "not-found", name: "Backend" });

    await cmdResume({ action: "register", name: "Backend" });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Resume "Backend" not found');
  });

  it("пустой список — русский текст и успешный код", async () => {
    mocks.listResumesForCli.mockResolvedValue({
      kind: "empty",
      rows: [],
      registryAvailable: false,
      missingIds: [],
      orphanIds: [],
    });

    await cmdResume();

    expect(process.exitCode).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith("Резюме не найдены. Задайте RESUMES_DIR или RESUME_PATH.");
  });
});
