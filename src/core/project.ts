import { newId, type Id } from './ids';
import { compose, decompose, identity, invertAffine, multiply, type Mat4, type Vec3 } from './math';

export type { Id } from './ids';
export type { Vec3 } from './math';

export const PROJECT_VERSION = 1;
export const PROJECT_FORMAT = 'homeforge-project';

const MAX_NODES = 100_000;
const MAX_NAME = 120;

export type ProjectErrorCode =
  | 'not-found'
  | 'root-protected'
  | 'locked'
  | 'invalid-parent'
  | 'invalid-input'
  | 'different-parents'
  | 'invalid-file';

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;
  constructor(code: ProjectErrorCode, message: string) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
  }
}

// ---------------------------------------------------------------- data model

export interface Transform {
  position: Vec3;
  /** Euler angles in radians, order XYZ. */
  rotation: Vec3;
  scale: Vec3;
}

export type GeometryDef =
  | { type: 'box'; width: number; height: number; depth: number }
  | { type: 'cylinder'; radius: number; height: number; segments: number };

export type MetaValue = string | number | boolean;

export interface SceneNode {
  id: Id;
  name: string;
  kind: 'group' | 'mesh';
  parentId: Id | null;
  children: Id[];
  transform: Transform;
  visible: boolean;
  locked: boolean;
  geometry?: GeometryDef;
  materialId?: Id;
  meta: Record<string, MetaValue>;
}

export interface MaterialDef {
  id: Id;
  name: string;
  /** '#rrggbb' */
  color: string;
  roughness: number;
  metalness: number;
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: number;
  id: Id;
  name: string;
  createdAt: string;
  updatedAt: string;
  rootId: Id;
  nodes: Record<Id, SceneNode>;
  materials: Record<Id, MaterialDef>;
}

export const DEFAULT_MATERIAL_ID = 'mat_default';

export function identityTransform(): Transform {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

// ------------------------------------------------------------------ creation

export function createProject(name = 'Untitled House'): Project {
  const now = new Date().toISOString();
  const rootId = newId('root');
  const root: SceneNode = {
    id: rootId,
    name: 'Scene',
    kind: 'group',
    parentId: null,
    children: [],
    transform: identityTransform(),
    visible: true,
    locked: false,
    meta: {},
  };
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: newId('proj'),
    name: cleanName(name, 'Untitled House'),
    createdAt: now,
    updatedAt: now,
    rootId,
    nodes: { [rootId]: root },
    materials: {
      [DEFAULT_MATERIAL_ID]: {
        id: DEFAULT_MATERIAL_ID,
        name: 'Plaster',
        color: '#d9d4c7',
        roughness: 0.9,
        metalness: 0,
      },
    },
  };
}

function cleanName(raw: string, fallback?: string): string {
  const name = raw.trim().slice(0, MAX_NAME);
  if (name.length === 0) {
    if (fallback !== undefined) return fallback;
    throw new ProjectError('invalid-input', 'Name cannot be empty');
  }
  return name;
}

// ------------------------------------------------------------------- queries

export function getNode(p: Project, id: Id): SceneNode {
  const node = p.nodes[id];
  if (!node) throw new ProjectError('not-found', `Node not found: ${id}`);
  return node;
}

export function hasNode(p: Project, id: Id): boolean {
  return Object.prototype.hasOwnProperty.call(p.nodes, id);
}

/** True when `maybeAncestor` is a strict ancestor of `id`. */
export function isAncestor(p: Project, maybeAncestor: Id, id: Id): boolean {
  let cur = p.nodes[id]?.parentId ?? null;
  while (cur !== null) {
    if (cur === maybeAncestor) return true;
    cur = p.nodes[cur]?.parentId ?? null;
  }
  return false;
}

/** A node is effectively locked when it or any ancestor is locked. */
export function isEffectivelyLocked(p: Project, id: Id): boolean {
  let cur: Id | null = id;
  while (cur !== null) {
    const n: SceneNode | undefined = p.nodes[cur];
    if (!n) return false;
    if (n.locked) return true;
    cur = n.parentId;
  }
  return false;
}

export function isEffectivelyVisible(p: Project, id: Id): boolean {
  let cur: Id | null = id;
  while (cur !== null) {
    const n: SceneNode | undefined = p.nodes[cur];
    if (!n) return false;
    if (!n.visible) return false;
    cur = n.parentId;
  }
  return true;
}

export function getDescendantIds(p: Project, id: Id): Id[] {
  const out: Id[] = [];
  const stack = [...getNode(p, id).children].reverse();
  while (stack.length > 0) {
    const cur = stack.pop() as Id;
    out.push(cur);
    const kids = p.nodes[cur]?.children ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

export interface FlatEntry {
  id: Id;
  depth: number;
}

/** Depth-first list of the tree (without the root) for the hierarchy panel. */
export function flattenTree(p: Project): FlatEntry[] {
  const out: FlatEntry[] = [];
  const walk = (id: Id, depth: number) => {
    for (const childId of getNode(p, id).children) {
      out.push({ id: childId, depth });
      walk(childId, depth + 1);
    }
  };
  walk(p.rootId, 0);
  return out;
}

export function worldMatrix(p: Project, id: Id): Mat4 {
  const chain: SceneNode[] = [];
  let cur: Id | null = id;
  while (cur !== null) {
    const n = getNode(p, cur);
    chain.push(n);
    cur = n.parentId;
  }
  let m = identity();
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = chain[i].transform;
    m = multiply(m, compose(t.position, t.rotation, t.scale));
  }
  return m;
}

/** The ancestor directly below the root (the thing a beginner thinks of as "the object"). */
export function topLevelAncestor(p: Project, id: Id): Id {
  let cur = id;
  for (;;) {
    const n = getNode(p, cur);
    if (n.parentId === null || n.parentId === p.rootId) return cur;
    cur = n.parentId;
  }
}

export function countNodes(p: Project): number {
  return Object.keys(p.nodes).length - 1; // exclude root
}

// ----------------------------------------------------------------- mutations
// Every mutation is pure: it returns a new Project and never edits its input.

function touch(p: Project, nodes: Record<Id, SceneNode>, materials = p.materials): Project {
  return { ...p, nodes, materials, updatedAt: new Date().toISOString() };
}

function assertEditable(p: Project, id: Id): void {
  if (isEffectivelyLocked(p, id)) {
    throw new ProjectError('locked', `"${getNode(p, id).name}" is locked`);
  }
}

function assertNotRoot(p: Project, id: Id): void {
  if (id === p.rootId) throw new ProjectError('root-protected', 'The scene root cannot be changed this way');
}

function assertFiniteVec(v: Vec3, label: string): void {
  if (v.length !== 3 || !v.every((n) => Number.isFinite(n))) {
    throw new ProjectError('invalid-input', `${label} must be three finite numbers`);
  }
}

export function assertGeometry(g: GeometryDef): void {
  const pos = (n: number) => Number.isFinite(n) && n > 0 && n <= 10_000;
  if (g.type === 'box') {
    if (!pos(g.width) || !pos(g.height) || !pos(g.depth)) {
      throw new ProjectError('invalid-input', 'Box sizes must be positive numbers');
    }
  } else if (g.type === 'cylinder') {
    if (!pos(g.radius) || !pos(g.height)) {
      throw new ProjectError('invalid-input', 'Cylinder sizes must be positive numbers');
    }
    if (!Number.isInteger(g.segments) || g.segments < 3 || g.segments > 128) {
      throw new ProjectError('invalid-input', 'Cylinder segments must be an integer from 3 to 128');
    }
  } else {
    throw new ProjectError('invalid-input', 'Unknown geometry type');
  }
}

export interface NewNodeSpec {
  name: string;
  kind?: 'group' | 'mesh';
  parentId?: Id;
  transform?: Partial<Transform>;
  geometry?: GeometryDef;
  materialId?: Id;
  meta?: Record<string, MetaValue>;
  visible?: boolean;
  locked?: boolean;
}

export function addNode(p: Project, spec: NewNodeSpec): { project: Project; id: Id } {
  const parentId = spec.parentId ?? p.rootId;
  const parent = getNode(p, parentId);
  if (parent.kind !== 'group') throw new ProjectError('invalid-parent', 'Parts can only be added inside groups');
  assertEditable(p, parentId);
  if (countNodes(p) >= MAX_NODES) throw new ProjectError('invalid-input', 'Project is too large');

  const kind = spec.kind ?? (spec.geometry ? 'mesh' : 'group');
  if (kind === 'mesh' && !spec.geometry) throw new ProjectError('invalid-input', 'A mesh needs geometry');
  if (kind === 'group' && spec.geometry) throw new ProjectError('invalid-input', 'A group cannot have geometry');
  if (spec.geometry) assertGeometry(spec.geometry);

  const materialId = kind === 'mesh' ? (spec.materialId ?? DEFAULT_MATERIAL_ID) : undefined;
  if (materialId !== undefined && !p.materials[materialId]) {
    throw new ProjectError('not-found', `Material not found: ${materialId}`);
  }

  const base = identityTransform();
  const transform: Transform = {
    position: spec.transform?.position ?? base.position,
    rotation: spec.transform?.rotation ?? base.rotation,
    scale: spec.transform?.scale ?? base.scale,
  };
  assertFiniteVec(transform.position, 'Position');
  assertFiniteVec(transform.rotation, 'Rotation');
  assertFiniteVec(transform.scale, 'Scale');

  const id = newId(kind === 'mesh' ? 'm' : 'g');
  const node: SceneNode = {
    id,
    name: cleanName(spec.name),
    kind,
    parentId,
    children: [],
    transform: {
      position: [...transform.position],
      rotation: [...transform.rotation],
      scale: [...transform.scale],
    },
    visible: spec.visible ?? true,
    locked: spec.locked ?? false,
    ...(spec.geometry ? { geometry: { ...spec.geometry } } : {}),
    ...(materialId !== undefined ? { materialId } : {}),
    meta: { ...(spec.meta ?? {}) },
  };
  const nodes = {
    ...p.nodes,
    [id]: node,
    [parentId]: { ...parent, children: [...parent.children, id] },
  };
  return { project: touch(p, nodes), id };
}

function patchNode(p: Project, id: Id, patch: Partial<SceneNode>): Project {
  const node = getNode(p, id);
  return touch(p, { ...p.nodes, [id]: { ...node, ...patch } });
}

export function renameNode(p: Project, id: Id, name: string): Project {
  assertNotRoot(p, id);
  return patchNode(p, id, { name: cleanName(name) });
}

export function renameProject(p: Project, name: string): Project {
  return { ...p, name: cleanName(name), updatedAt: new Date().toISOString() };
}

export function setTransform(p: Project, id: Id, patch: Partial<Transform>): Project {
  assertNotRoot(p, id);
  assertEditable(p, id);
  const node = getNode(p, id);
  const next: Transform = {
    position: patch.position ?? node.transform.position,
    rotation: patch.rotation ?? node.transform.rotation,
    scale: patch.scale ?? node.transform.scale,
  };
  assertFiniteVec(next.position, 'Position');
  assertFiniteVec(next.rotation, 'Rotation');
  assertFiniteVec(next.scale, 'Scale');
  if (next.scale.some((s) => s === 0)) throw new ProjectError('invalid-input', 'Scale cannot be zero');
  return patchNode(p, id, {
    transform: { position: [...next.position], rotation: [...next.rotation], scale: [...next.scale] },
  });
}

export function setGeometry(p: Project, id: Id, geometry: GeometryDef): Project {
  assertNotRoot(p, id);
  assertEditable(p, id);
  const node = getNode(p, id);
  if (node.kind !== 'mesh') throw new ProjectError('invalid-input', 'Only meshes have geometry');
  assertGeometry(geometry);
  return patchNode(p, id, { geometry: { ...geometry } });
}

export function setNodeMaterial(p: Project, id: Id, materialId: Id): Project {
  assertNotRoot(p, id);
  assertEditable(p, id);
  const node = getNode(p, id);
  if (node.kind !== 'mesh') throw new ProjectError('invalid-input', 'Only meshes have a material');
  if (!p.materials[materialId]) throw new ProjectError('not-found', `Material not found: ${materialId}`);
  return patchNode(p, id, { materialId });
}

export function setVisible(p: Project, id: Id, visible: boolean): Project {
  assertNotRoot(p, id);
  return patchNode(p, id, { visible });
}

export function setLocked(p: Project, id: Id, locked: boolean): Project {
  assertNotRoot(p, id);
  return patchNode(p, id, { locked });
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function upsertMaterial(p: Project, mat: MaterialDef): Project {
  if (!HEX.test(mat.color)) throw new ProjectError('invalid-input', 'Color must look like #aabbcc');
  const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (!unit(mat.roughness) || !unit(mat.metalness)) {
    throw new ProjectError('invalid-input', 'Roughness and metalness must be between 0 and 1');
  }
  const material: MaterialDef = { ...mat, name: cleanName(mat.name), color: mat.color.toLowerCase() };
  return touch(p, p.nodes, { ...p.materials, [material.id]: material });
}

export function addMaterial(p: Project, spec: Omit<MaterialDef, 'id'>): { project: Project; id: Id } {
  const id = newId('mat');
  return { project: upsertMaterial(p, { ...spec, id }), id };
}

export function deleteNode(p: Project, id: Id): Project {
  assertNotRoot(p, id);
  assertEditable(p, id);
  const node = getNode(p, id);
  const doomed = new Set<Id>([id, ...getDescendantIds(p, id)]);
  for (const d of doomed) {
    if (d !== id && p.nodes[d].locked) {
      throw new ProjectError('locked', `"${p.nodes[d].name}" inside "${node.name}" is locked`);
    }
  }
  const nodes: Record<Id, SceneNode> = {};
  for (const [nid, n] of Object.entries(p.nodes)) {
    if (!doomed.has(nid)) nodes[nid] = n;
  }
  const parent = nodes[node.parentId as Id];
  nodes[parent.id] = { ...parent, children: parent.children.filter((c) => c !== id) };
  return touch(p, nodes);
}

/** Moves `id` under `newParentId` keeping its on-screen position. `index` counts after removal. */
export function moveNode(p: Project, id: Id, newParentId: Id, index?: number): Project {
  assertNotRoot(p, id);
  assertEditable(p, id);
  const node = getNode(p, id);
  const newParent = getNode(p, newParentId);
  if (newParent.kind !== 'group') throw new ProjectError('invalid-parent', 'Target must be a group');
  if (newParentId === id || isAncestor(p, id, newParentId)) {
    throw new ProjectError('invalid-parent', 'Cannot move a part into itself');
  }
  assertEditable(p, newParentId);

  const world = worldMatrix(p, id);
  const parentWorld = worldMatrix(p, newParentId);
  const local = decompose(multiply(invertAffine(parentWorld), world));

  const nodes: Record<Id, SceneNode> = { ...p.nodes };
  const oldParent = nodes[node.parentId as Id];
  nodes[oldParent.id] = { ...oldParent, children: oldParent.children.filter((c) => c !== id) };

  const target = nodes[newParentId];
  const kids = target.children.filter((c) => c !== id);
  const at = index === undefined ? kids.length : Math.max(0, Math.min(index, kids.length));
  kids.splice(at, 0, id);
  nodes[newParentId] = { ...target, children: kids };
  nodes[id] = {
    ...node,
    parentId: newParentId,
    transform: { position: local.position, rotation: local.rotation, scale: local.scale },
  };
  return touch(p, nodes);
}

export function groupNodes(p: Project, ids: Id[], name = 'Group'): { project: Project; id: Id } {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new ProjectError('invalid-input', 'Select something to group');
  for (const id of unique) {
    assertNotRoot(p, id);
    getNode(p, id);
    assertEditable(p, id);
  }
  const parentId = getNode(p, unique[0]).parentId as Id;
  if (!unique.every((id) => getNode(p, id).parentId === parentId)) {
    throw new ProjectError('different-parents', 'Only parts at the same level can be grouped together');
  }
  const parent = getNode(p, parentId);
  const members = parent.children.filter((c) => unique.includes(c));
  const insertAt = parent.children.indexOf(members[0]);

  const added = addNode(p, { name, kind: 'group', parentId });
  let project = added.project;
  // Place the new group where its first member was, then move members inside.
  const groupNode = getNode(project, added.id);
  const parentNow = getNode(project, parentId);
  const reordered = parentNow.children.filter((c) => c !== added.id);
  reordered.splice(insertAt, 0, added.id);
  project = touch(project, {
    ...project.nodes,
    [parentId]: { ...parentNow, children: reordered },
    [added.id]: groupNode,
  });
  for (const id of members) project = moveNode(project, id, added.id);
  return { project, id: added.id };
}

export function ungroup(p: Project, groupId: Id): { project: Project; childIds: Id[] } {
  assertNotRoot(p, groupId);
  const group = getNode(p, groupId);
  if (group.kind !== 'group') throw new ProjectError('invalid-input', 'Only groups can be ungrouped');
  assertEditable(p, groupId);
  const parentId = group.parentId as Id;
  const parent = getNode(p, parentId);
  const at = parent.children.indexOf(groupId);
  const childIds = [...group.children];
  let project = p;
  childIds.forEach((cid, i) => {
    project = moveNode(project, cid, parentId, at + i);
  });
  project = deleteNode(project, groupId);
  return { project, childIds };
}

/** Deep copy of a node (and children) placed right after the original. */
export function duplicateNode(p: Project, id: Id, offset: Vec3 = [0.5, 0, 0.5]): { project: Project; id: Id } {
  assertNotRoot(p, id);
  const source = getNode(p, id);
  const parentId = source.parentId as Id;
  assertEditable(p, parentId);
  const total = 1 + getDescendantIds(p, id).length;
  if (countNodes(p) + total > MAX_NODES) throw new ProjectError('invalid-input', 'Project is too large');

  const nodes: Record<Id, SceneNode> = { ...p.nodes };
  const copy = (srcId: Id, newParent: Id): Id => {
    const src = p.nodes[srcId];
    const nid = newId(src.kind === 'mesh' ? 'm' : 'g');
    const kids = src.children.map((c) => copy(c, nid));
    nodes[nid] = {
      ...src,
      id: nid,
      parentId: newParent,
      children: kids,
      locked: false,
      transform: {
        position: [...src.transform.position],
        rotation: [...src.transform.rotation],
        scale: [...src.transform.scale],
      },
      ...(src.geometry ? { geometry: { ...src.geometry } } : {}),
      meta: { ...src.meta },
    };
    return nid;
  };
  const newRootId = copy(id, parentId);
  const dup = nodes[newRootId];
  nodes[newRootId] = {
    ...dup,
    name: cleanName(`${source.name} copy`),
    transform: {
      ...dup.transform,
      position: [
        dup.transform.position[0] + offset[0],
        dup.transform.position[1] + offset[1],
        dup.transform.position[2] + offset[2],
      ],
    },
  };
  const parent = p.nodes[parentId];
  const siblings = [...parent.children];
  siblings.splice(siblings.indexOf(id) + 1, 0, newRootId);
  nodes[parentId] = { ...parent, children: siblings };
  return { project: touch(p, nodes), id: newRootId };
}

// -------------------------------------------------------- serialization / IO

export function serializeProject(p: Project): string {
  return JSON.stringify(p);
}

export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectError('invalid-file', 'This file is not valid JSON');
  }
  return migrateProject(raw);
}

/** Upgrades older versions to the current one. Add a case per future version bump. */
export function migrateProject(raw: unknown): Project {
  if (!isRecord(raw)) throw new ProjectError('invalid-file', 'Project file is not an object');
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectError('invalid-file', 'Project file has no valid version');
  }
  if (version > PROJECT_VERSION) {
    throw new ProjectError('invalid-file', 'This project was saved by a newer HomeForge. Please update the app.');
  }
  // version === 1 is current; future: if (version === 1) raw = upgrade1to2(raw);
  return validateProject(raw);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function bad(msg: string): never {
  throw new ProjectError('invalid-file', msg);
}

export function validateProject(raw: Record<string, unknown>): Project {
  if (raw.format !== PROJECT_FORMAT) bad('This is not a HomeForge project file');
  if (typeof raw.id !== 'string' || raw.id.length === 0) bad('Project id is missing');
  if (typeof raw.name !== 'string') bad('Project name is missing');
  if (typeof raw.rootId !== 'string') bad('Project root is missing');
  if (!isRecord(raw.nodes) || !isRecord(raw.materials)) bad('Project data is incomplete');

  const nodeEntries = Object.entries(raw.nodes);
  if (nodeEntries.length === 0 || nodeEntries.length > MAX_NODES + 1) bad('Project has an invalid size');

  const materials: Record<Id, MaterialDef> = {};
  for (const [mid, m] of Object.entries(raw.materials)) {
    if (!isRecord(m) || m.id !== mid) bad('A material entry is broken');
    if (typeof m.name !== 'string' || typeof m.color !== 'string' || !HEX.test(m.color)) bad('A material is invalid');
    const rough = m.roughness;
    const metal = m.metalness;
    if (typeof rough !== 'number' || typeof metal !== 'number' || !(rough >= 0 && rough <= 1) || !(metal >= 0 && metal <= 1)) {
      bad('A material has invalid values');
    }
    materials[mid] = {
      id: mid,
      name: m.name.slice(0, MAX_NAME),
      color: m.color.toLowerCase(),
      roughness: rough,
      metalness: metal,
    };
  }
  if (!materials[DEFAULT_MATERIAL_ID]) {
    materials[DEFAULT_MATERIAL_ID] = {
      id: DEFAULT_MATERIAL_ID,
      name: 'Plaster',
      color: '#d9d4c7',
      roughness: 0.9,
      metalness: 0,
    };
  }

  const nodes: Record<Id, SceneNode> = {};
  for (const [nid, n] of nodeEntries) {
    if (!isRecord(n) || n.id !== nid) bad('A node entry is broken');
    if (typeof n.name !== 'string') bad('A node has no name');
    if (n.kind !== 'group' && n.kind !== 'mesh') bad('A node has an unknown type');
    if (!(n.parentId === null || typeof n.parentId === 'string')) bad('A node has an invalid parent');
    if (!Array.isArray(n.children) || !n.children.every((c) => typeof c === 'string')) bad('A node has invalid children');
    if (!isRecord(n.transform)) bad('A node has no transform');
    const t = n.transform;
    if (!isVec3(t.position) || !isVec3(t.rotation) || !isVec3(t.scale)) bad('A node has an invalid transform');
    if (typeof n.visible !== 'boolean' || typeof n.locked !== 'boolean') bad('A node has invalid flags');

    let geometry: GeometryDef | undefined;
    if (n.kind === 'mesh') {
      if (!isRecord(n.geometry)) bad('A mesh has no geometry');
      geometry = n.geometry as unknown as GeometryDef;
      try {
        assertGeometry(geometry);
      } catch {
        bad('A mesh has invalid geometry');
      }
      if (typeof n.materialId !== 'string' || !materials[n.materialId]) bad('A mesh uses a missing material');
    } else if (n.geometry !== undefined) {
      bad('A group has geometry');
    }

    const meta: Record<string, MetaValue> = {};
    if (n.meta !== undefined) {
      if (!isRecord(n.meta)) bad('A node has invalid metadata');
      for (const [k, v] of Object.entries(n.meta)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') meta[k.slice(0, 60)] = v;
      }
    }

    nodes[nid] = {
      id: nid,
      name: n.name.slice(0, MAX_NAME) || 'Part',
      kind: n.kind,
      parentId: n.parentId as Id | null,
      children: [...(n.children as Id[])],
      transform: {
        position: [...t.position] as Vec3,
        rotation: [...t.rotation] as Vec3,
        scale: [...t.scale] as Vec3,
      },
      visible: n.visible,
      locked: n.locked,
      ...(geometry ? { geometry: { ...geometry } } : {}),
      ...(n.kind === 'mesh' ? { materialId: n.materialId as Id } : {}),
      meta,
    };
  }

  const root = nodes[raw.rootId];
  if (!root) bad('Project root does not exist');
  if (root.parentId !== null || root.kind !== 'group') bad('Project root is invalid');

  // Walk from the root: every node must be reachable exactly once and agree about its parent.
  const seen = new Set<Id>();
  const stack: Id[] = [raw.rootId];
  while (stack.length > 0) {
    const cur = stack.pop() as Id;
    if (seen.has(cur)) bad('The project contains a loop or a duplicated part');
    seen.add(cur);
    const node = nodes[cur];
    if (node.kind === 'mesh' && node.children.length > 0) bad('A mesh cannot contain other parts');
    for (const c of node.children) {
      const child = nodes[c];
      if (!child) bad('A part points to something that does not exist');
      if (child.parentId !== cur) bad('A part disagrees about its parent');
      stack.push(c);
    }
  }
  if (seen.size !== Object.keys(nodes).length) bad('The project has orphaned parts');

  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: raw.id,
    name: cleanName(raw.name, 'Untitled House'),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    rootId: raw.rootId,
    nodes,
    materials,
  };
}
