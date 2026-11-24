import { useRef } from 'react';

interface Props {
  /** 'vertical' is a thin vertical bar (drag left/right); 'horizontal' is a thin horizontal bar (drag up/down). */
  orientation: 'vertical' | 'horizontal';
  label: string;
  className?: string;
  /** Called with the movement in pixels since the last event (x for vertical, y for horizontal). */
  onDrag(delta: number): void;
}

/** Draggable panel divider. Works with mouse, touch and the arrow keys. */
export function Splitter({ orientation, label, className = '', onDrag }: Props) {
  const last = useRef<number | null>(null);
  const vertical = orientation === 'vertical';

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      className={`splitter ${vertical ? 'splitter-v' : 'splitter-h'} ${className}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = vertical ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const now = vertical ? e.clientX : e.clientY;
        const delta = now - last.current;
        last.current = now;
        if (delta !== 0) onDrag(delta);
      }}
      onPointerUp={() => {
        last.current = null;
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (vertical && e.key === 'ArrowLeft') onDrag(-step);
        else if (vertical && e.key === 'ArrowRight') onDrag(step);
        else if (!vertical && e.key === 'ArrowUp') onDrag(-step);
        else if (!vertical && e.key === 'ArrowDown') onDrag(step);
        else return;
        e.preventDefault();
      }}
    />
  );
}
