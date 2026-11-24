import { countNodes } from '../core/project';
import type { EditorState, EditorStore } from '../editor/store';

interface Props {
  store: EditorStore;
  state: EditorState;
  autosavedAt: Date | null;
}

export function StatusBar({ store, state, autosavedAt }: Props) {
  const project = state.history.present;
  const notice = state.notice;

  return (
    <footer className="statusbar">
      <div className="statusbar-row">
        <div className="status-message" aria-live="polite">
          {notice ? (
            <span className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.text}
              <button className="link-btn" onClick={() => store.dismissNotice()} aria-label="Dismiss message">
                ✕
              </button>
            </span>
          ) : (
            <span className="muted">{state.selection.length === 0 ? 'Click a part to select it' : `${state.selection.length} selected`}</span>
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
