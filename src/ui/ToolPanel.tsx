import { useState, type MutableRefObject } from 'react';
import { PRESET_CATEGORIES, type Preset } from '../core/presets';
import type { Vec3 } from '../core/project';
import type { EditorState, EditorStore } from '../editor/store';
import { exportMyPresets, importPresetsFromFile, openProjectFromFile, saveProjectToFile } from './actions';
import { Section } from './fields';
import type { ViewportApi } from './ViewportPane';

type Tab = 'create' | 'house' | 'materials' | 'import' | 'export';

const TABS: { id: Tab; label: string }[] = [
  { id: 'create', label: 'Create' },
  { id: 'house', label: 'House Builder' },
  { id: 'materials', label: 'Materials' },
  { id: 'import', label: 'Import' },
  { id: 'export', label: 'Export' },
];

interface Props {
  store: EditorStore;
  state: EditorState;
  viewportApi: MutableRefObject<ViewportApi | null>;
}

export function ToolPanel({ store, state, viewportApi }: Props) {
  const [tab, setTab] = useState<Tab>('house');
  const where = (): Vec3 => viewportApi.current?.getGroundTarget() ?? [0, 0, 0];

  return (
    <div className="panel-body">
      <div className="tabs" role="tablist" aria-label="Tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'create' ? (
          <Section title="Basic shapes" hint="New shapes appear where the camera is looking.">
            <div className="btn-grid">
              <button className="btn big" onClick={() => store.addPrimitive('box', where())}>
                ▭ Box
              </button>
              <button className="btn big" onClick={() => store.addPrimitive('cylinder', where())}>
                ◯ Cylinder
              </button>
            </div>
            <p className="hint">Resize and move them on the right. Use House Builder for ready-made walls, doors and windows.</p>
          </Section>
        ) : null}

        {tab === 'house' ? <HouseBuilder store={store} state={state} where={where} /> : null}
        {tab === 'materials' ? <Materials store={store} state={state} /> : null}

        {tab === 'import' ? (
          <Section title="Bring things in">
            <div className="stack">
              <button className="btn big" onClick={() => void openProjectFromFile(store)}>
                Open a project file
              </button>
              <p className="hint">Opens a .homeforge file and replaces the current project.</p>
              <button className="btn big" onClick={() => void importPresetsFromFile(store)}>
                Import presets
              </button>
              <p className="hint">Adds the walls, doors and other presets from a .homeforge-presets file to your library.</p>
            </div>
          </Section>
        ) : null}

        {tab === 'export' ? (
          <Section title="Save and share">
            <div className="stack">
              <button className="btn big" onClick={() => void saveProjectToFile(store)}>
                Save project to a file
              </button>
              <p className="hint">Creates a .homeforge file you can keep, back up or move to another device.</p>
              <button
                className="btn big"
                onClick={() => void exportMyPresets(store)}
                disabled={store.userPresets().length === 0}
              >
                Export my presets ({store.userPresets().length})
              </button>
              <p className="hint">
                {store.userPresets().length === 0
                  ? 'Select a part and press "Save as preset" first.'
                  : 'Creates a .homeforge-presets file you can import in any HomeForge.'}
              </p>
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function HouseBuilder({ store, state, where }: { store: EditorStore; state: EditorState; where: () => Vec3 }) {
  const [filter, setFilter] = useState<'all' | (typeof PRESET_CATEGORIES)[number]>('all');
  const used = new Set(state.presets.map((p) => p.category));
  const shown = state.presets.filter((p) => filter === 'all' || p.category === filter);

  return (
    <Section title="Parts library" hint="Tap Add to place a part where the camera is looking.">
      <div className="chips" role="group" aria-label="Filter by type">
        <button className={`chip ${filter === 'all' ? 'active' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </button>
        {PRESET_CATEGORIES.filter((c) => used.has(c)).map((c) => (
          <button key={c} className={`chip ${filter === c ? 'active' : ''}`} aria-pressed={filter === c} onClick={() => setFilter(c)}>
            {c[0].toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      <ul className="preset-list">
        {shown.map((p) => (
          <PresetRow key={p.id} preset={p} onAdd={() => store.addPreset(p.id, where())} onDelete={() => store.deletePreset(p.id)} />
        ))}
      </ul>
      {shown.length === 0 ? <p className="hint">No presets of this type yet.</p> : null}
    </Section>
  );
}

function PresetRow({ preset, onAdd, onDelete }: { preset: Preset; onAdd(): void; onDelete(): void }) {
  return (
    <li className="preset-row">
      <div className="preset-info">
        <strong>{preset.name}</strong>
        <span className="muted">
          {preset.category}
          {preset.builtIn ? ' · built-in' : ' · yours'}
        </span>
      </div>
      <button className="btn small primary" onClick={onAdd} aria-label={`Add ${preset.name}`}>
        Add
      </button>
      {!preset.builtIn ? (
        <button className="btn small danger" onClick={onDelete} aria-label={`Delete preset ${preset.name}`}>
          Delete
        </button>
      ) : null}
    </li>
  );
}

function Materials({ store, state }: { store: EditorStore; state: EditorState }) {
  const project = state.history.present;
  const [newName, setNewName] = useState('My color');
  const [newColor, setNewColor] = useState('#4f7cac');
  const hasSelection = state.selection.length > 0;

  return (
    <>
      <Section
        title="Colors and materials"
        hint={hasSelection ? 'Tap a material to paint the selected parts.' : 'Select something in the 3D view, then tap a material.'}
      >
        <ul className="material-list">
          {Object.values(project.materials).map((m) => (
            <li key={m.id} className="material-row">
              <button
                className="swatch-btn"
                disabled={!hasSelection}
                onClick={() => store.applyMaterial(m.id)}
                aria-label={`Apply ${m.name}`}
                title={hasSelection ? `Apply ${m.name}` : 'Select something first'}
              >
                <span className="swatch" style={{ background: m.color }} />
                <span>{m.name}</span>
              </button>
              <input
                type="color"
                value={m.color}
                aria-label={`Change color of ${m.name}`}
                title="Change this material's color everywhere it is used"
                onChange={(e) => store.updateMaterial({ ...m, color: e.target.value })}
              />
            </li>
          ))}
        </ul>
        <p className="hint">The color picker changes the material everywhere it is used.</p>
      </Section>
      <Section title="New material">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            store.createMaterialFor(newName, newColor);
          }}
        >
          <label className="field">
            <span>Name</span>
            <input type="text" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label className="field">
            <span>Color</span>
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
          </label>
          <button className="btn primary" type="submit">
            {hasSelection ? 'Create and apply' : 'Create'}
          </button>
        </form>
      </Section>
    </>
  );
}
