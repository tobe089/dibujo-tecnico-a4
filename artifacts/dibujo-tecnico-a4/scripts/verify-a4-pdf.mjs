// Verifica el PDF generado leyendo su contenido real: tamaño A4, posiciones en mm y curvas exactas.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { createA4Pdf } from '../src/lib/pdf-export.js';
import { bezierPoint, pointAt } from '../src/lib/geometry.js';

const MM_PER_PT = 25.4 / 72;
const margins = { top: 10, right: 10, bottom: 10, left: 10 };
const style = { color: '#244d58', width: 0.5 };

async function contentOf(bytes) {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const contents = pages[0].node.Contents();
  let text = '';
  for (let i = 0; i < contents.size(); i += 1) {
    const stream = doc.context.lookup(contents.get(i));
    text += new TextDecoder().decode(inflateSync(stream.contents)) + '\n';
  }
  return { doc, pages, text };
}
const num = '(-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?)';
/** Trazados (cada uno = lista de operaciones en mm de hoja) entre 'q' y 'Q' que terminan en S (trazo) o f (relleno). */
function pathsOf(text) {
  const toMm = (x, y) => ({ x: Number(x) * MM_PER_PT, y: 297 - Number(y) * MM_PER_PT });
  const out = [];
  const re = new RegExp(`${num} ${num} m|${num} ${num} l|${num} ${num} ${num} ${num} ${num} ${num} c|\\bh\\b|\\bS\\b|\\bf\\b`, 'g');
  let current = null;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) { current = [{ op: 'm', p: toMm(m[1], m[2]) }]; continue; }
    if (!current) continue;
    if (m[3] !== undefined) current.push({ op: 'l', p: toMm(m[3], m[4]) });
    else if (m[5] !== undefined) current.push({ op: 'c', c1: toMm(m[5], m[6]), c2: toMm(m[7], m[8]), p: toMm(m[9], m[10]) });
    else if (m[0] === 'S' || m[0] === 'f') { out.push({ ops: current, kind: m[0] }); current = null; }
  }
  return out;
}

// 1) Página A4 exacta, sin imágenes raster, con un segmento de 50 mm en su sitio.
const segBytes = await createA4Pdf([{ id: 's', type: 'segment', ...style, a: { x: 10, y: 20 }, b: { x: 60, y: 20 } }], margins);
const seg = await contentOf(segBytes);
assert.equal(seg.pages.length, 1, 'El PDF debe tener exactamente una página.');
const size = seg.pages[0].getSize();
assert.ok(Math.abs(size.width * MM_PER_PT - 210) < 0.001, 'El ancho debe ser 210 mm.');
assert.ok(Math.abs(size.height * MM_PER_PT - 297) < 0.001, 'El alto debe ser 297 mm.');
assert.ok(!new TextDecoder().decode(segBytes).includes('/Subtype /Image'), 'El PDF no debe contener imágenes raster.');
const segPath = pathsOf(seg.text).at(-1).ops;
assert.equal(segPath.length, 2, 'El segmento es un único trazado de dos puntos.');
const segLen = Math.hypot(segPath[1].p.x - segPath[0].p.x, segPath[1].p.y - segPath[0].p.y);
assert.ok(Math.abs(segLen - 50) < 1e-6, `La línea debe medir 50 mm; mide ${segLen}.`);
assert.ok(Math.abs(segPath[0].p.x - 10) < 1e-6 && Math.abs(segPath[0].p.y - 20) < 1e-6, 'Posición del segmento.');
console.log(`PDF verificado: A4 ${size.width.toFixed(3)} × ${size.height.toFixed(3)} pt; segmento de ${segLen.toFixed(6)} mm en (10, 20); sin imagen raster.`);

// 2) Circunferencia y arco como curvas de Bézier: cada punto muestreado a r ± 0,0005 mm del centro.
const center = { x: 105, y: 148.5 };
const geoBytes = await createA4Pdf([
  { id: 'c', type: 'circle', ...style, c: center, r: 30 },
  { id: 'a', type: 'arc', ...style, c: center, r: 80, start: 350, sweep: 100 },
  { id: 'f', type: 'polyline', ...style, points: [{ x: 20, y: 250 }, { x: 25.5, y: 251.25 }, { x: 31, y: 249 }] },
  { id: 'p', type: 'point', ...style, x: 150, y: 30 },
], margins);
const geo = pathsOf((await contentOf(geoBytes)).text).slice(-4);
function radialError(path, r) {
  let maxErr = 0, prev = path[0].p;
  for (const op of path.slice(1)) {
    if (op.op !== 'c') continue;
    for (let t = 0; t <= 1; t += 1 / 32) {
      const q = bezierPoint({ p0: prev, c1: op.c1, c2: op.c2, p3: op.p }, t);
      maxErr = Math.max(maxErr, Math.abs(Math.hypot(q.x - center.x, q.y - center.y) - r));
    }
    prev = op.p;
  }
  return maxErr;
}
const circleErr = radialError(geo[0].ops, 30);
assert.ok(geo[0].ops.filter((o) => o.op === 'c').length >= 24, 'La circunferencia se dibuja con curvas de Bézier.');
assert.ok(circleErr < 0.0005, `Error radial de la circunferencia: ${circleErr} mm.`);
const arcErr = radialError(geo[1].ops, 80);
assert.ok(arcErr < 0.0005, `Error radial del arco: ${arcErr} mm.`);
const a0 = pointAt(center, 350, 80), a1 = pointAt(center, 90, 80);
assert.ok(Math.hypot(geo[1].ops[0].p.x - a0.x, geo[1].ops[0].p.y - a0.y) < 1e-6, 'El arco empieza en 350°.');
assert.ok(Math.hypot(geo[1].ops.at(-1).p.x - a1.x, geo[1].ops.at(-1).p.y - a1.y) < 1e-6, 'El arco termina en 90°.');
assert.equal(geo[2].ops.length, 3, 'El trazo libre es un único trazado continuo.');
assert.ok(Math.abs(geo[2].ops[1].p.x - 25.5) < 1e-6 && Math.abs(geo[2].ops[1].p.y - 251.25) < 1e-6, 'Vértice del trazo libre.');
assert.equal(geo[3].kind, 'f', 'El punto se dibuja relleno.');
console.log(`PDF verificado: circunferencia r = 30 mm (error radial máx. ${circleErr.toExponential(2)} mm), arco r = 80 mm de 350° a 90° (error ${arcErr.toExponential(2)} mm), trazo libre y punto.`);

// 3) Opción sin cuadrícula: solo queda la entidad.
const bare = pathsOf((await contentOf(await createA4Pdf([{ id: 's', type: 'segment', ...style, a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }], margins, { grid: false }))).text);
const strokedPaths = bare.filter((p) => p.kind === 'S');
assert.equal(strokedPaths.length, 1, `Sin cuadrícula debe haber un único trazo (hay ${strokedPaths.length}).`);
assert.ok(bare.every((p) => p.kind === 'S' || p.kind === 'f' && p.ops.length === 4), 'Lo demás es solo el fondo blanco.');
console.log('PDF verificado: la opción sin cuadrícula ni márgenes deja solo el dibujo.');
