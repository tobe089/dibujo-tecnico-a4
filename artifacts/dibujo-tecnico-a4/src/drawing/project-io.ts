import type { Entity } from '@/lib/document.js';
import type { Sheet } from '@/lib/geometry.js';
import { buildSheetSvg } from '@/lib/render.js';

const CHANNEL = 'dibujo-tecnico-a4';

/** Canal entre pestañas: avisa cuando un proyecto se guarda o se elimina en otra pestaña. */
export function projectChannel(): BroadcastChannel {
  return new BroadcastChannel(CHANNEL);
}

/** Miniatura PNG (data URL) de la hoja, sin cuadrícula. Solo para la biblioteca: no es una exportación. */
export function makeThumbnail(entities: Entity[], sheet: Sheet, width = 180): Promise<string> {
  // A este tamaño un trazo de 0,45 mm mediría 0,3 px: en la miniatura se engrosa para que se vea (solo aquí).
  const minWidth = 1.6 * sheet.w / width;
  const visible = entities.map(e => (e.width < minWidth ? { ...e, width: minWidth } : e));
  const svg = buildSheetSvg(visible, { top: 0, right: 0, bottom: 0, left: 0 }, { grid: false, sheet });
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.round(width * sheet.h / sheet.w);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Sin contexto 2D');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo generar la miniatura')); };
    image.src = url;
  });
}

/** Descarga un archivo (fuera de los visores que bloquean descargas). */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function safeFileName(name: string) {
  return (name.replace(/[^\p{L}\p{N} _.-]/gu, '_').trim() || 'proyecto').slice(0, 80);
}
