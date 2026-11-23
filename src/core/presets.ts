import { newId, type Id } from './ids';
import {
  ProjectError,
  addNode,
  assertGeometry,
  getNode,
  identityTransform,
  type GeometryDef,
  type MaterialDef,
  type MetaValue,
  type Project,
  type Transform,
  type Vec3,
} from './project';

export const PRESET_FORMAT = 'homeforge-presets';
export const PRESET_FORMAT_VERSION = 1;

export const PRESET_CATEGORIES = [
  'wall',
  'door',
  'window',
  'floor',
  'roof',
  'stairs',
  'furniture',
  'other',
] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

const MAX_PRESET_NODES = 5_000;
const MAX_DEPTH = 24;
const MAX_NAME = 120;
const HEX = /^#[0-9a-fA-F]{6}$/;

export interface PresetMaterial {
  key: string;
  name: string;
  color: string;
  roughness: number;
  metalness: number;
}

export interface PresetNodeDef {
  name: string;
  kind: 'group' | 'mesh';
  transform: Transform;
  geometry?: GeometryDef;
  materialKey?: string;
  meta: Record<string, MetaValue>;
  children: PresetNodeDef[];
}

export interface Preset {
  id: Id;
  name: string;
  category: PresetCategory;
  createdAt: string;
  materials: PresetMaterial[];
  root: PresetNodeDef;
  /** Built-in presets are shipped with the app and cannot be deleted. */
  builtIn?: boolean;
}

export interface PresetPack {
  format: typeof PRESET_FORMAT;
  version: number;
  presets: Omit<Preset, 'builtIn'>[];
}

// ------------------------------------------------------------ create / apply

/** Captures a node (and everything inside it) as a reusable preset. */
export function createPresetFromNode(
  p: Project,
  nodeId: Id,
  opts: { name: string; category: PresetCategory },
): Preset {
  if (nodeId === p.rootId) throw new ProjectError('root-protected', 'Select a part to save as a preset');
  const name = opts.name.trim().slice(0, MAX_NAME);
  if (name.length === 0) throw new ProjectError('invalid-input', 'Give the preset a name');
  if (!PRESET_CATEGORIES.includes(opts.category)) throw new ProjectError('invalid-input', 'Unknown preset category');

  const materials: PresetMaterial[] = [];
  const keyByMaterialId = new Map<Id, string>();
  let count = 0;

  const capture = (id: Id, depth: number, isRoot: boolean): PresetNodeDef => {
    if (depth > MAX_DEPTH) throw new ProjectError('invalid-input', 'Preset is nested too deeply');
    count += 1;
    if (count > MAX_PRESET_NODES) throw new ProjectError('invalid-input', 'Preset has too many parts');
    const n = getNode(p, id);
    let materialKey: string | undefined;
    if (n.kind === 'mesh' && n.materialId) {
      let key = keyByMaterialId.get(n.materialId);
      if (!key) {
        const m = p.materials[n.materialId];
        key = `m${materials.length}`;
        keyByMaterialId.set(n.materialId, key);
        materials.push({ key, name: m.name, color: m.color, roughness: m.roughness, metalness: m.metalness });
      }
      materialKey = key;
    }
    return {
      name: n.name,
      kind: n.kind,
      // The preset root always starts at the origin so it can be dropped anywhere.
      transform: isRoot
        ? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [...n.transform.scale] as Vec3 }
        : {
            position: [...n.transform.position] as Vec3,
            rotation: [...n.transform.rotation] as Vec3,
            scale: [...n.transform.scale] as Vec3,
          },
      ...(n.geometry ? { geometry: { ...n.geometry } } : {}),
      ...(materialKey ? { materialKey } : {}),
      meta: { ...n.meta },
      children: n.children.map((c) => capture(c, depth + 1, false)),
    };
  };

  const root = capture(nodeId, 0, true);
  return {
    id: newId('preset'),
    name,
    category: opts.category,
    createdAt: new Date().toISOString(),
    materials,
    root,
  };
}

/** Adds a copy of the preset to the project. Materials are reused when an identical one exists. */
export function instantiatePreset(
  p: Project,
  preset: Preset,
  opts: { parentId?: Id; position?: Vec3 } = {},
): { project: Project; id: Id } {
  const parentId = opts.parentId ?? p.rootId;
  let project = p;

  const materialIdByKey = new Map<string, Id>();
  const materials = { ...project.materials };
  for (const pm of preset.materials) {
    const existing = Object.values(materials).find(
      (m) =>
        m.name === pm.name &&
        m.color === pm.color.toLowerCase() &&
        m.roughness === pm.roughness &&
        m.metalness === pm.metalness,
    );
    if (existing) {
      materialIdByKey.set(pm.key, existing.id);
    } else {
      const id = newId('mat');
      const def: MaterialDef = {
        id,
        name: pm.name,
        color: pm.color.toLowerCase(),
        roughness: pm.roughness,
        metalness: pm.metalness,
      };
      materials[id] = def;
      materialIdByKey.set(pm.key, id);
    }
  }
  project = { ...project, materials };

  const place = (def: PresetNodeDef, parent: Id, isRoot: boolean): Id => {
    const transform: Transform = isRoot && opts.position
      ? { ...def.transform, position: [...opts.position] as Vec3 }
      : def.transform;
    const spec = {
      name: def.name,
      kind: def.kind,
      parentId: parent,
      transform,
      ...(def.geometry ? { geometry: def.geometry } : {}),
      ...(def.materialKey ? { materialId: materialIdByKey.get(def.materialKey) } : {}),
      meta: { ...def.meta, ...(isRoot ? { presetId: preset.id, presetName: preset.name } : {}) },
    };
    const added = addNode(project, spec);
    project = added.project;
    for (const child of def.children) place(child, added.id, false);
    return added.id;
  };

  const rootId = place(preset.root, parentId, true);
  return { project, id: rootId };
}

// ------------------------------------------------------------ export / import

export function exportPresetPack(presets: readonly Preset[]): string {
  const pack: PresetPack = {
    format: PRESET_FORMAT,
    version: PRESET_FORMAT_VERSION,
    presets: presets.map((p) => {
      const { builtIn: _builtIn, ...rest } = p;
      void _builtIn;
      return rest;
    }),
  };
  return JSON.stringify(pack, null, 2);
}

function bad(msg: string): never {
  throw new ProjectError('invalid-file', msg);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * Reads a preset pack from untrusted text. Everything is validated, and every
 * imported preset gets a fresh id so it can never overwrite an existing one.
 */
export function importPresetPack(text: string): Preset[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    bad('This file is not valid JSON');
  }
  if (!isRecord(raw) || raw.format !== PRESET_FORMAT) bad('This is not a HomeForge preset file');
  if (typeof raw.version !== 'number' || raw.version < 1) bad('Preset file has no valid version');
  if (raw.version > PRESET_FORMAT_VERSION) bad('This preset file is from a newer HomeForge. Please update the app.');
  if (!Array.isArray(raw.presets)) bad('Preset file contains no presets');
  if (raw.presets.length === 0 || raw.presets.length > 500) bad('Preset file has an invalid number of presets');
  return raw.presets.map((entry, i) => validatePreset(entry, i));
}

function validatePreset(entry: unknown, index: number): Preset {
  const label = `Preset ${index + 1}`;
  if (!isRecord(entry)) bad(`${label} is broken`);
  if (typeof entry.name !== 'string' || entry.name.trim().length === 0) bad(`${label} has no name`);
  if (typeof entry.category !== 'string' || !(PRESET_CATEGORIES as readonly string[]).includes(entry.category)) {
    bad(`${label} has an unknown category`);
  }
  if (!Array.isArray(entry.materials) || entry.materials.length > 200) bad(`${label} has invalid materials`);

  const keys = new Set<string>();
  const materials: PresetMaterial[] = entry.materials.map((m: unknown) => {
    if (!isRecord(m)) bad(`${label} has a broken material`);
    if (typeof m.key !== 'string' || keys.has(m.key)) bad(`${label} has a duplicate material key`);
    if (typeof m.name !== 'string' || typeof m.color !== 'string' || !HEX.test(m.color)) bad(`${label} has an invalid material`);
    const r = m.roughness;
    const mt = m.metalness;
    if (typeof r !== 'number' || typeof mt !== 'number' || !(r >= 0 && r <= 1) || !(mt >= 0 && mt <= 1)) {
      bad(`${label} has invalid material values`);
    }
    keys.add(m.key);
    return { key: m.key, name: m.name.slice(0, MAX_NAME), color: m.color.toLowerCase(), roughness: r, metalness: mt };
  });

  let count = 0;
  const readNode = (n: unknown, depth: number): PresetNodeDef => {
    if (depth > MAX_DEPTH) bad(`${label} is nested too deeply`);
    count += 1;
    if (count > MAX_PRESET_NODES) bad(`${label} has too many parts`);
    if (!isRecord(n)) bad(`${label} has a broken part`);
    if (typeof n.name !== 'string') bad(`${label} has an unnamed part`);
    if (n.kind !== 'group' && n.kind !== 'mesh') bad(`${label} has a part of unknown type`);
    if (!isRecord(n.transform) || !isVec3(n.transform.position) || !isVec3(n.transform.rotation) || !isVec3(n.transform.scale)) {
      bad(`${label} has a part with an invalid transform`);
    }
    if (n.transform.scale.some((s: number) => s === 0)) bad(`${label} has a part with zero scale`);
    const children = n.children;
    if (!Array.isArray(children)) bad(`${label} has a part without children list`);

    let geometry: GeometryDef | undefined;
    let materialKey: string | undefined;
    if (n.kind === 'mesh') {
      if (!isRecord(n.geometry)) bad(`${label} has a mesh without geometry`);
      geometry = n.geometry as unknown as GeometryDef;
      try {
        assertGeometry(geometry);
      } catch {
        bad(`${label} has a mesh with invalid geometry`);
      }
      if (children.length > 0) bad(`${label} has a mesh containing parts`);
      if (typeof n.materialKey !== 'string' || !keys.has(n.materialKey)) bad(`${label} uses a missing material`);
      materialKey = n.materialKey;
    } else if (n.geometry !== undefined) {
      bad(`${label} has a group with geometry`);
    }

    const meta: Record<string, MetaValue> = {};
    if (isRecord(n.meta)) {
      for (const [k, v] of Object.entries(n.meta)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') meta[k.slice(0, 60)] = v;
      }
    }
    return {
      name: n.name.trim().slice(0, MAX_NAME) || 'Part',
      kind: n.kind,
      transform: {
        position: [...n.transform.position] as Vec3,
        rotation: [...n.transform.rotation] as Vec3,
        scale: [...n.transform.scale] as Vec3,
      },
      ...(geometry ? { geometry: { ...geometry } } : {}),
      ...(materialKey ? { materialKey } : {}),
      meta,
      children: children.map((c: unknown) => readNode(c, depth + 1)),
    };
  };

  return {
    id: newId('preset'),
    name: entry.name.trim().slice(0, MAX_NAME),
    category: entry.category as PresetCategory,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
    materials,
    root: readNode(entry.root, 0),
  };
}

// ----------------------------------------------------------- built-in presets
// Units are metres, Y is up, every preset sits on the ground (y = 0) at the origin.

function mat(key: string, name: string, color: string, roughness = 0.8, metalness = 0): PresetMaterial {
  return { key, name, color, roughness, metalness };
}

function box(
  name: string,
  size: Vec3,
  position: Vec3,
  materialKey: string,
): PresetNodeDef {
  return {
    name,
    kind: 'mesh',
    transform: { ...identityTransform(), position },
    geometry: { type: 'box', width: size[0], height: size[1], depth: size[2] },
    materialKey,
    meta: {},
    children: [],
  };
}

function group(name: string, children: PresetNodeDef[]): PresetNodeDef {
  return { name, kind: 'group', transform: identityTransform(), meta: {}, children };
}

function builtin(id: string, name: string, category: PresetCategory, materials: PresetMaterial[], root: PresetNodeDef): Preset {
  return { id, name, category, createdAt: '2026-01-01T00:00:00.000Z', materials, root, builtIn: true };
}

export function builtinPresets(): Preset[] {
  const plaster = mat('plaster', 'Plaster', '#d9d4c7', 0.9);
  const wood = mat('wood', 'Wood', '#8a5a33', 0.7);
  const glass = mat('glass', 'Glass', '#9fc9e8', 0.1);
  const concrete = mat('concrete', 'Concrete', '#9a9a9a', 0.95);
  const tile = mat('tile', 'Roof tile', '#a8472f', 0.85);

  const stairSteps: PresetNodeDef[] = [];
  for (let i = 0; i < 6; i++) {
    const rise = 0.18;
    stairSteps.push(box(`Step ${i + 1}`, [1.0, rise, 0.28], [0, rise / 2 + i * rise, i * 0.28], 'concrete'));
  }

  return [
    builtin('builtin:wall-4m', 'Wall 4 m', 'wall', [plaster], group('Wall 4 m', [box('Wall', [4, 2.8, 0.2], [0, 1.4, 0], 'plaster')])),
    builtin('builtin:wall-2m', 'Wall 2 m', 'wall', [plaster], group('Wall 2 m', [box('Wall', [2, 2.8, 0.2], [0, 1.4, 0], 'plaster')])),
    builtin(
      'builtin:door-single',
      'Door (single)',
      'door',
      [wood],
      group('Door', [
        box('Frame left', [0.06, 2.1, 0.22], [-0.48, 1.05, 0], 'wood'),
        box('Frame right', [0.06, 2.1, 0.22], [0.48, 1.05, 0], 'wood'),
        box('Frame top', [1.02, 0.06, 0.22], [0, 2.13, 0], 'wood'),
        box('Door leaf', [0.9, 2.05, 0.04], [0, 1.025, 0], 'wood'),
      ]),
    ),
    builtin(
      'builtin:window-standard',
      'Window (standard)',
      'window',
      [wood, glass],
      group('Window', [
        box('Frame left', [0.06, 1.2, 0.2], [-0.57, 1.5, 0], 'wood'),
        box('Frame right', [0.06, 1.2, 0.2], [0.57, 1.5, 0], 'wood'),
        box('Frame top', [1.2, 0.06, 0.2], [0, 2.13, 0], 'wood'),
        box('Frame bottom', [1.2, 0.06, 0.2], [0, 0.9, 0], 'wood'),
        box('Glass', [1.08, 1.14, 0.02], [0, 1.5, 0], 'glass'),
      ]),
    ),
    builtin('builtin:floor-4x4', 'Floor slab 4 x 4 m', 'floor', [concrete], group('Floor slab', [box('Slab', [4, 0.2, 4], [0, -0.1, 0], 'concrete')])),
    builtin('builtin:stairs-6', 'Stairs (6 steps)', 'stairs', [concrete], group('Stairs', stairSteps)),
    builtin('builtin:roof-flat', 'Flat roof 4 x 4 m', 'roof', [tile], group('Flat roof', [box('Roof', [4.4, 0.15, 4.4], [0, 2.875, 0], 'tile')])),
  ];
}
