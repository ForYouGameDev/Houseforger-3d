import { useState } from 'react';
import { canRedo, canUndo } from '../core/history';
import type { EditorState, EditorStore } from '../editor/store';
import { listProjects, loadProject, type ProjectSummary } from '../storage/db';
import { messageOf, openProjectFromFile, saveProjectInBrowser, saveProjectToFile } from './actions';
import { Toggle } from './fields';
import { Popover } from './Popover';

export type PanelName = 'hierarchy' | 'inspector' | 'project';

interface Props {
  store: EditorStore;
  state: EditorState;
  open: Record<PanelName, boolean>;
  onTogglePanel(name: PanelName): void;
  /** True when the current project has changes that were not saved by the user. */
  hasUnsaved: boolean;
  onSavedMark(): void;
}

const PANELS: { id: PanelName; label: string; icon: string }[] = [
  { id: 'hierarchy', label: 'Hierarchy', icon: '☰' },
  { id: 'project', label: 'Project', icon: '▤' },
  { id: 'inspector', label: 'Inspector', icon: 'ⓘ' },
];

export function TopBar({ store, state, open, onTogglePanel, hasUnsaved, onSavedMark }: Props) {
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
      <Popover label="File">
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

      <div className="btn-group" role="group" aria-label="History">
        <button className="btn" onClick={store.undo} disabled={!canUndo(state.history)} aria-label="Undo" title="Undo (Ctrl+Z)">
          ↶<span className="label"> Undo</span>
        </button>
        <button className="btn" onClick={store.redo} disabled={!canRedo(state.history)} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          ↷<span className="label"> Redo</span>
        </button>
      </div>

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

      <div className="btn-group panel-toggles" role="group" aria-label="Panels">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`btn ${open[p.id] ? 'active' : ''}`}
            aria-pressed={open[p.id]}
            title={`Show or hide the ${p.label} panel`}
            onClick={() => onTogglePanel(p.id)}
          >
            <span aria-hidden="true">{p.icon}</span>
            <span className="label"> {p.label}</span>
          </button>
        ))}
      </div>

      <div className="mode-switch" role="group" aria-label="Mode">
        <button
          className={state.mode === 'easy' ? 'active' : ''}
          aria-pressed={state.mode === 'easy'}
          onClick={() => store.setMode('easy')}
          title="Simple tools for beginners; clicking selects a whole door, wall or window"
        >
          Easy
        </button>
        <button
          className={state.mode === 'advanced' ? 'active' : ''}
          aria-pressed={state.mode === 'advanced'}
          onClick={() => store.setMode('advanced')}
          title="Full transforms; clicking selects single parts"
        >
          Advanced
        </button>
      </div>

      <Popover label="⚙" ariaLabel="Settings" align="right">
        {() => (
          <div className="menu-form">
            <div className="menu-heading">Settings</div>
            <Toggle label="Show grid and axes" checked={state.settings.showGrid} onChange={(v) => store.setSettings({ showGrid: v })} />
            <Toggle label="Flat (orthographic) camera" checked={state.settings.orthographic} onChange={(v) => store.setSettings({ orthographic: v })} />
            <Toggle label="Snap move / rotate / scale" checked={state.settings.snap} onChange={(v) => store.setSettings({ snap: v })} />
            <div className="menu-note">
              Keys: Q hand, W move, E rotate, R scale, F frame, + / − zoom, Del delete, Ctrl+D duplicate.
              <br />
              Mouse: left drag orbit, right drag pan, wheel zoom.
            </div>
            <div className="menu-note">HomeForge 3D 0.2.0 · works offline · units are metres</div>
          </div>
        )}
      </Popover>
    </header>
  );
}
