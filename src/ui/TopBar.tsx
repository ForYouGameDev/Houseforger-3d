import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canRedo, canUndo } from '../core/history';
import type { EditorState, EditorStore } from '../editor/store';
import { listProjects, loadProject, type ProjectSummary } from '../storage/db';
import { messageOf, openProjectFromFile, saveProjectInBrowser, saveProjectToFile } from './actions';
import { Toggle } from './fields';

interface Props {
  store: EditorStore;
  state: EditorState;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft(): void;
  onToggleRight(): void;
  /** True when the current project has changes that were not saved by the user. */
  hasUnsaved: boolean;
  onSavedMark(): void;
}

function Popover({ label, children, align = 'left' }: { label: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
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
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
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

export function TopBar({ store, state, leftOpen, rightOpen, onToggleLeft, onToggleRight, hasUnsaved, onSavedMark }: Props) {
  const project = state.history.present;
  const [recent, setRecent] = useState<ProjectSummary[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);

  const refreshRecent = () => {
    setRecentError(null);
    listProjects()
      .then((list) => setRecent(list.slice(0, 8)))
      .catch((e: unknown) => {
        setRecent([]);
        setRecentError(messageOf(e));
      });
  };

  const confirmDiscard = (): boolean =>
    !hasUnsaved || window.confirm('You have changes that are not saved to a file or to this device. Continue and replace the current project?');

  return (
    <header className="topbar">
      <button
        className={`btn icon ${leftOpen ? 'active' : ''}`}
        aria-pressed={leftOpen}
        aria-label="Tools panel"
        title="Show or hide the tools panel"
        onClick={onToggleLeft}
      >
        ☰<span className="label"> Tools</span>
      </button>

      <Popover
        label="File"
      >
        {(close) => (
          <>
            <button
              role="menuitem"
              onClick={() => {
                close();
                if (confirmDiscard()) store.newProject();
              }}
            >
              New project
            </button>
            <button
              role="menuitem"
              onClick={() => {
                close();
                if (confirmDiscard()) void openProjectFromFile(store);
              }}
            >
              Open from file…
            </button>
            <button
              role="menuitem"
              onClick={() => {
                close();
                void saveProjectInBrowser(store).then((ok) => ok && onSavedMark());
              }}
            >
              Save on this device
            </button>
            <button
              role="menuitem"
              onClick={() => {
                close();
                void saveProjectToFile(store).then(() => onSavedMark());
              }}
            >
              Save to file…
            </button>
            <hr />
            <div className="menu-heading">
              Saved on this device{' '}
              <button className="link-btn" onClick={refreshRecent}>
                {recent === null ? 'Show' : 'Refresh'}
              </button>
            </div>
            {recent === null ? null : recent.length === 0 ? (
              <div className="menu-note">{recentError ?? 'Nothing saved yet.'}</div>
            ) : (
              recent.map((r) => (
                <button
                  key={r.id}
                  role="menuitem"
                  onClick={() => {
                    close();
                    if (!confirmDiscard()) return;
                    loadProject(r.id)
                      .then((p) => {
                        if (p) {
                          store.loadProject(p);
                          store.info(`Opened "${p.name}"`);
                          onSavedMark();
                        } else store.error('That project could not be found');
                      })
                      .catch((e: unknown) => store.error(`Could not open: ${messageOf(e)}`));
                  }}
                >
                  {r.name}
                </button>
              ))
            )}
          </>
        )}
      </Popover>

      <div className="topbar-title">
        <label className="sr-only" htmlFor="project-name">
          Project name
        </label>
        <input
          id="project-name"
          className="title-input"
          key={project.id + project.name}
          defaultValue={project.name}
          maxLength={120}
          onBlur={(e) => {
            if (e.target.value.trim() !== project.name) store.renameProject(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {hasUnsaved ? <span className="dot" title="Not saved to a file or to this device yet" aria-label="Unsaved changes" /> : null}
      </div>

      <div className="btn-group" role="group" aria-label="History">
        <button className="btn icon" onClick={store.undo} disabled={!canUndo(state.history)} aria-label="Undo" title="Undo (Ctrl+Z)">
          ↶<span className="label"> Undo</span>
        </button>
        <button className="btn icon" onClick={store.redo} disabled={!canRedo(state.history)} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          ↷<span className="label"> Redo</span>
        </button>
      </div>

      <div className="mode-switch" role="group" aria-label="Mode">
        <button
          className={state.mode === 'easy' ? 'active' : ''}
          aria-pressed={state.mode === 'easy'}
          onClick={() => store.setMode('easy')}
          title="Simple tools for beginners"
        >
          Easy
        </button>
        <button
          className={state.mode === 'advanced' ? 'active' : ''}
          aria-pressed={state.mode === 'advanced'}
          onClick={() => store.setMode('advanced')}
          title="Full transforms, hierarchy, visibility"
        >
          Advanced
        </button>
      </div>

      <Popover label="⚙" align="right">
        {() => (
          <div className="menu-form">
            <div className="menu-heading">Settings</div>
            <Toggle label="Show grid and axes" checked={state.settings.showGrid} onChange={(v) => store.setSettings({ showGrid: v })} />
            <Toggle
              label="Flat (orthographic) camera"
              checked={state.settings.orthographic}
              onChange={(v) => store.setSettings({ orthographic: v })}
            />
            <div className="menu-note">HomeForge 3D 0.1.0 · works offline · units are metres</div>
          </div>
        )}
      </Popover>

      <button
        className={`btn icon ${rightOpen ? 'active' : ''}`}
        aria-pressed={rightOpen}
        aria-label="Properties panel"
        title="Show or hide the properties panel"
        onClick={onToggleRight}
      >
        <span className="label">Properties </span>▤
      </button>
    </header>
  );
}
