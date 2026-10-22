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

export function defaultInstruments() {
  return { ruler: { visible: false }, compass: { visible: false }, protractor: { ...PROTRACTOR_DEFAULTS } };
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

export function sanitizeInstruments(ins) {
  const base = defaultInstruments();
  if (!isObj(ins)) return base;
  // Regla y compás: se conserva su configuración guardada (las etapas siguientes la amplían y la validan).
  for (const k of ['ruler', 'compass']) if (isObj(ins[k])) base[k] = { ...ins[k], visible: ins[k].visible === true };
  base.protractor = sanitizeProtractor(ins.protractor);
  return base;
}
