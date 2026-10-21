import {
  LineCapStyle, LineJoinStyle, PDFDocument, appendBezierCurve, closePath, fill, lineTo, moveTo, popGraphicsState,
  pushGraphicsState, rgb, setFillingRgbColor, setLineCap, setLineJoin, setLineWidth, setStrokingRgbColor, stroke,
} from 'pdf-lib';
import { arcToBeziers, sheetFor } from './geometry.js';

const MM_TO_PT = 72 / 25.4;
const toPoints = (millimeters) => millimeters * MM_TO_PT;

function rgbParts(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '244d58';
  return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255);
}
function colorFromHex(hex) {
  return rgb(...rgbParts(hex));
}

function drawLine(page, start, end, widthMm, color, dashArray) {
  page.drawLine({
    start,
    end,
    thickness: Math.max(0.01, toPoints(widthMm)),
    color: colorFromHex(color),
    lineCap: LineCapStyle.Round,
    ...(dashArray ? { dashArray: dashArray.map(toPoints) } : {}),
  });
}

/** Operadores PDF de una entidad: un único trazado continuo; arcos y círculos como curvas de Bézier. */
export function entityOperators(entity, pageHeight) {
  const X = (mm) => toPoints(mm);
  const Y = (mm) => pageHeight - toPoints(mm);
  const path = [];
  const beziers = (center, radius, start, sweep) => {
    const list = arcToBeziers(center, radius, start, sweep);
    path.push(moveTo(X(list[0].p0.x), Y(list[0].p0.y)));
    for (const b of list) path.push(appendBezierCurve(X(b.c1.x), Y(b.c1.y), X(b.c2.x), Y(b.c2.y), X(b.p3.x), Y(b.p3.y)));
  };
  const finite = (...v) => v.every(Number.isFinite);
  let filled = false;
  switch (entity.type) {
    case 'segment':
      if (!finite(entity.a.x, entity.a.y, entity.b.x, entity.b.y)) return [];
      path.push(moveTo(X(entity.a.x), Y(entity.a.y)), lineTo(X(entity.b.x), Y(entity.b.y)));
      break;
    case 'circle':
      if (!finite(entity.c.x, entity.c.y, entity.r)) return [];
      beziers(entity.c, entity.r, 0, 360);
      path.push(closePath());
      break;
    case 'arc':
      if (!finite(entity.c.x, entity.c.y, entity.r, entity.start, entity.sweep)) return [];
      beziers(entity.c, entity.r, entity.start, entity.sweep);
      break;
    case 'polyline': {
      const pts = (entity.points || []).filter((p) => finite(p.x, p.y));
      if (!pts.length) return [];
      path.push(moveTo(X(pts[0].x), Y(pts[0].y)));
      if (pts.length === 1) path.push(lineTo(X(pts[0].x), Y(pts[0].y)));
      for (let i = 1; i < pts.length; i += 1) path.push(lineTo(X(pts[i].x), Y(pts[i].y)));
      break;
    }
    case 'point':
      if (!finite(entity.x, entity.y)) return [];
      beziers({ x: entity.x, y: entity.y }, Math.max(0.35, (Number(entity.width) || 0.45) * 1.1), 0, 360);
      path.push(closePath());
      filled = true;
      break;
    default:
      return [];
  }
  const [r, g, b] = rgbParts(entity.color);
  return [
    pushGraphicsState(),
    filled ? setFillingRgbColor(r, g, b) : setStrokingRgbColor(r, g, b),
    setLineWidth(Math.max(0.01, toPoints(Number(entity.width) || 0.45))),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
    ...path,
    filled ? fill() : stroke(),
    popGraphicsState(),
  ];
}

/**
 * PDF de una página A4 exacta (vertical u horizontal) con la cuadrícula, la guía de márgenes y las entidades
 * en milímetros reales. La orientación solo cambia el tamaño de la página: las coordenadas no se transforman.
 */
export async function createA4Pdf(entities, margins, { grid = true, orientation = 'portrait' } = {}) {
  const sheet = sheetFor(orientation);
  const SHEET_WIDTH_MM = sheet.w;
  const SHEET_HEIGHT_MM = sheet.h;
  const pdf = await PDFDocument.create();
  const pageWidth = toPoints(SHEET_WIDTH_MM);
  const pageHeight = toPoints(SHEET_HEIGHT_MM);
  const page = pdf.addPage([pageWidth, pageHeight]);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    color: rgb(1, 1, 1),
  });

  for (let x = 0; grid && x <= SHEET_WIDTH_MM; x += 1) {
    const isTen = x % 10 === 0;
    const isFive = x % 5 === 0;
    drawLine(
      page,
      { x: toPoints(x), y: 0 },
      { x: toPoints(x), y: pageHeight },
      isTen ? 0.2 : isFive ? 0.14 : 0.09,
      isTen ? '#a9b8bb' : isFive ? '#d0dadd' : '#e8edef',
    );
  }
  for (let y = 0; grid && y <= SHEET_HEIGHT_MM; y += 1) {
    const isTen = y % 10 === 0;
    const isFive = y % 5 === 0;
    drawLine(
      page,
      { x: 0, y: toPoints(y) },
      { x: pageWidth, y: toPoints(y) },
      isTen ? 0.2 : isFive ? 0.14 : 0.09,
      isTen ? '#a9b8bb' : isFive ? '#d0dadd' : '#e8edef',
    );
  }

  const left = Math.max(0, Math.min(40, Number(margins.left) || 0));
  const right = Math.max(0, Math.min(40, Number(margins.right) || 0));
  const top = Math.max(0, Math.min(40, Number(margins.top) || 0));
  const bottom = Math.max(0, Math.min(40, Number(margins.bottom) || 0));
  if (grid && left + right < SHEET_WIDTH_MM && top + bottom < SHEET_HEIGHT_MM) {
    const x1 = toPoints(left);
    const x2 = toPoints(SHEET_WIDTH_MM - right);
    const y1 = toPoints(bottom);
    const y2 = toPoints(SHEET_HEIGHT_MM - top);
    const guide = '#85b8a6';
    const dash = [1.3, 1.1];
    drawLine(page, { x: x1, y: y1 }, { x: x2, y: y1 }, 0.22, guide, dash);
    drawLine(page, { x: x2, y: y1 }, { x: x2, y: y2 }, 0.22, guide, dash);
    drawLine(page, { x: x2, y: y2 }, { x: x1, y: y2 }, 0.22, guide, dash);
    drawLine(page, { x: x1, y: y2 }, { x: x1, y: y1 }, 0.22, guide, dash);
  }

  for (const entity of entities) {
    const ops = entityOperators(entity, pageHeight);
    if (ops.length) page.pushOperators(...ops);
  }

  return pdf.save();
}
