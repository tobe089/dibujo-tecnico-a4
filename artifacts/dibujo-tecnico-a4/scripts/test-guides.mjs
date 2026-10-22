// Pruebas del trazado guiado (compás). Solo Node.
import assert from 'node:assert/strict';
import { pointAt, segmentAngle } from '../src/lib/geometry.js';
import {
  CENTER_DEAD_PX, TRACE_BAND_PX, circleTraceResult, circleTraceSweep, createCircleTrace, extendCircleTrace, startsOnCircle, traceCircle,
} from '../src/lib/guides.js';

let checks = 0;
const ok = (c, m) => { checks += 1; assert.ok(c, m); };
const near = (a, b, eps, m) => ok(Math.abs(a - b) <= eps, `${m}: ${a} ≠ ${b} (±${eps})`);
let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const C = { x: 105.123456789, y: 148.987654321 };
const R = 37.5;
const opts = { scale: 2.5 }; // px de pantalla por mm
/** Muestras sobre (o cerca de) la circunferencia, de `from` a `to` grados con paso `step`. */
function stroke(from, to, step = 1, radial = () => R) {
  const pts = [];
  const n = Math.max(1, Math.round(Math.abs(to - from) / step));
  for (let i = 0; i <= n; i += 1) pts.push(pointAt(C, from + (to - from) * i / n, radial(i)));
  return pts;
}
const angleOf = (p) => segmentAngle(C, p);

// ───────── 1) Arcos: sentido, paso por 0°, ida y vuelta ─────────
{
  const ccw = stroke(10.25, 100.25);
  const a = traceCircle(C, R, ccw, opts);
  ok(a && a.type === 'arc', 'un cuarto de vuelta da un arco');
  ok(Object.is(a.start, angleOf(ccw[0])), 'el inicio es exactamente el ángulo de la primera muestra');
  near(a.sweep, 90, 1e-9, 'barrido de 90°');
  ok(Object.is(a.r, R) && Object.is(a.c.x, C.x) && Object.is(a.c.y, C.y), 'centro y radio idénticos');
  const cw = traceCircle(C, R, [...ccw].reverse(), opts);
  ok(cw.type === 'arc' && Object.is(cw.start, a.start) && Math.abs(cw.sweep - a.sweep) < 1e-9, 'en sentido horario da el mismo arco');
  const zero = traceCircle(C, R, stroke(350, 380), opts);
  near(zero.start, 350, 1e-9, 'cruzar 0°: empieza en 350°'); near(zero.sweep, 30, 1e-9, 'cruzar 0°: barrido de 30°');
  const back = traceCircle(C, R, [...stroke(30, 120), ...stroke(120, 60)], opts);
  near(back.start, 30, 1e-9, 'ida y vuelta: inicio en el mínimo'); near(back.sweep, 90, 1e-9, 'ida y vuelta: el tramo repetido no se suma');
  const odd = traceCircle(C, R, stroke(12.345678, 47.654321, 0.37), opts);
  near(odd.start, 12.345678, 1e-9, 'ángulo inicial no entero, sin redondear'); near(odd.sweep, 47.654321 - 12.345678, 1e-9, 'barrido no entero');
}

// ───────── 2) Circunferencia completa solo con ≥ 360° ─────────
{
  const almost = traceCircle(C, R, stroke(0, 359.9, 0.1), opts);
  ok(almost.type === 'arc', '359,9° sigue siendo un arco (sin cierre automático)'); near(almost.sweep, 359.9, 1e-9, 'barrido de 359,9°');
  ok(traceCircle(C, R, stroke(0, 360, 0.5), opts).type === 'circle', '360° exactos dan una circunferencia');
  ok(traceCircle(C, R, stroke(20, 380.001, 0.5), opts).type === 'circle', '360,001° dan una circunferencia');
  const turns = traceCircle(C, R, stroke(45, 45 + 900, 2), opts);
  ok(turns.type === 'circle' && Object.is(turns.r, R) && !('start' in turns), '2,5 vueltas: una sola circunferencia');
  ok(traceCircle(C, R, stroke(0, -360, 0.5), opts).type === 'circle', 'una vuelta en sentido horario también');
  const tiny = traceCircle(C, R, [...stroke(0, 359, 0.5), pointAt(C, 359.99999, R)], opts);
  ok(tiny.type === 'arc' && tiny.sweep < 360, `359,99999° sigue siendo un arco (${tiny.sweep})`);
}

// ───────── 3) Temblor de la mano: el radio sigue siendo exacto ─────────
{
  for (let k = 0; k < 200; k += 1) {
    const from = rnd() * 360, len = 5 + rnd() * 340;
    const pts = stroke(from, from + len, 0.5, () => R + (rnd() - 0.5) * 6); // ±3 mm hacia dentro y hacia fuera
    const res = traceCircle(C, R, pts, opts);
    ok(res && Object.is(res.r, R) && Object.is(res.c.x, C.x) && Object.is(res.c.y, C.y), `temblor ${k}: centro y radio exactos`);
    ok(res.type === 'arc' && Object.is(res.start, angleOf(pts[0])), `temblor ${k}: el inicio es el ángulo de la muestra inicial`);
  }
}

// ───────── 4) Zona muerta junto al centro, trazos vacíos y entrada intacta ─────────
{
  const dead = CENTER_DEAD_PX / opts.scale; // mm
  const through = [pointAt(C, 10, R), pointAt(C, 40, R), { x: C.x, y: C.y }, pointAt(C, 200, dead * 0.5), pointAt(C, 70, R)];
  const res = traceCircle(C, R, through, opts);
  near(res.start, 10, 1e-9, 'las muestras junto al centro se ignoran'); near(res.sweep, 60, 1e-9, 'y no inventan giros');
  ok(traceCircle(C, R, [pointAt(C, 30, R)], opts) === null, 'un solo punto: nada');
  ok(traceCircle(C, R, [pointAt(C, 30, R), pointAt(C, 30, R + 2)], opts) === null, 'sin recorrido angular: nada');
  ok(traceCircle(C, R, [C, pointAt(C, 90, dead / 2)], opts) === null, 'solo muestras junto al centro: nada');
  ok(traceCircle(C, R, [], opts) === null, 'sin muestras: nada');
  const pts = stroke(0, 90); const copy = JSON.stringify(pts); const c0 = { ...C };
  const t = createCircleTrace(c0, R, opts); c0.x = 0; for (const p of pts) extendCircleTrace(t, p);
  ok(JSON.stringify(pts) === copy, 'las muestras no se modifican');
  ok(Object.is(circleTraceResult(t).c.x, C.x), 'cambiar el centro original después no mueve el trazo');
  near(circleTraceSweep(t), 90, 1e-9, 'barrido parcial disponible durante el trazo');
  // Salto de más de 180° entre dos muestras: se toma el giro corto (con eventos agrupados no debería ocurrir).
  const jump = traceCircle(C, R, [pointAt(C, 0, R), pointAt(C, 200, R)], opts);
  near(jump.start, 200, 1e-9, 'salto de 200°: se interpreta como −160°'); near(jump.sweep, 160, 1e-9, 'barrido de 160°');
}

// ───────── 5) Banda de inicio en px de pantalla ─────────
{
  const band = TRACE_BAND_PX / opts.scale; // mm
  ok(startsOnCircle(C, R, pointAt(C, 33, R), opts.scale), 'sobre la guía');
  ok(startsOnCircle(C, R, pointAt(C, 33, R + band * 0.99), opts.scale) && startsOnCircle(C, R, pointAt(C, 33, R - band * 0.99), opts.scale), 'dentro de la banda, por fuera y por dentro');
  ok(!startsOnCircle(C, R, pointAt(C, 33, R + band * 1.01), opts.scale), 'fuera de la banda');
  ok(!startsOnCircle(C, R, pointAt(C, 33, R + band * 0.99), opts.scale * 4), 'al ampliar, la banda en mm se estrecha');
  ok(startsOnCircle(C, R, pointAt(C, 33, R + band * 3), opts.scale / 4), 'al alejar, la banda en mm se ensancha');
}

console.log(`Guías OK: ${checks} comprobaciones (compás: proyección exacta, sentido, 0°/360°, vueltas, temblor, zona muerta, banda).`);
