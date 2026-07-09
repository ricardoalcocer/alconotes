'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { installContextMenu } = require('./context-menu');

const isMac = process.platform === 'darwin';

// Test hook: lets smoke tests point the app at a throwaway data dir.
if (process.env.ALCONOTES_USER_DATA) app.setPath('userData', process.env.ALCONOTES_USER_DATA);

// ---- The perpetual notebook, now with tabs --------------------------------
// Unsaved "notebook" tabs are auto-persisted under userData/notebooks/, and
// the tab layout (notebook tabs + file tabs + active tab) lives in
// userData/session.json, so the app reopens exactly where you left off.
const USER_DATA = app.getPath('userData');
const NOTEBOOKS_DIR = path.join(USER_DATA, 'notebooks');
const SESSION_PATH = path.join(USER_DATA, 'session.json');
const LEGACY_SCRATCH_PATH = path.join(USER_DATA, 'scratch.md');

const NOTEBOOK_ID_RE = /^nb-[a-z0-9]+$/;

const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'All Files', extensions: ['*'] },
];

function notebookPath(id) {
  return path.join(NOTEBOOKS_DIR, `${id}.md`);
}

function readTextSafe(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function writeNotebook(id, content) {
  if (!NOTEBOOK_ID_RE.test(id)) return;
  try {
    fs.mkdirSync(NOTEBOOKS_DIR, { recursive: true });
    fs.writeFileSync(notebookPath(id), content, 'utf-8');
  } catch (err) {
    console.error('notebook save failed:', err);
  }
}

function deleteNotebook(id) {
  if (!NOTEBOOK_ID_RE.test(id)) return;
  try {
    fs.unlinkSync(notebookPath(id));
  } catch {}
}

function writeSession(session) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), 'utf-8');
  } catch (err) {
    console.error('session save failed:', err);
  }
}

function readSession() {
  const raw = readTextSafe(SESSION_PATH);
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (Array.isArray(s.tabs)) return s;
    } catch {}
  }
  // First run (or corrupt session): migrate the pre-tabs single scratch.md
  // into the first notebook tab. The legacy file is left in place as a backup.
  const legacy = readTextSafe(LEGACY_SCRATCH_PATH);
  writeNotebook('nb-1', legacy || '');
  const session = { tabs: [{ kind: 'scratch', id: 'nb-1', name: 'Notebook' }], active: 0 };
  writeSession(session);
  return session;
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

// Files requested via `open-file` (macOS "Open With") before app is ready.
const pendingOpenFiles = [];
let appReady = false;

function createWindow() {
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
  installContextMenu(win);

  win.once('ready-to-show', () => win.show());

  // Notebook tabs are auto-persisted; only dirty FILE tabs prompt on close.
  win.on('close', (e) => {
    if (win.__forceClose) return;
    const dirty = win.__dirtyFiles || [];
    if (!dirty.length) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [dirty.length === 1 ? 'Save' : 'Save All', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: dirty.length === 1
        ? `Do you want to save the changes you made to ${dirty[0]}?`
        : `You have unsaved changes in ${dirty.length} documents.`,
      detail: `${dirty.join('\n')}\n\nYour changes will be lost if you don't save them.`,
    });
    if (choice === 0) {
      win.webContents.send('window:saveAllAndClose');
    } else if (choice === 1) {
      win.__forceClose = true;
      win.close();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  return win;
}

// Run `fn(win)` against the app window, creating it (and waiting for its
// renderer) if needed.
function withWindow(fn) {
  const win = mainWindow || createWindow();
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => fn(win));
  } else {
    fn(win);
  }
  return win;
}

// Open files as tabs (menu Open…, recent documents, macOS "Open With").
function sendOpenFiles(paths) {
  const files = [];
  for (const p of paths) {
    const content = readTextSafe(p);
    if (content === null) {
      dialog.showMessageBox(mainWindow || undefined, {
        type: 'error',
        message: 'Could not open file',
        detail: p,
      });
      continue;
    }
    app.addRecentDocument(p);
    files.push({ path: p, name: path.basename(p), content });
  }
  if (!files.length) return;
  const win = withWindow((w) => w.webContents.send('tab:openFiles', files));
  win.show();
  win.focus();
}

function promptOpen() {
  const result = dialog.showOpenDialogSync(mainWindow || undefined, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'text', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result) sendOpenFiles(result);
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (appReady) sendOpenFiles([filePath]);
  else pendingOpenFiles.push(filePath);
});

// ---- IPC: session + notebook persistence ----

ipcMain.handle('session:load', () => {
  const session = readSession();
  const tabs = [];
  for (const t of session.tabs) {
    if (t.kind === 'scratch' && NOTEBOOK_ID_RE.test(String(t.id))) {
      tabs.push({
        kind: 'scratch',
        id: t.id,
        name: String(t.name || 'Notebook'),
        content: readTextSafe(notebookPath(t.id)) || '',
      });
    } else if (t.kind === 'file' && typeof t.path === 'string') {
      const content = readTextSafe(t.path);
      // Files that vanished from disk are silently dropped from the session.
      if (content !== null) {
        tabs.push({ kind: 'file', path: t.path, name: path.basename(t.path), content });
      }
    }
  }
  if (!tabs.length) {
    writeNotebook('nb-1', '');
    tabs.push({ kind: 'scratch', id: 'nb-1', name: 'Notebook', content: '' });
  }
  const active = Math.min(Math.max(session.active | 0, 0), tabs.length - 1);
  return { tabs, active };
});

ipcMain.on('session:save', (_event, state) => {
  if (!state || !Array.isArray(state.tabs)) return;
  const tabs = state.tabs
    .map((t) => (t.kind === 'scratch'
      ? { kind: 'scratch', id: String(t.id), name: String(t.name || 'Notebook') }
      : { kind: 'file', path: String(t.path || '') }))
    .filter((t) => (t.kind === 'scratch' ? NOTEBOOK_ID_RE.test(t.id) : t.path.length > 0));
  if (!tabs.length) return;
  writeSession({ tabs, active: Math.min(Math.max(state.active | 0, 0), tabs.length - 1) });
});

ipcMain.on('notebook:save', (_event, { id, content }) => writeNotebook(String(id), String(content ?? '')));
ipcMain.on('notebook:delete', (_event, { id }) => deleteNotebook(String(id)));

// ---- IPC: file save + dialogs ----

function writeUserFile(win, target, content) {
  try {
    fs.writeFileSync(target, String(content ?? ''), 'utf-8');
    app.addRecentDocument(target);
    return { canceled: false, path: target, name: path.basename(target) };
  } catch (err) {
    if (win) {
      dialog.showMessageBox(win, {
        type: 'error',
        message: 'Could not save file',
        detail: String(err.message || err),
      });
    }
    return { canceled: true, error: String(err.message || err) };
  }
}

ipcMain.handle('file:save', async (event, { path: target, content, defaultName } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!target) {
    target = dialog.showSaveDialogSync(win, {
      defaultPath: String(defaultName || 'Notes.md'),
      filters: MD_FILTERS,
    });
    if (!target) return { canceled: true };
  }
  return writeUserFile(win, target, content);
});

ipcMain.handle('file:saveAs', async (event, { content, defaultName } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const target = dialog.showSaveDialogSync(win, {
    defaultPath: String(defaultName || 'Notes.md'),
    filters: MD_FILTERS,
  });
  if (!target) return { canceled: true };
  return writeUserFile(win, target, content);
});

ipcMain.handle('dialog:confirm', async (event, opts = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const buttons = (Array.isArray(opts.buttons) ? opts.buttons : ['OK', 'Cancel'])
    .slice(0, 4)
    .map(String);
  return dialog.showMessageBoxSync(win, {
    type: 'warning',
    message: String(opts.message || ''),
    detail: opts.detail ? String(opts.detail) : undefined,
    buttons,
    defaultId: Number.isInteger(opts.defaultId) ? opts.defaultId : 0,
    cancelId: Number.isInteger(opts.cancelId) ? opts.cancelId : buttons.length - 1,
  });
});

// Renderer reports window-level state: title bar + which FILE tabs are dirty.
ipcMain.on('doc:state', (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !payload) return;
  const dirtyFiles = Array.isArray(payload.dirtyFiles) ? payload.dirtyFiles.map(String) : [];
  win.__dirtyFiles = dirtyFiles;
  win.setDocumentEdited(dirtyFiles.length > 0);
  win.setRepresentedFilename(typeof payload.filePath === 'string' ? payload.filePath : '');
  win.setTitle(String(payload.title || 'AlcoNotes'));
});

// Renderer asks main to finish closing (after save-all triggered by close).
ipcMain.on('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.__forceClose = true;
    win.close();
  }
});

// ---- Menu ----

function sendToFocused(channel, payload) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
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
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => withWindow((w) => w.webContents.send('menu:newTab')) },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => promptOpen() },
        {
          role: 'recentDocuments',
          submenu: [{ label: 'Clear Menu', role: 'clearRecentDocuments' }],
        },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendToFocused('menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendToFocused('menu:saveAs') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendToFocused('menu:closeTab') },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' },
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
        { label: 'Table…', accelerator: 'CmdOrCtrl+Shift+T', click: () => sendToFocused('menu:format', 'table') },
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
          click: () => shell.openExternal('https://github.com/ricardoalcocer/alconotes'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  appReady = true;
  buildMenu();
  createWindow();
  if (pendingOpenFiles.length) {
    sendOpenFiles(pendingOpenFiles.splice(0));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
