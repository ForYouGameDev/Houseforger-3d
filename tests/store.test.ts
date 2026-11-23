import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EditorStore } from '../src/editor/store';
import { getNode, setLocked } from '../src/core/project';

function boxStore(): EditorStore {
  const s = new EditorStore();
  s.addPrimitive('box');
  return s;
}

test('adding, selecting, undo and redo work end to end', () => {
  const s = boxStore();
  assert.equal(s.getState().selection.length, 1);
  assert.equal(getNode(s.project, s.project.rootId).children.length, 1);
  s.undo();
  assert.equal(getNode(s.project, s.project.rootId).children.length, 0);
  assert.equal(s.getState().selection.length, 0); // pruned, nothing dangling
  s.redo();
  assert.equal(getNode(s.project, s.project.rootId).children.length, 1);
});

test('a drag of many transform edits is one undo step', () => {
  const s = boxStore();
  const id = s.getState().selection[0];
  for (let i = 1; i <= 10; i++) s.setTransform(id, { position: [i, 0.5, 0] });
  assert.deepEqual(getNode(s.project, id).transform.position, [10, 0.5, 0]);
  s.undo();
  assert.deepEqual(getNode(s.project, id).transform.position, [0, 0.5, 0]);
});

test('errors become notices and never change the project', () => {
  const s = boxStore();
  const id = s.getState().selection[0];
  const before = s.project;
  s.setTransform(id, { scale: [0, 1, 1] });
  assert.equal(s.project, before);
  assert.equal(s.getState().notice?.kind, 'error');
  s.dismissNotice();
  assert.equal(s.getState().notice, null);
});

test('easy mode picks the whole preset, advanced mode picks the part', () => {
  const s = new EditorStore();
  const door = s.getState().presets.find((p) => p.category === 'door')!;
  s.addPreset(door.id);
  const top = s.getState().selection[0];
  const part = getNode(s.project, top).children[0];

  s.select([]);
  s.pick(part, false);
  assert.deepEqual(s.getState().selection, [top]);

  s.setMode('advanced');
  s.pick(part, false);
  assert.deepEqual(s.getState().selection, [part]);
  s.pick(part, true); // additive click toggles it off
  assert.deepEqual(s.getState().selection, []);
});

test('group / ungroup / duplicate / delete via the store', () => {
  const s = boxStore();
  s.addPrimitive('cylinder');
  const ids = getNode(s.project, s.project.rootId).children;
  s.select(ids);
  s.groupSelected();
  assert.equal(getNode(s.project, s.project.rootId).children.length, 1);
  s.duplicateSelected();
  assert.equal(getNode(s.project, s.project.rootId).children.length, 2);
  s.ungroupSelected(); // releases the copy's two parts next to the original group
  assert.equal(getNode(s.project, s.project.rootId).children.length, 3);
  assert.equal(s.getState().selection.length, 2);
  s.deleteSelected(); // deletes just those two released parts
  assert.equal(getNode(s.project, s.project.rootId).children.length, 1);
});

test('locked parts are protected from deletion with a clear message', () => {
  const s = boxStore();
  const id = s.getState().selection[0];
  s.setLocked(id, true);
  s.deleteSelected();
  assert.ok(getNode(s.project, id));
  assert.match(s.getState().notice?.text ?? '', /locked/);
  assert.equal(setLocked(s.project, id, false).nodes[id].locked, false);
});

test('user presets can be saved from a selection and deleted; built-ins are protected', () => {
  const s = boxStore();
  assert.equal(s.savePresetFromSelection('My box', 'other'), true);
  const mine = s.userPresets();
  assert.equal(mine.length, 1);
  s.deletePreset(s.getState().presets[0].id); // a built-in
  assert.match(s.getState().notice?.text ?? '', /Built-in/);
  s.deletePreset(mine[0].id);
  assert.equal(s.userPresets().length, 0);

  s.select([]);
  assert.equal(s.savePresetFromSelection('Nothing', 'wall'), false);
});

test('loading a project clears history and bumps the epoch', () => {
  const s = boxStore();
  const epoch = s.getState().projectEpoch;
  s.newProject();
  assert.equal(s.getState().projectEpoch, epoch + 1);
  assert.equal(s.getState().history.past.length, 0);
});
