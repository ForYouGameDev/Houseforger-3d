import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  label: ReactNode;
  ariaLabel?: string;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

/** A button that opens a small menu. Closes on outside click and Escape. */
export function Popover({ label, ariaLabel, children, align = 'left', className = 'btn' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="popover-wrap" ref={ref}>
      <button type="button" className={className} aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open ? (
        <div className={`popover ${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
