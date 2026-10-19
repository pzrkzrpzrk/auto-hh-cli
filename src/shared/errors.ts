// Работа с ошибками в strict-режиме: catch даёт unknown, а логи и ветки
// (LoginRequiredError) ждут имя и текст сообщения.

/** Читаемое сообщение ошибки: Error, объект с message, строка или что угодно. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    return typeof message === 'string' ? message : String(message);
  }
  return String(err);
}

/** Имя ошибки (Error.name) либо undefined — для проверок вида LoginRequiredError. */
export function errorName(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}
