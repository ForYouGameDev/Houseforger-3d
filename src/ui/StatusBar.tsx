import { useState } from 'react';
import { countNodes } from '../core/project';
import type { EditorState, EditorStore } from '../editor/store';

interface Props {
  store: EditorStore;
  state: EditorState;
  autosavedAt: Date | null;
  onAddPreset(id: string): void;
}

export function StatusBar({ store, state, autosavedAt, onAddPreset }: Props) {
  const [assetsOpen, setAssetsOpen] = useState(false);
  const project = state.history.present;
  const notice = state.notice;

  return (
    <footer className="statusbar">
      {assetsOpen ? (
        <div className="assets-drawer" role="region" aria-label="Quick parts">
          {state.presets.map((p) => (
            <button key={p.id} className="chip" onClick={() => onAddPreset(p.id)} title={`Add ${p.name}`}>
              + {p.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="statusbar-row">
        <button className="btn small" aria-expanded={assetsOpen} onClick={() => setAssetsOpen((o) => !o)}>
          {assetsOpen ? 'Hide parts' : 'Quick parts'}
        </button>

        <div className="status-message" aria-live="polite">
          {notice ? (
            <span className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.text}
              <button className="link-btn" onClick={() => store.dismissNotice()} aria-label="Dismiss message">
                ✕
              </button>
            </span>
          ) : (
            <span className="muted">
              {state.selection.length === 0 ? 'Click a part to select it' : `${state.selection.length} selected`}
            </span>
          )}
        </div>

        <div className="status-right muted">
          <span>{countNodes(project)} parts</span>
          <span>{autosavedAt ? `Auto-saved ${autosavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not auto-saved yet'}</span>
        </div>
      </div>
    </footer>
  );
}
