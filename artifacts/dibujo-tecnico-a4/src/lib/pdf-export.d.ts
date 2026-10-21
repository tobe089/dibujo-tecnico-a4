import type { Entity, Margins } from './document.js';
export type PdfMargins = Margins;
export function entityOperators(entity: Entity, pageHeight: number): unknown[];
export function createA4Pdf(entities: Entity[], margins: Margins, options?: { grid?: boolean }): Promise<Uint8Array>;
