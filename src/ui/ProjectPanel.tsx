import { useState, type MutableRefObject } from 'react';
import { PRESET_CATEGORIES, type Preset, type PresetCategory } from '../core/presets';
import type { Vec3 } from '../core/project';
import type { EditorState, EditorStore } from '../editor/store';
import { exportMyPresets, importPresetsFromFile, openProjectFromFile, saveProjectToFile } from './actions';
import type { ViewportApi } from './ViewportPane';

type Tab = 'parts' | 'shapes' | 'materials' | 'files';

const TABS: { id: Tab; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'materials', label: 'Materials' },
  { id: 'files', label: 'Import / Export' },
];

const CATEGORY_ICON: Record<PresetCategory, string> = {
  wall: '🧱',
  door: '🚪',
  window: '🪟',
  floor: '⬛',
  roof: '🏠',
  stairs: '🪜',
  furniture: '🛋',
  other: '📦',
};

interface Props {
  store: EditorStore;
  state: EditorState;
  viewportApi: MutableRefObject<ViewportApi | null>;
}

export function ProjectPanel({ store, state, viewportApi }: Props) {
  const [tab, setTab] = useState<Tab>('parts');
  const where = (): Vec3 => viewportApi.current?.getGroundTarget() ?? [0, 0, 0];

  return (
    <>
      <div className="panel-header">
        <div className="tabs" role="tablist" aria-label="Project">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`ptab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`ppanel-${t.id}`}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-scroll project-body" role="tabpanel" id={`ppanel-${tab}`} aria-labelledby={`ptab-${tab}`}>
        {tab === 'parts' ? <Parts store={store} state={state} where={where} /> : null}
        {tab === 'shapes' ? (
          <div className="tile-grid">
            <button type="button" className="tile" onClick={() => store.addPrimitive('box', where())}>
              <span className="tile-icon" aria-hidden="true">
                ▭
              </span>
              <span className="tile-name">Box</span>
            </button>
            <button type="button" className="tile" onClick={() => store.addPrimitive('cylinder', where())}>
              <span className="tile-icon" aria-hidden="true">
                ◯
              </span>
              <span className="tile-name">Cylinder</span>
            </button>
            <button type="button" className="tile" onClick={() => store.addEmptyGroup()}>
              <span className="tile-icon" aria-hidden="true">
                📁
              </span>
              <span className="tile-name">Empty group</span>
            </button>
          </div>
        ) : null}
        {tab === 'materials' ? <Materials store={store} state={state} /> : null}
        {tab === 'files' ? <Files store={store} /> : null}
      </div>
    </>
  );
}

function Parts({ store, state, where }: { store: EditorStore; state: EditorState; where: () => Vec3 }) {
  const [filter, setFilter] = useState<'all' | PresetCategory>('all');
  const used = new Set(state.presets.map((p) => p.category));
  const shown = state.presets.filter((p) => filter === 'all' || p.category === filter);

  return (
    <>
      <div className="chips" role="group" aria-label="Filter by type">
        <button type="button" className={`chip ${filter === 'all' ? 'active' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </button>
        {PRESET_CATEGORIES.filter((c) => used.has(c)).map((c) => (
          <button key={c} type="button" className={`chip ${filter === c ? 'active' : ''}`} aria-pressed={filter === c} onClick={() => setFilter(c)}>
            {c[0].toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      <div className="tile-grid">
        {shown.map((p) => (
          <PresetTile key={p.id} preset={p} onAdd={() => store.addPreset(p.id, where())} onDelete={() => store.deletePreset(p.id)} />
        ))}
      </div>
      {shown.length === 0 ? <p className="hint">No presets of this type yet. Select a part and press "Save preset" in the Inspector.</p> : null}
    </>
  );
}

function PresetTile({ preset, onAdd, onDelete }: { preset: Preset; onAdd(): void; onDelete(): void }) {
  return (
    <div className="tile-wrap">
      <button type="button" className="tile" onClick={onAdd} title={`Add ${preset.name} where the camera is looking`} aria-label={`Add ${preset.name}`}>
        <span className="tile-icon" aria-hidden="true">
          {CATEGORY_ICON[preset.category]}
        </span>
        <span className="tile-name">{preset.name}</span>
        <span className="tile-sub">{preset.builtIn ? 'built-in' : 'yours'}</span>
      </button>
      {!preset.builtIn ? (
        <button type="button" className="tile-delete" onClick={onDelete} aria-label={`Delete preset ${preset.name}`} title="Delete this preset">
          ✕
        </button>
      ) : null}
    </div>
  );
}

function Materials({ store, state }: { store: EditorStore; state: EditorState }) {
  const project = state.history.present;
  const [newName, setNewName] = useState('My color');
  const [newColor, setNewColor] = useState('#4f7cac');
  const hasSelection = state.selection.length > 0;

  return (
    <div className="materials-layout">
      <div>
        <p className="hint">
          {hasSelection ? 'Click a material to paint the selected parts. The small color box edits it everywhere it is used.' : 'Select a part first, then click a material.'}
        </p>
        <ul className="material-list">
          {Object.values(project.materials).map((m) => (
            <li key={m.id} className="material-row">
              <button
                type="button"
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
      </div>
      <form
        className="new-material"
        onSubmit={(e) => {
          e.preventDefault();
          store.createMaterialFor(newName, newColor);
        }}
      >
        <strong>New material</strong>
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
    </div>
  );
}

function Files({ store }: { store: EditorStore }) {
  const mine = store.userPresets().length;
  return (
    <div className="files-grid">
      <div className="file-card">
        <strong>Project</strong>
        <button type="button" className="btn" onClick={() => void saveProjectToFile(store)}>
          Save project to a file
        </button>
        <button type="button" className="btn" onClick={() => void openProjectFromFile(store)}>
          Open a project file
        </button>
        <p className="hint">A .homeforge file you can keep, back up or move to another device.</p>
      </div>
      <div className="file-card">
        <strong>Presets</strong>
        <button type="button" className="btn" onClick={() => void exportMyPresets(store)} disabled={mine === 0}>
          Export my presets ({mine})
        </button>
        <button type="button" className="btn" onClick={() => void importPresetsFromFile(store)}>
          Import presets
        </button>
        <p className="hint">{mine === 0 ? 'Select a part and press "Save preset" first.' : 'A .homeforge-presets file you can import in any HomeForge.'}</p>
      </div>
    </div>
  );
}
