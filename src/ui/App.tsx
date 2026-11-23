import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { EditorStore } from '../editor/store';
import { deleteUserPreset, loadAutosave, loadUserPresets, saveAutosave, saveUserPresets } from '../storage/db';
import { messageOf } from './actions';
import { Inspector } from './Inspector';
import { StatusBar } from './StatusBar';
import { ToolPanel } from './ToolPanel';
import { TopBar } from './TopBar';
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

function Editor({ store }: { store: EditorStore }) {
  const state = useEditorState(store);
  const narrow = useMediaQuery('(max-width: 900px)');
  const [leftOpen, setLeftOpen] = useState(!narrow);
  const [rightOpen, setRightOpen] = useState(!narrow);
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
      setLeftOpen(!narrow);
      setRightOpen(!narrow);
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

  const addPreset = useCallback(
    (id: string) => store.addPreset(id, viewportApi.current?.getGroundTarget() ?? [0, 0, 0]),
    [store],
  );

  // On phones the side panels overlay the view; tapping the dimmed area closes them.
  const overlayOpen = narrow && (leftOpen || rightOpen);

  return (
    <div className={`app mode-${state.mode} ${leftOpen ? 'left-open' : ''} ${rightOpen ? 'right-open' : ''}`}>
      <TopBar
        store={store}
        state={state}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => {
          setLeftOpen((o) => !o);
          if (narrow) setRightOpen(false);
        }}
        onToggleRight={() => {
          setRightOpen((o) => !o);
          if (narrow) setLeftOpen(false);
        }}
        hasUnsaved={hasUnsaved}
        onSavedMark={() => setSavedMarker(store.project.updatedAt)}
      />

      <aside className="panel panel-left" aria-label="Tools" hidden={!leftOpen}>
        <ToolPanel store={store} state={state} viewportApi={viewportApi} />
      </aside>

      <main className="center">
        <ViewportPane store={store} state={state} apiRef={viewportApi} />
        {overlayOpen ? (
          <button
            className="scrim"
            aria-label="Close panel"
            onClick={() => {
              setLeftOpen(false);
              setRightOpen(false);
            }}
          />
        ) : null}
      </main>

      <aside className="panel panel-right" aria-label="Properties" hidden={!rightOpen}>
        <Inspector store={store} state={state} />
      </aside>

      <StatusBar store={store} state={state} autosavedAt={autosavedAt} onAddPreset={addPreset} />
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
      } else if (e.key === 'Escape') {
        store.select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, viewportApi]);
}
