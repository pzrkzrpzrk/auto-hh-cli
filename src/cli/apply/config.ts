// Настройки шага отклика из env: единая точка чтения для cmd-apply и его шагов.
import { intFromEnv } from "../../env.js";

// Кнопка отклика по умолчанию работает в видимом окне (headful): ручные подтверждения
// и тестовые задания требуют браузера перед глазами. PW_HEADLESS=true — для отладки.
export const HEADLESS = String(process.env.PW_HEADLESS || 'false') === 'true';

// Паузы между действиями случайные — ровное поведение выглядит машинным.
export const MIN_DELAY = intFromEnv('PW_MIN_DELAY_MS', 500);
export const MAX_DELAY = intFromEnv('PW_MAX_DELAY_MS', 2000);

// PW_TEST_MODE: manual — ждать ENTER после тестового задания, skip — пропускать вакансию.
export const TEST_MODE = (process.env.PW_TEST_MODE || 'manual').toLowerCase();
// Таймаут ожидания ENTER для ручных шагов (0 — без таймаута).
export const TEST_TIMEOUT = intFromEnv('PW_TEST_TIMEOUT_MS', 0);
