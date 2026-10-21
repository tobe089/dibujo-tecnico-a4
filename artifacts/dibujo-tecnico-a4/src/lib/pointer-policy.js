// Política de punteros: decide qué contacto dibuja, cuál navega y cuál se ignora. Sin DOM.
//
// Limitaciones reales: el navegador no informa de "palma"; solo da pointerType (pen/touch/mouse),
// el tamaño del contacto (width/height, no siempre fiable) y si el lápiz está cerca (eventos de sobrevuelo).
// Con eso se aplican estas reglas:
//   1. El S Pen siempre dibuja (salvo la herramienta Desplazar). Al apoyarlo, cualquier dedo deja de actuar.
//   2. Mientras el lápiz está apoyado o se ha visto hace menos de PEN_PROXIMITY_MS (sobrevuelo o recién
//      levantado), los toques se ignoran: así se descarta la palma apoyada mientras se dibuja.
//   3. Un contacto más grande que PALM_SIZE_PX se ignora (palma), si el navegador informa del tamaño.
//   4. El dedo dibuja según el modo: 'all' siempre; 'pen' nunca (solo navega); 'auto' hasta que se detecta
//      un S Pen en la sesión.
//   5. Un segundo dedo convierte el gesto en navegación (pellizco) y CANCELA lo que el primero estuviera
//      dibujando: las herramientas solo confirman al levantar, así que cancelar no deja rastro.
//   6. Ratón: botón principal dibuja; central/secundario navegan.

export const PEN_PROXIMITY_MS = 600;
export const PALM_SIZE_PX = 60;

export function createPolicy(fingerMode = 'auto') {
  return { pointers: new Map(), penSeen: false, penLastSeen: -Infinity, fingerMode };
}

export function fingerDraws(policy) {
  return policy.fingerMode === 'all' || (policy.fingerMode === 'auto' && !policy.penSeen);
}

function activeTouches(policy, exceptId) {
  return [...policy.pointers.entries()].filter(([id, p]) => id !== exceptId && p.type === 'touch' && p.role !== 'ignore');
}

/**
 * Nuevo contacto. ev = { id, type, t, button, width, height }. ctx = { panTool }.
 * Devuelve { role: 'draw' | 'nav' | 'ignore', cancelDraw: id | null, stopNav: boolean }.
 *   cancelDraw: id del puntero cuyo dibujo en curso hay que descartar.
 *   stopNav: los punteros que navegaban dejan de hacerlo (se ignoran a partir de ahora).
 */
export function pointerDown(policy, ev, ctx = {}) {
  let role = 'ignore';
  let cancelDraw = null;
  let stopNav = false;
  const drawing = [...policy.pointers.entries()].find(([, p]) => p.role === 'draw');
  if (ev.type === 'pen') {
    policy.penSeen = true;
    policy.penLastSeen = ev.t;
    if (ctx.panTool) role = 'nav';
    else if (drawing && drawing[1].type === 'pen') role = 'ignore';
    else {
      role = 'draw';
      if (drawing) { cancelDraw = drawing[0]; drawing[1].role = 'ignore'; }
      for (const [, p] of activeTouches(policy, ev.id)) { if (p.role === 'nav') stopNav = true; p.role = 'ignore'; }
    }
  } else if (ev.type === 'mouse') {
    if (ev.button === 0 && !ctx.panTool) role = drawing ? 'ignore' : 'draw';
    else role = 'nav';
  } else {
    const size = Math.max(Number(ev.width) || 0, Number(ev.height) || 0);
    const penActive = drawing && drawing[1].type === 'pen';
    if (size > PALM_SIZE_PX || penActive || ev.t - policy.penLastSeen < PEN_PROXIMITY_MS) role = 'ignore';
    else {
      const others = activeTouches(policy, ev.id);
      if (others.length === 0) role = fingerDraws(policy) && !ctx.panTool && !drawing ? 'draw' : 'nav';
      else if (others.length === 1) {
        const [otherId, other] = others[0];
        if (other.role === 'draw') { cancelDraw = otherId; other.role = 'nav'; }
        role = 'nav';
      } else role = 'ignore';
    }
  }
  policy.pointers.set(ev.id, { type: ev.type, role });
  return { role, cancelDraw, stopNav };
}

/** Movimiento del lápiz sin contacto (sobrevuelo): mantiene activo el rechazo de palma. */
export function penHover(policy, t) {
  policy.penSeen = true;
  policy.penLastSeen = t;
}

export function roleOf(policy, id) {
  return policy.pointers.get(id)?.role ?? null;
}

/** Fin del contacto (pointerup o pointercancel). Devuelve el rol que tenía. */
export function pointerUp(policy, id, t) {
  const p = policy.pointers.get(id);
  policy.pointers.delete(id);
  if (p?.type === 'pen') policy.penLastSeen = t;
  return p?.role ?? null;
}

/** Ids de los punteros que navegan ahora mismo (máximo dos se usan: arrastre o pellizco). */
export function navPointers(policy) {
  return [...policy.pointers.entries()].filter(([, p]) => p.role === 'nav').map(([id]) => id);
}
