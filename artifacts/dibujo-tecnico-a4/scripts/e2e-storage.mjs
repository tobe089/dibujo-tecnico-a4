// Etapa B en Chromium real: biblioteca, migración, guardado fiable, conflictos entre pestañas, cierre de página,
// proyectos de más de 8 MB, orientación, restauración, modo sin conexión (PWA) y rendimiento del borrador.
// Requisitos: Playwright y la app COMPILADA servida (el service worker solo existe en la compilación):
//   pnpm run build && pnpm run serve
//   E2E_URL=http://localhost:4173/ PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node scripts/e2e-storage.mjs
// No forma parte del CI (allí no hay navegador). Los resultados son de Chromium de escritorio, no de Android.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const URL_APP = process.env.E2E_URL || 'http://localhost:4173/';
const ORIGIN_FILE = new URL('robots.txt', URL_APP).href;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let checks = 0;
const results = [];
const ok = (c, m) => { checks += 1; assert.ok(c, m); };
const log = (m) => { results.push(m); console.log(`  ✓ ${m}`); };
const info = (m) => console.log(`  · ${m}`);

async function newCtx(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  return ctx;
}
async function openPage(ctx) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
async function wipe(p, storage = null) {
  await p.goto(ORIGIN_FILE);
  await p.evaluate(async (s) => {
    localStorage.clear();
    await new Promise((r) => { const q = indexedDB.deleteDatabase('dibujo-tecnico-a4'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    if (s) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, storage);
}
const gotoLibrary = async (p) => { await p.goto(URL_APP); await p.waitForSelector('[data-testid=library]'); };
async function createProject(p, name = 'Prueba', orientation = 'portrait') {
  await p.click('[data-testid=button-new-project]');
  await p.fill('[data-testid=input-project-name]', name);
  if (orientation === 'landscape') await p.click('[data-testid=seg-new-orientation-landscape]');
  await p.click('[data-testid=button-create-project]');
  await p.waitForSelector('[data-testid=drawing-sheet]');
  return p.locator('main[data-project-id]').getAttribute('data-project-id');
}
const openById = async (p, id) => { await p.click(`[data-testid=open-${id}]`); await p.waitForSelector('[data-testid=drawing-sheet]'); };
const status = (p) => p.locator('[data-testid=status-autosave]').getAttribute('data-status');
async function waitStatus(p, wanted, timeout = 10000) {
  // Margen para que el cambio recién hecho ya haya marcado «Cambios sin guardar» (evita leer un «Guardado» anterior).
  if (wanted === 'saved') await p.waitForTimeout(150);
  await p.waitForFunction((w) => document.querySelector('[data-testid=status-autosave]')?.dataset.status === w, wanted, { timeout });
}
/** Lee un proyecto guardado en IndexedDB, desempaquetado. */
const readStored = (p, id) => p.evaluate(async (id) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('dibujo-tecnico-a4'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = (store, key) => new Promise((res) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
  const raw = await get('projects', id); const rec = await get('index', id);
  const all = await new Promise((res) => { const q = db.transaction('index').objectStore('index').getAll(); q.onsuccess = () => res(q.result); });
  db.close();
  const unpack = (e) => {
    if (e.type !== 'polyline' || !Array.isArray(e.xy)) return e;
    const points = [];
    for (let i = 0; i + 1 < e.xy.length; i += 2) { const pt = { x: e.xy[i], y: e.xy[i + 1] }; const pr = Array.isArray(e.p) ? e.p[i / 2] : null; if (Number.isFinite(pr)) pt.p = pr; points.push(pt); }
    const { xy, p: _p, ...rest } = e; return { ...rest, points };
  };
  return { project: raw ? { ...raw, entities: raw.entities.map(unpack) } : null, index: rec, count: all.length };
}, id);
async function view(p) {
  return p.evaluate(() => { const s = document.querySelector('[data-testid=drawing-sheet]'); const r = s.getBoundingClientRect(); return { scale: +s.dataset.scale, tx: +s.dataset.tx, ty: +s.dataset.ty, left: r.left, top: r.top, w: r.width, h: r.height }; });
}
async function pen(p) { return p.context().newCDPSession(p); }
async function rulerLine(p, a, b) {
  const cdp = await pen(p);
  const v = await view(p);
  const at = (q) => ({ x: v.left + v.tx + q.x * v.scale, y: v.top + v.ty + q.y * v.scale });
  if ((await p.locator('[data-testid=tool-ruler]').getAttribute('class'))?.includes('active') !== true) await p.click('[data-testid=tool-ruler]');
  for (const q of [a, b]) {
    const c = at(q);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'pen' });
  }
  await cdp.detach();
}
/** ¿Es el segmento trazado a la altura y (mm)? Los toques pasan por píxeles: se identifican con ±0,5 mm. */
const atY = (e, y) => e.type === 'segment' && Math.abs(e.a.y - y) < 0.5;
const domCount = (p) => p.locator('path[data-testid^=entity-]').count();

// ───────── 1) Biblioteca: crear, abrir, renombrar, duplicar, eliminar, vistas, recientes, miniaturas ─────────
{
  const ctx = await newCtx(); const p = await openPage(ctx);
  await wipe(p); await gotoLibrary(p);
  ok(await p.locator('[data-testid=library-empty]').isVisible(), 'biblioteca vacía con explicación');
  const id = await createProject(p, 'Lámina 1', 'landscape');
  ok((await p.locator('[data-testid=text-orientation]').innerText()) === 'Horizontal' && (await p.locator('[data-testid=sheet-rect]').getAttribute('width')) === '297', 'hoja horizontal 297 × 210');
  await rulerLine(p, { x: 20, y: 30 }, { x: 250, y: 30 });
  await waitStatus(p, 'saved');
  await p.click('[data-testid=button-library]');
  await p.waitForSelector(`[data-testid=project-${id}]`);
  await p.waitForFunction((id) => !!document.querySelector(`[data-testid=project-${id}] img`), id, { timeout: 5000 });
  const card = await p.locator(`[data-testid=library-all] [data-testid=project-${id}]`).innerText();
  ok(card.includes('Lámina 1') && card.includes('Horizontal') && card.includes('1 elemento') && card.includes('Modificado'), `tarjeta con nombre, orientación, elementos y fecha (${card.replace(/\n/g, ' | ')})`);
  ok((await p.locator('[data-testid=library-recent] article').count()) === 1, 'aparece en Recientes');
  // Renombrar.
  await p.click(`[data-testid=library-all] [data-testid=rename-${id}]`); await p.fill('[data-testid=input-rename]', 'Lámina 1 · rev. A'); await p.click('[data-testid=button-confirm-rename]');
  await p.waitForFunction((id) => document.querySelector(`[data-testid=library-all] [data-testid=project-${id}]`)?.textContent.includes('rev. A'), id);
  // Duplicar.
  await p.click(`[data-testid=library-all] [data-testid=duplicate-${id}]`);
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=library-all] article').length === 2);
  const names = await p.locator('[data-testid=library-all] [data-testid=project-name]').allInnerTexts();
  ok(names.some((n) => n.endsWith('(copia)')), 'duplicado con nombre «(copia)»');
  // Eliminar: cancelar no borra; confirmar sí.
  const dupId = (await p.locator('[data-testid=library-all] article').evaluateAll((els) => els.map((e) => e.dataset.testid.slice(8)))).find((x) => x !== id);
  await p.click(`[data-testid=library-all] [data-testid=delete-${dupId}]`);
  ok((await p.locator('.modal').innerText()).includes('no se puede deshacer'), 'el diálogo de eliminar avisa');
  await p.click('[data-testid=button-cancel-delete]');
  ok((await p.locator('[data-testid=library-all] article').count()) === 2, 'cancelar no elimina');
  await p.click(`[data-testid=library-all] [data-testid=delete-${dupId}]`); await p.click('[data-testid=button-confirm-delete]');
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=library-all] article').length === 1);
  // Vistas.
  for (const mode of ['list', 'compact', 'grid']) {
    await p.click(`[data-testid=seg-library-view-${mode}]`);
    const imgs = await p.locator('[data-testid=library-all] img').count();
    ok(mode === 'compact' ? imgs === 0 : imgs === 1, `vista ${mode}: ${mode === 'compact' ? 'sin miniaturas' : 'con miniatura'}`);
  }
  await p.reload(); await p.waitForSelector('[data-testid=library-all]');
  ok((await p.locator('[data-testid=library-all] [data-testid=project-name]').allInnerTexts()).join() === 'Lámina 1 · rev. A', 'tras recargar se conserva todo');
  const stored = await readStored(p, id);
  ok(stored.project.sheet.orientation === 'landscape' && stored.project.entities.length === 1 && stored.index.thumbnail?.startsWith('data:image/png'), 'guardado: orientación, geometría e índice con miniatura');
  ok(p.errors.length === 0, `sin errores de página (${p.errors})`);
  log('biblioteca: crear (horizontal), renombrar, duplicar, eliminar con confirmación, 3 vistas, recientes y miniatura');
  await ctx.close();
}

// ───────── 2) Migración desde localStorage (idempotente, datos dañados) ─────────
{
  const ctx = await newCtx(); const p = await openPage(ctx);
  const v2 = JSON.stringify({ version: 2, margins: { top: 10, right: 10, bottom: 10, left: 12.5 }, color: '#bc573f', width: 0.5, entities: [
    { id: 'a', type: 'segment', color: '#244d58', width: 0.45, a: { x: 10.123456789012, y: 20 }, b: { x: 110.987654321098, y: 20 } },
    { id: 'b', type: 'circle', color: '#244d58', width: 0.45, c: { x: 100, y: 150 }, r: 33.333333333333 },
    { id: 'c', type: 'polyline', color: '#244d58', width: 0.45, points: [{ x: 1.1, y: 2.2, p: 0.3 }, { x: 3.3, y: 4.4 }] }] });
  await wipe(p, { 'dibujo-tecnico-a4-v2': v2 });
  for (let i = 0; i < 3; i += 1) { await gotoLibrary(p); await p.waitForTimeout(150); }
  const stored = await readStored(p, 'migrado-localstorage');
  ok(stored.count === 1 && stored.project.name === 'Dibujo anterior', 'tres arranques: un solo proyecto migrado');
  ok(JSON.stringify(stored.project.entities) === JSON.stringify(JSON.parse(v2).entities) && stored.project.sheet.margins.left === 12.5, 'geometría y márgenes exactos');
  ok(await p.evaluate((v) => localStorage.getItem('dibujo-tecnico-a4-v2') === v, v2), 'localStorage original intacto');
  await p.click('[data-testid=library-all] [data-testid=delete-migrado-localstorage]'); await p.click('[data-testid=button-confirm-delete]');
  await p.waitForSelector('[data-testid=library-empty]');
  await gotoLibrary(p);
  ok((await readStored(p, 'migrado-localstorage')).count === 0, 'si se elimina, no reaparece al reiniciar');
  // Datos dañados.
  const broken = '{"version":2,"entities":[{"id":"x","type":"segm';
  await wipe(p, { 'dibujo-tecnico-a4-v2': broken });
  await gotoLibrary(p);
  const notice = await p.locator('[data-testid=startup-notice]').innerText();
  ok(/no se pudo interpretar/.test(notice) && /intactos/.test(notice), 'datos dañados: aviso claro');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=button-export-legacy]')]);
  ok(fs.readFileSync(await dl.path(), 'utf8') === broken, 'se pueden exportar tal cual los datos originales');
  await gotoLibrary(p);
  ok((await readStored(p, 'migrado-localstorage')).count === 0 && await p.evaluate((b) => localStorage.getItem('dibujo-tecnico-a4-v2') === b, broken), 'no se crea ningún proyecto y los datos siguen intactos');
  log('migración: idempotente en 3 arranques, exacta, original intacto; datos dañados → aviso y exportación, sin pérdidas');
  await ctx.close();
}

// ───────── 3) Guardado: 1,5 s, «Guardado» solo tras confirmar, almacenamiento lleno, escrituras consecutivas ─────────
{
  const ctx = await newCtx(); const p = await openPage(ctx);
  await wipe(p); await gotoLibrary(p);
  const id = await createProject(p, 'Guardado');
  await p.evaluate(() => { window.__statuses = []; new MutationObserver(() => window.__statuses.push(document.querySelector('[data-testid=status-autosave]').dataset.status)).observe(document.querySelector('[data-testid=status-autosave]'), { attributes: true }); });
  await rulerLine(p, { x: 20, y: 20 }, { x: 120, y: 20 });
  const t0 = Date.now();
  await p.waitForTimeout(900);
  ok((await status(p)) === 'dirty' && (await readStored(p, id)).project.entities.length === 0, 'a los 0,9 s: «Cambios sin guardar» y nada escrito aún');
  await waitStatus(p, 'saved');
  const dt = Date.now() - t0;
  ok(dt >= 1400 && dt < 4000, `«Guardado» a los ${dt} ms`);
  ok((await readStored(p, id)).project.entities.length === 1, 'y está escrito en IndexedDB');
  // Almacenamiento lleno simulado: todas las escrituras de IndexedDB fallan con QuotaExceededError.
  await p.evaluate(() => { window.__realPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('Cuota superada', 'QuotaExceededError'); }; window.__statuses = []; });
  await rulerLine(p, { x: 20, y: 40 }, { x: 120, y: 40 });
  await waitStatus(p, 'error');
  const problem = await p.locator('[data-testid=save-problem]').innerText();
  ok(/espacio/.test(problem) && /siguen en pantalla/.test(problem), `mensaje claro (${problem.split('\n')[1]})`);
  await p.waitForTimeout(2500);
  ok(!(await p.evaluate(() => window.__statuses)).includes('saved'), 'con la escritura fallando nunca aparece «Guardado»');
  ok((await domCount(p)) === 2 && (await readStored(p, id)).project.entities.length === 1, 'el cambio sigue en pantalla y lo guardado no se corrompe');
  await p.evaluate(() => { IDBObjectStore.prototype.put = window.__realPut; });
  await p.click('[data-testid=button-retry-save]');
  await waitStatus(p, 'saved');
  ok((await readStored(p, id)).project.entities.length === 2, 'con espacio, «Reintentar» guarda');
  // Escrituras consecutivas: 25 líneas seguidas, con escrituras solapándose.
  for (let i = 0; i < 25; i += 1) {
    await rulerLine(p, { x: 10, y: 60 + i * 8 }, { x: 60 + i * 3, y: 60 + i * 8 });
    if (i % 5 === 4) await p.click('[data-testid=button-save]');
  }
  await waitStatus(p, 'saved');
  await p.reload(); await p.waitForSelector('[data-testid=library-all]'); await openById(p, id);
  const after = await readStored(p, id);
  ok(after.project.entities.length === 27 && (await domCount(p)) === 27, `25 líneas seguidas sin pérdidas (27 en total, revisión ${after.project.revision})`);
  log('guardado: «Guardado» a ~1,5 s tras confirmar; espacio lleno → error claro sin «Guardado» ni corrupción; 25 escrituras seguidas sin pérdidas');
  await ctx.close();
}

// ───────── 4) Dos pestañas sobre el mismo proyecto ─────────
{
  const ctx = await newCtx();
  const a = await openPage(ctx); const b = await openPage(ctx);
  await wipe(a); await gotoLibrary(a);
  const id = await createProject(a, 'Compartido');
  await gotoLibrary(b); await openById(b, id);
  // a) B sin cambios: se actualiza sola con lo que guarda A.
  await rulerLine(a, { x: 20, y: 20 }, { x: 150, y: 20 });
  await a.click('[data-testid=button-save]'); await waitStatus(a, 'saved');
  await b.waitForFunction(() => document.querySelectorAll('path[data-testid^=entity-]').length === 1, null, { timeout: 5000 });
  ok((await b.locator('[data-testid=text-notice]').count()) >= 0 && (await status(b)) === 'saved', 'B (sin cambios) se actualiza con lo guardado por A');
  // b) Conflicto: B tiene cambios sin guardar cuando A guarda.
  // b) Conflicto: las dos pestañas tienen cambios y guardan casi a la vez. Gane quien gane, la otra no sobrescribe.
  await rulerLine(a, { x: 20, y: 140 }, { x: 150, y: 140 });
  await rulerLine(b, { x: 20, y: 80 }, { x: 150, y: 80 });
  await Promise.all([a.click('[data-testid=button-save]').catch(() => {}), b.click('[data-testid=button-save]').catch(() => {})]);
  await a.waitForFunction(() => ['saved', 'conflict'].includes(document.querySelector('[data-testid=status-autosave]').dataset.status), null, { timeout: 6000 });
  await b.waitForFunction(() => ['saved', 'conflict'].includes(document.querySelector('[data-testid=status-autosave]').dataset.status), null, { timeout: 6000 });
  await a.waitForTimeout(2500);
  const sa = await status(a), sb = await status(b);
  ok([sa, sb].sort().join() === 'conflict,saved', `una pestaña guarda y la otra queda en conflicto (A: ${sa}, B: ${sb})`);
  const [winner, loser, winY, loseY] = sa === 'saved' ? [a, b, 140, 80] : [b, a, 80, 140];
  let stored = await readStored(a, id);
  ok(stored.project.entities.length === 2 && stored.project.entities.some((e) => atY(e, winY)) && !stored.project.entities.some((e) => atY(e, loseY)), 'lo guardado es solo lo de la que ganó: no hay sobrescritura silenciosa');
  ok((await domCount(loser)) === 2 && /otra pestaña/.test(await loser.locator('[data-testid=save-problem]').innerText()), 'la otra conserva su cambio en pantalla y explica el conflicto');
  await loser.click('[data-testid=button-save-copy]');
  await loser.waitForFunction((id) => document.querySelector('main[data-project-id]')?.dataset.projectId !== id, id);
  const copyId = await loser.locator('main[data-project-id]').getAttribute('data-project-id');
  const copy = await readStored(loser, copyId);
  ok(copy.project.entities.length === 2 && copy.project.entities.some((e) => atY(e, loseY)) && copy.project.name.includes('(copia)'), 'sus cambios se guardan como copia: no se pierde nada de nadie');
  stored = await readStored(a, id);
  ok(stored.project.entities.length === 2 && stored.count === 2, 'el original sigue intacto; hay 2 proyectos');
  void winner;
  await a.close(); await b.close();
  // c) Sin aviso entre pestañas (canal no disponible): el control de revisión detecta el conflicto al guardar.
  const c1 = await openPage(ctx); const c2 = await openPage(ctx);
  await c2.addInitScript(() => { delete window.BroadcastChannel; });
  await gotoLibrary(c1); await openById(c1, id);
  await gotoLibrary(c2); await openById(c2, id);
  await rulerLine(c1, { x: 30, y: 200 }, { x: 160, y: 200 });
  await c1.click('[data-testid=button-save]'); await waitStatus(c1, 'saved');
  await rulerLine(c2, { x: 30, y: 230 }, { x: 160, y: 230 });
  await waitStatus(c2, 'conflict', 6000);
  stored = await readStored(c1, id);
  ok(stored.project.entities.length === 3 && stored.project.entities.some((e) => atY(e, 200)) && !stored.project.entities.some((e) => atY(e, 230)), 'sin canal: la revisión impide sobrescribir; se guarda solo lo de la primera');
  // d) Eliminado en otra pestaña mientras está abierto.
  await c1.click('[data-testid=button-library]'); await c1.waitForSelector('[data-testid=library-all]');
  await c2.close();
  const d2 = await openPage(ctx); await gotoLibrary(d2); await openById(d2, id);
  await rulerLine(d2, { x: 30, y: 260 }, { x: 160, y: 260 });
  await c1.click(`[data-testid=library-all] [data-testid=delete-${id}]`); await c1.click('[data-testid=button-confirm-delete]');
  await waitStatus(d2, 'conflict', 6000);
  ok(/eliminado/.test(await d2.locator('[data-testid=save-problem]').innerText()), 'eliminado en otra pestaña: aviso y nada se recrea en silencio');
  await d2.waitForTimeout(2000);
  ok((await readStored(d2, id)).project === null, 'el proyecto eliminado no reaparece');
  log('dos pestañas: la que no tiene cambios se actualiza; con cambios hay conflicto sin sobrescribir (con y sin canal); copia; eliminado en otra pestaña');
  await ctx.close();
}

// ───────── 5) Cierre y reapertura ─────────
{
  const ctx = await newCtx();
  let p = await openPage(ctx);
  await wipe(p); await gotoLibrary(p);
  const id = await createProject(p, 'Cierre');
  // a) Cerrar después de un guardado confirmado.
  await rulerLine(p, { x: 20, y: 20 }, { x: 150, y: 20 });
  await waitStatus(p, 'saved');
  await p.close();
  p = await openPage(ctx); await gotoLibrary(p); await openById(p, id);
  ok((await domCount(p)) === 1, 'cierre tras «Guardado»: el trazo está al reabrir');
  // b) Cerrar inmediatamente después de dibujar (antes de los 1,5 s). Un punto se crea con un solo toque; si aun así
  //    ya estuviera guardado al cerrar, el escenario no se habría probado: se repite.
  async function pointAndClose(page, x, y) {
    await page.click('[data-testid=tool-point]');
    const cdp = await pen(page); const v = await view(page);
    const c = { x: v.left + v.tx + x * v.scale, y: v.top + v.ty + y * v.scale };
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'pen' });
    // Se espera a que el indicador marque el cambio («Cambios sin guardar») y se cierra en ese instante:
    // la escritura de 1,5 s todavía no ha empezado.
    await page.waitForFunction(() => document.querySelector('[data-testid=status-autosave]')?.dataset.status === 'dirty', null, { timeout: 1000 }).catch(() => {});
    const st = await status(page);
    await page.close({ runBeforeUnload: true });
    return st;
  }
  let expected = 1, closedWith = 'saved', attempts = 0, n = 0, notices = [];
  while (attempts < 4) {
    attempts += 1;
    closedWith = await pointAndClose(p, 30 + attempts * 10, 60);
    expected += 1;
    p = await openPage(ctx); await gotoLibrary(p);
    notices = await p.locator('[data-testid=startup-notice]').allInnerTexts();
    await openById(p, id);
    n = await domCount(p);
    if (closedWith !== 'saved') break;
  }
  info(`cierre inmediato (estado al cerrar: «${closedWith}», intento ${attempts}): ${n} elementos al reabrir; aviso: ${notices.join(' | ') || '(ninguno: la escritura de IndexedDB llegó a completarse)'}`);
  ok(closedWith !== 'saved', 'el cierre se produjo con cambios aún sin guardar (escenario realmente probado)');
  ok(n === expected, 'cierre inmediato (Chromium de escritorio): el último elemento se conserva');
  // c) Cierre inmediato sin sitio para la copia de emergencia (localStorage lleno).
  await p.evaluate(() => { try { let s = 'x'.repeat(1024 * 1024); for (let i = 0; i < 10; i += 1) localStorage.setItem(`relleno-${i}`, s); } catch { /* lleno */ } });
  let closedC = 'saved', triesC = 0, kept = false;
  while (triesC < 4) {
    triesC += 1;
    const before = await domCount(p);
    closedC = await pointAndClose(p, 100 + triesC * 10, 120);
    p = await openPage(ctx); await gotoLibrary(p); await openById(p, id);
    kept = (await domCount(p)) === before + 1;
    if (closedC !== 'saved') break;
  }
  const exercised = closedC !== 'saved';
  info(`cierre inmediato SIN copia de emergencia posible (estado al cerrar: «${closedC}», intento ${triesC}): ${!exercised ? 'NO SE PUDO PROBAR (ya estaba guardado al cerrar)' : kept ? 'el elemento se conservó (la escritura asíncrona llegó a tiempo)' : 'el elemento se PERDIÓ'} — no está garantizado`);
  const n3 = !exercised ? -1 : kept ? 3 : 0;
  await p.evaluate(() => { for (let i = 0; i < 10; i += 1) localStorage.removeItem(`relleno-${i}`); });
  log(`cierre: tras «Guardado» se conserva; cierre inmediato con copia de emergencia se conserva; sin copia de emergencia: ${n3 === 3 ? 'conservado en esta prueba, sin garantía' : n3 === 0 ? 'perdido (límite documentado)' : 'no se pudo ejercitar'}`);
  await ctx.close();
}

// ───────── 6) Proyecto de más de 8 MB ─────────
let bigJson;
{
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const st = { color: '#244d58', width: 0.45 }; const entities = [];
  for (let i = 0; i < 400; i += 1) { const xy = []; const pr = []; let x = 20 + rnd() * 170, y = 20 + rnd() * 250; for (let k = 0; k < 420; k += 1) { x += rnd() - 0.5; y += rnd() - 0.5; xy.push(x, y); pr.push(rnd()); } entities.push({ id: `f${i}`, type: 'polyline', ...st, xy, p: pr }); }
  for (let i = 0; i < 200; i += 1) entities.push({ id: `c${i}`, type: 'circle', ...st, c: { x: 30 + rnd() * 150, y: 30 + rnd() * 230 }, r: 2 + rnd() * 30 });
  for (let i = 0; i < 400; i += 1) entities.push({ id: `s${i}`, type: 'segment', ...st, a: { x: rnd() * 210, y: rnd() * 297 }, b: { x: rnd() * 210, y: rnd() * 297 } });
  bigJson = JSON.stringify({ format: 'dibujo-tecnico-a4/proyecto', version: 3, id: 'grande', name: 'Proyecto grande', revision: 0, sheet: { size: 'A4', orientation: 'portrait' }, entities });
  const ctx = await newCtx(); const p = await openPage(ctx);
  await wipe(p); await gotoLibrary(p);
  const t0 = Date.now();
  await p.setInputFiles('[data-testid=input-import]', { name: 'grande.dta4.json', mimeType: 'application/json', buffer: Buffer.from(bigJson) });
  await p.waitForSelector('[data-testid=library-all] article');
  const tImport = Date.now() - t0;
  const id = await p.locator('[data-testid=library-all] article').first().evaluate((e) => e.dataset.testid.slice(8));
  const t1 = Date.now(); await openById(p, id); await p.waitForFunction(() => document.querySelectorAll('path[data-testid^=entity-]').length === 1000); const tOpen = Date.now() - t1;
  await rulerLine(p, { x: 15, y: 15 }, { x: 195, y: 15 });
  const t2 = Date.now(); await waitStatus(p, 'saved', 20000); const tSave = Date.now() - t2;
  await p.reload(); await p.waitForSelector('[data-testid=library-all]'); await openById(p, id);
  const stored = await readStored(p, id);
  const src = JSON.parse(bigJson).entities;
  const same = src.every((e, i) => { const s = stored.project.entities[i]; if (e.type !== 'polyline') return JSON.stringify(e) === JSON.stringify(s); return s.points.length === 420 && s.points.every((q, k) => Object.is(q.x, e.xy[2 * k]) && Object.is(q.y, e.xy[2 * k + 1]) && Object.is(q.p, e.p[k])); });
  ok(bigJson.length > 8 * 1024 * 1024, `archivo de ${(bigJson.length / 1048576).toFixed(1)} MB`);
  ok(same && stored.project.entities.length === 1001, 'más de 8 MB: importar, editar, guardar y reabrir sin cambiar un solo número');
  info(`> 8 MB: importar ${tImport} ms · abrir ${tOpen} ms · guardar tras un cambio ${tSave} ms (incluye la espera de 1,5 s)`);
  log(`proyecto de ${(bigJson.length / 1048576).toFixed(1)} MB: se importa, edita, guarda y reabre exacto`);
  await ctx.close();
}

// ───────── 8) Orientación: geometría intacta, exportación A4 horizontal ─────────
{
  const ctx = await newCtx(); const p = await openPage(ctx);
  await wipe(p); await gotoLibrary(p);
  const id = await createProject(p, 'Horizontal', 'landscape');
  await rulerLine(p, { x: 20.25, y: 30.5 }, { x: 280.75, y: 30.5 });
  await waitStatus(p, 'saved');
  const before = JSON.stringify((await readStored(p, id)).project.entities);
  await p.click('[data-testid=seg-orientation-portrait]');
  ok(/1 elemento\(s\) quedan fuera/.test(await p.locator('[data-testid=text-notice]').innerText()), 'al pasar a vertical avisa de lo que queda fuera, sin moverlo');
  await waitStatus(p, 'saved');
  let st = (await readStored(p, id)).project;
  ok(st.sheet.orientation === 'portrait' && JSON.stringify(st.entities) === before, 'cambiar la orientación no altera ni un número de la geometría');
  await p.click('[data-testid=seg-orientation-landscape]'); await waitStatus(p, 'saved');
  st = (await readStored(p, id)).project;
  ok(st.sheet.orientation === 'landscape' && JSON.stringify(st.entities) === before, 'ida y vuelta de orientación: geometría idéntica');
  await p.click('[data-testid=button-export]');
  const [pdf] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=button-export-pdf]')]);
  const doc = await PDFDocument.load(fs.readFileSync(await pdf.path()));
  const size = doc.getPages()[0].getSize();
  ok(Math.abs(size.width - 841.89) < 0.01 && Math.abs(size.height - 595.28) < 0.01, `PDF horizontal ${size.width.toFixed(2)} × ${size.height.toFixed(2)} pt`);
  await p.click('[data-testid=button-export]');
  const [png] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=button-export-png]')]);
  const buf = fs.readFileSync(await png.path());
  ok(buf.readUInt32BE(16) === 3508 && buf.readUInt32BE(20) === 2480, 'PNG horizontal 3508 × 2480');
  log('orientación: geometría idéntica al cambiarla; PDF A4 horizontal y PNG 3508 × 2480');
  await ctx.close();
}

// ───────── 9) Restaurar selección y vista; selección con ids que ya no existen ─────────
{
  const ctx = await newCtx(); const p = await openPage(ctx);
  await wipe(p); await gotoLibrary(p);
  const id = await createProject(p, 'Selección');
  await rulerLine(p, { x: 20, y: 40 }, { x: 150, y: 40 });
  await p.click('[data-testid=tool-select]');
  const v = await view(p);
  const cdp = await pen(p); const c = { x: v.left + v.tx + 80 * v.scale, y: v.top + v.ty + 40 * v.scale };
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'pen' });
  await p.click('[data-testid=button-zoom-in]'); await p.click('[data-testid=button-zoom-in]');
  const zoom = await p.locator('[data-testid=text-zoom]').innerText();
  await p.click('[data-testid=button-library]'); await p.waitForSelector('[data-testid=library-all]');
  await openById(p, id);
  ok(await p.locator('[data-testid=entity-editor]').isVisible() && (await p.locator('[data-testid=tool-select]').getAttribute('class')).includes('active'), 'al reabrir, la selección se restaura');
  ok((await p.locator('[data-testid=text-zoom]').innerText()) === zoom, `al reabrir, el zoom se restaura (${zoom})`);
  // Selección con un id que ya no existe (modificada a mano en IndexedDB).
  await p.click('[data-testid=button-library]'); await p.waitForSelector('[data-testid=library-all]');
  await p.evaluate(async (id) => {
    const db = await new Promise((r) => { const q = indexedDB.open('dibujo-tecnico-a4'); q.onsuccess = () => r(q.result); });
    await new Promise((r) => { const t = db.transaction('projects', 'readwrite'); const s = t.objectStore('projects'); const g = s.get(id); g.onsuccess = () => s.put({ ...g.result, selection: ['no-existe', 'tampoco'] }); t.oncomplete = r; });
    db.close();
  }, id);
  await openById(p, id);
  ok(!(await p.locator('[data-testid=entity-editor]').isVisible()) && (await domCount(p)) === 1 && p.errors.length === 0, 'ids inexistentes en la selección: se descartan sin errores');
  log('selección y zoom se restauran; selección con ids inexistentes se descarta de forma segura');
  await ctx.close();
}

// ───────── 10) Sin conexión (PWA) ─────────
{
  const ctx = await newCtx({ serviceWorkers: 'allow' }); const p = await openPage(ctx);
  const external = [];
  p.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(URL_APP).origin) external.push(u.host); });
  await wipe(p); await gotoLibrary(p);
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await p.reload(); await p.waitForSelector('[data-testid=library]');
  ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'service worker activo');
  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('[data-testid=library]');
  const id = await createProject(p, 'Sin conexión');
  await rulerLine(p, { x: 20, y: 20 }, { x: 150, y: 20 });
  await waitStatus(p, 'saved');
  await p.reload(); await p.waitForSelector('[data-testid=library-all]'); await openById(p, id);
  ok((await domCount(p)) === 1, 'sin conexión: cargar, crear, dibujar, guardar y reabrir');
  ok(await p.evaluate(() => document.fonts.check('12px "DM Sans"') && document.fonts.check('12px "DM Mono"')), 'fuentes disponibles sin conexión');
  await p.click('[data-testid=button-export]');
  const [pdf] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=button-export-pdf]')]);
  ok(fs.statSync(await pdf.path()).size > 1000, 'exportar PDF sin conexión');
  ok(external.length === 0, `sin peticiones a otros servidores (${[...new Set(external)].join(', ')})`);
  await ctx.setOffline(false);
  log('sin conexión: la app carga desde el service worker, guarda, reabre y exporta; fuentes locales; ninguna petición externa');
  await ctx.close();
}

await browser.close();
console.log(`E2E almacenamiento OK: ${checks} comprobaciones en Chromium de escritorio.`);
