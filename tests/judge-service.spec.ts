// JudgeService: транспорт ИИ, разбор ответа и поведение при сбоях — на фейковом порте.
import { describe, expect, it } from "vitest";
import { JudgeService } from "@/application/judge/JudgeService";
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

const resume: Resume = {
  name: "resume",
  id: "r1",
  type: "text",
  text: "Резюме: Node.js, TypeScript",
  filename: "resume.txt",
};

const vacancies: Vacancy[] = [
  { id: 101, name: "Backend", description: "<p>Node.js</p>" },
  { id: 102, name: "Frontend", description: "<p>React</p>" },
];

const settings = { minScore: 7, adaptResume: false };

function reply(text: string | null): AiChatResult {
  return { text, usage: { prompt: 10, completion: 5 } };
}

describe("JudgeService.judgeOne", () => {
  it("возвращает вердикт, просит JSON и подписывает запрос id вакансии", async () => {
    const ai = new FakeAi(() => reply('{"verdicts":[{"vacancyId":"101","fit":true,"score":8,"comment":"стек совпал"}]}'));
    const verdict = await new JudgeService(ai).judgeOne(resume, vacancies[0], settings);

    expect(verdict?.vacancyId).toBe("101");
    expect(verdict?.score).toBe(8);
    expect(ai.calls[0].label).toBe("судья 101");
    expect(ai.calls[0].json).toBe(true);
    const prompt = JSON.stringify(ai.calls[0].messages);
    expect(prompt).toContain("=== ВАКАНСИЯ ===");
    expect(prompt).toContain("vacancyId: 101");
    expect(prompt).toContain("Порог отклика: score >= 7");
  });

  it("пустой ответ и ошибка модели дают null", async () => {
    expect(await new JudgeService(new FakeAi(() => reply(null))).judgeOne(resume, vacancies[0], settings)).toBeNull();

    const failing = new FakeAi(() => { throw new Error("boom"); });
    expect(await new JudgeService(failing).judgeOne(resume, vacancies[0], settings)).toBeNull();
  });

  it("без ключа ИИ не делает запрос", async () => {
    const ai = new FakeAi(() => reply("{}"));
    expect(await new JudgeService(null).judgeOne(resume, vacancies[0], settings)).toBeNull();
    expect(ai.calls).toHaveLength(0);
  });
});

describe("JudgeService.judgeBatch", () => {
  it("собирает Map vacancyId → вердикт и нумерует вакансии в промпте", async () => {
    const ai = new FakeAi(() => reply(JSON.stringify({
      verdicts: [
        { vacancyId: "101", fit: true, score: 9, comment: "совпало" },
        { vacancyId: "102", fit: false, score: 3, reason: "нет React" },
      ],
    })));
    const result = await new JudgeService(ai).judgeBatch(resume, vacancies, settings);

    expect(result?.size).toBe(2);
    expect(result?.get("101")?.fit).toBe(true);
    expect(result?.get("102")?.reason).toBe("нет React");
    expect(ai.calls[0].label).toBe("судья батч 2");
    const prompt = JSON.stringify(ai.calls[0].messages);
    expect(prompt).toContain("=== ВАКАНСИЯ #1 ===");
    expect(prompt).toContain("=== ВАКАНСИЯ #2 ===");
    // adaptResume=false — резюме уходит отдельным блоком, как и раньше.
    expect(prompt).toContain("=== РЕЗЮМЕ СОИСКАТЕЛЯ ===");
  });

  it("принимает голый массив и пропускает мусорные элементы", async () => {
    const ai = new FakeAi(() => reply('[null,{"vacancyId":"101","fit":true,"score":7,"comment":"ok"}]'));
    const result = await new JudgeService(ai).judgeBatch(resume, vacancies, settings);
    expect([...(result?.keys() ?? [])]).toEqual(["101"]);
  });

  it("при adaptResume=true кладёт адаптированное резюме в блок каждой вакансии", async () => {
    const ai = new FakeAi(() => reply("{}"));
    await new JudgeService(ai).judgeBatch(resume, vacancies, { ...settings, adaptResume: true });
    const prompt = JSON.stringify(ai.calls[0].messages);

    expect(prompt).toContain("=== АДАПТИРОВАННОЕ РЕЗЮМЕ (вакансия #1) ===");
    expect(prompt).toContain("=== АДАПТИРОВАННОЕ РЕЗЮМЕ (вакансия #2) ===");
    expect(prompt).not.toContain("=== РЕЗЮМЕ СОИСКАТЕЛЯ ===");
  });

  it("null при пустом ответе, ошибке и без ключа; пустой список — пустая Map", async () => {
    expect(await new JudgeService(new FakeAi(() => reply(null))).judgeBatch(resume, vacancies, settings)).toBeNull();
    expect(await new JudgeService(new FakeAi(() => { throw new Error("boom"); })).judgeBatch(resume, vacancies, settings)).toBeNull();
    expect(await new JudgeService(null).judgeBatch(resume, vacancies, settings)).toBeNull();

    const empty = await new JudgeService(new FakeAi(() => reply("{}"))).judgeBatch(resume, [], settings);
    expect(empty?.size).toBe(0);
  });
});
