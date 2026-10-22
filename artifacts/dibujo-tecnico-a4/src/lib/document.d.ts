export type Pt = { x: number; y: number };
export type PressurePt = Pt & { p?: number };
type Base = { id: string; color: string; width: number };
export type PointEntity = Base & { type: 'point'; x: number; y: number };
export type SegmentEntity = Base & { type: 'segment'; a: Pt; b: Pt };
export type CircleEntity = Base & { type: 'circle'; c: Pt; r: number };
export type ArcEntity = Base & { type: 'arc'; c: Pt; r: number; start: number; sweep: number };
export type PolylineEntity = Base & { type: 'polyline'; points: PressurePt[] };
export type Entity = PointEntity | SegmentEntity | CircleEntity | ArcEntity | PolylineEntity;
export type EntityType = Entity['type'];
/** Entidad sin id ni estilo, tal como la produce una herramienta. */
export type EntityPatch = Partial<Omit<PointEntity, 'type' | 'id'>> & Partial<Omit<SegmentEntity, 'type' | 'id'>> &
  Partial<Omit<CircleEntity, 'type' | 'id'>> & Partial<Omit<ArcEntity, 'type' | 'id'>> & Partial<Omit<PolylineEntity, 'type' | 'id'>>;
export type Margins = { top: number; right: number; bottom: number; left: number };
export type Doc = { version: 2; entities: Entity[]; margins: Margins; color: string; width: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type History<T> = { past: T[]; present: T; future: T[] };

export const DOC_VERSION: 2;
export const STORAGE_KEY_V1: string;
export const STORAGE_KEY_V2: string;
export const DEFAULT_COLOR: string;
export const DEFAULT_WIDTH: number;
export const DEFAULT_MARGINS: Margins;
export const ENTITY_TYPES: EntityType[];
export const HISTORY_LIMIT: number;

export function makeId(): string;
export function sanitizeEntity(e: unknown): Entity | null;
export function createDocument(): Doc;
export function migrateStrokeV1(s: unknown): Entity | null;
export function migrateV1(v1: unknown): { doc: Doc; dropped: number };
export function parseDocument(data: unknown): { doc: Doc; migrated: boolean; dropped: number };
export function loadFromStorage(storage: { getItem(key: string): string | null }): { doc: Doc; migrated: boolean; dropped: number; source: 'v1' | 'v2' | 'nuevo' };
export function serializeDocument(doc: Doc): string;

export function arcEndpoints(e: ArcEntity): { p0: Pt; p1: Pt };
export function entityBounds(e: Entity): Bounds;
import type { Sheet } from './geometry.js';
export function entityInsideSheet(e: Entity, eps?: number, sheet?: Sheet): boolean;
export function pointInsideSheet(p: Pt, sheet?: Sheet): boolean;
export const SHEET_MIN_MM: number;
export function entityIntersectsSheet(e: Entity, sheet?: Sheet): boolean;
export function distanceToEntity(p: Pt, e: Entity): number;
export function hitTest(p: Pt, entities: Entity[], tolMm: number, filter?: (e: Entity) => boolean): Entity | null;
export function entityLength(e: Entity): number;

export function addEntities(entities: Entity[], added: Entity[]): Entity[];
export function removeEntities(entities: Entity[], ids: string[]): Entity[];
export function updateEntity(entities: Entity[], id: string, patch: EntityPatch, sheet?: Sheet): { entities: Entity[]; error: string | null };
export function segmentWithLength(e: SegmentEntity, length: number): { b: Pt };
export function segmentWithAngle(e: SegmentEntity, angleDeg: number): { b: Pt };

export function createHistory<T>(present: T): History<T>;
export function commitHistory<T>(h: History<T>, next: T, limit?: number): History<T>;
export function undoHistory<T>(h: History<T>): History<T>;
export function redoHistory<T>(h: History<T>): History<T>;
