import type { IndexRecord, Project } from './project.js';
import type { Orientation } from './geometry.js';
export const DB_NAME: string;
export const DB_VERSION: number;
export const LEGACY_SETTING: string;
export class ConflictError extends Error { storedRevision: number | null; reason: string; }
export class StorageError extends Error { kind: string; cause?: unknown; }
export function toStorageError(err: unknown): Error;
export type MigrationResult = { status: 'migrado' | 'ya-migrado' | 'sin-datos' | 'fallido'; projectId?: string | null; dropped?: number; count?: number; source?: string; key?: string; error?: string; raw?: string };
export type Store = {
  db: IDBDatabase; close(): void;
  list(): Promise<IndexRecord[]>;
  load(id: string): Promise<Project>;
  create(project: Project, opts?: { thumbnail?: string | null }): Promise<IndexRecord>;
  save(project: Project, expectedRevision: number, opts?: { thumbnail?: string | null }): Promise<{ revision: number; modifiedAt: string }>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string, name?: string): Promise<IndexRecord>;
  remove(id: string): Promise<void>;
  touchOpened(id: string): Promise<void>;
  setThumbnail(id: string, thumbnail: string | null): Promise<void>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  migrateLegacy(storage: { getItem(k: string): string | null } | null): Promise<MigrationResult>;
  importJson(text: string, opts?: { name?: string }): Promise<{ record: IndexRecord; dropped: number }>;
  newProject(opts?: { name?: string; orientation?: Orientation }): Promise<IndexRecord>;
};
export function openStore(opts?: { indexedDB?: IDBFactory; name?: string; now?: () => string }): Promise<Store>;
