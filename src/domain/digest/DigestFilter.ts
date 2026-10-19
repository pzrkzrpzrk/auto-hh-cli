// Domain Service локального пре-фильтра дайджеста.
// Раньше это были функции filter.ts с мешком `any`; теперь правило инкапсулировано
// в класс: правила config.filter и регионы «любые вакансии» задаются один раз
// в конструкторе (или через DigestFilter.from). I/O здесь нет — отметки истории
// и логи пропусков остаются в стадии LocalFilterStage.
import type { Vacancy } from "../models.js";
import type { VacancyListItem } from "../search/types.js";
import type {
  CandidateVerdict,
  DigestCandidate,
  DigestFilterSelection,
  SkippedCandidate,
} from "./DigestCandidate.js";
import type { DigestConfig, DigestFilterRules } from "./types.js";

// ID регионов «любые вакансии» по умолчанию (hh: 1 = Москва, 2 = Санкт-Петербург).
const DEFAULT_ANY_REGIONS: (string | number)[] = ['1', '2'];

function lower(value: unknown): string {
  return (value ?? '').toString().toLowerCase();
}

// id региона (число/строка вида "area=1") → цифровой вид "1".
function toAreaId(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Распознанный формат работы вакансии. */
interface WorkFormat {
  remote: boolean;
  hybrid: boolean;
  onSite: boolean;
}

export class DigestFilter {
  private readonly anyRegions: ReadonlySet<string>;

  constructor(
    /** Правила config.filter (архив, компании, ключевые слова, зарплата, локация). */
    private readonly rules: DigestFilterRules = {},
    /** Регионы, где допускаются любые вакансии; в остальных — только удалёнка. */
    anyRegions: (string | number)[] = DEFAULT_ANY_REGIONS,
  ) {
    const regions = Array.isArray(anyRegions) && anyRegions.length ? anyRegions : DEFAULT_ANY_REGIONS;
    this.anyRegions = new Set(regions.map(toAreaId));
  }

  /** Собрать фильтр из config.json: правила + регионы `config.search.area`. */
  static from(cfg: DigestConfig): DigestFilter {
    // area может быть строкой/числом — как и раньше, учитываем только массив.
    const area = cfg?.search?.area;
    return new DigestFilter(cfg?.filter ?? {}, Array.isArray(area) ? area : DEFAULT_ANY_REGIONS);
  }

  /** Вердикт по одной вакансии: ok=false несёт причину для лога и истории. */
  matches(vacancy: Vacancy): CandidateVerdict {
    if (!vacancy) return { ok: false, reason: 'no vacancy' };

    const rules = this.rules;

    if (rules.excludeArchived && vacancy.archived) {
      return { ok: false, reason: 'archived' };
    }

    const employerName = lower(vacancy.employer?.name);
    if (rules.excludedCompanies?.some(company => employerName.includes(lower(company)))) {
      return { ok: false, reason: 'excluded employer' };
    }

    const haystack = [
      vacancy.name,
      vacancy.description,
      ...(vacancy.key_skills || []).map(skill => skill.name),
    ].map(lower).join(' ');

    if (rules.excludedKeywords?.some(keyword => haystack.includes(lower(keyword)))) {
      return { ok: false, reason: 'excluded keyword' };
    }

    // Минимальная зарплата (если указана у вакансии в RUR).
    if (rules.minSalaryRub && vacancy.salary) {
      const { from, to, currency } = vacancy.salary;
      const value = from || to;
      if (value && currency === 'RUR' && value < rules.minSalaryRub) {
        return { ok: false, reason: `salary below ${rules.minSalaryRub}` };
      }
    }

    // Локация + формат работы:
    // - регионы из anyRegions (по умолчанию Москва/СПб) → любая вакансия (remote/on-site/гибрид)
    // - остальные регионы → только remote
    if (rules.locationRule !== false) {
      const isAnyRegion = this.anyRegions.has(toAreaId(vacancy.area?.id));
      const format = this.detectWorkFormat(vacancy);
      const known = format.remote || format.hybrid || format.onSite;
      if (known && !isAnyRegion && !format.remote) {
        return { ok: false, reason: 'region: not remote' };
      }
    }

    return { ok: true };
  }

  /**
   * Прогоняет элементы выдачи по полным карточкам (cache.fullById).
   * Возвращает кандидатов с вердиктом и пропуски (id/name/reason) для лога и отметок.
   * Карточки нет в кэше (просмотрена ранее или ошибка загрузки) — вакансия не рассматривается.
   */
  select(
    items: VacancyListItem[],
    cache: { fullById?: Record<string, any> } | null,
  ): DigestFilterSelection {
    const candidates: DigestCandidate[] = [];
    const skipped: SkippedCandidate[] = [];

    for (const item of items || []) {
      const full = cache?.fullById?.[String(item.id)] as Vacancy | undefined;
      if (!full) continue;

      const verdict = this.matches(full);
      if (!verdict.ok) {
        skipped.push({ id: String(item.id), name: full.name, reason: verdict.reason });
        continue;
      }
      candidates.push({ full, verdict });
    }

    return { candidates, skipped };
  }

  /** Формат работы: сначала поле work_format, затем fallback по тексту вакансии. */
  private detectWorkFormat(vacancy: Vacancy): WorkFormat {
    const fromField = ((vacancy.work_format as unknown[]) || []).map(value => String(value).toUpperCase());
    if (fromField.length) {
      return {
        remote: fromField.some(value => value.includes('REMOTE') || value.includes('УДАЛ')),
        hybrid: fromField.some(value => value.includes('HYBRID') || value.includes('ГИБРИД')),
        onSite: fromField.some(value => value.includes('ON_SITE') || value.includes('OFFICE')
          || value.includes('FIELD') || value.includes('МЕСТ')),
      };
    }

    const text = [vacancy.schedule?.name, vacancy.description, vacancy.name].map(lower).join(' ');
    return {
      remote: /удал[её]нн|remote|из дома/.test(text),
      hybrid: /гибрид|hybrid/.test(text),
      onSite: /на месте|в офисе|офисн/.test(text),
    };
  }
}
