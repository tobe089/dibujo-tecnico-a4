// Geometría pura para la hoja A4. Sin dependencias, sin DOM.
//
// CONVENCIONES (todas las herramientas las comparten):
//  - Unidades: milímetros de documento. Origen arriba-izquierda, X→derecha, Y→abajo (igual que el SVG).
//  - Ángulos: grados. 0° = hacia la derecha, positivo = SENTIDO ANTIHORARIO tal como se ve en pantalla.
//    90° apunta hacia ARRIBA en la hoja.
//  - Un arco se define por centro, radio, ángulo inicial y barrido (siempre antihorario, 0 < barrido ≤ 360).

export const SHEET_W = 210;
export const SHEET_H = 297;
/** Hoja vertical por defecto. La orientación horizontal intercambia ancho y alto; la geometría no cambia. */
export const A4_PORTRAIT = Object.freeze({ w: SHEET_W, h: SHEET_H });
export const A4_LANDSCAPE = Object.freeze({ w: SHEET_H, h: SHEET_W });
export function sheetFor(orientation) {
  return orientation === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT;
}
const DEG = Math.PI / 180;

/** Tolerancia máxima (mm) entre la curva real y su aproximación poligonal al dibujar arcos/circunferencias. */
export const CURVE_TOLERANCE_MM = 0.002;

export function normalizeDeg(angle) {
  const r = angle % 360;
  return r < 0 ? r + 360 : r;
}

/** Vector unitario (en coordenadas de hoja, Y hacia abajo) para un ángulo antihorario en grados. */
export function dirFromAngle(deg) {
  const t = deg * DEG;
  return { x: Math.cos(t), y: -Math.sin(t) };
}

export function pointAt(origin, deg, length) {
  const d = dirFromAngle(deg);
  return { x: origin.x + d.x * length, y: origin.y + d.y * length };
}

export function segmentLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Ángulo antihorario [0, 360) del vector a→b. */
export function segmentAngle(a, b) {
  return normalizeDeg(Math.atan2(-(b.y - a.y), b.x - a.x) / DEG);
}

/** Vector unitario a→b, o null si los puntos coinciden. */
export function unitVector(a, b) {
  const len = segmentLength(a, b);
  if (!(len > 1e-9)) return null;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len, len };
}

export function roundTo(value, decimals) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

// ───────────────────────── Arcos y circunferencias ─────────────────────────

/** Paso angular máximo (rad) para que la flecha (sagita) de cada cuerda no supere `tol`. */
export function arcStepRad(radius, tol = CURVE_TOLERANCE_MM) {
  const cap = 2 * DEG; // nunca más de 2° por tramo
  if (!(radius > tol)) return cap;
  return Math.min(cap, 2 * Math.acos(1 - tol / radius));
}

/**
 * Puntos de un arco antihorario. startDeg = ángulo inicial, sweepDeg = barrido (0, 360].
 * Con barrido 360 el último punto coincide exactamente con el primero (curva cerrada).
 */
export function arcPoints(center, radius, startDeg, sweepDeg, tol = CURVE_TOLERANCE_MM) {
  const sweep = Math.min(360, Math.max(0, sweepDeg));
  const n = Math.max(2, Math.ceil((sweep * DEG) / arcStepRad(radius, tol)));
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    pts.push(pointAt(center, startDeg + (sweep * i) / n, radius));
  }
  if (sweep === 360) pts[n] = { ...pts[0] };
  return pts;
}

/** Barrido antihorario de `startDeg` a `endDeg`. Devuelve 0 si coinciden (el llamador decide qué hacer). */
export function sweepBetween(startDeg, endDeg) {
  return normalizeDeg(endDeg - startDeg);
}

/** ¿Está el ángulo `deg` dentro del arco antihorario que empieza en startDeg y barre sweepDeg? */
export function angleInArc(deg, startDeg, sweepDeg) {
  if (sweepDeg >= 360) return true;
  return normalizeDeg(deg - startDeg) <= sweepDeg;
}

/** Paso angular máximo (grados) de cada curva de Bézier al convertir un arco: error radial < 1e-8·r. */
export const BEZIER_MAX_STEP_DEG = 15;

/**
 * Arco antihorario convertido a curvas de Bézier cúbicas (coordenadas de hoja, Y hacia abajo).
 * Devuelve [{ p0, c1, c2, p3 }]. Los extremos p0/p3 están exactamente sobre la circunferencia.
 */
export function arcToBeziers(center, radius, startDeg, sweepDeg, maxStepDeg = BEZIER_MAX_STEP_DEG) {
  const sweep = Math.min(360, Math.max(0, sweepDeg));
  const n = Math.max(1, Math.ceil(sweep / maxStepDeg));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan((step * DEG) / 4) * radius;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a0 = startDeg + step * i;
    const a1 = startDeg + step * (i + 1);
    const p0 = pointAt(center, a0, radius);
    const p3 = i === n - 1 && sweep === 360 ? pointAt(center, startDeg, radius) : pointAt(center, a1, radius);
    // Derivada de c + r·(cos θ, −sin θ) respecto de θ: (−sin θ, −cos θ)
    const t0 = { x: -Math.sin(a0 * DEG), y: -Math.cos(a0 * DEG) };
    const t1 = { x: -Math.sin(a1 * DEG), y: -Math.cos(a1 * DEG) };
    out.push({
      p0,
      c1: { x: p0.x + k * t0.x, y: p0.y + k * t0.y },
      c2: { x: p3.x - k * t1.x, y: p3.y - k * t1.y },
      p3,
    });
  }
  return out;
}

/** Punto de una curva de Bézier cúbica en t ∈ [0, 1]. */
export function bezierPoint(b, t) {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return {
    x: w0 * b.p0.x + w1 * b.c1.x + w2 * b.c2.x + w3 * b.p3.x,
    y: w0 * b.p0.y + w1 * b.c1.y + w2 * b.c2.y + w3 * b.p3.y,
  };
}

// ───────────────────────── Distancias y búsqueda ─────────────────────────

export function nearestOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

export function distanceToPolyline(p, pts) {
  if (!pts || !pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i += 1) {
    const d = nearestOnSegment(p, pts[i - 1], pts[i]).dist;
    if (d < best) best = d;
  }
  return best;
}

/** Trazo más cercano a p dentro de tolMm. `filter` opcional (por ejemplo: solo líneas). */
export function findStrokeAt(p, strokes, tolMm, filter) {
  let best = null;
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const s = strokes[i];
    if (filter && !filter(s)) continue;
    const d = distanceToPolyline(p, s.points) - (Number(s.width) || 0) / 2;
    if (d <= tolMm && (!best || d < best.dist)) best = { stroke: s, dist: d };
  }
  return best ? best.stroke : null;
}

export function pointsInsideSheet(points, eps = 1e-9, sheet = A4_PORTRAIT) {
  return points.every(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.x >= -eps && p.x <= sheet.w + eps && p.y >= -eps && p.y <= sheet.h + eps,
  );
}

// ───────────────────────── Paralelas y perpendiculares ─────────────────────────

/**
 * Segmento paralelo/perpendicular a la referencia ref0→ref1.
 *  mode: 'parallel' | 'perpendicular'
 *  placement: 'start' (parte de `through` y avanza `length`), 'center' (centrado en `through`),
 *             'foot' (solo perpendicular: desde `through` hasta el pie sobre la recta de referencia).
 *  flip: invierte el sentido del segmento.
 * Devuelve [a, b] o null si los datos no son válidos.
 */
export function relatedLine({ ref0, ref1, mode, through, length, placement, flip }) {
  const u = unitVector(ref0, ref1);
  if (!u) return null;
  const sign = flip ? -1 : 1;
  if (mode === 'perpendicular' && placement === 'foot') {
    const nx = -u.y;
    const ny = u.x;
    // distancia con signo de `through` a la recta de referencia, medida a lo largo de la normal
    const signed = (through.x - ref0.x) * nx + (through.y - ref0.y) * ny;
    const foot = { x: through.x - nx * signed, y: through.y - ny * signed };
    if (!(Math.abs(signed) > 1e-9)) return null;
    return [{ x: through.x, y: through.y }, foot];
  }
  if (!(length > 0)) return null;
  const d = mode === 'perpendicular' ? { x: -u.y * sign, y: u.x * sign } : { x: u.x * sign, y: u.y * sign };
  if (placement === 'center') {
    return [
      { x: through.x - d.x * length / 2, y: through.y - d.y * length / 2 },
      { x: through.x + d.x * length / 2, y: through.y + d.y * length / 2 },
    ];
  }
  return [{ x: through.x, y: through.y }, { x: through.x + d.x * length, y: through.y + d.y * length }];
}

/** Copia paralela de ref0→ref1 desplazada `distance` mm en perpendicular (mismo largo). */
export function offsetLine(ref0, ref1, distance, flip) {
  const u = unitVector(ref0, ref1);
  if (!u || !(distance > 0)) return null;
  const sign = flip ? -1 : 1;
  const ox = -u.y * distance * sign;
  const oy = u.x * distance * sign;
  return [{ x: ref0.x + ox, y: ref0.y + oy }, { x: ref1.x + ox, y: ref1.y + oy }];
}

// ───────────────────────── Transportador ─────────────────────────

/**
 * Construcción de un ángulo exacto con vértice, rayo base y segundo rayo.
 * cw = true mide el ángulo en sentido horario desde el rayo base.
 */
export function angleConstruction(vertex, baseDeg, angleDeg, cw, rayLength, markRadius) {
  const rayDeg = normalizeDeg(baseDeg + (cw ? -angleDeg : angleDeg));
  return {
    baseDeg: normalizeDeg(baseDeg),
    rayDeg,
    baseEnd: pointAt(vertex, baseDeg, rayLength),
    rayEnd: pointAt(vertex, rayDeg, rayLength),
    arcStartDeg: normalizeDeg(cw ? baseDeg - angleDeg : baseDeg),
    sweepDeg: angleDeg,
    markRadius,
  };
}

/** Ángulo (0–180°) entre los rayos vértice→a y vértice→b. Solo para comprobaciones. */
export function angleBetweenDeg(vertex, a, b) {
  const u = unitVector(vertex, a);
  const v = unitVector(vertex, b);
  if (!u || !v) return NaN;
  const dot = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y));
  return Math.acos(dot) / DEG;
}
