// Колбэк Playwright уходит в браузер текстом функции, поэтому всё, что объявлено
// внутри evaluate, исполняется уже в странице. tsx (esbuild с keepNames) оборачивает
// вложенные функции в хелпер __name(...), которого в браузере нет — evaluate падал с
// ReferenceError: __name is not defined, и разбор страницы молча уходил в фолбэк.
// Обёртка объявляет __name в области видимости колбэка; для tsc-сборки (dist), где
// хелпера нет, она безвредна.
//
// Нужна любому колбэку, внутри которого объявлены функции (стрелки в const, function):
// колбэки без них esbuild не трогает и они работают как есть.
//
// Использование: await page.evaluate(pageScript(() => { ... }));
export function pageScript<R>(fn: () => R | Promise<R>): string {
  return `(function (__name) { return (${fn.toString()})(); })(function (target) { return target; })`;
}
