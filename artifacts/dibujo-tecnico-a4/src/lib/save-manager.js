// Gestor de guardado. Sin DOM: el reloj y la función de escritura se inyectan (pruebas deterministas).
//
// Reglas:
//   - Tras cada operación terminada (changed()), se guarda a los DELAY_MS (1,5 s) sin más cambios.
//   - Respaldo periódico cada PERIOD_MS (30 s) si quedan cambios sin guardar (también reintenta tras un error).
//   - Una sola escritura a la vez; los cambios que llegan durante una escritura se guardan después.
//   - 'saved' (Guardado) solo se anuncia cuando la escritura se ha CONFIRMADO y no hay cambios posteriores.
//   - Error: se mantiene 'error' con su mensaje y los cambios siguen en memoria; se reintenta.
//   - Conflicto: se detiene el guardado automático (nunca se sobrescribe) hasta que el usuario decida.

export const DELAY_MS = 1500;
export const PERIOD_MS = 30000;

export function createSaveManager({
  write, onStatus = () => {}, delayMs = DELAY_MS, periodMs = PERIOD_MS,
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (h) => clearTimeout(h),
  setRepeat = (f, ms) => setInterval(f, ms), clearRepeat = (h) => clearInterval(h),
}) {
  let version = 0;          // cambios ocurridos
  let savedVersion = 0;     // último cambio confirmado en almacenamiento
  let inflight = null;      // promesa de la escritura en curso
  let timer = null;
  let disposed = false;
  let state = { status: 'saved', message: '' };

  const emit = (status, message = '') => { state = { status, message }; onStatus(state); };
  const dirty = () => version !== savedVersion;

  const run = async () => {
    if (disposed || state.status === 'conflict') return inflight;
    if (inflight) return inflight;
    if (!dirty()) { if (state.status !== 'saved') emit('saved'); return undefined; }
    const target = version;
    emit('saving');
    inflight = (async () => {
      try {
        await write();
        savedVersion = Math.max(savedVersion, target);
        if (dirty()) { emit('dirty'); schedule(); } else emit('saved');
      } catch (err) {
        if (err?.name === 'ConflictError') emit('conflict', err.message);
        else emit('error', err?.message || String(err));
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  function schedule() {
    if (disposed || state.status === 'conflict') return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; run(); }, delayMs);
  }

  const periodic = setRepeat(() => { if (dirty() && !inflight) run(); }, periodMs);

  return {
    /** Llamar al terminar cada operación que cambia el proyecto. */
    changed() {
      if (disposed) return;
      version += 1;
      if (state.status !== 'conflict' && state.status !== 'error' && !inflight) emit('dirty');
      schedule();
    },
    /** Guarda ya (botón Guardar, salir del proyecto, ocultar la página). Resuelve cuando termina el intento. */
    async flush() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      if (inflight) await inflight;
      return run();
    },
    /** Otra pestaña guardó este proyecto mientras aquí había cambios: se detiene el guardado automático. */
    markConflict(message) {
      if (timer !== null) { clearTimer(timer); timer = null; }
      emit('conflict', message);
    },
    /** Tras resolver un conflicto (p. ej., se recargó la versión guardada): todo vuelve a estar guardado. */
    resetClean() {
      savedVersion = version;
      emit('saved');
    },
    isDirty: dirty,
    isSaving: () => !!inflight,
    getState: () => state,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      clearRepeat(periodic);
    },
  };
}
