// Rendimiento del borrador con una carga reproducible (generador determinista). Mide, para cada movimiento del
// lápiz con el borrador:
//   manejador_ms           trabajo del manejador de puntero de la app (incluye el borrado exacto)
//   manejadorHastaDOM_ms   desde el fin del manejador hasta que React aplica el cambio en la página
//   espera_en_cola_ms      cuánto esperó el evento antes de procesarse (Chromium alinea la entrada con los fotogramas)
//   eventoHastaDOM_ms      total desde el evento hasta el DOM
// además de las tareas largas (> 50 ms) y los intervalos entre fotogramas. Chromium de escritorio sin GPU
// (rasterizado por software): las cifras absolutas no son las de la tablet.
//   E2E_URL=… PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node scripts/perf-eraser.mjs [pequeño|grande] [biblioteca|v2]
// 'v2' carga el dibujo como lo hacía la versión anterior (localStorage) para comparar con ella.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const URL_APP = process.env.E2E_URL || 'http://localhost:4173/';
const size = process.argv[2] || 'grande';
const mode = process.argv[3] || 'biblioteca';

export function generate(kind) {
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const st = { color: '#244d58', width: 0.45 }; const entities = [];
  const nPoly = kind === 'grande' ? 400 : 120, nPts = kind === 'grande' ? 420 : 400;
  for (let i = 0; i < nPoly; i += 1) { const points = []; let x = 20 + rnd() * 170, y = 20 + rnd() * 250; for (let k = 0; k < nPts; k += 1) { x += rnd() - 0.5; y += rnd() - 0.5; points.push({ x, y, p: rnd() }); } entities.push({ id: `f${i}`, type: 'polyline', ...st, points }); }
  for (let i = 0; i < 200; i += 1) entities.push({ id: `c${i}`, type: 'circle', ...st, c: { x: 30 + rnd() * 150, y: 30 + rnd() * 230 }, r: 2 + rnd() * 30 });
  for (let i = 0; i < 400; i += 1) entities.push({ id: `s${i}`, type: 'segment', ...st, a: { x: rnd() * 210, y: rnd() * 297 }, b: { x: rnd() * 210, y: rnd() * 297 } });
  return entities;
}

const entities = generate(size);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto(new URL('robots.txt', URL_APP).href);
await p.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('dibujo-tecnico-a4'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
if (mode === 'v2') {
  await p.evaluate((ents) => localStorage.setItem('dibujo-tecnico-a4-v2', JSON.stringify({ version: 2, entities: ents, margins: { top: 10, right: 10, bottom: 10, left: 10 }, color: '#244d58', width: 0.45 })), entities);
  await p.goto(URL_APP);
  if (await p.locator('[data-testid=library]').count()) await p.click('[data-testid=open-migrado-localstorage]');
} else {
  const json = JSON.stringify({ format: 'dibujo-tecnico-a4/proyecto', version: 3, name: 'Carga', sheet: { orientation: 'portrait' }, entities });
  await p.goto(URL_APP); await p.waitForSelector('[data-testid=library]');
  await p.setInputFiles('[data-testid=input-import]', { name: 'carga.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await p.waitForSelector('[data-testid=library-all] article');
  await p.locator('[data-testid=library-all] .lib-open').first().click();
}
await p.waitForFunction((n) => document.querySelectorAll('path[data-testid^=entity-]').length === n, entities.length, { timeout: 60000 });
await p.click('[data-testid=tool-eraser]');
await p.evaluate(() => {
  window.__lat = []; window.__long = []; window.__frames = []; window.__pending = null;
  const svg = document.querySelector('[data-testid=drawing-sheet]');
  window.__h = []; window.__c = []; window.__q = [];
  svg.addEventListener('pointermove', (e) => { if (e.buttons) { window.__pending = e.timeStamp; window.__t0 = performance.now(); window.__q.push(window.__t0 - e.timeStamp); } }, true);
  window.addEventListener('pointermove', () => { if (window.__t0) { window.__t1 = performance.now(); window.__h.push(window.__t1 - window.__t0); } });
  new MutationObserver(() => { if (window.__pending !== null) { const now = performance.now(); window.__lat.push(now - window.__pending); if (window.__t1) window.__c.push(now - window.__t1); window.__pending = null; } }).observe(svg, { subtree: true, attributes: true, childList: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask' });
  let last = performance.now(); const loop = (t) => { if (window.__recording) window.__frames.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
});
const cdp = await ctx.newCDPSession(p);
const box = await p.locator('[data-testid=drawing-sheet]').boundingBox();
const v = await p.evaluate(() => { const s = document.querySelector('[data-testid=drawing-sheet]'); return { sc: +s.dataset.scale, tx: +s.dataset.tx, ty: +s.dataset.ty }; });
const at = (x, y) => ({ x: box.x + v.tx + x * v.sc, y: box.y + v.ty + y * v.sc });
const s0 = at(30, 150);
await p.evaluate(() => { window.__recording = true; });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s0.x, y: s0.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
for (let i = 1; i <= 100; i += 1) {
  const q = at(30 + i * 1.5, 150 + Math.sin(i / 6) * 25);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y, button: 'left', buttons: 1, pointerType: 'pen' });
  await new Promise((r) => setTimeout(r, 16)); // ~60 movimientos por segundo, como un lápiz
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s0.x, y: s0.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
await p.waitForTimeout(400);
const r = await p.evaluate(() => { window.__recording = false; return { lat: window.__lat, long: window.__long, frames: window.__frames, h: window.__h, c: window.__c, q: window.__q }; });
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
const fmt = (x) => (x === undefined ? '—' : x.toFixed(1));
const out = {
  carga: `${size} · ${entities.length} entidades · ${entities.filter((e) => e.type === 'polyline').reduce((n, e) => n + e.points.length, 0)} puntos · modo ${mode}`,
  movimientosMedidos: r.lat.length,
  eventoHastaDOM_ms: { mediana: fmt(q(r.lat, 0.5)), p95: fmt(q(r.lat, 0.95)), max: fmt(Math.max(...r.lat)) },
  espera_en_cola_ms: { mediana: fmt(q(r.q, 0.5)), p95: fmt(q(r.q, 0.95)) },
  manejador_ms: { mediana: fmt(q(r.h, 0.5)), p95: fmt(q(r.h, 0.95)) },
  manejadorHastaDOM_ms: { mediana: fmt(q(r.c, 0.5)), p95: fmt(q(r.c, 0.95)) },
  porEncimaDe16ms: r.lat.filter((x) => x > 16).length,
  tareasLargas: { n: r.long.length, max: r.long.length ? fmt(Math.max(...r.long)) : '0' },
  fotogramas_ms: { mediana: fmt(q(r.frames, 0.5)), p95: fmt(q(r.frames, 0.95)), max: fmt(Math.max(...r.frames)) },
};
console.log(JSON.stringify(out, null, 1));
await browser.close();
