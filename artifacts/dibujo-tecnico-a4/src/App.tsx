import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  Check, Circle, Compass, Download, Eraser, Equal, FileDown, Hand, MousePointer2,
  Pencil, Plus, Redo2, Ruler, Settings2, Trash2, Triangle, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { type PointerEvent as ReactPointerEvent } from 'react';
import { createA4Pdf } from '@/lib/pdf-export.js';
import {
  arcPoints, angleConstruction, collectSnapTargets, findStrokeAt, offsetLine, pointAt, pointsInsideSheet,
  relatedLine, roundTo, segmentAngle, segmentLength, snapPoint, sweepBetween,
  type SnapKind,
} from '@/lib/geometry.js';

type Point = { x: number; y: number; p?: number };
type StrokeMeta = { center?: { x: number; y: number }; radius?: number; startDeg?: number; sweepDeg?: number };
type Stroke = {
  id: string; points: Point[]; color: string; width: number;
  kind: 'free' | 'line' | 'circle' | 'arc'; meta?: StrokeMeta;
};
type NewStroke = Omit<Stroke, 'id'>;
type DocState = { strokes: Stroke[]; margins: { top: number; right: number; bottom: number; left: number }; color: string; width: number };
type Tool = 'pen' | 'ruler' | 'compass' | 'protractor' | 'parallel' | 'perpendicular' | 'select' | 'pan';
type Placement = 'start' | 'center' | 'foot';
type Prefs = { snapGrid: boolean; snapObj: boolean; keepTool: boolean; mouseAsPen: boolean };
type Calib = { devPxPerMm: number; dpr: number; at: string };
type Pending = { strokes: NewStroke[]; error?: string };

const STORAGE_KEY = 'dibujo-tecnico-a4-v1';
const PREFS_KEY = 'dibujo-tecnico-a4-prefs';
const CALIB_KEY = 'dibujo-tecnico-a4-calibracion';
const CAL_MM = 100; // longitud nominal (en mm CSS) de la barra de calibración
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const queryClient = new QueryClient();
const initialDoc: DocState = { strokes: [], margins: { top: 10, right: 10, bottom: 10, left: 10 }, color: '#244d58', width: 0.45 };
const initialPrefs: Prefs = { snapGrid: true, snapObj: true, keepTool: false, mouseAsPen: false };
const colors = ['#244d58', '#bc573f', '#1e7663', '#3c4b8c', '#252b2d'];
const CONSTRUCTION_TOOLS: Tool[] = ['ruler', 'compass', 'protractor', 'parallel', 'perpendicular'];

function makeId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function loadDoc(): DocState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (parsed && Array.isArray(parsed.strokes) && parsed.margins) return { ...initialDoc, ...parsed };
  } catch { /* Restore a clean sheet if local data is damaged. */ }
  return initialDoc;
}
function loadPrefs(): Prefs {
  try { return { ...initialPrefs, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || {}) }; } catch { return initialPrefs; }
}
function loadCalib(): Calib | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CALIB_KEY) || 'null');
    if (parsed && Number.isFinite(parsed.devPxPerMm) && parsed.devPxPerMm > 0 && Number.isFinite(parsed.dpr) && parsed.dpr > 0) return parsed;
  } catch { /* sin calibración válida */ }
  return null;
}
/** Acepta coma o punto decimal; cadena vacía = NaN. */
function toNum(value: string): number {
  const text = String(value).trim().replace(',', '.');
  return text === '' ? NaN : Number(text);
}
const fmt = (value: number, decimals = 2) => value.toFixed(decimals);

function lineStroke(a: { x: number; y: number }, b: { x: number; y: number }, color: string, width: number): NewStroke {
  return { points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], color, width, kind: 'line' };
}
function curveStroke(center: { x: number; y: number }, radius: number, startDeg: number, sweepDeg: number, color: string, width: number): NewStroke {
  return {
    points: arcPoints(center, radius, startDeg, sweepDeg), color, width,
    kind: sweepDeg >= 360 ? 'circle' : 'arc',
    meta: { center: { x: center.x, y: center.y }, radius, startDeg, sweepDeg },
  };
}
function checkInside(strokes: NewStroke[]): Pending {
  return strokes.every(stroke => pointsInsideSheet(stroke.points)) ? { strokes } : { strokes, error: 'Queda fuera de la hoja A4. Ajusta los valores.' };
}

function NumField({ label, value, onChange, unit, testid, min, max }: {
  label: string; value: string; onChange: (value: string) => void; unit?: string; testid?: string; min?: number; max?: number;
}) {
  return <label className="field">
    <span className="field-label">{label}{unit && <em>{unit}</em>}</span>
    <input className="number-input" type="number" inputMode="decimal" step="any" min={min} max={max} value={value} onChange={event => onChange(event.target.value)} data-testid={testid} />
  </label>;
}
function Seg<T extends string>({ value, options, onChange, testid }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; testid?: string }) {
  return <div className="seg" role="group" data-testid={testid}>
    {options.map(option => <button key={option.value} type="button" className={value === option.value ? 'on' : ''} onClick={() => onChange(option.value)} data-testid={testid ? `${testid}-${option.value}` : undefined}>{option.label}</button>)}
  </div>;
}
function Toggle({ checked, onChange, label, testid }: { checked: boolean; onChange: (value: boolean) => void; label: string; testid?: string }) {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} data-testid={testid} /><span>{label}</span></label>;
}

function DrawingApp() {
  const [doc, setDoc] = useState<DocState>(loadDoc);
  const [tool, setTool] = useState<Tool>('pen');
  const [selected, setSelected] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[][]>([]);
  const [saved, setSaved] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ width: 900, height: 700 });
  const [modal, setModal] = useState<'clear' | 'export' | 'calibrate' | null>(null);
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [calib, setCalib] = useState<Calib | null>(loadCalib);
  const [calMeasured, setCalMeasured] = useState('');
  const [notice, setNotice] = useState('');
  const [hover, setHover] = useState<{ x: number; y: number; kind: SnapKind } | null>(null);

  // Regla (existente) + ángulo exacto
  const [ruleStart, setRuleStart] = useState<Point | null>(null);
  const [ruleAimed, setRuleAimed] = useState(false);
  const [ruleAngle, setRuleAngle] = useState('0');
  const [ruleLength, setRuleLength] = useState('50');
  // Compás
  const [compCenter, setCompCenter] = useState<Point | null>(null);
  const [compStage, setCompStage] = useState<1 | 2>(1);
  const [compRadius, setCompRadius] = useState('30');
  const [compFull, setCompFull] = useState(true);
  const [compStart, setCompStart] = useState('0');
  const [compEnd, setCompEnd] = useState('90');
  // Transportador
  const [protVertex, setProtVertex] = useState<Point | null>(null);
  const [protBase, setProtBase] = useState('0');
  const [protAngle, setProtAngle] = useState('60');
  const [protLen, setProtLen] = useState('50');
  const [protCw, setProtCw] = useState(false);
  const [protBaseRay, setProtBaseRay] = useState(true);
  const [protMark, setProtMark] = useState(true);
  // Paralelas y perpendiculares
  const [relRef, setRelRef] = useState<string | null>(null);
  const [relPoint, setRelPoint] = useState<Point | null>(null);
  const [relLen, setRelLen] = useState('50');
  const [relPlacement, setRelPlacement] = useState<Placement>('start');
  const [relFlip, setRelFlip] = useState(false);
  const [relMethod, setRelMethod] = useState<'point' | 'distance'>('point');
  const [relDist, setRelDist] = useState('10');

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const activePointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const pinchRef = useRef<{ dist: number; zoom: number; pan: { x: number; y: number }; center: { x: number; y: number } } | null>(null);
  const penPointerId = useRef<number | null>(null);
  const panPointerId = useRef<number | null>(null);
  const paperWidth = Math.max(100, Math.min(stageSize.width - 72, (stageSize.height - 65) * 210 / 297));
  const paperHeight = paperWidth * 297 / 210;
  const paperLeft = (stageSize.width - paperWidth) / 2 + pan.x;
  const paperTop = (stageSize.height - paperHeight) / 2 + pan.y;

  // Escala en pantalla: píxeles CSS por mm de documento (varía con el zoom) y, si hay calibración, por mm físico.
  const screenPxPerMm = (paperWidth * zoom) / 210;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cssPxPerPhysicalMm = calib ? calib.devPxPerMm / dpr : null;
  const screenScale = cssPxPerPhysicalMm ? screenPxPerMm / cssPxPerPhysicalMm : null;
  const snapTolMm = 14 / screenPxPerMm;
  const isConstruction = CONSTRUCTION_TOOLS.includes(tool);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSaved(false);
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
        setSaved(true);
        setSaveError(false);
      } catch { setSaveError(true); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [doc]);

  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* preferencias no críticas */ } }, [prefs]);

  const resetConstruction = useCallback(() => {
    setRuleStart(null); setRuleAimed(false);
    setCompCenter(null); setCompStage(1);
    setProtVertex(null);
    setRelRef(null); setRelPoint(null);
    setHover(null); setNotice('');
  }, []);
  const chooseTool = (next: Tool) => { resetConstruction(); setTool(next); };

  const commitStrokes = useCallback((next: Stroke[]) => {
    setUndoStack(stack => [...stack.slice(-49), doc.strokes]);
    setRedoStack([]);
    setDoc(current => ({ ...current, strokes: next }));
    setSelected(null);
  }, [doc.strokes]);

  const undo = useCallback(() => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack(redo => [...redo, doc.strokes]);
    setDoc(current => ({ ...current, strokes: previous }));
    setUndoStack(stack => stack.slice(0, -1));
    setSelected(null);
  }, [doc.strokes, undoStack]);
  const redo = useCallback(() => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(undoItems => [...undoItems, doc.strokes]);
    setDoc(current => ({ ...current, strokes: next }));
    setRedoStack(stack => stack.slice(0, -1));
  }, [doc.strokes, redoStack]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); redo(); }
      else if (event.key === 'Escape') resetConstruction();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, resetConstruction]);

  const snapTargets = useMemo(() => (prefs.snapObj ? collectSnapTargets(doc.strokes) : []), [doc.strokes, prefs.snapObj]);
  const resolvePoint = (raw: Point): Point & { kind: SnapKind } => {
    const snapped = snapPoint(raw, snapTargets, snapTolMm, prefs.snapGrid ? 1 : 0);
    return { x: snapped.x, y: snapped.y, kind: snapped.kind, p: raw.p };
  };

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(210, Math.max(0, (event.clientX - rect.left) / rect.width * 210)),
      y: Math.min(297, Math.max(0, (event.clientY - rect.top) / rect.height * 297)),
      p: event.pressure || 0.5,
    };
  };
  /** Lápiz S Pen (o ratón si se activó "ratón como lápiz"); con la herramienta Desplazar el lápiz arrastra la hoja. */
  const isDrawingEvent = (event: ReactPointerEvent<SVGSVGElement>) =>
    tool !== 'pan' && (event.pointerType === 'pen' || (prefs.mouseAsPen && event.pointerType === 'mouse'));

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    const drawing = isDrawingEvent(event);
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY, type: drawing ? 'pen' : 'touch' });
    const active = [...activePointers.current.values()].filter(pointer => pointer.type !== 'pen');
    if (!drawing) {
      event.currentTarget.setPointerCapture(event.pointerId);
      if (active.length === 2) {
        const [a, b] = active;
        pinchRef.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y), zoom,
          pan: { ...pan },
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
      } else if (active.length === 1) {
        panPointerId.current = event.pointerId;
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const raw = pointFromEvent(event);
    if (tool === 'pen') {
      penPointerId.current = event.pointerId;
      setLiveStroke({ id: makeId(), points: [raw], color: doc.color, width: doc.width, kind: 'free' });
    } else if (tool === 'ruler') {
      const point = resolvePoint(raw);
      if (!ruleStart || ruleAimed) {
        setRuleStart(point);
        setRuleAimed(false);
      } else if (segmentLength(ruleStart, point) > 0.1) {
        setRuleAngle(String(roundTo(segmentAngle(ruleStart, point), 2)));
        setRuleAimed(true);
      }
    } else if (tool === 'compass') {
      const point = resolvePoint(raw);
      if (!compCenter) {
        setCompCenter(point);
        setCompStage(1);
      } else if (segmentLength(compCenter, point) > 0.05) {
        const angle = String(roundTo(segmentAngle(compCenter, point), 2));
        if (compStage === 1 || compFull) {
          setCompRadius(String(roundTo(segmentLength(compCenter, point), 2)));
          setCompStart(angle);
          setCompStage(2);
        } else {
          setCompEnd(angle);
          setCompStage(1);
        }
      }
    } else if (tool === 'protractor') {
      const point = resolvePoint(raw);
      if (!protVertex) setProtVertex(point);
      else if (segmentLength(protVertex, point) > 0.1) setProtBase(String(roundTo(segmentAngle(protVertex, point), 2)));
    } else if (tool === 'parallel' || tool === 'perpendicular') {
      if (!relRef) {
        const hit = findStrokeAt(raw, doc.strokes, Math.max(1, 16 / screenPxPerMm), stroke => stroke.kind === 'line');
        if (hit) { setRelRef((hit as Stroke).id); setNotice(''); }
        else setNotice('Toca sobre una línea recta ya dibujada.');
      } else if (!(tool === 'parallel' && relMethod === 'distance')) {
        setRelPoint(resolvePoint(raw));
      }
    } else if (tool === 'select') {
      const hit = findStrokeAt(raw, doc.strokes, 14 / screenPxPerMm);
      setSelected(hit ? (hit as Stroke).id : null);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pointer = activePointers.current.get(event.pointerId);
    if (pointer && pointer.type !== 'pen') {
      const deltaX = event.clientX - pointer.x;
      const deltaY = event.clientY - pointer.y;
      activePointers.current.set(event.pointerId, { ...pointer, x: event.clientX, y: event.clientY });
      const current = [...activePointers.current.values()].filter(item => item.type !== 'pen');
      if (current.length >= 2 && pinchRef.current) {
        const [a, b] = current;
        const base = pinchRef.current;
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base.zoom * Math.hypot(a.x - b.x, a.y - b.y) / base.dist));
        const stage = stageRef.current?.getBoundingClientRect();
        if (stage) {
          const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          setPan({ x: base.pan.x + center.x - base.center.x, y: base.pan.y + center.y - base.center.y });
          setZoom(nextZoom);
        }
      } else if (current.length === 1 && panPointerId.current === event.pointerId) {
        setPan(prev => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
      }
      return;
    }
    if (!pointer) {
      // Sobrevuelo del S Pen (o ratón): muestra a qué punto "se imanta" la próxima marca.
      if (isConstruction && isDrawingEvent(event)) setHover(resolvePoint(pointFromEvent(event)));
      return;
    }
    if (penPointerId.current !== event.pointerId || !liveStroke) return;
    const nextPoint = pointFromEvent(event);
    setLiveStroke(current => current ? { ...current, points: [...current.points, nextPoint] } : current);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const stored = activePointers.current.get(event.pointerId);
    activePointers.current.delete(event.pointerId);
    const remainingTouches = [...activePointers.current.entries()].filter(([, pointer]) => pointer.type !== 'pen');
    if (remainingTouches.length < 2) pinchRef.current = null;
    if (stored && stored.type !== 'pen' && panPointerId.current === event.pointerId) {
      panPointerId.current = remainingTouches.length === 1 ? remainingTouches[0][0] : null;
    } else if (remainingTouches.length === 0) {
      panPointerId.current = null;
    }
    if (penPointerId.current !== event.pointerId) return;
    if (liveStroke) {
      const finalPoint = pointFromEvent(event);
      const points = [...liveStroke.points];
      const lastPoint = points[points.length - 1];
      if (Math.hypot(finalPoint.x - lastPoint.x, finalPoint.y - lastPoint.y) > 0.01) points.push(finalPoint);
      if (points.length > 1) commitStrokes([...doc.strokes, { ...liveStroke, points }]);
      setLiveStroke(null);
    }
    penPointerId.current = null;
  };

  const pathFromPoints = (points: Point[]) => points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(' ');

  // ── Construcciones: una única fuente de verdad para la vista previa y para lo que se crea ──
  const refStroke = relRef ? doc.strokes.find(stroke => stroke.id === relRef) ?? null : null;
  const refA = refStroke ? refStroke.points[0] : null;
  const refB = refStroke ? refStroke.points[refStroke.points.length - 1] : null;
  const parallelDistance = tool === 'parallel' && relMethod === 'distance';
  const effectivePlacement: Placement = tool === 'parallel' && relPlacement === 'foot' ? 'start' : relPlacement;

  const pending: Pending | null = (() => {
    const { color, width } = doc;
    if (tool === 'ruler' && ruleStart) {
      const length = toNum(ruleLength), angle = toNum(ruleAngle);
      if (!(length > 0 && length <= 500) || !Number.isFinite(angle)) return { strokes: [], error: 'Longitud (0–500 mm) o ángulo no válidos.' };
      return checkInside([lineStroke(ruleStart, pointAt(ruleStart, angle, length), color, width)]);
    }
    if (tool === 'compass' && compCenter) {
      const radius = toNum(compRadius), start = toNum(compStart), end = toNum(compEnd);
      if (!(radius > 0 && radius <= 500)) return { strokes: [], error: 'Radio no válido (0–500 mm).' };
      if (!Number.isFinite(start) || (!compFull && !Number.isFinite(end))) return { strokes: [], error: 'Ángulo no válido.' };
      const sweep = compFull ? 360 : sweepBetween(start, end);
      if (!(sweep > 0)) return { strokes: [], error: 'El ángulo inicial y el final coinciden.' };
      return checkInside([curveStroke(compCenter, radius, start, sweep, color, width)]);
    }
    if (tool === 'protractor' && protVertex) {
      const angle = toNum(protAngle), base = toNum(protBase), length = toNum(protLen);
      if (!(angle > 0 && angle < 360) || !Number.isFinite(base) || !(length > 0 && length <= 500)) return { strokes: [], error: 'Ángulo (0–360°), base o longitud no válidos.' };
      const markRadius = Math.min(8, length / 2);
      const c = angleConstruction(protVertex, base, angle, protCw, length, markRadius);
      const strokes: NewStroke[] = [];
      if (protBaseRay) strokes.push(lineStroke(protVertex, c.baseEnd, color, width));
      strokes.push(lineStroke(protVertex, c.rayEnd, color, width));
      if (protMark) strokes.push(curveStroke(protVertex, markRadius, c.arcStartDeg, c.sweepDeg, color, width));
      return checkInside(strokes);
    }
    if ((tool === 'parallel' || tool === 'perpendicular') && refA && refB) {
      let result: [{ x: number; y: number }, { x: number; y: number }] | null = null;
      if (parallelDistance) {
        const distance = toNum(relDist);
        if (!(distance > 0 && distance <= 500)) return { strokes: [], error: 'Distancia no válida (0–500 mm).' };
        result = offsetLine(refA, refB, distance, relFlip);
      } else if (relPoint) {
        const length = toNum(relLen);
        if (effectivePlacement !== 'foot' && !(length > 0 && length <= 500)) return { strokes: [], error: 'Longitud no válida (0–500 mm).' };
        result = relatedLine({ ref0: refA, ref1: refB, mode: tool, through: relPoint, length, placement: effectivePlacement, flip: relFlip });
        if (!result) return { strokes: [], error: 'No se puede construir: el punto está sobre la referencia o los datos no son válidos.' };
      } else {
        return null;
      }
      if (!result) return { strokes: [], error: 'No se puede construir con estos valores.' };
      return checkInside([lineStroke(result[0], result[1], color, width)]);
    }
    return null;
  })();
  const canCreate = !!pending && !pending.error && pending.strokes.length > 0;

  const commitPending = () => {
    if (!pending || pending.error || !pending.strokes.length) return;
    commitStrokes([...doc.strokes, ...pending.strokes.map(stroke => ({ ...stroke, id: makeId() }))]);
    resetConstruction();
    if (!prefs.keepTool) setTool('pen');
  };
  const addMeasuredLine = commitPending;

  const deleteSelected = () => {
    if (!selected) return;
    commitStrokes(doc.strokes.filter(stroke => stroke.id !== selected));
  };

  const gridLines = useMemo(() => {
    const color = (i: number) => (i % 10 === 0 ? '#a9b8bb' : i % 5 === 0 ? '#d0dadd' : '#e8edef');
    const weight = (i: number) => (i % 10 === 0 ? '.20' : i % 5 === 0 ? '.14' : '.09');
    return <>
      {Array.from({ length: 211 }, (_, i) => <line key={`x-${i}`} x1={i} y1="0" x2={i} y2="297" stroke={color(i)} strokeWidth={weight(i)} />)}
      {Array.from({ length: 298 }, (_, i) => <line key={`y-${i}`} x1="0" y1={i} x2="210" y2={i} stroke={color(i)} strokeWidth={weight(i)} />)}
    </>;
  }, []);

  const exportSvg = (includeGrid: boolean) => {
    const source = svgRef.current;
    if (!source) return '';
    const clone = source.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '210mm');
    clone.setAttribute('height', '297mm');
    clone.setAttribute('viewBox', '0 0 210 297');
    clone.querySelectorAll('[data-ephemeral="true"]').forEach(node => node.remove());
    clone.querySelectorAll('.selected-path').forEach(node => node.classList.remove('selected-path'));
    if (!includeGrid) clone.querySelectorAll('[data-grid="true"], [data-margin="true"]').forEach(node => node.remove());
    return new XMLSerializer().serializeToString(clone);
  };
  const downloadPng = async () => {
    const svgString = exportSvg(true);
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2480;
      canvas.height = 3508;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (blob) {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = 'dibujo-tecnico-a4.png';
          link.click();
          URL.revokeObjectURL(link.href);
        }
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    image.onerror = () => { URL.revokeObjectURL(url); alert('No se pudo preparar el PNG.'); };
    image.src = url;
    setModal(null);
  };
  const printPdf = () => {
    setModal(null);
    window.setTimeout(() => window.print(), 80);
  };
  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const bytes = await createA4Pdf(doc.strokes, doc.margins);
      const buffer = new Uint8Array(bytes).buffer;
      const blob = new Blob([buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'dibujo-tecnico-a4.pdf';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setModal(null);
    } catch {
      alert('No se pudo generar el PDF. El dibujo sigue guardado en este dispositivo.');
    } finally {
      setPdfBusy(false);
    }
  };
  const setMargin = (key: keyof DocState['margins'], value: string) => {
    const amount = Math.max(0, Math.min(40, Number(value) || 0));
    setDoc(current => ({ ...current, margins: { ...current.margins, [key]: amount } }));
  };

  // ── Escala 1:1 (requiere calibración manual con una regla física) ──
  const applyRealScale = (cssPxPerMm: number) => {
    const target = (210 * cssPxPerMm) / paperWidth;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target));
    setZoom(next);
    setPan({ x: paperWidth * (1 - next) / 2, y: 8 - (stageSize.height - paperHeight) / 2 });
    setNotice(next !== target ? 'El zoom máximo no alcanza la escala 1:1 en esta pantalla.' : '');
  };
  const goRealScale = () => {
    if (!cssPxPerPhysicalMm) { setCalMeasured(''); setModal('calibrate'); return; }
    applyRealScale(cssPxPerPhysicalMm);
  };
  const saveCalibration = () => {
    const measured = toNum(calMeasured);
    if (!(measured >= 20 && measured <= 400)) return;
    const cssPxPerMm = (CAL_MM * 96 / 25.4) / measured; // 1 mm CSS = 96/25.4 px CSS por definición
    const next: Calib = { devPxPerMm: cssPxPerMm * dpr, dpr, at: new Date().toISOString().slice(0, 10) };
    try { localStorage.setItem(CALIB_KEY, JSON.stringify(next)); } catch { /* se aplica en esta sesión aunque no se pueda guardar */ }
    setCalib(next);
    setModal(null);
    applyRealScale(cssPxPerMm);
  };

  // ── Información y ayudas visuales ──
  const selectedStroke = selected ? doc.strokes.find(stroke => stroke.id === selected) ?? null : null;
  const selectedInfo = (() => {
    if (!selectedStroke) return null;
    const pts = selectedStroke.points;
    if (selectedStroke.kind === 'line' && pts.length >= 2) return `Línea · ${fmt(segmentLength(pts[0], pts[pts.length - 1]), 3)} mm · ${fmt(segmentAngle(pts[0], pts[pts.length - 1]))}°`;
    if ((selectedStroke.kind === 'circle' || selectedStroke.kind === 'arc') && selectedStroke.meta?.center) {
      const m = selectedStroke.meta;
      return `${selectedStroke.kind === 'circle' ? 'Circunferencia' : 'Arco'} · radio ${fmt(m.radius ?? 0, 3)} mm · centro (${fmt(m.center!.x)}, ${fmt(m.center!.y)})${selectedStroke.kind === 'arc' ? ` · barrido ${fmt(m.sweepDeg ?? 0)}°` : ''}`;
    }
    return 'Trazo libre';
  })();

  const protractorOverlay = (() => {
    if (tool !== 'protractor' || !protVertex) return null;
    const base = Number.isFinite(toNum(protBase)) ? toNum(protBase) : 0;
    const sign = protCw ? -1 : 1;
    const outer = 42;
    const ticks = [];
    for (let deg = 0; deg <= 180; deg += 1) {
      const len = deg % 10 === 0 ? 6 : deg % 5 === 0 ? 4.5 : 3;
      const a = pointAt(protVertex, base + sign * deg, outer);
      const b = pointAt(protVertex, base + sign * deg, outer - len);
      ticks.push(<line key={deg} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#4d6b72" strokeWidth={deg % 10 === 0 ? 0.22 : 0.12} />);
    }
    const labels = [];
    for (let deg = 0; deg <= 180; deg += 10) {
      const p = pointAt(protVertex, base + sign * deg, outer + 3.4);
      labels.push(<text key={deg} x={p.x} y={p.y} fontSize="2.4" textAnchor="middle" dominantBaseline="middle" fill="#4d6b72">{deg}</text>);
    }
    const edge = arcPoints(protVertex, outer, protCw ? base - 180 : base, 180);
    const angle = toNum(protAngle);
    const pointer = Number.isFinite(angle) ? pointAt(protVertex, base + sign * angle, outer + 6) : null;
    return <g data-ephemeral="true" pointerEvents="none">
      <path d={`${pathFromPoints(edge)} Z`} fill="#dfeeea" fillOpacity=".38" stroke="#4d6b72" strokeWidth=".2" />
      {ticks}{labels}
      <line x1={protVertex.x} y1={protVertex.y} x2={pointAt(protVertex, base, outer + 6).x} y2={pointAt(protVertex, base, outer + 6).y} stroke="#8aa3a8" strokeWidth=".2" strokeDasharray="1.2 .8" />
      {pointer && <line x1={protVertex.x} y1={protVertex.y} x2={pointer.x} y2={pointer.y} stroke="#cf6349" strokeWidth=".3" />}
    </g>;
  })();

  const createRow = <div className="create-row">
    <button className="btn primary" onClick={commitPending} disabled={!canCreate} data-testid="button-place-line"><Check size={14} />Crear</button>
    <button className="btn" onClick={resetConstruction} data-testid="button-reset-construction">Reiniciar</button>
  </div>;
  const errorLine = pending?.error ? <div className="notice" data-testid="text-construction-error">{pending.error}</div> : null;
  const needsRelPoint = !parallelDistance;
  const scaleLabel = screenScale === null ? 'escala sin calibrar' : Math.abs(screenScale - 1) < 0.005 ? '1:1 real' : `×${screenScale.toFixed(2)}`;
  const toolHints: Record<Tool, string> = {
    pen: 'Solo S Pen dibuja', ruler: 'Regla: longitud y ángulo', compass: 'Compás: radio y arco', protractor: 'Transportador: ángulo exacto',
    parallel: 'Paralela a una línea', perpendicular: 'Perpendicular a una línea', select: 'Selecciona con S Pen', pan: 'Desliza para mover',
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Ruler size={19} strokeWidth={1.8} /></div>
          <div><div className="brand-name">Dibujo Técnico A4</div><div className="brand-sub">MESA DE PRECISIÓN · MILÍMETROS REALES</div></div>
        </div>
        <div className="top-actions">
          <span className="status-save" data-testid="status-autosave">{saveError ? 'No se pudo guardar' : saved ? 'Guardado local' : 'Guardando…'}</span>
          <button className="btn" onClick={() => setModal('export')} data-testid="button-export"><FileDown size={15} /><span className="export-label">Exportar</span></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="tool-rail" aria-label="Herramientas de dibujo">
          <section className="panel-section primary-tools">
            <div className="section-head">Herramientas <Settings2 size={13} /></div>
            <div className="tool-grid">
              <button className={`tool-button ${tool === 'pen' ? 'active' : ''}`} onClick={() => chooseTool('pen')} data-testid="tool-pen"><Pencil size={18} />Lápiz S Pen</button>
              <button className={`tool-button ${tool === 'ruler' ? 'active' : ''}`} onClick={() => chooseTool('ruler')} data-testid="tool-ruler"><Ruler size={18} />Regla exacta</button>
              <button className={`tool-button ${tool === 'compass' ? 'active' : ''}`} onClick={() => chooseTool('compass')} data-testid="tool-compass"><Compass size={18} />Compás</button>
              <button className={`tool-button ${tool === 'protractor' ? 'active' : ''}`} onClick={() => chooseTool('protractor')} data-testid="tool-protractor"><Triangle size={18} />Transportador</button>
              <button className={`tool-button ${tool === 'parallel' ? 'active' : ''}`} onClick={() => chooseTool('parallel')} data-testid="tool-parallel"><Equal size={18} />Paralela</button>
              <button className={`tool-button ${tool === 'perpendicular' ? 'active' : ''}`} onClick={() => chooseTool('perpendicular')} data-testid="tool-perpendicular"><Plus size={18} />Perpendicular</button>
              <button className={`tool-button ${tool === 'select' ? 'active' : ''}`} onClick={() => chooseTool('select')} data-testid="tool-select"><MousePointer2 size={18} />Seleccionar</button>
              <button className={`tool-button ${tool === 'pan' ? 'active' : ''}`} onClick={() => chooseTool('pan')} data-testid="tool-pan"><Hand size={18} />Desplazar</button>
            </div>
          </section>
          <section className="panel-section">
            <div className="section-head">Trazo nuevo</div>
            <div className="color-row">
              <input aria-label="Color del trazo" className="color-picker" type="color" value={doc.color} onChange={event => setDoc(current => ({ ...current, color: event.target.value }))} data-testid="input-color" />
              <div className="color-presets">{colors.map(color => <button key={color} className={`swatch ${doc.color === color ? 'chosen' : ''}`} aria-label={`Usar color ${color}`} onClick={() => setDoc(current => ({ ...current, color }))} data-testid={`swatch-${color.slice(1)}`}><span className="swatch-dot" style={{ backgroundColor: color }} /></button>)}</div>
            </div>
            <label className="control-label" htmlFor="stroke-width">Grosor <output>{doc.width.toFixed(2)} mm</output></label>
            <input id="stroke-width" type="range" min="0.15" max="2.5" step="0.05" value={doc.width} onChange={event => setDoc(current => ({ ...current, width: Number(event.target.value) }))} data-testid="input-width" />
          </section>

          {tool === 'ruler' && <section className="panel-section">
            <div className="section-head">Regla · longitud y ángulo</div>
            <div className="rule-box" data-testid="status-ruler">
              <b>{!ruleStart ? '01 / Marca el inicio' : !ruleAimed ? '02 / Marca la orientación' : '03 / Define la longitud'}</b>
              {!ruleStart ? 'Con el S Pen, toca el punto inicial sobre la hoja.' : !ruleAimed ? 'Toca otro punto para fijar la dirección, o escribe el ángulo.' : 'Longitud y ángulo exactos, independientes del zoom.'}
              {ruleStart && <div className="field-stack">
                <NumField label="Ángulo" unit="° (0 = derecha, 90 = arriba)" value={ruleAngle} onChange={value => { setRuleAngle(value); setRuleAimed(true); }} testid="input-rule-angle" />
                <NumField label="Longitud" unit="mm" value={ruleLength} onChange={setRuleLength} testid="input-rule-length" min={0.1} max={500} />
                {errorLine}
                {createRow}
              </div>}
            </div>
          </section>}

          {tool === 'compass' && <section className="panel-section">
            <div className="section-head">Compás · radio definido</div>
            <div className="rule-box" data-testid="status-compass">
              <b>{!compCenter ? '01 / Marca el centro' : '02 / Radio y arco'}</b>
              {!compCenter ? 'Toca el centro con el S Pen.' : compFull ? 'Toca un punto para tomar el radio, o escríbelo.' : compStage === 1 ? 'Toca un punto: radio y ángulo inicial. Luego otro para el ángulo final.' : 'Toca un punto para el ángulo final, o escríbelo.'}
              {compCenter && <div className="field-stack">
                <NumField label="Radio" unit="mm" value={compRadius} onChange={setCompRadius} testid="input-compass-radius" min={0.1} max={500} />
                <Toggle checked={compFull} onChange={setCompFull} label="Circunferencia completa" testid="toggle-compass-full" />
                {!compFull && <>
                  <NumField label="Ángulo inicial" unit="°" value={compStart} onChange={setCompStart} testid="input-compass-start" />
                  <NumField label="Ángulo final" unit="°" value={compEnd} onChange={setCompEnd} testid="input-compass-end" />
                  <div className="hint-small">El arco avanza en sentido antihorario del ángulo inicial al final.</div>
                </>}
                {errorLine}
                {createRow}
              </div>}
            </div>
          </section>}

          {tool === 'protractor' && <section className="panel-section">
            <div className="section-head">Transportador · ángulo exacto</div>
            <div className="rule-box" data-testid="status-protractor">
              <b>{!protVertex ? '01 / Marca el vértice' : '02 / Base y ángulo'}</b>
              {!protVertex ? 'Toca el vértice del ángulo con el S Pen.' : 'Toca un punto para orientar el rayo base (0° del transportador), o escribe el ángulo base.'}
              {protVertex && <div className="field-stack">
                <NumField label="Dirección del rayo base" unit="°" value={protBase} onChange={setProtBase} testid="input-protractor-base" />
                <button className="btn" onClick={() => { const base = toNum(protBase); if (Number.isFinite(base)) setProtBase(String(roundTo(((base + 180) % 360 + 360) % 360, 2))); }} data-testid="button-protractor-flip-base">Invertir base (+180°)</button>
                <NumField label="Ángulo a construir" unit="°" value={protAngle} onChange={setProtAngle} testid="input-protractor-angle" min={0.01} max={359.99} />
                <Seg value={protCw ? 'cw' : 'ccw'} onChange={value => setProtCw(value === 'cw')} testid="seg-protractor-dir" options={[{ value: 'ccw', label: '↺ Antihorario' }, { value: 'cw', label: '↻ Horario' }]} />
                <NumField label="Longitud de los rayos" unit="mm" value={protLen} onChange={setProtLen} testid="input-protractor-length" min={0.1} max={500} />
                <Toggle checked={protBaseRay} onChange={setProtBaseRay} label="Dibujar también el rayo base" testid="toggle-protractor-base-ray" />
                <Toggle checked={protMark} onChange={setProtMark} label="Marcar el arco del ángulo" testid="toggle-protractor-mark" />
                {errorLine}
                {createRow}
              </div>}
            </div>
          </section>}

          {(tool === 'parallel' || tool === 'perpendicular') && <section className="panel-section">
            <div className="section-head">{tool === 'parallel' ? 'Línea paralela' : 'Línea perpendicular'}</div>
            <div className="rule-box" data-testid="status-relation">
              <b>{!refStroke ? '01 / Elige la referencia' : needsRelPoint && !relPoint ? '02 / Marca el punto' : '03 / Ajusta y crea'}</b>
              {!refStroke ? 'Toca con el S Pen una línea recta ya dibujada.' : needsRelPoint && !relPoint ? 'Toca el punto por el que pasará la nueva línea.' : 'Revisa la vista previa y pulsa Crear.'}
              {notice && <div className="notice">{notice}</div>}
              {refStroke && refA && refB && <div className="field-stack">
                <div className="hint-small">Referencia: {fmt(segmentLength(refA, refB), 3)} mm · {fmt(segmentAngle(refA, refB))}°</div>
                {tool === 'parallel' && <Seg value={relMethod} onChange={setRelMethod} testid="seg-relation-method" options={[{ value: 'point', label: 'Por un punto' }, { value: 'distance', label: 'A una distancia' }]} />}
                {parallelDistance
                  ? <NumField label="Distancia entre paralelas" unit="mm" value={relDist} onChange={setRelDist} testid="input-relation-distance" min={0.1} max={500} />
                  : <>
                    <Seg value={effectivePlacement} onChange={setRelPlacement} testid="seg-relation-placement" options={tool === 'perpendicular'
                      ? [{ value: 'start', label: 'Desde el punto' }, { value: 'center', label: 'Centrada' }, { value: 'foot', label: 'Hasta la recta' }]
                      : [{ value: 'start', label: 'Desde el punto' }, { value: 'center', label: 'Centrada' }]} />
                    {effectivePlacement !== 'foot' && <NumField label="Longitud" unit="mm" value={relLen} onChange={setRelLen} testid="input-relation-length" min={0.1} max={500} />}
                  </>}
                {(parallelDistance || effectivePlacement === 'start') && <button className="btn" onClick={() => setRelFlip(value => !value)} data-testid="button-relation-flip">Invertir lado</button>}
                <button className="btn" onClick={() => { setRelRef(null); setRelPoint(null); setNotice(''); }} data-testid="button-relation-change-ref">Cambiar referencia</button>
                {errorLine}
                {createRow}
              </div>}
            </div>
          </section>}

          {tool === 'select' && <section className="panel-section">
            <div className="section-head">Selección</div>
            <button className="btn danger" disabled={!selected} onClick={deleteSelected} data-testid="button-delete-selected"><Trash2 size={14} />Eliminar trazo seleccionado</button>
            <div className="rule-box" data-testid="status-selection">{selected ? <>Trazo seleccionado. Eliminarlo se puede deshacer.{selectedInfo && <><br /><b className="mono-line">{selectedInfo}</b></>}</> : 'Toca un trazo con el S Pen para seleccionarlo.'}</div>
          </section>}

          <section className="panel-section">
            <div className="section-head">Imanes y ayudas</div>
            <Toggle checked={prefs.snapGrid} onChange={value => setPrefs(current => ({ ...current, snapGrid: value }))} label="Imán a la cuadrícula de 1 mm" testid="toggle-snap-grid" />
            <Toggle checked={prefs.snapObj} onChange={value => setPrefs(current => ({ ...current, snapObj: value }))} label="Imán a extremos, medios y centros" testid="toggle-snap-objects" />
            <Toggle checked={prefs.keepTool} onChange={value => setPrefs(current => ({ ...current, keepTool: value }))} label="Mantener la herramienta tras crear" testid="toggle-keep-tool" />
            <Toggle checked={prefs.mouseAsPen} onChange={value => setPrefs(current => ({ ...current, mouseAsPen: value }))} label="Ratón como lápiz (pruebas en PC)" testid="toggle-mouse-as-pen" />
          </section>

          <section className="panel-section">
            <div className="section-head">Márgenes · mm</div>
            <div className="margin-grid">
              {(['top', 'right', 'bottom', 'left'] as const).map((side, index) => <label className="margin-field" key={side}>{['Superior', 'Derecho', 'Inferior', 'Izquierdo'][index]}<input type="number" min="0" max="40" value={doc.margins[side]} onChange={event => setMargin(side, event.target.value)} data-testid={`input-margin-${side}`} /></label>)}
            </div>
          </section>

          <section className="panel-section history-tools">
            <div className="section-head">Edición</div>
            <div className="tool-grid">
              <button className="tool-button" onClick={undo} disabled={!undoStack.length} data-testid="button-undo"><Undo2 size={16} />Deshacer</button>
              <button className="tool-button" onClick={redo} disabled={!redoStack.length} data-testid="button-redo"><Redo2 size={16} />Rehacer</button>
            </div>
            <button className="btn danger" onClick={() => setModal('clear')} disabled={!doc.strokes.length} data-testid="button-clear"><Eraser size={14} />Limpiar hoja…</button>
          </section>
        </aside>

        <section className="canvas-area">
          <div className="canvas-toolbar">
            <div className="doc-label"><span className="doc-pill">A4</span><span>Vertical</span><span className="mono">210 × 297 mm</span></div>
            <div className="canvas-controls">
              <button className="btn small" onClick={goRealScale} data-testid="button-real-scale" aria-label="Escala real 1:1">1:1</button>
              <button className="btn small" onClick={() => { setCalMeasured(''); setModal('calibrate'); }} data-testid="button-calibrate">Calibrar</button>
              <button className="icon-btn" aria-label="Alejar" onClick={() => setZoom(value => Math.max(MIN_ZOOM, value / 1.15))} data-testid="button-zoom-out"><ZoomOut size={17} /></button>
              <span className="zoom-readout" data-testid="text-zoom">{Math.round(zoom * 100)}%</span>
              <button className="icon-btn" aria-label="Acercar" onClick={() => setZoom(value => Math.min(MAX_ZOOM, value * 1.15))} data-testid="button-zoom-in"><ZoomIn size={17} /></button>
              <button className="icon-btn" aria-label="Ajustar hoja al área visible" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} data-testid="button-fit"><Circle size={15} /></button>
              <span className="scale-readout" data-testid="text-scale">{scaleLabel}</span>
            </div>
          </div>
          <div className="stage" ref={stageRef} data-testid="drawing-stage">
            <div className="paper-wrap" id="print-sheet" style={{ width: paperWidth, height: paperHeight, left: paperLeft, top: paperTop, transform: `scale(${zoom})` }}>
              <svg ref={svgRef} viewBox="0 0 210 297" width="210mm" height="297mm" preserveAspectRatio="none" role="img" aria-label="Hoja A4 milimetrada" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onPointerLeave={() => setHover(null)} data-testid="drawing-sheet">
                <rect x="0" y="0" width="210" height="297" fill="white" />
                <g data-grid="true" pointerEvents="none">{gridLines}</g>
                <rect data-margin="true" className="page-margin" fill="none" stroke="#85b8a6" strokeWidth=".22" strokeDasharray="1.3 1.1" x={doc.margins.left} y={doc.margins.top} width={Math.max(0, 210 - doc.margins.left - doc.margins.right)} height={Math.max(0, 297 - doc.margins.top - doc.margins.bottom)} />
                {doc.strokes.map(stroke => <path key={stroke.id} d={pathFromPoints(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" className={selected === stroke.id || relRef === stroke.id ? 'selected-path' : ''} onPointerDown={event => { if (tool === 'select' && event.pointerType === 'pen') { event.stopPropagation(); setSelected(stroke.id); } }} data-testid={`stroke-${stroke.id}`} />)}
                {liveStroke && <path data-ephemeral="true" d={pathFromPoints(liveStroke.points)} fill="none" stroke={liveStroke.color} strokeWidth={liveStroke.width} strokeLinecap="round" strokeLinejoin="round" />}
                {protractorOverlay}
                {pending && !pending.error && pending.strokes.map((stroke, index) => <path key={`pending-${index}`} data-ephemeral="true" d={pathFromPoints(stroke.points)} fill="none" stroke="#cf6349" strokeWidth={Math.max(stroke.width, 0.3)} strokeDasharray="1.8 1" strokeLinecap="round" pointerEvents="none" />)}
                {tool === 'ruler' && ruleStart && <g data-ephemeral="true" pointerEvents="none"><circle cx={ruleStart.x} cy={ruleStart.y} r="1.1" fill="#cf6349" /></g>}
                {tool === 'compass' && compCenter && <g data-ephemeral="true" pointerEvents="none">
                  <line x1={compCenter.x - 2.5} y1={compCenter.y} x2={compCenter.x + 2.5} y2={compCenter.y} stroke="#cf6349" strokeWidth=".3" />
                  <line x1={compCenter.x} y1={compCenter.y - 2.5} x2={compCenter.x} y2={compCenter.y + 2.5} stroke="#cf6349" strokeWidth=".3" />
                  {Number.isFinite(toNum(compRadius)) && Number.isFinite(toNum(compStart)) && <line x1={compCenter.x} y1={compCenter.y} x2={pointAt(compCenter, toNum(compStart), toNum(compRadius)).x} y2={pointAt(compCenter, toNum(compStart), toNum(compRadius)).y} stroke="#cf6349" strokeWidth=".2" strokeDasharray="1 .8" />}
                </g>}
                {tool === 'protractor' && protVertex && <g data-ephemeral="true" pointerEvents="none"><circle cx={protVertex.x} cy={protVertex.y} r="1.1" fill="#cf6349" /></g>}
                {(tool === 'parallel' || tool === 'perpendicular') && relPoint && <g data-ephemeral="true" pointerEvents="none"><circle cx={relPoint.x} cy={relPoint.y} r="1.1" fill="#cf6349" /></g>}
                {isConstruction && hover && <circle data-ephemeral="true" pointerEvents="none" cx={hover.x} cy={hover.y} r={5 / screenPxPerMm} fill="none" stroke={hover.kind && hover.kind !== 'cuadricula' ? '#cf6349' : '#7d9399'} strokeWidth={1.5 / screenPxPerMm} />}
              </svg>
            </div>
            <div className="stage-hint"><strong>{toolHints[tool]}</strong> · Dos dedos para zoom y desplazamiento{isConstruction && hover?.kind ? ` · imán: ${hover.kind}` : ''}</div>
          </div>
        </section>
      </div>
      <footer className="footerbar"><span>CUADRÍCULA 1 mm · ÉNFASIS 5 mm · REFERENCIA 10 mm</span><span>COORDENADAS DOCUMENTALES FIJAS · {doc.strokes.length} TRAZOS</span></footer>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className={`modal ${modal === 'calibrate' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          {modal === 'clear' ? <>
            <h2 id="dialog-title">Limpiar la hoja</h2>
            <p>Se quitarán los {doc.strokes.length} trazos de este dibujo. Esta acción se puede deshacer.</p>
            <div className="modal-actions"><button className="btn" onClick={() => setModal(null)} data-testid="button-cancel-clear">Cancelar</button><button className="btn danger" onClick={() => { commitStrokes([]); setModal(null); }} data-testid="button-confirm-clear"><Trash2 size={14} />Limpiar trazos</button></div>
          </> : modal === 'calibrate' ? <>
            <h2 id="dialog-title">Calibrar escala real</h2>
            <p>El navegador no conoce el tamaño físico exacto de tu pantalla. Apoya una regla física sobre la barra de abajo, mide de extremo a extremo en milímetros y escribe lo que mides.</p>
            <div className="cal-bar-wrap"><div className="cal-bar" style={{ width: `${CAL_MM}mm` }} data-testid="calibration-bar" /></div>
            <NumField label="Medida real de la barra" unit="mm" value={calMeasured} onChange={setCalMeasured} testid="input-calibration-measured" min={20} max={400} />
            <div className="export-note">La precisión depende de cómo midas (un error de 0,5 mm sobre 100 mm es ≈ 0,5 %). Si cambias el tamaño de pantalla/fuente de Android o el zoom del navegador, vuelve a comprobar. Después de calibrar, verifica con una línea de longitud conocida creada con la regla.</div>
            <div className="modal-actions"><button className="btn" onClick={() => setModal(null)} data-testid="button-cancel-calibration">Cancelar</button><button className="btn primary" onClick={saveCalibration} disabled={!(toNum(calMeasured) >= 20 && toNum(calMeasured) <= 400)} data-testid="button-save-calibration"><Check size={14} />Guardar y aplicar 1:1</button></div>
          </> : <>
            <h2 id="dialog-title">Exportar dibujo</h2>
            <p>Descarga un PDF vectorial A4 con medidas reales o imprime sin cambiar la escala.</p>
            <div className="export-note"><b>PDF descargable · A4 exacto · vectores 1:1</b><br />La cuadrícula y los márgenes guía se incluyen. Para imprimir, selecciona papel A4 y escala 100%; desactiva “ajustar a página”.</div>
            <div className="modal-actions"><button className="btn" onClick={() => setModal(null)} data-testid="button-cancel-export">Cancelar</button><button className="btn" onClick={downloadPng} data-testid="button-export-png"><Download size={14} />PNG alta resolución</button><button className="btn" onClick={printPdf} data-testid="button-print-100"><FileDown size={14} />Imprimir a 100%</button><button className="btn primary" onClick={downloadPdf} disabled={pdfBusy} data-testid="button-export-pdf"><FileDown size={14} />{pdfBusy ? 'Preparando PDF…' : 'Descargar PDF'}</button></div>
          </>}
        </section>
      </div>}
    </main>
  );
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={DrawingApp} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
