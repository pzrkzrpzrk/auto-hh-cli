// Цели актуализации (Strategy по виду артефакта): digest и rejected обновляются
// одинаковым кодом, различаются только kind и подписью в логе.
import type { DigestKind } from "../../domain/digest/ports.js";

export interface ActualizeTarget {
  readonly kind: DigestKind;
  readonly label: string;
}

export const ACTUALIZE_TARGETS: ActualizeTarget[] = [
  { kind: 'digest', label: 'digest' },
  { kind: 'rejected', label: 'rejected' },
];
