import { useState } from 'react';
import { DEG2RAD, RAD2DEG } from '../core/math';
import { PRESET_CATEGORIES, type PresetCategory } from '../core/presets';
import { getNode, isEffectivelyLocked, type SceneNode } from '../core/project';
import type { EditorState, EditorStore } from '../editor/store';
import { NumberField, Section, TextField, Toggle } from './fields';

interface Props {
  store: EditorStore;
  state: EditorState;
}

export function Inspector({ store, state }: Props) {
  const project = state.history.present;
  const ids = state.selection;

  return (
    <div className="panel-body">
      {ids.length === 0 ? (
        <Section title="Project">
          <TextField label="Project name" value={project.name} onCommit={(v) => store.renameProject(v)} />
          <p className="hint">
            Click a part in the 3D view to edit it, or add something from the tools on the left.
          </p>
        </Section>
      ) : null}

      {ids.length === 1 ? <SingleInspector key={ids[0]} store={store} state={state} id={ids[0]} /> : null}

      {ids.length > 1 ? (
        <Section title={`${ids.length} parts selected`}>
          <div className="btn-row">
            <button className="btn" onClick={() => store.duplicateSelected()}>
              Duplicate
            </button>
            <button className="btn danger" onClick={() => store.deleteSelected()}>
              Delete
            </button>
            <button className="btn" onClick={() => store.groupSelected()} title="Combine the selected parts into one group">
              Group
            </button>
          </div>
        </Section>
      ) : null}

    </div>
  );
}

function SingleInspector({ store, state, id }: { store: EditorStore; state: EditorState; id: string }) {
  const project = state.history.present;
  const advanced = state.mode === 'advanced';
  const node: SceneNode = getNode(project, id);
  const locked = isEffectivelyLocked(project, id);
  const t = node.transform;

  const setPos = (axis: 0 | 1 | 2, v: number) => {
    const p: [number, number, number] = [...t.position];
    p[axis] = v;
    store.setTransform(id, { position: p });
  };
  const setRot = (axis: 0 | 1 | 2, deg: number) => {
    const r: [number, number, number] = [...t.rotation];
    r[axis] = deg * DEG2RAD;
    store.setTransform(id, { rotation: r });
  };
  const setScale = (axis: 0 | 1 | 2, v: number) => {
    const s: [number, number, number] = [...t.scale];
    s[axis] = v;
    store.setTransform(id, { scale: s });
  };

  return (
    <>
      <Section title={node.kind === 'group' ? 'Group / preset' : 'Part'}>
        <TextField label="Name" value={node.name} onCommit={(v) => store.rename(id, v)} />
        {locked ? <p className="hint warn">Locked. Unlock it to move, resize or delete.</p> : null}
        <div className="btn-row">
          <button className="btn" onClick={() => store.duplicateSelected()}>
            Duplicate
          </button>
          <button className="btn danger" onClick={() => store.deleteSelected()} disabled={locked}>
            Delete
          </button>
          {advanced && node.kind === 'group' ? (
            <button className="btn" onClick={() => store.ungroupSelected()} disabled={locked}>
              Ungroup
            </button>
          ) : null}
        </div>
        <div className="toggle-row">
          <Toggle label="Locked" checked={node.locked} onChange={(v) => store.setLocked(id, v)} />
          {advanced ? <Toggle label="Visible" checked={node.visible} onChange={(v) => store.setVisible(id, v)} /> : null}
        </div>
      </Section>

      <Section title="Position">
        <div className="grid3">
          <NumberField label="X" unit="m" value={t.position[0]} disabled={locked} onChange={(v) => setPos(0, v)} />
          {advanced ? (
            <NumberField label="Y" unit="m" value={t.position[1]} disabled={locked} onChange={(v) => setPos(1, v)} />
          ) : null}
          <NumberField label="Z" unit="m" value={t.position[2]} disabled={locked} onChange={(v) => setPos(2, v)} />
        </div>
        <div className="grid3">
          {advanced ? (
            <>
              <NumberField label="Rot X" unit="°" step={5} value={t.rotation[0] * RAD2DEG} disabled={locked} onChange={(v) => setRot(0, v)} />
              <NumberField label="Rot Y" unit="°" step={5} value={t.rotation[1] * RAD2DEG} disabled={locked} onChange={(v) => setRot(1, v)} />
              <NumberField label="Rot Z" unit="°" step={5} value={t.rotation[2] * RAD2DEG} disabled={locked} onChange={(v) => setRot(2, v)} />
            </>
          ) : (
            <NumberField label="Turn" unit="°" step={15} value={t.rotation[1] * RAD2DEG} disabled={locked} onChange={(v) => setRot(1, v)} />
          )}
        </div>
        {advanced ? (
          <div className="grid3">
            {[0, 1, 2].map((i) => (
              <NumberField
                key={i}
                label={`Scale ${'XYZ'[i]}`}
                step={0.1}
                value={t.scale[i]}
                disabled={locked}
                onChange={(v) => v !== 0 && setScale(i as 0 | 1 | 2, v)}
              />
            ))}
          </div>
        ) : null}
      </Section>

      {node.kind === 'mesh' && node.geometry ? (
        <Section title="Size">
          {node.geometry.type === 'box' ? (
            <div className="grid3">
              <NumberField label="Width" unit="m" min={0.01} value={node.geometry.width} disabled={locked}
                onChange={(v) => node.geometry?.type === 'box' && store.setGeometry(id, { ...node.geometry, width: v })} />
              <NumberField label="Height" unit="m" min={0.01} value={node.geometry.height} disabled={locked}
                onChange={(v) => node.geometry?.type === 'box' && store.setGeometry(id, { ...node.geometry, height: v })} />
              <NumberField label="Depth" unit="m" min={0.01} value={node.geometry.depth} disabled={locked}
                onChange={(v) => node.geometry?.type === 'box' && store.setGeometry(id, { ...node.geometry, depth: v })} />
            </div>
          ) : (
            <div className="grid3">
              <NumberField label="Radius" unit="m" min={0.01} value={node.geometry.radius} disabled={locked}
                onChange={(v) => node.geometry?.type === 'cylinder' && store.setGeometry(id, { ...node.geometry, radius: v })} />
              <NumberField label="Height" unit="m" min={0.01} value={node.geometry.height} disabled={locked}
                onChange={(v) => node.geometry?.type === 'cylinder' && store.setGeometry(id, { ...node.geometry, height: v })} />
            </div>
          )}
          <label className="field">
            <span>Material</span>
            <select
              value={node.materialId}
              disabled={locked}
              onChange={(e) => store.applyMaterial(e.target.value)}
              aria-label="Material"
            >
              {Object.values(project.materials).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </Section>
      ) : null}

      <SavePreset key={`p-${id}`} store={store} defaultName={node.name} />
    </>
  );
}

function SavePreset({ store, defaultName }: { store: EditorStore; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState<PresetCategory>('other');
  return (
    <Section title="Save as preset" hint="Keep this part so you can add it again anywhere, in any project.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          store.savePresetFromSelection(name, category);
        }}
      >
        <label className="field">
          <span>Preset name</span>
          <input type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as PresetCategory)} aria-label="Preset type">
            {PRESET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" type="submit">
          Save preset
        </button>
      </form>
    </Section>
  );
}
