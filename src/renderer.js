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
  syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching,
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

// ---------------------------------------------------------------------------
// Syntax highlighting theme (adapts to light / dark)
// ---------------------------------------------------------------------------
const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

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

// ---------------------------------------------------------------------------
// Document state
// ---------------------------------------------------------------------------
const doc = {
  filePath: null,
  displayName: 'Untitled',
  savedText: '',          // text as last saved / loaded
  dirty: false,
  empty: true,
  isScratch: false,       // the perpetual notebook (auto-persisted, never dirty)
};

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
    recomputeDirty();
    if (doc.isScratch) scheduleScratchSave();
  }
  if (v.docChanged || v.selectionSet) {
    updateStatus();
  }
});

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
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    syntaxHighlighting(mdHighlight),
    editorTheme,
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

const view = new EditorView({
  parent: editorParent,
  state: EditorState.create({ doc: '', extensions: baseExtensions() }),
});

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
}

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
// Dirty tracking + main-process notification
// ---------------------------------------------------------------------------
function recomputeDirty() {
  const text = view.state.doc.toString();
  // The notebook is auto-persisted, so it is never "dirty".
  const dirty = doc.isScratch ? false : text !== doc.savedText;
  const empty = text.length === 0 && !doc.filePath && !doc.isScratch;
  if (dirty !== doc.dirty || empty !== doc.empty) {
    doc.dirty = dirty;
    doc.empty = empty;
    notifyState();
  }
}

// Auto-persist the perpetual notebook (debounced).
let scratchTimer = null;
function scheduleScratchSave() {
  if (scratchTimer) clearTimeout(scratchTimer);
  scratchTimer = setTimeout(flushScratch, 400);
}
function flushScratch() {
  if (scratchTimer) { clearTimeout(scratchTimer); scratchTimer = null; }
  if (doc.isScratch && window.api) {
    window.api.saveScratch(view.state.doc.toString());
  }
}
// Make sure the last keystrokes survive an app quit / window close.
window.addEventListener('beforeunload', flushScratch);

function notifyState() {
  document.title = (doc.dirty ? '• ' : '') + doc.displayName;
  if (window.api) {
    window.api.setDocState({
      dirty: doc.dirty,
      empty: doc.empty,
      displayName: doc.displayName,
      filePath: doc.filePath,
    });
  }
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------
function setDocument(text, filePath, displayName) {
  doc.filePath = filePath || null;
  doc.displayName = displayName || 'Untitled';
  doc.savedText = text;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: 0 },
  });
  doc.dirty = false;
  doc.empty = text.length === 0 && !doc.filePath && !doc.isScratch;
  notifyState();
  updateStatus();
  renderPreview();
}

function adoptSaved(res, content) {
  // adopt === false means an "export a copy" of the notebook: stay the notebook.
  if (res.adopt === false) {
    if (doc.isScratch) flushScratch();
    return;
  }
  doc.isScratch = false;
  doc.filePath = res.filePath;
  doc.displayName = res.displayName;
  doc.savedText = content;
  doc.dirty = false;
  doc.empty = false;
  notifyState();
}

async function save({ closeAfter = false } = {}) {
  const content = view.state.doc.toString();
  const res = await window.api.save({ filePath: doc.filePath, content });
  if (res && !res.canceled) {
    adoptSaved(res, content);
    if (closeAfter) window.api.requestClose();
  }
}

async function saveAs() {
  const content = view.state.doc.toString();
  const res = await window.api.saveAs({ content });
  if (res && !res.canceled) adoptSaved(res, content);
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

function applyFormat(kind) {
  switch (kind) {
    case 'bold': return wrapSelection('**');
    case 'italic': return wrapSelection('*');
    case 'code': return wrapSelection('`');
    case 'link': return insertLink();
    case 'image': return insertImage();
    case 'h1': return setHeading(1);
    case 'h2': return setHeading(2);
    case 'h3': return setHeading(3);
    case 'ul': return prefixLines('- ');
    case 'ol': return numberedList();
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
  window.api.on('file:loaded', ({ filePath, content }) => {
    doc.isScratch = false;
    setDocument(content, filePath, filePath.split('/').pop());
  });
  window.api.on('scratch:loaded', ({ content }) => {
    doc.isScratch = true;
    setDocument(content, null, 'Notebook');
    // Put the cursor at the end so you resume where you left off.
    view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
    view.focus();
  });
  window.api.on('menu:save', (payload) => save(payload || {}));
  window.api.on('menu:saveAs', () => saveAs());
  window.api.on('menu:find', () => openSearchPanel(view));
  window.api.on('menu:replace', () => openSearchPanel(view));
  window.api.on('menu:format', (kind) => applyFormat(kind));
  window.api.on('menu:togglePreview', () => togglePreview());
  window.api.on('menu:viewMode', (mode) => setViewMode(mode));
  window.api.on('menu:toggleLineNumbers', () => toggleLineNumbers());
  window.api.on('menu:toggleLineWrap', () => toggleLineWrap());
}

// Initial paint — start editor-only; preview is opt-in via the toggle.
setViewMode('editor');
updateStatus();
notifyState();
view.focus();
