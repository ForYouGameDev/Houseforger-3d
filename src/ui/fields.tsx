import { useId, useState, type ReactNode } from 'react';

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange(value: number): void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
}

export function NumberField({ label, value, onChange, step = 0.1, min, max, unit, disabled }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          value={draft ?? String(round(value))}
          onFocus={() => setDraft(String(round(value)))}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseFloat(e.target.value);
            if (!Number.isFinite(n)) return;
            if (min !== undefined && n < min) return;
            if (max !== undefined && n > max) return;
            onChange(n);
          }}
        />
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onCommit(value: string): void;
  disabled?: boolean;
  placeholder?: string;
}

/** Text input that only commits on Enter or blur, so half-typed names never reach the project. */
export function TextField({ label, value, onCommit, disabled, placeholder }: TextFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        maxLength={120}
        disabled={disabled}
        placeholder={placeholder}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </section>
  );
}
