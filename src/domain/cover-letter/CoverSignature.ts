// Подпись сопроводительного письма (Value Object).
//
// Раньше функция coverSignature(signature) жила в system-text.ts и вызывалась из трёх мест.
// Теперь подпись — объект: значение по умолчанию и подстановка в одном месте, а env
// по-прежнему читает адаптер конфигурации.
export const DEFAULT_COVER_SIGNATURE = 'Telegram: <your-telegram>, e-mail: <your-email>';

export class CoverSignature {
  constructor(private readonly value?: string) {}

  /** Подпись для промпта и шаблона: пустое значение заменяется плейсхолдером. */
  get text(): string {
    return this.value || DEFAULT_COVER_SIGNATURE;
  }

  toString(): string {
    return this.text;
  }
}
