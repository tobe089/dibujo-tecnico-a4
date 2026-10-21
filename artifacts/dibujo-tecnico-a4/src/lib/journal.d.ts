import type { Project } from './project.js';
import type { Store } from './storage.js';
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
export const JOURNAL_KEY: string;
export type JournalEntry = { projectId: string; baseRevision: number; at: string; project: unknown };
export function writeJournal(storage: KV, data: { project: Project; baseRevision: number }): 'ok' | 'demasiado-grande' | 'error';
export function readJournal(storage: KV): JournalEntry | null;
export function clearJournal(storage: KV, projectId?: string): void;
export function resolveJournal(store: Store, storage: KV): Promise<
  | { action: 'ninguna' | 'ilegible' | 'ya-guardada' }
  | { action: 'aplicada'; projectId: string }
  | { action: 'conflicto' | 'sin-proyecto'; project: Project; entry: JournalEntry }>;
