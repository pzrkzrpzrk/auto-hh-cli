// Вердикт судьи: инвариант fit/comment/reason, clamp оценки и терпимость к форме ответа.
import { describe, expect, it } from "vitest";
import { Verdict } from "@/domain/judge/Verdict";

describe("Verdict.fromModel", () => {
  it("fit=true: comment обязателен, reason=null, строки тримятся", () => {
    const verdict = Verdict.fromModel({
      vacancyId: 42,
      fit: true,
      score: 8,
      reason: "не должно остаться",
      comment: "  стек совпал  ",
    });
    expect(verdict.vacancyId).toBe("42");
    expect(verdict.fit).toBe(true);
    expect(verdict.score).toBe(8);
    expect(verdict.reason).toBeNull();
    expect(verdict.comment).toBe("стек совпал");
  });

  it("fit=true без comment берёт reason, затем шаблонную фразу", () => {
    expect(Verdict.fromModel({ fit: true, score: 7, reason: "опыт релевантен" }).comment).toBe("опыт релевантен");
    expect(Verdict.fromModel({ fit: true, score: 7 }).comment).toBe("Соответствие профилю (score 7/10)");
  });

  it("fit=false: reason обязателен, comment=null", () => {
    const verdict = Verdict.fromModel({ fit: false, score: 3, comment: "нет Kubernetes" });
    expect(verdict.reason).toBe("нет Kubernetes");
    expect(verdict.comment).toBeNull();
    expect(Verdict.fromModel({ fit: false, score: 2 }).reason).toBe("Совпадение слабое (score 2/10)");
  });

  it("оценка зажимается в 1..10, нечисловая — 1", () => {
    expect(Verdict.fromModel({ fit: true, score: 11, comment: "x" }).score).toBe(10);
    expect(Verdict.fromModel({ fit: true, score: 0, comment: "x" }).score).toBe(1);
    expect(Verdict.fromModel({ fit: true, score: "abc", comment: "x" }).score).toBe(1);
  });

  it("toJudgement отдаёт только поля кэша, без vacancyId", () => {
    const judgement = Verdict.fromModel({ vacancyId: 1, fit: true, score: 9, comment: "ok" }).toJudgement();
    expect(judgement).toEqual({ score: 9, fit: true, reason: null, comment: "ok" });
  });
});

describe("Verdict.listFromModel", () => {
  it("принимает объект с verdicts и голый массив", () => {
    const wrapped = Verdict.listFromModel({ verdicts: [{ vacancyId: 1 }, { vacancyId: 2 }] });
    expect(wrapped.map(verdict => verdict.vacancyId)).toEqual(["1", "2"]);
    expect(Verdict.listFromModel([{ vacancyId: 3 }]).map(verdict => verdict.vacancyId)).toEqual(["3"]);
  });

  it("мусор и не-объекты пропускаются", () => {
    expect(Verdict.listFromModel(null)).toEqual([]);
    expect(Verdict.listFromModel({ verdicts: "нет" })).toEqual([]);
    expect(Verdict.listFromModel([null, 5, { vacancyId: 7 }]).map(verdict => verdict.vacancyId)).toEqual(["7"]);
  });
});
