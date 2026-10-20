export type PdfPoint = { x: number; y: number };
export type PdfStroke = { points: PdfPoint[]; color: string; width: number };
export type PdfMargins = { top: number; right: number; bottom: number; left: number };

export function createA4Pdf(strokes: PdfStroke[], margins: PdfMargins): Promise<Uint8Array>;
