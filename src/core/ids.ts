export type Id = string;

let counter = 0;

/** Short, collision-resistant id. Prefix is only for readability while debugging. */
export function newId(prefix = 'n'): Id {
  counter += 1;
  let rand: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  } else {
    rand = Math.random().toString(36).slice(2, 12);
  }
  return `${prefix}_${rand}${counter.toString(36)}`;
}
