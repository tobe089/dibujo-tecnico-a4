// Prueba de extremo a extremo en Chromium real con eventos de lápiz (pointerType 'pen') y táctiles.
// Requisitos: Playwright disponible y la app servida (por ejemplo `pnpm run build` + `pnpm run serve`).
//   E2E_URL=http://localhost:4173/  PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs  node scripts/e2e-tools.mjs
// No forma parte del flujo de CI (no hay navegador allí); se ejecuta a mano.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const URL_APP = process.env.E2E_URL || 'http://localhost:4173/';
const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launch);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const cdp = await ctx.newCDPSession(page);

let checks = 0;
const ok = (c, m) => { checks += 1; assert.ok(c, m); };
const near = (a, b, eps, m) => ok(Math.abs(a - b) <= eps, `${m}: ${a} ≠ ${b} (±${eps})`);
const log = (m) => console.log(`  ✓ ${m}`);

const ORIGIN_FILE = new URL('robots.txt', URL_APP).href;
/** Borra IndexedDB y localStorage desde un archivo estático del mismo origen (la app no está abierta). */
async function wipe(storage = null) {
  await page.goto(ORIGIN_FILE);
  await page.evaluate(async (s) => {
    localStorage.clear();
    await new Promise((r) => { const q = indexedDB.deleteDatabase('dibujo-tecnico-a4'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    if (s) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, storage);
}
/** Estado limpio. open: 'new' crea un proyecto vacío; 'legacy' abre el migrado; null se queda en la biblioteca. */
async function fresh(storage = null, { open = storage ? 'legacy' : 'new', orientation = 'portrait' } = {}) {
  await wipe(storage);
  await page.goto(URL_APP);
  await page.waitForSelector('[data-testid=library]');
  if (open === 'new') {
    await page.click('[data-testid=button-new-project]');
    if (orientation === 'landscape') await page.click('[data-testid=seg-new-orientation-landscape]');
    await page.click('[data-testid=button-create-project]');
  } else if (open === 'legacy') {
    await page.click('[data-testid=open-migrado-localstorage]');
  }
  if (open) await afterOpen();
}
/** Recarga la app y reabre el primer proyecto de la biblioteca. */
async function reloadAndReopen() {
  await page.reload();
  await page.waitForSelector('[data-testid=library-all]');
  await page.locator('[data-testid=library-all] .lib-open').first().click();
  await afterOpen();
}
async function afterOpen() {
  await page.waitForSelector('[data-testid=drawing-sheet]');
  // Registro de las coordenadas reales que recibe el navegador (para comprobar que no se redondean).
  await page.evaluate(() => {
    window.__downs = []; window.__ups = [];
    const svg = document.querySelector('[data-testid=drawing-sheet]');
    svg.addEventListener('pointerdown', (e) => window.__downs.push({ x: e.clientX, y: e.clientY, t: e.pointerType, id: e.pointerId }), true);
    svg.addEventListener('pointerup', (e) => window.__ups.push({ x: e.clientX, y: e.clientY, t: e.pointerType }), true);
  });
}
/** Proyecto abierto tal como está GUARDADO en IndexedDB (desempaquetado). */
const readProject = () => page.evaluate(async () => {
  const id = document.querySelector('[data-project-id]')?.dataset.projectId;
  const db = await new Promise((res, rej) => { const r = indexedDB.open('dibujo-tecnico-a4'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const raw = await new Promise((res) => { const q = db.transaction('projects').objectStore('projects').get(id); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
  db.close();
  const unpack = (e) => {
    if (e.type !== 'polyline' || !Array.isArray(e.xy)) return e;
    const points = [];
    for (let i = 0; i + 1 < e.xy.length; i += 2) { const p = { x: e.xy[i], y: e.xy[i + 1] }; const pr = Array.isArray(e.p) ? e.p[i / 2] : null; if (Number.isFinite(pr)) p.p = pr; points.push(p); }
    const { xy, p, ...rest } = e; return { ...rest, points };
  };
  return raw ? { ...raw, entities: raw.entities.map(unpack) } : null;
});
/** Espera a que el indicador diga «Guardado» (escritura confirmada). */
async function waitSaved() {
  await page.waitForTimeout(80);
  await page.waitForFunction(() => document.querySelector('[data-testid=status-autosave]')?.dataset.status === 'saved', null, { timeout: 10000 });
}
const view = () => page.evaluate(() => {
  const svg = document.querySelector('[data-testid=drawing-sheet]');
  const r = svg.getBoundingClientRect();
  return { scale: Number(svg.dataset.scale), tx: Number(svg.dataset.tx), ty: Number(svg.dataset.ty), left: r.left, top: r.top };
});
const toClient = async (x, y) => { const v = await view(); return { x: v.left + v.tx + x * v.scale, y: v.top + v.ty + y * v.scale }; };
const clientToDoc = (v, c) => ({ x: (c.x - v.left - v.tx) / v.scale, y: (c.y - v.top - v.ty) / v.scale });
const entities = async () => { await waitSaved(); return (await readProject()).entities; };
const pen = (type, p, buttons = 1) => cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: buttons || type !== 'mouseMoved' ? 'left' : 'none', buttons, clickCount: 1, pointerType: 'pen', force: 0.5 });
async function penTap(x, y) { const p = await toClient(x, y); await pen('mouseMoved', p, 0); await pen('mousePressed', p); await pen('mouseReleased', p, 0); await page.waitForTimeout(30); return p; }
async function penDrag(from, to, steps = 12) {
  const a = await toClient(from.x, from.y), b = await toClient(to.x, to.y);
  await pen('mouseMoved', a, 0); await pen('mousePressed', a);
  for (let i = 1; i <= steps; i += 1) await pen('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps });
  await pen('mouseReleased', b, 0); await page.waitForTimeout(30);
}
/** Trazo del lápiz por una lista de puntos (mm de hoja). Devuelve las posiciones de cliente usadas. */
async function penPath(points, { release = true } = {}) {
  const cs = []; for (const q of points) cs.push(await toClient(q.x, q.y));
  await pen('mouseMoved', cs[0], 0); await pen('mousePressed', cs[0]);
  for (const c of cs.slice(1)) await pen('mouseMoved', c);
  if (release) { await pen('mouseReleased', cs.at(-1), 0); await page.waitForTimeout(30); }
  return cs;
}
/** Puntos sobre una circunferencia de `from` a `to` grados (0° = derecha, 90° = arriba), con radio variable. */
const arcPts = (c, r, from, to, step = 3, radial = () => 0) => {
  const n = Math.max(1, Math.round(Math.abs(to - from) / step)); const out = [];
  for (let i = 0; i <= n; i += 1) { const a = (from + (to - from) * i / n) * Math.PI / 180; const rr = r + radial(i); out.push({ x: c.x + rr * Math.cos(a), y: c.y - rr * Math.sin(a) }); }
  return out;
};
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const lastDown = () => page.evaluate(() => window.__downs.at(-1));

// ───────── 1) Regla: dos toques definen exactamente los extremos ─────────
await fresh();
await page.click('[data-testid=tool-ruler]');
await penTap(50.3, 100.7);
const vA = await view(); const dA = clientToDoc(vA, await lastDown());
await penTap(130.9, 100.2);
const dB = clientToDoc(vA, await lastDown());
let ents = await entities();
ok(ents.length === 1 && ents[0].type === 'segment', 'la regla crea un segmento al marcar el segundo punto');
near(ents[0].a.x, dA.x, 1e-9, 'inicio = punto tocado (x)'); near(ents[0].a.y, dA.y, 1e-9, 'inicio = punto tocado (y)');
near(ents[0].b.x, dB.x, 1e-9, 'final = punto tocado (x)'); near(ents[0].b.y, dB.y, 1e-9, 'final = punto tocado (y)');
near(ents[0].a.x, 50.3, 1 / vA.scale, 'inicio a menos de 1 px del objetivo');
const len1 = Math.hypot(ents[0].b.x - ents[0].a.x, ents[0].b.y - ents[0].a.y);
ok(Math.abs(len1 - Math.hypot(80.6, 0.5)) < 2 / vA.scale, `longitud según los toques (${len1})`);
ok(!Number.isInteger(ents[0].a.x * 100) || !Number.isInteger(ents[0].b.y * 100), 'las coordenadas no se redondean a la cuadrícula');
log(`regla por dos toques: ${len1.toFixed(4)} mm, extremos idénticos a los toques`);

// Tercer toque empieza una línea nueva sin alterar la anterior.
await penTap(20, 200);
ok((await page.locator('[data-testid=status-ruler] b').innerText()).includes('02'), 'el tercer toque fija un nuevo inicio');
ents = await entities(); ok(ents.length === 1 && ents[0].b.x === dB.x, 'la línea anterior queda intacta');
// Longitud y ángulo numéricos desde ese inicio.
await page.fill('[data-testid=input-rule-length]', '80');
await page.fill('[data-testid=input-rule-angle]', '30,5');
await page.click('[data-testid=button-place-line]');
ents = await entities();
const s2 = ents[1];
near(Math.hypot(s2.b.x - s2.a.x, s2.b.y - s2.a.y), 80, 1e-9, 'longitud numérica exacta');
near(((Math.atan2(-(s2.b.y - s2.a.y), s2.b.x - s2.a.x) * 180 / Math.PI) + 360) % 360, 30.5, 1e-9, 'ángulo numérico exacto (coma decimal)');
log('regla numérica: 80 mm a 30,5° exactos; la coma decimal se acepta');

// Arrastre: del punto de apoyo al de levantado.
await penDrag({ x: 30, y: 250 }, { x: 170.4, y: 230.1 });
ents = await entities();
const s3 = ents[2]; const ups = await page.evaluate(() => window.__ups.at(-1)); const vC = await view();
const upDoc = clientToDoc(vC, ups);
near(s3.b.x, upDoc.x, 1e-9, 'arrastre: final exacto x'); near(s3.b.y, upDoc.y, 1e-9, 'arrastre: final exacto y');
log('regla por arrastre: final = punto donde se levanta el lápiz');

// ───────── 2) Compás: definir la guía no crea nada; centro y radio = puntos tocados (sin imán al extremo cercano) ─────────
const guide = () => page.evaluate(() => {
  const g = document.querySelector('[data-testid=compass-guide]');
  return g ? { cx: Number(g.dataset.cx), cy: Number(g.dataset.cy), r: Number(g.dataset.r), rotation: Number(g.dataset.rotation) } : null;
});
await page.click('[data-testid=tool-compass]');
const cTarget = { x: ents[0].a.x + 3, y: ents[0].a.y + 1.5 }; // a 3,4 mm de un extremo existente
await penTap(cTarget.x, cTarget.y);
const vD = await view(); const cDoc = clientToDoc(vD, await lastDown());
const rTarget = { x: cTarget.x + 30 * Math.cos(20 * Math.PI / 180), y: cTarget.y - 30 * Math.sin(20 * Math.PI / 180) };
await penTap(rTarget.x, rTarget.y);
const rDoc = clientToDoc(vD, await lastDown());
const nBefore = ents.length;
ents = await entities();
ok(ents.length === nBefore, 'definir el compás con dos toques NO crea ninguna figura');
const g2 = await guide();
ok(g2 && g2.cx === cDoc.x && g2.cy === cDoc.y, 'guía: centro = primer toque exacto');
ok(Math.hypot(g2.cx - ents[0].a.x, g2.cy - ents[0].a.y) > 3, 'el centro NO salta al extremo cercano');
near(g2.r, Math.hypot(rDoc.x - cDoc.x, rDoc.y - cDoc.y), 1e-12, 'guía: radio = distancia exacta entre toques');
near(g2.r, 30, 1.5 / vD.scale, 'radio ≈ 30 mm según los toques');
// Trazar con el S Pen una vuelta y algo más sobre la guía: circunferencia con el centro y el radio exactos de la guía.
await penPath(arcPts({ x: g2.cx, y: g2.cy }, g2.r, 200, 200 + 375, 4, () => 0.6));
ents = await entities();
const circ = ents.at(-1);
ok(ents.length === nBefore + 1 && circ.type === 'circle' && circ.c.x === g2.cx && circ.c.y === g2.cy && circ.r === g2.r, 'trazar más de 360° sobre la guía: una circunferencia con el centro y el radio exactos');
log(`compás: dos toques definen la guía sin dibujar; trazar la vuelta completa → circunferencia r = ${circ.r.toFixed(4)} mm exacto`);

// Arco trazado en sentido antihorario de 0° a 90°, con el centro y el radio marcados con toques.
await page.click('[data-testid=button-compass-relocate]');
await penTap(150, 60); await penTap(170, 60);
await penPath(arcPts({ x: 150, y: 60 }, 20, 0, 90, 3));
ents = await entities();
const arc = ents.at(-1);
ok(arc.type === 'arc', 'arco creado');
near(arc.start, 0, 0.2, 'inicio del arco ≈ 0°'); near(arc.sweep, 90, 0.2, 'barrido ≈ 90°');
// El SVG dibuja el arco en el sentido correcto: el punto medio del trazado está a 45°.
const mid = await page.evaluate((id) => { const p = document.querySelector(`[data-testid="entity-${id}"]`); const L = p.getTotalLength(); const q = p.getPointAtLength(L / 2); return { x: q.x, y: q.y }; }, arc.id);
const expMid = { x: arc.c.x + arc.r * Math.cos((arc.start + arc.sweep / 2) * Math.PI / 180), y: arc.c.y - arc.r * Math.sin((arc.start + arc.sweep / 2) * Math.PI / 180) };
near(Math.hypot(mid.x - expMid.x, mid.y - expMid.y), 0, 0.01, 'el arco SVG pasa por su punto medio teórico');
log('compás: arco trazado sobre la guía, sentido antihorario correcto en pantalla');

// ───────── 3) Borrador parcial ─────────
await page.click('[data-testid=tool-eraser]');
const before = await entities();
const seg0 = before[0];
const midSeg = { x: (seg0.a.x + seg0.b.x) / 2, y: (seg0.a.y + seg0.b.y) / 2 };
await penDrag({ x: midSeg.x, y: midSeg.y - 8 }, { x: midSeg.x, y: midSeg.y + 8 });
ents = await entities();
const pieces = ents.filter((e) => e.type === 'segment' && Math.abs((e.a.y + e.b.y) / 2 - midSeg.y) < 2 && Math.min(e.a.x, e.b.x) < midSeg.x + 50 && Math.max(e.a.x, e.b.x) > 40);
ok(pieces.length === 2, `el segmento queda en dos trozos (${pieces.length})`);
const cross = (p) => (seg0.b.x - seg0.a.x) * (p.y - seg0.a.y) - (seg0.b.y - seg0.a.y) * (p.x - seg0.a.x);
for (const pc of pieces) { near(cross(pc.a), 0, 1e-9, 'trozo sobre la recta original (a)'); near(cross(pc.b), 0, 1e-9, 'trozo sobre la recta original (b)'); }
ok(pieces.some((pc) => pc.a.x === seg0.a.x && pc.a.y === seg0.a.y), 'el extremo original se conserva exacto');
const circleBefore = before.find((e) => e.type === 'circle');
const top = { x: circleBefore.c.x, y: circleBefore.c.y - circleBefore.r };
await penDrag({ x: top.x - 1, y: top.y - 6 }, { x: top.x + 1, y: top.y + 6 });
ents = await entities();
const fromCircle = ents.filter((e) => e.type === 'arc' && e.r === circleBefore.r && e.c.x === circleBefore.c.x);
ok(fromCircle.length === 1 && !ents.some((e) => e.type === 'circle' && e.id === circleBefore.id && e.type === 'circle'), 'la circunferencia queda como un arco con el mismo centro y radio');
ok(fromCircle[0].sweep < 360 && fromCircle[0].sweep > 300, 'se borró solo un tramo pequeño');
await page.click('[data-testid=button-undo]');
ents = await entities(); ok(ents.some((e) => e.id === circleBefore.id && e.type === 'circle'), 'Deshacer recupera la circunferencia');
await page.click('[data-testid=button-undo]');
ents = await entities(); ok(ents.length === before.length, 'Deshacer recupera el segmento');
log('borrador parcial: segmento en dos trozos exactos, círculo → arco; Deshacer lo recupera');

// ───────── 4) Selección y edición exacta ─────────
await page.click('[data-testid=tool-select]');
await penTap(midSeg.x, midSeg.y);
ok(await page.locator('[data-testid=entity-editor]').isVisible(), 'editor visible al seleccionar');
await page.fill('[data-testid=edit-seg-length]', '42.125'); await page.press('[data-testid=edit-seg-length]', 'Enter');
ents = await entities();
const edited = ents.find((e) => e.id === seg0.id);
near(Math.hypot(edited.b.x - edited.a.x, edited.b.y - edited.a.y), 42.125, 1e-9, 'longitud editada exacta');
ok(edited.a.x === seg0.a.x && edited.a.y === seg0.a.y, 'el inicio no cambia al editar la longitud');
// Enfocar y salir sin escribir no altera el valor exacto.
await page.click('[data-testid=edit-seg-ax]'); await page.click('[data-testid=edit-seg-ay]'); await page.click('[data-testid=tool-select]');
ents = await entities(); ok(ents.find((e) => e.id === seg0.id).a.x === seg0.a.x, 'enfocar un campo no redondea el valor');
log('edición numérica exacta; enfocar un campo no redondea');

// ───────── 5) Zoom anclado ─────────
const vz0 = await view(); const stageMid = { x: vz0.left + (await page.locator('[data-testid=drawing-sheet]').boundingBox()).width / 2, y: vz0.top + (await page.locator('[data-testid=drawing-sheet]').boundingBox()).height / 2 };
const docMid0 = clientToDoc(vz0, stageMid);
await page.click('[data-testid=button-zoom-in]');
const docMid1 = clientToDoc(await view(), stageMid);
near(docMid1.x, docMid0.x, 1e-6, 'zoom con botón centrado (x)'); near(docMid1.y, docMid0.y, 1e-6, 'zoom con botón centrado (y)');
await page.click('[data-testid=button-fit]');
log('zoom con botón: el centro de la pantalla no se desplaza');

// ───────── 6) Dedo: dibuja si se elige; dos dedos pellizcan y cancelan; palma ignorada con lápiz ─────────
await fresh();
await page.click('[data-testid=seg-finger-mode-all]');
await page.click('[data-testid=tool-pen]');
let p0 = await toClient(40, 40);
await touch('touchStart', [{ x: p0.x, y: p0.y, id: 1 }]);
for (let i = 1; i <= 10; i += 1) await touch('touchMove', [{ x: p0.x + i * 10, y: p0.y, id: 1 }]);
await touch('touchEnd', []);
ents = await entities();
ok(ents.length === 1 && ents[0].type === 'polyline', "con «Dedo dibuja», el dedo dibuja");
// Pellizco: el primer dedo empieza a dibujar y el segundo convierte el gesto en zoom.
const vp0 = await view();
const a0 = { x: 700, y: 400 }, b0 = { x: 900, y: 400 };
const anchorDoc = clientToDoc(vp0, { x: 800, y: 400 });
await touch('touchStart', [{ ...a0, id: 1 }]);
await touch('touchMove', [{ x: a0.x - 3, y: a0.y, id: 1 }]);
await touch('touchStart', [{ x: a0.x - 3, y: a0.y, id: 1 }, { ...b0, id: 2 }]);
for (let i = 1; i <= 10; i += 1) await touch('touchMove', [{ x: a0.x - 3 - i * 10, y: a0.y + i * 5, id: 1 }, { x: b0.x + i * 10, y: b0.y + i * 5, id: 2 }]);
const vp1 = await view();
await touch('touchEnd', []);
ents = await entities();
ok(ents.length === 1, 'el pellizco no deja ningún trazo');
ok(vp1.scale > vp0.scale * 1.5, 'el pellizco amplía');
const midNow = { x: ((a0.x - 103) + (b0.x + 100)) / 2, y: a0.y + 50 };
const anchorNow = clientToDoc(vp1, midNow);
near(anchorNow.x, anchorDoc.x, 0.3 / vp1.scale * 10, 'el punto bajo los dedos sigue bajo los dedos (x)');
near(anchorNow.y, anchorDoc.y, 0.3 / vp1.scale * 10, 'el punto bajo los dedos sigue bajo los dedos (y)');
log('dedo: dibuja si se elige; dos dedos amplían anclados y cancelan el trazo');
await page.click('[data-testid=button-fit]');
await page.click('[data-testid=seg-finger-mode-auto]');

// Lápiz con la palma apoyada encima de la hoja.
const vq = await view();
const base = await toClient(20, 120);
await pen('mouseMoved', base, 0); await pen('mousePressed', base);
for (let i = 1; i <= 10; i += 1) await pen('mouseMoved', { x: base.x + i * 15, y: base.y });
await touch('touchStart', [{ x: base.x + 150, y: base.y + 150, id: 7 }]);
for (let i = 11; i <= 20; i += 1) { await touch('touchMove', [{ x: base.x + 150 - i * 4, y: base.y + 150 - i * 6, id: 7 }]); await pen('mouseMoved', { x: base.x + i * 15, y: base.y }); }
await touch('touchEnd', []); await pen('mouseReleased', { x: base.x + 300, y: base.y }, 0);
ents = await entities();
const stroke = ents.at(-1);
const ys = stroke.points.map((q) => q.y);
ok(Math.max(...ys) - Math.min(...ys) < 1e-9, `con la palma apoyada el trazo no se deforma (Δy = ${Math.max(...ys) - Math.min(...ys)})`);
const vq2 = await view(); ok(vq2.tx === vq.tx && vq2.ty === vq.ty && vq2.scale === vq.scale, 'la palma no mueve la hoja');
ok(stroke.points.every((q) => q.p !== undefined), 'el trazo del lápiz guarda la presión');
// Tras usar el lápiz, en modo automático el dedo navega.
const vr = await view();
await page.waitForTimeout(700);
await touch('touchStart', [{ x: 800, y: 500, id: 3 }]); await touch('touchMove', [{ x: 760, y: 470, id: 3 }]); await touch('touchEnd', []);
const vr2 = await view();
ok(Math.abs(vr2.tx - vr.tx + 40) < 1e-6 && Math.abs(vr2.ty - vr.ty + 30) < 1e-6, 'tras detectar el lápiz, un dedo desplaza la hoja');
ok((await entities()).length === ents.length, 'y no dibuja');
// Fuera de la hoja también se puede desplazar.
await touch('touchStart', [{ x: 1350, y: 500, id: 4 }]); await touch('touchMove', [{ x: 1300, y: 500, id: 4 }]); await touch('touchEnd', []);
ok(Math.abs((await view()).tx - vr2.tx + 50) < 1e-6, 'arrastrar fuera de la hoja también desplaza');
log('palma ignorada mientras dibuja el lápiz; luego el dedo navega, también fuera de la hoja');

// ───────── 7) Migración de un dibujo v1 ─────────
const v1 = JSON.stringify({ strokes: [
  { id: 'l1', kind: 'line', color: '#bc573f', width: 0.5, points: [{ x: 10.5, y: 20.25 }, { x: 60.125, y: 20.25 }] },
  { id: 'c1', kind: 'circle', color: '#244d58', width: 0.45, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], meta: { center: { x: 100, y: 150 }, radius: 35.11, startDeg: 19.98, sweepDeg: 360 } },
  { id: 'f1', kind: 'free', color: '#252b2d', width: 0.6, points: [{ x: 5, y: 5, p: 0.5 }, { x: 9, y: 7, p: 0.5 }] },
], margins: { top: 10, right: 10, bottom: 10, left: 10 }, color: '#244d58', width: 0.45 });
await fresh({ 'dibujo-tecnico-a4-v1': v1 }, { open: null });
ok(await page.locator('[data-testid=startup-notice]').first().isVisible(), 'aviso de conversión visible en la biblioteca');
await page.click('[data-testid=open-migrado-localstorage]'); await afterOpen();
ents = await entities();
ok(ents.length === 3 && ents[0].type === 'segment' && ents[0].b.x === 60.125 && ents[1].type === 'circle' && ents[1].r === 35.11 && ents[2].type === 'polyline', 'v1 migrado con valores exactos');
ok(await page.evaluate(() => localStorage.getItem('dibujo-tecnico-a4-v1') !== null), 'la copia v1 se conserva');
await page.reload(); await page.waitForSelector('[data-testid=library]');
ok((await page.locator('[data-testid=library-all] article').count()) === 1 && (await page.locator('[data-testid=startup-notice]').count()) === 0, 'tras recargar: un solo proyecto y sin nuevo aviso');
await page.click('[data-testid=open-migrado-localstorage]'); await afterOpen();
ok((await entities()).length === 3, 'el proyecto migrado se reabre intacto');
log('migración v1 → biblioteca sin pérdidas ni duplicados; v1 conservado');

// ───────── 8) Exportación ─────────
await page.click('[data-testid=button-export]');
const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=button-export-pdf]')]);
ok(fs.statSync(await pdf.path()).size > 1000, 'PDF descargado');
await page.click('[data-testid=button-export]');
const [png] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=button-export-png]')]);
const buf = fs.readFileSync(await png.path());
ok(buf.readUInt32BE(16) === 2480 && buf.readUInt32BE(20) === 3508, 'PNG 2480 × 3508');
log('exportación PDF y PNG');


// ───────── 9) La navegación no altera lo guardado (coordenadas en mm de hoja) ─────────
{
  const docA = { version: 2, margins: { top: 10, right: 10, bottom: 10, left: 10 }, color: '#244d58', width: 0.45, entities: [
    { id: 's', type: 'segment', color: '#244d58', width: 0.45, a: { x: 12.345678901234, y: 56.789012345678 }, b: { x: 187.654321098765, y: 23.456789012345 } },
    { id: 'c', type: 'circle', color: '#244d58', width: 0.45, c: { x: 105.000000001, y: 148.5 }, r: 33.333333333333 },
    { id: 'a', type: 'arc', color: '#244d58', width: 0.45, c: { x: 60, y: 220 }, r: 17.77777, start: 12.3456789, sweep: 200.123456 } ] };
  await fresh({ 'dibujo-tecnico-a4-v2': JSON.stringify(docA) });
  await waitSaved();
  const rawBefore = JSON.stringify((await readProject()).entities);
  assert.deepEqual(JSON.parse(rawBefore), docA.entities); checks += 1;
  for (let i = 0; i < 3; i += 1) await page.click('[data-testid=button-zoom-in]');
  await page.mouse.move(700, 400); await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
  await page.mouse.wheel(120, 80);
  await touch('touchStart', [{ x: 700, y: 400, id: 1 }, { x: 800, y: 420, id: 2 }]);
  for (let i = 1; i <= 8; i += 1) await touch('touchMove', [{ x: 700 - i * 9, y: 400 - i * 3, id: 1 }, { x: 800 + i * 9, y: 420 + i * 7, id: 2 }]);
  await touch('touchEnd', []);
  await touch('touchStart', [{ x: 900, y: 500, id: 3 }]); await touch('touchMove', [{ x: 840, y: 460, id: 3 }]); await touch('touchEnd', []);
  await page.click('[data-testid=button-fit]');
  await page.waitForTimeout(1800);
  ok((await page.locator('[data-testid=status-autosave]').getAttribute('data-status')) === 'saved', 'la navegación no deja cambios pendientes');
  ok(rawBefore === JSON.stringify((await readProject()).entities), 'zoom, rueda, pellizco y desplazamiento no cambian ni un bit de lo guardado');
  ok(await page.locator('[data-testid=button-undo]').isDisabled(), 'la navegación no crea pasos de deshacer');
  log('navegación: coordenadas guardadas idénticas bit a bit');
}

// ───────── 10) G1: un toque con temblor no crea geometría; el arrastre real sí, con extremos exactos ─────────
async function penJitter(x, y, dxPx) {
  const p = await toClient(x, y);
  await pen('mouseMoved', p, 0); await pen('mousePressed', p);
  await pen('mouseMoved', { x: p.x + dxPx * 0.5, y: p.y }); await pen('mouseMoved', { x: p.x + dxPx, y: p.y });
  await pen('mouseReleased', { x: p.x + dxPx, y: p.y }, 0); await page.waitForTimeout(30);
}
{
  await fresh();
  for (const zoomSteps of [0, 4]) {
    await page.click('[data-testid=button-fit]');
    for (let i = 0; i < zoomSteps; i += 1) await page.click('[data-testid=button-zoom-in]');
    const v = await view();
    await page.click('[data-testid=tool-ruler]');
    for (const dx of [5, 9]) {
      await page.click('[data-testid=tool-ruler]');
      await penJitter(105, 148.5, dx);
      const down = clientToDoc(v, await lastDown());
      ok((await page.locator('[data-testid=status-ruler] b').innerText()).includes('02'), `regla: temblor de ${dx} px (zoom ${zoomSteps}) fija el inicio`);
      ok((await page.locator('[data-testid=text-rule-start]').innerText()).includes(`${Number(down.x.toFixed(3))}`), 'el inicio es el punto de apoyo');
      ok((await entities()).length === 0, `regla: temblor de ${dx} px no crea ninguna línea`);
    }
    await page.click('[data-testid=tool-compass]');
    await penJitter(105, 148.5, 9);
    ok((await page.locator('[data-testid=status-compass] b').innerText()).includes('02') && (await entities()).length === 0, `compás: temblor de 9 px (zoom ${zoomSteps}) fija el centro sin crear nada`);
    await page.click('[data-testid=tool-point]');
    await penJitter(100, 100, 9);
    const dP = clientToDoc(v, await lastDown());
    const pts = await entities();
    ok(pts.length === 1 && pts[0].type === 'point' && Math.abs(pts[0].x - dP.x) < 1e-9 && Math.abs(pts[0].y - dP.y) < 1e-9, `punto: con temblor de 9 px queda exactamente en el punto de apoyo (zoom ${zoomSteps})`);
    await page.click('[data-testid=button-undo]');
  }
  await page.click('[data-testid=button-fit]');
  await page.click('[data-testid=tool-ruler]');
  const v = await view();
  await penJitter(60, 60, 15);
  const a = clientToDoc(v, await lastDown());
  const up = clientToDoc(v, await page.evaluate(() => window.__ups.at(-1)));
  const line = (await entities()).at(-1);
  ok(line?.type === 'segment' && line.a.x === a.x && line.a.y === a.y && Math.abs(line.b.x - up.x) < 1e-9, 'arrastre de 15 px: crea la línea con extremos exactos');
  log('G1: temblor ≤ 9 px = toque (regla, compás, punto, con y sin zoom); arrastre de 15 px = línea exacta');
}

// ───────── 11) G2: palma apoyada antes que el lápiz, sin sobrevuelo ─────────
{
  await fresh();
  await penTap(200, 290); // el lápiz queda detectado; se ha fijado un punto en Lápiz → se deshace
  await page.click('[data-testid=button-undo]').catch(() => {});
  await page.waitForTimeout(700);
  const v0 = await view();
  // Palma pequeña e inmóvil (< 12 px): no mueve la hoja.
  await touch('touchStart', [{ x: 900, y: 650, id: 9 }]); await touch('touchMove', [{ x: 906, y: 645, id: 9 }]); await touch('touchEnd', []);
  let v1 = await view(); ok(v1.tx === v0.tx && v1.ty === v0.ty, 'palma casi quieta (8 px): la hoja no se mueve');
  // Palma que se desliza 36 px y, enseguida, el lápiz: el desplazamiento se deshace.
  await page.waitForTimeout(700);
  await touch('touchStart', [{ x: 900, y: 650, id: 9 }]);
  for (let i = 1; i <= 6; i += 1) await touch('touchMove', [{ x: 900 - i * 6, y: 650 - i * 4, id: 9 }]);
  const moved = await view(); ok(moved.tx !== v0.tx, '(la palma llegó a mover la hoja antes del lápiz)');
  await page.click('[data-testid=tool-pen]').catch(() => {});
  const p = await toClient(60, 120); await pen('mouseMoved', p, 0); await pen('mousePressed', p);
  for (let i = 1; i <= 5; i += 1) await pen('mouseMoved', { x: p.x + i * 10, y: p.y });
  v1 = await view();
  ok(v1.tx === v0.tx && v1.ty === v0.ty && v1.scale === v0.scale, 'al apoyar el lápiz, el desplazamiento de la palma se deshace');
  await pen('mouseReleased', { x: p.x + 50, y: p.y }, 0); await touch('touchEnd', []);
  const st = (await entities()).at(-1);
  ok(st?.type === 'polyline' && Math.max(...st.points.map((q) => q.y)) - Math.min(...st.points.map((q) => q.y)) < 1e-9, 'el trazo del lápiz no se deforma');
  // Navegación intencionada (sin lápiz) sigue funcionando: arrastre y pellizco.
  await page.waitForTimeout(700);
  const v2 = await view();
  await touch('touchStart', [{ x: 800, y: 500, id: 3 }]);
  for (let i = 1; i <= 6; i += 1) await touch('touchMove', [{ x: 800 - i * 10, y: 500, id: 3 }]);
  await touch('touchEnd', []);
  ok(Math.abs((await view()).tx - (v2.tx - 60)) < 1e-6, 'un dedo intencionado desplaza la hoja (60 px exactos, sin salto)');
  const v3 = await view();
  await touch('touchStart', [{ x: 700, y: 400, id: 1 }, { x: 800, y: 400, id: 2 }]);
  for (let i = 1; i <= 5; i += 1) await touch('touchMove', [{ x: 700 - i * 10, y: 400, id: 1 }, { x: 800 + i * 10, y: 400, id: 2 }]);
  await touch('touchEnd', []);
  ok((await view()).scale > v3.scale * 1.8, 'el pellizco sigue ampliando');
  log('G2: la palma quieta no mueve la hoja; la que se desliza se deshace al llegar el lápiz; arrastre y pellizco intactos');
}

// ───────── 12) G3: modo automático y preferencia persistente ─────────
{
  await fresh();
  await page.click('[data-testid=tool-pen]');
  const fingerStroke = async () => {
    const p = await toClient(40, 200);
    await touch('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
    for (let i = 1; i <= 6; i += 1) await touch('touchMove', [{ x: p.x + i * 10, y: p.y, id: 1 }]);
    await touch('touchEnd', []);
  };
  await fingerStroke();
  let list = await entities();
  ok(list.length === 0, 'automático sin lápiz detectado: el primer toque del dedo no dibuja');
  ok(await page.locator('[data-testid=finger-prompt]').isVisible(), 'se ofrece dibujar con el dedo');
  await page.click('[data-testid=button-finger-draw]');
  await fingerStroke();
  ok((await entities()).length === 1, 'tras elegirlo, el dedo dibuja');
  await reloadAndReopen();
  ok(await page.locator('[data-testid=seg-finger-mode-all]').getAttribute('class') === 'on', '«Dedo dibuja» se conserva tras recargar');
  // Detección del lápiz: se activa con un sobrevuelo, persiste y se puede olvidar.
  await fresh();
  ok((await page.locator('[data-testid=text-pen-detected]').innerText()).includes('aún no'), 'estado inicial: lápiz no detectado');
  const hp = await toClient(100, 100); await pen('mouseMoved', hp, 0); await pen('mouseMoved', { x: hp.x + 5, y: hp.y }, 0);
  await page.waitForTimeout(100);
  await reloadAndReopen();
  ok((await page.locator('[data-testid=text-pen-detected]').innerText()).includes('S Pen detectado'), 'la detección (por sobrevuelo) persiste tras recargar');
  await page.click('[data-testid=tool-pen]');
  await fingerStroke();
  ok(!(await page.locator('[data-testid=finger-prompt]').isVisible()) && (await entities()).length === 0, 'con lápiz detectado, el dedo navega y no se pregunta');
  await page.click('[data-testid=button-forget-pen]');
  ok((await page.locator('[data-testid=text-pen-detected]').innerText()).includes('aún no'), '«Olvidar» vuelve al estado inicial seguro');
  log('G3: el dedo no dibuja hasta elegirlo; la elección y la detección del lápiz persisten; «Olvidar» funciona');
}

// ───────── 13) F: márgenes con decimales ─────────
{
  await fresh();
  const field = page.locator('[data-testid=input-margin-left]');
  await field.click(); await field.fill(''); await field.pressSequentially('12.5');
  ok(await field.inputValue() === '12.5', 'mientras se escribe, el texto no se reformatea');
  await field.press('Enter');
  const right = page.locator('[data-testid=input-margin-right]');
  await right.click(); await right.fill(''); await right.pressSequentially('12,5'); await right.press('Enter');
  await waitSaved();
  let m = (await readProject()).sheet.margins;
  ok(m.left === 12.5 && m.right === 12.5, `«12.5» y «12,5» se guardan como 12,5 mm (${m.left}, ${m.right})`);
  const top = page.locator('[data-testid=input-margin-top]');
  await top.click(); await top.fill(''); await top.pressSequentially('50'); await top.press('Enter');
  ok(await page.locator('[data-testid=input-margin-top-error]').isVisible(), 'fuera de 0–40 mm muestra un error');
  await waitSaved();
  m = (await readProject()).sheet.margins;
  ok(m.top === 10 && await top.inputValue() === '10', 'el valor no válido no se aplica y se recupera el anterior');
  const marginRect = await page.evaluate(() => [...document.querySelectorAll('[data-testid=drawing-sheet] rect')].find((r) => r.getAttribute('stroke-dasharray'))?.getAttribute('x'));
  ok(marginRect === '12.5', 'la guía de márgenes usa 12,5 mm');
  log('F: márgenes «12.5» y «12,5» admitidos; 50 rechazado con mensaje');
}

// ───────── 14) Cancelación del sistema (pointercancel) ─────────
async function systemCancel() {
  await page.evaluate(() => {
    const d = window.__downs.at(-1);
    document.querySelector('[data-testid=drawing-sheet]').dispatchEvent(new PointerEvent('pointercancel', { pointerId: d.id, pointerType: d.t, bubbles: true, clientX: d.x, clientY: d.y }));
  });
}
{
  await fresh();
  await page.click('[data-testid=tool-pen]');
  const p = await toClient(30, 80); await pen('mouseMoved', p, 0); await pen('mousePressed', p);
  for (let i = 1; i <= 8; i += 1) await pen('mouseMoved', { x: p.x + i * 12, y: p.y + i * 3 });
  await systemCancel();
  await pen('mouseReleased', { x: p.x + 96, y: p.y + 24 }, 0);
  let list = await entities();
  ok(list.length === 1 && list[0].type === 'polyline' && list[0].points.length >= 9, `trazo del lápiz interrumpido: se conserva (${list[0]?.points.length} puntos)`);
  ok((await page.locator('[data-testid=text-notice]').innerText()).includes('interrumpió'), 'se avisa de la interrupción');
  await page.click('[data-testid=button-undo]');
  ok((await entities()).length === 0, 'el trazo conservado se deshace en un paso');
  await page.click('[data-testid=tool-ruler]');
  await penTap(50, 50);
  const q = await toClient(120, 80); await pen('mouseMoved', q, 0); await pen('mousePressed', q); await pen('mouseMoved', { x: q.x + 40, y: q.y });
  await systemCancel();
  await pen('mouseReleased', { x: q.x + 40, y: q.y }, 0);
  ok((await entities()).length === 0 && (await page.locator('[data-testid=status-ruler] b').innerText()).includes('02'), 'regla interrumpida: no crea nada y conserva el inicio ya marcado');
  ok((await page.locator('[data-testid=preview]').count()) <= 1, 'no queda una vista previa de arrastre colgada');
  await page.click('[data-testid=seg-finger-mode-all]'); await page.click('[data-testid=tool-pen]');
  const f = await toClient(40, 200);
  await touch('touchStart', [{ x: f.x, y: f.y, id: 1 }]);
  for (let i = 1; i <= 5; i += 1) await touch('touchMove', [{ x: f.x + i * 10, y: f.y, id: 1 }]);
  await systemCancel();
  await touch('touchEnd', []);
  ok((await entities()).length === 0, 'trazo del dedo interrumpido: se descarta');
  log('cancelación: lápiz conserva lo dibujado; construcciones y dedo se descartan limpiamente');
}

// ───────── 15) Transportador persistente: no depende de la herramienta activa ─────────
{
  await fresh();
  const protAttrs = () => page.evaluate(() => {
    const g = document.querySelector('[data-testid=protractor-overlay]');
    return g ? { x: Number(g.dataset.x), y: Number(g.dataset.y), base: Number(g.dataset.base), angle: Number(g.dataset.angle), cw: g.dataset.cw } : null;
  });
  await page.click('[data-testid=tool-protractor]');
  await penTap(60.5, 150.25);
  const vP = await view(); const vertex = clientToDoc(vP, await lastDown());
  const base = page.locator('[data-testid=input-protractor-base]');
  await base.click(); await base.fill('15,5'); await base.press('Enter');
  await page.fill('[data-testid=input-protractor-angle]', '37,5');
  await page.click('[data-testid=seg-protractor-dir-cw]');
  const placed = await protAttrs();
  ok(placed && placed.x === vertex.x && placed.y === vertex.y && placed.base === 15.5 && placed.angle === 37.5 && placed.cw === 'true', `transportador colocado en el punto tocado (${JSON.stringify(placed)})`);

  // Cambiar a Lápiz: sigue visible y con los mismos valores; dibujar encima no lo modifica.
  await page.click('[data-testid=tool-pen]');
  ok(JSON.stringify(await protAttrs()) === JSON.stringify(placed), 'al elegir Lápiz el transportador sigue visible e idéntico');
  await penDrag({ x: 40, y: 140 }, { x: 110, y: 165 });
  let list = await entities();
  ok(list.length === 1 && list[0].type === 'polyline', 'con el transportador visible, el lápiz dibuja debajo');
  ok(JSON.stringify(await protAttrs()) === JSON.stringify(placed), 'dibujar no mueve ni cambia el transportador');
  for (const t of ['tool-ruler', 'tool-eraser', 'tool-select', 'tool-pan']) await page.click(`[data-testid=${t}]`);
  ok(JSON.stringify(await protAttrs()) === JSON.stringify(placed), 'tampoco cambia al pasar por otras herramientas');
  await page.keyboard.press('Escape');
  ok(JSON.stringify(await protAttrs()) === JSON.stringify(placed), 'Escape no quita el transportador');

  // Crear: el transportador sigue colocado; Deshacer quita la construcción, no el instrumento.
  await page.click('[data-testid=tool-protractor]');
  await page.click('[data-testid=button-place-line]');
  list = await entities();
  ok(list.length === 4 && list.filter((e) => e.type === 'segment').length === 2 && list.some((e) => e.type === 'arc'), 'Crear añade los dos rayos y el arco');
  ok(JSON.stringify(await protAttrs()) === JSON.stringify(placed), 'después de crear, el transportador sigue colocado');
  await page.click('[data-testid=button-undo]');
  ok((await entities()).length === 1 && JSON.stringify(await protAttrs()) === JSON.stringify(placed), 'Deshacer quita la construcción y no toca el transportador');

  // Ocultar y mostrar (barra de la hoja, con cualquier herramienta) conserva la configuración.
  await page.click('[data-testid=tool-pen]');
  await page.click('[data-testid=button-toggle-protractor]');
  ok(await protAttrs() === null, 'ocultar: deja de verse');
  await waitSaved();
  let saved = (await readProject()).instruments.protractor;
  ok(saved.visible === false && saved.pose.x === vertex.x && saved.pose.rotation === 15.5 && saved.angle === 37.5 && saved.cw === true, 'oculto: la configuración se guarda intacta');
  ok((await entities()).length === 1, 'ocultarlo no cambia la geometría');
  await page.click('[data-testid=button-toggle-protractor]');
  ok(JSON.stringify(await protAttrs()) === JSON.stringify(placed), 'mostrar: vuelve con los mismos valores');
  await waitSaved();
  saved = (await readProject()).instruments.protractor;
  ok(saved.visible === true && saved.pose.x === vertex.x && saved.pose.y === vertex.y, 'visible: guardado con su pose exacta');

  // Cerrar y reabrir desde la biblioteca, y recargar la página.
  await page.click('[data-testid=button-library]'); await page.waitForSelector('[data-testid=library-all]');
  await page.locator('[data-testid=library-all] .lib-open').first().click(); await afterOpen();
  ok(JSON.stringify(await protAttrs()) === JSON.stringify(placed), 'reabrir el proyecto restaura el transportador');
  await reloadAndReopen();
  ok(JSON.stringify(await protAttrs()) === JSON.stringify(placed), 'recargar la página restaura el transportador');
  ok((await page.locator('[data-testid=tool-pen].active').count()) === 1, 'se restaura aunque la herramienta activa sea Lápiz');

  // Reiniciar (panel del transportador) lo quita a propósito.
  await page.click('[data-testid=tool-protractor]');
  await page.click('[data-testid=button-reset-construction]');
  ok(await protAttrs() === null && (await page.locator('[data-testid=button-toggle-protractor]').count()) === 0, 'Reiniciar quita el transportador');
  await waitSaved();
  ok((await readProject()).instruments.protractor.pose === null, 'y se guarda sin colocar');
  log('transportador: sobrevive a Lápiz, otras herramientas, Escape, Crear y Deshacer; ocultar/mostrar; se guarda y se restaura');
}

// ───────── 16) Borrador: el tamaño (px de pantalla) determina exactamente lo que se borra, con cualquier zoom ─────────
// Solo comprueba el comportamiento existente: radio en mm = tamaño en px / escala de la vista.
{
  await fresh();
  const setEraserPx = (v) => page.$eval('[data-testid=input-eraser-size]', (el, value) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(value)); el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  // Segmento horizontal exacto (30, 100) → (180, 100) y circunferencia de centro (105, 200) y r = 40.
  await page.click('[data-testid=tool-ruler]');
  await page.fill('[data-testid=input-rule-x]', '30'); await page.fill('[data-testid=input-rule-y]', '100');
  await page.click('[data-testid=button-rule-fix-start]');
  await page.fill('[data-testid=input-rule-length]', '150'); await page.fill('[data-testid=input-rule-angle]', '0');
  await page.click('[data-testid=button-place-line]');
  await page.click('[data-testid=tool-compass]');
  await page.fill('[data-testid=input-compass-x]', '105'); await page.fill('[data-testid=input-compass-y]', '200');
  await page.click('[data-testid=button-compass-fix-center]');
  await page.fill('[data-testid=input-compass-radius]', '40');
  await page.click('[data-testid=button-place-line]');
  const base = await entities();
  const seg = base.find((e) => e.type === 'segment'), circ = base.find((e) => e.type === 'circle');
  ok(seg && seg.a.x === 30 && seg.b.x === 180 && seg.a.y === 100 && circ && circ.r === 40, 'figuras de referencia exactas');
  await page.click('[data-testid=tool-eraser]');
  ok((await page.locator('[data-testid=seg-eraser-mode-partial].on').count()) === 1, 'modo «Solo lo que toca»');

  const gaps = [];
  for (const zoom of [{ name: 'ajustada', steps: [] }, { name: '×1,56', steps: ['in', 'in'] }, { name: '×0,64', steps: ['out', 'out'] }]) {
    await page.click('[data-testid=button-fit]');
    for (const st of zoom.steps) await page.click(`[data-testid=button-zoom-${st}]`);
    for (const px of [5, 30]) {
      await setEraserPx(px);
      const v = await view();
      const r = px / v.scale;
      const label = await page.locator('label[for=eraser-size] output').innerText();
      ok(label.startsWith(`${px} px`) && label.includes(`${(r).toFixed(2).replace(/\.?0+$/, '')} mm`), `el control muestra ${px} px = ${r.toFixed(2)} mm (${label})`);
      // Toque sobre el centro del segmento: se borra la cuerda del círculo de radio r que corta la recta.
      await penTap(105, 100);
      const P = clientToDoc(v, await lastDown());
      const h = Math.sqrt(r * r - (P.y - 100) ** 2);
      let list = await entities();
      const pieces = list.filter((e) => e.type === 'segment').sort((a, b) => a.a.x - b.a.x);
      ok(pieces.length === 2, `${zoom.name}, ${px} px: el segmento queda en dos trozos`);
      ok(pieces[0].a.x === 30 && pieces[1].b.x === 180 && pieces.every((pc) => pc.a.y === 100 && pc.b.y === 100), `${zoom.name}, ${px} px: extremos exteriores y recta intactos`);
      near(pieces[0].b.x, P.x - h, 1e-6, `${zoom.name}, ${px} px: fin del trozo izquierdo`);
      near(pieces[1].a.x, P.x + h, 1e-6, `${zoom.name}, ${px} px: inicio del trozo derecho`);
      gaps.push({ zoom: zoom.name, px, scale: v.scale, gap: pieces[1].a.x - pieces[0].b.x });
      await page.click('[data-testid=button-undo]');
      list = await entities();
      ok(list.length === 2 && list.some((e) => e.id === seg.id && e.type === 'segment' && e.b.x === 180), 'Deshacer recupera el segmento');
    }
  }
  for (let i = 0; i < gaps.length; i += 2) ok(gaps[i + 1].gap > gaps[i].gap, `${gaps[i].zoom}: 30 px borra más que 5 px (${gaps[i + 1].gap.toFixed(3)} > ${gaps[i].gap.toFixed(3)} mm)`);
  ok(gaps[2].gap < gaps[0].gap && gaps[4].gap > gaps[0].gap, 'con el mismo tamaño en px, ampliar borra menos mm y alejar borra más');

  // Circunferencia (vista ajustada): toque en su punto superior; el arco quitado sale de la distancia exacta al lápiz.
  await page.click('[data-testid=button-fit]');
  for (const px of [5, 30]) {
    await setEraserPx(px);
    const v = await view();
    const r = px / v.scale;
    await penTap(105, 160);
    const P = clientToDoc(v, await lastDown());
    const D = Math.hypot(P.x - 105, P.y - 200);
    const removed = 2 * Math.acos((40 * 40 + D * D - r * r) / (2 * 40 * D)) * 180 / Math.PI;
    const list = await entities();
    const arc = list.find((e) => e.type === 'arc');
    ok(arc && arc.r === 40 && arc.c.x === 105 && arc.c.y === 200, `${px} px: queda un arco con el mismo centro y radio`);
    near(360 - arc.sweep, removed, 1e-6, `${px} px: ángulo borrado = el que cubre el borrador`);
    await page.click('[data-testid=button-undo]');
    ok((await entities()).some((e) => e.type === 'circle' && e.id === circ.id), 'Deshacer recupera la circunferencia');
  }
  log(`borrador: hueco exacto = 2·√(r² − d²), r = px / escala; ${gaps.map((g) => `${g.zoom} ${g.px}px → ${g.gap.toFixed(3)} mm`).join(', ')}`);
}

// ───────── 17) Límites A4: se acepta lo que tiene una parte real dentro; se conserva entero y se recorta al mostrar ─────────
{
  await fresh();
  await page.click('[data-testid=tool-compass]');
  await page.fill('[data-testid=input-compass-x]', '105'); await page.fill('[data-testid=input-compass-y]', '20');
  await page.click('[data-testid=button-compass-fix-center]');
  await page.fill('[data-testid=input-compass-radius]', '30');
  await page.click('[data-testid=button-place-line]');
  let list = await entities();
  ok(list.length === 1 && list[0].type === 'circle' && list[0].c.x === 105 && list[0].c.y === 20 && list[0].r === 30, 'circunferencia que cruza el borde superior: creada entera, sin mover el centro ni cambiar el radio');
  ok((await page.locator('[data-testid=text-notice]').innerText()).includes('fuera de la hoja'), 'se avisa de que una parte queda fuera');
  ok(await page.evaluate((id) => !!document.querySelector(`[data-testid="entity-${id}"]`).closest('g[clip-path="url(#sheet-clip)"]'), list[0].id), 'en pantalla se dibuja recortada a la hoja');
  // Rodear toda la hoja sin tocarla: no hay nada dentro → se rechaza.
  await page.fill('[data-testid=input-compass-x]', '105'); await page.fill('[data-testid=input-compass-y]', '148.5');
  await page.click('[data-testid=button-compass-fix-center]');
  await page.fill('[data-testid=input-compass-radius]', '400');
  ok((await page.locator('[data-testid=text-construction-error]').innerText()).includes('totalmente fuera') && await page.locator('[data-testid=button-place-line]').isDisabled(), 'una circunferencia que rodea la hoja sin tocarla se rechaza');
  ok((await entities()).length === 1, 'y no se crea');
  // Exportaciones: A4 exacto; en el PNG se ve la parte de dentro (punto inferior de la circunferencia en (105, 50)).
  await page.click('[data-testid=button-export]');
  const [pdfDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=button-export-pdf]')]);
  const pdfPage = (await PDFDocument.load(fs.readFileSync(await pdfDl.path()))).getPage(0).getSize();
  ok(Math.abs(pdfPage.width - 595.276) < 0.01 && Math.abs(pdfPage.height - 841.89) < 0.01, `PDF A4 (${pdfPage.width.toFixed(3)} × ${pdfPage.height.toFixed(3)} pt)`);
  await page.click('[data-testid=button-export]');
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=button-export-png]')]);
  const pngBuf = fs.readFileSync(await pngDl.path());
  ok(pngBuf.readUInt32BE(16) === 2480 && pngBuf.readUInt32BE(20) === 3508, 'PNG 2480 × 3508');
  const px = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height); const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
    const at = (x, y) => [...cx.getImageData(Math.round(x / 25.4 * 300), Math.round(y / 25.4 * 300), 1, 1).data];
    return { on: at(105, 50), off: at(105.5, 62.5) }; // (105,5; 62,5): entre líneas de la cuadrícula
  }, pngBuf.toString('base64'));
  ok(px.on[0] < 120 && px.off[0] > 200, `PNG: la parte de dentro se dibuja (${px.on}) y el resto de la hoja queda en blanco (${px.off})`);
  // Editar una propiedad de la figura que cruza el borde se acepta.
  await page.click('[data-testid=tool-select]');
  await penTap(105, 50);
  await page.fill('[data-testid=edit-circle-r]', '32.5'); await page.press('[data-testid=edit-circle-r]', 'Enter');
  list = await entities();
  ok(list.length === 1 && list[0].r === 32.5 && list[0].c.y === 20, 'editar el radio de la figura que cruza el borde se acepta con el valor exacto');
  log('límites A4: parte real dentro → se crea entera y se recorta al mostrar y exportar; totalmente fuera → se rechaza');
}

// ───────── 18) Compás como guía persistente: definirlo nunca crea geometría ─────────
{
  await fresh();
  const guideNow = () => page.evaluate(() => {
    const g = document.querySelector('[data-testid=compass-guide]');
    return g ? { cx: Number(g.dataset.cx), cy: Number(g.dataset.cy), r: Number(g.dataset.r), rotation: Number(g.dataset.rotation) } : null;
  });
  const status = () => page.locator('[data-testid=status-compass] b').innerText();
  await page.click('[data-testid=tool-compass]');
  // Arrastre del centro a un punto de la circunferencia: define la guía.
  await penDrag({ x: 60.3, y: 100.7 }, { x: 95.9, y: 120.2 });
  const v = await view();
  const down = clientToDoc(v, await lastDown());
  const up = clientToDoc(v, await page.evaluate(() => window.__ups.at(-1)));
  let gd = await guideNow();
  ok((await entities()).length === 0, 'arrastre: no se crea ninguna figura');
  ok(gd && gd.cx === down.x && gd.cy === down.y, 'arrastre: centro = punto de apoyo exacto');
  near(gd.r, Math.hypot(up.x - down.x, up.y - down.y), 1e-12, 'arrastre: radio = distancia exacta al punto de levantado');
  ok((await status()).includes('03'), 'el compás queda listo');
  ok((await page.locator('[data-testid=button-undo]').isDisabled()), 'definir el compás no entra en el historial');
  // Con el compás listo, los toques no lo mueven.
  await penTap(150, 200);
  ok(JSON.stringify(await guideNow()) === JSON.stringify(gd) && (await entities()).length === 0, 'un toque no mueve la guía ni crea nada');
  ok((await page.locator('[data-testid=text-notice]').innerText()).includes('Recolocar'), 'se indica cómo recolocarlo');
  // El radio escrito cambia la guía (exacto, con coma decimal) y sigue sin crear nada.
  await page.fill('[data-testid=input-compass-radius]', '37,5');
  gd = await guideNow();
  ok(gd.r === 37.5 && gd.cx === down.x && (await entities()).length === 0, 'radio escrito 37,5 → guía r = 37,5 mm; centro intacto; nada creado');
  // Centro por coordenadas + «Fijar radio».
  await page.click('[data-testid=button-compass-relocate]');
  ok(await guideNow() === null && (await status()).includes('01'), 'Recolocar quita la guía');
  await page.fill('[data-testid=input-compass-x]', '105'); await page.fill('[data-testid=input-compass-y]', '148.5');
  await page.click('[data-testid=button-compass-fix-center]');
  ok((await status()).includes('02') && await guideNow() === null, 'centro fijado: falta el radio, todavía sin guía');
  await page.fill('[data-testid=input-compass-radius]', '25.25');
  await page.click('[data-testid=button-compass-fix-radius]');
  gd = await guideNow();
  ok(gd && gd.cx === 105 && gd.cy === 148.5 && gd.r === 25.25 && (await entities()).length === 0, 'Fijar radio: guía (105; 148,5) r = 25,25 sin crear nada');
  // Persiste al cambiar de herramienta (y se ve con cualquier herramienta).
  for (const t of ['tool-pen', 'tool-ruler', 'tool-eraser', 'tool-select']) await page.click(`[data-testid=${t}]`);
  ok(JSON.stringify(await guideNow()) === JSON.stringify(gd), 'la guía sigue visible e idéntica con otras herramientas');
  // Un centro marcado a falta del radio sí se descarta al cambiar de herramienta.
  await page.click('[data-testid=tool-compass]');
  await page.click('[data-testid=button-compass-relocate]');
  await penTap(40, 40);
  ok((await status()).includes('02'), 'centro marcado');
  await page.click('[data-testid=tool-pen]'); await page.click('[data-testid=tool-compass]');
  ok((await status()).includes('01'), 'al cambiar de herramienta se descarta el centro a medias');
  await page.fill('[data-testid=input-compass-x]', '105'); await page.fill('[data-testid=input-compass-y]', '148.5');
  await page.click('[data-testid=button-compass-fix-center]');
  await page.fill('[data-testid=input-compass-radius]', '25.25'); await page.click('[data-testid=button-compass-fix-radius]');
  // Ocultar y mostrar.
  await page.click('[data-testid=button-toggle-compass]');
  ok(await guideNow() === null, 'ocultar: la guía deja de verse');
  await waitSaved();
  let saved = (await readProject()).instruments.compass;
  ok(saved.visible === false && saved.pose.x === 105 && saved.pose.y === 148.5 && saved.radius === 25.25, 'oculto: la configuración se guarda intacta');
  await page.click('[data-testid=button-toggle-compass]');
  ok(JSON.stringify(await guideNow()) === JSON.stringify(gd), 'mostrar: vuelve igual');
  // La guía no se exporta: en el PNG, un punto de la guía queda en blanco o con la cuadrícula, nunca con su color.
  await page.click('[data-testid=button-export]');
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=button-export-png]')]);
  const onGuide = { x: 105 + 25.25 * Math.cos(Math.PI / 7), y: 148.5 - 25.25 * Math.sin(Math.PI / 7) };
  const pixel = await page.evaluate(async ({ b64, p }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height); const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
    return [...cx.getImageData(Math.round(p.x / 25.4 * 300), Math.round(p.y / 25.4 * 300), 1, 1).data];
  }, { b64: fs.readFileSync(await pngDl.path()).toString('base64'), p: onGuide });
  ok(pixel[0] > 150, `la guía no aparece en el PNG (${pixel})`);
  // Se guarda y se restaura al reabrir y al recargar.
  await waitSaved();
  saved = (await readProject()).instruments.compass;
  ok(saved.visible === true && saved.radius === 25.25 && saved.pose.x === 105, 'visible: guardado');
  await reloadAndReopen();
  ok(JSON.stringify(await guideNow()) === JSON.stringify(gd), 'recargar la página restaura la guía');
  ok((await entities()).length === 0, 'y el documento sigue sin figuras');
  log('compás: guía por toques, arrastre o valores; nunca crea figuras; persiste, se oculta, no se exporta y se restaura');
}

// ───────── 19) Compás: trazar con el S Pen siguiendo la guía circular ─────────
{
  await fresh();
  const C = { x: 105, y: 148.5 };
  const lastUp = () => page.evaluate(() => window.__ups.at(-1));
  const ang = (p) => ((Math.atan2(-(p.y - C.y), p.x - C.x) * 180 / Math.PI) + 360) % 360;
  await page.click('[data-testid=tool-compass]');
  await page.fill('[data-testid=input-compass-x]', '105'); await page.fill('[data-testid=input-compass-y]', '148.5');
  await page.click('[data-testid=button-compass-fix-center]');
  await page.fill('[data-testid=input-compass-radius]', '37.5'); await page.click('[data-testid=button-compass-fix-radius]');
  ok((await entities()).length === 0, 'compás listo, documento vacío');

  // Un cuarto de vuelta con temblor radial: arco con el radio exacto y los ángulos de los eventos del lápiz.
  let v = await view();
  await penPath(arcPts(C, 37.5, 10, 100, 2, (i) => (i % 2 ? 1.2 : -1.2)));
  const d0 = clientToDoc(v, await lastDown()), d1 = clientToDoc(v, await lastUp());
  let list = await entities();
  const a1 = list[0];
  ok(list.length === 1 && a1.type === 'arc' && a1.r === 37.5 && a1.c.x === 105 && a1.c.y === 148.5, 'cuarto de vuelta: un arco con centro y radio exactos (la mano tiembla ±1,2 mm)');
  near(a1.start, ang(d0), 1e-9, 'inicio = ángulo exacto del punto de apoyo');
  near(a1.sweep, ang(d1) - ang(d0), 1e-9, 'barrido = ángulo recorrido hasta levantar el lápiz');
  ok(!Number.isInteger(a1.start * 1000), 'los ángulos no se redondean');
  // El mismo tramo en sentido horario da el mismo arco.
  await penPath(arcPts(C, 37.5, 100, 10, 2));
  const b = (await entities())[1];
  near(b.start, (ang(clientToDoc(v, await lastUp()))), 1e-9, 'horario: el inicio es el extremo de menor ángulo');
  ok(b.type === 'arc' && Math.abs(b.sweep - 90) < 2, 'horario: arco de ≈ 90°');
  await page.click('[data-testid=button-undo]'); await page.click('[data-testid=button-undo]');
  ok((await entities()).length === 0, 'cada trazo se deshace en un solo paso');
  await page.click('[data-testid=button-redo]');
  ok((await entities()).length === 1 && (await entities())[0].id === a1.id, 'Rehacer lo restaura');
  await page.click('[data-testid=button-undo]');

  // 350° → arco (sin cierre automático); 370° → circunferencia.
  await penPath(arcPts(C, 37.5, 30, 380, 4));
  list = await entities();
  ok(list.length === 1 && list[0].type === 'arc' && list[0].sweep > 345 && list[0].sweep < 360, `≈ 350°: sigue siendo un arco (${list[0].sweep.toFixed(2)}°)`);
  await page.click('[data-testid=button-undo]');
  await penPath(arcPts(C, 37.5, 30, 400, 4));
  list = await entities();
  ok(list.length === 1 && list[0].type === 'circle' && list[0].r === 37.5 && list[0].c.x === 105, '≈ 370°: una circunferencia exacta');
  await page.click('[data-testid=button-undo]');

  // Trazos que no siguen la guía: empezado lejos de la banda, o un simple toque sobre ella.
  await penPath(arcPts(C, 37.5 + 40 / v.scale, 10, 80, 3));
  ok((await entities()).length === 0 && (await page.locator('[data-testid=text-notice]').innerText()).includes('Empieza el trazo'), 'empezado a 40 px de la guía: no crea nada y lo indica');
  await penTap(C.x + 37.5, C.y);
  ok((await entities()).length === 0, 'un toque sobre la guía no crea nada');
  // Sobrevolar la banda la resalta.
  const hoverAt = await toClient(C.x, C.y - 37.5);
  await pen('mouseMoved', hoverAt, 0);
  ok(await page.evaluate(() => document.querySelector('[data-testid=compass-guide]').dataset.near === 'true'), 'el lápiz sobre la banda resalta la guía');

  // Cambiar el radio entre trazos solo mueve la guía; lo dibujado no cambia.
  await penPath(arcPts(C, 37.5, 200, 260, 3));
  const keep = JSON.stringify((await entities())[0]);
  await page.fill('[data-testid=input-compass-radius]', '20');
  await penPath(arcPts(C, 20, 200, 260, 3));
  list = await entities();
  ok(list.length === 2 && JSON.stringify(list[0]) === keep && list[1].r === 20, 'radio 20 mm: el arco anterior sigue intacto y el nuevo usa r = 20');

  // Con zoom y tras desplazar la hoja, los arcos siguen en la misma circunferencia.
  for (const steps of [['in', 'in'], ['out', 'out']]) {
    await page.click('[data-testid=button-fit]');
    for (const st of steps) await page.click(`[data-testid=button-zoom-${st}]`);
    await penPath(arcPts(C, 20, 300, 340, 2));
    const e = (await entities()).at(-1);
    ok(e.type === 'arc' && e.r === 20 && e.c.x === 105 && e.c.y === 148.5, `zoom ${steps[0]}: arco con el mismo centro y radio`);
  }
  await page.click('[data-testid=button-fit]');
  await page.click('[data-testid=tool-pan]'); await penDrag({ x: 30, y: 30 }, { x: 60, y: 50 }); await page.click('[data-testid=tool-compass]');
  await penPath(arcPts(C, 20, 120, 160, 2));
  ok((await entities()).at(-1).r === 20 && (await entities()).at(-1).c.x === 105, 'tras desplazar la hoja: mismo centro y radio');
  const nNow = (await entities()).length;

  // Palma: un toque del dedo mientras el lápiz traza se ignora; el arco se crea y la hoja no se mueve.
  const vPalm = await view();
  const palmPts = arcPts(C, 20, 20, 70, 2);
  await penPath(palmPts.slice(0, 10), { release: false });
  const palm = await toClient(150, 250);
  await touch('touchStart', [{ x: palm.x, y: palm.y, id: 7 }]); await touch('touchMove', [{ x: palm.x + 40, y: palm.y + 30, id: 7 }]); await touch('touchEnd', []);
  for (const q of palmPts.slice(10)) await pen('mouseMoved', await toClient(q.x, q.y));
  await pen('mouseReleased', await toClient(palmPts.at(-1).x, palmPts.at(-1).y), 0); await page.waitForTimeout(30);
  const vAfter = await view();
  ok((await entities()).length === nNow + 1 && vAfter.tx === vPalm.tx && vAfter.ty === vPalm.ty, 'la palma durante el trazo no mueve la hoja ni corta el arco');

  // Interrupción de Android a mitad del trazo: se conserva lo recorrido y se avisa.
  await penPath(arcPts(C, 20, 180, 230, 2), { release: false });
  await page.evaluate(() => {
    const d = window.__downs.at(-1);
    document.querySelector('[data-testid=drawing-sheet]').dispatchEvent(new PointerEvent('pointercancel', { pointerId: d.id, pointerType: d.t, bubbles: true, clientX: d.x, clientY: d.y }));
  });
  await pen('mouseReleased', await toClient(C.x - 20, C.y), 0);
  list = await entities();
  ok(list.length === nNow + 2 && list.at(-1).type === 'arc' && list.at(-1).r === 20 && list.at(-1).sweep > 40, 'interrupción: se conserva el arco recorrido');
  ok((await page.locator('[data-testid=text-notice]').innerText()).includes('interrumpió'), 'y se avisa');

  // «Trazar con el compás» desactivado u oculto: no se crea nada sobre la guía.
  await page.click('[data-testid=toggle-compass-trace]');
  await penPath(arcPts(C, 20, 0, 40, 2));
  ok((await entities()).length === nNow + 2, 'sin «Trazar con el compás»: nada');
  await page.click('[data-testid=toggle-compass-trace]');
  await page.click('[data-testid=button-toggle-compass]');
  await penPath(arcPts(C, 20, 0, 40, 2));
  ok((await entities()).length === nNow + 2 && (await page.locator('[data-testid=text-notice]').innerText()).includes('oculto'), 'compás oculto: nada, y se indica');
  await page.click('[data-testid=button-toggle-compass]');

  // Con otra herramienta el lápiz no sigue la guía (Lápiz dibuja trazo libre).
  await page.click('[data-testid=tool-pen]');
  await penPath(arcPts(C, 20, 0, 40, 2));
  ok((await entities()).at(-1).type === 'polyline', 'con Lápiz: trazo libre, la guía no interviene');
  await page.click('[data-testid=button-undo]');

  // Arco exacto por valores (acción explícita, se conserva).
  await page.click('[data-testid=tool-compass]');
  await page.click('[data-testid=toggle-compass-full]');
  await page.fill('[data-testid=input-compass-start]', '0'); await page.fill('[data-testid=input-compass-end]', '90');
  await page.click('[data-testid=button-place-line]');
  const exact = (await entities()).at(-1);
  ok(exact.type === 'arc' && exact.start === 0 && exact.sweep === 90 && exact.r === 20, 'Crear con estos valores: arco exacto de 0° a 90°');

  // Cerca del borde: el arco que cruza la hoja se crea entero (y se recorta al mostrar).
  await page.click('[data-testid=button-compass-relocate]');
  await page.fill('[data-testid=input-compass-x]', '105'); await page.fill('[data-testid=input-compass-y]', '20');
  await page.click('[data-testid=button-compass-fix-center]');
  await page.fill('[data-testid=input-compass-radius]', '30'); await page.click('[data-testid=button-compass-fix-radius]');
  await page.click('[data-testid=button-fit]'); await page.click('[data-testid=button-zoom-out]'); await page.click('[data-testid=button-zoom-out]');
  await penPath(arcPts({ x: 105, y: 20 }, 30, 0, 180, 3));
  const edge = (await entities()).at(-1);
  ok(edge.type === 'arc' && edge.r === 30 && edge.c.y === 20 && edge.sweep > 170, `arco que cruza el borde superior: se conserva entero (${edge.sweep.toFixed(1)}°)`);
  ok((await page.locator('[data-testid=text-notice]').innerText()).includes('fuera de la hoja'), 'y se avisa de la parte exterior');
  log('compás: trazo proyectado con radio exacto; arco o circunferencia (≥ 360°); banda, toques, zoom, desplazamiento, palma, interrupción, Deshacer y borde A4');
}

ok(pageErrors.length === 0, `errores de página: ${pageErrors.join(' | ')}`);
await browser.close();
console.log(`E2E OK: ${checks} comprobaciones en Chromium con eventos de lápiz y táctiles simulados.`);
