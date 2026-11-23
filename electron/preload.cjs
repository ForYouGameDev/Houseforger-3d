'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The renderer never gets Node or the filesystem. It only gets these two
// narrow, validated calls (see main.cjs).
contextBridge.exposeInMainWorld('homeforge', {
  saveFile: (opts) => ipcRenderer.invoke('homeforge:save-file', opts),
  openFile: (opts) => ipcRenderer.invoke('homeforge:open-file', opts),
});
