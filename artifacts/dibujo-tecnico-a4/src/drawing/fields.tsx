import { useState } from 'react';

/** Acepta coma o punto decimal; cadena vacía = NaN. */
export function toNum(value: string): number {
  const text = String(value).trim().replace(',', '.');
  return text === '' ? NaN : Number(text);
}

/** Texto para mostrar un número (máx. `decimals` decimales, sin ceros sobrantes). Solo visual: no altera el valor guardado. */
export function fmtNum(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) return '';
  const fixed = value.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

const inputProps = { type: 'text', inputMode: 'decimal' as const, autoComplete: 'off', spellCheck: false };

/** Campo de texto numérico controlado por una cadena (valores de construcción todavía sin crear). */
export function NumField({ label, value, onChange, unit, testid }: {
  label: string; value: string; onChange: (value: string) => void; unit?: string; testid?: string;
}) {
  const invalid = value.trim() !== '' && !Number.isFinite(toNum(value));
  return <label className="field">
    <span className="field-label">{label}{unit && <em>{unit}</em>}</span>
    <input {...inputProps} className={`number-input ${invalid ? 'invalid' : ''}`} value={value} onChange={event => onChange(event.target.value)} data-testid={testid} />
  </label>;
}

/**
 * Campo ligado a un número EXACTO. Muestra el valor redondeado para leerlo, pero solo lo sustituye
 * cuando el usuario escribe algo: enfocar y salir sin escribir no cambia el valor guardado.
 * Mientras se edita, el texto escrito no se reformatea. Confirma al pulsar Intro o al salir del campo;
 * si `validate` devuelve un mensaje, no se confirma: se muestra el error y se recupera el valor guardado.
 */
export function ExactField({ label, value, onCommit, unit, testid, decimals = 3, validate, inputClassName = 'number-input', bare = false }: {
  label: string; value: number; onCommit: (value: number) => void; unit?: string; testid?: string; decimals?: number;
  validate?: (value: number) => string | null; inputClassName?: string; bare?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = text ?? fmtNum(value, decimals);
  const parsed = text === null ? value : toNum(text);
  const invalid = text !== null && text.trim() !== '' && (!Number.isFinite(parsed) || !!validate?.(parsed));
  const finish = () => {
    if (text !== null) {
      const v = toNum(text);
      const problem = !Number.isFinite(v) ? 'Escribe un número (se admite coma o punto decimal).' : validate?.(v) ?? null;
      if (problem) setError(problem);
      else { setError(null); onCommit(v); }
    }
    setText(null);
  };
  const input = <input
    type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
    className={`${inputClassName} ${invalid ? 'invalid' : ''}`} value={shown}
    onChange={event => { setText(event.target.value); setError(null); }}
    onBlur={finish}
    onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') { setText(null); setError(null); (event.target as HTMLInputElement).blur(); } }}
    data-testid={testid}
  />;
  const errorLine = error && <span className="field-error" data-testid={testid ? `${testid}-error` : undefined}>{error}</span>;
  if (bare) return <>{label}{input}{errorLine}</>;
  return <label className="field">
    <span className="field-label">{label}{unit && <em>{unit}</em>}</span>
    {input}
    {errorLine}
  </label>;
}

export function Seg<T extends string>({ value, options, onChange, testid }: { value: T; options: { value: NoInfer<T>; label: string }[]; onChange: (value: NoInfer<T>) => void; testid?: string }) {
  return <div className="seg" role="group" data-testid={testid}>
    {options.map(option => <button key={option.value} type="button" className={value === option.value ? 'on' : ''} onClick={() => onChange(option.value)} data-testid={testid ? `${testid}-${option.value}` : undefined}>{option.label}</button>)}
  </div>;
}

export function Toggle({ checked, onChange, label, testid }: { checked: boolean; onChange: (value: boolean) => void; label: string; testid?: string }) {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} data-testid={testid} /><span>{label}</span></label>;
}
