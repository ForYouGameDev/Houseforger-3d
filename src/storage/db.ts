// Offline-first browser storage on top of IndexedDB. The same code serves the
// website, the PWA, Electron (renderer) and the Capacitor WebView.

import { parseProject, serializeProject, type Project } from '../core/project';
import type { Preset } from '../core/presets';

const DB_NAME = 'homeforge3d';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_PRESETS = 'presets';
const STORE_META = 'meta';

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('Browser storage is not available here. Projects can still be saved to a file.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_PRESETS)) db.createObjectStore(STORE_PRESETS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(new StorageError(`Could not open storage: ${req.error?.message ?? 'unknown error'}`));
    req.onblocked = () => reject(new StorageError('Storage is blocked by another open HomeForge window'));
  }).catch((e: unknown) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StorageError(req.error?.message ?? 'Storage request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new StorageError(tx.error?.message ?? 'Storage write failed'));
    tx.onabort = () => reject(new StorageError(tx.error?.message ?? 'Storage write was cancelled (disk full?)'));
  });
}

// ----------------------------------------------------------------- projects

interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  /** Serialized project JSON; re-validated on load. */
  data: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export async function saveProject(p: Project): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  const rec: ProjectRecord = { id: p.id, name: p.name, updatedAt: p.updatedAt, data: serializeProject(p) };
  tx.objectStore(STORE_PROJECTS).put(rec);
  await txDone(tx);
}

export async function loadProject(id: string): Promise<Project | null> {
  const db = await openDb();
  const rec = (await wrap(db.transaction(STORE_PROJECTS).objectStore(STORE_PROJECTS).get(id))) as ProjectRecord | undefined;
  return rec ? parseProject(rec.data) : null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDb();
  const all = (await wrap(db.transaction(STORE_PROJECTS).objectStore(STORE_PROJECTS).getAll())) as ProjectRecord[];
  return all
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  tx.objectStore(STORE_PROJECTS).delete(id);
  await txDone(tx);
}

// ----------------------------------------------------------------- autosave

interface AutosaveRecord {
  key: 'autosave';
  savedAt: string;
  data: string;
}

export async function saveAutosave(p: Project): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readwrite');
  const rec: AutosaveRecord = { key: 'autosave', savedAt: new Date().toISOString(), data: serializeProject(p) };
  tx.objectStore(STORE_META).put(rec);
  await txDone(tx);
}

/** Returns the last autosaved project, or null if none exists or it is unreadable. */
export async function loadAutosave(): Promise<{ project: Project; savedAt: string } | null> {
  const db = await openDb();
  const rec = (await wrap(db.transaction(STORE_META).objectStore(STORE_META).get('autosave'))) as AutosaveRecord | undefined;
  if (!rec) return null;
  try {
    return { project: parseProject(rec.data), savedAt: rec.savedAt };
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).delete('autosave');
  await txDone(tx);
}

// ------------------------------------------------------------ preset library
// Only user presets are stored; built-in presets ship with the app.

export async function loadUserPresets(): Promise<Preset[]> {
  const db = await openDb();
  return (await wrap(db.transaction(STORE_PRESETS).objectStore(STORE_PRESETS).getAll())) as Preset[];
}

export async function saveUserPreset(preset: Preset): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PRESETS, 'readwrite');
  const { builtIn: _builtIn, ...rest } = preset;
  void _builtIn;
  tx.objectStore(STORE_PRESETS).put(rest);
  await txDone(tx);
}

export async function saveUserPresets(presets: Preset[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PRESETS, 'readwrite');
  const store = tx.objectStore(STORE_PRESETS);
  for (const preset of presets) {
    const { builtIn: _builtIn, ...rest } = preset;
    void _builtIn;
    store.put(rest);
  }
  await txDone(tx);
}

export async function deleteUserPreset(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PRESETS, 'readwrite');
  tx.objectStore(STORE_PRESETS).delete(id);
  await txDone(tx);
}
