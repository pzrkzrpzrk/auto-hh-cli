// Разбор резюме из initial state hh.ru: поиск объекта в дереве, приведение к модели,
// слияние с DOM-фолбэком. Чистые функции — браузер и сеть не нужны.
import { describe, expect, it } from "vitest";
import {
  collectAreaLabels,
  collectEducationLevels,
  collectIndustryLabels,
  findResumeList,
  findResumeObject,
} from "@/infrastructure/hh/resume-lookup";
import { isEmptyResume, mergeResume, normalizeResume, unwrapResume } from "@/infrastructure/hh/resume-parser";

const HASH = 'a'.repeat(40);
const LIST_HASH = 'b'.repeat(40);

// Форма initial state близка к настоящей: поля-обёртки [{ string }] / [{ date }].
function resumeState() {
  return {
    resumeView: {
      resume: {
        hash: [{ string: HASH }],
        firstName: [{ string: 'Павел' }],
        lastName: [{ string: 'Петров' }],
        title: [{ string: 'Frontend-разработчик' }],
        area: [{ string: 'Москва' }],
        salary: { amount: 200000, currencyCode: 'RUR' },
        employmentForms: [{ string: 'FULL' }],
        workSchedule: [{ string: 'FULL_DAY' }],
        workFormats: [{ string: 'REMOTE' }],
        businessTripReadiness: [{ string: 'ready' }],
        relocation: [{ string: 'relocation_possible' }],
        birthDate: [{ date: '1991-10-18' }],
        citizenship: [{ string: '113' }],
        education: {
          level: 'higher',
          primary: [{ name: 'МГУ', result: 'Прикладная математика', year: 2013 }],
        },
        keySkills: [{ string: 'TypeScript' }, { string: 'React' }],
        experience: [{
          company: 'Ромашка',
          position: 'Frontend',
          start: '2020-03',
          end: '2024-06',
          industries: ['industry.42'],
          companyAreaId: 113,
          companyAreaTitle: 'Россия',
        }],
        resumeApplicantSkills: [{ category: 'LANG', id: 'eng', name: 'Английский', level: 'B2' }],
        email: 'p@example.com',
        phone: { formatted: '+7 999 000-00-00' },
        certificates: [{ title: 'AWS', owner: 'Amazon', issued: '2022' }],
      },
    },
    applicantProfile: { fields: {} },
    industries: { 'industry.42': 'Бытовая химия' },
    educationLevels: [{ value: 'higher', text: 'Высшее' }],
  };
}

describe("findResumeObject", () => {
  it("находит объект резюме и не путает его с блоком опыта", () => {
    const state = resumeState();
    const found = findResumeObject(state);
    expect(found.title[0].string).toBe('Frontend-разработчик');
  });

  it("возвращает null, если полного резюме в состоянии нет", () => {
    expect(findResumeObject({ foo: { bar: 1 } })).toBeNull();
  });
});

describe("normalizeResume", () => {
  const state = resumeState() as any;
  const data = normalizeResume(unwrapResume(state.resumeView.resume), HASH, {
    industryLabels: collectIndustryLabels(state),
    educationLevels: collectEducationLevels(state),
    areaLabels: collectAreaLabels(state),
  });

  it("разворачивает обёртки схемы и отдаёт личные данные", () => {
    expect(data).toMatchObject({
      hash: HASH,
      firstName: 'Павел',
      lastName: 'Петров',
      title: 'Frontend-разработчик',
      area: 'Москва',
      birthDate: '18.10.1991',
      url: `https://hh.ru/resume/${HASH}`,
    });
  });

  it("переводит коды занятости, графика, формата и командировок", () => {
    expect(data).toMatchObject({
      employment: 'Постоянная работа',
      schedule: 'Полный день',
      workFormats: ['Удалённо'],
      businessTripReadiness: 'Готов к командировкам',
      relocation: 'Готов к переезду',
      educationLevel: 'Высшее',
    });
  });

  it("расшифровывает гражданство и отрасли опыта по справочникам", () => {
    expect(data.citizenship).toEqual(['Россия']);
    expect(data.experience[0]).toMatchObject({
      company: 'Ромашка',
      position: 'Frontend',
      start: '03.2020',
      end: '06.2024',
      industries: ['Бытовая химия'],
    });
  });

  it("собирает навыки, образование, языки, контакты и сертификаты", () => {
    expect(data.keySkills).toEqual(['TypeScript', 'React']);
    expect(data.education.primary[0]).toMatchObject({
      institution: 'МГУ',
      specialty: 'Прикладная математика',
      year: '2013',
    });
    expect(data.languages).toEqual([{ name: 'Английский', level: 'B2' }]);
    expect(data.contacts).toMatchObject({ phone: '+7 999 000-00-00', email: 'p@example.com' });
    expect(data.certificates).toEqual([{ title: 'AWS', owner: 'Amazon', issued: '2022', url: null }]);
    expect(data.salary).toMatchObject({ amount: 200000, currency: 'RUR' });
  });

  it("оставляет код без справочника как есть", () => {
    const raw = normalizeResume({ hash: [HASH], educationLevel: 'bachelor' }, HASH);
    expect(raw.educationLevel).toBe('bachelor');
    expect(raw.citizenship).toEqual([]);
  });
});

describe("findResumeList", () => {
  it("достаёт список резюме личного кабинета и убирает дубли", () => {
    const state = {
      applicantResumes: [
        {
          hash: LIST_HASH,
          title: 'Frontend-разработчик',
          status: 'published',
          updatedAt: '2026-10-01T10:00:00',
          links: { desktop: `https://hh.ru/resume/${LIST_HASH}` },
        },
        { hash: LIST_HASH, title: 'Frontend-разработчик (дубль)', status: 'published' },
      ],
    };

    const list = findResumeList(state);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      hash: LIST_HASH,
      title: 'Frontend-разработчик',
      status: 'published',
      updatedAt: '2026-10-01T10:00:00',
      url: `https://hh.ru/resume/${LIST_HASH}`,
    });
  });

  it("возвращает пустой список, если резюме нет", () => {
    expect(findResumeList({ foo: 'bar' })).toEqual([]);
  });
});

describe("mergeResume и isEmptyResume", () => {
  it("дополняет данные из initial state тем, что нашлось в DOM", () => {
    const base = normalizeResume(
      { hash: [HASH], title: 'Из состояния', email: 'p@example.com' },
      HASH,
    );
    const extra = normalizeResume(
      { hash: [HASH], about: 'О себе из DOM', phone: '+7 111', telegram: '@nick' },
      HASH,
    );

    expect(mergeResume(base, extra)).toMatchObject({
      title: 'Из состояния',
      about: 'О себе из DOM',
      contacts: { phone: '+7 111', email: 'p@example.com', telegram: '@nick' },
    });
  });

  it("без DOM-фолбэка возвращает данные состояния", () => {
    const base = normalizeResume({ hash: [HASH], title: 'Резюме' }, HASH);
    expect(mergeResume(base, null)).toBe(base);
    expect(mergeResume(null, null)).toBeNull();
  });

  it("считает пустым резюме без содержательных полей", () => {
    expect(isEmptyResume(null)).toBe(true);
    expect(isEmptyResume(normalizeResume({ hash: [HASH] }, HASH))).toBe(true);
    expect(isEmptyResume(normalizeResume({ hash: [HASH], title: 'Резюме' }, HASH))).toBe(false);
  });
});
