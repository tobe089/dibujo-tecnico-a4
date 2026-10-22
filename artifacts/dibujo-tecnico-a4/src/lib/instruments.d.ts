export type Pose = { x: number; y: number; rotation: number };
export type InstrumentState = { visible: boolean; [k: string]: unknown };
export type ProtractorState = {
  visible: boolean; pose: Pose | null; angle: number; cw: boolean; rayLength: number; baseRay: boolean; mark: boolean;
};
export type CompassState = { visible: boolean; pose: Pose | null; radius: number; trace: boolean };
export type Instruments = { ruler: InstrumentState; compass: CompassState; protractor: ProtractorState };
export const PROTRACTOR_DEFAULTS: Readonly<ProtractorState>;
export const COMPASS_DEFAULTS: Readonly<CompassState>;
export const COMPASS_MAX_RADIUS: number;
export function defaultInstruments(): Instruments;
export function sanitizePose(p: unknown): Pose | null;
export function sanitizeProtractor(p: unknown): ProtractorState;
export function sanitizeCompass(p: unknown): CompassState;
export function sanitizeInstruments(ins: unknown): Instruments;
