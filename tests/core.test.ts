import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compose, decompose, invertAffine, multiply } from '../src/core/math';
import {
  ProjectError,
  addNode,
  createProject,
  deleteNode,
  duplicateNode,
  flattenTree,
  getNode,
  groupNodes,
  isEffectivelyLocked,
  moveNode,
  parseProject,
  renameNode,
  serializeProject,
  setLocked,
  setTransform,
  ungroup,
  worldMatrix,
  type Project,
} from '../src/core/project';
import { canRedo, canUndo, commit, createHistory, redo, undo } from '../src/core/history';
import {
  PRESET_CATEGORIES,
  builtinPresets,
  createPresetFromNode,
  exportPresetPack,
  importPresetPack,
  instantiatePreset,
} from '../src/core/presets';

const box = { type: 'box', width: 1, height: 1, depth: 1 } as const;

function withBoxes(n: number): { p: Project; ids: string[] } {
  let p = createProject('Test');
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = addNode(p, { name: `Box ${i}`, geometry: box, transform: { position: [i, 0, 0] } });
    p = r.project;
    ids.push(r.id);
  }
  return { p, ids };
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof ProjectError && e.code === code);
}

function near(a: number[], b: number[], eps = 1e-9): void {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `index ${i}: ${v} != ${b[i]}`));
}

// ------------------------------------------------------------------- math

test('compose/decompose round-trips position, rotation and scale', () => {
  const pos: [number, number, number] = [1, 2, 3];
  const rot: [number, number, number] = [0.3, -0.5, 1.1];
  const scl: [number, number, number] = [2, 0.5, 3];
  const d = decompose(compose(pos, rot, scl));
  near(d.position, pos);
  near(d.rotation, rot, 1e-9);
  near(d.scale, scl);
});

test('invertAffine gives the identity when multiplied back', () => {
  const m = compose([4, -2, 7], [0.4, 0.9, -0.2], [1.5, 2, 0.7]);
  const id = multiply(m, invertAffine(m));
  near(id, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 1e-9);
});

// ---------------------------------------------------------------- project

test('addNode appends to parent and validates input', () => {
  const { p, ids } = withBoxes(2);
  const root = getNode(p, p.rootId);
  assert.deepEqual(root.children, ids);
  expectCode(() => addNode(p, { name: '  ', geometry: box }), 'invalid-input');
  expectCode(() => addNode(p, { name: 'x', geometry: { type: 'box', width: -1, height: 1, depth: 1 } }), 'invalid-input');
  expectCode(() => addNode(p, { name: 'x', parentId: ids[0], geometry: box }), 'invalid-parent');
  expectCode(() => addNode(p, { name: 'x', parentId: 'nope', geometry: box }), 'not-found');
});

test('mutations never edit their input (immutability)', () => {
  const { p, ids } = withBoxes(1);
  const before = JSON.stringify(p);
  renameNode(p, ids[0], 'Renamed');
  setTransform(p, ids[0], { position: [9, 9, 9] });
  deleteNode(p, ids[0]);
  assert.equal(JSON.stringify(p), before);
});

test('rename trims, rejects empty names and protects the root', () => {
  const { p, ids } = withBoxes(1);
  assert.equal(getNode(renameNode(p, ids[0], '  Living wall  '), ids[0]).name, 'Living wall');
  expectCode(() => renameNode(p, ids[0], '   '), 'invalid-input');
  expectCode(() => renameNode(p, p.rootId, 'x'), 'root-protected');
});

test('setTransform rejects NaN, Infinity and zero scale', () => {
  const { p, ids } = withBoxes(1);
  expectCode(() => setTransform(p, ids[0], { position: [NaN, 0, 0] }), 'invalid-input');
  expectCode(() => setTransform(p, ids[0], { scale: [Infinity, 1, 1] }), 'invalid-input');
  expectCode(() => setTransform(p, ids[0], { scale: [0, 1, 1] }), 'invalid-input');
});

test('locked parts cannot be moved or deleted, and locking is inherited', () => {
  const { p, ids } = withBoxes(2);
  const g = groupNodes(p, [ids[0]], 'G');
  const locked = setLocked(g.project, g.id, true);
  expectCode(() => setTransform(locked, ids[0], { position: [5, 0, 0] }), 'locked');
  expectCode(() => deleteNode(locked, ids[0]), 'locked');
  assert.equal(isEffectivelyLocked(locked, ids[0]), true);
  assert.equal(isEffectivelyLocked(locked, ids[1]), false);
  // unlocking restores editing
  const open = setLocked(locked, g.id, false);
  assert.doesNotThrow(() => setTransform(open, ids[0], { position: [5, 0, 0] }));
});

test('deleteNode removes the whole subtree and fixes the parent', () => {
  const { p, ids } = withBoxes(2);
  const g = groupNodes(p, ids, 'Pair');
  const after = deleteNode(g.project, g.id);
  assert.deepEqual(Object.keys(after.nodes), [after.rootId]);
  assert.deepEqual(getNode(after, after.rootId).children, []);
  expectCode(() => deleteNode(after, after.rootId), 'root-protected');
});

test('group keeps order and world positions; ungroup restores them', () => {
  let { p, ids } = withBoxes(3);
  const worldOf = (proj: Project, id: string) => worldMatrix(proj, id).slice(12, 15);
  const before = ids.map((id) => worldOf(p, id));

  // Give the future group's siblings a rotation by grouping a rotated parent first.
  const outer = groupNodes(p, [ids[0], ids[1]], 'Outer');
  p = setTransform(outer.project, outer.id, { position: [10, 0, 0], rotation: [0, Math.PI / 2, 0] });
  // positions of the grouped boxes changed because the group moved; record them as the new truth
  const grouped = [ids[0], ids[1]].map((id) => worldOf(p, id));

  const un = ungroup(p, outer.id);
  assert.equal(getNode(un.project, un.project.rootId).children.length, 3);
  [ids[0], ids[1]].forEach((id, i) => near(worldOf(un.project, id), grouped[i], 1e-9));
  near(worldOf(un.project, ids[2]), before[2]);
  assert.deepEqual(un.childIds, [ids[0], ids[1]]);
});

test('group rejects parts from different parents and empty selections', () => {
  const { p, ids } = withBoxes(2);
  const g = groupNodes(p, [ids[0]], 'A');
  expectCode(() => groupNodes(g.project, [ids[0], ids[1]], 'bad'), 'different-parents');
  expectCode(() => groupNodes(p, [], 'none'), 'invalid-input');
  expectCode(() => groupNodes(p, [p.rootId], 'root'), 'root-protected');
});

test('moveNode refuses cycles and keeps world position', () => {
  const { p, ids } = withBoxes(2);
  const g = groupNodes(p, [ids[0]], 'G');
  const moved = setTransform(g.project, g.id, { position: [0, 0, 7] });
  const before = worldMatrix(moved, ids[1]).slice(12, 15);
  const into = moveNode(moved, ids[1], g.id);
  near(worldMatrix(into, ids[1]).slice(12, 15), before);
  expectCode(() => moveNode(into, g.id, ids[0]), 'invalid-parent'); // mesh target
  expectCode(() => moveNode(into, g.id, g.id), 'invalid-parent'); // itself
  const nested = groupNodes(into, [g.id], 'Outer');
  expectCode(() => moveNode(nested.project, nested.id, g.id), 'invalid-parent'); // own descendant
});

test('duplicateNode deep-copies with fresh ids', () => {
  const { p, ids } = withBoxes(2);
  const g = groupNodes(p, ids, 'Pair');
  const dup = duplicateNode(g.project, g.id);
  const copyNode = getNode(dup.project, dup.id);
  assert.equal(copyNode.children.length, 2);
  assert.ok(copyNode.children.every((c) => !ids.includes(c)));
  assert.equal(copyNode.name, 'Pair copy');
  assert.equal(Object.keys(dup.project.nodes).length, Object.keys(g.project.nodes).length + 3);
});

test('flattenTree lists depth-first with depths', () => {
  const { p, ids } = withBoxes(2);
  const g = groupNodes(p, ids, 'Pair');
  const flat = flattenTree(g.project);
  assert.deepEqual(
    flat.map((e) => e.depth),
    [0, 1, 1],
  );
});

test('save -> parse round-trips exactly', () => {
  const { p } = withBoxes(3);
  const back = parseProject(serializeProject(p));
  assert.deepEqual(back, p);
});

test('parseProject rejects invalid, corrupt and newer files', () => {
  const { p, ids } = withBoxes(2);
  const raw = JSON.parse(serializeProject(p));

  expectCode(() => parseProject('{nope'), 'invalid-file');
  expectCode(() => parseProject('[]'), 'invalid-file');
  expectCode(() => parseProject(JSON.stringify({ ...raw, version: 99 })), 'invalid-file');
  expectCode(() => parseProject(JSON.stringify({ ...raw, format: 'other' })), 'invalid-file');

  const missingChild = structuredClone(raw);
  missingChild.nodes[p.rootId].children.push('ghost');
  expectCode(() => parseProject(JSON.stringify(missingChild)), 'invalid-file');

  const orphan = structuredClone(raw);
  orphan.nodes[p.rootId].children = [ids[0]];
  expectCode(() => parseProject(JSON.stringify(orphan)), 'invalid-file');

  const badParent = structuredClone(raw);
  badParent.nodes[ids[0]].parentId = ids[1];
  expectCode(() => parseProject(JSON.stringify(badParent)), 'invalid-file');

  const badVec = structuredClone(raw);
  badVec.nodes[ids[0]].transform.position = [1, 'x', 3];
  expectCode(() => parseProject(JSON.stringify(badVec)), 'invalid-file');

  const badMat = structuredClone(raw);
  badMat.nodes[ids[0]].materialId = 'missing';
  expectCode(() => parseProject(JSON.stringify(badMat)), 'invalid-file');

  const loop = structuredClone(raw);
  loop.nodes[p.rootId].children = [ids[0], ids[0]];
  expectCode(() => parseProject(JSON.stringify(loop)), 'invalid-file');
});

// ---------------------------------------------------------------- history

test('history: undo, redo, branching and bounded size', () => {
  let h = createHistory(0, 3);
  for (let i = 1; i <= 5; i++) h = commit(h, i);
  assert.equal(h.present, 5);
  assert.equal(h.past.length, 3); // bounded
  h = undo(h);
  h = undo(h);
  assert.equal(h.present, 3);
  assert.ok(canRedo(h));
  h = redo(h);
  assert.equal(h.present, 4);
  h = commit(h, 99); // new branch clears redo
  assert.equal(canRedo(h), false);
  while (canUndo(h)) h = undo(h);
  assert.equal(h.present, 2); // oldest kept state after trimming
});

test('history: coalescing merges a drag into one undo step', () => {
  let h = createHistory('a');
  h = commit(h, 'b', 'drag');
  h = commit(h, 'c', 'drag');
  h = commit(h, 'd', 'drag');
  assert.equal(h.past.length, 1);
  h = undo(h);
  assert.equal(h.present, 'a');
});

test('history: committing the same value is a no-op and bad limits throw', () => {
  const h = createHistory(1);
  assert.equal(commit(h, 1), h);
  assert.throws(() => createHistory(1, 0));
});

// ---------------------------------------------------------------- presets

test('built-in presets are valid and instantiate into a project', () => {
  const presets = builtinPresets();
  assert.ok(presets.length >= 6);
  assert.ok(presets.every((p) => (PRESET_CATEGORIES as readonly string[]).includes(p.category)));
  let p = createProject('Presets');
  for (const preset of presets) p = instantiatePreset(p, preset, { position: [1, 0, 2] }).project;
  assert.equal(getNode(p, p.rootId).children.length, presets.length);
  // survives a save/load cycle (so every generated node is valid)
  assert.doesNotThrow(() => parseProject(serializeProject(p)));
});

test('instantiating twice reuses identical materials and tags the origin preset', () => {
  const wall = builtinPresets()[0];
  let p = createProject('M');
  const a = instantiatePreset(p, wall);
  p = instantiatePreset(a.project, wall).project;
  const plasterCount = Object.values(p.materials).filter((m) => m.name === 'Plaster' && m.color === '#d9d4c7').length;
  assert.equal(plasterCount, 1); // identical material is reused, not duplicated
  const root = getNode(p, a.id);
  assert.equal(root.meta.presetId, wall.id);
});

test('preset round trip keeps geometry, children and resets the root position', () => {
  const door = builtinPresets().find((x) => x.category === 'door')!;
  const placed = instantiatePreset(createProject('Source'), door, { position: [8, 0, 3] });
  const saved = createPresetFromNode(placed.project, placed.id, { name: 'My door', category: 'door' });
  assert.deepEqual(saved.root.transform.position, [0, 0, 0]);
  assert.equal(saved.root.children.length, door.root.children.length);

  const text = exportPresetPack([saved, door]);
  assert.ok(!text.includes('"builtIn"'));
  const imported = importPresetPack(text);
  assert.equal(imported.length, 2);
  assert.notEqual(imported[0].id, saved.id); // always fresh ids
  assert.equal(imported[0].builtIn, undefined);

  const target = instantiatePreset(createProject('Target'), imported[0], { position: [1, 0, 1] });
  const root = getNode(target.project, target.id);
  assert.deepEqual(root.transform.position, [1, 0, 1]);
  assert.equal(root.children.length, door.root.children.length);
});

test('importPresetPack rejects malformed and hostile files', () => {
  const good = JSON.parse(exportPresetPack([builtinPresets()[0]]));
  const fails = (mutate: (x: any) => void) => {
    const c = structuredClone(good);
    mutate(c);
    expectCode(() => importPresetPack(JSON.stringify(c)), 'invalid-file');
  };
  expectCode(() => importPresetPack('not json'), 'invalid-file');
  expectCode(() => importPresetPack('{}'), 'invalid-file');
  fails((c) => (c.version = 42));
  fails((c) => (c.presets = []));
  fails((c) => (c.presets[0].category = 'spaceship'));
  fails((c) => (c.presets[0].materials[0].color = 'red'));
  fails((c) => (c.presets[0].root.children[0].geometry.width = -5));
  fails((c) => (c.presets[0].root.children[0].materialKey = 'nope'));
  fails((c) => (c.presets[0].root.children[0].transform.scale = [0, 1, 1]));
  fails((c) => (c.presets[0].root.children[0].transform.position = [1, 2]));

  // absurdly deep nesting must be refused instead of overflowing the stack
  const deep = structuredClone(good);
  let node = deep.presets[0].root;
  for (let i = 0; i < 100; i++) {
    const next = { name: 'g', kind: 'group', transform: node.transform, meta: {}, children: [] as unknown[] };
    node.children = [next];
    node = next;
  }
  expectCode(() => importPresetPack(JSON.stringify(deep)), 'invalid-file');
});

test('createPresetFromNode validates its input', () => {
  const { p, ids } = withBoxes(1);
  expectCode(() => createPresetFromNode(p, p.rootId, { name: 'x', category: 'wall' }), 'root-protected');
  expectCode(() => createPresetFromNode(p, ids[0], { name: ' ', category: 'wall' }), 'invalid-input');
  expectCode(() => createPresetFromNode(p, ids[0], { name: 'ok', category: 'nope' as never }), 'invalid-input');
});
