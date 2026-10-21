export const DELAY_MS: number;
export const PERIOD_MS: number;
export type SaveStatus = { status: 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'; message: string };
export type SaveManager = {
  changed(): void; flush(): Promise<void>; markConflict(message: string): void; resetClean(): void; isDirty(): boolean; isSaving(): boolean; getState(): SaveStatus; dispose(): void;
};
export function createSaveManager(opts: {
  write: () => Promise<unknown>; onStatus?: (s: SaveStatus) => void; delayMs?: number; periodMs?: number;
  setTimer?: (f: () => void, ms: number) => unknown; clearTimer?: (h: unknown) => void;
  setRepeat?: (f: () => void, ms: number) => unknown; clearRepeat?: (h: unknown) => void;
}): SaveManager;
