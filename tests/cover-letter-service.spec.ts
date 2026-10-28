// CoverLetterService: пачки, частичный прогресс и fallback на шаблон — на фейковом порте.
import { describe, expect, it } from "vitest";
import { CoverLetterService } from "@/application/cover-letter/CoverLetterService";
import { CoverSettings, type CoverSettingsInput } from "@/domain/cover-letter/config";
import type { AiChatOptions, AiChatResult, AiProvider } from "@/domain/ports";
import type { Resume, Vacancy } from "@/domain/models";

class FakeAi implements AiProvider {
  readonly calls: AiChatOptions[] = [];

  constructor(private readonly reply: (opts: AiChatOptions) => AiChatResult | Promise<AiChatResult>) {}

  chat(opts: AiChatOptions): Promise<AiChatResult> {
    this.calls.push(opts);
    return Promise.resolve(this.reply(opts));
  }
}

const settings = (overrides: Partial<CoverSettingsInput> = {}): CoverSettings =>
  CoverSettings.from({ adaptResume: false, batchSize: 2, concurrency: 1, ...overrides });

const resume: Resume = {
  name: "resume",
  id: "r1",
  type: "text",
  text: "Резюме: Node.js, TypeScript",
  filename: "resume.txt",
};

const vacancies: Vacancy[] = Array.from({ length: 5 }, (_, index) => ({
  id: 100 + index,
  name: `Вакансия ${index + 1}`,
  description: "<p>Описание</p>",
}));
const items = vacancies.map(vacancy => ({ vacancy }));

function reply(text: string | null): AiChatResult {
  return { text, usage: { prompt: 10, completion: 5 } };
}

/** Фейк отвечает письмом на каждый vacancyId, найденный в промпте пачки. */
function lettersForPrompt(opts: AiChatOptions): AiChatResult {
  const prompt = JSON.stringify(opts.messages);
  const ids = [...prompt.matchAll(/vacancyId: (\d+)/g)].map(match => match[1]);
  return reply(JSON.stringify({ letters: ids.map(id => ({ vacancyId: id, coverLetter: `letter ${id}` })) }));
}

describe("CoverLetterService.generateOne", () => {
  it("возвращает ответ модели без пробелов и не просит JSON", async () => {
    const ai = new FakeAi(() => reply("  Здравствуйте! Письмо.  "));
    const letter = await new CoverLetterService(ai, settings()).generateOne(resume, vacancies[0]);

    expect(letter).toBe("Здравствуйте! Письмо.");
    expect(ai.calls[0].label).toBe("письмо");
    expect(ai.calls[0].json).toBeUndefined();
    expect(JSON.stringify(ai.calls[0].messages)).toContain("Вакансия: Вакансия 1");
  });

  it("пустой ответ, ошибка модели и отсутствие ключа дают шаблон", async () => {
    const cfg = settings({ coverLetterTemplate: "{title} | {signature}" });
    const expected = "Вакансия 1 | Telegram: <your-telegram>, e-mail: <your-email>";

    expect(await new CoverLetterService(new FakeAi(() => reply(null)), cfg).generateOne(resume, vacancies[0])).toBe(expected);
    expect(await new CoverLetterService(new FakeAi(() => { throw new Error("boom"); }), cfg).generateOne(resume, vacancies[0])).toBe(expected);
    expect(await new CoverLetterService(null, cfg).generateOne(resume, vacancies[0])).toBe(expected);
  });

  it("без ключа и без шаблона письма нет", async () => {
    expect(await new CoverLetterService(null, settings()).generateOne(resume, vacancies[0])).toBe("");
  });
});

describe("CoverLetterService.generateBatch", () => {
  it("режет вакансии на пачки и отдаёт накопленный прогресс после каждой", async () => {
    const ai = new FakeAi(lettersForPrompt);
    const progress: number[] = [];
    const letters = await new CoverLetterService(ai, settings()).generateBatch(resume, items, partial => {
      progress.push(partial.size);
    });

    expect(ai.calls).toHaveLength(3);
    expect(ai.calls[0].label).toBe("письма батч 2");
    expect(ai.calls[2].label).toBe("письма батч 1");
    expect([...letters.keys()]).toEqual(["100", "101", "102", "103", "104"]);
    expect(letters.get("104")).toBe("letter 104");
    expect(progress).toEqual([2, 4, 5]);
  });

  it("принимает голый массив вместо {letters: []}", async () => {
    const ai = new FakeAi(() => reply('[{"vacancyId":"100","coverLetter":"одно письмо"}]'));
    const letters = await new CoverLetterService(ai, settings()).generateBatch(resume, [items[0]]);

    expect(letters.get("100")).toBe("одно письмо");
  });

  it("битый ответ не валит прогон, без ключа и без вакансий запросов нет", async () => {
    const broken = new FakeAi(() => reply("это не json"));
    expect((await new CoverLetterService(broken, settings()).generateBatch(resume, items)).size).toBe(0);

    const idle = new FakeAi(lettersForPrompt);
    expect((await new CoverLetterService(null, settings()).generateBatch(resume, items)).size).toBe(0);
    expect((await new CoverLetterService(idle, settings()).generateBatch(resume, [])).size).toBe(0);
    expect(idle.calls).toHaveLength(0);
  });

  it("резюме уходит отдельным блоком только когда адаптация невозможна", async () => {
    const withoutAdaptation = new FakeAi(lettersForPrompt);
    await new CoverLetterService(withoutAdaptation, settings()).generateBatch(resume, [items[0]]);
    expect(JSON.stringify(withoutAdaptation.calls[0].messages)).toContain("=== РЕЗЮМЕ СОИСКАТЕЛЯ ===");

    const withAdaptation = new FakeAi(lettersForPrompt);
    await new CoverLetterService(withAdaptation, settings({ adaptResume: true })).generateBatch(resume, [items[0]]);
    expect(JSON.stringify(withAdaptation.calls[0].messages)).not.toContain("=== РЕЗЮМЕ СОИСКАТЕЛЯ ===");
  });
});
