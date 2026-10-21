import { useCallback, useEffect, useRef, useState } from 'react';
import { openStore, type Store } from '@/lib/storage.js';
import { makeId } from '@/lib/document.js';
import type { Project } from '@/lib/project.js';
import { clearJournal, resolveJournal } from '@/lib/journal.js';
import { DrawingApp } from './DrawingApp';
import { Library, type StartupNotice } from './Library';
import { downloadBlob } from './project-io';

function safeLocalStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Arranque: abrir IndexedDB → migrar el dibujo antiguo → resolver copias de cierre pendientes → biblioteca. */
export function AppRoot() {
  const [store, setStore] = useState<Store | null>(null);
  const [fatal, setFatal] = useState('');
  const [notices, setNotices] = useState<StartupNotice[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [update, setUpdate] = useState<null | (() => void)>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const started = useRef(false);

  const addNotice = (n: StartupNotice) => setNotices(list => [...list, n]);
  const dropNotice = (i: number) => setNotices(list => list.filter((_, k) => k !== i));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      let s: Store;
      try { s = await openStore(); } catch (e) { setFatal((e as Error).message); return; }
      const ls = safeLocalStorage();
      const m = await s.migrateLegacy(ls).catch((e: Error) => ({ status: 'fallido' as const, error: e.message, raw: undefined }));
      if (m.status === 'migrado') {
        addNotice({ kind: 'info', text: `Tu dibujo anterior (${m.count} elementos${m.dropped ? `; ${m.dropped} ilegibles omitidos` : ''}) está ahora en la biblioteca como «Dibujo anterior». Los datos originales del navegador no se han borrado.` });
      } else if (m.status === 'fallido') {
        const raw = 'raw' in m ? m.raw : undefined;
        addNotice({
          kind: 'error', text: `${m.error} No se ha creado ningún proyecto y los datos originales siguen intactos en el navegador; se volverá a intentar al abrir la app.`,
          actions: raw ? [{ label: 'Exportar los datos originales', testid: 'button-export-legacy', run: () => downloadBlob(new Blob([raw], { type: 'application/json' }), 'dibujo-anterior-original.json') }] : [],
        });
      }
      if (ls) {
        try {
          const j = await resolveJournal(s, ls);
          if (j.action === 'aplicada') addNotice({ kind: 'info', text: 'Se recuperaron cambios que no habían terminado de guardarse al cerrar la app.' });
          if (j.action === 'conflicto' || j.action === 'sin-proyecto') {
            const pending = j.project;
            addNotice({
              kind: 'warning',
              text: `Hay cambios de «${pending.name}» que no llegaron a guardarse al cerrar, ${j.action === 'conflicto' ? 'pero después se guardó otra versión' : 'pero el proyecto ya no existe'}. No se ha sobrescrito nada.`,
              actions: [
                { label: 'Guardarlos como copia', testid: 'button-journal-copy', run: async () => { await s.create({ ...pending, id: makeId(), name: `${pending.name} (recuperado)`, revision: 0 }); clearJournal(ls); setNotices(l => l.filter(n => !n.text.includes(pending.name))); setOpenCount(c => c + 1); } },
                { label: 'Descartarlos', testid: 'button-journal-discard', run: () => { clearJournal(ls); setNotices(l => l.filter(n => !n.text.includes(pending.name))); } },
              ],
            });
          }
        } catch (e) { addNotice({ kind: 'error', text: `No se pudo revisar si había cambios pendientes: ${(e as Error).message}` }); }
      }
      try { setPersisted(navigator.storage?.persist ? await navigator.storage.persist() : null); } catch { setPersisted(null); }
      setStore(s);
    })();
  }, []);

  // Aplicación sin conexión: aviso de "lista para usarse sin conexión" y de nueva versión (sin recargar a mitad de un dibujo).
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    import('virtual:pwa-register').then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh: () => setUpdate(() => () => void updateSW(true)),
        onOfflineReady: () => setOfflineReady(true),
      });
    }).catch(() => { /* sin service worker en este entorno */ });
  }, []);

  const open = useCallback(async (id: string) => {
    if (!store) return;
    try {
      const p = await store.load(id);
      await store.touchOpened(id).catch(() => undefined);
      setProject(p);
      setOpenCount(c => c + 1);
    } catch (e) { addNotice({ kind: 'error', text: `No se pudo abrir el proyecto: ${(e as Error).message}` }); }
  }, [store]);

  const banners = <>
    {update && <div className="app-banner" role="status" data-testid="banner-update">Hay una versión nueva de la app. <button className="btn small" onClick={() => update()} data-testid="button-update">Actualizar ahora</button> <span className="hint-small">(guarda antes de actualizar)</span></div>}
    {offlineReady && !update && <div className="app-banner" role="status" data-testid="banner-offline">Lista para usarse sin conexión. <button className="link-btn" onClick={() => setOfflineReady(false)}>Cerrar</button></div>}
  </>;

  if (fatal) return <main className="library-shell"><div className="library-body"><div className="notice" role="alert" data-testid="fatal-storage">{fatal}</div></div></main>;
  if (!store) return <main className="library-shell"><div className="library-body"><p className="hint-small" data-testid="loading">Preparando la biblioteca…</p></div></main>;
  if (project) {
    return <>{banners}<DrawingApp key={`${project.id}:${openCount}`} store={store} project={project} onExit={() => setProject(null)} onOpenProject={open} /></>;
  }
  return <>{banners}<Library key={openCount} store={store} onOpen={open} notices={notices} onDismissNotice={dropNotice} persisted={persisted} /></>;
}
