'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { installContextMenu } = require('./context-menu');

const isMac = process.platform === 'darwin';

// Local images dropped/pasted into the editor are copied into a sidecar
// `<note>.assets/` folder and referenced by a relative path in the Markdown.
// The preview can't load those via file:// (blocked by CSP), so they're served
// through this privileged `asset://` scheme instead. Must be registered before
// the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff', ico: 'image/x-icon',
};

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

const SETTINGS_PATH = path.join(USER_DATA, 'settings.json');

// One-time migration: the app used to be called AlcoNotes, and the userData
// folder follows the product name. Copy the old data over on first launch
// (the old folder is left in place as a backup). The env overrides exist for
// tests; a test dir without an explicit old-dir skips migration entirely.
const OLD_USER_DATA = process.env.ALCONOTES_OLD_USER_DATA
  || path.join(app.getPath('appData'), 'AlcoNotes');
const SKIP_MIGRATION = !!process.env.ALCONOTES_USER_DATA && !process.env.ALCONOTES_OLD_USER_DATA;

function migrateLegacyUserData() {
  try {
    if (SKIP_MIGRATION) return;
    if (fs.existsSync(SESSION_PATH)) return;         // already migrated / fresh data exists
    if (!fs.existsSync(OLD_USER_DATA)) return;       // nothing to migrate
    fs.mkdirSync(USER_DATA, { recursive: true });
    for (const entry of ['session.json', 'settings.json', 'scratch.md']) {
      const src = path.join(OLD_USER_DATA, entry);
      const dst = path.join(USER_DATA, entry);
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
    const oldNotebooks = path.join(OLD_USER_DATA, 'notebooks');
    if (fs.existsSync(oldNotebooks)) {
      fs.mkdirSync(NOTEBOOKS_DIR, { recursive: true });
      for (const f of fs.readdirSync(oldNotebooks)) {
        const dst = path.join(NOTEBOOKS_DIR, f);
        if (!fs.existsSync(dst)) fs.copyFileSync(path.join(oldNotebooks, f), dst);
      }
    }
  } catch (err) {
    console.error('legacy data migration failed:', err);
  }
}
migrateLegacyUserData();

const NOTEBOOK_ID_RE = /^nb-[a-z0-9]+$/;
const THEMES = ['system', 'light', 'dark'];

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

// ---- Sidecar image assets -------------------------------------------------
// Resolve a tab descriptor ({kind, id?, path?}) to the note's on-disk path.
// File tabs live wherever the user saved them; notebook tabs live under
// userData/notebooks/. Either way, images go in a sibling `<name>.assets/`.
function notePathFor(tab) {
  if (!tab || typeof tab !== 'object') return null;
  if (tab.kind === 'file' && typeof tab.path === 'string' && tab.path) return tab.path;
  if (tab.kind === 'scratch' && NOTEBOOK_ID_RE.test(String(tab.id))) return notebookPath(String(tab.id));
  return null;
}

function assetsDirFor(notePath) {
  const dir = path.dirname(notePath);
  const stem = path.basename(notePath, path.extname(notePath));
  return path.join(dir, `${stem}.assets`);
}

function baseDirFor(tab) {
  const notePath = notePathFor(tab);
  return notePath ? path.dirname(notePath) : null;
}

// Copy raw image bytes into the note's sidecar assets folder, named by a short
// content hash so identical drops/pastes de-duplicate. Returns the path to
// embed in Markdown (relative to the note) plus the absolute path.
function saveImageAsset(tab, bytes, ext) {
  const notePath = notePathFor(tab);
  if (!notePath) return { error: 'no note context' };
  const buf = Buffer.from(bytes);
  if (!buf.length) return { error: 'empty image' };
  const safeExt = String(ext || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
  const fileName = `${hash}.${safeExt}`;
  const assetsDir = assetsDirFor(notePath);
  const absPath = path.join(assetsDir, fileName);
  try {
    fs.mkdirSync(assetsDir, { recursive: true });
    if (!fs.existsSync(absPath)) fs.writeFileSync(absPath, buf);
  } catch (err) {
    return { error: String(err.message || err) };
  }
  // Forward slashes keep the Markdown portable across platforms.
  const relPath = path.relative(path.dirname(notePath), absPath).split(path.sep).join('/');
  return { relPath, absPath };
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

function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...readSettings(), ...patch }, null, 2), 'utf-8');
  } catch (err) {
    console.error('settings save failed:', err);
  }
}

// Appearance: 'system' | 'light' | 'dark'. Setting nativeTheme.themeSource
// drives prefers-color-scheme in the renderer, which the CSS + editor theme
// both react to.
let themePref = THEMES.includes(readSettings().theme) ? readSettings().theme : 'system';

function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  themePref = theme;
  nativeTheme.themeSource = theme;
  writeSettings({ theme });
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

  // window.open from the renderer (preview links, ⌘-click in the editor)
  // goes to the default browser — never a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

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

// ---- IPC: sidecar image assets ----

ipcMain.handle('image:save', (_event, { tab, bytes, ext } = {}) => saveImageAsset(tab, bytes, ext));
ipcMain.handle('image:baseDir', (_event, tab) => baseDirFor(tab));

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
  win.setTitle(String(payload.title || 'Buffer'));
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
        { label: 'Checkbox', accelerator: 'CmdOrCtrl+Shift+X', click: () => sendToFocused('menu:format', 'task') },
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
        {
          label: 'Appearance',
          submenu: [
            { label: 'System', type: 'radio', checked: themePref === 'system', click: () => setTheme('system') },
            { label: 'Light', type: 'radio', checked: themePref === 'light', click: () => setTheme('light') },
            { label: 'Dark', type: 'radio', checked: themePref === 'dark', click: () => setTheme('dark') },
          ],
        },
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
          label: 'Buffer on GitHub',
          click: () => shell.openExternal('https://github.com/ricardoalcocer/alconotes'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  appReady = true;

  // Serve sidecar images to the preview. The renderer encodes an absolute path
  // as `asset://local/<encoded-abs-path>`; we only ever serve files that live
  // inside a `.assets/` folder, so a renderer bug can't turn this into an
  // arbitrary-file reader.
  protocol.handle('asset', async (request) => {
    try {
      const abs = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
      const normalized = abs.split(path.sep).join('/');
      if (!/\.assets\/[^/]+$/.test(normalized)) {
        return new Response('forbidden', { status: 403 });
      }
      const data = await fs.promises.readFile(abs);
      const ext = path.extname(abs).slice(1).toLowerCase();
      return new Response(data, { headers: { 'content-type': IMAGE_MIME[ext] || 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  nativeTheme.themeSource = themePref;
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
