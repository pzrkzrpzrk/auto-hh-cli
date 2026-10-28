// Правила зависимостей из docs/architecture.md, проверяемые автоматически.
// Запуск: npm run arch (входит в npm run build). Нарушение — ошибка, а не предупреждение:
// правило живёт в CI, а не только в документации.
//
// src/composition.ts — единственная точка сборки, ей можно всё: она лежит вне слоёв,
// поэтому правила ниже (они заданы по каталогам src/<слой>) её не затрагивают.
// Импорты типов тоже считаются зависимостями (tsPreCompilationDeps), чтобы тип-онли
// связь не обходила правило незаметно.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'циклы запрещены: они размывают направление зависимостей',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-no-node-builtins',
      comment: 'домен и сценарии не трогают node built-ins напрямую — только через порты',
      severity: 'error',
      from: { path: '^src/(domain|application)' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'presentation-no-domain',
      comment: 'CLI знает application и composition; DTO печати реэкспортирует application',
      severity: 'error',
      from: { path: '^src/presentation' },
      to: { path: '^src/domain' },
    },
    {
      name: 'application-no-composition',
      comment: 'composition root подключает сценарии, а не наоборот',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^src/composition' },
    },
    {
      name: 'domain-independent',
      comment: 'domain зависит только от shared — не от infrastructure/application/presentation',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: '^src/(infrastructure|application|presentation)' },
    },
    {
      name: 'shared-independent',
      comment: 'shared — утилиты без бизнес-смысла: ни одного импорта из слоёв',
      severity: 'error',
      from: { path: '^src/shared' },
      to: { path: '^src/(infrastructure|application|presentation|domain)' },
    },
    {
      name: 'application-no-infrastructure',
      comment: 'сценарии работают через порты; адаптеры подставляет composition root',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^src/(infrastructure|presentation)' },
    },
    {
      name: 'infrastructure-no-outer-layers',
      comment: 'адаптеры реализуют порты домена и не знают про сценарии и CLI',
      severity: 'error',
      from: { path: '^src/infrastructure' },
      to: { path: '^src/(application|presentation)' },
    },
    {
      name: 'presentation-no-infrastructure',
      comment: 'CLI зависит от application и composition, но не от адаптеров напрямую',
      severity: 'error',
      from: { path: '^src/presentation' },
      to: { path: '^src/infrastructure' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)node_modules($|/)' },
    // tsconfig нужен, чтобы depcruise понимал импорты с расширением .js → .ts
    // и условие nodenext.
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
