'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Channels the renderer is allowed to listen on.
const incoming = [
  'tab:openFiles',
  'window:saveAllAndClose',
  'menu:newTab',
  'menu:closeTab',
  'menu:save',
  'menu:saveAs',
  'menu:find',
  'menu:replace',
  'menu:format',
  'menu:togglePreview',
  'menu:viewMode',
  'menu:toggleLineNumbers',
  'menu:toggleLineWrap',
  'menu:zoom',
  'menu:exportPdf',
];

contextBridge.exposeInMainWorld('api', {
  sessionLoad: () => ipcRenderer.invoke('session:load'),
  sessionSave: (state) => ipcRenderer.send('session:save', state),
  notebookSave: (id, content) => ipcRenderer.send('notebook:save', { id, content }),
  notebookDelete: (id) => ipcRenderer.send('notebook:delete', { id }),
  zoomSet: (factor) => ipcRenderer.send('zoom:set', factor),
  imageSave: (payload) => ipcRenderer.invoke('image:save', payload),
  imageBaseDir: (tab) => ipcRenderer.invoke('image:baseDir', tab),
  save: (payload) => ipcRenderer.invoke('file:save', payload),
  saveAs: (payload) => ipcRenderer.invoke('file:saveAs', payload),
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  confirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts),
  setDocState: (state) => ipcRenderer.send('doc:state', state),
  requestClose: () => ipcRenderer.send('window:close'),
  on: (channel, handler) => {
    if (!incoming.includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => handler(payload));
  },
});
