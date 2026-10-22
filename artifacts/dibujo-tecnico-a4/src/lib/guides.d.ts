import type { Pt } from './document.js';
export type CircleTrace = {
  c: Pt; r: number; dead: number;
  last: number | null; acc: number; min: number; max: number; minAngle: number | null; maxAngle: number | null;
};
export type TraceResult = { type: 'circle'; c: Pt; r: number } | { type: 'arc'; c: Pt; r: number; start: number; sweep: number } | null;
export const TRACE_BAND_PX: number;
export const CENTER_DEAD_PX: number;
export const MIN_TRACE_MM: number;
export const FULL_TURN_EPS_DEG: number;
export function startsOnCircle(c: Pt, r: number, p: Pt, scale: number, bandPx?: number): boolean;
export function createCircleTrace(c: Pt, r: number, options: { scale: number; deadPx?: number }): CircleTrace;
export function extendCircleTrace(t: CircleTrace, p: Pt): CircleTrace;
export function circleTraceSweep(t: CircleTrace): number;
export function circleTraceResult(t: CircleTrace): TraceResult;
export function traceCircle(c: Pt, r: number, points: Pt[], options: { scale: number; deadPx?: number }): TraceResult;
