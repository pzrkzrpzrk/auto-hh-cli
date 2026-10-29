// Имя файла скачанного резюме: ФИО и должность (транслит) + короткий hash.
// Тест фиксирует правило, от которого зависит resumeId (он выводится из имени файла).
import { describe, expect, it } from "vitest";
import { resumeFileName } from "@/domain/resume-name";
import type { HhResumeData } from "@/domain/models";

const HASH = "ABC123DEF4567890";
const SUFFIX = "-abc123de";

function resume(patch: Partial<HhResumeData> = {}): HhResumeData {
  return {
    hash: HASH,
    firstName: "Павел",
    lastName: "Петров",
    middleName: "Петрович",
    title: "Frontend-разработчик",
    salary: null,
    area: "Москва",
    employment: null,
    schedule: null,
    workFormats: [],
    businessTripReadiness: null,
    relocation: null,
    birthDate: null,
    citizenship: [],
    contacts: { phone: null, email: null, telegram: null },
    about: null,
    keySkills: [],
    experience: [],
    education: { primary: [], additional: [] },
    educationLevel: null,
    languages: [],
    certificates: [],
    rawText: null,
    updatedAt: null,
    url: "https://hh.ru/resume/abc",
    ...patch,
  };
}

describe("resumeFileName", () => {
  it("собирает ФИО, отчество и должность через дефис", () => {
    expect(resumeFileName(resume(), HASH)).toBe(`petrov-pavel-petrovich-frontend-razrabotchik${SUFFIX}`);
  });

  it("пропускает отсутствующее отчество", () => {
    expect(resumeFileName(resume({ middleName: null }), HASH))
      .toBe(`petrov-pavel-frontend-razrabotchik${SUFFIX}`);
  });

  it("без ФИО оставляет только должность", () => {
    const data = resume({ lastName: null, firstName: null, middleName: null });
    expect(resumeFileName(data, HASH)).toBe(`frontend-razrabotchik${SUFFIX}`);
  });

  it("без должности оставляет только ФИО", () => {
    expect(resumeFileName(resume({ title: null }), HASH)).toBe(`petrov-pavel-petrovich${SUFFIX}`);
  });

  it("без ФИО и должности даёт запасное имя resume", () => {
    const data = resume({ lastName: null, firstName: null, middleName: null, title: null });
    expect(resumeFileName(data, HASH)).toBe(`resume${SUFFIX}`);
  });

  it("заменяет недопустимые в путях символы дефисом", () => {
    const data = resume({ title: 'Frontend/Backend: разработчик?' });
    expect(resumeFileName(data, HASH)).toBe(`petrov-pavel-petrovich-frontend-backend-razrabotchik${SUFFIX}`);
  });

  it("схлопывает пробелы и повторные дефисы", () => {
    const data = resume({ lastName: '  Петров ', title: '  Senior   разработчик  ' });
    expect(resumeFileName(data, HASH)).toBe(`petrov-pavel-petrovich-senior-razrabotchik${SUFFIX}`);
  });

  it("транслитерирует буквы, которых нет в ASCII", () => {
    const data = resume({ lastName: "Щербаков", firstName: "Юрий", middleName: "Яковлевич" });
    expect(resumeFileName(data, HASH)).toContain("scherbakov-yuriy-yakovlevich");
  });

  it("ограничивает длину имени, оставляя hash в конце", () => {
    const data = resume({ title: "разработчик ".repeat(20) });
    const name = resumeFileName(data, HASH);
    expect(name.endsWith(SUFFIX)).toBe(true);
    expect(name).not.toContain("--");
    expect(name.length).toBeLessThanOrEqual(80 + SUFFIX.length);
  });

  it("берёт 8 символов hash в нижнем регистре и не меняется между вызовами", () => {
    const data = resume();
    expect(resumeFileName(data, "ABCDEF1234567890")).toBe(resumeFileName(data, "abcdef12"));
    expect(resumeFileName(data, "ABCD")).toBe(`petrov-pavel-petrovich-frontend-razrabotchik-abcd`);
  });
});
