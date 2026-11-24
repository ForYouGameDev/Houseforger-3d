import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Id } from '../core/ids';
import { getNode, isAncestor, type Project } from '../core/project';
import type { EditorState, EditorStore } from '../editor/store';

type DropZone = 'before' | 'into' | 'after';

interface Row {
  id: Id;
  depth: number;
}

function visibleRows(p: Project, collapsed: Set<Id>): Row[] {
  const out: Row[] = [];
  const walk = (id: Id, depth: number) => {
    for (const childId of getNode(p, id).children) {
      out.push({ id: childId, depth });
      if (!collapsed.has(childId)) walk(childId, depth + 1);
    }
  };
  walk(p.rootId, 0);
  return out;
}

/** Unity-style hierarchy: collapse, rename on double-click, drag and drop to re-parent. */
export function SceneTree({ store, state }: { store: EditorStore; state: EditorState }) {
  const project = state.history.present;
  const [collapsed, setCollapsed] = useState<Set<Id>>(() => new Set());
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [dragId, setDragId] = useState<Id | null>(null);
  const [hint, setHint] = useState<{ id: Id; zone: DropZone } | null>(null);
  const lastSelection = useRef<Id[]>([]);

  // Selecting something inside a collapsed group (for example by clicking it in 3D) opens the group.
  useEffect(() => {
    if (lastSelection.current === state.selection) return;
    lastSelection.current = state.selection;
    setCollapsed((prev) => {
      let next: Set<Id> | null = null;
      for (const id of state.selection) {
        let cur = project.nodes[id]?.parentId ?? null;
        while (cur !== null) {
          if (prev.has(cur)) {
            next = next ?? new Set(prev);
            next.delete(cur);
          }
          cur = project.nodes[cur]?.parentId ?? null;
        }
      }
      return next ?? prev;
    });
  }, [state.selection, project]);

  const rows = visibleRows(project, collapsed);

  const zoneFor = (e: DragEvent<HTMLElement>, id: Id): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    const isGroup = getNode(project, id).kind === 'group';
    if (isGroup && y > 0.28 && y < 0.72) return 'into';
    return y < 0.5 ? 'before' : 'after';
  };

  const drop = (targetId: Id, zone: DropZone) => {
    if (!dragId || dragId === targetId) return;
    if (zone === 'into') {
      store.reparent(dragId, targetId);
      return;
    }
    const target = getNode(project, targetId);
    const parentId = target.parentId;
    if (parentId === null) return;
    if (isAncestor(project, dragId, targetId)) return; // cannot drop onto its own child
    const siblings = getNode(project, parentId).children;
    let index = siblings.indexOf(targetId) + (zone === 'after' ? 1 : 0);
    const from = siblings.indexOf(dragId);
    if (from !== -1 && from < index) index -= 1;
    store.reparent(dragId, parentId, index);
  };

  const rootDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (dragId) store.reparent(dragId, project.rootId);
    setDragId(null);
    setHint(null);
  };

  return (
    <div className="tree-wrap">
      <div
        className={`tree-root ${hint?.id === project.rootId ? 'drop-into' : ''}`}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          setHint({ id: project.rootId, zone: 'into' });
        }}
        onDragLeave={() => setHint(null)}
        onDrop={rootDrop}
        title="Drop here to move a part out of its group"
      >
        <span aria-hidden="true">🏠</span> {project.name}
      </div>

      {rows.length === 0 ? (
        <p className="hint pad">Nothing here yet. Use + above or the Project panel below to add parts.</p>
      ) : (
        <ul className="tree" role="tree" aria-label="Scene hierarchy">
          {rows.map(({ id, depth }) => {
            const node = getNode(project, id);
            const selected = state.selection.includes(id);
            const isGroup = node.kind === 'group';
            const open = !collapsed.has(id);
            const showHint = hint?.id === id ? hint.zone : null;
            return (
              <li
                key={id}
                role="treeitem"
                aria-selected={selected}
                aria-level={depth + 1}
                aria-expanded={isGroup ? open : undefined}
                className={[
                  'tree-row',
                  selected ? 'selected' : '',
                  node.visible ? '' : 'dim',
                  dragId === id ? 'dragging' : '',
                  showHint ? `drop-${showHint}` : '',
                ].join(' ')}
                style={{ paddingLeft: 4 + depth * 14 }}
                draggable={renaming !== id && !node.locked}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', id);
                  setDragId(id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setHint(null);
                }}
                onDragOver={(e) => {
                  if (!dragId || dragId === id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const zone = zoneFor(e, id);
                  if (hint?.id !== id || hint.zone !== zone) setHint({ id, zone });
                }}
                onDragLeave={() => setHint((h) => (h?.id === id ? null : h))}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  drop(id, zoneFor(e, id));
                  setDragId(null);
                  setHint(null);
                }}
              >
                {isGroup ? (
                  <button
                    type="button"
                    className="twisty"
                    aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  >
                    {open ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="twisty spacer-box" aria-hidden="true" />
                )}

                {renaming === id ? (
                  <input
                    className="tree-rename"
                    autoFocus
                    defaultValue={node.name}
                    maxLength={120}
                    aria-label={`Rename ${node.name}`}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                      const v = e.currentTarget.value;
                      setRenaming(null);
                      if (v.trim() !== node.name) store.rename(id, v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') {
                        e.currentTarget.value = node.name;
                        e.currentTarget.blur();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="tree-name"
                    title="Click to select, double-click to rename"
                    onClick={(e) => {
                      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
                      store.select(additive ? (selected ? state.selection.filter((s) => s !== id) : [...state.selection, id]) : [id]);
                    }}
                    onDoubleClick={() => !node.locked && setRenaming(id)}
                  >
                    <span aria-hidden="true" className="node-icon">
                      {isGroup ? '📁' : '▣'}
                    </span>{' '}
                    {node.name}
                  </button>
                )}

                <button
                  type="button"
                  className="icon-btn"
                  aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
                  aria-pressed={!node.visible}
                  title={node.visible ? 'Hide' : 'Show'}
                  onClick={() => store.setVisible(id, !node.visible)}
                >
                  {node.visible ? '👁' : '·'}
                </button>
                <button
                  type="button"
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
      )}
    </div>
  );
}
