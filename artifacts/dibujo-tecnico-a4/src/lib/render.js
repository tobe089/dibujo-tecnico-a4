// Representación SVG de las entidades. La usan la pantalla, el PNG y la impresión, para que todo coincida.
// Los arcos y círculos se dibujan con el comando de arco de SVG (curva exacta), no con polilíneas.

import { pointAt } from './geometry.js';

/** Número para SVG: 6 decimales de mm (1 nm) sin ceros sobrantes. */
export const n = (v) => String(Number(v.toFixed(6)));

/** Radio (mm) con el que se dibuja una entidad punto. */
export const pointRadius = (e) => Math.max(0.35, e.width * 1.1);

export function entityPathD(e) {
  switch (e.type) {
    case 'segment':
      return `M ${n(e.a.x)} ${n(e.a.y)} L ${n(e.b.x)} ${n(e.b.y)}`;
    case 'circle':
      return `M ${n(e.c.x + e.r)} ${n(e.c.y)} A ${n(e.r)} ${n(e.r)} 0 1 0 ${n(e.c.x - e.r)} ${n(e.c.y)} A ${n(e.r)} ${n(e.r)} 0 1 0 ${n(e.c.x + e.r)} ${n(e.c.y)} Z`;
    case 'arc': {
      // Antihorario en pantalla (Y hacia abajo) = sweep-flag 0 de SVG.
      const p0 = pointAt(e.c, e.start, e.r);
      const p1 = pointAt(e.c, e.start + e.sweep, e.r);
      return `M ${n(p0.x)} ${n(p0.y)} A ${n(e.r)} ${n(e.r)} 0 ${e.sweep > 180 ? 1 : 0} 0 ${n(p1.x)} ${n(p1.y)}`;
    }
    case 'polyline': {
      const pts = e.points;
      if (pts.length === 1) return `M ${n(pts[0].x)} ${n(pts[0].y)} l 0 0`;
      return pts.map((p, i) => `${i ? 'L' : 'M'} ${n(p.x)} ${n(p.y)}`).join(' ');
    }
    case 'point': {
      const r = pointRadius(e);
      return `M ${n(e.x + r)} ${n(e.y)} A ${n(r)} ${n(r)} 0 1 0 ${n(e.x - r)} ${n(e.y)} A ${n(r)} ${n(r)} 0 1 0 ${n(e.x + r)} ${n(e.y)} Z`;
    }
    default:
      return '';
  }
}

const GRID_COLOR = (i) => (i % 10 === 0 ? '#a9b8bb' : i % 5 === 0 ? '#d0dadd' : '#e8edef');
const GRID_WEIGHT = (i) => (i % 10 === 0 ? 0.2 : i % 5 === 0 ? 0.14 : 0.09);
export const gridStyle = { color: GRID_COLOR, weight: GRID_WEIGHT };

const esc = (s) => String(s).replace(/[^#0-9a-fA-F]/g, '');

/** SVG autónomo de la hoja A4 (210 × 297 mm) para exportar o imprimir. */
export function buildSheetSvg(entities, margins, { grid = true } = {}) {
  const parts = [];
  parts.push('<rect x="0" y="0" width="210" height="297" fill="#ffffff"/>');
  if (grid) {
    for (let i = 0; i <= 210; i += 1) parts.push(`<line x1="${i}" y1="0" x2="${i}" y2="297" stroke="${GRID_COLOR(i)}" stroke-width="${GRID_WEIGHT(i)}"/>`);
    for (let i = 0; i <= 297; i += 1) parts.push(`<line x1="0" y1="${i}" x2="210" y2="${i}" stroke="${GRID_COLOR(i)}" stroke-width="${GRID_WEIGHT(i)}"/>`);
    const w = Math.max(0, 210 - margins.left - margins.right), h = Math.max(0, 297 - margins.top - margins.bottom);
    parts.push(`<rect x="${margins.left}" y="${margins.top}" width="${w}" height="${h}" fill="none" stroke="#85b8a6" stroke-width="0.22" stroke-dasharray="1.3 1.1"/>`);
  }
  for (const e of entities) {
    const d = entityPathD(e);
    if (e.type === 'point') parts.push(`<path d="${d}" fill="${esc(e.color)}" stroke="none"/>`);
    else parts.push(`<path d="${d}" fill="none" stroke="${esc(e.color)}" stroke-width="${n(e.width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297"><defs><clipPath id="hoja"><rect x="0" y="0" width="210" height="297"/></clipPath></defs><g clip-path="url(#hoja)">${parts.join('')}</g></svg>`;
}
