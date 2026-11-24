import type { MutableRefObject } from 'react';
import type { Vec3 } from '../core/project';
import type { EditorState, EditorStore } from '../editor/store';
import { Popover } from './Popover';
import { SceneTree } from './SceneTree';
import type { ViewportApi } from './ViewportPane';

interface Props {
  store: EditorStore;
  state: EditorState;
  viewportApi: MutableRefObject<ViewportApi | null>;
}

export function HierarchyPanel({ store, state, viewportApi }: Props) {
  const where = (): Vec3 => viewportApi.current?.getGroundTarget() ?? [0, 0, 0];
  const hasSelection = state.selection.length > 0;

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Hierarchy</span>
        <span className="spacer" />
        <Popover label="+" ariaLabel="Create new" className="btn icon-sm" align="right">
          {(close) => (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  close();
                  store.addPrimitive('box', where());
                }}
              >
                Box
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  close();
                  store.addPrimitive('cylinder', where());
                }}
              >
                Cylinder
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  close();
                  store.addEmptyGroup();
                }}
              >
                Empty group
              </button>
            </>
          )}
        </Popover>
      </div>

      <div className="panel-toolbar">
        <button className="btn small" onClick={() => store.groupSelected()} disabled={!hasSelection} title="Put the selected parts into a new group">
          Group
        </button>
        <button className="btn small" onClick={() => store.ungroupSelected()} disabled={!hasSelection} title="Release the parts inside the selected group">
          Ungroup
        </button>
        <button className="btn small" onClick={() => store.duplicateSelected()} disabled={!hasSelection} title="Duplicate (Ctrl+D)">
          Duplicate
        </button>
        <button className="btn small danger" onClick={() => store.deleteSelected()} disabled={!hasSelection} title="Delete (Del)">
          Delete
        </button>
      </div>

      <div className="panel-scroll">
        <SceneTree store={store} state={state} />
      </div>
    </>
  );
}
