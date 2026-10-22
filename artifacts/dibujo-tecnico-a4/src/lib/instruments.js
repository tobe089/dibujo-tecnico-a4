// Configuración de los instrumentos (regla, compás y transportador). Sin dependencias de DOM.
//
// Un instrumento NO es geometría: mostrarlo, ocultarlo o recolocarlo nunca cambia las entidades del dibujo ni
// entra en el historial de deshacer. Su configuración se guarda con el proyecto para restaurarla al abrirlo.
// La colocación es una pose { x, y, rotation } (mm de hoja y grados: 0° = derecha, 90° = arriba, antihorario),
// de modo que moverlo o girarlo con gestos en etapas posteriores solo tendrá que cambiar la pose.

const isNum = Number.isFinite;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

/** Transportador sin colocar (pose null): vértice en pose.x/pose.y y rayo base (0°) en pose.rotation. */
export const PROTRACTOR_DEFAULTS = Object.freeze({
  visible: false, pose: null, angle: 60, cw: false, rayLength: 50, baseRay: true, mark: true,
});

/**
 * Compás como guía de trazado: centro en pose.x/pose.y, dirección del último radio definido en pose.rotation,
 * radio exacto en mm y si el lápiz traza siguiendo la guía. Definirlo nunca crea geometría.
 */
export const COMPASS_DEFAULTS = Object.freeze({ visible: false, pose: null, radius: 30, trace: true });
/** Radio máximo admitido (mm), el mismo límite que la creación por valores. */
export const COMPASS_MAX_RADIUS = 500;

export function defaultInstruments() {
  return { ruler: { visible: false }, compass: { ...COMPASS_DEFAULTS }, protractor: { ...PROTRACTOR_DEFAULTS } };
}

/** Pose exacta, o null si falta algún valor o no es un número finito. No redondea ni normaliza. */
export function sanitizePose(p) {
  if (!isObj(p) || !isNum(p.x) || !isNum(p.y) || !isNum(p.rotation)) return null;
  return { x: p.x, y: p.y, rotation: p.rotation };
}

/** Configuración del transportador con cada campo validado; lo no válido toma el valor por defecto. */
export function sanitizeProtractor(p) {
  const d = PROTRACTOR_DEFAULTS;
  if (!isObj(p)) return { ...d };
  return {
    visible: p.visible === true,
    pose: sanitizePose(p.pose),
    angle: isNum(p.angle) ? p.angle : d.angle,
    cw: bool(p.cw, d.cw),
    rayLength: isNum(p.rayLength) && p.rayLength > 0 ? p.rayLength : d.rayLength,
    baseRay: bool(p.baseRay, d.baseRay),
    mark: bool(p.mark, d.mark),
  };
}

/** Configuración del compás con cada campo validado; lo no válido toma el valor por defecto. */
export function sanitizeCompass(p) {
  const d = COMPASS_DEFAULTS;
  if (!isObj(p)) return { ...d };
  return {
    visible: p.visible === true,
    pose: sanitizePose(p.pose),
    radius: isNum(p.radius) && p.radius > 0 && p.radius <= COMPASS_MAX_RADIUS ? p.radius : d.radius,
    trace: bool(p.trace, d.trace),
  };
}

export function sanitizeInstruments(ins) {
  const base = defaultInstruments();
  if (!isObj(ins)) return base;
  // Regla: se conserva su configuración guardada (la etapa de la regla la ampliará y la validará).
  if (isObj(ins.ruler)) base.ruler = { ...ins.ruler, visible: ins.ruler.visible === true };
  base.compass = sanitizeCompass(ins.compass);
  base.protractor = sanitizeProtractor(ins.protractor);
  return base;
}
