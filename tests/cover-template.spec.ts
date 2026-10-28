// Подпись, шаблон и настройки письма: дефолты, подстановка и клампы — без ИИ и файлов.
import { describe, expect, it } from "vitest";
import { CoverLetterPrompt } from "@/domain/cover-letter/CoverLetterPrompt";
import { CoverSignature, DEFAULT_COVER_SIGNATURE } from "@/domain/cover-letter/CoverSignature";
import { CoverTemplate } from "@/domain/cover-letter/CoverTemplate";
import { CoverSettings } from "@/domain/cover-letter/config";
import { DEFAULT_ADAPT_BUDGET } from "@/domain/adapt-resume/index";
import type { Vacancy } from "@/domain/models";

const vacancy: Vacancy = {
  id: 555,
  name: "Backend-разработчик",
  description: "<p>Node.js и <b>TypeScript</b></p>",
  employer: { name: "Acme" },
  area: { name: "Москва", id: 1 },
};

describe("CoverSignature", () => {
  it("пустое значение заменяется плейсхолдером, заданное — сохраняется", () => {
    expect(new CoverSignature().text).toBe(DEFAULT_COVER_SIGNATURE);
    expect(new CoverSignature("").text).toBe(DEFAULT_COVER_SIGNATURE);
    expect(new CoverSignature("Telegram: @me").text).toBe("Telegram: @me");
    expect(String(new CoverSignature("mail: me@example.com"))).toBe("mail: me@example.com");
  });
});

describe("CoverTemplate", () => {
  it("подставляет title/employer/area/signature", () => {
    const template = new CoverTemplate("{title} @ {employer}, {area}. {signature}", "Telegram: @me");
    expect(template.render(vacancy)).toBe("Backend-разработчик @ Acme, Москва. Telegram: @me");
  });

  it("неизвестный плейсхолдер становится пустой строкой, пустой шаблон — пустым письмом", () => {
    expect(new CoverTemplate("{title}{unknown}").render(vacancy)).toBe("Backend-разработчик");
    const empty = new CoverTemplate();
    expect(empty.isEmpty).toBe(true);
    expect(empty.render(vacancy)).toBe("");
  });
});

describe("CoverSettings.from", () => {
  it("берёт дефолты, когда входа нет", () => {
    const settings = CoverSettings.from();
    expect(settings.coverLetterTemplate).toBeUndefined();
    expect(settings.hasTemplate).toBe(false);
    expect(settings.adaptResume).toBe(true);
    expect(settings.adaptResumeBudget).toBe(DEFAULT_ADAPT_BUDGET);
    expect(settings.batchSize).toBe(20);
    expect(settings.concurrency).toBe(10);
    expect(settings.profile).toBe("опытный разработчик");
    expect(settings.signature.text).toBe(DEFAULT_COVER_SIGNATURE);
  });

  it("сохраняет заданные значения и отключает адаптацию флагом", () => {
    const settings = CoverSettings.from({
      coverLetterTemplate: "{title}",
      adaptResume: false,
      adaptResumeBudget: 1200,
      batchSize: 5,
      profile: "senior backend",
      signature: "Telegram: @me",
      concurrency: 2,
    });
    expect(settings.hasTemplate).toBe(true);
    expect(settings.adaptResume).toBe(false);
    expect(settings.adaptResumeBudget).toBe(1200);
    expect(settings.batchSize).toBe(5);
    expect(settings.profile).toBe("senior backend");
    expect(settings.signature.text).toBe("Telegram: @me");
    expect(settings.concurrency).toBe(2);
  });

  it("не пропускает бюджет ниже 500 и нечисловые размеры пачек", () => {
    const settings = CoverSettings.from({ adaptResumeBudget: 100, batchSize: 0, concurrency: -5 });
    expect(settings.adaptResumeBudget).toBe(500);
    expect(settings.batchSize).toBe(20);
    expect(settings.concurrency).toBe(10);
  });
});

describe("CoverLetterPrompt", () => {
  it("одиночный промпт содержит карточку, описание без HTML и подпись", () => {
    const prompt = new CoverLetterPrompt("backend", "Telegram: @me");
    const user = prompt.singleUser(vacancy);
    expect(user).toContain("Вакансия: Backend-разработчик");
    expect(user).toContain("Компания: Acme");
    expect(user).toContain("Описание:\nNode.js и TypeScript");
    expect(user).toContain('Заверши строкой "Telegram: @me"');
    expect(prompt.system()).toContain("Профиль соискателя: backend");
  });

  it("блок резюме добавляется перед карточкой, если он передан", () => {
    const user = new CoverLetterPrompt("backend").singleUser(vacancy, "=== РЕЗЮМЕ ===\nтекст");
    expect(user.startsWith("=== РЕЗЮМЕ ===\nтекст\n\nВакансия:")).toBe(true);
  });

  it("батчевый промпт нумерует вакансии и добавляет заметку об адаптации", () => {
    const prompt = new CoverLetterPrompt("backend", "Telegram: @me");
    const block = prompt.vacancySection(vacancy, 2);
    expect(block.startsWith("=== ВАКАНСИЯ #2 ===\nvacancyId: 555")).toBe(true);
    expect(prompt.batchSystem(false)).not.toContain("передано адаптированное");
    expect(prompt.batchSystem(true)).toContain("передано адаптированное");
  });
});
