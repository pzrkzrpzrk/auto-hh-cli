// Маппинг initial state hh.ru в модели вакансий: краткая выдача и полная карточка.
// Чистые функции — сеть, браузер и файлы не нужны.
import { describe, expect, it } from "vitest";
import {
  buildFieldsDictionary,
  isArchived,
  mapCompensation,
  translateCode,
} from "@/infrastructure/hh/vacancy-fields";
import { mapSearchItem, mapVacancyView } from "@/infrastructure/hh/vacancy-mapping";

describe("mapSearchItem", () => {
  it("приводит элемент выдачи к формату прежнего API", () => {
    const item = mapSearchItem({
      vacancyId: 123,
      name: "Разработчик",
      company: { visibleName: 'ООО «Ромашка»', id: 7 },
      area: { '@id': 1, name: 'Москва' },
      compensation: { from: 100000, to: 150000, currencyCode: 'RUR', gross: true },
      links: { desktop: 'https://hh.ru/vacancy/123' },
    });

    expect(item).toMatchObject({
      id: '123',
      name: 'Разработчик',
      employer: { name: 'ООО «Ромашка»', id: 7 },
      area: { id: 1, name: 'Москва' },
      salary: { from: 100000, to: 150000, currency: 'RUR', gross: true },
      alternate_url: 'https://hh.ru/vacancy/123',
      archived: false,
    });
  });

  it("без ссылки собирает url из vacancyId", () => {
    expect(mapSearchItem({ vacancyId: 5, name: 'X' }).alternate_url).toBe('https://hh.ru/vacancy/5');
  });
});

describe("mapCompensation", () => {
  it("не отдаёт пустую и скрытую компенсацию", () => {
    expect(mapCompensation(null)).toBeNull();
    expect(mapCompensation({ noCompensation: true, from: 1 })).toBeNull();
    expect(mapCompensation({ from: null, to: null })).toBeNull();
  });
});

describe("buildFieldsDictionary + translateCode", () => {
  it("собирает справочник кодов и расшифровывает HTML-сущности", () => {
    const dict = buildFieldsDictionary({
      employmentForm: [{ id: 'FULL', text: 'Полная занятость' }],
      workExperience: [{ id: 'moreThan6', text: 'Более 6&nbsp;лет' }],
    });

    expect(translateCode(dict, 'employmentForm', 'FULL')).toBe('Полная занятость');
    expect(translateCode(dict, 'workExperience', 'moreThan6')).toBe('Более 6 лет');
    expect(translateCode(dict, 'employmentForm', 'UNKNOWN')).toBeNull();
    expect(buildFieldsDictionary(null)).toEqual({});
  });
});

describe("isArchived", () => {
  it("понимает новую форму status и старую status.active", () => {
    expect(isArchived({ status: { archived: false } })).toBe(false);
    expect(isArchived({ status: { archived: true } })).toBe(true);
    expect(isArchived({ status: { active: false } })).toBe(true);
  });

  it("неизвестный статус считает живой вакансией", () => {
    expect(isArchived({})).toBe(false);
    expect(isArchived({ status: {} })).toBe(false);
  });
});

describe("mapVacancyView", () => {
  const fields = buildFieldsDictionary({
    employmentForm: [{ id: 'FULL', text: 'Полная занятость' }],
    workScheduleByDays: [{ id: 'FIVE_ON_TWO_OFF', text: '5/2' }],
  });

  it("разбирает актуальную карточку vacancyFull.vacancy", () => {
    const vacancy = mapVacancyView(
      {
        vacancyId: 42,
        name: 'Frontend &amp; React',
        description: '&lt;p&gt;Текст&lt;/p&gt;',
        company: { visibleName: 'Ромашка', id: 7 },
        area: { '@id': 1, name: 'Москва' },
        compensation: { from: 100000, to: null, currencyCode: 'RUR' },
        keySkills: { keySkill: ['TypeScript', 'React'] },
        workExperience: 'moreThan6',
        employmentForm: 'FULL',
        workScheduleByDays: ['FIVE_ON_TWO_OFF'],
        workFormats: ['REMOTE', 'HYBRID'],
        status: { archived: false },
        publicationDate: '2026-10-20',
      },
      { idHint: 42, links: { desktop: 'https://hh.ru/vacancy/42' }, translations: { workExperience: 'Более 6 лет' }, fields },
    );

    expect(vacancy).toMatchObject({
      id: '42',
      name: 'Frontend & React',
      description: '<p>Текст</p>',
      employer: { name: 'Ромашка', id: 7 },
      area: { id: 1, name: 'Москва' },
      salary: { from: 100000, to: null, currency: 'RUR' },
      key_skills: [{ name: 'TypeScript' }, { name: 'React' }],
      experience: { name: 'Более 6 лет' },
      schedule: { name: '5/2' },
      employment: { name: 'Полная занятость' },
      work_format: ['REMOTE', 'HYBRID'],
      archived: false,
      alternate_url: 'https://hh.ru/vacancy/42',
      publishedAt: '2026-10-20',
    });
  });

  it("поддерживает старую форму карточки (vacancyId отсутствует)", () => {
    const vacancy = mapVacancyView(
      { title: 'Старая карточка', archived: true },
      { idHint: 'legacy-1' },
    );

    expect(vacancy).toMatchObject({
      id: 'legacy-1',
      name: 'Старая карточка',
      archived: true,
      alternate_url: 'https://hh.ru/vacancy/legacy-1',
    });
  });

  it("не падает на пустом узле", () => {
    expect(mapVacancyView(null)).toBeNull();
  });
});
