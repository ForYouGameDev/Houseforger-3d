import { exportPresetPack, importPresetPack } from '../core/presets';
import { ProjectError, parseProject, serializeProject } from '../core/project';
import type { EditorStore } from '../editor/store';
import { saveProject } from '../storage/db';
import { openTextFile, saveTextFile } from '../storage/files';

export function messageOf(e: unknown): string {
  if (e instanceof ProjectError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

export async function openProjectFromFile(store: EditorStore): Promise<void> {
  try {
    const file = await openTextFile({ extensions: ['homeforge', 'json'], label: 'HomeForge project' });
    if (!file) return;
    const project = parseProject(file.text);
    store.loadProject(project);
    store.info(`Opened "${project.name}"`);
  } catch (e) {
    store.error(`Could not open the project: ${messageOf(e)}`);
  }
}

export async function saveProjectToFile(store: EditorStore): Promise<void> {
  try {
    const project = store.project;
    const done = await saveTextFile({
      defaultName: project.name,
      text: serializeProject(project),
      extension: 'homeforge',
      label: 'HomeForge project',
    });
    if (done) store.info('Project file saved');
  } catch (e) {
    store.error(`Could not save the file: ${messageOf(e)}`);
  }
}

export async function saveProjectInBrowser(store: EditorStore): Promise<boolean> {
  try {
    await saveProject(store.project);
    store.info('Saved in this device');
    return true;
  } catch (e) {
    store.error(`Could not save here: ${messageOf(e)}`);
    return false;
  }
}

export async function exportMyPresets(store: EditorStore): Promise<void> {
  const mine = store.userPresets();
  if (mine.length === 0) {
    store.error('You have no saved presets yet. Select a part and use "Save as preset" first.');
    return;
  }
  try {
    const done = await saveTextFile({
      defaultName: 'my-presets',
      text: exportPresetPack(mine),
      extension: 'homeforge-presets',
      label: 'HomeForge presets',
    });
    if (done) store.info(`Exported ${mine.length} preset${mine.length === 1 ? '' : 's'}`);
  } catch (e) {
    store.error(`Could not export presets: ${messageOf(e)}`);
  }
}

export async function importPresetsFromFile(store: EditorStore): Promise<void> {
  try {
    const file = await openTextFile({ extensions: ['homeforge-presets', 'json'], label: 'HomeForge presets' });
    if (!file) return;
    store.addImportedPresets(importPresetPack(file.text));
  } catch (e) {
    store.error(`Could not import presets: ${messageOf(e)}`);
  }
}
