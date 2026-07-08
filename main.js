'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';

// The perpetual notebook: a single always-there scratch document that is
// auto-persisted to disk, so the app opens to the same note every time and
// never needs an explicit save.
const SCRATCH_PATH = path.join(app.getPath('userData'), 'scratch.md');

function readScratch() {
  try {
    return fs.readFileSync(SCRATCH_PATH, 'utf-8');
  } catch {
    return '';
  }
}

function writeScratch(content) {
  try {
    fs.mkdirSync(path.dirname(SCRATCH_PATH), { recursive: true });
    fs.writeFileSync(SCRATCH_PATH, content, 'utf-8');
  } catch (err) {
    console.error('scratch save failed:', err);
  }
}

/** @type {Set<BrowserWindow>} */
const windows = new Set();

// Files requested via `open-file` (macOS "Open With") before app is ready.
const pendingOpenFiles = [];
let appReady = false;

function createWindow(filePath = null, opts = {}) {
  const scratch = !!opts.scratch && !filePath;
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 480,
    minHeight: 320,
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  win.loadFile('index.html');

  win.__scratch = scratch;

  win.once('ready-to-show', () => {
    win.show();
    if (filePath) {
      loadFileIntoWindow(win, filePath);
    } else if (scratch) {
      win.__displayName = 'Notebook';
      win.setTitle('Notebook');
      win.webContents.send('scratch:loaded', { content: readScratch() });
    }
  });

  // Confirm-on-close when the document has unsaved changes.
  // The perpetual notebook is auto-persisted, so it never prompts.
  win.on('close', (e) => {
    if (win.__forceClose || win.__scratch) return;
    if (win.__dirty) {
      e.preventDefault();
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: `Do you want to save the changes you made to ${win.__displayName || 'this document'}?`,
        detail: "Your changes will be lost if you don't save them.",
      });
      if (choice === 0) {
        // Ask renderer to save, then close when done.
        win.webContents.send('menu:save', { closeAfter: true });
      } else if (choice === 1) {
        win.__forceClose = true;
        win.close();
      }
      // choice === 2 -> cancel, do nothing
    }
  });

  win.on('closed', () => windows.delete(win));
  windows.add(win);
  return win;
}

function readFileSafe(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content;
}

function loadFileIntoWindow(win, filePath) {
  try {
    const content = readFileSafe(filePath);
    win.__filePath = filePath;
    win.__displayName = path.basename(filePath);
    win.setRepresentedFilename(filePath);
    win.setTitle(win.__displayName);
    app.addRecentDocument(filePath);
    win.webContents.send('file:loaded', { filePath, content });
  } catch (err) {
    dialog.showMessageBox(win, {
      type: 'error',
      message: 'Could not open file',
      detail: String(err.message || err),
    });
  }
}

// Open a file: reuse a blank, clean window if one is focused; else new window.
function openFile(filePath) {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.__dirty && !focused.__filePath && focused.__empty) {
    loadFileIntoWindow(focused, filePath);
  } else {
    createWindow(filePath);
  }
}

function promptOpen() {
  const win = BrowserWindow.getFocusedWindow();
  const result = dialog.showOpenDialogSync(win || undefined, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'text', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result) result.forEach(openFile);
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (appReady) openFile(filePath);
  else pendingOpenFiles.push(filePath);
});

// ---- IPC: file services invoked from the renderer ----

// Renderer sends content to be written. `filePath` may be null (untitled) -> Save As.
ipcMain.handle('file:save', async (event, { filePath, content }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  // The notebook has no file identity — saving it just exports a copy.
  const isScratch = win && win.__scratch;
  let target = isScratch ? null : filePath;
  if (!target) {
    target = dialog.showSaveDialogSync(win, {
      defaultPath: (win && !isScratch && win.__displayName) || 'Notes.md',
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!target) return { canceled: true };
  }
  try {
    fs.writeFileSync(target, content, 'utf-8');
    if (win && !isScratch) {
      win.__filePath = target;
      win.__displayName = path.basename(target);
      win.setRepresentedFilename(target);
      win.setTitle(win.__displayName);
    }
    app.addRecentDocument(target);
    // For the notebook, `adopt: false` tells the renderer to stay the notebook.
    return { canceled: false, filePath: target, displayName: path.basename(target), adopt: !isScratch };
  } catch (err) {
    if (win) dialog.showMessageBox(win, { type: 'error', message: 'Could not save file', detail: String(err.message || err) });
    return { canceled: true, error: String(err.message || err) };
  }
});

ipcMain.handle('file:saveAs', async (event, { content }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const isScratch = win && win.__scratch;
  const target = dialog.showSaveDialogSync(win, {
    defaultPath: (win && !isScratch && win.__displayName) || 'Notes.md',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!target) return { canceled: true };
  fs.writeFileSync(target, content, 'utf-8');
  if (!isScratch) {
    win.__filePath = target;
    win.__displayName = path.basename(target);
    win.setRepresentedFilename(target);
    win.setTitle(win.__displayName);
  }
  app.addRecentDocument(target);
  return { canceled: false, filePath: target, displayName: path.basename(target), adopt: !isScratch };
});

// Renderer notifies main of document state (dirty flag, title).
ipcMain.on('doc:state', (event, { dirty, displayName, filePath, empty }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.__dirty = !!dirty;
  win.__empty = !!empty;
  if (displayName !== undefined) win.__displayName = displayName;
  if (filePath !== undefined) win.__filePath = filePath;
  win.setDocumentEdited(!!dirty);
  const base = win.__displayName || 'Untitled';
  win.setTitle(base);
});

// Renderer asks main to finish closing (after a save triggered by close).
ipcMain.on('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.__forceClose = true;
    win.close();
  }
});

ipcMain.on('window:new', () => createWindow());
ipcMain.on('window:openDialog', () => promptOpen());

// Perpetual-notebook autosave (renderer debounces; main just writes).
ipcMain.on('scratch:save', (_event, content) => writeScratch(content));

// ---- Menu ----

function sendToFocused(channel, payload) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send(channel, payload);
}

function buildMenu() {
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => promptOpen() },
        {
          role: 'recentDocuments',
          submenu: [{ label: 'Clear Menu', role: 'clearRecentDocuments' }],
        },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendToFocused('menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendToFocused('menu:saveAs') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => sendToFocused('menu:find') },
        { label: 'Replace…', accelerator: 'CmdOrCtrl+Alt+F', click: () => sendToFocused('menu:replace') },
      ],
    },
    {
      label: 'Format',
      submenu: [
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: () => sendToFocused('menu:format', 'bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: () => sendToFocused('menu:format', 'italic') },
        { label: 'Inline Code', accelerator: 'CmdOrCtrl+K', click: () => sendToFocused('menu:format', 'code') },
        { label: 'Link', accelerator: 'CmdOrCtrl+Shift+K', click: () => sendToFocused('menu:format', 'link') },
        { label: 'Image', accelerator: 'CmdOrCtrl+Shift+I', click: () => sendToFocused('menu:format', 'image') },
        { type: 'separator' },
        { label: 'Heading 1', accelerator: 'CmdOrCtrl+1', click: () => sendToFocused('menu:format', 'h1') },
        { label: 'Heading 2', accelerator: 'CmdOrCtrl+2', click: () => sendToFocused('menu:format', 'h2') },
        { label: 'Heading 3', accelerator: 'CmdOrCtrl+3', click: () => sendToFocused('menu:format', 'h3') },
        { type: 'separator' },
        { label: 'Bulleted List', accelerator: 'CmdOrCtrl+Shift+8', click: () => sendToFocused('menu:format', 'ul') },
        { label: 'Numbered List', accelerator: 'CmdOrCtrl+Shift+7', click: () => sendToFocused('menu:format', 'ol') },
        { label: 'Blockquote', accelerator: 'CmdOrCtrl+Shift+.', click: () => sendToFocused('menu:format', 'quote') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Preview', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendToFocused('menu:togglePreview') },
        { label: 'Editor Only', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendToFocused('menu:viewMode', 'editor') },
        { label: 'Preview Only', accelerator: 'CmdOrCtrl+Shift+R', click: () => sendToFocused('menu:viewMode', 'preview') },
        { type: 'separator' },
        { label: 'Toggle Line Numbers', click: () => sendToFocused('menu:toggleLineNumbers') },
        { label: 'Toggle Line Wrap', click: () => sendToFocused('menu:toggleLineWrap') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'AlcoNotes on GitHub',
          click: () => shell.openExternal('https://github.com/'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  appReady = true;
  buildMenu();
  if (pendingOpenFiles.length) {
    pendingOpenFiles.forEach(openFile);
    pendingOpenFiles.length = 0;
  } else {
    createWindow(null, { scratch: true });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(null, { scratch: true });
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
