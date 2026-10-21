import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, FilePlus2, FolderInput, LayoutGrid, List, Pencil, Rows3, Ruler, Trash2 } from 'lucide-react';
import type { Orientation } from '@/lib/geometry.js';
import type { IndexRecord, Project } from '@/lib/project.js';
import { projectToJson } from '@/lib/project.js';
import type { Store } from '@/lib/storage.js';
import { Seg } from './fields';
import { downloadBlob, projectChannel, safeFileName } from './project-io';

type ViewMode = 'grid' | 'list' | 'compact';
const VIEW_KEY = 'dibujo-tecnico-a4-biblioteca-vista';
export type StartupNotice = { kind: 'info' | 'warning' | 'error'; text: string; actions?: { label: string; testid: string; run: () => void | Promise<void> }[] };

function loadViewMode(): ViewMode {
  try { const v = localStorage.getItem(VIEW_KEY); return v === 'list' || v === 'compact' ? v : 'grid'; } catch { return 'grid'; }
}
const dateFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '—');
const plural = (n: number) => `${n} ${n === 1 ? 'elemento' : 'elementos'}`;

export function Library({ store, onOpen, notices, onDismissNotice, persisted }: {
  store: Store; onOpen: (id: string) => void; notices: StartupNotice[]; onDismissNotice: (i: number) => void; persisted: boolean | null;
}) {
  const [items, setItems] = useState<IndexRecord[] | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ViewMode>(loadViewMode);
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'rename'; item: IndexRecord } | { kind: 'delete'; item: IndexRecord } | null>(null);
  const [name, setName] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try { setItems(await store.list()); setError(''); } catch (e) { setError((e as Error).message); setItems([]); }
  }, [store]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, mode); } catch { /* no crítico */ } }, [mode]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = projectChannel();
    ch.onmessage = () => { void refresh(); };
    return () => ch.close();
  }, [refresh]);

  const recent = useMemo(() => (items ?? []).filter(i => i.openedAt).sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || '')).slice(0, 4), [items]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); setDialog(null); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const create = () => run(async () => { const rec = await store.newProject({ name: name || 'Sin título', orientation }); onOpen(rec.id); });
  const rename = (item: IndexRecord) => run(() => store.rename(item.id, name));
  const remove = (item: IndexRecord) => run(async () => {
    await store.remove(item.id);
    try { const ch = projectChannel(); ch.postMessage({ type: 'deleted', id: item.id }); ch.close(); } catch { /* sin canal */ }
  });
  const duplicate = (item: IndexRecord) => run(() => store.duplicate(item.id));
  const exportItem = (item: IndexRecord) => run(async () => {
    const p: Project = await store.load(item.id);
    downloadBlob(new Blob([projectToJson(p)], { type: 'application/json' }), `${safeFileName(p.name)}.dta4.json`);
  });
  const importFile = (file: File) => run(async () => {
    const text = await file.text();
    const { record, dropped } = await store.importJson(text);
    if (dropped) setError(`Se importó «${record.name}», pero ${dropped} elemento(s) no eran válidos y se omitieron.`);
  });

  const card = (item: IndexRecord) => <article key={item.id} className="lib-item" data-testid={`project-${item.id}`}>
    <button className="lib-open" onClick={() => onOpen(item.id)} data-testid={`open-${item.id}`} aria-label={`Abrir ${item.name}`}>
      {mode !== 'compact' && <span className={`lib-thumb ${item.orientation}`}>{item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span className="lib-thumb-empty">{item.entityCount ? plural(item.entityCount) : 'Vacío'}</span>}</span>}
      <span className="lib-meta">
        <b className="lib-name" data-testid="project-name">{item.name}</b>
        <span className="lib-sub">{item.orientation === 'landscape' ? 'Horizontal' : 'Vertical'} · {plural(item.entityCount)}</span>
        <span className="lib-sub">Modificado {fmtDate(item.modifiedAt)}</span>
      </span>
    </button>
    <div className="lib-actions">
      <button className="icon-btn" onClick={() => duplicate(item)} disabled={busy} aria-label="Duplicar" title="Duplicar" data-testid={`duplicate-${item.id}`}><Copy size={16} /></button>
      <button className="icon-btn" onClick={() => { setName(item.name); setDialog({ kind: 'rename', item }); }} disabled={busy} aria-label="Renombrar" title="Renombrar" data-testid={`rename-${item.id}`}><Pencil size={16} /></button>
      <button className="icon-btn" onClick={() => exportItem(item)} disabled={busy} aria-label="Exportar archivo" title="Exportar archivo (JSON)" data-testid={`export-${item.id}`}><Download size={16} /></button>
      <button className="icon-btn danger" onClick={() => setDialog({ kind: 'delete', item })} disabled={busy} aria-label="Eliminar" title="Eliminar" data-testid={`delete-${item.id}`}><Trash2 size={16} /></button>
    </div>
  </article>;

  return <main className="library-shell" data-testid="library">
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"><Ruler size={19} strokeWidth={1.8} /></div>
        <div><div className="brand-name">Dibujo Técnico A4</div><div className="brand-sub">BIBLIOTECA DE PROYECTOS · GUARDADO EN ESTE DISPOSITIVO</div></div>
      </div>
      <div className="top-actions">
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="button-import"><FolderInput size={15} /><span className="export-label">Importar</span></button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} data-testid="input-import" />
        <button className="btn primary" onClick={() => { setName(''); setOrientation('portrait'); setDialog({ kind: 'new' }); }} data-testid="button-new-project"><FilePlus2 size={15} />Nuevo proyecto</button>
      </div>
    </header>
    <div className="library-body">
      {notices.map((n, i) => <div key={i} className={`notice ${n.kind === 'info' ? 'info' : n.kind === 'warning' ? 'warn' : ''}`} role={n.kind === 'error' ? 'alert' : 'status'} data-testid="startup-notice">
        <span>{n.text}</span>
        <div className="problem-actions">
          {n.actions?.map(a => <button key={a.testid} className="btn small" onClick={() => void a.run()} data-testid={a.testid}>{a.label}</button>)}
          <button className="link-btn" onClick={() => onDismissNotice(i)}>Cerrar</button>
        </div>
      </div>)}
      {error && <div className="notice" role="alert" data-testid="library-error">{error}<button className="link-btn" onClick={() => setError('')}>Cerrar</button></div>}
      <div className="library-toolbar">
        <span className="hint-small" data-testid="text-persist">{persisted === true ? 'Almacenamiento persistente concedido por el navegador.' : persisted === false ? 'El navegador no garantiza conservar los datos si falta espacio: exporta copias (JSON) de los proyectos importantes.' : ''}</span>
        <Seg value={mode} onChange={setMode} testid="seg-library-view" options={[{ value: 'grid', label: 'Cuadrícula' }, { value: 'list', label: 'Lista' }, { value: 'compact', label: 'Sin miniaturas' }]} />
      </div>
      {items === null ? <p className="hint-small">Cargando proyectos…</p> : items.length === 0 ? <div className="lib-empty" data-testid="library-empty">
        <b>Aún no hay proyectos</b>
        <span>Crea una hoja A4 vertical u horizontal para empezar, o importa un archivo de proyecto (.json).</span>
      </div> : <>
        {recent.length > 0 && <section className="lib-section"><div className="section-head">Recientes</div><div className={`lib-list ${mode}`} data-testid="library-recent">{recent.map(card)}</div></section>}
        <section className="lib-section"><div className="section-head">Todos los proyectos · {items.length}</div><div className={`lib-list ${mode}`} data-testid="library-all">{items.map(card)}</div></section>
      </>}
    </div>

    {dialog && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setDialog(null); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="lib-dialog-title">
        {dialog.kind === 'new' ? <>
          <h2 id="lib-dialog-title">Nuevo proyecto</h2>
          <label className="field"><span className="field-label">Nombre</span><input className="number-input" value={name} onChange={e => setName(e.target.value)} placeholder="Sin título" autoFocus data-testid="input-project-name" onKeyDown={e => { if (e.key === 'Enter') void create(); }} /></label>
          <div className="field"><span className="field-label">Orientación de la hoja A4</span>
            <Seg value={orientation} onChange={setOrientation} testid="seg-new-orientation" options={[{ value: 'portrait', label: 'Vertical · 210 × 297' }, { value: 'landscape', label: 'Horizontal · 297 × 210' }]} />
          </div>
          <div className="modal-actions"><button className="btn" onClick={() => setDialog(null)} disabled={busy}>Cancelar</button><button className="btn primary" onClick={create} disabled={busy} data-testid="button-create-project">Crear</button></div>
        </> : dialog.kind === 'rename' ? <>
          <h2 id="lib-dialog-title">Renombrar</h2>
          <label className="field"><span className="field-label">Nombre</span><input className="number-input" value={name} onChange={e => setName(e.target.value)} autoFocus data-testid="input-rename" onKeyDown={e => { if (e.key === 'Enter') void rename(dialog.item); }} /></label>
          <div className="modal-actions"><button className="btn" onClick={() => setDialog(null)} disabled={busy}>Cancelar</button><button className="btn primary" onClick={() => rename(dialog.item)} disabled={busy || !name.trim()} data-testid="button-confirm-rename">Renombrar</button></div>
        </> : <>
          <h2 id="lib-dialog-title">Eliminar «{dialog.item.name}»</h2>
          <p>Se borrará el proyecto de este dispositivo con sus {dialog.item.entityCount} elementos. Esta acción no se puede deshacer. Si quieres conservarlo, exporta antes una copia (JSON).</p>
          <div className="modal-actions"><button className="btn" onClick={() => setDialog(null)} disabled={busy} data-testid="button-cancel-delete">Cancelar</button><button className="btn danger" onClick={() => remove(dialog.item)} disabled={busy} data-testid="button-confirm-delete"><Trash2 size={14} />Eliminar</button></div>
        </>}
      </section>
    </div>}
  </main>;
}
