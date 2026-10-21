// Pruebas del modelo de documento v2, la migración desde v1, el historial, el borrador parcial,
// la transformación de vista y la política de punteros. Solo Node: sin navegador ni dependencias.
import assert from 'node:assert/strict';
import { nearestOnSegment, pointAt, segmentAngle, segmentLength } from '../src/lib/geometry.js';
import {
  STORAGE_KEY_V1, STORAGE_KEY_V2, commitHistory, createHistory, distanceToEntity, entityBounds, entityInsideSheet,
  hitTest, loadFromStorage, migrateV1, parseDocument, redoHistory, removeEntities, sanitizeEntity, segmentWithAngle,
  segmentWithLength, serializeDocument, undoHistory, updateEntity,
} from '../src/lib/document.js';
import {
  arcSet, circleCapsuleCover, complementSet, eraseAlongPath, eraseEntity, intersectSets, segmentCapsuleInterval, unionSets,
} from '../src/lib/erase.js';
import { docToScreen, fitView, pinchView, screenToDoc, zoomAt } from '../src/lib/view.js';
import { PEN_PROXIMITY_MS, createPolicy, navPointers, penHover, pointerDown, pointerUp } from '../src/lib/pointer-policy.js';

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b} (±${eps})`);

// Generador pseudoaleatorio determinista (las pruebas deben dar siempre el mismo resultado).
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const rp = (lo = 10, hi = 190) => ({ x: lo + rnd() * (hi - lo), y: lo + rnd() * (hi - lo) });
let idn = 0;
const newId = () => `n${(idn += 1)}`;
const inCapsule = (X, P, Q, r) => nearestOnSegment(X, P, Q).dist - r;

// ───────── 1) Migración v1 → v2: sin pérdidas, coordenadas exactas, ids conservados ─────────
{
  const v1 = {
    strokes: [
      { id: 'L', kind: 'line', color: '#bc573f', width: 0.5, points: [{ x: 10.123456789, y: 20.987654321 }, { x: 60.5, y: 20.25 }] },
      { id: 'C', kind: 'circle', color: '#244d58', width: 0.45, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], meta: { center: { x: 105.1, y: 148.7 }, radius: 30.0001, startDeg: 12, sweepDeg: 360 } },
      { id: 'A', kind: 'arc', color: '#1e7663', width: 0.3, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], meta: { center: { x: 50, y: 60 }, radius: 8, startDeg: 350, sweepDeg: 45 } },
      { id: 'F', kind: 'free', color: '#252b2d', width: 0.6, points: [{ x: 5, y: 5, p: 0.3 }, { x: 6, y: 7, p: 0.8 }, { x: 8, y: 7.5 }] },
      { id: 'X', kind: 'arc', color: '#252b2d', width: 0.6, points: [{ x: 1, y: 1 }, { x: 3, y: 3 }] }, // arco sin meta → polilínea
      { id: 'P', kind: 'free', color: '#252b2d', width: 0.6, points: [{ x: 9, y: 9 }] },               // un solo punto → punto
      { id: 'bad', kind: 'line', points: [{ x: NaN, y: 1 }] },                                           // inutilizable
    ],
    margins: { top: 12, right: 10, bottom: 8, left: 15 }, color: '#bc573f', width: 0.7,
  };
  const { doc, dropped } = migrateV1(v1);
  ok(dropped === 1, 'se descarta solo el trazo inutilizable');
  const byId = Object.fromEntries(doc.entities.map((e) => [e.id, e]));
  ok(byId.L.type === 'segment' && byId.L.a.x === 10.123456789 && byId.L.a.y === 20.987654321 && byId.L.b.x === 60.5, 'línea → segmento exacto');
  ok(byId.C.type === 'circle' && byId.C.c.x === 105.1 && byId.C.r === 30.0001, 'círculo desde meta exacto');
  ok(byId.A.type === 'arc' && byId.A.start === 350 && byId.A.sweep === 45 && byId.A.r === 8, 'arco desde meta exacto');
  ok(byId.F.type === 'polyline' && byId.F.points.length === 3 && byId.F.points[1].p === 0.8 && byId.F.points[2].p === undefined, 'trazo libre con presión');
  ok(byId.X.type === 'polyline', 'arco sin meta se conserva como polilínea');
  ok(byId.P.type === 'point' && byId.P.x === 9, 'trazo de un punto → punto');
  ok(byId.L.color === '#bc573f' && byId.L.width === 0.5, 'estilo conservado');
  ok(doc.margins.left === 15 && doc.color === '#bc573f' && doc.width === 0.7 && doc.version === 2, 'márgenes y estilo del documento');
  // Ida y vuelta por JSON sin cambios.
  const again = parseDocument(serializeDocument(doc));
  ok(!again.migrated && again.dropped === 0, 'v2 se lee sin migrar');
  assert.deepEqual(again.doc, doc); checks += 1;

  // Carga desde almacenamiento: v1 se migra y NO se borra; v2 tiene prioridad.
  const store = new Map([[STORAGE_KEY_V1, JSON.stringify(v1)]]);
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null) };
  const loaded = loadFromStorage(storage);
  ok(loaded.migrated && loaded.source === 'v1' && loaded.doc.entities.length === 6, 'carga v1 migrando');
  ok(store.has(STORAGE_KEY_V1), 'el v1 original queda intacto');
  store.set(STORAGE_KEY_V2, serializeDocument({ ...loaded.doc, entities: loaded.doc.entities.slice(0, 2) }));
  ok(loadFromStorage(storage).doc.entities.length === 2 && loadFromStorage(storage).source === 'v2', 'v2 tiene prioridad');
  store.set(STORAGE_KEY_V2, '{dañado');
  ok(loadFromStorage(storage).source === 'v1', 'v2 dañado → se recurre a v1');
  ok(loadFromStorage({ getItem: () => null }).source === 'nuevo', 'sin datos → documento nuevo');
  assert.throws(() => parseDocument({ algo: 1 })); checks += 1;
}

// ───────── 2) Validación, consultas y edición ─────────
{
  ok(sanitizeEntity({ type: 'arc', c: { x: 1, y: 1 }, r: 1, start: 0, sweep: 360 }).type === 'circle', 'arco de 360° → círculo');
  ok(sanitizeEntity({ type: 'circle', c: { x: 1, y: 1 }, r: 0 }) === null, 'radio 0 no válido');
  ok(sanitizeEntity({ type: 'arc', c: { x: 1, y: 1 }, r: 2, start: -30, sweep: 10 }).start === 330, 'ángulo inicial normalizado');
  const arc = { id: 'a', type: 'arc', color: '#000000', width: 0.4, c: { x: 100, y: 100 }, r: 20, start: 80, sweep: 20 };
  const b = entityBounds(arc);
  near(b.minY, 80, 1e-12, 'caja del arco incluye el cuadrante de 90°');
  near(distanceToEntity({ x: 100, y: 70 }, arc), 10, 1e-12, 'distancia radial dentro del arco');
  const p1 = pointAt(arc.c, 100, 20);
  near(distanceToEntity(pointAt(arc.c, 180, 20), arc), Math.hypot(p1.x - 80, p1.y - 100), 1e-12, 'fuera del barrido → al extremo');
  ok(!entityInsideSheet({ type: 'circle', c: { x: 5, y: 100 }, r: 6 }), 'círculo que se sale de la hoja');

  const seg = { id: 's', type: 'segment', color: '#000000', width: 0.4, a: { x: 20.3, y: 40.7 }, b: { x: 90.1, y: 12.9 } };
  const list = [seg, arc];
  ok(hitTest({ x: 55, y: 26.9 }, list, 2)?.id === 's', 'hitTest elige el segmento');
  ok(hitTest({ x: 150, y: 250 }, list, 2) === null, 'hitTest vacío lejos');

  const ang = segmentAngle(seg.a, seg.b);
  const longer = updateEntity(list, 's', segmentWithLength(seg, 80));
  ok(!longer.error, 'cambiar longitud');
  const s2 = longer.entities[0];
  near(segmentLength(s2.a, s2.b), 80, 1e-12, 'longitud exacta'); near(segmentAngle(s2.a, s2.b), ang, 1e-9, 'ángulo intacto');
  ok(s2.a.x === seg.a.x && s2.a.y === seg.a.y, 'el inicio no se mueve');
  ok(updateEntity(list, 's', segmentWithAngle(seg, 37.25)).error, 'girar fuera de la hoja se rechaza');
  const rotated = updateEntity(list, 's', segmentWithAngle(seg, 322.75)).entities[0];
  near(segmentAngle(rotated.a, rotated.b), 322.75, 1e-9, 'ángulo exacto'); near(segmentLength(rotated.a, rotated.b), segmentLength(seg.a, seg.b), 1e-12, 'longitud intacta');
  const outside = updateEntity(list, 's', { b: { x: 300, y: 10 } });
  ok(outside.error && outside.entities === list, 'edición fuera de la hoja rechazada sin cambios');
  ok(removeEntities(list, ['s']).length === 1, 'eliminar por id');
}

// ───────── 3) Historial ─────────
{
  const e0 = [], e1 = ['a'], e2 = ['a', 'b'];
  let h = createHistory(e0);
  h = commitHistory(h, e1); h = commitHistory(h, e2);
  ok(h.present === e2 && h.past.length === 2, 'dos pasos');
  ok(commitHistory(h, e2) === h, 'sin cambios no crea paso');
  h = undoHistory(h); ok(h.present === e1 && h.future.length === 1, 'deshacer');
  h = undoHistory(h); ok(h.present === e0, 'deshacer 2');
  ok(undoHistory(h) === h, 'nada que deshacer');
  h = redoHistory(h); ok(h.present === e1, 'rehacer');
  h = commitHistory(h, ['c']); ok(h.future.length === 0, 'una edición nueva borra el rehacer');
  let big = createHistory(0);
  for (let i = 1; i <= 10; i += 1) big = commitHistory(big, i, 4);
  ok(big.past.length === 4 && big.past[0] === 6, 'límite del historial');
}

// ───────── 4) Conjuntos angulares ─────────
{
  assert.deepEqual(arcSet(350, 20), [[0, 10], [350, 360]]); checks += 1;
  assert.deepEqual(unionSets([[0, 10]], [[5, 20]], [[30, 40]]), [[0, 20], [30, 40]]); checks += 1;
  assert.deepEqual(intersectSets([[0, 100]], [[50, 150]]), [[50, 100]]); checks += 1;
  assert.deepEqual(complementSet([[10, 20], [300, 360]]), [[0, 10], [20, 300]]); checks += 1;
}

// ───────── 5) Cápsula exacta frente a fuerza bruta ─────────
for (let trial = 0; trial < 400; trial += 1) {
  const A = rp(), B = rp(), P = rp(), Q = trial % 5 === 0 ? P : rp(P.x - 30, P.x + 30), r = 0.2 + rnd() * 15;
  const iv = segmentCapsuleInterval(A, B, P, Q, r);
  for (let k = 0; k <= 400; k += 1) {
    const t = k / 400;
    const X = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
    const m = inCapsule(X, P, Q, r);
    if (Math.abs(m) < 1e-7) continue; // justo en el borde: cualquier lado es correcto
    const inside = !!iv && t >= iv[0] && t <= iv[1];
    ok(inside === m < 0, `segmento: t=${t} prueba ${trial}`);
  }
  const C = rp(40, 160), R = 0.5 + rnd() * 60;
  const cover = circleCapsuleCover(C, R, P, Q, r);
  for (let k = 0; k < 720; k += 1) {
    const th = k / 2;
    const X = pointAt(C, th, R);
    const m = inCapsule(X, P, Q, r);
    if (Math.abs(m) < 1e-7) continue;
    const inside = cover.some(([a, b]) => th >= a && th <= b);
    ok(inside === m < 0, `círculo: θ=${th} prueba ${trial}`);
  }
}

// ───────── 6) Borrado parcial: lo que queda está EXACTAMENTE sobre la geometría original ─────────
const style = { color: '#244d58', width: 0.45 };
/** Comprueba que: (a) todo lo que queda está sobre el original, (b) lo que queda está fuera de la cápsula,
 *  (c) cada punto del original fuera de la cápsula sigue cubierto por algún trozo. */
function checkErase(orig, pieces, P, Q, r, samplesOrig) {
  for (const piece of pieces) {
    ok(piece.color === orig.color && piece.width === orig.width, 'estilo heredado');
    for (const X of samplePoints(piece, 50)) {
      ok(distanceToEntity(X, orig) < 1e-9, `${orig.type}: trozo fuera del original`);
      ok(inCapsule(X, P, Q, r) > -1e-7, `${orig.type}: trozo dentro de la zona borrada`);
    }
  }
  for (const X of samplesOrig) {
    if (inCapsule(X, P, Q, r) > 1e-6) ok(pieces.some((pc) => distanceToEntity(X, pc) < 1e-9), `${orig.type}: se perdió geometría no borrada`);
  }
}
function samplePoints(e, n) {
  const out = [];
  for (let k = 0; k <= n; k += 1) {
    const t = k / n;
    if (e.type === 'segment') out.push({ x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t });
    else if (e.type === 'circle') out.push(pointAt(e.c, 360 * t, e.r));
    else if (e.type === 'arc') out.push(pointAt(e.c, e.start + e.sweep * t, e.r));
    else if (e.type === 'polyline') {
      const s = t * (e.points.length - 1), i = Math.min(e.points.length - 2, Math.floor(s)), u = s - i;
      out.push({ x: e.points[i].x + (e.points[i + 1].x - e.points[i].x) * u, y: e.points[i].y + (e.points[i + 1].y - e.points[i].y) * u });
    } else if (e.type === 'point') out.push({ x: e.x, y: e.y });
  }
  return out;
}
let cutCount = 0;
for (let trial = 0; trial < 300; trial += 1) {
  const P = rp(30, 170), Q = trial % 4 === 0 ? P : rp(P.x - 25, P.x + 25), r = 0.3 + rnd() * 6;
  const originals = [
    { id: 'seg', type: 'segment', ...style, a: rp(), b: rp() },
    { id: 'cir', type: 'circle', ...style, c: rp(50, 150), r: 2 + rnd() * 50 },
    { id: 'arc', type: 'arc', ...style, c: rp(50, 150), r: 2 + rnd() * 50, start: rnd() * 360, sweep: 1 + rnd() * 358 },
    { id: 'pl', type: 'polyline', ...style, points: Array.from({ length: 12 }, () => rp(20, 180)) },
  ];
  for (const orig of originals) {
    const res = eraseEntity(orig, P, Q, r, { newId });
    const pieces = res === null ? [orig] : res;
    if (res !== null && res.length && res[0].id === orig.id) cutCount += 1;
    checkErase(orig, pieces, P, Q, r, samplePoints(orig, 600));
    if (res && res.length) ok(res[0].id === orig.id && new Set(res.map((x) => x.id)).size === res.length, 'ids: primero conserva, resto nuevos');
  }
}
ok(cutCount > 100, `debe haber suficientes cortes reales en la muestra (${cutCount})`);

// Casos concretos con valores conocidos.
{
  const seg = { id: 's', type: 'segment', ...style, a: { x: 10, y: 50 }, b: { x: 110, y: 50 } };
  const res = eraseEntity(seg, { x: 60, y: 40 }, { x: 60, y: 60 }, 2, { newId });
  ok(res.length === 2, 'segmento cortado en dos');
  near(res[0].b.x, 58, 1e-12, 'corte izquierdo exacto'); near(res[1].a.x, 62, 1e-12, 'corte derecho exacto');
  ok(res[0].a.x === 10 && res[1].b.x === 110 && res[0].a.y === 50 && res[1].b.y === 50, 'extremos originales intactos');
  ok(eraseEntity(seg, { x: 60, y: 40 }, { x: 60, y: 60 }, 2, { mode: 'whole' }).length === 0, 'modo objeto completo');
  ok(eraseEntity(seg, { x: 60, y: 80 }, { x: 60, y: 90 }, 2) === null, 'sin contacto no cambia');

  const cir = { id: 'c', type: 'circle', ...style, c: { x: 100, y: 100 }, r: 30 };
  const cut = eraseEntity(cir, { x: 130, y: 100 }, { x: 130, y: 100 }, 3, { newId }); // toque en el ángulo 0°
  ok(cut.length === 1 && cut[0].type === 'arc', 'círculo → un arco');
  const alpha = Math.acos((30 * 30 + 30 * 30 - 9) / (2 * 30 * 30)) * 180 / Math.PI;
  near(cut[0].start, alpha, 1e-9, 'arco empieza justo donde acaba el borrado'); near(cut[0].sweep, 360 - 2 * alpha, 1e-9, 'barrido restante');
  ok(cut[0].c.x === 100 && cut[0].r === 30, 'mismo centro y radio exactos');
  const two = eraseAlongPath([cir], [{ x: 130, y: 100 }, { x: 70, y: 100 }], 1, { newId }); // atraviesa el diámetro horizontal
  ok(two.length === 2 && two.every((e) => e.type === 'arc'), 'círculo atravesado → dos arcos');

  const arc = { id: 'a', type: 'arc', ...style, c: { x: 100, y: 100 }, r: 20, start: 350, sweep: 40 }; // cruza 0°
  const am = eraseEntity(arc, { x: 120, y: 100 }, { x: 120, y: 100 }, 1, { newId });
  ok(am.length === 2, 'arco que cruza 0° cortado en dos');
  ok(Math.abs(am[0].start - 350) < 1e-12, 'primer trozo empieza en el inicio original');
  near(am[1].start + am[1].sweep, 390 - 360 + (am[1].start > 180 ? 360 : 0), 1e-9, 'segundo trozo acaba en el final original');

  const pt = { id: 'p', type: 'point', ...style, x: 50, y: 50 };
  ok(eraseEntity(pt, { x: 51, y: 50 }, { x: 51, y: 50 }, 1.5).length === 0, 'punto borrado');
  ok(eraseEntity(pt, { x: 53, y: 50 }, { x: 53, y: 50 }, 1.5) === null, 'punto intacto');

  const pl = { id: 'f', type: 'polyline', ...style, points: [{ x: 10, y: 10, p: 0.2 }, { x: 50, y: 10, p: 0.6 }, { x: 50, y: 50, p: 1 }] };
  const plc = eraseEntity(pl, { x: 30, y: 0 }, { x: 30, y: 20 }, 1, { newId });
  ok(plc.length === 2 && plc[0].points.length === 2 && plc[1].points.length === 3, 'polilínea cortada');
  near(plc[0].points[1].x, 29, 1e-12, 'corte exacto en polilínea'); near(plc[1].points[0].x, 31, 1e-12, 'reanuda exacto');
  near(plc[0].points[1].p, 0.2 + 0.4 * (19 / 40), 1e-12, 'presión interpolada');
  const all = [pl, cir];
  ok(eraseAlongPath(all, [{ x: 190, y: 280 }], 2) === all, 'sin cambios devuelve el mismo array');
}

// ───────── 7) Vista: conversión y zoom anclado ─────────
{
  const v = fitView(1000, 800, 24);
  near(v.scale, (800 - 48) / 297, 1e-12, 'encaja en alto');
  const a = docToScreen(v, 37.5, 210.25); const back = screenToDoc(v, a.x, a.y);
  near(back.x, 37.5, 1e-12, 'ida y vuelta x'); near(back.y, 210.25, 1e-12, 'ida y vuelta y');
  const anchor = { x: 640, y: 333 };
  const before = screenToDoc(v, anchor.x, anchor.y);
  const z = zoomAt(v, anchor.x, anchor.y, 3.7);
  const after = screenToDoc(z, anchor.x, anchor.y);
  near(after.x, before.x, 1e-9, 'zoom anclado x'); near(after.y, before.y, 1e-9, 'zoom anclado y'); near(z.scale, v.scale * 3.7, 1e-12, 'factor');
  const start = { view: v, a: { x: 400, y: 400 }, b: { x: 600, y: 400 } };
  const docMid = screenToDoc(v, 500, 400);
  const pv = pinchView(start, { x: 300, y: 500 }, { x: 700, y: 500 });
  near(pv.scale, v.scale * 2, 1e-12, 'pellizco ×2');
  const midNow = screenToDoc(pv, 500, 500);
  near(midNow.x, docMid.x, 1e-9, 'pellizco: el punto bajo los dedos sigue bajo los dedos (x)'); near(midNow.y, docMid.y, 1e-9, '(y)');
}

// ───────── 8) Política de punteros (rechazo de palma, dedo, pellizco) ─────────
{
  let pol = createPolicy('auto');
  ok(pointerDown(pol, { id: 1, type: 'touch', t: 0 }).role === 'draw', 'auto: el dedo dibuja si no hay lápiz');
  const second = pointerDown(pol, { id: 2, type: 'touch', t: 50 });
  ok(second.role === 'nav' && second.cancelDraw === 1, 'segundo dedo: pellizco y cancela el dibujo del primero');
  ok(navPointers(pol).length === 2, 'los dos dedos navegan');
  pointerUp(pol, 1, 100); pointerUp(pol, 2, 100);
  const pen = pointerDown(pol, { id: 3, type: 'pen', t: 1000 });
  ok(pen.role === 'draw', 'el lápiz dibuja');
  ok(pointerDown(pol, { id: 4, type: 'touch', t: 1100 }).role === 'ignore', 'palma con el lápiz apoyado: se ignora');
  pointerUp(pol, 3, 1200); pointerUp(pol, 4, 1200);
  ok(pointerDown(pol, { id: 5, type: 'touch', t: 1200 + PEN_PROXIMITY_MS - 1 }).role === 'ignore', 'palma justo tras levantar el lápiz: se ignora');
  pointerUp(pol, 5, 2000);
  ok(pointerDown(pol, { id: 6, type: 'touch', t: 5000 }).role === 'nav', 'auto: tras ver el lápiz, el dedo navega');
  pointerUp(pol, 6, 5100);
  penHover(pol, 6000);
  ok(pointerDown(pol, { id: 7, type: 'touch', t: 6100 }).role === 'ignore', 'lápiz sobrevolando: la palma se ignora');
  pointerUp(pol, 7, 6200);
  ok(pointerDown(pol, { id: 8, type: 'touch', t: 9000, width: 90, height: 70 }).role === 'ignore', 'contacto grande = palma');
  pointerUp(pol, 8, 9000);

  pol = createPolicy('auto');
  pointerDown(pol, { id: 1, type: 'touch', t: 0 });
  const p2 = pointerDown(pol, { id: 2, type: 'pen', t: 10 });
  ok(p2.role === 'draw' && p2.cancelDraw === 1, 'el lápiz cancela un dedo que estaba dibujando');
  pol = createPolicy('pen');
  pointerDown(pol, { id: 1, type: 'touch', t: 0 });
  const navStop = pointerDown(pol, { id: 2, type: 'pen', t: 10 });
  ok(navStop.stopNav && navPointers(pol).length === 0, 'al apoyar el lápiz se detiene la navegación con la palma');
  pol = createPolicy('all');
  pol.penSeen = true;
  ok(pointerDown(pol, { id: 1, type: 'touch', t: 99999 }).role === 'draw', "modo 'all': el dedo dibuja aunque haya lápiz");
  pol = createPolicy('pen');
  ok(pointerDown(pol, { id: 1, type: 'touch', t: 0 }).role === 'nav', "modo 'pen': el dedo solo navega");
  ok(pointerDown(createPolicy(), { id: 1, type: 'mouse', button: 0, t: 0 }).role === 'draw', 'ratón principal dibuja');
  ok(pointerDown(createPolicy(), { id: 1, type: 'mouse', button: 1, t: 0 }).role === 'nav', 'ratón central navega');
  ok(pointerDown(createPolicy(), { id: 1, type: 'pen', t: 0 }, { panTool: true }).role === 'nav', 'Desplazar: el lápiz navega');
}

console.log(`Documento OK: ${checks} comprobaciones (migración, edición, historial, borrador exacto, vista y punteros).`);
