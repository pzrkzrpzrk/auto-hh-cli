// Стратегия догрузки полных карточек: пропускать ли уже просмотренные вакансии.
// Заменяет булев флаг skipSeen: у каждого шага своя именованная политика.
export interface FullCardPolicy {
  readonly skipSeen: boolean;
}

/** search/digest: карточки просмотренных не нужны — их всё равно пропускает digest. */
export const SkipSeenPolicy: FullCardPolicy = { skipSeen: true };

/** cover: письма пишем всем, поэтому просмотренные тоже догружаем. */
export const AllVacanciesPolicy: FullCardPolicy = { skipSeen: false };
