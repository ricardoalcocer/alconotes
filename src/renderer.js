import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection,
  crosshairCursor, highlightSpecialChars,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, syntaxTree,
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';
import {
  search, searchKeymap, openSearchPanel, highlightSelectionMatches,
} from '@codemirror/search';
import MarkdownIt from 'markdown-it';

// ---------------------------------------------------------------------------
// Markdown -> HTML preview renderer
// ---------------------------------------------------------------------------
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
});

// GFM task lists: render `- [ ]` / `- [x]` items as real checkboxes. Each one
// carries its source line so clicking it in the preview can check it off in
// the note itself.
md.core.ruler.push('task_lists', (state) => {
  const toks = state.tokens;
  for (let i = 2; i < toks.length; i++) {
    if (toks[i].type !== 'inline'
      || toks[i - 1].type !== 'paragraph_open'
      || toks[i - 2].type !== 'list_item_open') continue;
    const first = toks[i].children[0];
    if (!first || first.type !== 'text') continue;
    const m = /^\[([ xX])\](?: |$)/.exec(first.content);
    if (!m) continue;
    // `[ ]` glued to markup (e.g. `[ ]**hi**`) is literal text, per GitHub.
    if (!m[0].endsWith(' ') && toks[i].children.length > 1) continue;
    first.content = first.content.slice(m[0].length);
    const box = new state.Token('html_inline', '', 0);
    const line = toks[i - 2].map ? toks[i - 2].map[0] : -1;
    box.content = `<input type="checkbox" class="task-check" data-line="${line}"${m[1] === ' ' ? '' : ' checked'}> `;
    toks[i].children.unshift(box);
    toks[i - 2].attrJoin('class', 'task-item');
  }
});

// ---------------------------------------------------------------------------
// Syntax highlighting theme (adapts to light / dark — live, via a Compartment)
// ---------------------------------------------------------------------------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function makeThemeExtensions() {
  const dark = darkQuery.matches;

  const palette = dark
    ? { heading: '#4aa3ff', emph: '#e6e6e6', strong: '#ffd479', link: '#7ee787',
        code: '#ff9d70', quote: '#8a8a8e', meta: '#8a8a8e', list: '#c792ea' }
    : { heading: '#0a5bd3', emph: '#1d1d1f', strong: '#8a5a00', link: '#0f7a2e',
        code: '#b1370a', quote: '#86868b', meta: '#86868b', list: '#7b3fb5' };

  const mdHighlight = HighlightStyle.define([
    { tag: t.heading, color: palette.heading, fontWeight: '700' },
    { tag: t.heading1, color: palette.heading, fontWeight: '700', fontSize: '1.3em' },
    { tag: t.heading2, color: palette.heading, fontWeight: '700', fontSize: '1.18em' },
    { tag: t.heading3, color: palette.heading, fontWeight: '700', fontSize: '1.08em' },
    { tag: t.strong, color: palette.strong, fontWeight: '700' },
    { tag: t.emphasis, color: palette.emph, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: [t.link, t.url], color: palette.link, textDecoration: 'underline' },
    { tag: [t.monospace], color: palette.code },
    { tag: t.quote, color: palette.quote, fontStyle: 'italic' },
    { tag: [t.list, t.processingInstruction], color: palette.list },
    { tag: [t.meta, t.comment], color: palette.meta },
    { tag: t.contentSeparator, color: palette.meta },
  ]);

  const editorTheme = EditorView.theme({
    '&': {
      color: 'var(--fg)',
      backgroundColor: 'var(--bg)',
      height: '100%',
      fontSize: '15px',
    },
    '.cm-content': {
      caretColor: 'var(--accent)',
      padding: '8px 0',
      lineHeight: '1.6',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: dark ? '#33415580' : '#b3d4fc80' },
    '.cm-selectionBackground': { backgroundColor: dark ? '#2a3140' : '#d7e6ff' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg)',
      color: 'var(--muted)',
      border: 'none',
      borderRight: '1px solid var(--border)',
      fontFamily: 'var(--font-mono)',
    },
    '.cm-activeLine': { backgroundColor: dark ? '#ffffff08' : '#00000005' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)' },
    '.cm-scroller': { padding: '0 16px' },
    '.cm-selectionMatch': { backgroundColor: dark ? '#3a4a2f' : '#e4f0c7' },
    '.cm-searchMatch': { backgroundColor: dark ? '#5a4a1f' : '#fff2a8', outline: '1px solid #d0b64a' },
    '.cm-searchMatch-selected': { backgroundColor: dark ? '#7a5a1f' : '#ffd54a' },
  }, { dark });

  return [syntaxHighlighting(mdHighlight), editorTheme];
}

const themeComp = new Compartment();

// Follows both macOS appearance changes and the View > Appearance menu
// (main sets nativeTheme.themeSource, which drives prefers-color-scheme).
darkQuery.addEventListener('change', () => {
  view.dispatch({ effects: themeComp.reconfigure(makeThemeExtensions()) });
});

// ---------------------------------------------------------------------------
// Tabs
//
// Two kinds of tab:
//   - scratch: a perpetual notebook tab. Auto-persisted to disk on every
//     change, never "dirty", never nags. Saving one converts it to a file tab.
//   - file: a real document on the filesystem. Classic dirty tracking.
// Each tab owns its own CodeMirror EditorState; one EditorView swaps between
// them. The tab layout is persisted via session:save.
// ---------------------------------------------------------------------------

/** @type {Array<{kind:'scratch'|'file', id?:string, path?:string, name:string, state:EditorState, savedText:string, dirty:boolean}>} */
let tabs = [];
let active = -1;

function genId() {
  return 'nb-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const lineNumbersComp = new Compartment();
const lineWrapComp = new Compartment();

let showLineNumbers = true;
let lineWrap = true;

// ---------------------------------------------------------------------------
// Editor setup
// ---------------------------------------------------------------------------
const editorParent = document.getElementById('editor');

const updateListener = EditorView.updateListener.of((v) => {
  if (v.docChanged) {
    schedulePreview();
    const tab = tabs[active];
    if (tab) {
      if (tab.kind === 'scratch') {
        scheduleNotebookSave(tab);
      } else {
        const dirty = v.state.doc.toString() !== tab.savedText;
        if (dirty !== tab.dirty) {
          tab.dirty = dirty;
          renderTabs();
          notifyState();
        }
      }
    }
  }
  if (v.docChanged || v.selectionSet) {
    updateStatus();
  }
});

// ---------------------------------------------------------------------------
// ⌘-click a link in the editor to open it in the default browser
// ---------------------------------------------------------------------------
const BARE_URL_RE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g;

function normalizeUrl(url) {
  if (/^https?:\/\//.test(url) || /^mailto:/.test(url)) return url;
  if (/^www\./.test(url)) return `https://${url}`;
  return null; // relative paths / placeholders like (url) — nothing to open
}

// Resolve the link under `pos`: Markdown links/images/autolinks via the
// syntax tree (clicking anywhere on them counts), bare URLs via regex.
function findLinkAt(ed, pos) {
  const node = syntaxTree(ed.state).resolveInner(pos, 0);
  for (let n = node; n; n = n.parent) {
    if (n.name === 'URL') return normalizeUrl(ed.state.doc.sliceString(n.from, n.to));
    if (n.name === 'Link' || n.name === 'Image' || n.name === 'Autolink') {
      const urlNode = n.getChild('URL');
      return urlNode ? normalizeUrl(ed.state.doc.sliceString(urlNode.from, urlNode.to)) : null;
    }
  }
  const line = ed.state.doc.lineAt(pos);
  BARE_URL_RE.lastIndex = 0;
  let m;
  while ((m = BARE_URL_RE.exec(line.text))) {
    const from = line.from + m.index;
    if (pos >= from && pos <= from + m[0].length) return normalizeUrl(m[0]);
  }
  return null;
}

const cmdClickLinks = EditorView.domEventHandlers({
  mousedown(event, ed) {
    if (!event.metaKey || event.button !== 0) return false;
    const pos = ed.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const url = findLinkAt(ed, pos);
    if (!url) return false;
    event.preventDefault();
    window.open(url, '_blank');
    return true; // swallow it — no extra cursor at the click point
  },
  // Pointer cursor while ⌘ is held over a link.
  mousemove(event, ed) {
    let over = false;
    if (event.metaKey) {
      const pos = ed.posAtCoords({ x: event.clientX, y: event.clientY });
      over = pos != null && !!findLinkAt(ed, pos);
    }
    ed.dom.classList.toggle('cm-cmd-link', over);
    return false;
  },
});

// ---------------------------------------------------------------------------
// Drop or paste an image → copy it into the note's sidecar assets folder and
// insert a Markdown reference. No hosting, no hunting for the file.
// ---------------------------------------------------------------------------
const imageDropPaste = EditorView.domEventHandlers({
  dragover(event) {
    if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) {
      event.preventDefault(); // signal we accept the drop
    }
    return false;
  },
  drop(event, ed) {
    const files = imageFilesFrom(event.dataTransfer);
    if (!files.length) return false;
    event.preventDefault();
    const pos = ed.posAtCoords({ x: event.clientX, y: event.clientY });
    insertDroppedImages(files, pos);
    return true;
  },
  paste(event) {
    const files = imageFilesFrom(event.clipboardData);
    if (!files.length) return false;
    event.preventDefault();
    insertDroppedImages(files, view.state.selection.main.from);
    return true;
  },
});

function imageFilesFrom(dataTransfer) {
  if (!dataTransfer || !dataTransfer.files) return [];
  return Array.from(dataTransfer.files).filter((f) => f.type.startsWith('image/'));
}

function extForImage(file) {
  const m = /\.([a-z0-9]+)$/i.exec(file.name || '');
  if (m) return m[1].toLowerCase();
  return ((file.type || '').split('/')[1] || 'png').replace('+xml', '');
}

function altForImage(file) {
  const base = (file.name || '').replace(/\.[a-z0-9]+$/i, '').trim();
  return base || 'image';
}

// Read each image, hand its bytes to main to store, then insert the returned
// relative path. Images are inserted in order at the drop/caret position.
async function insertDroppedImages(files, at) {
  const tab = tabs[active];
  if (!tab || !window.api || !window.api.imageSave) return;
  let pos = typeof at === 'number' ? at : view.state.selection.main.from;
  for (const file of files) {
    let res;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      res = await window.api.imageSave({ tab: tabRef(tab), bytes, ext: extForImage(file) });
    } catch (err) {
      res = { error: String(err) };
    }
    if (!res || res.error || !res.relPath) {
      console.error('image insert failed:', res && res.error);
      continue;
    }
    pos = insertImageAt(res.relPath, altForImage(file), pos);
    // Cache the note's base dir so the preview can resolve the new image.
    if (!tab.baseDir && res.absPath) tab.baseDir = res.absPath.replace(/[/\\][^/\\]*\.assets[/\\][^/\\]*$/, '');
  }
  renderPreview();
  view.focus();
}

// Insert `![alt](relPath)` at `pos`; returns the position just after it so
// callers can chain multiple inserts.
function insertImageAt(relPath, alt, pos) {
  const insert = `![${alt}](${relPath})`;
  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.length },
    scrollIntoView: true,
  });
  return pos + insert.length;
}

function baseExtensions() {
  return [
    lineNumbersComp.of(showLineNumbers ? lineNumbers() : []),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    rectangularSelection(),
    crosshairCursor(),
    search({ top: true }),
    cmdClickLinks,
    imageDropPaste,
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    themeComp.of(makeThemeExtensions()),
    lineWrapComp.of(lineWrap ? EditorView.lineWrapping : []),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    updateListener,
  ];
}

function freshState(content) {
  return EditorState.create({ doc: content, extensions: baseExtensions() });
}

const view = new EditorView({
  parent: editorParent,
  state: freshState(''),
});

// Store the live editor state back onto the active tab. Must run before
// `active` changes, so no keystrokes are lost.
function syncActive() {
  const tab = tabs[active];
  if (tab) tab.state = view.state;
}

function textOf(tab) {
  return tab === tabs[active] ? view.state.doc.toString() : tab.state.doc.toString();
}

// A minimal descriptor main needs to locate the tab's note (and thus its
// sidecar assets folder) on disk.
function tabRef(tab) {
  return { kind: tab.kind, id: tab.id, path: tab.path };
}

// Cache the active tab's note directory so the preview can resolve relative
// image paths, then re-render. Base dir changes when a tab gains a file
// identity (Save As), so this is re-run at those points.
async function refreshActiveBaseDir() {
  const tab = tabs[active];
  if (!tab || !window.api || !window.api.imageBaseDir) return;
  const dir = await window.api.imageBaseDir(tabRef(tab));
  if (tabs[active] === tab) {
    tab.baseDir = dir || null;
    renderPreview();
  }
}

// Compartments live per-EditorState, so re-apply the global toggles whenever
// the view adopts another tab's state.
function applyEditorPrefs() {
  view.dispatch({
    effects: [
      lineNumbersComp.reconfigure(showLineNumbers ? lineNumbers() : []),
      lineWrapComp.reconfigure(lineWrap ? EditorView.lineWrapping : []),
      themeComp.reconfigure(makeThemeExtensions()),
    ],
  });
}

// Make tab `active` the one on screen and refresh all chrome around it.
function activateTab() {
  const tab = tabs[active];
  view.setState(tab.state);
  applyEditorPrefs();
  renderTabs();
  updateStatus();
  notifyState();
  renderPreview();
  refreshActiveBaseDir();
  saveSession();
  view.focus();
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------
const tabbarEl = document.getElementById('tabbar');

function renderTabs() {
  tabbarEl.textContent = '';
  tabs.forEach((tab, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === active ? ' active' : '') + (tab.dirty ? ' dirty' : '');
    el.title = tab.kind === 'file' ? tab.path : 'Notebook tab — auto-saved, no file';

    const dot = document.createElement('span');
    dot.className = 'tab-dirty';
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tab.name;
    // ⌘1–⌘8 hit tabs 1–8; ⌘9 always hits the last tab.
    const keyNum = i < 8 ? i + 1 : (i === tabs.length - 1 ? 9 : null);
    const key = document.createElement('span');
    key.className = 'tab-key';
    if (keyNum) key.textContent = `⌘${keyNum}`;
    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Close Tab (⌘W)';

    el.append(dot, name, key, close);
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target === close) return;
      switchTab(i);
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(i);
    });
    close.addEventListener('click', () => closeTab(i));
    tabbarEl.appendChild(el);
  });

  const plus = document.createElement('button');
  plus.id = 'tab-new';
  plus.type = 'button';
  plus.textContent = '+';
  plus.title = 'New Tab (⌘T)';
  plus.addEventListener('click', () => newScratchTab());
  tabbarEl.appendChild(plus);
}

function switchTab(i) {
  if (i === active || !tabs[i]) return;
  syncActive();
  active = i;
  activateTab();
}

function nextNotebookName() {
  const names = new Set(tabs.filter((t2) => t2.kind === 'scratch').map((t2) => t2.name));
  if (!names.has('Notebook')) return 'Notebook';
  let n = 2;
  while (names.has(`Notebook ${n}`)) n++;
  return `Notebook ${n}`;
}

function newScratchTab() {
  syncActive();
  const tab = {
    kind: 'scratch',
    id: genId(),
    name: nextNotebookName(),
    state: freshState(''),
    savedText: '',
    dirty: false,
  };
  tabs.push(tab);
  window.api.notebookSave(tab.id, '');
  active = tabs.length - 1;
  activateTab();
}

function addFileTabs(files) {
  syncActive();
  let target = -1;
  for (const f of files || []) {
    const existing = tabs.findIndex((t2) => t2.kind === 'file' && t2.path === f.path);
    if (existing >= 0) {
      target = existing;
      continue;
    }
    tabs.push({
      kind: 'file',
      path: f.path,
      name: f.name,
      state: freshState(f.content),
      savedText: f.content,
      dirty: false,
    });
    target = tabs.length - 1;
  }
  if (target >= 0) {
    active = target;
    activateTab();
  }
}

async function closeTab(i) {
  const tab = tabs[i];
  if (!tab) return;

  if (tab.kind === 'scratch') {
    if (textOf(tab).trim().length) {
      const choice = await window.api.confirm({
        message: `Do you want to save “${tab.name}” before closing it?`,
        detail: 'It is an unsaved notebook tab — closing it discards its contents.',
        buttons: ['Save…', 'Discard', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });
      if (choice === 2) return;
      if (choice === 0) {
        const ok = await saveTabAs(tab); // adopts a file identity + removes the notebook
        if (!ok) return;
      } else {
        window.api.notebookDelete(tab.id);
      }
    } else {
      window.api.notebookDelete(tab.id);
    }
  } else if (tab.dirty) {
    const choice = await window.api.confirm({
      message: `Do you want to save the changes you made to ${tab.name}?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 2) return;
    if (choice === 0) {
      const ok = await saveTab(tab);
      if (!ok) return;
    }
  }
  removeTab(tab);
}

function removeTab(tab) {
  const i = tabs.indexOf(tab);
  if (i < 0) return;
  const closingActive = i === active;
  tabs.splice(i, 1);

  if (!closingActive) {
    if (i < active) active--;
    renderTabs();
    notifyState();
    saveSession();
    return;
  }
  // The window always keeps at least one notebook tab.
  if (!tabs.length) {
    const fresh = {
      kind: 'scratch',
      id: genId(),
      name: 'Notebook',
      state: freshState(''),
      savedText: '',
      dirty: false,
    };
    tabs.push(fresh);
    window.api.notebookSave(fresh.id, '');
  }
  active = Math.min(i, tabs.length - 1);
  activateTab();
}

// ---------------------------------------------------------------------------
// Preview (debounced)
// ---------------------------------------------------------------------------
const previewEl = document.getElementById('preview');
let previewTimer = null;

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
}

function renderPreview() {
  previewTimer = null;
  if (workspace.classList.contains('view-editor')) return; // preview hidden
  previewEl.innerHTML = md.render(view.state.doc.toString());
  resolveLocalImages();
}

// Markdown-it emits relative image paths (e.g. `note.assets/x.png`) verbatim,
// which the sandboxed preview can't load from disk. Rewrite each to an
// `asset://` URL resolved against the note's folder so main can serve it.
function resolveLocalImages() {
  const base = tabs[active] && tabs[active].baseDir;
  for (const img of previewEl.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (/^(https?:|data:|asset:|blob:)/i.test(src)) continue;
    let rel;
    try {
      rel = decodeURI(src);
    } catch {
      rel = src;
    }
    const abs = rel.startsWith('/')
      ? rel
      : (base ? `${base.replace(/\/$/, '')}/${rel}` : null);
    if (abs) img.src = `asset://local/${encodeURIComponent(abs)}`;
  }
}

// Clicking a checkbox in the preview checks it off in the source note.
previewEl.addEventListener('click', (e) => {
  const box = e.target.closest('input.task-check');
  if (!box) return;
  const n = Number(box.dataset.line) + 1;
  if (!Number.isInteger(n) || n < 1 || n > view.state.doc.lines) return;
  const line = view.state.doc.line(n);
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)[ xX]\]/.exec(line.text);
  if (!m) return;
  const at = line.from + m[1].length;
  view.dispatch({ changes: { from: at, to: at + 1, insert: box.checked ? 'x' : ' ' } });
});

// Open external links in the default browser instead of navigating the app.
previewEl.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (a && a.href) {
    e.preventDefault();
    // eslint-disable-next-line no-undef
    if (window.api && a.href.startsWith('http')) {
      window.open(a.href, '_blank');
    }
  }
});

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------
const elCursor = document.getElementById('status-cursor');
const elSel = document.getElementById('status-sel');
const elWords = document.getElementById('status-words');
const elChars = document.getElementById('status-chars');

function countWords(str) {
  const m = str.match(/[^\s]+/g);
  return m ? m.length : 0;
}

function updateStatus() {
  const state = view.state;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const col = sel.head - line.from + 1;
  elCursor.textContent = `Ln ${line.number}, Col ${col}`;

  const selLen = state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
  elSel.textContent = selLen ? `${selLen} selected` : '0 selected';

  const text = state.doc.toString();
  elChars.textContent = `${text.length} chars`;
  elWords.textContent = `${countWords(text)} words`;
}

// ---------------------------------------------------------------------------
// Persistence: notebooks (debounced per tab) + session layout
// ---------------------------------------------------------------------------
const notebookTimers = new Map();

function scheduleNotebookSave(tab) {
  clearTimeout(notebookTimers.get(tab.id));
  notebookTimers.set(tab.id, setTimeout(() => {
    notebookTimers.delete(tab.id);
    if (tabs.includes(tab)) window.api.notebookSave(tab.id, textOf(tab));
  }, 400));
}

function sessionState() {
  return {
    tabs: tabs.map((tab) => (tab.kind === 'scratch'
      ? { kind: 'scratch', id: tab.id, name: tab.name }
      : { kind: 'file', path: tab.path })),
    active,
  };
}

function saveSession() {
  if (window.api) window.api.sessionSave(sessionState());
}

// Make sure the last keystrokes survive an app quit / window close.
function flushNotebooks() {
  syncActive();
  for (const tab of tabs) {
    if (tab.kind === 'scratch') window.api.notebookSave(tab.id, tab.state.doc.toString());
  }
  saveSession();
}
window.addEventListener('beforeunload', flushNotebooks);

function notifyState() {
  const tab = tabs[active];
  if (!tab) return;
  const dirtyFiles = tabs.filter((t2) => t2.kind === 'file' && t2.dirty).map((t2) => t2.name);
  document.title = (tab.dirty ? '• ' : '') + tab.name;
  if (window.api) {
    window.api.setDocState({
      title: tab.name,
      filePath: tab.kind === 'file' ? tab.path : null,
      dirtyFiles,
    });
  }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

// Save a file tab in place (silent write — file tabs always have a path).
async function saveTab(tab) {
  if (tab.kind !== 'file') return saveTabAs(tab);
  const content = textOf(tab);
  const res = await window.api.save({ path: tab.path, content, defaultName: tab.name });
  if (!res || res.canceled) return false;
  tab.savedText = content;
  tab.dirty = false;
  renderTabs();
  notifyState();
  return true;
}

// Save As. For a notebook tab this ADOPTS the file identity: the tab becomes
// a file tab and its auto-persisted notebook copy is removed.
async function saveTabAs(tab) {
  const content = textOf(tab);
  const res = await window.api.saveAs({
    content,
    defaultName: tab.kind === 'file' ? tab.name : `${tab.name}.md`,
  });
  if (!res || res.canceled) return false;
  if (tab.kind === 'scratch') {
    window.api.notebookDelete(tab.id);
    notebookTimers.delete(tab.id);
    delete tab.id;
  }
  tab.kind = 'file';
  tab.path = res.path;
  tab.name = res.name;
  tab.savedText = content;
  tab.dirty = false;
  tab.baseDir = null; // note moved — re-resolve its sidecar folder
  renderTabs();
  notifyState();
  refreshActiveBaseDir();
  saveSession();
  return true;
}

// Triggered by main when the window closes with dirty file tabs.
async function saveAllAndClose() {
  syncActive();
  for (const tab of tabs) {
    if (tab.kind === 'file' && tab.dirty) {
      const ok = await saveTab(tab);
      if (!ok) return; // save failed/canceled — abort the close
    }
  }
  flushNotebooks();
  window.api.requestClose();
}

// ---------------------------------------------------------------------------
// Formatting commands
// ---------------------------------------------------------------------------
function wrapSelection(before, after = before) {
  const changes = [];
  const state = view.state;
  const ranges = state.selection.ranges.map((r) => {
    const text = state.doc.sliceString(r.from, r.to);
    const insert = before + text + after;
    changes.push({ from: r.from, to: r.to, insert });
    const anchor = r.from + before.length;
    return EditorSelection.range(anchor, anchor + text.length);
  });
  view.dispatch({ changes, selection: EditorSelection.create(ranges), scrollIntoView: true });
  view.focus();
}

function prefixLines(prefix, { toggle = true } = {}) {
  const state = view.state;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    const startLine = state.doc.lineAt(r.from).number;
    const endLine = state.doc.lineAt(r.to).number;
    for (let n = startLine; n <= endLine; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const has = line.text.startsWith(prefix);
      if (toggle && has) {
        changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
      } else if (!has) {
        changes.push({ from: line.from, insert: prefix });
      }
    }
  }
  view.dispatch({ changes });
  view.focus();
}

function setHeading(level) {
  const state = view.state;
  const changes = [];
  const seen = new Set();
  const hashes = '#'.repeat(level) + ' ';
  for (const r of state.selection.ranges) {
    const startLine = state.doc.lineAt(r.from).number;
    const endLine = state.doc.lineAt(r.to).number;
    for (let n = startLine; n <= endLine; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const stripped = line.text.replace(/^#{1,6}\s+/, '');
      changes.push({ from: line.from, to: line.to, insert: hashes + stripped });
    }
  }
  view.dispatch({ changes });
  view.focus();
}

function numberedList() {
  const state = view.state;
  const changes = [];
  const seen = new Set();
  let i = 1;
  for (const r of state.selection.ranges) {
    const startLine = state.doc.lineAt(r.from).number;
    const endLine = state.doc.lineAt(r.to).number;
    for (let n = startLine; n <= endLine; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      if (!/^\d+\.\s/.test(line.text)) {
        changes.push({ from: line.from, insert: `${i}. ` });
      }
      i++;
    }
  }
  view.dispatch({ changes });
  view.focus();
}

// Toggle checkbox items on the selected lines: a plain line or a bullet
// becomes `- [ ] …`; an existing task item reverts to plain text.
function toggleTaskList() {
  const state = view.state;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    const startLine = state.doc.lineAt(r.from).number;
    const endLine = state.doc.lineAt(r.to).number;
    for (let n = startLine; n <= endLine; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const task = /^(\s*)(?:[-*+]|\d+[.)]) \[[ xX]\] ?/.exec(line.text);
      if (task) {
        changes.push({ from: line.from + task[1].length, to: line.from + task[0].length, insert: '' });
        continue;
      }
      const bullet = /^\s*(?:[-*+]|\d+[.)]) /.exec(line.text);
      if (bullet) {
        changes.push({ from: line.from + bullet[0].length, insert: '[ ] ' });
      } else {
        changes.push({ from: line.from + /^\s*/.exec(line.text)[0].length, insert: '- [ ] ' });
      }
    }
  }
  view.dispatch({ changes });
  view.focus();
}

function insertLink() {
  const state = view.state;
  const r = state.selection.main;
  const text = state.doc.sliceString(r.from, r.to) || 'text';
  const insert = `[${text}](url)`;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    // Select the "url" placeholder for quick typing.
    selection: { anchor: r.from + text.length + 3, head: r.from + text.length + 6 },
    scrollIntoView: true,
  });
  view.focus();
}

function insertImage() {
  const state = view.state;
  const r = state.selection.main;
  const alt = state.doc.sliceString(r.from, r.to) || 'alt text';
  const insert = `![${alt}](url)`;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    // Select the "url" placeholder for quick typing.
    selection: { anchor: r.from + alt.length + 4, head: r.from + alt.length + 7 },
    scrollIntoView: true,
  });
  view.focus();
}

// Insert a Markdown table skeleton. `rows` includes the header row.
function insertTable(rows, cols) {
  const state = view.state;
  const line = state.doc.lineAt(state.selection.main.from);
  const blank = line.text.trim().length === 0;
  const row = '|' + Array(cols).fill('   ').join('|') + '|';
  const sep = '|' + Array(cols).fill(' --- ').join('|') + '|';
  const table = [row, sep, ...Array(Math.max(rows - 1, 0)).fill(row)].join('\n');
  const before = blank ? '' : '\n\n';
  view.dispatch({
    changes: { from: blank ? line.from : line.to, to: line.to, insert: before + table + '\n' },
    // Caret inside the first header cell.
    selection: { anchor: (blank ? line.from : line.to) + before.length + 2 },
    scrollIntoView: true,
  });
  view.focus();
}

function applyFormat(kind) {
  switch (kind) {
    case 'bold': return wrapSelection('**');
    case 'italic': return wrapSelection('*');
    case 'code': return wrapSelection('`');
    case 'link': return insertLink();
    case 'image': return insertImage();
    case 'table': return toggleTablePicker();
    case 'h1': return setHeading(1);
    case 'h2': return setHeading(2);
    case 'h3': return setHeading(3);
    case 'ul': return prefixLines('- ');
    case 'ol': return numberedList();
    case 'task': return toggleTaskList();
    case 'quote': return prefixLines('> ');
    default: break;
  }
}

// ---------------------------------------------------------------------------
// View modes / toggles
// ---------------------------------------------------------------------------
const workspace = document.getElementById('workspace');
const previewBtn = document.getElementById('toggle-preview');
let viewMode = 'editor'; // split | editor | preview
let lastPreviewMode = 'split'; // remembers split vs preview-only when toggling back on

function setViewMode(mode) {
  viewMode = mode;
  if (mode !== 'editor') lastPreviewMode = mode;
  workspace.classList.remove('view-split', 'view-editor', 'view-preview');
  workspace.classList.add(`view-${mode}`);
  const previewVisible = mode !== 'editor';
  if (previewBtn) previewBtn.setAttribute('aria-pressed', String(previewVisible));
  if (previewVisible) renderPreview();
}

function togglePreview() {
  // Off -> restore the last preview layout; on -> back to editor-only.
  setViewMode(viewMode === 'editor' ? lastPreviewMode : 'editor');
}

if (previewBtn) previewBtn.addEventListener('click', () => togglePreview());

// Formatting toolbar — mousedown is prevented so the editor keeps focus/selection.
document.querySelectorAll('#toolbar button[data-format]').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => applyFormat(btn.dataset.format));
});

// ---- Insert-table grid picker (Word-style rows × columns hover grid) ----
const tableBtn = document.getElementById('tb-table');
const tablePicker = document.getElementById('table-picker');
const tablePickerGrid = document.getElementById('table-picker-grid');
const tablePickerLabel = document.getElementById('table-picker-label');
const PICKER_COLS = 10;
const PICKER_ROWS = 8;

for (let r = 1; r <= PICKER_ROWS; r++) {
  for (let c = 1; c <= PICKER_COLS; c++) {
    const cell = document.createElement('div');
    cell.className = 'tp-cell';
    cell.dataset.r = String(r);
    cell.dataset.c = String(c);
    tablePickerGrid.appendChild(cell);
  }
}

function highlightPicker(rows, cols) {
  for (const cell of tablePickerGrid.children) {
    cell.classList.toggle('on', +cell.dataset.r <= rows && +cell.dataset.c <= cols);
  }
  tablePickerLabel.textContent = rows && cols ? `${cols} × ${rows}` : 'Insert table';
}

function showTablePicker() {
  tablePicker.style.left = `${tableBtn.offsetLeft}px`;
  tablePicker.hidden = false;
  tableBtn.setAttribute('aria-expanded', 'true');
  highlightPicker(0, 0);
}
function hideTablePicker() {
  tablePicker.hidden = true;
  tableBtn.setAttribute('aria-expanded', 'false');
}
function toggleTablePicker() {
  if (tablePicker.hidden) showTablePicker();
  else hideTablePicker();
}

tableBtn.addEventListener('mousedown', (e) => e.preventDefault());
tableBtn.addEventListener('click', toggleTablePicker);
tablePickerGrid.addEventListener('mouseover', (e) => {
  const cell = e.target.closest('.tp-cell');
  if (cell) highlightPicker(+cell.dataset.r, +cell.dataset.c);
});
tablePickerGrid.addEventListener('mouseleave', () => highlightPicker(0, 0));
tablePickerGrid.addEventListener('click', (e) => {
  const cell = e.target.closest('.tp-cell');
  if (!cell) return;
  hideTablePicker();
  insertTable(+cell.dataset.r, +cell.dataset.c);
});
document.addEventListener('mousedown', (e) => {
  if (!tablePicker.hidden && !tablePicker.contains(e.target) && !tableBtn.contains(e.target)) {
    hideTablePicker();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !tablePicker.hidden) hideTablePicker();
});

// Browser-style tab switching: ⌘1–⌘8 jump to that tab, ⌘9 to the last.
window.addEventListener('keydown', (e) => {
  if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  if (e.key < '1' || e.key > '9') return;
  e.preventDefault();
  const i = e.key === '9' ? tabs.length - 1 : Number(e.key) - 1;
  if (tabs[i]) switchTab(i);
});

function toggleLineNumbers() {
  showLineNumbers = !showLineNumbers;
  view.dispatch({ effects: lineNumbersComp.reconfigure(showLineNumbers ? lineNumbers() : []) });
}

function toggleLineWrap() {
  lineWrap = !lineWrap;
  view.dispatch({ effects: lineWrapComp.reconfigure(lineWrap ? EditorView.lineWrapping : []) });
}

// ---------------------------------------------------------------------------
// Wire up menu events from main
// ---------------------------------------------------------------------------
if (window.api) {
  window.api.on('tab:openFiles', (files) => addFileTabs(files));
  window.api.on('window:saveAllAndClose', () => saveAllAndClose());
  window.api.on('menu:newTab', () => newScratchTab());
  window.api.on('menu:closeTab', () => closeTab(active));
  window.api.on('menu:save', () => { if (tabs[active]) saveTab(tabs[active]); });
  window.api.on('menu:saveAs', () => { if (tabs[active]) saveTabAs(tabs[active]); });
  window.api.on('menu:find', () => openSearchPanel(view));
  window.api.on('menu:replace', () => openSearchPanel(view));
  window.api.on('menu:format', (kind) => applyFormat(kind));
  window.api.on('menu:togglePreview', () => togglePreview());
  window.api.on('menu:viewMode', (mode) => setViewMode(mode));
  window.api.on('menu:toggleLineNumbers', () => toggleLineNumbers());
  window.api.on('menu:toggleLineWrap', () => toggleLineWrap());
}

// ---------------------------------------------------------------------------
// Boot: restore the session (notebook tabs + file tabs + active tab)
// ---------------------------------------------------------------------------
async function init() {
  setViewMode('editor');
  if (!window.api) return;
  const session = await window.api.sessionLoad();
  tabs = session.tabs.map((f) => (f.kind === 'scratch'
    ? { kind: 'scratch', id: f.id, name: f.name, state: freshState(f.content), savedText: f.content, dirty: false }
    : { kind: 'file', path: f.path, name: f.name, state: freshState(f.content), savedText: f.content, dirty: false }));
  active = Math.min(Math.max(session.active | 0, 0), tabs.length - 1);
  view.setState(tabs[active].state);
  applyEditorPrefs();
  // Put the cursor at the end so you resume where you left off.
  view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
  renderTabs();
  updateStatus();
  notifyState();
  refreshActiveBaseDir();
  view.focus();
}

init();
