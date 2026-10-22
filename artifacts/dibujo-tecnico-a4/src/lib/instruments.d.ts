export type Pose = { x: number; y: number; rotation: number };
export type InstrumentState = { visible: boolean; [k: string]: unknown };
export type ProtractorState = {
  visible: boolean; pose: Pose | null; angle: number; cw: boolean; rayLength: number; baseRay: boolean; mark: boolean;
};
export type Instruments = { ruler: InstrumentState; compass: InstrumentState; protractor: ProtractorState };
export const PROTRACTOR_DEFAULTS: Readonly<ProtractorState>;
export function defaultInstruments(): Instruments;
export function sanitizePose(p: unknown): Pose | null;
export function sanitizeProtractor(p: unknown): ProtractorState;
export function sanitizeInstruments(ins: unknown): Instruments;
