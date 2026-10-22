// Modelo de documento v2: entidades geométricas editables. Sin dependencias de DOM.
//
// Todas las coordenadas son milímetros de hoja (origen arriba-izquierda, Y hacia abajo) y se guardan
// tal como se crearon: el modelo NUNCA redondea, ajusta ni relaciona entidades entre sí.
// Cada entidad es independiente: una línea no comparte extremos con otra salvo que el usuario
// introduzca explícitamente las mismas coordenadas.
//
// Tipos de entidad (además de id, color '#rrggbb' y width en mm):
//   point     { x, y }
//   segment   { a: {x,y}, b: {x,y} }
//   circle    { c: {x,y}, r }
//   arc       { c: {x,y}, r, start, sweep }   ángulos en grados, antihorario, 0 < sweep < 360
//   polyline  { points: [{x,y,p?}] }          trazo libre (p = presión 0..1 si se conoce)

import {
  A4_PORTRAIT, angleInArc, nearestOnSegment, normalizeDeg, pointAt, segmentAngle, segmentLength,
} from './geometry.js';

export const DOC_VERSION = 2;
export const STORAGE_KEY_V1 = 'dibujo-tecnico-a4-v1';
export const STORAGE_KEY_V2 = 'dibujo-tecnico-a4-v2';
export const DEFAULT_COLOR = '#244d58';
export const DEFAULT_WIDTH = 0.45;
export const DEFAULT_MARGINS = { top: 10, right: 10, bottom: 10, left: 10 };
export const ENTITY_TYPES = ['point', 'segment', 'circle', 'arc', 'polyline'];

export function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const isNum = Number.isFinite;
const isPt = (p) => !!p && isNum(p.x) && isNum(p.y);
const copyPt = (p) => ({ x: p.x, y: p.y });
const validColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_COLOR);
const validWidth = (w) => (isNum(w) && w > 0 && w <= 20 ? w : DEFAULT_WIDTH);
const validId = (id) => (typeof id === 'string' && id ? id : makeId());

/** Devuelve una copia limpia y válida de la entidad, o null si no es utilizable. No altera coordenadas. */
export function sanitizeEntity(e) {
  if (!e || typeof e !== 'object') return null;
  const base = { id: validId(e.id), type: e.type, color: validColor(e.color), width: validWidth(e.width) };
  switch (e.type) {
    case 'point':
      return isNum(e.x) && isNum(e.y) ? { ...base, x: e.x, y: e.y } : null;
    case 'segment':
      return isPt(e.a) && isPt(e.b) ? { ...base, a: copyPt(e.a), b: copyPt(e.b) } : null;
    case 'circle':
      return isPt(e.c) && isNum(e.r) && e.r > 0 ? { ...base, c: copyPt(e.c), r: e.r } : null;
    case 'arc': {
      if (!isPt(e.c) || !isNum(e.r) || !(e.r > 0) || !isNum(e.start) || !isNum(e.sweep) || !(e.sweep > 0)) return null;
      if (e.sweep >= 360) return { ...base, type: 'circle', c: copyPt(e.c), r: e.r };
      return { ...base, c: copyPt(e.c), r: e.r, start: normalizeDeg(e.start), sweep: e.sweep };
    }
    case 'polyline': {
      if (!Array.isArray(e.points)) return null;
      const points = e.points.filter(isPt).map((p) => (isNum(p.p) ? { x: p.x, y: p.y, p: p.p } : copyPt(p)));
      return points.length ? { ...base, points } : null;
    }
    default:
      return null;
  }
}

function sanitizeMargins(m) {
  const out = { ...DEFAULT_MARGINS };
  if (m && typeof m === 'object') {
    for (const k of Object.keys(out)) if (isNum(m[k])) out[k] = Math.max(0, Math.min(40, m[k]));
  }
  return out;
}

export function createDocument() {
  return { version: DOC_VERSION, entities: [], margins: { ...DEFAULT_MARGINS }, color: DEFAULT_COLOR, width: DEFAULT_WIDTH };
}

// ───────────────────────── Migración del formato v1 ─────────────────────────

/**
 * Convierte un trazo v1 ({ id, points, color, width, kind, meta }) en una entidad v2.
 * Las líneas conservan sus dos extremos exactos; círculos y arcos se reconstruyen desde `meta`
 * (centro, radio y ángulos exactos); si falta `meta`, se conservan como polilínea para no perder nada.
 */
export function migrateStrokeV1(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.points)) return null;
  const pts = s.points.filter(isPt);
  const style = { id: validId(s.id), color: validColor(s.color), width: validWidth(s.width) };
  const m = s.meta || {};
  if (s.kind === 'line' && pts.length >= 2) {
    return sanitizeEntity({ ...style, type: 'segment', a: pts[0], b: pts[pts.length - 1] });
  }
  if ((s.kind === 'circle' || s.kind === 'arc') && isPt(m.center) && isNum(m.radius) && m.radius > 0) {
    const sweep = s.kind === 'circle' ? 360 : m.sweepDeg;
    if (s.kind === 'circle' || sweep >= 360) return sanitizeEntity({ ...style, type: 'circle', c: m.center, r: m.radius });
    if (isNum(m.startDeg) && isNum(sweep) && sweep > 0) {
      return sanitizeEntity({ ...style, type: 'arc', c: m.center, r: m.radius, start: m.startDeg, sweep });
    }
  }
  if (pts.length === 1) return sanitizeEntity({ ...style, type: 'point', x: pts[0].x, y: pts[0].y });
  if (pts.length >= 2) return sanitizeEntity({ ...style, type: 'polyline', points: s.points });
  return null;
}

export function migrateV1(v1) {
  const strokes = Array.isArray(v1?.strokes) ? v1.strokes : [];
  const entities = [];
  let dropped = 0;
  for (const s of strokes) {
    const e = migrateStrokeV1(s);
    if (e) entities.push(e); else dropped += 1;
  }
  return {
    doc: {
      version: DOC_VERSION, entities, margins: sanitizeMargins(v1?.margins),
      color: validColor(v1?.color), width: validWidth(v1?.width),
    },
    dropped,
  };
}

/** Interpreta un documento guardado (v2 o v1). Devuelve { doc, migrated, dropped }. Lanza si no es un documento. */
export function parseDocument(data) {
  const obj = typeof data === 'string' ? JSON.parse(data) : data;
  if (!obj || typeof obj !== 'object') throw new Error('Documento vacío o no válido.');
  if (obj.version === DOC_VERSION && Array.isArray(obj.entities)) {
    const entities = [];
    let dropped = 0;
    for (const e of obj.entities) { const c = sanitizeEntity(e); if (c) entities.push(c); else dropped += 1; }
    return {
      doc: { version: DOC_VERSION, entities, margins: sanitizeMargins(obj.margins), color: validColor(obj.color), width: validWidth(obj.width) },
      migrated: false, dropped,
    };
  }
  if (Array.isArray(obj.strokes)) {
    const { doc, dropped } = migrateV1(obj);
    return { doc, migrated: true, dropped };
  }
  throw new Error('Formato de documento desconocido.');
}

/**
 * Carga desde un almacén tipo localStorage: primero v2; si no existe, migra v1.
 * El dato v1 original NO se borra (queda como copia de seguridad).
 */
export function loadFromStorage(storage) {
  const v2 = storage.getItem(STORAGE_KEY_V2);
  if (v2) {
    try { return { ...parseDocument(v2), source: 'v2' }; } catch { /* se intenta v1 */ }
  }
  const v1 = storage.getItem(STORAGE_KEY_V1);
  if (v1) {
    try { return { ...parseDocument(v1), source: 'v1' }; } catch { /* datos dañados */ }
  }
  return { doc: createDocument(), migrated: false, dropped: 0, source: 'nuevo' };
}

export function serializeDocument(doc) {
  return JSON.stringify({ version: DOC_VERSION, entities: doc.entities, margins: doc.margins, color: doc.color, width: doc.width });
}

// ───────────────────────── Consultas geométricas ─────────────────────────

export function arcEndpoints(e) {
  return { p0: pointAt(e.c, e.start, e.r), p1: pointAt(e.c, e.start + e.sweep, e.r) };
}

/** Caja envolvente exacta { minX, minY, maxX, maxY } de la geometría (sin grosor de trazo). */
export function entityBounds(e) {
  switch (e.type) {
    case 'point': return { minX: e.x, minY: e.y, maxX: e.x, maxY: e.y };
    case 'segment': return {
      minX: Math.min(e.a.x, e.b.x), minY: Math.min(e.a.y, e.b.y), maxX: Math.max(e.a.x, e.b.x), maxY: Math.max(e.a.y, e.b.y),
    };
    case 'circle': return { minX: e.c.x - e.r, minY: e.c.y - e.r, maxX: e.c.x + e.r, maxY: e.c.y + e.r };
    case 'arc': {
      const { p0, p1 } = arcEndpoints(e);
      const pts = [p0, p1];
      for (const q of [0, 90, 180, 270]) if (angleInArc(q, e.start, e.sweep)) pts.push(pointAt(e.c, q, e.r));
      return boundsOf(pts);
    }
    case 'polyline': return boundsOf(e.points);
    default: return { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
  }
}

function boundsOf(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}

/** ¿Cabe la geometría dentro de la hoja A4? (eps = holgura numérica en mm, no una tolerancia de dibujo) */
export function entityInsideSheet(e, eps = 1e-9, sheet = A4_PORTRAIT) {
  const b = entityBounds(e);
  return [b.minX, b.minY, b.maxX, b.maxY].every(isNum) &&
    b.minX >= -eps && b.minY >= -eps && b.maxX <= sheet.w + eps && b.maxY <= sheet.h + eps;
}

export function pointInsideSheet(p, sheet = A4_PORTRAIT) {
  return isPt(p) && p.x >= 0 && p.x <= sheet.w && p.y >= 0 && p.y <= sheet.h;
}

/** Longitud mínima (mm) que debe caer dentro de la hoja para contar como visible: restos numéricos, no tolerancia. */
export const SHEET_MIN_MM = 1e-6;
const SHEET_EPS = 1e-9;
const insideClosed = (p, sheet) => p.x >= -SHEET_EPS && p.x <= sheet.w + SHEET_EPS && p.y >= -SHEET_EPS && p.y <= sheet.h + SHEET_EPS;

/** Parámetros [t0, t1] del tramo del segmento a→b dentro de la hoja (Liang–Barsky), o null. */
function segmentSheetInterval(a, b, sheet) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x], [dx, sheet.w - a.x], [-dy, a.y], [dy, sheet.h - a.y]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}

/** Ángulos (grados) en los que la circunferencia corta los cuatro bordes de la hoja. */
function circleSheetCrossings(c, r, sheet) {
  const out = [];
  const deg = (rad) => normalizeDeg(rad * 180 / Math.PI);
  for (const X of [0, sheet.w]) {
    const k = (X - c.x) / r; // x = c.x + r·cos θ
    if (k >= -1 && k <= 1) { const a = Math.acos(k); out.push(deg(a), deg(-a)); }
  }
  for (const Y of [0, sheet.h]) {
    const k = (c.y - Y) / r; // y = c.y − r·sen θ (Y hacia abajo, 90° = arriba)
    if (k >= -1 && k <= 1) { const a = Math.asin(k); out.push(deg(a), deg(Math.PI - a)); }
  }
  return out;
}

/**
 * ¿Hay una parte real de la geometría dentro de la hoja? Se comprueba la geometría exacta (no su caja):
 * un segmento debe tener un tramo de más de SHEET_MIN_MM dentro; una circunferencia o un arco, un trozo de
 * curva de esa longitud. Un contacto tangente o en un solo punto no cuenta. No modifica la entidad.
 */
export function entityIntersectsSheet(e, sheet = A4_PORTRAIT) {
  switch (e.type) {
    case 'point': return isPt(e) && insideClosed(e, sheet);
    case 'segment': {
      const len = segmentLength(e.a, e.b);
      const iv = segmentSheetInterval(e.a, e.b, sheet);
      return !!iv && (iv[1] - iv[0]) * len > SHEET_MIN_MM;
    }
    case 'circle':
    case 'arc': {
      const start = e.type === 'arc' ? e.start : 0;
      const sweep = e.type === 'arc' ? e.sweep : 360;
      // Entre dos cortes consecutivos el arco está entero dentro o entero fuera: basta mirar su punto medio.
      const cuts = circleSheetCrossings(e.c, e.r, sheet).map((q) => normalizeDeg(q - start)).filter((u) => u > 0 && u < sweep);
      const marks = [0, ...cuts.sort((p, q) => p - q), sweep];
      for (let i = 0; i + 1 < marks.length; i += 1) {
        const span = marks[i + 1] - marks[i];
        if (span * Math.PI * e.r / 180 > SHEET_MIN_MM && insideClosed(pointAt(e.c, start + marks[i] + span / 2, e.r), sheet)) return true;
      }
      return false;
    }
    case 'polyline':
      return e.points.some((p, i) => (i === 0 ? insideClosed(p, sheet) : entityIntersectsSheet({ type: 'segment', a: e.points[i - 1], b: p }, sheet)));
    default: return false;
  }
}

/** Distancia exacta (mm) de p a la geometría de la entidad (al eje del trazo, sin grosor). */
export function distanceToEntity(p, e) {
  switch (e.type) {
    case 'point': return Math.hypot(p.x - e.x, p.y - e.y);
    case 'segment': return nearestOnSegment(p, e.a, e.b).dist;
    case 'circle': return Math.abs(Math.hypot(p.x - e.c.x, p.y - e.c.y) - e.r);
    case 'arc': {
      const d = Math.hypot(p.x - e.c.x, p.y - e.c.y);
      if (d > 0 && angleInArc(segmentAngle(e.c, p), e.start, e.sweep)) return Math.abs(d - e.r);
      const { p0, p1 } = arcEndpoints(e);
      return Math.min(Math.hypot(p.x - p0.x, p.y - p0.y), Math.hypot(p.x - p1.x, p.y - p1.y));
    }
    case 'polyline': {
      const pts = e.points;
      if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
      let best = Infinity;
      for (let i = 1; i < pts.length; i += 1) best = Math.min(best, nearestOnSegment(p, pts[i - 1], pts[i]).dist);
      return best;
    }
    default: return Infinity;
  }
}

/**
 * Entidad bajo el toque: la más cercana dentro de tolMm (se descuenta medio grosor de trazo).
 * Sirve solo para ELEGIR una entidad (selección, referencia); nunca mueve el punto tocado.
 */
export function hitTest(p, entities, tolMm, filter) {
  let best = null;
  for (let i = entities.length - 1; i >= 0; i -= 1) {
    const e = entities[i];
    if (filter && !filter(e)) continue;
    const d = distanceToEntity(p, e) - e.width / 2;
    if (d <= tolMm && (!best || d < best.d)) best = { e, d };
  }
  return best ? best.e : null;
}

/** Longitud (mm) de la geometría. */
export function entityLength(e) {
  switch (e.type) {
    case 'segment': return segmentLength(e.a, e.b);
    case 'circle': return 2 * Math.PI * e.r;
    case 'arc': return (Math.PI * e.r * e.sweep) / 180;
    case 'polyline': {
      let total = 0;
      for (let i = 1; i < e.points.length; i += 1) total += segmentLength(e.points[i - 1], e.points[i]);
      return total;
    }
    default: return 0;
  }
}

// ───────────────────────── Operaciones de edición (inmutables) ─────────────────────────

export function addEntities(entities, added) {
  return [...entities, ...added];
}

export function removeEntities(entities, ids) {
  const set = new Set(ids);
  return entities.filter((e) => !set.has(e.id));
}

/**
 * Sustituye la entidad `id` por la versión con `patch` aplicado. Devuelve
 * { entities, error } — si el resultado no es válido o queda totalmente fuera de la hoja, no cambia nada.
 * Una figura que queda solo en parte fuera se acepta tal cual (la pantalla y las exportaciones la recortan).
 */
export function updateEntity(entities, id, patch, sheet = A4_PORTRAIT) {
  const index = entities.findIndex((e) => e.id === id);
  if (index < 0) return { entities, error: 'La entidad ya no existe.' };
  const next = sanitizeEntity({ ...entities[index], ...patch, id });
  if (!next) return { entities, error: 'Valores no válidos.' };
  if (!entityIntersectsSheet(next, sheet)) return { entities, error: 'Queda totalmente fuera de la hoja A4.' };
  const out = entities.slice();
  out[index] = next;
  return { entities: out, error: null };
}

/** Segmento con el inicio fijo y la longitud indicada (misma dirección exacta). */
export function segmentWithLength(e, length) {
  return { b: pointAt(e.a, segmentAngle(e.a, e.b), length) };
}

/** Segmento con el inicio fijo, misma longitud y el ángulo indicado. */
export function segmentWithAngle(e, angleDeg) {
  return { b: pointAt(e.a, angleDeg, segmentLength(e.a, e.b)) };
}

// ───────────────────────── Historial (deshacer / rehacer) ─────────────────────────

export const HISTORY_LIMIT = 200;

export function createHistory(present) {
  return { past: [], present, future: [] };
}

/** Añade un estado nuevo. Si es el mismo array (sin cambios), no crea un paso de historial. */
export function commitHistory(h, next, limit = HISTORY_LIMIT) {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export function undoHistory(h) {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redoHistory(h) {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
