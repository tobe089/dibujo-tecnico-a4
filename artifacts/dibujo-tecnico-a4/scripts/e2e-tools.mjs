// Prueba de extremo a extremo en Chromium real con eventos de lápiz (pointerType 'pen') y táctiles.
// Requisitos: Playwright disponible y la app servida (por ejemplo `pnpm run build` + `pnpm run serve`).
//   E2E_URL=http://localhost:4173/  PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs  node scripts/e2e-tools.mjs
// No forma parte del flujo de CI (no hay navegador allí); se ejecuta a mano.
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

async function fresh(storage = null) {
  await page.goto(URL_APP);
  await page.evaluate((s) => { localStorage.clear(); if (s) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
  await page.reload();
  await page.waitForSelector('[data-testid=drawing-sheet]');
  // Registro de las coordenadas reales que recibe el navegador (para comprobar que no se redondean).
  await page.evaluate(() => {
    window.__downs = []; window.__ups = [];
    const svg = document.querySelector('[data-testid=drawing-sheet]');
    svg.addEventListener('pointerdown', (e) => window.__downs.push({ x: e.clientX, y: e.clientY, t: e.pointerType }), true);
    svg.addEventListener('pointerup', (e) => window.__ups.push({ x: e.clientX, y: e.clientY, t: e.pointerType }), true);
  });
}
const view = () => page.evaluate(() => {
  const svg = document.querySelector('[data-testid=drawing-sheet]');
  const r = svg.getBoundingClientRect();
  return { scale: Number(svg.dataset.scale), tx: Number(svg.dataset.tx), ty: Number(svg.dataset.ty), left: r.left, top: r.top };
});
const toClient = async (x, y) => { const v = await view(); return { x: v.left + v.tx + x * v.scale, y: v.top + v.ty + y * v.scale }; };
const clientToDoc = (v, c) => ({ x: (c.x - v.left - v.tx) / v.scale, y: (c.y - v.top - v.ty) / v.scale });
const entities = async () => { await page.waitForTimeout(550); return page.evaluate(() => JSON.parse(localStorage.getItem('dibujo-tecnico-a4-v2')).entities); };
const pen = (type, p, buttons = 1) => cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: buttons || type !== 'mouseMoved' ? 'left' : 'none', buttons, clickCount: 1, pointerType: 'pen', force: 0.5 });
async function penTap(x, y) { const p = await toClient(x, y); await pen('mouseMoved', p, 0); await pen('mousePressed', p); await pen('mouseReleased', p, 0); await page.waitForTimeout(30); return p; }
async function penDrag(from, to, steps = 12) {
  const a = await toClient(from.x, from.y), b = await toClient(to.x, to.y);
  await pen('mouseMoved', a, 0); await pen('mousePressed', a);
  for (let i = 1; i <= steps; i += 1) await pen('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps });
  await pen('mouseReleased', b, 0); await page.waitForTimeout(30);
}
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

// ───────── 2) Compás: centro y radio = puntos tocados (sin imán al extremo cercano) ─────────
await page.click('[data-testid=tool-compass]');
const cTarget = { x: ents[0].a.x + 3, y: ents[0].a.y + 1.5 }; // a 3,4 mm de un extremo existente
await penTap(cTarget.x, cTarget.y);
const vD = await view(); const cDoc = clientToDoc(vD, await lastDown());
const rTarget = { x: cTarget.x + 30 * Math.cos(20 * Math.PI / 180), y: cTarget.y - 30 * Math.sin(20 * Math.PI / 180) };
await penTap(rTarget.x, rTarget.y);
const rDoc = clientToDoc(vD, await lastDown());
ents = await entities();
const circ = ents.at(-1);
ok(circ.type === 'circle', 'el compás crea una circunferencia');
near(circ.c.x, cDoc.x, 1e-9, 'centro = toque (x)'); near(circ.c.y, cDoc.y, 1e-9, 'centro = toque (y)');
ok(Math.hypot(circ.c.x - ents[0].a.x, circ.c.y - ents[0].a.y) > 3, 'el centro NO salta al extremo cercano');
near(circ.r, Math.hypot(rDoc.x - cDoc.x, rDoc.y - cDoc.y), 1e-9, 'radio = distancia exacta entre toques');
near(circ.r, 30, 1.5 / vD.scale, 'radio ≈ 30 mm según los toques');
log(`compás por toques: centro exacto, r = ${circ.r.toFixed(4)} mm`);

// Arco en tres toques, antihorario de 0° a 90°.
await page.click('[data-testid=toggle-compass-full]');
await penTap(150, 60); await penTap(170, 60); await penTap(150, 30);
ents = await entities();
const arc = ents.at(-1);
ok(arc.type === 'arc', 'arco creado');
near(arc.start, 0, 0.2, 'inicio del arco ≈ 0°'); near(arc.sweep, 90, 0.2, 'barrido ≈ 90°');
// El SVG dibuja el arco en el sentido correcto: el punto medio del trazado está a 45°.
const mid = await page.evaluate((id) => { const p = document.querySelector(`[data-testid="entity-${id}"]`); const L = p.getTotalLength(); const q = p.getPointAtLength(L / 2); return { x: q.x, y: q.y }; }, arc.id);
const expMid = { x: arc.c.x + arc.r * Math.cos((arc.start + arc.sweep / 2) * Math.PI / 180), y: arc.c.y - arc.r * Math.sin((arc.start + arc.sweep / 2) * Math.PI / 180) };
near(Math.hypot(mid.x - expMid.x, mid.y - expMid.y), 0, 0.01, 'el arco SVG pasa por su punto medio teórico');
log('compás en modo arco: tres toques, sentido antihorario correcto en pantalla');

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

// ───────── 6) Dedo: dibuja sin lápiz; dos dedos pellizcan y cancelan; palma ignorada con lápiz ─────────
await fresh();
await page.click('[data-testid=tool-pen]');
let p0 = await toClient(40, 40);
await touch('touchStart', [{ x: p0.x, y: p0.y, id: 1 }]);
for (let i = 1; i <= 10; i += 1) await touch('touchMove', [{ x: p0.x + i * 10, y: p0.y, id: 1 }]);
await touch('touchEnd', []);
ents = await entities();
ok(ents.length === 1 && ents[0].type === 'polyline', 'sin lápiz detectado, el dedo dibuja');
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
log('dedo: dibuja sin lápiz; dos dedos amplían anclados y cancelan el trazo');
await page.click('[data-testid=button-fit]');

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
await fresh({ 'dibujo-tecnico-a4-v1': v1 });
ok(await page.locator('[data-testid=text-load-notice]').isVisible(), 'aviso de conversión visible');
ents = await entities();
ok(ents.length === 3 && ents[0].type === 'segment' && ents[0].b.x === 60.125 && ents[1].type === 'circle' && ents[1].r === 35.11 && ents[2].type === 'polyline', 'v1 migrado con valores exactos');
ok(await page.evaluate(() => localStorage.getItem('dibujo-tecnico-a4-v1') !== null), 'la copia v1 se conserva');
await page.reload(); await page.waitForSelector('[data-testid=drawing-sheet]');
ok((await entities()).length === 3 && !(await page.locator('[data-testid=text-load-notice]').isVisible()), 'tras recargar se lee el v2 guardado');
log('migración v1 → v2 sin pérdidas; v1 conservado como copia');

// ───────── 8) Exportación ─────────
await page.click('[data-testid=button-export]');
const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=button-export-pdf]')]);
ok(fs.statSync(await pdf.path()).size > 1000, 'PDF descargado');
await page.click('[data-testid=button-export]');
const [png] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=button-export-png]')]);
const buf = fs.readFileSync(await png.path());
ok(buf.readUInt32BE(16) === 2480 && buf.readUInt32BE(20) === 3508, 'PNG 2480 × 3508');
log('exportación PDF y PNG');

ok(pageErrors.length === 0, `errores de página: ${pageErrors.join(' | ')}`);
await browser.close();
console.log(`E2E OK: ${checks} comprobaciones en Chromium con eventos de lápiz y táctiles simulados.`);
