// Framework-free editor state. React subscribes through useSyncExternalStore.
// All project changes go through the pure functions in core/, then one
// history commit, so every edit is undoable and failures never half-apply.

import { commit, createHistory, redo as redoH, reset, undo as undoH, type History } from '../core/history';
import type { Id } from '../core/ids';
import {
  DEFAULT_MATERIAL_ID,
  ProjectError,
  addMaterial,
  addNode,
  createProject,
  deleteNode,
  duplicateNode,
  getNode,
  groupNodes,
  hasNode,
  renameNode,
  renameProject,
  setGeometry,
  setLocked,
  setNodeMaterial,
  setTransform,
  setVisible,
  topLevelAncestor,
  ungroup,
  upsertMaterial,
  type GeometryDef,
  type MaterialDef,
  type Project,
  type Transform,
  type Vec3,
} from '../core/project';
import {
  builtinPresets,
  createPresetFromNode,
  instantiatePreset,
  type Preset,
  type PresetCategory,
} from '../core/presets';

export type Mode = 'easy' | 'advanced';
export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface Notice {
  seq: number;
  kind: 'info' | 'error';
  text: string;
}

export interface Settings {
  showGrid: boolean;
  orthographic: boolean;
}

export interface EditorState {
  history: History<Project>;
  selection: Id[];
  mode: Mode;
  /** Built-in presets first, then the user's own. */
  presets: Preset[];
  notice: Notice | null;
  settings: Settings;
  /** Bumped whenever the project is replaced wholesale (new/open) so the view can re-frame. */
  projectEpoch: number;
}

type Listener = () => void;

export class EditorStore {
  private state: EditorState;
  private listeners = new Set<Listener>();
  private noticeSeq = 0;

  constructor(project: Project = createProject(), userPresets: Preset[] = []) {
    this.state = {
      history: createHistory(project, 100),
      selection: [],
      mode: 'easy',
      presets: [...builtinPresets(), ...userPresets],
      notice: null,
      settings: { showGrid: true, orthographic: false },
      projectEpoch: 0,
    };
  }

  // -------------------------------------------------- subscription plumbing

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getState = (): EditorState => this.state;

  get project(): Project {
    return this.state.history.present;
  }

  private set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private notify(kind: Notice['kind'], text: string): void {
    this.noticeSeq += 1;
    this.set({ notice: { seq: this.noticeSeq, kind, text } });
  }

  dismissNotice = (): void => {
    if (this.state.notice) this.set({ notice: null });
  };

  info(text: string): void {
    this.notify('info', text);
  }

  error(text: string): void {
    this.notify('error', text);
  }

  /** Runs an edit; user-facing errors become a notice instead of crashing the UI. */
  private attempt(fn: () => void): boolean {
    try {
      fn();
      return true;
    } catch (e) {
      if (e instanceof ProjectError) this.notify('error', e.message);
      else this.notify('error', e instanceof Error ? `Something went wrong: ${e.message}` : 'Something went wrong');
      return false;
    }
  }

  private commitProject(next: Project, selection?: Id[], coalesceKey: string | null = null): void {
    const history = commit(this.state.history, next, coalesceKey);
    this.set({ history, selection: this.prune(selection ?? this.state.selection, next) });
  }

  private prune(ids: Id[], p: Project): Id[] {
    return ids.filter((id) => hasNode(p, id) && id !== p.rootId);
  }

  // ---------------------------------------------------------------- selection

  select(ids: Id[]): void {
    this.set({ selection: this.prune(ids, this.project) });
  }

  /** Called when the user clicks in the 3D view. Easy mode picks whole objects. */
  pick(id: Id | null, additive: boolean): void {
    if (id === null) {
      if (!additive) this.select([]);
      return;
    }
    if (!hasNode(this.project, id)) return;
    const target = this.state.mode === 'easy' ? topLevelAncestor(this.project, id) : id;
    if (additive) {
      const cur = this.state.selection;
      this.select(cur.includes(target) ? cur.filter((x) => x !== target) : [...cur, target]);
    } else {
      this.select([target]);
    }
  }

  // ---------------------------------------------------------------- creating

  addPrimitive(kind: 'box' | 'cylinder', position: Vec3 = [0, 0, 0]): void {
    this.attempt(() => {
      const geometry: GeometryDef =
        kind === 'box'
          ? { type: 'box', width: 1, height: 1, depth: 1 }
          : { type: 'cylinder', radius: 0.5, height: 1, segments: 24 };
      const r = addNode(this.project, {
        name: kind === 'box' ? 'Box' : 'Cylinder',
        geometry,
        transform: { position: [position[0], 0.5, position[2]] },
      });
      this.commitProject(r.project, [r.id]);
    });
  }

  addPreset(presetId: string, position: Vec3 = [0, 0, 0]): void {
    const preset = this.state.presets.find((p) => p.id === presetId);
    if (!preset) {
      this.error('That preset no longer exists');
      return;
    }
    this.attempt(() => {
      const r = instantiatePreset(this.project, preset, { position });
      this.commitProject(r.project, [r.id]);
    });
  }

  // ----------------------------------------------------------------- editing

  rename(id: Id, name: string): void {
    this.attempt(() => this.commitProject(renameNode(this.project, id, name), undefined, `rename:${id}`));
  }

  renameProject(name: string): void {
    this.attempt(() => this.commitProject(renameProject(this.project, name), undefined, 'rename-project'));
  }

  setTransform(id: Id, patch: Partial<Transform>): void {
    this.attempt(() => this.commitProject(setTransform(this.project, id, patch), undefined, `transform:${id}`));
  }

  setGeometry(id: Id, geometry: GeometryDef): void {
    this.attempt(() => this.commitProject(setGeometry(this.project, id, geometry), undefined, `geometry:${id}`));
  }

  setVisible(id: Id, visible: boolean): void {
    this.attempt(() => this.commitProject(setVisible(this.project, id, visible)));
  }

  setLocked(id: Id, locked: boolean): void {
    this.attempt(() => this.commitProject(setLocked(this.project, id, locked)));
  }

  /** Applies an existing material to every selected mesh (including meshes inside groups). */
  applyMaterial(materialId: Id): void {
    this.attempt(() => {
      let p = this.project;
      const apply = (id: Id) => {
        const n = getNode(p, id);
        if (n.kind === 'mesh') p = setNodeMaterial(p, id, materialId);
        else n.children.forEach(apply);
      };
      if (this.state.selection.length === 0) throw new ProjectError('invalid-input', 'Select something first');
      this.state.selection.forEach(apply);
      this.commitProject(p);
    });
  }

  updateMaterial(mat: MaterialDef): void {
    this.attempt(() => this.commitProject(upsertMaterial(this.project, mat), undefined, `material:${mat.id}`));
  }

  createMaterialFor(name: string, color: string): void {
    this.attempt(() => {
      const { project, id } = addMaterial(this.project, { name, color, roughness: 0.8, metalness: 0 });
      this.commitProject(project);
      if (this.state.selection.length > 0) this.applyMaterial(id);
    });
  }

  deleteSelected(): void {
    if (this.state.selection.length === 0) return;
    this.attempt(() => {
      let p = this.project;
      for (const id of this.state.selection) if (hasNode(p, id)) p = deleteNode(p, id);
      this.commitProject(p, []);
    });
  }

  duplicateSelected(): void {
    if (this.state.selection.length === 0) return;
    this.attempt(() => {
      let p = this.project;
      const created: Id[] = [];
      for (const id of this.state.selection) {
        const r = duplicateNode(p, id);
        p = r.project;
        created.push(r.id);
      }
      this.commitProject(p, created);
    });
  }

  groupSelected(): void {
    this.attempt(() => {
      const r = groupNodes(this.project, this.state.selection, 'Group');
      this.commitProject(r.project, [r.id]);
    });
  }

  ungroupSelected(): void {
    this.attempt(() => {
      if (this.state.selection.length === 0) throw new ProjectError('invalid-input', 'Select a group first');
      let p = this.project;
      const released: Id[] = [];
      for (const id of this.state.selection) {
        const r = ungroup(p, id);
        p = r.project;
        released.push(...r.childIds);
      }
      this.commitProject(p, released);
    });
  }

  // --------------------------------------------------------------- undo/redo

  undo = (): void => {
    const history = undoH(this.state.history);
    if (history === this.state.history) return;
    this.set({ history, selection: this.prune(this.state.selection, history.present) });
  };

  redo = (): void => {
    const history = redoH(this.state.history);
    if (history === this.state.history) return;
    this.set({ history, selection: this.prune(this.state.selection, history.present) });
  };

  // ------------------------------------------------------- project lifecycle

  /** Replaces the whole project (new / open / recovery) and clears undo history. */
  loadProject(project: Project): void {
    this.set({
      history: reset(this.state.history, project),
      selection: [],
      projectEpoch: this.state.projectEpoch + 1,
    });
  }

  newProject(): void {
    this.loadProject(createProject());
  }

  // ------------------------------------------------------------------ presets

  userPresets(): Preset[] {
    return this.state.presets.filter((p) => !p.builtIn);
  }

  savePresetFromSelection(name: string, category: PresetCategory): boolean {
    return this.attempt(() => {
      if (this.state.selection.length !== 1) {
        throw new ProjectError('invalid-input', 'Select exactly one part or group to save as a preset');
      }
      const preset = createPresetFromNode(this.project, this.state.selection[0], { name, category });
      this.set({ presets: [...this.state.presets, preset] });
      this.notify('info', `Saved preset "${preset.name}"`);
    });
  }

  deletePreset(id: string): void {
    const preset = this.state.presets.find((p) => p.id === id);
    if (!preset) return;
    if (preset.builtIn) {
      this.error('Built-in presets cannot be deleted');
      return;
    }
    this.set({ presets: this.state.presets.filter((p) => p.id !== id) });
  }

  addImportedPresets(presets: Preset[]): void {
    this.set({ presets: [...this.state.presets, ...presets] });
    this.notify('info', `Imported ${presets.length} preset${presets.length === 1 ? '' : 's'}`);
  }

  // ----------------------------------------------------------------- settings

  setMode(mode: Mode): void {
    this.set({ mode });
  }

  setSettings(patch: Partial<Settings>): void {
    this.set({ settings: { ...this.state.settings, ...patch } });
  }
}

export { DEFAULT_MATERIAL_ID };
