// Pruebas de la matemática de src/lib/geometry.js (no necesitan navegador ni dependencias).
// Comprueban coherencia geométrica en milímetros de documento; NO verifican la escala física de ninguna pantalla.
import assert from 'node:assert/strict';
import {
  arcPoints, angleBetweenDeg, angleConstruction, collectSnapTargets, CURVE_TOLERANCE_MM, dirFromAngle,
  distanceToPolyline, findStrokeAt, nearestOnSegment, normalizeDeg, offsetLine, pointAt, pointsInsideSheet,
  relatedLine, segmentAngle, segmentLength, snapPoint, sweepBetween, unitVector,
} from '../src/lib/geometry.js';

let checks = 0;
const near = (a, b, eps, msg) => { checks += 1; assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b} (±${eps})`); };
const O = { x: 100, y: 150 };

// 1) Convención de ángulos: 0° derecha, 90° arriba (Y de hoja disminuye), antihorario.
{
  const e = pointAt(O, 0, 50); near(e.x, 150, 1e-12, '0° x'); near(e.y, 150, 1e-12, '0° y');
  const n = pointAt(O, 90, 50); near(n.x, 100, 1e-9, '90° x'); near(n.y, 100, 1e-12, '90° y');
  const w = pointAt(O, 180, 50); near(w.x, 50, 1e-12, '180° x');
  const s = pointAt(O, 270, 50); near(s.y, 200, 1e-12, '270° y');
  near(normalizeDeg(-90), 270, 0, 'normalize -90'); near(normalizeDeg(720.5), 0.5, 1e-9, 'normalize 720.5');
}

// 2) Longitud y ángulo recuperados exactamente (ida y vuelta) en un barrido de valores.
for (let ang = 0; ang < 360; ang += 0.37) {
  for (const len of [0.1, 1, 12.345, 50, 150, 280]) {
    const b = pointAt(O, ang, len);
    near(segmentLength(O, b), len, 1e-9, `longitud a ${ang}°`);
    const back = segmentAngle(O, b);
    const diff = Math.abs(((back - ang + 540) % 360) - 180);
    near(diff, 180 - 180 + 0, 1e-6 + 1e-9 / len * 57.3, `ángulo ${ang}° long ${len}`);
  }
}

// 3) Arcos: todos los puntos a radio exacto, flecha de cuerda ≤ tolerancia, extremos exactos, cierre exacto.
for (const r of [0.5, 5, 25, 100, 300]) {
  const pts = arcPoints(O, r, 30, 360);
  for (const p of pts) near(Math.hypot(p.x - O.x, p.y - O.y), r, 1e-9, `radio r=${r}`);
  near(pts[0].x, pts[pts.length - 1].x, 1e-12, 'cierre x'); near(pts[0].y, pts[pts.length - 1].y, 1e-12, 'cierre y');
  let maxSagitta = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const mx = (pts[i].x + pts[i - 1].x) / 2, my = (pts[i].y + pts[i - 1].y) / 2;
    maxSagitta = Math.max(maxSagitta, r - Math.hypot(mx - O.x, my - O.y));
  }
  checks += 1; assert.ok(maxSagitta <= CURVE_TOLERANCE_MM * 1.0001, `flecha ${maxSagitta} > tol para r=${r}`);
}
{
  const arc = arcPoints(O, 40, 20, 75);
  const a = pointAt(O, 20, 40), b = pointAt(O, 95, 40);
  near(arc[0].x, a.x, 1e-12, 'arco inicio x'); near(arc[0].y, a.y, 1e-12, 'arco inicio y');
  near(arc[arc.length - 1].x, b.x, 1e-9, 'arco fin x'); near(arc[arc.length - 1].y, b.y, 1e-9, 'arco fin y');
  near(angleBetweenDeg(O, arc[0], arc[arc.length - 1]), 75, 1e-9, 'barrido del arco');
  near(sweepBetween(350, 10), 20, 1e-12, 'barrido cruzando 0°'); near(sweepBetween(10, 10), 0, 0, 'barrido nulo');
}

// 4) Paralelas, perpendiculares, pie de perpendicular y desplazamiento.
{
  const r0 = { x: 20, y: 30 }, r1 = { x: 110, y: 85 }; const u = unitVector(r0, r1);
  const P = { x: 60, y: 140 };
  for (const placement of ['start', 'center']) for (const flip of [false, true]) {
    const par = relatedLine({ ref0: r0, ref1: r1, mode: 'parallel', through: P, length: 70, placement, flip });
    const d = unitVector(par[0], par[1]);
    near(d.len, 70, 1e-9, 'largo paralela'); near(d.x * u.y - d.y * u.x, 0, 1e-12, 'paralelismo (producto cruz)');
    const per = relatedLine({ ref0: r0, ref1: r1, mode: 'perpendicular', through: P, length: 33.3, placement, flip });
    const e = unitVector(per[0], per[1]);
    near(e.len, 33.3, 1e-9, 'largo perpendicular'); near(e.x * u.x + e.y * u.y, 0, 1e-12, 'perpendicularidad (producto punto)');
    if (placement === 'start') { near(par[0].x, P.x, 0, 'parte del punto'); near(per[0].y, P.y, 0, 'parte del punto'); }
    else { near((par[0].x + par[1].x) / 2, P.x, 1e-9, 'centrada x'); near((per[0].y + per[1].y) / 2, P.y, 1e-9, 'centrada y'); }
  }
  const foot = relatedLine({ ref0: r0, ref1: r1, mode: 'perpendicular', through: P, placement: 'foot', length: 0, flip: false });
  const dist = Math.abs((P.x - r0.x) * (-u.y) + (P.y - r0.y) * u.x); // distancia punto–recta calculada aparte
  near(segmentLength(foot[0], foot[1]), dist, 1e-9, 'longitud del pie = distancia punto–recta');
  const fu = unitVector(foot[0], foot[1]); near(fu.x * u.x + fu.y * u.y, 0, 1e-12, 'pie perpendicular');
  const onLine = (foot[1].x - r0.x) * u.y - (foot[1].y - r0.y) * u.x; near(onLine, 0, 1e-9, 'pie sobre la recta');
  checks += 1; assert.equal(relatedLine({ ref0: r0, ref1: r1, mode: 'perpendicular', through: r0, placement: 'foot', length: 0, flip: false }), null);
  for (const flip of [false, true]) {
    const off = offsetLine(r0, r1, 12.5, flip); const ou = unitVector(off[0], off[1]);
    near(ou.len, unitVector(r0, r1).len, 1e-9, 'misma longitud'); near(ou.x * u.y - ou.y * u.x, 0, 1e-12, 'desplazada paralela');
    near(Math.abs((off[0].x - r0.x) * (-u.y) + (off[0].y - r0.y) * u.x), 12.5, 1e-9, 'distancia entre paralelas');
  }
  checks += 1; assert.equal(offsetLine(r0, r0, 5, false), null);
}

// 5) Transportador: el ángulo medido entre los rayos construidos es el pedido, en ambos sentidos.
for (const base of [0, 20, 133.3, 270]) for (const ang of [0.01, 30, 37.5, 90, 179.99, 180, 250]) for (const cw of [false, true]) {
  const c = angleConstruction(O, base, ang, cw, 60, 8);
  const measured = angleBetweenDeg(O, c.baseEnd, c.rayEnd);
  const expected = ang > 180 ? 360 - ang : ang;
  near(measured, expected, 1e-6, `ángulo ${ang}° base ${base}° cw=${cw}`);
  const arc = arcPoints(O, 8, c.arcStartDeg, c.sweepDeg);
  const ends = [arc[0], arc[arc.length - 1]].map((p) => segmentAngle(O, p));
  const wanted = [c.baseDeg, c.rayDeg]; if (cw) wanted.reverse();
  for (let i = 0; i < 2; i += 1) near(Math.abs(((ends[i] - wanted[i] + 540) % 360) - 180), 0, 1e-6, 'extremos del arco = rayos');
}

// 6) Búsqueda, límites e imanes.
{
  const strokes = [{ id: 'a', kind: 'line', width: 0.4, points: [{ x: 10, y: 10 }, { x: 110, y: 10 }] },
    { id: 'c', kind: 'circle', width: 0.4, meta: { center: { x: 50, y: 50 }, radius: 20 }, points: arcPoints({ x: 50, y: 50 }, 20, 0, 360) }];
  near(nearestOnSegment({ x: 40, y: 20 }, strokes[0].points[0], strokes[0].points[1]).dist, 10, 1e-12, 'distancia a segmento');
  checks += 1; assert.equal(findStrokeAt({ x: 40, y: 11 }, strokes, 2)?.id, 'a');
  checks += 1; assert.equal(findStrokeAt({ x: 40, y: 20 }, strokes, 2), null);
  checks += 1; assert.equal(findStrokeAt({ x: 70, y: 50 }, strokes, 1)?.id, 'c');
  checks += 1; assert.equal(findStrokeAt({ x: 40, y: 11 }, strokes, 2, (s) => s.kind === 'circle'), null);
  near(distanceToPolyline({ x: 50, y: 50 }, strokes[1].points), 20, CURVE_TOLERANCE_MM * 1.0001, 'centro a polilínea (dentro de la tolerancia de curva)');
  checks += 1; assert.ok(pointsInsideSheet([{ x: 0, y: 0 }, { x: 210, y: 297 }])); assert.ok(!pointsInsideSheet([{ x: 210.01, y: 5 }])); assert.ok(!pointsInsideSheet([{ x: NaN, y: 5 }]));
  const t = collectSnapTargets(strokes);
  let s = snapPoint({ x: 109, y: 11 }, t, 3, 1); checks += 1; assert.deepEqual([s.x, s.y, s.kind], [110, 10, 'extremo']);
  s = snapPoint({ x: 61, y: 9 }, t, 3, 1); checks += 1; assert.deepEqual([s.x, s.y, s.kind], [60, 10, 'medio']);
  s = snapPoint({ x: 51, y: 49 }, t, 3, 1); checks += 1; assert.deepEqual([s.x, s.y, s.kind], [50, 50, 'centro']);
  s = snapPoint({ x: 70.5, y: 49.2 }, t, 3, 1); checks += 1; assert.deepEqual([s.x, s.y, s.kind], [70, 50, 'cuadrante']);
  s = snapPoint({ x: 150.3, y: 200.6 }, t, 3, 1); checks += 1; assert.deepEqual([s.x, s.y, s.kind], [150, 201, 'cuadricula']);
  s = snapPoint({ x: 150.3, y: 200.6 }, t, 3, 0); checks += 1; assert.deepEqual([s.x, s.y, s.kind], [150.3, 200.6, null]);
  near(dirFromAngle(45).x, Math.SQRT1_2, 1e-15, 'dir 45°');
}

console.log(`Geometría OK: ${checks} comprobaciones numéricas superadas (milímetros de documento; sin medir ninguna pantalla).`);
