// Pruebas del formato v3, IndexedDB (fake-indexeddb), migración, gestor de guardado y copia de cierre.
// Solo Node. Cada bloque usa una base de datos nueva y aislada.
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { STORAGE_KEY_V1, STORAGE_KEY_V2 } from '../src/lib/document.js';
import {
  LEGACY_PROJECT_ID, createProject, entitiesOutsideSheet, filterSelection, parseProject, projectToJson,
} from '../src/lib/project.js';
import { ConflictError, LEGACY_SETTING, openStore } from '../src/lib/storage.js';
import { COMPASS_DEFAULTS, PROTRACTOR_DEFAULTS, sanitizeCompass, sanitizeInstruments, sanitizeProtractor } from '../src/lib/instruments.js';
import { createSaveManager } from '../src/lib/save-manager.js';
import { JOURNAL_KEY, readJournal, resolveJournal, writeJournal } from '../src/lib/journal.js';

let checks = 0;
const ok = (c, m) => { checks += 1; assert.ok(c, m); };
const eq = (a, b, m) => { checks += 1; assert.deepEqual(a, b, m); };
let seed = 99;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const style = { color: '#244d58', width: 0.45 };
const freshStore = (opts = {}) => openStore({ indexedDB: new IDBFactory(), ...opts });
function memStorage(initial = {}, { limit = Infinity } = {}) {
  const m = new Map(Object.entries(initial));
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { const size = [...m].reduce((s, [kk, vv]) => s + (kk === k ? 0 : kk.length + vv.length), 0) + k.length + v.length; if (size > limit) { const e = new Error('lleno'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
  };
}
/** Comprueba que dos listas de entidades son idénticas número a número (Object.is). */
function sameGeometry(a, b, msg) {
  checks += 1;
  assert.equal(a.length, b.length, `${msg}: número de entidades`);
  const walk = (x, y, path) => {
    if (typeof x === 'number') { assert.ok(Object.is(x, y), `${msg}: ${path} ${x} ≠ ${y}`); return; }
    if (Array.isArray(x)) { assert.equal(x.length, y.length, `${msg}: ${path}.length`); x.forEach((v, i) => walk(v, y[i], `${path}[${i}]`)); return; }
    if (x && typeof x === 'object') { assert.deepEqual(Object.keys(x).sort(), Object.keys(y).sort(), `${msg}: claves de ${path}`); for (const k of Object.keys(x)) walk(x[k], y[k], `${path}.${k}`); return; }
    assert.equal(x, y, `${msg}: ${path}`);
  };
  walk(a, b, 'entities');
}
function sampleEntities(nPoly = 3, nPts = 50) {
  const out = [
    { id: 's1', type: 'segment', ...style, a: { x: 12.345678901234567, y: 0.1 + 0.2 }, b: { x: 187.6, y: 1 / 3 } },
    { id: 'c1', type: 'circle', ...style, c: { x: 105, y: 148.5 }, r: Math.PI * 10 },
    { id: 'a1', type: 'arc', ...style, c: { x: 60, y: 60 }, r: 17.77777777, start: 359.99999999, sweep: 0.000123 },
    { id: 'p1', type: 'point', ...style, x: 1e-12, y: 296.99999999999994 },
  ];
  for (let i = 0; i < nPoly; i += 1) {
    const pts = [];
    for (let k = 0; k < nPts; k += 1) { const pt = { x: 10 + rnd() * 190, y: 10 + rnd() * 277 }; if (k % 3) pt.p = rnd(); pts.push(pt); }
    out.push({ id: `f${i}`, type: 'polyline', ...style, points: pts });
  }
  return out;
}

// ───────── 1) Formato v3 ─────────
{
  const p = createProject({ name: '  Ejercicio 1  ', orientation: 'landscape' });
  ok(p.name === 'Ejercicio 1' && p.sheet.orientation === 'landscape' && p.version === 3 && p.revision === 0, 'proyecto nuevo');
  p.entities = sampleEntities();
  p.selection = ['s1', 'no-existe', 'c1', 's1'];
  p.view = { center: { x: 100.5, y: 140.25 }, zoom: 2.5, rotation: 0 };
  const json = projectToJson(p);
  const back = parseProject(json).project;
  sameGeometry(p.entities, back.entities, 'ida y vuelta JSON');
  eq(back.selection, ['s1', 'c1'], 'la selección descarta ids inexistentes y repetidos');
  eq(back.view, p.view, 'vista conservada');
  ok(back.sheet.orientation === 'landscape' && back.name === 'Ejercicio 1', 'hoja y nombre');
  ok(!json.includes('"points"') && json.includes('"xy"'), 'los trazos libres se guardan empaquetados');
  const objSize = JSON.stringify(p).length;
  ok(json.length < objSize, `empaquetado más compacto (${json.length} frente a ${objSize} caracteres)`);
  console.log(`  · empaquetar trazos libres ahorra un ${(100 * (1 - json.length / objSize)).toFixed(0)} % en JSON (los números de 17 cifras dominan el tamaño)`);
  // Cambiar la orientación no toca la geometría; solo informa de lo que queda fuera.
  const portrait = { ...back, sheet: { ...back.sheet, orientation: 'portrait' } };
  ok(portrait.entities === back.entities, 'cambiar la orientación conserva las mismas entidades');
  const far = [{ id: 'x', type: 'segment', ...style, a: { x: 250, y: 20 }, b: { x: 280, y: 20 } }];
  ok(entitiesOutsideSheet(far, 'portrait') === 1 && entitiesOutsideSheet(far, 'landscape') === 0, 'aviso de elementos fuera de la hoja');
  ok(filterSelection('basura', back.entities).length === 0, 'selección no válida → vacía');
  // Datos inválidos o incompletos.
  const partial = parseProject({ format: 'dibujo-tecnico-a4/proyecto', version: 3, entities: [{ type: 'segment', a: { x: 1, y: 1 } }, { id: 'ok', type: 'point', x: 1, y: 2 }], sheet: { orientation: 'diagonal' }, view: { zoom: -1 } });
  ok(partial.dropped === 1 && partial.project.entities.length === 1 && partial.project.sheet.orientation === 'portrait' && partial.project.view === null, 'v3 incompleto: se descarta solo lo inutilizable');
  assert.throws(() => parseProject({ format: 'dibujo-tecnico-a4/proyecto', version: 4, entities: [] }), /no compatible/); checks += 1;
  assert.throws(() => parseProject('{"hola":1}'), /no contiene/); checks += 1;
  assert.throws(() => parseProject('no es json')); checks += 1;
  const v2 = parseProject({ version: 2, entities: [{ id: 'q', type: 'circle', c: { x: 5, y: 5 }, r: 2 }], margins: { top: 12 } });
  ok(v2.source === 'v2' && v2.project.entities[0].r === 2 && v2.project.sheet.margins.top === 12, 'documento v2 → proyecto');
  const v1 = parseProject({ strokes: [{ id: 'L', kind: 'line', points: [{ x: 1.5, y: 2 }, { x: 3, y: 4 }] }], margins: {} });
  ok(v1.source === 'v1' && v1.project.entities[0].type === 'segment' && v1.project.entities[0].a.x === 1.5, 'dibujo v1 → proyecto');
}

// ───────── 1b) Transportador: configuración guardada con el proyecto ─────────
{
  const p = createProject({ name: 'Transportador' });
  eq(p.instruments.protractor, { ...PROTRACTOR_DEFAULTS }, 'proyecto nuevo: transportador sin colocar');
  const prot = { visible: true, pose: { x: 20.25, y: 140.123456789, rotation: 37.5 }, angle: 37.5, cw: true, rayLength: 62.75, baseRay: false, mark: false };
  p.instruments = { ...p.instruments, protractor: prot };
  const back = parseProject(projectToJson(p)).project;
  eq(back.instruments.protractor, prot, 'JSON: el transportador vuelve con los mismos valores');
  ok(Object.is(back.instruments.protractor.pose.y, 140.123456789), 'la pose no se redondea');
  // Proyectos v3 anteriores solo guardaban { visible }.
  const old = parseProject({ format: 'dibujo-tecnico-a4/proyecto', version: 3, entities: [], instruments: { ruler: { visible: true, extra: 1 }, protractor: { visible: false } } }).project;
  eq(old.instruments.protractor, { ...PROTRACTOR_DEFAULTS }, 'v3 anterior: el transportador toma los valores por defecto');
  ok(old.instruments.ruler.visible === true && old.instruments.ruler.extra === 1, 'la regla conserva su configuración como antes');
  ok(parseProject({ format: 'dibujo-tecnico-a4/proyecto', version: 3, entities: [] }).project.instruments.protractor.pose === null, 'sin instrumentos: transportador sin colocar');
  // Valores no válidos: se descarta cada campo por separado, sin inventar una pose.
  const bad = sanitizeProtractor({ visible: 'sí', pose: { x: NaN, y: 3, rotation: 0 }, angle: 'x', cw: 1, rayLength: -4, baseRay: null, mark: false });
  eq(bad, { ...PROTRACTOR_DEFAULTS, mark: false }, 'campos no válidos → valores por defecto');
  ok(sanitizeProtractor({ pose: { x: 1, y: 2 } }).pose === null, 'pose sin giro → sin colocar');
  ok(sanitizeProtractor({ pose: { x: 1, y: 2, rotation: 725.5 } }).pose.rotation === 725.5, 'el giro guardado no se normaliza');
  eq(sanitizeInstruments(null).protractor, { ...PROTRACTOR_DEFAULTS }, 'instrumentos ausentes');
  ok(sanitizeInstruments({ protractor: prot }).protractor !== prot, 'se devuelve una copia, no el objeto leído');
  // IndexedDB (base aislada): guardar y reabrir.
  const store = await freshStore();
  const rec = await store.newProject({ name: 'Con transportador' });
  const loaded = await store.load(rec.id);
  await store.save({ ...loaded, instruments: { ...loaded.instruments, protractor: prot } }, loaded.revision);
  eq((await store.load(rec.id)).instruments.protractor, prot, 'IndexedDB: el transportador se guarda y se restaura');
  store.close();
}

// ───────── 1c) Compás: guía de trazado guardada con el proyecto ─────────
{
  const p = createProject({ name: 'Compás' });
  eq(p.instruments.compass, { ...COMPASS_DEFAULTS }, 'proyecto nuevo: compás sin colocar');
  const comp = { visible: true, pose: { x: 105.123456789, y: 20.5, rotation: 33.25 }, radius: 37.5, trace: false };
  p.instruments = { ...p.instruments, compass: comp };
  const back = parseProject(projectToJson(p)).project;
  eq(back.instruments.compass, comp, 'JSON: el compás vuelve con los mismos valores');
  ok(Object.is(back.instruments.compass.pose.x, 105.123456789) && Object.is(back.instruments.compass.radius, 37.5), 'centro y radio sin redondear');
  eq(back.instruments.protractor, p.instruments.protractor, 'el transportador no se ve afectado');
  const old = parseProject({ format: 'dibujo-tecnico-a4/proyecto', version: 3, entities: [], instruments: { compass: { visible: false } } }).project;
  eq(old.instruments.compass, { ...COMPASS_DEFAULTS }, 'v3 anterior ({ visible }): el compás toma los valores por defecto');
  eq(sanitizeCompass({ visible: 1, pose: { x: 1, y: 2, rotation: 'a' }, radius: -3, trace: 'no' }), { ...COMPASS_DEFAULTS }, 'campos no válidos → valores por defecto');
  ok(sanitizeCompass({ radius: 500 }).radius === 500 && sanitizeCompass({ radius: 500.0001 }).radius === COMPASS_DEFAULTS.radius, 'radio admitido hasta 500 mm');
  ok(sanitizeCompass({ radius: 1e-7 }).radius === 1e-7, 'radio muy pequeño pero positivo se conserva tal cual');
  ok(sanitizeInstruments({ compass: comp }).compass !== comp, 'se devuelve una copia, no el objeto leído');
  // IndexedDB (base aislada).
  const store = await freshStore();
  const rec = await store.newProject({ name: 'Con compás' });
  const loaded = await store.load(rec.id);
  await store.save({ ...loaded, instruments: { ...loaded.instruments, compass: comp } }, loaded.revision);
  eq((await store.load(rec.id)).instruments.compass, comp, 'IndexedDB: el compás se guarda y se restaura');
  store.close();
}

// ───────── 2) IndexedDB: crear, listar, abrir, guardar con revisión ─────────
{
  const store = await freshStore();
  const rec = await store.newProject({ name: 'Lámina 1', orientation: 'portrait' });
  let list = await store.list();
  ok(list.length === 1 && list[0].name === 'Lámina 1' && list[0].revision === 0, 'proyecto creado y listado');
  const p = await store.load(rec.id);
  p.entities = sampleEntities(5, 200);
  const r1 = await store.save(p, 0);
  ok(r1.revision === 1, 'guardar sube la revisión');
  const reopened = await store.load(rec.id);
  sameGeometry(p.entities, reopened.entities, 'guardar y reabrir');
  ok(reopened.revision === 1, 'revisión guardada');
  list = await store.list();
  ok(list[0].entityCount === p.entities.length, 'el índice refleja el contenido');
  await assert.rejects(() => store.create({ ...reopened }), 'crear con un id existente falla'); checks += 1;
  ok((await store.load(rec.id)).revision === 1, 'y no sobrescribe');

  // Dos pestañas sobre el mismo proyecto: la segunda no sobrescribe.
  const tabA = await store.load(rec.id);
  const tabB = await store.load(rec.id);
  tabA.entities = [...tabA.entities, { id: 'deA', type: 'point', ...style, x: 1, y: 1 }];
  tabB.entities = [...tabB.entities, { id: 'deB', type: 'point', ...style, x: 2, y: 2 }];
  await store.save(tabA, tabA.revision);
  let conflict = null;
  try { await store.save(tabB, tabB.revision); } catch (e) { conflict = e; }
  ok(conflict instanceof ConflictError && conflict.storedRevision === 2, 'segunda pestaña → conflicto');
  const afterConflict = await store.load(rec.id);
  ok(afterConflict.entities.some((e) => e.id === 'deA') && !afterConflict.entities.some((e) => e.id === 'deB'), 'lo guardado por la primera pestaña sigue intacto');
  ok(tabB.entities.some((e) => e.id === 'deB'), 'los cambios de la segunda siguen en memoria');
  // Escrituras consecutivas.
  let cur = await store.load(rec.id);
  for (let i = 0; i < 40; i += 1) { cur = { ...cur, entities: [...cur.entities, { id: `n${i}`, type: 'point', ...style, x: i, y: i }] }; const r = await store.save(cur, cur.revision); cur.revision = r.revision; }
  const final = await store.load(rec.id);
  ok(final.revision === 42 && final.entities.filter((e) => e.id.startsWith('n')).length === 40, '40 escrituras consecutivas sin pérdidas');
  // Renombrar, duplicar, eliminar, abrir.
  await store.rename(rec.id, 'Lámina 1 · corregida');
  ok((await store.load(rec.id)).name === 'Lámina 1 · corregida' && (await store.load(rec.id)).revision === 43, 'renombrar sube la revisión');
  await assert.rejects(() => store.rename(rec.id, '   ')); checks += 1;
  const dup = await store.duplicate(rec.id);
  const dupP = await store.load(dup.id);
  ok(dup.id !== rec.id && dupP.name.endsWith('(copia)') && dupP.revision === 0, 'duplicado independiente');
  sameGeometry(final.entities, dupP.entities, 'el duplicado copia la geometría exacta');
  dupP.entities = [];
  await store.save(dupP, 0);
  ok((await store.load(rec.id)).entities.length === final.entities.length, 'editar el duplicado no toca el original');
  const beforeTouch = (await store.list()).find((x) => x.id === rec.id);
  await store.touchOpened(rec.id);
  const afterTouch = (await store.list()).find((x) => x.id === rec.id);
  ok(afterTouch.openedAt && afterTouch.revision === beforeTouch.revision, 'abrir no cambia la revisión');
  await store.remove(dup.id);
  ok((await store.list()).length === 1, 'eliminar');
  conflict = null;
  try { await store.save(dupP, 1); } catch (e) { conflict = e; }
  ok(conflict instanceof ConflictError && conflict.reason === 'eliminado', 'guardar un proyecto eliminado en otra pestaña → conflicto, sin recrearlo');
  ok((await store.list()).length === 1, 'no se recrea');
  // Importar y exportar JSON.
  const imported = await store.importJson(projectToJson(final));
  ok(imported.record.id !== final.id, 'importar crea un proyecto nuevo');
  sameGeometry(final.entities, (await store.load(imported.record.id)).entities, 'exportar e importar conserva la geometría');
  store.close();
}

// ───────── 3) Almacenamiento lleno ─────────
{
  const factory = new IDBFactory();
  const store = await openStore({ indexedDB: factory });
  const rec = await store.newProject({ name: 'Lleno' });
  const p = await store.load(rec.id);
  p.entities = sampleEntities(1, 10);
  await store.save(p, 0);
  const { IDBObjectStore } = await import('fake-indexeddb');
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException('Se superó la cuota', 'QuotaExceededError'); };
  let err = null;
  const bigger = { ...p, revision: 1, entities: [...p.entities, { id: 'extra', type: 'point', ...style, x: 3, y: 3 }] };
  try { await store.save(bigger, 1); } catch (e) { err = e; }
  IDBObjectStore.prototype.put = realPut;
  ok(err && err.name === 'StorageError' && err.kind === 'espacio' && /espacio/.test(err.message), `almacenamiento lleno → error claro (${err?.message})`);
  const still = await store.load(rec.id);
  ok(still.revision === 1 && !still.entities.some((e) => e.id === 'extra'), 'el fallo no deja datos a medias');
  const retry = await store.save(bigger, 1);
  ok(retry.revision === 2, 'con espacio, el reintento guarda');
  store.close();
}

// ───────── 4) Proyecto de más de 8 MB ─────────
{
  const store = await freshStore();
  const rec = await store.newProject({ name: 'Grande' });
  const p = await store.load(rec.id);
  p.entities = sampleEntities(420, 400);
  const jsonSize = projectToJson(p).length;
  const objSize = JSON.stringify(p).length;
  ok(jsonSize > 8 * 1024 * 1024, `proyecto de prueba de ${(jsonSize / 1048576).toFixed(1)} MB empaquetado (${(objSize / 1048576).toFixed(1)} MB en objetos)`);
  const t0 = performance.now();
  await store.save(p, 0);
  const back = await store.load(rec.id);
  const ms = performance.now() - t0;
  sameGeometry(p.entities, back.entities, 'más de 8 MB: guardar y reabrir sin pérdidas');
  console.log(`  · ${p.entities.length} entidades, 168 000 puntos: ${(objSize / 1048576).toFixed(1)} MB en objetos, ${(jsonSize / 1048576).toFixed(1)} MB empaquetado; guardar + reabrir ${ms.toFixed(0)} ms (fake-indexeddb)`);
  store.close();
}

// ───────── 5) Migración desde localStorage ─────────
{
  const v2doc = JSON.stringify({ version: 2, entities: sampleEntities(2, 20), margins: { top: 10, right: 10, bottom: 10, left: 15 }, color: '#bc573f', width: 0.5 });
  const legacy = memStorage({ [STORAGE_KEY_V2]: v2doc, [STORAGE_KEY_V1]: JSON.stringify({ strokes: [], margins: {} }) });
  const snapshot = new Map(legacy.map);
  const factory = new IDBFactory();
  let store = await openStore({ indexedDB: factory });
  const m1 = await store.migrateLegacy(legacy);
  ok(m1.status === 'migrado' && m1.projectId === LEGACY_PROJECT_ID && m1.source === STORAGE_KEY_V2, 'se migra el v2 (prioridad sobre v1)');
  const mig = await store.load(LEGACY_PROJECT_ID);
  sameGeometry(JSON.parse(v2doc).entities, mig.entities, 'migración exacta');
  ok(mig.name === 'Dibujo anterior' && mig.sheet.margins.left === 15 && mig.style.color === '#bc573f', 'nombre, márgenes y estilo');
  store.close();
  store = await openStore({ indexedDB: factory }); // "reiniciar la app"
  const m2 = await store.migrateLegacy(legacy);
  ok(m2.status === 'ya-migrado' && (await store.list()).length === 1, 'idempotente: reiniciar no duplica');
  await store.setSetting(LEGACY_SETTING, undefined);
  await new Promise((r) => { const t = store.db.transaction(['settings'], 'readwrite'); t.objectStore('settings').delete(LEGACY_SETTING); t.oncomplete = r; });
  const m3 = await store.migrateLegacy(legacy);
  ok(m3.status === 'ya-migrado' && (await store.list()).length === 1, 'aunque se pierda la marca, el id fijo evita duplicar');
  await store.remove(LEGACY_PROJECT_ID);
  const m4 = await store.migrateLegacy(legacy);
  ok(m4.status === 'ya-migrado' && (await store.list()).length === 0, 'si el usuario lo borró, no reaparece');
  eq([...legacy.map], [...snapshot], 'localStorage original intacto');
  store.close();

  const onlyV1 = memStorage({ [STORAGE_KEY_V1]: JSON.stringify({ strokes: [{ id: 'L', kind: 'line', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }, { id: 'bad', kind: 'line', points: [] }], margins: {} }) });
  store = await freshStore();
  const mv1 = await store.migrateLegacy(onlyV1);
  ok(mv1.status === 'migrado' && mv1.dropped === 1 && mv1.count === 1, 'v1 con un trazo inutilizable: se migra el resto y se cuenta lo descartado');
  store.close();

  const corrupt = memStorage({ [STORAGE_KEY_V2]: '{"version":2,"entities":[{"id":' });
  const corruptSnap = new Map(corrupt.map);
  store = await freshStore();
  const mc = await store.migrateLegacy(corrupt);
  ok(mc.status === 'fallido' && typeof mc.raw === 'string' && mc.raw.length > 0, 'datos dañados: falla sin crear nada y devuelve los datos originales para exportarlos');
  ok((await store.list()).length === 0 && !(await store.getSetting(LEGACY_SETTING)), 'sin proyecto y sin marca: se reintentará');
  eq([...corrupt.map], [...corruptSnap], 'localStorage dañado intacto');
  const mc2 = await store.migrateLegacy(corrupt);
  ok(mc2.status === 'fallido', 'reintentar no duplica ni marca');
  ok((await store.migrateLegacy(memStorage())).status === 'sin-datos', 'sin datos anteriores');
  const throwing = { getItem: () => { throw new DOMException('bloqueado', 'SecurityError'); } };
  ok((await store.migrateLegacy(throwing)).status === 'fallido', 'localStorage inaccesible: falla sin romper la app');
  store.close();
}

// ───────── 6) Gestor de guardado (reloj simulado) ─────────
function fakeClock() {
  let now = 0; let seq = 0; const timers = new Map();
  return {
    setTimer: (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; },
    clearTimer: (id) => timers.delete(id),
    setRepeat: (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f, every: ms }); return id; },
    clearRepeat: (id) => timers.delete(id),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, t] = next; now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.f(); await new Promise((r) => setImmediate(r));
      }
      now = end; await new Promise((r) => setImmediate(r));
    },
  };
}
{
  const clock = fakeClock();
  const statuses = [];
  let writes = 0; let fail = null; let gate = null;
  const sm = createSaveManager({
    ...clock, onStatus: (s) => statuses.push(s.status),
    write: async () => { writes += 1; if (gate) await gate; if (fail) { const e = fail; throw e; } },
  });
  sm.changed();
  await clock.advance(1499);
  ok(writes === 0 && sm.getState().status === 'dirty', 'no guarda antes de 1,5 s');
  await clock.advance(1);
  ok(writes === 1 && sm.getState().status === 'saved', 'guarda a los 1,5 s y entonces muestra Guardado');
  sm.changed(); await clock.advance(1000); sm.changed(); await clock.advance(1000); sm.changed(); await clock.advance(1499);
  ok(writes === 1, 'cambios seguidos se agrupan');
  await clock.advance(1);
  ok(writes === 2, 'una sola escritura para el grupo');
  // Cambio durante una escritura en curso: se guarda después; no se anuncia Guardado antes.
  let release; gate = new Promise((r) => { release = r; });
  sm.changed(); await clock.advance(1500);
  ok(writes === 3 && sm.getState().status === 'saving', 'escribiendo');
  sm.changed();
  ok(sm.getState().status === 'saving', 'sigue escribiendo; no se anuncia nada falso');
  release(); gate = null; await clock.advance(0);
  ok(sm.getState().status === 'dirty', 'terminó la escritura pero hay cambios posteriores → no está Guardado');
  await clock.advance(1500);
  ok(writes === 4 && sm.getState().status === 'saved', 'el cambio posterior se guarda después');
  // Fallo: nunca Guardado; reintento periódico a los 30 s.
  fail = Object.assign(new Error('No queda espacio de almacenamiento'), { name: 'StorageError' });
  const before = statuses.length;
  sm.changed(); await clock.advance(1500);
  ok(sm.getState().status === 'error' && /espacio/.test(sm.getState().message), 'fallo → estado de error con motivo');
  ok(!statuses.slice(before).includes('saved'), 'tras un fallo no se mostró Guardado');
  ok(sm.isDirty(), 'los cambios siguen pendientes en memoria');
  fail = null;
  await clock.advance(30000);
  ok(sm.getState().status === 'saved' && !sm.isDirty(), 'el respaldo periódico reintenta y guarda');
  // Conflicto: se detiene el guardado automático.
  fail = new ConflictError('El proyecto se modificó en otra pestaña o ventana.');
  sm.changed(); await clock.advance(1500);
  ok(sm.getState().status === 'conflict', 'conflicto');
  const w = writes; fail = null;
  sm.changed(); await clock.advance(60000);
  ok(writes === w && sm.getState().status === 'conflict' && sm.isDirty(), 'con conflicto no se vuelve a escribir solo; los cambios quedan en memoria');
  sm.resetClean();
  ok(sm.getState().status === 'saved', 'resolver el conflicto (p. ej., recargar) deja el estado limpio');
  // flush: guardar ya.
  sm.changed(); await sm.flush();
  ok(sm.getState().status === 'saved', 'flush guarda de inmediato');
  sm.dispose();
}

// ───────── 7) Copia de cierre (journal) ─────────
{
  const store = await freshStore();
  const rec = await store.newProject({ name: 'Cierre' });
  const p = await store.load(rec.id);
  p.entities = sampleEntities(1, 30);
  await store.save(p, 0);
  const ls = memStorage();
  const edited = { ...p, revision: 1, entities: [...p.entities, { id: 'ultimo', type: 'point', ...style, x: 9, y: 9 }] };
  ok(writeJournal(ls, { project: edited, baseRevision: 1 }) === 'ok' && readJournal(ls)?.projectId === rec.id, 'copia síncrona escrita');
  const r1 = await resolveJournal(store, ls);
  ok(r1.action === 'aplicada' && (await store.load(rec.id)).entities.some((e) => e.id === 'ultimo') && !ls.getItem(JOURNAL_KEY), 'al reabrir: el cambio no guardado se recupera y la copia se borra');
  writeJournal(ls, { project: await store.load(rec.id), baseRevision: 1 });
  ok((await resolveJournal(store, ls)).action === 'ya-guardada' && !ls.getItem(JOURNAL_KEY), 'si la escritura sí llegó a completarse, la copia se descarta');
  const other = await store.load(rec.id);
  writeJournal(ls, { project: { ...other, entities: [] }, baseRevision: other.revision });
  await store.save({ ...other, entities: [...other.entities, { id: 'otra', type: 'point', ...style, x: 5, y: 5 }] }, other.revision);
  const r3 = await resolveJournal(store, ls);
  ok(r3.action === 'conflicto' && (await store.load(rec.id)).entities.some((e) => e.id === 'otra') && ls.getItem(JOURNAL_KEY), 'versión más reciente guardada: la copia NO se aplica y se conserva para ofrecerla');
  await store.remove(rec.id);
  ok((await resolveJournal(store, ls)).action === 'sin-proyecto', 'proyecto eliminado: la copia se ofrece aparte');
  const tiny = memStorage({}, { limit: 1000 });
  ok(writeJournal(tiny, { project: edited, baseRevision: 1 }) === 'demasiado-grande' && !tiny.getItem(JOURNAL_KEY), 'si no cabe, se informa (límite de localStorage)');
  store.close();
}

console.log(`Almacenamiento OK: ${checks} comprobaciones (formato v3, IndexedDB, conflictos, espacio lleno, > 8 MB, migración, guardado y cierre).`);
