import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { EditorStore } from '../editor/store';
import { deleteUserPreset, loadAutosave, loadUserPresets, saveAutosave, saveUserPresets } from '../storage/db';
import { messageOf } from './actions';
import { HierarchyPanel } from './HierarchyPanel';
import { Inspector } from './Inspector';
import { ProjectPanel } from './ProjectPanel';
import { Splitter } from './Splitter';
import { StatusBar } from './StatusBar';
import { TopBar, type PanelName } from './TopBar';
import { useEditorState, useMediaQuery } from './useEditor';
import { ViewportPane, type ViewportApi } from './ViewportPane';

export default function App() {
  const [store, setStore] = useState<EditorStore | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let warning: string | null = null;
      let restoredAt: string | null = null;
      let presets: Awaited<ReturnType<typeof loadUserPresets>> = [];
      let project: Awaited<ReturnType<typeof loadAutosave>> = null;
      try {
        presets = await loadUserPresets();
        project = await loadAutosave();
        if (project) restoredAt = project.savedAt;
      } catch (e) {
        warning = `Saving on this device is not available (${messageOf(e)}). You can still save to a file.`;
      }
      const s = new EditorStore(project?.project, presets);
      if (warning) s.error(warning);
      else if (restoredAt) {
        s.info(`Restored your last session (${new Date(restoredAt).toLocaleString()})`);
      }
      if (!cancelled) setStore(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!store) {
    return (
      <div className="splash" role="status" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        Loading HomeForge 3D…
      </div>
    );
  }
  return <Editor store={store} />;
}

// ------------------------------------------------------------ panel sizes

const LIMITS = {
  left: { min: 180, max: 520, def: 260 },
  right: { min: 240, max: 560, def: 320 },
  bottom: { min: 110, max: 520, def: 210 },
} as const;
type SizeKey = keyof typeof LIMITS;

function readSize(key: SizeKey): number {
  try {
    const raw = window.localStorage.getItem(`homeforge.size.${key}`);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isFinite(n)) return Math.min(LIMITS[key].max, Math.max(LIMITS[key].min, n));
  } catch {
    /* storage can be blocked; defaults are fine */
  }
  return LIMITS[key].def;
}

function writeSize(key: SizeKey, value: number): void {
  try {
    window.localStorage.setItem(`homeforge.size.${key}`, String(Math.round(value)));
  } catch {
    /* ignore */
  }
}

function Editor({ store }: { store: EditorStore }) {
  const state = useEditorState(store);
  const narrow = useMediaQuery('(max-width: 900px)');
  const [open, setOpen] = useState<Record<PanelName, boolean>>({ hierarchy: !narrow, inspector: !narrow, project: !narrow });
  const [sizes, setSizes] = useState<Record<SizeKey, number>>(() => ({
    left: readSize('left'),
    right: readSize('right'),
    bottom: readSize('bottom'),
  }));
  const [autosavedAt, setAutosavedAt] = useState<Date | null>(null);
  const [savedMarker, setSavedMarker] = useState(store.project.updatedAt);
  const viewportApi = useRef<ViewportApi | null>(null);

  const project = state.history.present;
  const hasUnsaved = project.updatedAt !== savedMarker;

  // Panels start closed on phones so the 3D view gets the whole screen.
  const lastNarrow = useRef(narrow);
  useEffect(() => {
    if (lastNarrow.current !== narrow) {
      lastNarrow.current = narrow;
      setOpen({ hierarchy: !narrow, inspector: !narrow, project: !narrow });
    }
  }, [narrow]);

  // When a project is replaced (new / open), it counts as saved.
  const lastEpoch = useRef(state.projectEpoch);
  useEffect(() => {
    if (lastEpoch.current !== state.projectEpoch) {
      lastEpoch.current = state.projectEpoch;
      setSavedMarker(store.project.updatedAt);
    }
  }, [state.projectEpoch, store]);

  usePersistence(store, setAutosavedAt);
  useShortcuts(store, viewportApi);

  const resize = useCallback((key: SizeKey, delta: number) => {
    setSizes((prev) => {
      const next = Math.min(LIMITS[key].max, Math.max(LIMITS[key].min, prev[key] + delta));
      if (next === prev[key]) return prev;
      writeSize(key, next);
      return { ...prev, [key]: next };
    });
  }, []);

  const togglePanel = (name: PanelName) => {
    setOpen((prev) => {
      const willOpen = !prev[name];
      // On a phone the panels cover the 3D view, so only one can be open at a time.
      if (narrow && willOpen) return { hierarchy: false, inspector: false, project: false, [name]: true };
      return { ...prev, [name]: willOpen };
    });
  };

  const overlayOpen = narrow && (open.hierarchy || open.inspector || open.project);

  const layout = {
    '--left-w': `${open.hierarchy && !narrow ? sizes.left : 0}px`,
    '--right-w': `${open.inspector && !narrow ? sizes.right : 0}px`,
    '--bottom-h': `${open.project && !narrow ? sizes.bottom : 0}px`,
    '--sheet-h': `${Math.min(sizes.bottom + 120, 420)}px`,
  } as CSSProperties;

  return (
    <div
      className={[
        'app',
        `mode-${state.mode}`,
        open.hierarchy && !narrow ? 'has-left' : '',
        open.inspector && !narrow ? 'has-right' : '',
        open.project && !narrow ? 'has-bottom' : '',
      ].join(' ')}
      style={layout}
    >
      <TopBar store={store} state={state} open={open} onTogglePanel={togglePanel} hasUnsaved={hasUnsaved} onSavedMark={() => setSavedMarker(store.project.updatedAt)} />

      <div className="workspace">
        <aside className="panel area-hier" aria-label="Hierarchy" hidden={!open.hierarchy}>
          <HierarchyPanel store={store} state={state} viewportApi={viewportApi} />
        </aside>

        {open.hierarchy && !narrow ? (
          <Splitter orientation="vertical" label="Resize hierarchy panel" className="area-split-l" onDrag={(d) => resize('left', d)} />
        ) : null}

        <main className="center area-scene">
          <ViewportPane store={store} state={state} apiRef={viewportApi} />
          {overlayOpen ? (
            <button
              className="scrim"
              aria-label="Close panel"
              onClick={() => setOpen({ hierarchy: false, inspector: false, project: false })}
            />
          ) : null}
        </main>

        {open.project && !narrow ? (
          <Splitter orientation="horizontal" label="Resize project panel" className="area-split-b" onDrag={(d) => resize('bottom', -d)} />
        ) : null}

        <section className="panel area-proj" aria-label="Project" hidden={!open.project}>
          <ProjectPanel store={store} state={state} viewportApi={viewportApi} />
        </section>

        {open.inspector && !narrow ? (
          <Splitter orientation="vertical" label="Resize inspector panel" className="area-split-r" onDrag={(d) => resize('right', -d)} />
        ) : null}

        <aside className="panel area-insp" aria-label="Inspector" hidden={!open.inspector}>
          <div className="panel-header">
            <span className="panel-title">Inspector</span>
          </div>
          <div className="panel-scroll">
            <Inspector store={store} state={state} />
          </div>
        </aside>
      </div>

      <StatusBar store={store} state={state} autosavedAt={autosavedAt} />
    </div>
  );
}

/** Debounced autosave of the project, and persistence of the user's preset library. */
function usePersistence(store: EditorStore, onAutosaved: (d: Date) => void): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastProject = store.project;
    let lastPresets = store.userPresets();
    let warned = false;
    let pendingProject = false;

    const reportOnce = (what: string, e: unknown) => {
      if (warned) return;
      warned = true;
      store.error(`${what}: ${messageOf(e)}`);
    };

    const flush = () => {
      if (!pendingProject) return;
      pendingProject = false;
      saveAutosave(store.project)
        .then(() => onAutosaved(new Date()))
        .catch((e: unknown) => reportOnce('Auto-save is not working', e));
    };

    const unsubscribe = store.subscribe(() => {
      const p = store.project;
      if (p !== lastProject) {
        lastProject = p;
        pendingProject = true;
        clearTimeout(timer);
        timer = setTimeout(flush, 700);
      }
      const mine = store.userPresets();
      if (mine !== lastPresets && !(mine.length === lastPresets.length && mine.every((m, i) => m === lastPresets[i]))) {
        const removed = lastPresets.filter((o) => !mine.some((m) => m.id === o.id));
        lastPresets = mine;
        void Promise.all([saveUserPresets(mine), ...removed.map((r) => deleteUserPreset(r.id))]).catch((e: unknown) =>
          reportOnce('Your presets could not be saved on this device', e),
        );
      }
    });

    // Write immediately when the page is hidden or closed so nothing is lost.
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer);
        flush();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);

    return () => {
      unsubscribe();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [store, onAutosaved]);
}

function useShortcuts(store: EditorStore, viewportApi: MutableRefObject<ViewportApi | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        store.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        store.duplicateSelected();
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        store.deleteSelected();
      } else if (!mod && key === 'f') {
        viewportApi.current?.frame();
      } else if (!mod && key === 'q') {
        store.setTool('hand');
      } else if (!mod && key === 'w') {
        store.setTool('move');
      } else if (!mod && key === 'e') {
        store.setTool('rotate');
      } else if (!mod && key === 'r') {
        store.setTool('scale');
      } else if (!mod && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        viewportApi.current?.zoomBy(0.8);
      } else if (!mod && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        viewportApi.current?.zoomBy(1.25);
      } else if (e.key === 'Escape') {
        store.select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, viewportApi]);
}
