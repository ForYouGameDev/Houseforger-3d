'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEV_URL = process.env.HOMEFORGE_DEV_URL || null;

function isSafeString(v, max = 200) {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function isSafeExtension(v) {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9.-]{0,30}$/i.test(v);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#12151b',
    title: 'HomeForge 3D',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.removeMenu();

  // Only our own pages may load; external links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('homeforge:save-file', async (event, opts) => {
  if (!opts || !isSafeString(opts.defaultName, 160) || typeof opts.text !== 'string' || !isSafeExtension(opts.extension)) {
    throw new Error('Invalid save request');
  }
  if (Buffer.byteLength(opts.text, 'utf8') > MAX_FILE_BYTES) throw new Error('File is too large to save');
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    defaultPath: opts.defaultName,
    filters: [
      { name: isSafeString(opts.label, 80) ? opts.label : 'HomeForge file', extensions: [opts.extension] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, opts.text, 'utf8');
  return result.filePath;
});

ipcMain.handle('homeforge:open-file', async (event, opts) => {
  if (!opts || !Array.isArray(opts.extensions) || opts.extensions.length === 0 || !opts.extensions.every(isSafeExtension)) {
    throw new Error('Invalid open request');
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: isSafeString(opts.label, 80) ? opts.label : 'HomeForge file', extensions: opts.extensions },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_BYTES) throw new Error('That file is too large to open (limit 50 MB).');
  const text = await fs.readFile(filePath, 'utf8');
  return { name: path.basename(filePath), text };
});

// One window only; focus it if the user starts a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
