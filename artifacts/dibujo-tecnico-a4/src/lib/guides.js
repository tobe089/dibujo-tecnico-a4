// Trazado guiado por un instrumento. Sin dependencias de DOM.
//
// Compás: el centro C y el radio R están fijos durante todo el trazo. Cada posición del lápiz p se proyecta sobre
// la circunferencia por su ángulo exacto θ = segmentAngle(C, p) (0° = derecha, 90° = arriba, antihorario); el
// radio del resultado es siempre exactamente R, aunque la mano tiemble hacia dentro o hacia fuera.
// Los giros entre muestras consecutivas se acumulan (cada uno en (−180°, 180°]) para distinguir vueltas, el paso
// por 0°/360° y el sentido. La parte trazada es el intervalo entre el giro mínimo y el máximo alcanzados:
//   < 360°  → arco { start, sweep } antihorario; start es el ángulo EXACTO de la muestra donde se alcanzó el mínimo
//   ≥ 360°  → circunferencia completa (sin cierre automático: 359,9° sigue siendo un arco)
// No hay ajuste a cuadrícula, extremos ni intersecciones: los ángulos son los de las muestras, sin redondear.
// Los umbrales en píxeles de pantalla (banda de inicio, zona muerta junto al centro) solo deciden qué muestras
// cuentan; nunca mueven ninguna coordenada.

import { normalizeDeg, segmentAngle, segmentLength } from './geometry.js';

/** Distancia máxima (px de pantalla) entre el punto de apoyo y la guía para que el trazo la siga. */
export const TRACE_BAND_PX = 16;
/** Junto al centro el ángulo no es fiable: se ignoran las muestras a menos de esta distancia (px de pantalla). */
export const CENTER_DEAD_PX = 8;
/** Longitud mínima de arco (mm) para crear algo: restos numéricos, no una tolerancia de dibujo. */
export const MIN_TRACE_MM = 1e-6;
/**
 * Holgura numérica (grados) al comparar con 360°: una vuelta exacta acumula errores de coma flotante del orden de
 * 1e-12°. No es una tolerancia de dibujo: 359,9° o 359,99999° siguen siendo arcos.
 */
export const FULL_TURN_EPS_DEG = 1e-9;

/** ¿El trazo que empieza en p sigue la guía circular? `scale` = px de pantalla por mm. */
export function startsOnCircle(c, r, p, scale, bandPx = TRACE_BAND_PX) {
  return Math.abs(segmentLength(c, p) - r) * scale <= bandPx;
}

/** Trazo vacío sobre la circunferencia (c, r). Se copia c: el centro no cambia aunque cambie el original. */
export function createCircleTrace(c, r, { scale, deadPx = CENTER_DEAD_PX }) {
  return {
    c: { x: c.x, y: c.y }, r, dead: deadPx / scale,
    last: null, acc: 0, min: 0, max: 0, minAngle: null, maxAngle: null,
  };
}

/** Añade una muestra (mm de hoja). Modifica y devuelve el trazo. */
export function extendCircleTrace(t, p) {
  const dist = segmentLength(t.c, p);
  if (!(dist >= t.dead) || dist === 0) return t; // junto al centro (o en él) no hay ángulo fiable
  const angle = segmentAngle(t.c, p);
  if (t.last === null) {
    t.last = angle; t.minAngle = angle; t.maxAngle = angle;
    return t;
  }
  let d = normalizeDeg(angle - t.last);
  if (d > 180) d -= 360;
  t.acc += d;
  t.last = angle;
  if (t.acc < t.min) { t.min = t.acc; t.minAngle = angle; }
  if (t.acc > t.max) { t.max = t.acc; t.maxAngle = angle; }
  return t;
}

/** Recorrido acumulado (grados) entre el giro mínimo y el máximo. */
export function circleTraceSweep(t) {
  return t.max - t.min;
}

/** Geometría trazada hasta ahora: circunferencia, arco o null si no se ha recorrido nada. */
export function circleTraceResult(t) {
  const sweep = circleTraceSweep(t);
  if (t.minAngle === null || !(sweep * Math.PI * t.r / 180 >= MIN_TRACE_MM)) return null;
  const c = { x: t.c.x, y: t.c.y };
  if (sweep >= 360 - FULL_TURN_EPS_DEG) return { type: 'circle', c, r: t.r };
  return { type: 'arc', c, r: t.r, start: t.minAngle, sweep };
}

/** Atajo: trazo completo a partir de una lista de muestras. */
export function traceCircle(c, r, points, options) {
  const t = createCircleTrace(c, r, options);
  for (const p of points) extendCircleTrace(t, p);
  return circleTraceResult(t);
}
