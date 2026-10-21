import type { Entity, Margins } from './document.js';
export const n: (v: number) => string;
export const pointRadius: (e: { width: number }) => number;
export function entityPathD(e: Entity): string;
export const gridStyle: { color: (i: number) => string; weight: (i: number) => number };
export function buildSheetSvg(entities: Entity[], margins: Margins, options?: { grid?: boolean; sheet?: { w: number; h: number } }): string;
