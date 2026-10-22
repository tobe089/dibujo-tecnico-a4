import type { Entity, Margins } from './document.js';
import type { Orientation, Sheet } from './geometry.js';
import type { Instruments } from './instruments.js';
export type { InstrumentState, Instruments, Pose, ProtractorState } from './instruments.js';
export type ProjectView = { center: { x: number; y: number }; zoom: number; rotation: number };
export type Project = {
  format: string; version: 3; id: string; name: string; createdAt: string; modifiedAt: string; revision: number;
  sheet: { size: 'A4'; orientation: Orientation; margins: Margins; grid: { visible: boolean } };
  style: { color: string; width: number };
  entities: Entity[]; instruments: Instruments; view: ProjectView | null; selection: string[];
};
export type IndexRecord = {
  id: string; name: string; createdAt: string; modifiedAt: string; revision: number; orientation: Orientation;
  entityCount: number; openedAt: string | null; thumbnail: string | null;
};
export const PROJECT_FORMAT: string;
export const PROJECT_VERSION: 3;
export const LEGACY_PROJECT_ID: string;
export const ORIENTATIONS: Orientation[];
export function defaultInstruments(): Instruments;
export function createProject(opts?: { name?: string; orientation?: Orientation; id?: string; now?: string }): Project;
export function projectSheet(project: Project): Sheet;
export function serializeProject(project: Project): unknown;
export function projectToJson(project: Project): string;
export function filterSelection(ids: unknown, entities: Entity[]): string[];
export function projectFromDocV2(doc: unknown, opts?: { name?: string; id?: string; now?: string }): Project;
export function parseProject(data: unknown, opts?: { now?: string; id?: string }): { project: Project; source: 'v1' | 'v2' | 'v3'; dropped: number; selectionDropped: number };
export function entitiesOutsideSheet(entities: Entity[], orientation: Orientation): number;
export function indexRecordFor(project: Project, extra?: { openedAt?: string | null; thumbnail?: string | null }): IndexRecord;
