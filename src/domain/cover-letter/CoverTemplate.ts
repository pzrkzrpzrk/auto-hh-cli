// Шаблон сопроводительного письма (Value Object).
//
// Заменяет функцию buildFromTemplate: подстановка {title}/{employer}/{area}/{signature}
// и поведение «неизвестный плейсхолдер → пустая строка» живут в одном объекте.
import type { Vacancy } from "@/domain/models.js";
import { CoverSignature } from "@/domain/cover-letter/CoverSignature.js";

export class CoverTemplate {
  private readonly signature: CoverSignature;

  constructor(
    private readonly template?: string,
    signature?: string | CoverSignature,
  ) {
    this.signature = signature instanceof CoverSignature ? signature : new CoverSignature(signature);
  }

  /** Шаблон не задан — письмо целиком зависит от ИИ. */
  get isEmpty(): boolean {
    return !this.template;
  }

  /** Письмо по шаблону: неизвестные плейсхолдеры заменяются пустой строкой. */
  render(vacancy: Vacancy): string {
    const values: Record<string, string> = {
      title: vacancy.name || '',
      employer: vacancy.employer?.name || '',
      area: vacancy.area?.name || '',
      signature: this.signature.text,
    };
    return String(this.template ?? '').replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
  }
}
