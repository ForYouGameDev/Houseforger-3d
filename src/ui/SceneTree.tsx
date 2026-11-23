import { flattenTree, getNode } from '../core/project';
import type { EditorState, EditorStore } from '../editor/store';

export function SceneTree({ store, state }: { store: EditorStore; state: EditorState }) {
  const project = state.history.present;
  const rows = flattenTree(project);

  if (rows.length === 0) return <p className="hint">Nothing here yet.</p>;

  return (
    <ul className="tree" role="tree" aria-label="Scene hierarchy">
      {rows.map(({ id, depth }) => {
        const node = getNode(project, id);
        const selected = state.selection.includes(id);
        return (
          <li
            key={id}
            role="treeitem"
            aria-selected={selected}
            aria-level={depth + 1}
            className={`tree-row ${selected ? 'selected' : ''} ${node.visible ? '' : 'dim'}`}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <button
              className="tree-name"
              onClick={(e) => {
                const additive = e.shiftKey || e.ctrlKey || e.metaKey;
                store.select(additive ? (selected ? state.selection.filter((s) => s !== id) : [...state.selection, id]) : [id]);
              }}
            >
              <span aria-hidden="true">{node.kind === 'group' ? '▸' : '▪'}</span> {node.name}
            </button>
            <button
              className="icon-btn"
              aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
              aria-pressed={!node.visible}
              title={node.visible ? 'Hide' : 'Show'}
              onClick={() => store.setVisible(id, !node.visible)}
            >
              {node.visible ? '👁' : '—'}
            </button>
            <button
              className="icon-btn"
              aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
              aria-pressed={node.locked}
              title={node.locked ? 'Unlock' : 'Lock'}
              onClick={() => store.setLocked(id, !node.locked)}
            >
              {node.locked ? '🔒' : '🔓'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
