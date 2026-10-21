// Copia de emergencia al cerrar u ocultar la página. Sin DOM salvo el `storage` inyectado (localStorage).
//
// Por qué existe: una escritura en IndexedDB es asíncrona y el navegador NO garantiza que termine si la página
// se cierra o Android la congela. localStorage, en cambio, escribe de forma síncrona: si setItem vuelve sin
// error, el dato está guardado. Al ocultarse la página con cambios sin confirmar se copia ahí el proyecto.
// Límite conocido: localStorage admite ~5 millones de caracteres en Chrome; un proyecto mayor no cabe y
// solo queda el intento asíncrono de IndexedDB (se informa con 'demasiado-grande').

import { parseProject, projectToJson } from './project.js';

export const JOURNAL_KEY = 'dibujo-tecnico-a4-pendiente';

/** Escribe la copia de forma síncrona. Devuelve 'ok' | 'demasiado-grande' | 'error'. */
export function writeJournal(storage, { project, baseRevision }) {
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify({ projectId: project.id, baseRevision, at: new Date().toISOString(), project: JSON.parse(projectToJson(project)) }));
    return 'ok';
  } catch (e) {
    try { storage.removeItem(JOURNAL_KEY); } catch { /* nada */ }
    return e?.name === 'QuotaExceededError' ? 'demasiado-grande' : 'error';
  }
}

export function readJournal(storage) {
  try {
    const raw = storage.getItem(JOURNAL_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.projectId !== 'string' || !Number.isInteger(entry.baseRevision) || !entry.project) return null;
    return entry;
  } catch { return null; }
}

export function clearJournal(storage, projectId) {
  try {
    if (projectId) { const e = readJournal(storage); if (e && e.projectId !== projectId) return; }
    storage.removeItem(JOURNAL_KEY);
  } catch { /* nada */ }
}

const contentKey = (p) => JSON.stringify({ e: JSON.parse(projectToJson(p)).entities, s: p.sheet, st: p.style, n: p.name });

/**
 * Decide qué hacer con una copia pendiente al abrir la app:
 *   'aplicada'     nadie guardó después: se guarda en IndexedDB (era el estado más reciente)
 *   'ya-guardada'  el contenido ya está en IndexedDB (la escritura sí llegó a completarse): se descarta
 *   'conflicto'    se guardó otra versión después: NO se aplica; se devuelve para ofrecerla como copia
 *   'sin-proyecto' el proyecto ya no existe: se devuelve para ofrecerla como copia
 * Nunca sobrescribe una versión más reciente.
 */
export async function resolveJournal(store, storage) {
  const entry = readJournal(storage);
  if (!entry) return { action: 'ninguna' };
  let pending;
  try { pending = parseProject(entry.project, { id: entry.projectId }).project; } catch { clearJournal(storage); return { action: 'ilegible' }; }
  let stored = null;
  try { stored = await store.load(entry.projectId); } catch { stored = null; }
  if (!stored) return { action: 'sin-proyecto', project: pending, entry };
  if (contentKey(stored) === contentKey(pending)) { clearJournal(storage); return { action: 'ya-guardada' }; }
  if (stored.revision !== entry.baseRevision) return { action: 'conflicto', project: pending, entry };
  await store.save(pending, entry.baseRevision);
  clearJournal(storage);
  return { action: 'aplicada', projectId: entry.projectId };
}
