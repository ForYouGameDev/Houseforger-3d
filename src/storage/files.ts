// Saving and opening files on every platform:
//  - Electron: native dialogs through the secure preload bridge
//  - Android (Capacitor): write to cache, then the system share sheet
//  - Browser: File System Access API when present, else download / <input type=file>

export interface OpenedFile {
  name: string;
  text: string;
}

interface HomeforgeBridge {
  saveFile(opts: { defaultName: string; text: string; extension: string; label: string }): Promise<string | null>;
  openFile(opts: { extensions: string[]; label: string }): Promise<OpenedFile | null>;
}

declare global {
  interface Window {
    homeforge?: HomeforgeBridge;
    showSaveFilePicker?: (opts: unknown) => Promise<{
      createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
    }>;
  }
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type Platform = 'electron' | 'android' | 'web';

export async function detectPlatform(): Promise<Platform> {
  if (typeof window !== 'undefined' && window.homeforge) return 'electron';
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) return 'android';
  } catch {
    /* not available */
  }
  return 'web';
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 100) : 'homeforge';
}

/** Returns true when the file was written/handed off, false if the user cancelled. */
export async function saveTextFile(opts: {
  defaultName: string;
  text: string;
  extension: string; // without dot, e.g. 'homeforge'
  label: string; // e.g. 'HomeForge project'
  mime?: string;
}): Promise<boolean> {
  const fileName = `${safeFileName(opts.defaultName)}.${opts.extension}`;
  const platform = await detectPlatform();

  if (platform === 'electron' && window.homeforge) {
    const saved = await window.homeforge.saveFile({
      defaultName: fileName,
      text: opts.text,
      extension: opts.extension,
      label: opts.label,
    });
    return saved !== null;
  }

  if (platform === 'android') {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const written = await Filesystem.writeFile({
      path: fileName,
      data: opts.text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({ title: fileName, url: written.uri, dialogTitle: `Save ${opts.label}` });
      return true;
    } catch {
      return false; // user dismissed the share sheet
    }
  }

  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: opts.label, accept: { [opts.mime ?? 'application/json']: [`.${opts.extension}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(opts.text);
      await writable.close();
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      // fall through to a normal download if the picker is blocked
    }
  }

  const blob = new Blob([opts.text], { type: opts.mime ?? 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Lets the user pick a text file. Returns null when cancelled. */
export async function openTextFile(opts: { extensions: string[]; label: string }): Promise<OpenedFile | null> {
  const platform = await detectPlatform();
  if (platform === 'electron' && window.homeforge) {
    return window.homeforge.openFile(opts);
  }

  return new Promise<OpenedFile | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [...opts.extensions.map((e) => `.${e}`), 'application/json'].join(',');
    input.style.display = 'none';
    let settled = false;
    const finish = (v: OpenedFile | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      if (file.size > MAX_FILE_BYTES) {
        settled = true;
        input.remove();
        reject(new Error('That file is too large to open (limit 50 MB).'));
        return;
      }
      file
        .text()
        .then((text) => finish({ name: file.name, text }))
        .catch((e: unknown) => {
          settled = true;
          input.remove();
          reject(e instanceof Error ? e : new Error('Could not read the file'));
        });
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
