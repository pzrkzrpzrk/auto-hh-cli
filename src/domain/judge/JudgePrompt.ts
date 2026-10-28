// Контракт промпта судьи (Domain Service).
//
// Раньше тексты жили в system-text.ts и в formatVacancyText внутри judge.ts, рядом с
// вызовами ИИ. Теперь это чистый домен: только строки промпта, ни портов, ни логов.
import { stripHtml } from "@/shared/text-utils.js";
import type { Vacancy } from "@/domain/models.js";

/** Добавка к системному тексту для батчевого запроса (несколько вакансий за раз). */
const BATCH_NOTE =
  '\n\nВ этом запросе подаётся СРАЗУ НЕСКОЛЬКО вакансий. Верни ОБЪЕКТ вида {"verdicts": [ ... ]} (не голый массив): по одной записи на вакансию, в том же порядке, что во входе.';

/** Добавка, когда каждая вакансия идёт со своим адаптированным резюме. */
const ADAPTED_NOTE =
  '\n\nДля каждой вакансии передано адаптированное под неё резюме — учитывай только его при оценке.';

export class JudgePrompt {
  /** minScore — порог отклика, который печатается в системном тексте. */
  constructor(private readonly minScore: number) {}

  /** Системный текст одиночного запроса. */
  system(): string {
    return `Ты — система мэтчинга резюме и вакансий. Формально оцени соответствие по критериям ниже. Никаких рассуждений — только факты из резюме и вакансии.

Порог отклика: score >= ${this.minScore}

Алгоритм:

1. Проверь блокеры (п. 5). Если есть хотя бы один → score = 1–3, fit = false. Дальнейшая оценка не нужна.

2. Если блокеров нет — оцени score 1–10:
1–3 — стек не совпадает или уровень на 2+ ступени ниже
4–6 — частичное совпадение, есть заметные пробелы в ключевом
7–8 — ключевой стек совпадает, уровень релевантен, условия приемлемы
9–10 — почти полное совпадение, уровень точный, зарплата и локация идеальны

4. vacancyId = String(vacancy.id) из входных данных. id — всегда первое поле в блоке вакансии.

5. Блокеры (каждый в отдельности делает fit = false):
— обязательная технология отсутствует в резюме и не осваивается за 1–2 недели
— жёсткое требование по локации (офис в городе X), а кандидат в другом городе без опции переезда
— зарплатная вилка вакансии целиком ниже ожиданий кандидата
— уровень кандидата на 2+ ступени ниже требуемого (junior vs senior)
— обязательное формальное требование (образование, гражданство, допуск) отсутствует
— Если не уверен — блокера нет.

6. reason: при fit = false — одно предложение, конкретно чего не хватает (пример: "Отсутствует обязательный опыт с Kubernetes."). При fit = true — null.
7. comment: при fit = true — ОБЯЗАТЕЛЬНО заполни 5–10 словами, что совпало (пример: "Стек совпадает, уровень middle релевантен, зарплата комфортна."). Никогда не оставляй пустым, null или "—" при fit = true. При fit = false — null.
8. coverLetter: всегда пустая строка "".

Формат ответа — строго JSON, одноуровневый. Пример:
{"vacancyId":"123","fit":true,"score":8,"reason":null,"comment":"Стек совпадает, уровень middle","coverLetter":""}

Жёсткие правила полей:
— fit = true: reason = null, comment обязателен (не пустая строка, не null).
— fit = false: reason обязателен, comment = null.`;
  }

  /** Системный текст батчевого запроса: тот же контракт плюс формат пачки. */
  batchSystem(adapted: boolean): string {
    return this.system() + BATCH_NOTE + (adapted ? ADAPTED_NOTE : '');
  }

  /** Блок вакансии: без order — одиночный запрос, с order — пачка (нумерация с 1). */
  vacancySection(vacancy: Vacancy, order?: number): string {
    const header = order == null ? '=== ВАКАНСИЯ ===' : `=== ВАКАНСИЯ #${order} ===`;
    return `${header}\n${this.vacancyText(vacancy)}`;
  }

  /** Поля карточки, которые видит судья. Описание очищается от HTML. */
  private vacancyText(vacancy: Vacancy): string {
    const description = stripHtml(vacancy.description);
    const skills = (vacancy.key_skills || []).map(s => s.name).join(', ');
    const salary = vacancy.salary
      ? `${vacancy.salary.from || '?'}–${vacancy.salary.to || '?'} ${vacancy.salary.currency || ''}`
      : 'не указана';
    return `vacancyId: ${vacancy.id}
Название: ${vacancy.name}
Компания: ${vacancy.employer?.name || '—'}
Регион: ${vacancy.area?.name || '—'}
Опыт: ${vacancy.experience?.name || '—'}
График: ${vacancy.schedule?.name || '—'}
Занятость: ${vacancy.employment?.name || '—'}
Зарплата: ${salary}
Ключевые навыки: ${skills || '—'}

Описание:
${description}`;
  }
}
