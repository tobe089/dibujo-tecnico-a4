export type FingerMode = 'auto' | 'pen' | 'all';
export type Role = 'draw' | 'nav' | 'ignore';
export type Policy = { pointers: Map<number, { type: string; role: Role }>; penSeen: boolean; penLastSeen: number; fingerMode: FingerMode };
export const PEN_PROXIMITY_MS: number;
export const PALM_SIZE_PX: number;
export const TAP_SLOP_PX: { pen: number; mouse: number; touch: number };
export const PAN_SLOP_PX: number;
export function beyondTapSlop(pointerType: string, start: { x: number; y: number }, current: { x: number; y: number }): boolean;
export function shouldRevertNav(navStartT: number, penDownT: number): boolean;
export function cancelOutcome(tool: string, pointerType: string, pointCount: number): 'keep' | 'discard';
export function createPolicy(fingerMode?: FingerMode): Policy;
export function fingerDraws(policy: Policy): boolean;
export function pointerDown(
  policy: Policy,
  ev: { id: number; type: string; t: number; button?: number; width?: number; height?: number },
  ctx?: { panTool?: boolean },
): { role: Role; cancelDraw: number | null; stopNav: boolean };
export function penHover(policy: Policy, t: number): void;
export function roleOf(policy: Policy, id: number): Role | null;
export function pointerUp(policy: Policy, id: number, t: number): Role | null;
export function navPointers(policy: Policy): number[];
