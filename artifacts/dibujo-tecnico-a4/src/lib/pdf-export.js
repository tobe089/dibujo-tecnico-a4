import { LineCapStyle, PDFDocument, rgb } from 'pdf-lib';

const MM_TO_PT = 72 / 25.4;
const SHEET_WIDTH_MM = 210;
const SHEET_HEIGHT_MM = 297;
const toPoints = (millimeters) => millimeters * MM_TO_PT;

function colorFromHex(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '244d58';
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  );
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

export async function createA4Pdf(strokes, margins) {
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

  for (let x = 0; x <= SHEET_WIDTH_MM; x += 1) {
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
  for (let y = 0; y <= SHEET_HEIGHT_MM; y += 1) {
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
  if (left + right < SHEET_WIDTH_MM && top + bottom < SHEET_HEIGHT_MM) {
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

  for (const stroke of strokes) {
    const color = colorFromHex(stroke.color);
    const points = Array.isArray(stroke.points) ? stroke.points : [];
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) continue;
      page.drawLine({
        start: { x: toPoints(from.x), y: pageHeight - toPoints(from.y) },
        end: { x: toPoints(to.x), y: pageHeight - toPoints(to.y) },
        thickness: Math.max(0.01, toPoints(Number(stroke.width) || 0.45)),
        color,
        lineCap: LineCapStyle.Round,
      });
    }
  }

  return pdf.save();
}
