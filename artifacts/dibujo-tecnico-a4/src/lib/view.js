// Transformación de vista: pantalla (px CSS relativos al escenario) ↔ hoja (mm). Sin DOM.
//   pantalla = t + scale · mm        (scale = px CSS por mm de hoja)
// El zoom siempre se ancla a un punto de pantalla: el punto de la hoja que estaba bajo él sigue bajo él.

import { SHEET_H, SHEET_W } from './geometry.js';

export const MIN_SCALE = 0.4; // px por mm
export const MAX_SCALE = 60;

const clampScale = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

/** Vista que encaja la hoja completa en el escenario con `pad` px de margen, centrada. */
export function fitView(stageW, stageH, pad = 24) {
  const scale = clampScale(Math.min((stageW - 2 * pad) / SHEET_W, (stageH - 2 * pad) / SHEET_H));
  return { scale, tx: (stageW - SHEET_W * scale) / 2, ty: (stageH - SHEET_H * scale) / 2 };
}

export function screenToDoc(view, sx, sy) {
  return { x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale };
}

export function docToScreen(view, x, y) {
  return { x: view.tx + x * view.scale, y: view.ty + y * view.scale };
}

/** Zoom por un factor anclado al punto de pantalla (ax, ay). */
export function zoomAt(view, ax, ay, factor) {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return { scale, tx: ax - (ax - view.tx) * k, ty: ay - (ay - view.ty) * k };
}

export function panBy(view, dx, dy) {
  return { scale: view.scale, tx: view.tx + dx, ty: view.ty + dy };
}

/**
 * Pellizco con dos dedos. `start` = { view, a, b } al empezar (posiciones de pantalla de los dos dedos).
 * Devuelve la vista para las posiciones actuales a, b: el punto de la hoja que estaba bajo el punto medio
 * inicial queda bajo el punto medio actual, y la escala sigue la razón de distancias.
 */
export function pinchView(start, a, b) {
  const d0 = Math.hypot(start.a.x - start.b.x, start.a.y - start.b.y);
  const d1 = Math.hypot(a.x - b.x, a.y - b.y);
  const m0 = { x: (start.a.x + start.b.x) / 2, y: (start.a.y + start.b.y) / 2 };
  const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const anchor = screenToDoc(start.view, m0.x, m0.y);
  const scale = clampScale(d0 > 0 ? start.view.scale * (d1 / d0) : start.view.scale);
  return { scale, tx: m1.x - anchor.x * scale, ty: m1.y - anchor.y * scale };
}

/** viewBox del SVG del escenario (en mm) para un escenario de w × h px. */
export function viewBoxFor(view, w, h) {
  return { x: -view.tx / view.scale, y: -view.ty / view.scale, w: w / view.scale, h: h / view.scale };
}
