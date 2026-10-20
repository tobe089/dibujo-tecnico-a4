import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { createA4Pdf } from '../src/lib/pdf-export.js';
import { arcPoints } from '../src/lib/geometry.js';

const bytes = await createA4Pdf(
  [{ color: '#244d58', width: 0.5, points: [{ x: 10, y: 20 }, { x: 60, y: 20 }] }],
  { top: 10, right: 10, bottom: 10, left: 10 },
);
const parsed = await PDFDocument.load(bytes);
const pages = parsed.getPages();
assert.equal(pages.length, 1, 'El PDF debe tener exactamente una página.');

const millimetersPerPoint = 25.4 / 72;
const size = pages[0].getSize();
assert.ok(Math.abs(size.width * millimetersPerPoint - 210) < 0.001, 'El ancho debe ser 210 mm.');
assert.ok(Math.abs(size.height * millimetersPerPoint - 297) < 0.001, 'El alto debe ser 297 mm.');

assert.ok(pages[0].node.Contents(), 'La página debe contener trazos vectoriales.');
const serialized = new TextDecoder().decode(bytes);
assert.ok(!serialized.includes('/Subtype /Image'), 'El PDF no debe contener una captura o imagen rasterizada.');

const contentRef = pages[0].node.Contents().get(0);
const contentStream = parsed.context.lookup(contentRef);
const content = new TextDecoder().decode(inflateSync(contentStream.contents));
const moves = [...content.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+m/g)];
const lines = [...content.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+l/g)];
assert.ok(moves.length && lines.length, 'El PDF debe tener operaciones vectoriales de línea.');

const finalMove = moves[moves.length - 1];
const finalLine = lines[lines.length - 1];
const strokeLengthPt = Math.hypot(
  Number(finalLine[1]) - Number(finalMove[1]),
  Number(finalLine[2]) - Number(finalMove[2]),
);
const strokeLengthMm = strokeLengthPt * millimetersPerPoint;
assert.ok(Math.abs(strokeLengthMm - 50) < 0.001, `La línea de prueba debe medir 50 mm; mide ${strokeLengthMm}.`);
const startXmm = Number(finalMove[1]) * millimetersPerPoint;
const startYmm = 297 - Number(finalMove[2]) * millimetersPerPoint;
assert.ok(Math.abs(startXmm - 10) < 0.001, `La posición X debe ser 10 mm; mide ${startXmm}.`);
assert.ok(Math.abs(startYmm - 20) < 0.001, `La posición Y debe ser 20 mm; mide ${startYmm}.`);
console.log(`PDF verificado: A4 ${size.width.toFixed(3)} × ${size.height.toFixed(3)} pt y segmento vectorial de ${strokeLengthMm.toFixed(3)} mm; sin imagen raster.`);

// ── Circunferencia en el PDF: todos los puntos deben quedar a r mm del centro (coordenadas del PDF → mm) ──
{
  const center = { x: 105, y: 148.5 };
  const radius = 30;
  const circle = arcPoints(center, radius, 0, 360);
  const circleBytes = await createA4Pdf(
    [{ color: '#bc573f', width: 0.5, points: circle }],
    { top: 10, right: 10, bottom: 10, left: 10 },
  );
  const circleDoc = await PDFDocument.load(circleBytes);
  const circleRef = circleDoc.getPages()[0].node.Contents().get(0);
  const circleContent = new TextDecoder().decode(inflateSync(circleDoc.context.lookup(circleRef).contents));
  const circleMoves = [...circleContent.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+m/g)];
  const segments = circle.length - 1;
  assert.ok(circleMoves.length >= segments, 'Faltan segmentos de la circunferencia en el PDF.');
  const cx = center.x;
  const cy = center.y;
  for (const move of circleMoves.slice(-segments)) {
    const xMm = Number(move[1]) * millimetersPerPoint;
    const yMm = 297 - Number(move[2]) * millimetersPerPoint;
    const distance = Math.hypot(xMm - cx, yMm - cy);
    assert.ok(Math.abs(distance - radius) < 0.001, `Un punto de la circunferencia está a ${distance} mm del centro (esperado ${radius}).`);
  }
  console.log(`PDF verificado: circunferencia de r = ${radius} mm con ${segments} segmentos vectoriales, todos a r ± 0,001 mm del centro.`);
}
