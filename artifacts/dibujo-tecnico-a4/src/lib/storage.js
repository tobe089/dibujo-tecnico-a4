// Biblioteca de proyectos en IndexedDB. Sin DOM salvo `indexedDB` (inyectable para las pruebas).
//
// Almacenes:
//   projects  id → proyecto v3 empaquetado (geometría completa)
//   index     id → datos de la biblioteca (nombre, fechas, revisión, orientación, miniatura)
//   settings  clave → valor (por ejemplo, el resultado de la migración desde localStorage)
// `projects` e `index` se escriben SIEMPRE en la misma transacción: no pueden quedar desalineados.
// Guardar exige la revisión con la que se cargó el proyecto; si otra pestaña guardó antes, la transacción
// se anula (ConflictError) y no se sobrescribe nada.

import { STORAGE_KEY_V1, STORAGE_KEY_V2, makeId } from './document.js';
import {
  LEGACY_PROJECT_ID, createProject, indexRecordFor, parseProject, serializeProject,
} from './project.js';

export const DB_NAME = 'dibujo-tecnico-a4';
export const DB_VERSION = 1;
export const LEGACY_SETTING = 'migracion-localstorage';

export class ConflictError extends Error {
  constructor(message, { storedRevision = null, reason = 'revision' } = {}) {
    super(message);
    this.name = 'ConflictError';
    this.storedRevision = storedRevision;
    this.reason = reason;
  }
}

export class StorageError extends Error {
  constructor(message, { kind = 'desconocido', cause } = {}) {
    super(message);
    this.name = 'StorageError';
    this.kind = kind;
    this.cause = cause;
  }
}

/** Traduce los errores de IndexedDB a mensajes comprensibles. */
export function toStorageError(err) {
  if (err instanceof ConflictError || err instanceof StorageError) return err;
  const name = err?.name || '';
  if (name === 'QuotaExceededError' || /quota/i.test(String(err?.message))) {
    return new StorageError('No queda espacio de almacenamiento en este dispositivo. Libera espacio o exporta el proyecto como copia (JSON).', { kind: 'espacio', cause: err });
  }
  if (name === 'InvalidStateError' || name === 'AbortError') {
    return new StorageError('La escritura se interrumpió antes de completarse. Los cambios siguen en pantalla; se volverá a intentar.', { kind: 'interrumpida', cause: err });
  }
  return new StorageError(`No se pudo acceder al almacenamiento local (${name || 'error desconocido'}).`, { kind: 'desconocido', cause: err });
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** Ejecuta `work(stores)` en una transacción y resuelve cuando la transacción se CONFIRMA (oncomplete). */
function tx(db, names, mode, work) {
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(names, mode); } catch (e) { reject(toStorageError(e)); return; }
    const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)]));
    let result;
    let failure = null;
    t.oncomplete = () => (failure ? reject(failure) : resolve(result));
    t.onabort = () => reject(failure || toStorageError(t.error || new DOMException('Transacción anulada', 'AbortError')));
    t.onerror = (ev) => { ev.preventDefault?.(); };
    Promise.resolve()
      .then(() => work(stores, t))
      .then((r) => { result = r; })
      .catch((e) => { failure = e instanceof ConflictError || e instanceof StorageError ? e : toStorageError(e); try { t.abort(); } catch { /* ya terminada */ } });
  });
}

export async function openStore({ indexedDB = globalThis.indexedDB, name = DB_NAME, now = () => new Date().toISOString() } = {}) {
  if (!indexedDB) throw new StorageError('Este navegador no permite guardar proyectos (IndexedDB no disponible).', { kind: 'no-disponible' });
  const db = await new Promise((resolve, reject) => {
    let r;
    try { r = indexedDB.open(name, DB_VERSION); } catch (e) { reject(toStorageError(e)); return; }
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('index')) d.createObjectStore('index', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(toStorageError(r.error));
    r.onblocked = () => reject(new StorageError('Cierra las demás pestañas de Dibujo Técnico A4 para actualizar el almacenamiento.', { kind: 'bloqueado' }));
  });

  const store = {
    db,
    close: () => db.close(),

    async list() {
      const rows = await tx(db, ['index'], 'readonly', ({ index }) => req(index.getAll()));
      return rows.sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
    },

    async load(id) {
      const raw = await tx(db, ['projects'], 'readonly', ({ projects }) => req(projects.get(id)));
      if (!raw) throw new StorageError('El proyecto ya no existe.', { kind: 'no-encontrado' });
      return parseProject(raw, { id }).project;
    },

    /** Crea un proyecto nuevo. Falla si el id ya existe (nunca sobrescribe). */
    async create(project, { thumbnail = null } = {}) {
      const rec = indexRecordFor(project, { thumbnail });
      await tx(db, ['projects', 'index'], 'readwrite', async ({ projects, index }) => {
        await req(projects.add(serializeProject(project)));
        await req(index.add(rec));
      });
      return rec;
    },

    /**
     * Guarda una nueva versión del proyecto solo si la revisión almacenada es `expectedRevision`.
     * Resuelve con { revision, modifiedAt } cuando la escritura está confirmada.
     */
    async save(project, expectedRevision, { thumbnail } = {}) {
      const modifiedAt = now();
      let revision;
      await tx(db, ['projects', 'index'], 'readwrite', async ({ projects, index }) => {
        const current = await req(index.get(project.id));
        if (!current) throw new ConflictError('El proyecto se ha eliminado en otra pestaña o ventana.', { reason: 'eliminado' });
        if (current.revision !== expectedRevision) {
          throw new ConflictError('El proyecto se modificó en otra pestaña o ventana.', { storedRevision: current.revision });
        }
        revision = expectedRevision + 1;
        const next = { ...project, revision, modifiedAt };
        await req(projects.put(serializeProject(next)));
        await req(index.put(indexRecordFor(next, { openedAt: current.openedAt, thumbnail: thumbnail === undefined ? current.thumbnail : thumbnail })));
      });
      return { revision, modifiedAt };
    },

    async rename(id, name) {
      const clean = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null;
      if (!clean) throw new StorageError('Escribe un nombre para el proyecto.', { kind: 'nombre' });
      await tx(db, ['projects', 'index'], 'readwrite', async ({ projects, index }) => {
        const raw = await req(projects.get(id));
        const rec = await req(index.get(id));
        if (!raw || !rec) throw new StorageError('El proyecto ya no existe.', { kind: 'no-encontrado' });
        const modifiedAt = now();
        const revision = rec.revision + 1;
        await req(projects.put({ ...raw, name: clean, revision, modifiedAt }));
        await req(index.put({ ...rec, name: clean, revision, modifiedAt }));
      });
    },

    async duplicate(id, name) {
      const source = await store.load(id);
      const rec = (await tx(db, ['index'], 'readonly', ({ index }) => req(index.get(id)))) || {};
      const stamp = now();
      const copy = { ...source, id: makeId(), name: name || `${source.name} (copia)`, createdAt: stamp, modifiedAt: stamp, revision: 0 };
      return store.create(copy, { thumbnail: rec.thumbnail ?? null });
    },

    async remove(id) {
      await tx(db, ['projects', 'index'], 'readwrite', async ({ projects, index }) => {
        await req(projects.delete(id));
        await req(index.delete(id));
      });
    },

    /** Marca el proyecto como abierto (no cambia su revisión ni su contenido). */
    async touchOpened(id) {
      await tx(db, ['index'], 'readwrite', async ({ index }) => {
        const rec = await req(index.get(id));
        if (rec) await req(index.put({ ...rec, openedAt: now() }));
      });
    },

    /** Actualiza solo la miniatura (no cambia la revisión). */
    async setThumbnail(id, thumbnail) {
      await tx(db, ['index'], 'readwrite', async ({ index }) => {
        const rec = await req(index.get(id));
        if (rec) await req(index.put({ ...rec, thumbnail }));
      });
    },

    async getSetting(key) {
      return tx(db, ['settings'], 'readonly', ({ settings }) => req(settings.get(key)));
    },
    async setSetting(key, value) {
      await tx(db, ['settings'], 'readwrite', ({ settings }) => req(settings.put(value, key)));
    },

    /**
     * Importa como proyecto el dibujo guardado por versiones anteriores en localStorage (v2 y, si no, v1).
     * Idempotente: el proyecto usa un id fijo y la marca de migración se guarda en la MISMA transacción, de modo
     * que reiniciar no duplica nada; si el usuario lo borra, no vuelve a aparecer. localStorage no se modifica.
     * Si los datos antiguos no se pueden leer, no se marca nada: se informa y se pueden exportar tal cual.
     */
    async migrateLegacy(legacyStorage) {
      const done = await store.getSetting(LEGACY_SETTING);
      if (done) return { status: 'ya-migrado', projectId: done.projectId ?? null };
      let raw = null;
      let key = null;
      try {
        for (const k of [STORAGE_KEY_V2, STORAGE_KEY_V1]) { const v = legacyStorage?.getItem(k); if (v) { raw = v; key = k; break; } }
      } catch (e) {
        return { status: 'fallido', error: `No se pudo leer el almacenamiento anterior (${e?.name || e}).` };
      }
      if (!raw) return { status: 'sin-datos' };
      let parsed;
      try { parsed = parseProject(raw, { id: LEGACY_PROJECT_ID }); } catch (e) {
        return { status: 'fallido', key, error: `El dibujo anterior no se pudo interpretar: ${e.message}`, raw };
      }
      const project = { ...parsed.project, name: 'Dibujo anterior', id: LEGACY_PROJECT_ID };
      const result = await tx(db, ['projects', 'index', 'settings'], 'readwrite', async ({ projects, index, settings }) => {
        if (await req(settings.get(LEGACY_SETTING))) return { status: 'ya-migrado', projectId: LEGACY_PROJECT_ID };
        if (await req(projects.get(LEGACY_PROJECT_ID))) {
          await req(settings.put({ projectId: LEGACY_PROJECT_ID, at: now(), source: key, dropped: parsed.dropped }, LEGACY_SETTING));
          return { status: 'ya-migrado', projectId: LEGACY_PROJECT_ID };
        }
        await req(projects.add(serializeProject(project)));
        await req(index.add(indexRecordFor(project)));
        await req(settings.put({ projectId: LEGACY_PROJECT_ID, at: now(), source: key, dropped: parsed.dropped }, LEGACY_SETTING));
        return { status: 'migrado', projectId: LEGACY_PROJECT_ID, dropped: parsed.dropped, count: project.entities.length, source: key };
      });
      return result;
    },

    /** Importa un archivo de proyecto como proyecto NUEVO (nunca reemplaza otro). */
    async importJson(text, { name } = {}) {
      const { project, dropped } = parseProject(text, { id: makeId() });
      const stamp = now();
      const fresh = { ...project, name: name || project.name, createdAt: stamp, modifiedAt: stamp, revision: 0 };
      const rec = await store.create(fresh);
      return { record: rec, dropped };
    },

    newProject({ name, orientation } = {}) {
      return store.create(createProject({ name, orientation, now: now() }));
    },
  };
  return store;
}
