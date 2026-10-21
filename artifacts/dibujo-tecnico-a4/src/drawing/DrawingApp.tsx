import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Check, Circle, Compass, Download, Dot, Equal, Eraser, FileDown, FolderOpen, Hand, MousePointer2, Pencil, Plus, Redo2, Ruler,
  Save, Settings2, Trash2, Triangle, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { createA4Pdf } from '@/lib/pdf-export.js';
import {
  angleConstruction, arcPoints, normalizeDeg, offsetLine, pointAt, relatedLine, segmentAngle, segmentLength, sheetFor, sweepBetween,
  type Orientation, type Sheet,
} from '@/lib/geometry.js';
import {
  commitHistory, createHistory, entityInsideSheet, hitTest, makeId, pointInsideSheet,
  redoHistory, removeEntities, sanitizeEntity, undoHistory, updateEntity,
  type Entity, type EntityPatch, type History, type Margins, type Pt,
} from '@/lib/document.js';
import { createProject, entitiesOutsideSheet, filterSelection, projectToJson, type Project } from '@/lib/project.js';
import type { Store } from '@/lib/storage.js';
import { createSaveManager, type SaveManager, type SaveStatus } from '@/lib/save-manager.js';
import { clearJournal, writeJournal } from '@/lib/journal.js';
import { makeThumbnail, projectChannel } from './project-io';
import { eraseWithCapsule } from '@/lib/erase.js';
import { buildSheetSvg, entityPathD, gridStyle, n, pointRadius } from '@/lib/render.js';
import { MAX_SCALE, MIN_SCALE, fitView, panBy, pinchView, screenToDoc, viewBoxFor, zoomAt, type View } from '@/lib/view.js';
import {
  PAN_SLOP_PX, beyondTapSlop, cancelOutcome, createPolicy, navPointers, penHover, pointerDown, pointerUp, roleOf,
  shouldRevertNav, type FingerMode,
} from '@/lib/pointer-policy.js';
import { EntityEditor } from './EntityEditor';
import { ExactField, NumField, Seg, Toggle, fmtNum, toNum } from './fields';

/** La calibración física y el botón 1:1 en pantalla quedan fuera de la primera versión: se ocultan, no se borran. */
const SHOW_PHYSICAL_SCALE = false;
const SAVE_LABEL: Record<SaveStatus['status'], string> = {
  saved: 'Guardado', dirty: 'Cambios sin guardar', saving: 'Guardando…', error: 'Error al guardar', conflict: 'Conflicto: sin guardar',
};

type Tool = 'pen' | 'point' | 'ruler' | 'compass' | 'protractor' | 'parallel' | 'perpendicular' | 'eraser' | 'select' | 'pan';
type Placement = 'start' | 'center' | 'foot';
/**
 * fingerMode: 'auto' (el dedo navega; si no hay S Pen detectado se ofrece activar el dibujo con el dedo),
 * 'pen' (el dedo solo navega) o 'all' (el dedo también dibuja). Se guarda entre recargas.
 * penDetected: se activa al primer evento de lápiz (apoyo o sobrevuelo) y se conserva entre recargas;
 * «Olvidar» lo devuelve al estado seguro inicial (el dedo sigue navegando, no dibuja).
 */
type Prefs = { fingerMode: FingerMode; eraserPx: number; eraserMode: 'partial' | 'whole'; penDetected: boolean; penDetectedAt: string | null };
type Calib = { devPxPerMm: number; dpr: number; at: string };
type Meta = { margins: Margins; color: string; width: number };
type Draft = { type: Entity['type'] } & EntityPatch;
type Pending = { entities: Draft[]; error?: string };
/** Gesto de dibujo en curso: nada se confirma en el documento hasta levantar el puntero. */
type Gesture = {
  id: number; pointerType: string; tool: Tool;
  startScreen: Pt; startDoc: Pt; curDoc: Pt; moved: boolean;
  points: (Pt & { p?: number })[];
  eraseR: number; working: Entity[] | null; lastErase: Pt | null;
  /** Posiciones del borrador (mm) para pintar la estela; el resultado exacto está en `working`. */
  trail: Pt[];
};

const PREFS_KEY = 'dibujo-tecnico-a4-prefs-v2';
const CALIB_KEY = 'dibujo-tecnico-a4-calibracion';
const CAL_MM = 100;
const HIT_PX = 12;
const colors = ['#244d58', '#bc573f', '#1e7663', '#3c4b8c', '#252b2d'];
const initialPrefs: Prefs = { fingerMode: 'auto', eraserPx: 10, eraserMode: 'partial', penDetected: false, penDetectedAt: null };
const DRAWING_TOOLS: Tool[] = ['pen', 'point', 'ruler', 'compass', 'protractor', 'parallel', 'perpendicular', 'eraser'];
const CONSTRUCTION: Tool[] = ['point', 'ruler', 'compass', 'protractor', 'parallel', 'perpendicular'];

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || {};
    return {
      fingerMode: ['auto', 'pen', 'all'].includes(p.fingerMode) ? p.fingerMode : initialPrefs.fingerMode,
      eraserPx: Number.isFinite(p.eraserPx) ? Math.max(3, Math.min(40, p.eraserPx)) : initialPrefs.eraserPx,
      eraserMode: p.eraserMode === 'whole' ? 'whole' : 'partial',
      penDetected: p.penDetected === true,
      penDetectedAt: typeof p.penDetectedAt === 'string' ? p.penDetectedAt : null,
    };
  } catch { return initialPrefs; }
}
function loadCalib(): Calib | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CALIB_KEY) || 'null');
    if (parsed && Number.isFinite(parsed.devPxPerMm) && parsed.devPxPerMm > 0 && Number.isFinite(parsed.dpr) && parsed.dpr > 0) return parsed;
  } catch { /* sin calibración válida */ }
  return null;
}
const pt = (p: Pt): Pt => ({ x: p.x, y: p.y });

/** Una entidad dibujada. Solo se vuelve a generar su trazado si la entidad cambia (las entidades son inmutables). */
const EntityPath = memo(function EntityPath({ entity: e }: { entity: Entity }) {
  return e.type === 'point'
    ? <path d={entityPathD(e)} fill={e.color} data-testid={`entity-${e.id}`} data-type={e.type} />
    : <path d={entityPathD(e)} fill="none" stroke={e.color} strokeWidth={e.width} strokeLinecap="round" strokeLinejoin="round" data-testid={`entity-${e.id}`} data-type={e.type} />;
});

const SheetGrid = memo(function SheetGrid({ sheet }: { sheet: Sheet }) {
  return <>
    {Array.from({ length: sheet.w + 1 }, (_, i) => <line key={`x-${i}`} x1={i} y1="0" x2={i} y2={sheet.h} stroke={gridStyle.color(i)} strokeWidth={gridStyle.weight(i)} />)}
    {Array.from({ length: sheet.h + 1 }, (_, i) => <line key={`y-${i}`} x1="0" y1={i} x2={sheet.w} y2={i} stroke={gridStyle.color(i)} strokeWidth={gridStyle.weight(i)} />)}
  </>;
});

export function DrawingApp({ store, project, onExit, onOpenProject }: {
  store: Store; project: Project; onExit: () => void; onOpenProject: (id: string) => void;
}) {
  const [history, setHistory] = useState<History<Entity[]>>(() => createHistory(project.entities));
  const [meta, setMeta] = useState<Meta>(() => ({ margins: project.sheet.margins, color: project.style.color, width: project.style.width }));
  const [orientation, setOrientation] = useState<Orientation>(project.sheet.orientation);
  const sheet = sheetFor(orientation);
  const entities = history.present;
  const restoredSelection = useMemo(() => filterSelection(project.selection, project.entities), [project]);
  const [tool, setTool] = useState<Tool>(restoredSelection.length ? 'select' : 'pen');
  const [selectedId, setSelectedId] = useState<string | null>(restoredSelection[0] ?? null);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveStatus>({ status: 'saved', message: '' });
  const [leaving, setLeaving] = useState(false);
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
  const stageSizeRef = useRef(stageSize);
  stageSizeRef.current = stageSize;
  const [view, setViewState] = useState<View>({ scale: 2, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const setView = useCallback((next: View | ((v: View) => View)) => {
    const value = typeof next === 'function' ? next(viewRef.current) : next;
    viewRef.current = value;
    setViewState(value);
  }, []);
  const [modal, setModal] = useState<'clear' | 'export' | 'calibrate' | 'leave' | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportGrid, setExportGrid] = useState(true);
  const [printSvg, setPrintSvg] = useState('');
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [calib, setCalib] = useState<Calib | null>(loadCalib);
  const [calMeasured, setCalMeasured] = useState('');
  const [notice, setNotice] = useState('');
  const [hover, setHover] = useState<Pt | null>(null);
  const [fingerPrompt, setFingerPrompt] = useState<'hidden' | 'shown' | 'dismissed'>('hidden');
  const [, setTick] = useState(0);

  // Regla
  const [ruleStart, setRuleStart] = useState<Pt | null>(null);
  const [ruleLength, setRuleLength] = useState('50');
  const [ruleAngle, setRuleAngle] = useState('0');
  const [ruleX, setRuleX] = useState('');
  const [ruleY, setRuleY] = useState('');
  // Compás
  const [compCenter, setCompCenter] = useState<Pt | null>(null);
  const [compArcStart, setCompArcStart] = useState<{ r: number; start: number } | null>(null);
  const [compFull, setCompFull] = useState(true);
  const [compCw, setCompCw] = useState(false);
  const [compRadius, setCompRadius] = useState('30');
  const [compStart, setCompStart] = useState('0');
  const [compEnd, setCompEnd] = useState('90');
  const [compX, setCompX] = useState('');
  const [compY, setCompY] = useState('');
  // Transportador
  const [protVertex, setProtVertex] = useState<Pt | null>(null);
  const [protBase, setProtBase] = useState(0);
  const [protAngle, setProtAngle] = useState('60');
  const [protLen, setProtLen] = useState('50');
  const [protCw, setProtCw] = useState(false);
  const [protBaseRay, setProtBaseRay] = useState(true);
  const [protMark, setProtMark] = useState(true);
  // Paralelas y perpendiculares
  const [relRef, setRelRef] = useState<string | null>(null);
  const [relPoint, setRelPoint] = useState<Pt | null>(null);
  const [relLen, setRelLen] = useState('50');
  const [relPlacement, setRelPlacement] = useState<Placement>('start');
  const [relFlip, setRelFlip] = useState(false);
  const [relMethod, setRelMethod] = useState<'point' | 'distance'>('point');
  const [relDist, setRelDist] = useState('10');

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const policyRef = useRef(createPolicy(prefs.fingerMode));
  const positions = useRef(new Map<number, Pt>());
  /** pan.armed: un dedo no desplaza la hoja hasta moverse PAN_SLOP_PX (una palma quieta no la mueve). */
  const navRef = useRef<{ mode: 'pan'; id: number; last: Pt; origin: Pt; armed: boolean } | { mode: 'pinch'; a: number; b: number; start: { view: View; a: Pt; b: Pt } } | null>(null);
  /** Vista y momento en que empezó la navegación actual: si el lápiz se apoya poco después, se deshace. */
  const navSessionRef = useRef<{ view: View; t0: number } | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  /** Toque de un dedo que navega: si no se mueve, con Seleccionar cuenta como selección. */
  const navTapRef = useRef<{ id: number; start: Pt; moved: boolean } | null>(null);
  const fittedRef = useRef(false);
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  useEffect(() => { policyRef.current.fingerMode = prefs.fingerMode; }, [prefs.fingerMode]);

  // ── Escenario y vista ──
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const size = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };
      setStageSize(size);
      if (!fittedRef.current && size.width > 0 && size.height > 0) {
        fittedRef.current = true;
        const base = fitView(size.width, size.height, 24, sheetRef.current);
        const saved = project.view;
        // Vista guardada: centro (mm) y zoom relativo al encaje; no afecta a la geometría.
        if (saved) {
          const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, base.scale * saved.zoom));
          setView({ scale, tx: size.width / 2 - saved.center.x * scale, ty: size.height / 2 - saved.center.y * scale });
        } else setView(base);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [setView, project]);
  const fit = useCallback(() => { if (stageSize) setView(fitView(stageSize.width, stageSize.height, 24, sheet)); }, [stageSize, setView, sheet]);
  const zoomCentered = (factor: number) => { if (stageSize) setView(v => zoomAt(v, stageSize.width / 2, stageSize.height / 2, factor)); };
  const fitScale = stageSize ? fitView(stageSize.width, stageSize.height, 24, sheet).scale : view.scale;

  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) setView(v => zoomAt(v, event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.01)));
      else setView(v => panBy(v, -event.deltaX, -event.deltaY));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [setView, stageSize]);

  // ── Guardado en la biblioteca (IndexedDB) ──
  // El proyecto que se guarda se construye en el momento de escribir, con el estado más reciente.
  const revisionRef = useRef(project.revision);
  const latest = useRef({ entities, meta, orientation, selectedId });
  latest.current = { entities, meta, orientation, selectedId };
  const snapshot = useCallback((): Project => {
    const cur = latest.current;
    const v = viewRef.current;
    const size = stageSizeRef.current;
    let savedView = project.view;
    if (size) {
      const base = fitView(size.width, size.height, 24, sheetFor(cur.orientation));
      savedView = { center: screenToDoc(v, size.width / 2, size.height / 2), zoom: v.scale / base.scale, rotation: 0 };
    }
    return {
      ...project, revision: revisionRef.current, entities: cur.entities,
      sheet: { ...project.sheet, orientation: cur.orientation, margins: cur.meta.margins },
      style: { color: cur.meta.color, width: cur.meta.width },
      view: savedView, selection: cur.selectedId ? filterSelection([cur.selectedId], cur.entities) : [],
    };
  }, [project]);
  const managerRef = useRef<SaveManager | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabId = useMemo(() => makeId(), []);
  useEffect(() => {
    const manager = createSaveManager({
      write: async () => {
        const snap = snapshot();
        const res = await store.save(snap, revisionRef.current);
        revisionRef.current = res.revision;
        lastSavedView.current = JSON.stringify(snap.view);
        channelRef.current?.postMessage({ type: 'saved', id: project.id, revision: res.revision, tab: tabId });
      },
      onStatus: (st) => {
        setSaveState(st);
        if (st.status === 'saved') { try { clearJournal(localStorage, project.id); } catch { /* sin localStorage */ } }
      },
    });
    managerRef.current = manager;
    return () => { manager.dispose(); managerRef.current = null; };
  }, [store, project.id, snapshot, tabId]);
  // Cada operación terminada (geometría, hoja, márgenes, estilo o selección) programa el guardado.
  const firstChange = useRef(true);
  useEffect(() => {
    if (firstChange.current) { firstChange.current = false; return; }
    managerRef.current?.changed();
  }, [entities, meta, orientation, selectedId]);
  // La vista (centro y zoom) no es geometría: no marca cambios, pero se guarda al salir si cambió.
  const lastSavedView = useRef(JSON.stringify(project.view));
  // Otras pestañas: si guardan este proyecto, se recarga (sin cambios aquí) o se marca el conflicto (con cambios).
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = projectChannel();
    channelRef.current = ch;
    ch.onmessage = async (ev) => {
      const msg = ev.data;
      if (!msg || msg.id !== project.id || msg.tab === tabId) return;
      if (msg.type === 'deleted') { managerRef.current?.markConflict('El proyecto se ha eliminado en otra pestaña o ventana.'); return; }
      if (msg.type !== 'saved' || msg.revision <= revisionRef.current) return;
      const m = managerRef.current;
      if (m && (m.isDirty() || m.isSaving())) { m.markConflict('El proyecto se modificó en otra pestaña o ventana.'); return; }
      try { await reloadFromStore('Se actualizó con los cambios guardados en otra pestaña.'); } catch { /* se informará al guardar */ }
    };
    return () => { ch.close(); channelRef.current = null; };
  }, [project.id, tabId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al ocultarse o cerrarse la página: copia síncrona (localStorage) + intento de guardar en IndexedDB.
  useEffect(() => {
    const onHide = () => {
      const m = managerRef.current;
      if (!m || (!m.isDirty() && !m.isSaving())) return;
      if (m.getState().status === 'conflict') return; // no se reescribe nada en conflicto
      try { writeJournal(localStorage, { project: snapshot(), baseRevision: revisionRef.current }); } catch { /* sin localStorage */ }
      void m.flush();
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') onHide(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onHide); };
  }, [snapshot]);
  const reloadFromStore = async (message: string) => {
    const fresh = await store.load(project.id);
    revisionRef.current = fresh.revision;
    gestureRef.current = null;
    setHistory(createHistory(fresh.entities));
    setMeta({ margins: fresh.sheet.margins, color: fresh.style.color, width: fresh.style.width });
    setOrientation(fresh.sheet.orientation);
    setSelectedId(null); setLastCreatedId(null);
    firstChange.current = true;
    managerRef.current?.resetClean();
    setNotice(message);
  };
  const saveNow = async () => { await managerRef.current?.flush(); void refreshThumbnail(); };
  const refreshThumbnail = async () => {
    try { await store.setThumbnail(project.id, await makeThumbnail(latest.current.entities, sheetFor(latest.current.orientation))); } catch { /* la miniatura no es crítica */ }
  };
  const exitToLibrary = async () => {
    setLeaving(true);
    const m = managerRef.current;
    if (m && m.getState().status === 'saved' && JSON.stringify(snapshot().view) !== lastSavedView.current) m.changed();
    await m?.flush();
    const st = managerRef.current?.getState().status;
    if (st === 'saved') { await refreshThumbnail(); onExit(); return; }
    setLeaving(false);
    setModal('leave');
  };
  const saveAsCopy = async () => {
    const copy = { ...createProject({ name: `${project.name} (copia)`, orientation: latest.current.orientation }), entities: latest.current.entities };
    copy.sheet.margins = latest.current.meta.margins;
    copy.style = { color: latest.current.meta.color, width: latest.current.meta.width };
    try {
      await store.create(copy, { thumbnail: await makeThumbnail(copy.entities, sheetFor(copy.sheet.orientation)).catch(() => null) });
      managerRef.current?.resetClean();
      onOpenProject(copy.id);
    } catch (e) { setNotice(`No se pudo crear la copia: ${(e as Error).message}`); }
  };
  const exportJson = () => download(new Blob([projectToJson(snapshot())], { type: 'application/json' }), `${project.name.replace(/[^\p{L}\p{N} _.-]/gu, '_') || 'proyecto'}.dta4.json`);
  const changeOrientation = (next: Orientation) => {
    if (next === orientation) return;
    const outside = entitiesOutsideSheet(entities, next);
    setOrientation(next);
    setNotice(outside ? `${outside} elemento(s) quedan fuera de la hoja ${next === 'landscape' ? 'horizontal' : 'vertical'}. No se han movido ni deformado.` : '');
    if (stageSize) setView(fitView(stageSize.width, stageSize.height, 24, sheetFor(next)));
  };
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* no crítico */ } }, [prefs]);
  /** Recuerda (también tras recargar) que este navegador ha recibido eventos de un S Pen. */
  const markPenDetected = () => {
    if (!prefs.penDetected) setPrefs(p => (p.penDetected ? p : { ...p, penDetected: true, penDetectedAt: new Date().toISOString().slice(0, 10) }));
  };

  // ── Historial ──
  const commit = useCallback((next: Entity[]) => {
    setHistory(h => commitHistory(h, next));
  }, []);
  const undo = useCallback(() => { setHistory(h => undoHistory(h)); setEditError(null); }, []);
  const redo = useCallback(() => { setHistory(h => redoHistory(h)); setEditError(null); }, []);

  const cancelGesture = useCallback(() => { gestureRef.current = null; setTick(t => t + 1); }, []);
  const resetConstruction = useCallback(() => {
    setRuleStart(null);
    setCompCenter(null); setCompArcStart(null);
    setProtVertex(null);
    setRelRef(null); setRelPoint(null);
    setNotice('');
    cancelGesture();
  }, [cancelGesture]);
  const chooseTool = (next: Tool) => { resetConstruction(); setTool(next); setLastCreatedId(null); setEditError(null); if (next !== 'select') setSelectedId(null); };

  const deleteIds = useCallback((ids: string[]) => {
    commit(removeEntities(entitiesRef.current, ids));
    setSelectedId(null); setLastCreatedId(null);
  }, [commit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); redo(); }
      else if (event.key === 'Escape') resetConstruction();
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) deleteIds([selectedId]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, resetConstruction, selectedId, deleteIds]);

  // ── Creación de entidades ──
  /** Crea entidades con el estilo actual. Las coordenadas se guardan exactamente como llegan. */
  const createEntities = (drafts: Draft[]): string | null => {
    const made: Entity[] = [];
    for (const draft of drafts) {
      const e = sanitizeEntity({ ...draft, id: makeId(), color: meta.color, width: meta.width });
      if (!e) return 'Valores no válidos.';
      if (e.type !== 'polyline' && !entityInsideSheet(e, 1e-9, sheet)) return 'Queda fuera de la hoja A4. Ajusta los valores.';
      made.push(e);
    }
    if (!made.length) return null;
    commit([...entitiesRef.current, ...made]);
    if (made.length === 1 && made[0].type !== 'polyline') setLastCreatedId(made[0].id);
    setNotice('');
    return null;
  };
  const tryCreate = (drafts: Draft[]) => { const error = createEntities(drafts); if (error) setNotice(error); return !error; };

  // ── Conversión de coordenadas (sin redondear ni ajustar) ──
  const screenOf = (event: { clientX: number; clientY: number }): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const docOf = (s: Pt): Pt => screenToDoc(viewRef.current, s.x, s.y);

  // ── Navegación ──
  const restartNav = (t: number) => {
    const previous = navRef.current;
    const ids = navPointers(policyRef.current).filter(id => positions.current.has(id));
    if (ids.length >= 2) {
      const [a, b] = ids;
      navRef.current = { mode: 'pinch', a, b, start: { view: viewRef.current, a: positions.current.get(a)!, b: positions.current.get(b)! } };
    } else if (ids.length === 1) {
      const pos = positions.current.get(ids[0])!;
      const type = policyRef.current.pointers.get(ids[0])?.type;
      // Tras un pellizco, el dedo que queda continúa sin umbral; ratón y lápiz (Desplazar) tampoco lo necesitan.
      const armed = type !== 'touch' || previous?.mode === 'pinch';
      navRef.current = { mode: 'pan', id: ids[0], last: pos, origin: pos, armed };
    } else navRef.current = null;
    if (!previous && navRef.current) navSessionRef.current = { view: viewRef.current, t0: t };
    if (!navRef.current) navSessionRef.current = null;
  };
  const updateNav = (id: number, s: Pt) => {
    const nav = navRef.current;
    if (!nav) return;
    if (nav.mode === 'pan' && nav.id === id) {
      if (!nav.armed) {
        if (Math.hypot(s.x - nav.origin.x, s.y - nav.origin.y) <= PAN_SLOP_PX) return;
        nav.armed = true; // a partir de aquí sigue al dedo desde donde se apoyó (sin salto)
      }
      setView(v => panBy(v, s.x - nav.last.x, s.y - nav.last.y));
      nav.last = s;
    } else if (nav.mode === 'pinch' && (nav.a === id || nav.b === id)) {
      const a = positions.current.get(nav.a), b = positions.current.get(nav.b);
      if (a && b) setView(pinchView(nav.start, a, b));
    }
  };

  // ── Gestos de dibujo ──
  const beginGesture = (id: number, pointerType: string, s: Pt, d: Pt, pressure: number) => {
    const g: Gesture = {
      id, pointerType, tool, startScreen: s, startDoc: d, curDoc: d, moved: false,
      points: [pointerType === 'pen' ? { ...d, p: pressure } : d],
      eraseR: prefs.eraserPx / viewRef.current.scale, working: null, lastErase: null, trail: [d],
    };
    if (tool === 'eraser') {
      g.working = eraseWithCapsule(entitiesRef.current, d, d, g.eraseR, { mode: prefs.eraserMode });
      g.lastErase = d;
    }
    gestureRef.current = g;
    setTick(t => t + 1);
  };
  const moveGesture = (g: Gesture, samples: { s: Pt; pressure: number }[]) => {
    for (const { s, pressure } of samples) {
      const d = docOf(s);
      g.curDoc = d;
      // Toque o arrastre se decide en px de PANTALLA (TAP_SLOP_PX); las coordenadas guardadas siguen siendo las exactas.
      if (!g.moved && beyondTapSlop(g.pointerType, g.startScreen, s)) g.moved = true;
      if (g.tool === 'pen') g.points.push(g.pointerType === 'pen' ? { ...d, p: pressure } : d);
      if (g.tool === 'eraser' && g.working && g.lastErase) {
        g.working = eraseWithCapsule(g.working, g.lastErase, d, g.eraseR, { mode: prefs.eraserMode });
        g.lastErase = d;
        g.trail.push(d);
      }
    }
    setTick(t => t + 1);
  };

  /** El gesto terminó: aquí, y solo aquí, se aplica al documento o al estado de la herramienta. */
  const finishGesture = (g: Gesture) => {
    gestureRef.current = null;
    setTick(t => t + 1);
    const tap = g.startDoc;
    const end = g.moved ? g.curDoc : g.startDoc;
    const outside = (p: Pt) => { if (!pointInsideSheet(p, sheet)) { setNotice('Ese punto está fuera de la hoja A4.'); return true; } return false; };
    switch (g.tool) {
      case 'pen':
        createEntities([{ type: 'polyline', points: g.points } as Draft]);
        break;
      case 'eraser':
        if (g.working && g.working !== entitiesRef.current) {
          commit(g.working);
          if (selectedId && !g.working.some(e => e.id === selectedId)) setSelectedId(null);
          setLastCreatedId(null);
        }
        break;
      case 'point':
        if (!outside(end)) tryCreate([{ type: 'point', x: end.x, y: end.y } as Draft]);
        break;
      case 'ruler': {
        if (!ruleStart) {
          if (outside(tap)) break;
          if (g.moved) { if (!outside(end) && segmentLength(tap, end) > 0) tryCreate([{ type: 'segment', a: pt(tap), b: pt(end) } as Draft]); }
          else { setRuleStart(pt(tap)); setNotice(''); }
        } else {
          if (outside(end)) break;
          if (segmentLength(ruleStart, end) > 0 && tryCreate([{ type: 'segment', a: ruleStart, b: pt(end) } as Draft])) setRuleStart(null);
        }
        break;
      }
      case 'compass': {
        if (!compCenter) {
          if (outside(tap)) break;
          if (g.moved) {
            const r = segmentLength(tap, end);
            if (!(r > 0)) break;
            if (compFull) tryCreate([{ type: 'circle', c: pt(tap), r } as Draft]);
            else { setCompCenter(pt(tap)); setCompArcStart({ r, start: segmentAngle(tap, end) }); }
          } else { setCompCenter(pt(tap)); setCompArcStart(null); setNotice(''); }
        } else if (!compArcStart) {
          const r = segmentLength(compCenter, end);
          if (!(r > 0)) break;
          if (compFull) { if (tryCreate([{ type: 'circle', c: compCenter, r } as Draft])) setCompCenter(null); }
          else setCompArcStart({ r, start: segmentAngle(compCenter, end) });
        } else {
          if (segmentLength(compCenter, end) === 0) break;
          const created = tryCreate([arcDraft(compCenter, compArcStart.r, compArcStart.start, segmentAngle(compCenter, end), compCw)]);
          if (created) { setCompCenter(null); setCompArcStart(null); }
        }
        break;
      }
      case 'protractor':
        if (!protVertex) { if (!outside(tap)) setProtVertex(pt(tap)); }
        else if (segmentLength(protVertex, end) > 0) setProtBase(segmentAngle(protVertex, end));
        break;
      case 'parallel':
      case 'perpendicular':
        if (!relRef) {
          const hit = hitTest(tap, entitiesRef.current, HIT_PX / viewRef.current.scale, e => e.type === 'segment');
          if (hit) { setRelRef(hit.id); setNotice(''); } else setNotice('Toca sobre un segmento recto ya dibujado.');
        } else if (!(g.tool === 'parallel' && relMethod === 'distance')) {
          if (!outside(end)) setRelPoint(pt(end));
        }
        break;
      case 'select': {
        const hit = hitTest(tap, entitiesRef.current, HIT_PX / viewRef.current.scale);
        setSelectedId(hit ? hit.id : null);
        setEditError(null);
        break;
      }
      default:
        break;
    }
  };

  // ── Eventos de puntero ──
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    const e = event.nativeEvent;
    const s = screenOf(e);
    const res = pointerDown(policyRef.current, { id: e.pointerId, type: e.pointerType, t: e.timeStamp, button: e.button, width: e.width, height: e.height }, { panTool: tool === 'pan' });
    if (e.pointerType === 'pen') markPenDetected();
    try { event.currentTarget.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    positions.current.set(e.pointerId, s);
    if (res.cancelDraw !== null && gestureRef.current?.id === res.cancelDraw) cancelGesture();
    if (res.stopNav) {
      // Palma que llegó antes que el lápiz: si esa navegación empezó hace poco, se deshace por completo.
      const session = navSessionRef.current;
      if (session && shouldRevertNav(session.t0, e.timeStamp)) setView(session.view);
      navRef.current = null;
      navSessionRef.current = null;
      navTapRef.current = null;
    }
    if (e.pointerType === 'touch' && res.role === 'nav' && prefs.fingerMode === 'auto' && !prefs.penDetected && fingerPrompt === 'hidden' && DRAWING_TOOLS.includes(tool)) setFingerPrompt('shown');
    if (res.role === 'nav') {
      restartNav(e.timeStamp);
      const solo = navRef.current?.mode === 'pan' && navRef.current.id === e.pointerId;
      navTapRef.current = solo ? { id: e.pointerId, start: s, moved: false } : null;
    } else if (res.role === 'draw') beginGesture(e.pointerId, e.pointerType, s, docOf(s), e.pressure);
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const e = event.nativeEvent;
    const role = roleOf(policyRef.current, e.pointerId);
    if (role === null) {
      // Sobrevuelo del lápiz o ratón sin pulsar: vista previa y rechazo de palma.
      if (e.pointerType === 'pen') { penHover(policyRef.current, e.timeStamp); markPenDetected(); }
      if (e.pointerType !== 'touch') setHover(docOf(screenOf(e)));
      return;
    }
    const s = screenOf(e);
    positions.current.set(e.pointerId, s);
    if (role === 'nav') {
      const tap = navTapRef.current;
      if (tap && tap.id === e.pointerId && beyondTapSlop('touch', tap.start, s)) tap.moved = true;
      updateNav(e.pointerId, s);
      return;
    }
    const g = gestureRef.current;
    if (role === 'draw' && g && g.id === e.pointerId) {
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const samples = (list.length ? list : [e]).map(c => ({ s: screenOf(c), pressure: c.pressure }));
      moveGesture(g, samples);
      if (e.pointerType !== 'touch') setHover(g.curDoc);
    }
  };
  const endPointer = (event: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const e = event.nativeEvent;
    const role = pointerUp(policyRef.current, e.pointerId, e.timeStamp);
    positions.current.delete(e.pointerId);
    if (role === 'nav') {
      const tap = navTapRef.current;
      navTapRef.current = null;
      if (!cancelled && tap && tap.id === e.pointerId && !tap.moved && tool === 'select') {
        const hit = hitTest(docOf(tap.start), entitiesRef.current, HIT_PX / viewRef.current.scale);
        setSelectedId(hit ? hit.id : null);
        setEditError(null);
      }
      restartNav(e.timeStamp);
    }
    const g = gestureRef.current;
    if (role === 'draw' && g && g.id === e.pointerId) {
      if (!cancelled) finishGesture(g);
      else if (cancelOutcome(g.tool, g.pointerType, g.points.length) === 'keep') {
        // Android interrumpió el lápiz: se conserva lo dibujado o borrado hasta ese momento (un paso de deshacer).
        finishGesture(g);
        setNotice('El sistema interrumpió el trazo: se conservó hasta el punto de interrupción.');
      } else {
        // Construcción sin punto final conocido, o contacto del dedo: se descarta sin cambiar nada.
        cancelGesture();
        if (g.pointerType !== 'touch') setNotice('El sistema interrumpió el gesto: no se ha creado nada.');
      }
    }
  };

  // ── Construcciones con valores numéricos (vista previa = lo que se crea) ──
  const refEntity = relRef ? entities.find(e => e.id === relRef) ?? null : null;
  const refSeg = refEntity && refEntity.type === 'segment' ? refEntity : null;
  const parallelDistance = tool === 'parallel' && relMethod === 'distance';
  const effectivePlacement: Placement = tool === 'parallel' && relPlacement === 'foot' ? 'start' : relPlacement;

  const pending: Pending | null = (() => {
    if (tool === 'protractor' && protVertex) {
      const angle = toNum(protAngle), length = toNum(protLen);
      if (!(angle > 0 && angle < 360) || !(length > 0 && length <= 500)) return { entities: [], error: 'Ángulo (0–360°) o longitud no válidos.' };
      const markRadius = Math.min(8, length / 2);
      const c = angleConstruction(protVertex, protBase, angle, protCw, length, markRadius);
      const list: Draft[] = [];
      if (protBaseRay) list.push({ type: 'segment', a: protVertex, b: c.baseEnd } as Draft);
      list.push({ type: 'segment', a: protVertex, b: c.rayEnd } as Draft);
      if (protMark) list.push({ type: 'arc', c: protVertex, r: markRadius, start: c.arcStartDeg, sweep: c.sweepDeg } as Draft);
      return withSheetCheck(list, sheet);
    }
    if ((tool === 'parallel' || tool === 'perpendicular') && refSeg) {
      let result: [Pt, Pt] | null = null;
      if (parallelDistance) {
        const distance = toNum(relDist);
        if (!(distance > 0 && distance <= 500)) return { entities: [], error: 'Distancia no válida (0–500 mm).' };
        result = offsetLine(refSeg.a, refSeg.b, distance, relFlip);
      } else if (relPoint) {
        const length = toNum(relLen);
        if (effectivePlacement !== 'foot' && !(length > 0 && length <= 500)) return { entities: [], error: 'Longitud no válida (0–500 mm).' };
        result = relatedLine({ ref0: refSeg.a, ref1: refSeg.b, mode: tool, through: relPoint, length, placement: effectivePlacement, flip: relFlip });
        if (!result) return { entities: [], error: 'No se puede construir: el punto está sobre la referencia o los datos no son válidos.' };
      } else return null;
      if (!result) return { entities: [], error: 'No se puede construir con estos valores.' };
      return withSheetCheck(sheet, [{ type: 'segment', a: result[0], b: result[1] } as Draft]);
    }
    return null;
  })();
  const commitPending = () => {
    if (!pending || pending.error || !pending.entities.length) return;
    if (tryCreate(pending.entities)) {
      if (tool === 'protractor') setProtVertex(null);
      else { setRelPoint(null); if (parallelDistance) setRelRef(null); }
    }
  };

  // Regla: crear por longitud y ángulo / fijar inicio por coordenadas.
  const ruleNumeric: Pending | null = (() => {
    if (tool !== 'ruler' || !ruleStart) return null;
    const length = toNum(ruleLength), angle = toNum(ruleAngle);
    if (!(length > 0 && length <= 500) || !Number.isFinite(angle)) return { entities: [], error: 'Longitud (0–500 mm) o ángulo no válidos.' };
    return withSheetCheck(sheet, [{ type: 'segment', a: ruleStart, b: pointAt(ruleStart, angle, length) } as Draft]);
  })();
  const compNumeric: Pending | null = (() => {
    if (tool !== 'compass' || !compCenter) return null;
    const r = toNum(compRadius);
    if (!(r > 0 && r <= 500)) return { entities: [], error: 'Radio no válido (0–500 mm).' };
    if (compFull) return withSheetCheck(sheet, [{ type: 'circle', c: compCenter, r } as Draft]);
    const start = toNum(compStart), endA = toNum(compEnd);
    if (!Number.isFinite(start) || !Number.isFinite(endA)) return { entities: [], error: 'Ángulo no válido.' };
    if (sweepBetween(start, endA) === 0) return { entities: [], error: 'El ángulo inicial y el final coinciden.' };
    return withSheetCheck(sheet, [arcDraft(compCenter, r, start, endA, compCw)]);
  })();
  const fixStartFromFields = (x: string, y: string, set: (p: Pt) => void) => {
    const p = { x: toNum(x), y: toNum(y) };
    if (!pointInsideSheet(p, sheet)) { setNotice(`Coordenadas fuera de la hoja (X 0–${sheet.w}, Y 0–${sheet.h} mm).`); return; }
    set(p); setNotice('');
  };

  // ── Vista previa en vivo de regla y compás (sigue al lápiz/dedo, sin ajustar) ──
  const g = gestureRef.current;
  const pointerDoc = g && g.tool === tool ? (g.moved ? g.curDoc : null) : hover;
  const livePreview: { entity: Draft; label: string } | null = (() => {
    if (tool === 'ruler') {
      const a = ruleStart ?? (g && g.tool === 'ruler' && g.moved ? g.startDoc : null);
      const b = ruleStart ? pointerDoc : g && g.tool === 'ruler' && g.moved ? g.curDoc : null;
      if (!a || !b || segmentLength(a, b) === 0) return null;
      return { entity: { type: 'segment', a, b } as Draft, label: `${fmtNum(segmentLength(a, b))} mm · ${fmtNum(segmentAngle(a, b))}°` };
    }
    if (tool === 'compass') {
      const c = compCenter ?? (g && g.tool === 'compass' && g.moved ? g.startDoc : null);
      const q = compCenter ? pointerDoc : g && g.tool === 'compass' && g.moved ? g.curDoc : null;
      if (!c || !q || segmentLength(c, q) === 0) return null;
      if (compArcStart && compCenter) {
        const endA = segmentAngle(compCenter, q);
        return { entity: arcDraft(compCenter, compArcStart.r, compArcStart.start, endA, compCw), label: `r ${fmtNum(compArcStart.r)} mm · final ${fmtNum(endA)}°` };
      }
      const r = segmentLength(c, q);
      return { entity: { type: 'circle', c, r } as Draft, label: `r ${fmtNum(r)} mm · ${fmtNum(segmentAngle(c, q))}°` };
    }
    return null;
  })();

  // ── Exportación ──
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const downloadPng = () => {
    const svgString = buildSheetSvg(entities, meta.margins, { grid: exportGrid, sheet });
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
    image.onload = () => {
      const canvas = document.createElement('canvas');
      // 300 ppp: 2480 × 3508 px en vertical, 3508 × 2480 en horizontal.
      canvas.width = Math.round(sheet.w / 25.4 * 300); canvas.height = Math.round(sheet.h / 25.4 * 300);
      const context = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!context) return;
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { if (blob) download(blob, 'dibujo-tecnico-a4.png'); }, 'image/png');
    };
    image.onerror = () => { URL.revokeObjectURL(url); alert('No se pudo preparar el PNG.'); };
    image.src = url;
    setModal(null);
  };
  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const bytes = await createA4Pdf(entities, meta.margins, { grid: exportGrid, orientation });
      download(new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }), 'dibujo-tecnico-a4.pdf');
      setModal(null);
    } catch {
      alert('No se pudo generar el PDF. El dibujo sigue guardado en este dispositivo.');
    } finally { setPdfBusy(false); }
  };
  const printPdf = () => {
    setPrintSvg(`<style>@page { size: A4 ${orientation}; margin: 0; } @media print { #print-sheet, #print-sheet svg { width: ${sheet.w}mm !important; height: ${sheet.h}mm !important; } }</style>${buildSheetSvg(entities, meta.margins, { grid: exportGrid, sheet })}`);
    setModal(null);
    window.setTimeout(() => window.print(), 120);
  };
  const setMargin = (key: keyof Margins, amount: number) => {
    setMeta(current => ({ ...current, margins: { ...current.margins, [key]: amount } }));
  };
  const validateMargin = (v: number) => (v >= 0 && v <= 40 ? null : 'Debe estar entre 0 y 40 mm.');

  // ── Escala 1:1 (función existente; requiere calibración manual) ──
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cssPxPerPhysicalMm = calib ? calib.devPxPerMm / dpr : null;
  const screenScale = cssPxPerPhysicalMm ? view.scale / cssPxPerPhysicalMm : null;
  const applyRealScale = (cssPxPerMm: number) => {
    if (!stageSize) return;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cssPxPerMm));
    setView({ scale, tx: (stageSize.width - sheet.w * scale) / 2, ty: 8 });
    setNotice(scale !== cssPxPerMm ? 'El zoom máximo no alcanza la escala 1:1 en esta pantalla.' : '');
  };
  const goRealScale = () => { if (!cssPxPerPhysicalMm) { setCalMeasured(''); setModal('calibrate'); return; } applyRealScale(cssPxPerPhysicalMm); };
  const saveCalibration = () => {
    const measured = toNum(calMeasured);
    if (!(measured >= 20 && measured <= 400)) return;
    const cssPxPerMm = (CAL_MM * 96 / 25.4) / measured;
    const next: Calib = { devPxPerMm: cssPxPerMm * dpr, dpr, at: new Date().toISOString().slice(0, 10) };
    try { localStorage.setItem(CALIB_KEY, JSON.stringify(next)); } catch { /* solo esta sesión */ }
    setCalib(next); setModal(null); applyRealScale(cssPxPerMm);
  };

  // ── Edición de la entidad seleccionada o recién creada ──
  const editingId = tool === 'select' ? selectedId : lastCreatedId;
  const editing = editingId ? entities.find(e => e.id === editingId) ?? null : null;
  const patchEditing = (patch: EntityPatch) => {
    if (!editing) return;
    const res = updateEntity(entities, editing.id, patch, sheet);
    setEditError(res.error);
    if (!res.error) commit(res.entities);
  };
  const editor = editing && <EntityEditor
    entity={editing} error={editError} onPatch={patchEditing}
    onDelete={() => deleteIds([editing.id])}
    onApplyStyle={() => patchEditing({ color: meta.color, width: meta.width })}
  />;

  // ── Dibujo del escenario ──
  const vb = stageSize ? viewBoxFor(view, stageSize.width, stageSize.height) : { x: 0, y: 0, w: sheet.w, h: sheet.h };
  const px = 1 / view.scale; // 1 px de pantalla en mm
  // Durante una pasada del borrador se sigue mostrando la geometría anterior y, encima, la estela pintada con el
  // mismo papel milimetrado: lo que queda bajo la estela es exactamente lo que se borra (cápsulas de radio r).
  // El resultado exacto (g.working) se calcula en cada movimiento y se aplica al levantar el lápiz. Así cada
  // movimiento solo repinta un tramo pequeño, en vez de toda la geometría que cruza un elemento recortado.
  const shown = entities;
  const entityNodes = useMemo(() => shown.map(e => <EntityPath key={e.id} entity={e} />), [shown]);
  const highlightIds = [editingId, relRef].filter(Boolean) as string[];
  const previewPath = (d: Draft, key: string) => {
    const e = sanitizeEntity({ ...d, id: key, color: '#cf6349', width: meta.width });
    return e ? <path key={key} d={entityPathD(e)} fill="none" stroke="#cf6349" strokeWidth={Math.max(meta.width, 1.5 * px)} strokeDasharray={`${6 * px} ${4 * px}`} strokeLinecap="round" pointerEvents="none" data-testid="preview" /> : null;
  };
  const marker = (p: Pt, key: string) => <g key={key} pointerEvents="none">
    <line x1={p.x - 7 * px} y1={p.y} x2={p.x + 7 * px} y2={p.y} stroke="#cf6349" strokeWidth={1.4 * px} />
    <line x1={p.x} y1={p.y - 7 * px} x2={p.x} y2={p.y + 7 * px} stroke="#cf6349" strokeWidth={1.4 * px} />
  </g>;

  const protractorOverlay = (() => {
    if (tool !== 'protractor' || !protVertex) return null;
    const sign = protCw ? -1 : 1;
    const outer = 42;
    const ticks = [];
    for (let deg = 0; deg <= 180; deg += 1) {
      const len = deg % 10 === 0 ? 6 : deg % 5 === 0 ? 4.5 : 3;
      const a = pointAt(protVertex, protBase + sign * deg, outer);
      const b = pointAt(protVertex, protBase + sign * deg, outer - len);
      ticks.push(<line key={deg} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#4d6b72" strokeWidth={deg % 10 === 0 ? 0.22 : 0.12} />);
    }
    const labels = [];
    for (let deg = 0; deg <= 180; deg += 10) {
      const p = pointAt(protVertex, protBase + sign * deg, outer + 3.4);
      labels.push(<text key={deg} x={p.x} y={p.y} fontSize="2.4" textAnchor="middle" dominantBaseline="middle" fill="#4d6b72">{deg}</text>);
    }
    const edge = arcPoints(protVertex, outer, protCw ? protBase - 180 : protBase, 180);
    const angle = toNum(protAngle);
    const pointer = Number.isFinite(angle) ? pointAt(protVertex, protBase + sign * angle, outer + 6) : null;
    const baseEnd = pointAt(protVertex, protBase, outer + 6);
    return <g pointerEvents="none">
      <path d={`${edge.map((p, i) => `${i ? 'L' : 'M'} ${n(p.x)} ${n(p.y)}`).join(' ')} Z`} fill="#dfeeea" fillOpacity=".38" stroke="#4d6b72" strokeWidth=".2" />
      {ticks}{labels}
      <line x1={protVertex.x} y1={protVertex.y} x2={baseEnd.x} y2={baseEnd.y} stroke="#8aa3a8" strokeWidth=".2" strokeDasharray="1.2 .8" />
      {pointer && <line x1={protVertex.x} y1={protVertex.y} x2={pointer.x} y2={pointer.y} stroke="#cf6349" strokeWidth=".3" />}
    </g>;
  })();

  // ── Paneles ──
  const errorLine = (p: Pending | null) => (p?.error ? <div className="notice" data-testid="text-construction-error">{p.error}</div> : null);
  const createRow = (p: Pending | null, onCreate: () => void, label = 'Crear') => <div className="create-row">
    <button className="btn primary" onClick={onCreate} disabled={!p || !!p.error || !p.entities.length} data-testid="button-place-line"><Check size={14} />{label}</button>
    <button className="btn" onClick={resetConstruction} data-testid="button-reset-construction">Reiniciar</button>
  </div>;
  const noticeLine = notice ? <div className="notice" data-testid="text-notice">{notice}</div> : null;
  const liveLine = livePreview ? <div className="hint-small mono-line" data-testid="text-live">Vista previa: {livePreview.label}</div> : null;
  const scaleLabel = screenScale === null ? 'escala sin calibrar' : Math.abs(screenScale - 1) < 0.005 ? '1:1 real' : `×${screenScale.toFixed(2)}`;
  const fingerNow = prefs.fingerMode === 'all';
  const toolHints: Record<Tool, string> = {
    pen: 'Trazo libre', point: 'Toca para marcar un punto', ruler: 'Regla: toca inicio y final', compass: 'Compás: centro y radio',
    protractor: 'Transportador: ángulo exacto', parallel: 'Paralela a un segmento', perpendicular: 'Perpendicular a un segmento',
    eraser: 'Borrador: pasa sobre lo que quieras quitar', select: 'Toca un elemento para editarlo', pan: 'Arrastra para mover la hoja',
  };
  const toolButtons: [Tool, string, ReactNode][] = [
    ['pen', 'Lápiz', <Pencil size={18} />], ['point', 'Punto', <Dot size={18} />],
    ['ruler', 'Regla', <Ruler size={18} />], ['compass', 'Compás', <Compass size={18} />],
    ['protractor', 'Transportador', <Triangle size={18} />], ['parallel', 'Paralela', <Equal size={18} />],
    ['perpendicular', 'Perpendicular', <Plus size={18} />], ['eraser', 'Borrador', <Eraser size={18} />],
    ['select', 'Seleccionar', <MousePointer2 size={18} />], ['pan', 'Desplazar', <Hand size={18} />],
  ];

  return (
    <main className="app-shell" data-project-id={project.id}>
      <header className="topbar">
        <div className="brand">
          <button className="btn" onClick={exitToLibrary} disabled={leaving} data-testid="button-library" aria-label="Volver a la biblioteca"><FolderOpen size={15} /><span className="export-label">Biblioteca</span></button>
          <div className="project-title"><div className="brand-name" data-testid="text-project-name">{project.name}</div><div className="brand-sub">DIBUJO TÉCNICO A4 · MILÍMETROS REALES</div></div>
        </div>
        <div className="top-actions">
          <span className={`status-save status-${saveState.status}`} data-testid="status-autosave" data-status={saveState.status} title={saveState.message}>{SAVE_LABEL[saveState.status]}</span>
          <button className="btn" onClick={saveNow} disabled={saveState.status === 'conflict'} data-testid="button-save"><Save size={15} /><span className="export-label">Guardar</span></button>
          <button className="btn" onClick={() => setModal('export')} data-testid="button-export"><FileDown size={15} /><span className="export-label">Exportar</span></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="tool-rail" aria-label="Herramientas de dibujo">
          {(saveState.status === 'error' || saveState.status === 'conflict') && <div className="notice save-problem" role="alert" data-testid="save-problem">
            <b>{saveState.status === 'conflict' ? 'No se ha guardado: conflicto' : 'No se ha podido guardar'}</b>
            <span>{saveState.message} Tus cambios siguen en pantalla y no se ha sobrescrito nada.</span>
            <div className="problem-actions">
              {saveState.status === 'error' && <button className="btn small" onClick={() => void managerRef.current?.flush()} data-testid="button-retry-save">Reintentar</button>}
              {saveState.status === 'conflict' && <button className="btn small" onClick={saveAsCopy} data-testid="button-save-copy">Guardar mis cambios como copia</button>}
              {saveState.status === 'conflict' && <button className="btn small" onClick={() => void reloadFromStore('Se cargó la versión guardada; se descartaron los cambios de esta pestaña.').catch(e => setNotice(String(e?.message || e)))} data-testid="button-reload-saved">Descartar los míos y cargar la versión guardada</button>}
              <button className="btn small" onClick={exportJson} data-testid="button-export-json-emergency">Exportar copia (JSON)</button>
            </div>
          </div>}
          <section className="panel-section primary-tools">
            <div className="section-head">Herramientas <Settings2 size={13} /></div>
            <div className="tool-grid">
              {toolButtons.map(([id, label, icon]) => <button key={id} className={`tool-button ${tool === id ? 'active' : ''}`} onClick={() => chooseTool(id)} data-testid={`tool-${id}`}>{icon}{label}</button>)}
            </div>
          </section>
          <section className="panel-section">
            <div className="section-head">Trazo nuevo</div>
            <div className="color-row">
              <input aria-label="Color del trazo" className="color-picker" type="color" value={meta.color} onChange={event => setMeta(current => ({ ...current, color: event.target.value }))} data-testid="input-color" />
              <div className="color-presets">{colors.map(color => <button key={color} className={`swatch ${meta.color === color ? 'chosen' : ''}`} aria-label={`Usar color ${color}`} onClick={() => setMeta(current => ({ ...current, color }))} data-testid={`swatch-${color.slice(1)}`}><span className="swatch-dot" style={{ backgroundColor: color }} /></button>)}</div>
            </div>
            <label className="control-label" htmlFor="stroke-width">Grosor <output>{meta.width.toFixed(2)} mm</output></label>
            <input id="stroke-width" type="range" min="0.15" max="2.5" step="0.05" value={meta.width} onChange={event => setMeta(current => ({ ...current, width: Number(event.target.value) }))} data-testid="input-width" />
          </section>

          {tool === 'ruler' && <section className="panel-section">
            <div className="section-head">Regla · dos puntos</div>
            <div className="rule-box" data-testid="status-ruler">
              <b>{!ruleStart ? '01 / Marca el inicio' : '02 / Marca el final'}</b>
              {!ruleStart ? 'Toca el punto inicial, o arrastra del inicio al final.' : 'Toca el punto final: la línea une exactamente los dos puntos. También puedes escribir longitud y ángulo.'}
              {liveLine}{noticeLine}
              {!ruleStart ? <div className="field-stack">
                <div className="field-pair">
                  <NumField label="Inicio X" unit="mm" value={ruleX} onChange={setRuleX} testid="input-rule-x" />
                  <NumField label="Inicio Y" unit="mm" value={ruleY} onChange={setRuleY} testid="input-rule-y" />
                </div>
                <button className="btn" onClick={() => fixStartFromFields(ruleX, ruleY, setRuleStart)} data-testid="button-rule-fix-start">Fijar inicio por coordenadas</button>
              </div> : <div className="field-stack">
                <div className="hint-small mono-line" data-testid="text-rule-start">Inicio: ({fmtNum(ruleStart.x)}, {fmtNum(ruleStart.y)}) mm</div>
                <div className="field-pair">
                  <NumField label="Longitud" unit="mm" value={ruleLength} onChange={setRuleLength} testid="input-rule-length" />
                  <NumField label="Ángulo" unit="°" value={ruleAngle} onChange={setRuleAngle} testid="input-rule-angle" />
                </div>
                <div className="hint-small">0° = derecha, 90° = arriba, sentido antihorario.</div>
                {errorLine(ruleNumeric)}
                {createRow(ruleNumeric, () => { if (ruleNumeric && tryCreate(ruleNumeric.entities)) setRuleStart(null); }, 'Crear con longitud y ángulo')}
              </div>}
            </div>
            {editor && <div className="section-head">Última línea · editable</div>}
            {editor}
          </section>}

          {tool === 'compass' && <section className="panel-section">
            <div className="section-head">Compás · centro y radio</div>
            <div className="rule-box" data-testid="status-compass">
              <b>{!compCenter ? '01 / Marca el centro' : !compArcStart ? '02 / Marca el radio' : '03 / Marca el final del arco'}</b>
              {!compCenter ? 'Toca el centro, o arrastra del centro a un punto de la circunferencia.' : !compArcStart ? (compFull ? 'Toca un punto de la circunferencia: el radio es la distancia exacta al centro.' : 'Toca el punto donde empieza el arco: fija el radio y el ángulo inicial.') : 'Toca hacia dónde termina el arco (solo cuenta la dirección).'}
              <Toggle checked={compFull} onChange={value => { setCompFull(value); setCompArcStart(null); }} label="Circunferencia completa" testid="toggle-compass-full" />
              {!compFull && <Seg value={compCw ? 'cw' : 'ccw'} onChange={value => setCompCw(value === 'cw')} testid="seg-compass-dir" options={[{ value: 'ccw', label: '↺ Antihorario' }, { value: 'cw', label: '↻ Horario' }]} />}
              {liveLine}{noticeLine}
              {!compCenter ? <div className="field-stack">
                <div className="field-pair">
                  <NumField label="Centro X" unit="mm" value={compX} onChange={setCompX} testid="input-compass-x" />
                  <NumField label="Centro Y" unit="mm" value={compY} onChange={setCompY} testid="input-compass-y" />
                </div>
                <button className="btn" onClick={() => fixStartFromFields(compX, compY, p => { setCompCenter(p); setCompArcStart(null); })} data-testid="button-compass-fix-center">Fijar centro por coordenadas</button>
              </div> : <div className="field-stack">
                <div className="hint-small mono-line" data-testid="text-compass-center">Centro: ({fmtNum(compCenter.x)}, {fmtNum(compCenter.y)}) mm{compArcStart ? ` · r ${fmtNum(compArcStart.r)} mm · inicio ${fmtNum(compArcStart.start)}°` : ''}</div>
                <NumField label="Radio" unit="mm" value={compRadius} onChange={setCompRadius} testid="input-compass-radius" />
                {!compFull && <div className="field-pair">
                  <NumField label="Ángulo inicial" unit="°" value={compStart} onChange={setCompStart} testid="input-compass-start" />
                  <NumField label="Ángulo final" unit="°" value={compEnd} onChange={setCompEnd} testid="input-compass-end" />
                </div>}
                {errorLine(compNumeric)}
                {createRow(compNumeric, () => { if (compNumeric && tryCreate(compNumeric.entities)) { setCompCenter(null); setCompArcStart(null); } }, 'Crear con estos valores')}
              </div>}
            </div>
            {editor && <div className="section-head">Última figura · editable</div>}
            {editor}
          </section>}

          {tool === 'point' && <section className="panel-section">
            <div className="section-head">Punto</div>
            <div className="rule-box" data-testid="status-point">Toca la hoja para marcar un punto en esa posición exacta.{noticeLine}</div>
            {editor}
          </section>}

          {tool === 'protractor' && <section className="panel-section">
            <div className="section-head">Transportador · ángulo exacto</div>
            <div className="rule-box" data-testid="status-protractor">
              <b>{!protVertex ? '01 / Marca el vértice' : '02 / Base y ángulo'}</b>
              {!protVertex ? 'Toca el vértice del ángulo.' : 'Toca un punto para orientar el rayo base (0° del transportador), o escribe su dirección.'}
              {noticeLine}
              {protVertex && <div className="field-stack">
                <ExactField key={`base-${protVertex.x}-${protVertex.y}`} label="Dirección del rayo base" unit="°" value={protBase} onCommit={setProtBase} testid="input-protractor-base" />
                <button className="btn" onClick={() => setProtBase(b => normalizeDeg(b + 180))} data-testid="button-protractor-flip-base">Invertir base (+180°)</button>
                <NumField label="Ángulo a construir" unit="°" value={protAngle} onChange={setProtAngle} testid="input-protractor-angle" />
                <Seg value={protCw ? 'cw' : 'ccw'} onChange={value => setProtCw(value === 'cw')} testid="seg-protractor-dir" options={[{ value: 'ccw', label: '↺ Antihorario' }, { value: 'cw', label: '↻ Horario' }]} />
                <NumField label="Longitud de los rayos" unit="mm" value={protLen} onChange={setProtLen} testid="input-protractor-length" />
                <Toggle checked={protBaseRay} onChange={setProtBaseRay} label="Dibujar también el rayo base" testid="toggle-protractor-base-ray" />
                <Toggle checked={protMark} onChange={setProtMark} label="Marcar el arco del ángulo" testid="toggle-protractor-mark" />
                {errorLine(pending)}
                {createRow(pending, commitPending)}
              </div>}
            </div>
          </section>}

          {(tool === 'parallel' || tool === 'perpendicular') && <section className="panel-section">
            <div className="section-head">{tool === 'parallel' ? 'Línea paralela' : 'Línea perpendicular'}</div>
            <div className="rule-box" data-testid="status-relation">
              <b>{!refSeg ? '01 / Elige la referencia' : !parallelDistance && !relPoint ? '02 / Marca el punto' : '03 / Ajusta y crea'}</b>
              {!refSeg ? 'Toca un segmento recto ya dibujado.' : !parallelDistance && !relPoint ? 'Toca el punto por el que pasará la nueva línea.' : 'Revisa la vista previa y pulsa Crear.'}
              {noticeLine}
              {refSeg && <div className="field-stack">
                <div className="hint-small">Referencia: {fmtNum(segmentLength(refSeg.a, refSeg.b))} mm · {fmtNum(segmentAngle(refSeg.a, refSeg.b))}°</div>
                {tool === 'parallel' && <Seg value={relMethod} onChange={setRelMethod} testid="seg-relation-method" options={[{ value: 'point', label: 'Por un punto' }, { value: 'distance', label: 'A una distancia' }]} />}
                {parallelDistance
                  ? <NumField label="Distancia entre paralelas" unit="mm" value={relDist} onChange={setRelDist} testid="input-relation-distance" />
                  : <>
                    <Seg value={effectivePlacement} onChange={setRelPlacement} testid="seg-relation-placement" options={tool === 'perpendicular'
                      ? [{ value: 'start', label: 'Desde el punto' }, { value: 'center', label: 'Centrada' }, { value: 'foot', label: 'Hasta la recta' }]
                      : [{ value: 'start', label: 'Desde el punto' }, { value: 'center', label: 'Centrada' }]} />
                    {effectivePlacement !== 'foot' && <NumField label="Longitud" unit="mm" value={relLen} onChange={setRelLen} testid="input-relation-length" />}
                  </>}
                {(parallelDistance || effectivePlacement === 'start') && <button className="btn" onClick={() => setRelFlip(value => !value)} data-testid="button-relation-flip">Invertir lado</button>}
                <button className="btn" onClick={() => { setRelRef(null); setRelPoint(null); setNotice(''); }} data-testid="button-relation-change-ref">Cambiar referencia</button>
                {errorLine(pending)}
                {createRow(pending, commitPending)}
              </div>}
            </div>
          </section>}

          {tool === 'eraser' && <section className="panel-section">
            <div className="section-head">Borrador</div>
            <Seg value={prefs.eraserMode} onChange={eraserMode => setPrefs(p => ({ ...p, eraserMode }))} testid="seg-eraser-mode" options={[{ value: 'partial', label: 'Solo lo que toca' }, { value: 'whole', label: 'Elemento completo' }]} />
            <label className="control-label" htmlFor="eraser-size">Tamaño <output>{prefs.eraserPx} px · {fmtNum(prefs.eraserPx / view.scale, 2)} mm</output></label>
            <input id="eraser-size" type="range" min="3" max="40" step="1" value={prefs.eraserPx} onChange={event => setPrefs(p => ({ ...p, eraserPx: Number(event.target.value) }))} data-testid="input-eraser-size" />
            <div className="rule-box" data-testid="status-eraser">{prefs.eraserMode === 'partial' ? 'Quita solo la parte atravesada; lo demás conserva su geometría exacta (los círculos quedan como arcos).' : 'Quita entero cada elemento que toques.'} Un solo «Deshacer» recupera cada pasada.</div>
          </section>}

          {(tool === 'pen' || tool === 'eraser') && notice && <section className="panel-section">{noticeLine}</section>}

          {tool === 'select' && <section className="panel-section">
            <div className="section-head">Selección</div>
            {editor ?? <div className="rule-box" data-testid="status-selection">Toca un elemento para ver y editar sus medidas exactas.</div>}
          </section>}

          <section className="panel-section">
            <div className="section-head">Entrada</div>
            <Seg value={prefs.fingerMode} onChange={fingerMode => setPrefs(p => ({ ...p, fingerMode }))} testid="seg-finger-mode" options={[{ value: 'auto', label: 'Automático' }, { value: 'pen', label: 'Dedo navega' }, { value: 'all', label: 'Dedo dibuja' }]} />
            <div className="hint-small" data-testid="text-input-mode">
              {prefs.fingerMode === 'all' ? 'El dedo también dibuja (dos dedos siguen navegando).' : prefs.fingerMode === 'pen' ? 'El dedo solo mueve y amplía la hoja.' : 'Dibuja el S Pen; el dedo mueve y amplía la hoja. Para dibujar con el dedo, elige «Dedo dibuja».'}
              {' '}Se ignoran los toques mientras el lápiz está apoyado o cerca, y un desplazamiento que empezó justo antes de apoyar el lápiz se deshace.
            </div>
            <div className="pen-status" data-testid="text-pen-detected">
              {prefs.penDetected ? <>S Pen detectado{prefs.penDetectedAt ? ` (${prefs.penDetectedAt})` : ''}<button className="link-btn" onClick={() => { setPrefs(p => ({ ...p, penDetected: false, penDetectedAt: null })); setFingerPrompt('hidden'); }} data-testid="button-forget-pen">Olvidar</button></> : 'S Pen aún no detectado en este navegador.'}
            </div>
          </section>

          <section className="panel-section">
            <div className="section-head">Hoja</div>
            <Seg value={orientation} onChange={changeOrientation} testid="seg-orientation" options={[{ value: 'portrait', label: 'Vertical' }, { value: 'landscape', label: 'Horizontal' }]} />
            <div className="hint-small">Cambiar la orientación no mueve ni deforma la geometría.</div>
          </section>

          <section className="panel-section">
            <div className="section-head">Márgenes · mm</div>
            <div className="margin-grid">
              {(['top', 'right', 'bottom', 'left'] as const).map((side, index) => <label className="margin-field" key={side}><ExactField bare inputClassName="" label={['Superior', 'Derecho', 'Inferior', 'Izquierdo'][index]} value={meta.margins[side]} onCommit={v => setMargin(side, v)} validate={validateMargin} testid={`input-margin-${side}`} /></label>)}
            </div>
          </section>

          <section className="panel-section history-tools">
            <div className="section-head">Edición</div>
            <div className="tool-grid">
              <button className="tool-button" onClick={undo} disabled={!history.past.length} data-testid="button-undo"><Undo2 size={16} />Deshacer</button>
              <button className="tool-button" onClick={redo} disabled={!history.future.length} data-testid="button-redo"><Redo2 size={16} />Rehacer</button>
            </div>
            <button className="btn danger" onClick={() => setModal('clear')} disabled={!entities.length} data-testid="button-clear"><Trash2 size={14} />Limpiar hoja…</button>
          </section>
        </aside>

        <section className="canvas-area">
          <div className="canvas-toolbar">
            <div className="doc-label"><span className="doc-pill">A4</span><span data-testid="text-orientation">{orientation === 'landscape' ? 'Horizontal' : 'Vertical'}</span><span className="mono">{sheet.w} × {sheet.h} mm</span></div>
            <div className="canvas-controls">
              {SHOW_PHYSICAL_SCALE && <>
                <button className="btn small" onClick={goRealScale} data-testid="button-real-scale" aria-label="Escala real 1:1">1:1</button>
                <button className="btn small" onClick={() => { setCalMeasured(''); setModal('calibrate'); }} data-testid="button-calibrate">Calibrar</button>
              </>}
              <button className="icon-btn" aria-label="Alejar" onClick={() => zoomCentered(1 / 1.25)} data-testid="button-zoom-out"><ZoomOut size={17} /></button>
              <span className="zoom-readout" data-testid="text-zoom">{Math.round(view.scale / fitScale * 100)}%</span>
              <button className="icon-btn" aria-label="Acercar" onClick={() => zoomCentered(1.25)} data-testid="button-zoom-in"><ZoomIn size={17} /></button>
              <button className="icon-btn" aria-label="Ajustar hoja al área visible" onClick={fit} data-testid="button-fit"><Circle size={15} /></button>
              {SHOW_PHYSICAL_SCALE && <span className="scale-readout" data-testid="text-scale">{scaleLabel}</span>}
            </div>
          </div>
          <div className="stage" ref={stageRef} data-testid="drawing-stage">
            {stageSize && <svg
              ref={svgRef} className="stage-svg" width={stageSize.width} height={stageSize.height}
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="none" role="img" aria-label="Hoja A4 milimetrada"
              onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
              onPointerUp={event => endPointer(event, false)} onPointerCancel={event => endPointer(event, true)}
              onPointerLeave={event => { if (event.pointerType !== 'touch') setHover(null); }}
              onContextMenu={event => event.preventDefault()}
              data-testid="drawing-sheet" data-scale={view.scale} data-tx={view.tx} data-ty={view.ty}
            >
              <defs>
                <clipPath id="sheet-clip"><rect x="0" y="0" width={sheet.w} height={sheet.h} /></clipPath>
                {/* Papel milimetrado como patrón (10 × 10 mm), idéntico a la cuadrícula: lo usa la estela del borrador. */}
                <pattern id="paper" patternUnits="userSpaceOnUse" x="0" y="0" width="10" height="10">
                  <rect width="10" height="10" fill="white" />
                  {Array.from({ length: 11 }, (_, i) => <g key={i}>
                    <line x1={i} y1="0" x2={i} y2="10" stroke={gridStyle.color(i % 10)} strokeWidth={gridStyle.weight(i % 10)} />
                    <line x1="0" y1={i} x2="10" y2={i} stroke={gridStyle.color(i % 10)} strokeWidth={gridStyle.weight(i % 10)} />
                  </g>)}
                </pattern>
              </defs>
              <rect x={3 * px} y={5 * px} width={sheet.w} height={sheet.h} fill="#36545b" fillOpacity=".14" />
              <rect x="0" y="0" width={sheet.w} height={sheet.h} fill="white" data-testid="sheet-rect" data-orientation={orientation} />
              <g pointerEvents="none"><SheetGrid sheet={sheet} /></g>
              <rect fill="none" stroke="#85b8a6" strokeWidth=".22" strokeDasharray="1.3 1.1" pointerEvents="none" x={meta.margins.left} y={meta.margins.top} width={Math.max(0, sheet.w - meta.margins.left - meta.margins.right)} height={Math.max(0, sheet.h - meta.margins.top - meta.margins.bottom)} />
              {/* Los trazados no reciben eventos: la app localiza los elementos con su propia prueba exacta en mm.
                  Así el navegador no recorre toda la geometría en cada movimiento del puntero (hit-testing). */}
              <g clipPath="url(#sheet-clip)" pointerEvents="none">
                {highlightIds.map(id => { const e = shown.find(x => x.id === id); return e ? <path key={`hl-${id}`} d={entityPathD(e)} fill={e.type === 'point' ? '#e36b47' : 'none'} stroke="#e36b47" strokeOpacity=".5" strokeWidth={e.type === 'point' ? 4 * px : e.width + 5 * px} strokeLinecap="round" pointerEvents="none" /> : null; })}
                {entityNodes}
                {g && g.tool === 'eraser' && <g data-testid="eraser-trail" pointerEvents="none">
                  <circle cx={g.trail[0].x} cy={g.trail[0].y} r={g.eraseR} fill="url(#paper)" />
                  {g.trail.slice(1).map((q, i) => <line key={i} x1={g.trail[i].x} y1={g.trail[i].y} x2={q.x} y2={q.y} stroke="url(#paper)" strokeWidth={2 * g.eraseR} strokeLinecap="round" />)}
                </g>}
                {g && g.tool === 'pen' && <path d={entityPathD({ id: 'live', type: 'polyline', color: meta.color, width: meta.width, points: g.points })} fill="none" stroke={meta.color} strokeWidth={meta.width} strokeLinecap="round" strokeLinejoin="round" data-testid="live-stroke" />}
              </g>
              {protractorOverlay}
              {pending && !pending.error && pending.entities.map((d, i) => previewPath(d, `pending-${i}`))}
              {ruleNumeric && !ruleNumeric.error && !livePreview && ruleNumeric.entities.map((d, i) => previewPath(d, `rule-${i}`))}
              {compNumeric && !compNumeric.error && !livePreview && compNumeric.entities.map((d, i) => previewPath(d, `comp-${i}`))}
              {livePreview && previewPath(livePreview.entity, 'live-preview')}
              {tool === 'ruler' && ruleStart && marker(ruleStart, 'rs')}
              {tool === 'compass' && compCenter && marker(compCenter, 'cc')}
              {tool === 'protractor' && protVertex && marker(protVertex, 'pv')}
              {(tool === 'parallel' || tool === 'perpendicular') && relPoint && marker(relPoint, 'rp')}
              {tool === 'point' && hover && <circle cx={hover.x} cy={hover.y} r={pointRadius({ width: meta.width })} fill="none" stroke="#cf6349" strokeWidth={px} pointerEvents="none" />}
              {tool === 'eraser' && (g?.tool === 'eraser' ? g.curDoc : hover) && (() => { const p = g?.tool === 'eraser' ? g.curDoc : hover!; return <circle cx={p.x} cy={p.y} r={prefs.eraserPx * px} fill="#cf634922" stroke="#cf6349" strokeWidth={px} pointerEvents="none" data-testid="eraser-cursor" />; })()}
              {CONSTRUCTION.includes(tool) && hover && tool !== 'point' && <g pointerEvents="none" opacity=".7">
                <line x1={hover.x - 4 * px} y1={hover.y} x2={hover.x + 4 * px} y2={hover.y} stroke="#4d6b72" strokeWidth={px} />
                <line x1={hover.x} y1={hover.y - 4 * px} x2={hover.x} y2={hover.y + 4 * px} stroke="#4d6b72" strokeWidth={px} />
              </g>}
            </svg>}
            {fingerPrompt === 'shown' && prefs.fingerMode === 'auto' && !prefs.penDetected && <div className="finger-prompt" role="dialog" aria-label="Dibujar con el dedo" data-testid="finger-prompt">
              <span>Con «Automático» el dedo solo mueve la hoja, para que un toque accidental no dibuje. ¿Quieres dibujar con el dedo?</span>
              <div className="create-row">
                <button className="btn primary" onClick={() => { setPrefs(p => ({ ...p, fingerMode: 'all' })); setFingerPrompt('dismissed'); }} data-testid="button-finger-draw">Dibujar con el dedo</button>
                <button className="btn" onClick={() => setFingerPrompt('dismissed')} data-testid="button-finger-dismiss">Uso el S Pen</button>
              </div>
            </div>}
            <div className="stage-hint"><strong>{toolHints[tool]}</strong> · {fingerNow ? 'Un dedo dibuja; dos dedos mueven y amplían' : 'Dedo: mover y ampliar'}</div>
          </div>
        </section>
      </div>
      <footer className="footerbar">
        <span data-testid="text-cursor">{hover ? `X ${fmtNum(hover.x, 3)} · Y ${fmtNum(hover.y, 3)} mm` : 'CUADRÍCULA 1 mm · ÉNFASIS 5 mm · REFERENCIA 10 mm'}</span>
        <span>SIN IMANES NI REDONDEOS · {entities.length} ELEMENTOS</span>
      </footer>
      <div id="print-sheet" dangerouslySetInnerHTML={{ __html: printSvg }} />

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className={`modal ${modal === 'calibrate' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          {modal === 'leave' ? <>
            <h2 id="dialog-title">Hay cambios sin guardar</h2>
            <p>{saveState.message || 'No se pudo confirmar el guardado.'} Si sales ahora, se perderán los cambios que no se guardaron.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setModal(null)} data-testid="button-stay">Seguir aquí</button>
              <button className="btn" onClick={() => { setModal(null); exportJson(); }} data-testid="button-leave-export">Exportar copia (JSON)</button>
              <button className="btn danger" onClick={() => { managerRef.current?.dispose(); try { clearJournal(localStorage, project.id); } catch { /* nada */ } onExit(); }} data-testid="button-leave-discard">Salir sin guardar</button>
            </div>
          </> : modal === 'clear' ? <>
            <h2 id="dialog-title">Limpiar la hoja</h2>
            <p>Se quitarán los {entities.length} elementos de este dibujo. Esta acción se puede deshacer.</p>
            <div className="modal-actions"><button className="btn" onClick={() => setModal(null)} data-testid="button-cancel-clear">Cancelar</button><button className="btn danger" onClick={() => { commit([]); setSelectedId(null); setLastCreatedId(null); setModal(null); }} data-testid="button-confirm-clear"><Trash2 size={14} />Limpiar</button></div>
          </> : modal === 'calibrate' ? <>
            <h2 id="dialog-title">Calibrar escala real</h2>
            <p>El navegador no conoce el tamaño físico exacto de tu pantalla. Apoya una regla física sobre la barra de abajo, mide de extremo a extremo en milímetros y escribe lo que mides.</p>
            <div className="cal-bar-wrap"><div className="cal-bar" style={{ width: `${CAL_MM}mm` }} data-testid="calibration-bar" /></div>
            <NumField label="Medida real de la barra" unit="mm" value={calMeasured} onChange={setCalMeasured} testid="input-calibration-measured" />
            <div className="modal-actions"><button className="btn" onClick={() => setModal(null)} data-testid="button-cancel-calibration">Cancelar</button><button className="btn primary" onClick={saveCalibration} disabled={!(toNum(calMeasured) >= 20 && toNum(calMeasured) <= 400)} data-testid="button-save-calibration"><Check size={14} />Guardar y aplicar 1:1</button></div>
          </> : <>
            <h2 id="dialog-title">Exportar dibujo</h2>
            <p>PDF vectorial A4 con medidas reales, PNG a 2480 × 3508 px o impresión directa.</p>
            <Toggle checked={exportGrid} onChange={setExportGrid} label="Incluir cuadrícula y guía de márgenes" testid="toggle-export-grid" />
            <div className="export-note">Para imprimir, elige papel A4 y escala 100 %; desactiva «ajustar a página».</div>
            <div className="modal-actions"><button className="btn" onClick={() => setModal(null)} data-testid="button-cancel-export">Cancelar</button><button className="btn" onClick={downloadPng} data-testid="button-export-png"><Download size={14} />PNG</button><button className="btn" onClick={printPdf} data-testid="button-print-100"><FileDown size={14} />Imprimir a 100%</button><button className="btn primary" onClick={downloadPdf} disabled={pdfBusy} data-testid="button-export-pdf"><FileDown size={14} />{pdfBusy ? 'Preparando PDF…' : 'Descargar PDF'}</button></div>
          </>}
        </section>
      </div>}
    </main>
  );
}

function withSheetCheck(a: Draft[] | Sheet, b?: Draft[] | Sheet): Pending {
  const list = (Array.isArray(a) ? a : b) as Draft[];
  const sheet = (Array.isArray(a) ? b : a) as Sheet;
  for (const d of list) {
    const e = sanitizeEntity({ ...d, id: 'tmp', color: '#000000', width: 0.45 });
    if (!e) return { entities: list, error: 'Valores no válidos.' };
    if (!entityInsideSheet(e, 1e-9, sheet)) return { entities: list, error: 'Queda fuera de la hoja A4. Ajusta los valores.' };
  }
  return { entities: list };
}

/** Arco del radio dado entre dos direcciones, en el sentido elegido (sin redondear). */
function arcDraft(c: Pt, r: number, startDeg: number, endDeg: number, cw: boolean): Draft {
  return cw
    ? { type: 'arc', c, r, start: endDeg, sweep: sweepBetween(endDeg, startDeg) || 360 } as Draft
    : { type: 'arc', c, r, start: startDeg, sweep: sweepBetween(startDeg, endDeg) || 360 } as Draft;
}
