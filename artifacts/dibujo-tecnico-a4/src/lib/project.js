// Formato de proyecto v3. Sin dependencias de DOM.
//
// Un proyecto separa cuatro cosas que no deben mezclarse:
//   entities     geometría en milímetros de hoja (lo único que se dibuja, mide y exporta)
//   sheet        hoja A4 y su orientación; cambiar la orientación NO transforma ninguna coordenada
//   view         cómo se estaba mirando (centro en mm, zoom relativo al encaje, rotación): no es geometría
//   selection    ids seleccionados al cerrar; al abrir se descartan los que ya no existan
// En archivo y en IndexedDB los trazos libres se guardan "empaquetados" (listas planas de números): ocupan la
// mitad que los objetos {x,y,p} y conservan cada número exactamente (JSON y IndexedDB guardan el double tal cual).

import { sheetFor } from './geometry.js';
import {
  DEFAULT_COLOR, DEFAULT_MARGINS, DEFAULT_WIDTH, entityInsideSheet, makeId, migrateV1, sanitizeEntity,
} from './document.js';

export const PROJECT_FORMAT = 'dibujo-tecnico-a4/proyecto';
export const PROJECT_VERSION = 3;
/** Id fijo del proyecto creado a partir del dibujo guardado en localStorage: evita duplicarlo al reiniciar. */
export const LEGACY_PROJECT_ID = 'migrado-localstorage';
export const ORIENTATIONS = ['portrait', 'landscape'];

const isNum = Number.isFinite;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const validName = (n) => (typeof n === 'string' && n.trim() ? n.trim().slice(0, 120) : 'Sin título');
const validDate = (d, fallback) => (typeof d === 'string' && !Number.isNaN(Date.parse(d)) ? d : fallback);

export function defaultInstruments() {
  return { ruler: { visible: false }, compass: { visible: false }, protractor: { visible: false } };
}

function sanitizeMargins(m) {
  const out = { ...DEFAULT_MARGINS };
  if (isObj(m)) for (const k of Object.keys(out)) if (isNum(m[k])) out[k] = Math.max(0, Math.min(40, m[k]));
  return out;
}

function sanitizeView(v) {
  if (!isObj(v) || !isObj(v.center) || !isNum(v.center.x) || !isNum(v.center.y) || !isNum(v.zoom) || !(v.zoom > 0)) return null;
  return { center: { x: v.center.x, y: v.center.y }, zoom: v.zoom, rotation: isNum(v.rotation) ? v.rotation : 0 };
}

function sanitizeInstruments(ins) {
  const base = defaultInstruments();
  if (!isObj(ins)) return base;
  // Se conserva la configuración guardada de cada instrumento (las etapas siguientes la amplían).
  for (const k of Object.keys(base)) if (isObj(ins[k])) base[k] = { ...ins[k], visible: ins[k].visible === true };
  return base;
}

export function createProject({ name, orientation = 'portrait', id = makeId(), now = new Date().toISOString() } = {}) {
  return {
    format: PROJECT_FORMAT, version: PROJECT_VERSION, id, name: validName(name),
    createdAt: now, modifiedAt: now, revision: 0,
    sheet: { size: 'A4', orientation: ORIENTATIONS.includes(orientation) ? orientation : 'portrait', margins: { ...DEFAULT_MARGINS }, grid: { visible: true } },
    style: { color: DEFAULT_COLOR, width: DEFAULT_WIDTH },
    entities: [], instruments: defaultInstruments(), view: null, selection: [],
  };
}

export const projectSheet = (project) => sheetFor(project.sheet.orientation);

// ───────────────────────── Empaquetado de trazos libres ─────────────────────────

function packEntity(e) {
  if (e.type !== 'polyline') return e;
  const xy = new Array(e.points.length * 2);
  let hasP = false;
  e.points.forEach((p, i) => { xy[2 * i] = p.x; xy[2 * i + 1] = p.y; if (isNum(p.p)) hasP = true; });
  const { points, ...rest } = e;
  const packed = { ...rest, xy };
  if (hasP) packed.p = e.points.map((p) => (isNum(p.p) ? p.p : null));
  return packed;
}

function unpackEntity(e) {
  if (!isObj(e) || e.type !== 'polyline' || !Array.isArray(e.xy)) return e;
  const points = [];
  for (let i = 0; i + 1 < e.xy.length; i += 2) {
    const pt = { x: e.xy[i], y: e.xy[i + 1] };
    const pr = Array.isArray(e.p) ? e.p[i / 2] : null;
    if (isNum(pr)) pt.p = pr;
    points.push(pt);
  }
  const { xy, p, ...rest } = e;
  return { ...rest, points };
}

/** Objeto listo para guardar (IndexedDB o archivo JSON). No modifica el proyecto. */
export function serializeProject(project) {
  return { ...project, entities: project.entities.map(packEntity) };
}

export function projectToJson(project) {
  return JSON.stringify(serializeProject(project));
}

// ───────────────────────── Lectura y migración ─────────────────────────

/** Ids de la selección que siguen existiendo. */
export function filterSelection(ids, entities) {
  if (!Array.isArray(ids)) return [];
  const present = new Set(entities.map((e) => e.id));
  return [...new Set(ids.filter((id) => typeof id === 'string' && present.has(id)))];
}

/** Convierte un documento v2 ({ version: 2, entities, margins, color, width }) en proyecto v3. */
export function projectFromDocV2(doc, { name = 'Dibujo anterior', id = makeId(), now = new Date().toISOString() } = {}) {
  const p = createProject({ name, id, now });
  p.entities = doc.entities;
  p.sheet.margins = sanitizeMargins(doc.margins);
  p.style = { color: doc.color, width: doc.width };
  return p;
}

/**
 * Interpreta un proyecto guardado o importado. Acepta v3 (empaquetado o no), documentos v2 y dibujos v1.
 * Devuelve { project, source: 'v3'|'v2'|'v1', dropped, selectionDropped }. Lanza si no es un dibujo reconocible.
 * Las coordenadas se conservan exactamente; solo se descartan entidades inutilizables (y se cuentan).
 */
export function parseProject(data, { now = new Date().toISOString(), id } = {}) {
  const obj = typeof data === 'string' ? JSON.parse(data) : data;
  if (!isObj(obj)) throw new Error('El archivo no contiene un proyecto de Dibujo Técnico A4.');
  if (obj.format === PROJECT_FORMAT || obj.version === PROJECT_VERSION) {
    if (obj.version !== PROJECT_VERSION) throw new Error(`Versión de proyecto no compatible (${obj.version}).`);
    if (!Array.isArray(obj.entities)) throw new Error('El proyecto no tiene una lista de elementos válida.');
    const entities = [];
    let dropped = 0;
    for (const raw of obj.entities) { const e = sanitizeEntity(unpackEntity(raw)); if (e) entities.push(e); else dropped += 1; }
    const sheet = isObj(obj.sheet) ? obj.sheet : {};
    const selection = filterSelection(obj.selection, entities);
    const project = {
      format: PROJECT_FORMAT, version: PROJECT_VERSION,
      id: id ?? (typeof obj.id === 'string' && obj.id ? obj.id : makeId()),
      name: validName(obj.name),
      createdAt: validDate(obj.createdAt, now), modifiedAt: validDate(obj.modifiedAt, now),
      revision: Number.isInteger(obj.revision) && obj.revision >= 0 ? obj.revision : 0,
      sheet: {
        size: 'A4', orientation: ORIENTATIONS.includes(sheet.orientation) ? sheet.orientation : 'portrait',
        margins: sanitizeMargins(sheet.margins), grid: { visible: !isObj(sheet.grid) || sheet.grid.visible !== false },
      },
      style: {
        color: isObj(obj.style) && /^#[0-9a-f]{6}$/i.test(obj.style.color) ? obj.style.color : DEFAULT_COLOR,
        width: isObj(obj.style) && isNum(obj.style.width) && obj.style.width > 0 ? obj.style.width : DEFAULT_WIDTH,
      },
      entities, instruments: sanitizeInstruments(obj.instruments), view: sanitizeView(obj.view), selection,
    };
    return { project, source: 'v3', dropped, selectionDropped: (Array.isArray(obj.selection) ? obj.selection.length : 0) - selection.length };
  }
  if (obj.version === 2 && Array.isArray(obj.entities)) {
    const entities = [];
    let dropped = 0;
    for (const raw of obj.entities) { const e = sanitizeEntity(raw); if (e) entities.push(e); else dropped += 1; }
    const doc = { version: 2, entities, margins: obj.margins, color: isObj(obj) && /^#[0-9a-f]{6}$/i.test(obj.color) ? obj.color : DEFAULT_COLOR, width: isNum(obj.width) && obj.width > 0 ? obj.width : DEFAULT_WIDTH };
    return { project: projectFromDocV2(doc, { id, now }), source: 'v2', dropped, selectionDropped: 0 };
  }
  if (Array.isArray(obj.strokes)) {
    const { doc, dropped } = migrateV1(obj);
    return { project: projectFromDocV2(doc, { id, now }), source: 'v1', dropped, selectionDropped: 0 };
  }
  throw new Error('El archivo no contiene un proyecto de Dibujo Técnico A4.');
}

/** Elementos que quedarían (total o parcialmente) fuera de la hoja con otra orientación. No se mueven. */
export function entitiesOutsideSheet(entities, orientation) {
  const sheet = sheetFor(orientation);
  return entities.filter((e) => !entityInsideSheet(e, 1e-9, sheet)).length;
}

/** Datos de la biblioteca para un proyecto (sin la geometría). */
export function indexRecordFor(project, extra = {}) {
  return {
    id: project.id, name: project.name, createdAt: project.createdAt, modifiedAt: project.modifiedAt,
    revision: project.revision, orientation: project.sheet.orientation, entityCount: project.entities.length,
    openedAt: extra.openedAt ?? null, thumbnail: extra.thumbnail ?? null,
  };
}
