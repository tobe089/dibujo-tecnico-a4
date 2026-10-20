export type GPoint = { x: number; y: number };
export type SnapKind = 'extremo' | 'medio' | 'centro' | 'cuadrante' | 'cuadricula' | null;
export type SnapTarget = GPoint & { kind: Exclude<SnapKind, 'cuadricula' | null> };
export type SnapResult = GPoint & { kind: SnapKind };
export type GStroke = {
  points: GPoint[];
  kind?: string;
  width?: number;
  meta?: { center?: GPoint; radius?: number; startDeg?: number; sweepDeg?: number };
};

export const SHEET_W: number;
export const SHEET_H: number;
export const CURVE_TOLERANCE_MM: number;

export function normalizeDeg(angle: number): number;
export function dirFromAngle(deg: number): GPoint;
export function pointAt(origin: GPoint, deg: number, length: number): GPoint;
export function segmentLength(a: GPoint, b: GPoint): number;
export function segmentAngle(a: GPoint, b: GPoint): number;
export function unitVector(a: GPoint, b: GPoint): (GPoint & { len: number }) | null;
export function roundTo(value: number, decimals: number): number;

export function arcStepRad(radius: number, tol?: number): number;
export function arcPoints(center: GPoint, radius: number, startDeg: number, sweepDeg: number, tol?: number): GPoint[];
export function sweepBetween(startDeg: number, endDeg: number): number;

export function nearestOnSegment(p: GPoint, a: GPoint, b: GPoint): { point: GPoint; t: number; dist: number };
export function distanceToPolyline(p: GPoint, pts: GPoint[]): number;
export function findStrokeAt<T extends GStroke>(p: GPoint, strokes: T[], tolMm: number, filter?: (s: T) => boolean): T | null;
export function pointsInsideSheet(points: GPoint[], eps?: number): boolean;

export function collectSnapTargets(strokes: GStroke[]): SnapTarget[];
export function snapPoint(p: GPoint, targets: SnapTarget[], tolMm: number, gridStep: number): SnapResult;

export function relatedLine(args: {
  ref0: GPoint; ref1: GPoint; mode: 'parallel' | 'perpendicular'; through: GPoint;
  length: number; placement: 'start' | 'center' | 'foot'; flip: boolean;
}): [GPoint, GPoint] | null;
export function offsetLine(ref0: GPoint, ref1: GPoint, distance: number, flip: boolean): [GPoint, GPoint] | null;

export function angleConstruction(
  vertex: GPoint, baseDeg: number, angleDeg: number, cw: boolean, rayLength: number, markRadius: number,
): { baseDeg: number; rayDeg: number; baseEnd: GPoint; rayEnd: GPoint; arcStartDeg: number; sweepDeg: number; markRadius: number };
export function angleBetweenDeg(vertex: GPoint, a: GPoint, b: GPoint): number;
