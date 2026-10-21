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
 * Confirma al pulsar Intro o al salir del campo.
 */
export function ExactField({ label, value, onCommit, unit, testid, decimals = 3 }: {
  label: string; value: number; onCommit: (value: number) => void; unit?: string; testid?: string; decimals?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? fmtNum(value, decimals);
  const invalid = text !== null && text.trim() !== '' && !Number.isFinite(toNum(text));
  const finish = () => {
    if (text !== null) {
      const v = toNum(text);
      if (Number.isFinite(v)) onCommit(v);
    }
    setText(null);
  };
  return <label className="field">
    <span className="field-label">{label}{unit && <em>{unit}</em>}</span>
    <input
      {...inputProps} className={`number-input ${invalid ? 'invalid' : ''}`} value={shown}
      onChange={event => setText(event.target.value)}
      onBlur={finish}
      onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') { setText(null); (event.target as HTMLInputElement).blur(); } }}
      data-testid={testid}
    />
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
