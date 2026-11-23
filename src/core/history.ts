// Bounded undo/redo over immutable snapshots. Because the project model is
// immutable (structural sharing), keeping snapshots is cheap.

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  readonly limit: number;
  /** Key of the last commit, used to merge continuous edits (e.g. a slider drag). */
  readonly lastKey: string | null;
}

export function createHistory<T>(initial: T, limit = 100): History<T> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('History limit must be a positive integer');
  return { past: [], present: initial, future: [], limit, lastKey: null };
}

/**
 * Record a new present state. If `coalesceKey` equals the previous commit's key,
 * the previous undo point is kept and only the present is replaced, so a whole
 * drag becomes a single undo step.
 */
export function commit<T>(h: History<T>, next: T, coalesceKey: string | null = null): History<T> {
  if (Object.is(next, h.present)) return h;
  if (coalesceKey !== null && coalesceKey === h.lastKey && h.past.length > 0) {
    return { ...h, present: next, future: [] };
  }
  const past = [...h.past, h.present];
  const trimmed = past.length > h.limit ? past.slice(past.length - h.limit) : past;
  return { ...h, past: trimmed, present: next, future: [], lastKey: coalesceKey };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return {
    ...h,
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    lastKey: null,
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return {
    ...h,
    past: [...h.past, h.present],
    present: next,
    future: rest,
    lastKey: null,
  };
}

/** Replace the whole history with a fresh one (used when opening a project). */
export function reset<T>(h: History<T>, initial: T): History<T> {
  return createHistory(initial, h.limit);
}
