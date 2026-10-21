import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { normalizeDeg, segmentAngle, segmentLength, sweepBetween } from '@/lib/geometry.js';
import { entityLength, segmentWithAngle, segmentWithLength, type Entity, type EntityPatch } from '@/lib/document.js';
import { ExactField, fmtNum } from './fields';

const TYPE_LABEL: Record<Entity['type'], string> = {
  point: 'Punto', segment: 'Segmento', circle: 'Circunferencia', arc: 'Arco', polyline: 'Trazo libre',
};

/** Edición numérica exacta de una entidad. onPatch devuelve un mensaje de error o null. */
export function EntityEditor({ entity, onPatch, onDelete, onApplyStyle, error }: {
  entity: Entity; onPatch: (patch: EntityPatch) => void; onDelete: () => void; onApplyStyle: () => void; error: string | null;
}) {
  const key = entity.id; // reinicia los campos al cambiar de entidad
  let body: ReactNode = null;
  let summary = '';
  switch (entity.type) {
    case 'point':
      summary = `(${fmtNum(entity.x)}, ${fmtNum(entity.y)}) mm`;
      body = <div className="field-pair">
        <ExactField key={`${key}x`} label="X" unit="mm" value={entity.x} onCommit={x => onPatch({ x })} testid="edit-point-x" />
        <ExactField key={`${key}y`} label="Y" unit="mm" value={entity.y} onCommit={y => onPatch({ y })} testid="edit-point-y" />
      </div>;
      break;
    case 'segment': {
      const length = segmentLength(entity.a, entity.b);
      const angle = segmentAngle(entity.a, entity.b);
      summary = `${fmtNum(length)} mm · ${fmtNum(angle)}°`;
      body = <>
        <div className="field-pair">
          <ExactField key={`${key}ax`} label="Inicio X" unit="mm" value={entity.a.x} onCommit={x => onPatch({ a: { x, y: entity.a.y } })} testid="edit-seg-ax" />
          <ExactField key={`${key}ay`} label="Inicio Y" unit="mm" value={entity.a.y} onCommit={y => onPatch({ a: { x: entity.a.x, y } })} testid="edit-seg-ay" />
          <ExactField key={`${key}bx`} label="Fin X" unit="mm" value={entity.b.x} onCommit={x => onPatch({ b: { x, y: entity.b.y } })} testid="edit-seg-bx" />
          <ExactField key={`${key}by`} label="Fin Y" unit="mm" value={entity.b.y} onCommit={y => onPatch({ b: { x: entity.b.x, y } })} testid="edit-seg-by" />
        </div>
        <div className="field-pair">
          <ExactField key={`${key}len`} label="Longitud" unit="mm" value={length} onCommit={v => { if (v > 0) onPatch(segmentWithLength(entity, v)); }} testid="edit-seg-length" />
          <ExactField key={`${key}ang`} label="Ángulo" unit="°" value={angle} onCommit={v => onPatch(segmentWithAngle(entity, v))} testid="edit-seg-angle" />
        </div>
        <div className="hint-small">Longitud y ángulo se cambian manteniendo fijo el inicio.</div>
      </>;
      break;
    }
    case 'circle':
      summary = `centro (${fmtNum(entity.c.x)}, ${fmtNum(entity.c.y)}) · r ${fmtNum(entity.r)} mm`;
      body = <div className="field-pair">
        <ExactField key={`${key}cx`} label="Centro X" unit="mm" value={entity.c.x} onCommit={x => onPatch({ c: { x, y: entity.c.y } })} testid="edit-circle-cx" />
        <ExactField key={`${key}cy`} label="Centro Y" unit="mm" value={entity.c.y} onCommit={y => onPatch({ c: { x: entity.c.x, y } })} testid="edit-circle-cy" />
        <ExactField key={`${key}r`} label="Radio" unit="mm" value={entity.r} onCommit={r => { if (r > 0) onPatch({ r }); }} testid="edit-circle-r" />
      </div>;
      break;
    case 'arc': {
      const end = normalizeDeg(entity.start + entity.sweep);
      summary = `r ${fmtNum(entity.r)} mm · ${fmtNum(entity.start)}° → ${fmtNum(end)}° (barrido ${fmtNum(entity.sweep)}°)`;
      body = <>
        <div className="field-pair">
          <ExactField key={`${key}cx`} label="Centro X" unit="mm" value={entity.c.x} onCommit={x => onPatch({ c: { x, y: entity.c.y } })} testid="edit-arc-cx" />
          <ExactField key={`${key}cy`} label="Centro Y" unit="mm" value={entity.c.y} onCommit={y => onPatch({ c: { x: entity.c.x, y } })} testid="edit-arc-cy" />
          <ExactField key={`${key}r`} label="Radio" unit="mm" value={entity.r} onCommit={r => { if (r > 0) onPatch({ r }); }} testid="edit-arc-r" />
          <ExactField key={`${key}sw`} label="Barrido" unit="°" value={entity.sweep} onCommit={sweep => { if (sweep > 0) onPatch({ sweep }); }} testid="edit-arc-sweep" />
          <ExactField key={`${key}st`} label="Ángulo inicial" unit="°" value={entity.start} onCommit={start => onPatch({ start })} testid="edit-arc-start" />
          <ExactField key={`${key}en`} label="Ángulo final" unit="°" value={end} onCommit={v => { const sweep = sweepBetween(entity.start, v); if (sweep > 0) onPatch({ sweep }); }} testid="edit-arc-end" />
        </div>
        <div className="hint-small">El arco avanza en sentido antihorario del ángulo inicial al final.</div>
      </>;
      break;
    }
    case 'polyline':
      summary = `${entity.points.length} puntos · ${fmtNum(entityLength(entity), 2)} mm de recorrido`;
      break;
  }
  return <div className="entity-editor" data-testid="entity-editor">
    <b className="mono-line" data-testid="entity-summary">{TYPE_LABEL[entity.type]} · {summary}</b>
    {body}
    {error && <div className="notice" data-testid="entity-error">{error}</div>}
    <div className="create-row">
      <button className="btn" onClick={onApplyStyle} data-testid="button-apply-style">Aplicar color y grosor actuales</button>
      <button className="btn danger" onClick={onDelete} data-testid="button-delete-selected" aria-label="Eliminar"><Trash2 size={14} /></button>
    </div>
  </div>;
}
