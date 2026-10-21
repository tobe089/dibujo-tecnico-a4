// Borrador parcial exacto. Sin dependencias de DOM.
//
// El borrador barre una "cápsula": todos los puntos a distancia ≤ r del segmento P→Q (P = Q para un toque).
// Para cada entidad se calcula ANALÍTICAMENTE qué parte de su geometría cae dentro de la cápsula y se conserva
// el resto, sin muestrear ni aproximar:
//   segmento  → 0, 1 o 2 segmentos sobre la misma recta
//   círculo   → arcos del mismo centro y radio
//   arco      → arcos del mismo centro y radio
//   polilínea → polilíneas cortadas en los puntos exactos de entrada/salida
//   punto     → se elimina si queda dentro
// Los trozos más cortos que MIN_PIECE_MM se descartan (restos numéricos, no una tolerancia de dibujo).

import { nearestOnSegment, normalizeDeg, segmentAngle, segmentLength } from './geometry.js';
import { entityBounds, makeId } from './document.js';

const DEG = Math.PI / 180;
export const MIN_PIECE_MM = 1e-6;

// ───────────────────────── Conjuntos de ángulos en [0, 360] ─────────────────────────
// Un conjunto es una lista ordenada de intervalos [a, b] disjuntos con 0 ≤ a < b ≤ 360.

export function arcSet(startDeg, sweepDeg) {
  if (!(sweepDeg > 0)) return [];
  if (sweepDeg >= 360) return [[0, 360]];
  const s = normalizeDeg(startDeg);
  const e = s + sweepDeg;
  return e <= 360 ? [[s, e]] : [[0, e - 360], [s, 360]];
}

export function unionSets(...sets) {
  const all = sets.flat().filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [a, b] of all) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function intersectSets(A, B) {
  const out = [];
  for (const [a0, a1] of A) for (const [b0, b1] of B) {
    const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
    if (hi > lo) out.push([lo, hi]);
  }
  return unionSets(out);
}

export function complementSet(A) {
  const out = [];
  let cursor = 0;
  for (const [a, b] of unionSets(A)) { if (a > cursor) out.push([cursor, a]); cursor = Math.max(cursor, b); }
  if (cursor < 360) out.push([cursor, 360]);
  return out;
}

// ───────────────────────── Cápsula sobre una circunferencia ─────────────────────────

/** Ángulos θ de la circunferencia (C, R) con dir(θ)·m ≤ s, siendo m un vector unitario. */
function halfPlaneArc(m, s) {
  if (s >= 1) return [[0, 360]];
  if (s <= -1) return [];
  const phi = normalizeDeg(Math.atan2(-m.y, m.x) / DEG);
  const alpha = Math.acos(s) / DEG;
  return arcSet(phi + alpha, 360 - 2 * alpha);
}

/** Ángulos de la circunferencia (C, R) a distancia ≤ r del punto P. */
function diskArc(C, R, P, r) {
  const d = Math.hypot(P.x - C.x, P.y - C.y);
  if (d < 1e-12) return R <= r ? [[0, 360]] : [];
  const cosA = (R * R + d * d - r * r) / (2 * R * d);
  if (cosA <= -1) return [[0, 360]];
  if (cosA >= 1) return [];
  const alpha = Math.acos(cosA) / DEG;
  return arcSet(segmentAngle(C, P) - alpha, 2 * alpha);
}

/** Conjunto exacto de ángulos de la circunferencia (C, R) que cubre la cápsula P→Q de radio r. */
export function circleCapsuleCover(C, R, P, Q, r) {
  const cover = [diskArc(C, R, P, r)];
  const L = segmentLength(P, Q);
  if (L > 0) {
    cover.push(diskArc(C, R, Q, r));
    const u = { x: (Q.x - P.x) / L, y: (Q.y - P.y) / L };
    const n = { x: -u.y, y: u.x };
    // Rectángulo de la cápsula como 4 semiplanos (X−P)·m ≤ k; sobre la circunferencia: dir(θ)·m ≤ (k − (C−P)·m)/R
    const cp = { x: C.x - P.x, y: C.y - P.y };
    const halfPlanes = [
      [{ x: -u.x, y: -u.y }, 0], [u, L], [n, r], [{ x: -n.x, y: -n.y }, r],
    ].map(([m, k]) => halfPlaneArc(m, (k - (cp.x * m.x + cp.y * m.y)) / R));
    cover.push(halfPlanes.reduce((acc, set) => intersectSets(acc, set), [[0, 360]]));
  }
  return unionSets(...cover);
}

// ───────────────────────── Cápsula sobre un segmento ─────────────────────────

/** Intervalo [t0, t1] ⊂ [0, 1] del segmento A→B a distancia ≤ r de P (o null). */
function segmentDisk(A, B, P, r) {
  const D = { x: B.x - A.x, y: B.y - A.y };
  const W = { x: A.x - P.x, y: A.y - P.y };
  const a = D.x * D.x + D.y * D.y;
  const c = W.x * W.x + W.y * W.y - r * r;
  if (a === 0) return c <= 0 ? [0, 1] : null;
  const b = 2 * (D.x * W.x + D.y * W.y);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = Math.max(0, (-b - sq) / (2 * a)), t1 = Math.min(1, (-b + sq) / (2 * a));
  return t1 >= t0 ? [t0, t1] : null;
}

/**
 * Intervalo [t0, t1] ⊂ [0, 1] del segmento A→B que queda dentro de la cápsula P→Q de radio r, o null.
 * La distancia a un convexo es convexa a lo largo de una recta, así que el resultado es siempre un único intervalo.
 */
export function segmentCapsuleInterval(A, B, P, Q, r) {
  const pieces = [segmentDisk(A, B, P, r)];
  const L = segmentLength(P, Q);
  if (L > 0) {
    pieces.push(segmentDisk(A, B, Q, r));
    const u = { x: (Q.x - P.x) / L, y: (Q.y - P.y) / L };
    const n = { x: -u.y, y: u.x };
    const D = { x: B.x - A.x, y: B.y - A.y };
    const W = { x: A.x - P.x, y: A.y - P.y };
    let lo = 0, hi = 1, empty = false;
    // Liang–Barsky: (W + t·D)·m ≤ k
    for (const [m, k] of [[{ x: -u.x, y: -u.y }, 0], [u, L], [n, r], [{ x: -n.x, y: -n.y }, r]]) {
      const w = W.x * m.x + W.y * m.y, d = D.x * m.x + D.y * m.y;
      if (d === 0) { if (w > k) { empty = true; break; } continue; }
      const t = (k - w) / d;
      if (d > 0) hi = Math.min(hi, t); else lo = Math.max(lo, t);
    }
    if (!empty && hi >= lo) pieces.push([lo, hi]);
  }
  const valid = pieces.filter(Boolean);
  if (!valid.length) return null;
  return [Math.min(...valid.map((p) => p[0])), Math.max(...valid.map((p) => p[1]))];
}

// ───────────────────────── Borrado de entidades ─────────────────────────

function lerp(a, b, t) {
  const out = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  if (Number.isFinite(a.p) && Number.isFinite(b.p)) out.p = a.p + (b.p - a.p) * t;
  return out;
}

function capsuleBox(P, Q, r) {
  return { minX: Math.min(P.x, Q.x) - r, minY: Math.min(P.y, Q.y) - r, maxX: Math.max(P.x, Q.x) + r, maxY: Math.max(P.y, Q.y) + r };
}
const boxesOverlap = (a, b) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** Intervalos [s0, s1] del parámetro de la polilínea (s = i + t) cubiertos por la cápsula. */
function polylineCover(points, P, Q, r) {
  const cover = [];
  for (let i = 1; i < points.length; i += 1) {
    const iv = segmentCapsuleInterval(points[i - 1], points[i], P, Q, r);
    if (iv) cover.push([i - 1 + iv[0], i - 1 + iv[1]]);
  }
  return unionSets(cover);
}

function polylinePiece(points, s0, s1) {
  const i0 = Math.min(points.length - 2, Math.floor(s0));
  const i1 = Math.min(points.length - 2, Math.floor(s1));
  const out = [lerp(points[i0], points[i0 + 1], s0 - i0)];
  for (let k = i0 + 1; k <= i1; k += 1) if (k > s0 && k < s1) out.push({ ...points[k] });
  out.push(lerp(points[i1], points[i1 + 1], s1 - i1));
  return out;
}

const polyLength = (pts) => pts.reduce((sum, p, i) => (i ? sum + segmentLength(pts[i - 1], p) : 0), 0);

/**
 * Aplica una pasada de borrador (cápsula P→Q, radio r) a una entidad.
 * Devuelve null si no la toca, o la lista de entidades que la sustituyen (vacía = borrada por completo).
 * mode 'partial' conserva lo no atravesado; 'whole' elimina la entidad entera si se toca.
 * El primer trozo conserva el id original; los demás reciben ids nuevos.
 */
export function eraseEntity(e, P, Q, r, { mode = 'partial', newId = makeId } = {}) {
  if (!boxesOverlap(entityBounds(e), capsuleBox(P, Q, r))) return null;
  const style = { color: e.color, width: e.width };
  const ids = (i) => (i === 0 ? e.id : newId());
  switch (e.type) {
    case 'point':
      return nearestOnSegment(e, P, Q).dist <= r ? [] : null;
    case 'segment': {
      const iv = segmentCapsuleInterval(e.a, e.b, P, Q, r);
      if (!iv) return null;
      if (mode === 'whole') return [];
      const len = segmentLength(e.a, e.b);
      const keep = [[0, iv[0]], [iv[1], 1]].filter(([t0, t1]) => (t1 - t0) * len >= MIN_PIECE_MM);
      return keep.map(([t0, t1], i) => ({
        id: ids(i), type: 'segment', ...style,
        a: t0 === 0 ? { ...e.a } : lerp(e.a, e.b, t0), b: t1 === 1 ? { ...e.b } : lerp(e.a, e.b, t1),
      }));
    }
    case 'circle':
    case 'arc': {
      const cover = circleCapsuleCover(e.c, e.r, P, Q, r);
      const own = e.type === 'circle' ? [[0, 360]] : arcSet(e.start, e.sweep);
      if (!intersectSets(cover, own).length) return null;
      if (mode === 'whole') return [];
      let rest = intersectSets(own, complementSet(cover));
      // Reúne los trozos que cruzan 0°/360° en un único arco antihorario.
      const arcs = rest.map(([a, b]) => ({ start: a, sweep: b - a }));
      if (arcs.length >= 2 && rest[0][0] === 0 && rest[rest.length - 1][1] === 360) {
        const first = arcs.shift();
        const last = arcs.pop();
        arcs.push({ start: last.start, sweep: last.sweep + first.sweep });
      }
      // Para un arco original, ordena los trozos desde su ángulo inicial.
      if (e.type === 'arc') arcs.sort((p, q) => normalizeDeg(p.start - e.start) - normalizeDeg(q.start - e.start));
      return arcs
        .filter((a) => (Math.PI * e.r * a.sweep) / 180 >= MIN_PIECE_MM)
        .map((a, i) => ({ id: ids(i), type: 'arc', ...style, c: { ...e.c }, r: e.r, start: normalizeDeg(a.start), sweep: a.sweep }));
    }
    case 'polyline': {
      const pts = e.points;
      if (pts.length === 1) return nearestOnSegment(pts[0], P, Q).dist <= r ? [] : null;
      const cover = polylineCover(pts, P, Q, r);
      if (!cover.length) return null;
      if (mode === 'whole') return [];
      const end = pts.length - 1;
      const keep = [];
      let cursor = 0;
      for (const [a, b] of cover) { if (a > cursor) keep.push([cursor, a]); cursor = Math.max(cursor, b); }
      if (cursor < end) keep.push([cursor, end]);
      return keep
        .map(([s0, s1]) => polylinePiece(pts, s0, s1))
        .filter((piece) => polyLength(piece) >= MIN_PIECE_MM)
        .map((points, i) => ({ id: ids(i), type: 'polyline', ...style, points }));
    }
    default:
      return null;
  }
}

/** Aplica la cápsula P→Q a todas las entidades. Devuelve el mismo array si nada cambió. */
export function eraseWithCapsule(entities, P, Q, r, options) {
  let changed = false;
  const out = [];
  for (const e of entities) {
    const res = eraseEntity(e, P, Q, r, options);
    if (res === null) out.push(e);
    else { changed = true; out.push(...res); }
  }
  return changed ? out : entities;
}

/** Aplica un recorrido completo del borrador (lista de puntos en mm). */
export function eraseAlongPath(entities, path, r, options) {
  if (!path.length) return entities;
  let current = eraseWithCapsule(entities, path[0], path[0], r, options);
  for (let i = 1; i < path.length; i += 1) current = eraseWithCapsule(current, path[i - 1], path[i], r, options);
  return current;
}
