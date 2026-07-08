'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Menu/main -> renderer events the renderer can subscribe to.
const incoming = [
  'file:loaded',
  'scratch:loaded',
  'menu:save',
  'menu:saveAs',
  'menu:find',
  'menu:replace',
  'menu:format',
  'menu:togglePreview',
  'menu:viewMode',
  'menu:toggleLineNumbers',
  'menu:toggleLineWrap',
];

contextBridge.exposeInMainWorld('api', {
  // File services (renderer -> main -> renderer)
  save: (payload) => ipcRenderer.invoke('file:save', payload),
  saveAs: (payload) => ipcRenderer.invoke('file:saveAs', payload),

  // Perpetual-notebook autosave
  saveScratch: (content) => ipcRenderer.send('scratch:save', content),

  // One-way notifications renderer -> main
  setDocState: (state) => ipcRenderer.send('doc:state', state),
  requestClose: () => ipcRenderer.send('window:close'),
  newWindow: () => ipcRenderer.send('window:new'),
  openDialog: () => ipcRenderer.send('window:openDialog'),

  // Subscribe to main -> renderer events. Returns an unsubscribe fn.
  on: (channel, handler) => {
    if (!incoming.includes(channel)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
