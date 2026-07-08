# AlcoNotes

A **perpetual Markdown notebook** for macOS, built with Electron — in the spirit of
[CotEditor](https://coteditor.com), but focused entirely on Markdown.

The core idea: **open the app and your note is always there.** You never have to
save it — AlcoNotes keeps a single perpetual notebook that auto-persists to disk on
every keystroke, so you just keep adding to the same note, forever. Save it to a
real `.md` file only if you *want* a copy.

## What it does

- **Perpetual notebook** — launches straight into your always-there note (titled
  *Notebook*). Auto-saved continuously, never marked "unsaved", never nags you on
  quit. Picks up exactly where you left off, cursor at the end.
- **CodeMirror 6 editor** — real Markdown syntax highlighting, line numbers,
  active-line highlight, bracket matching, soft wrap, Find/Replace.
- **Optional live preview** — a toggle in the status bar (or `⌘⇧P`) shows a
  rendered side-by-side preview. Off by default; it's opt-in.
- **Native macOS feel** — hidden-inset title bar, system fonts, automatic
  light/dark following the OS.
- **Save when you want** — `⌘S` / Save As exports a copy of the notebook to a
  `.md` file without changing your notebook. `⌘N` opens a separate throwaway doc,
  `⌘O` opens an existing file in its own window.
- **Formatting menu** — Bold `⌘B`, Italic `⌘I`, Code `⌘K`, Link `⌘⇧K`, Headings
  `⌘1`/`⌘2`/`⌘3`, lists, blockquote.
- **Status bar** — line/column, selection length, word count, character count.

Your notebook lives at
`~/Library/Application Support/AlcoNotes/scratch.md`.

> Coming next (per plan): **tabs** for multiple docs.

## Run it (development)

```bash
npm install     # first time
npm start       # build the renderer bundle + launch
```

Rebuild the renderer on change while developing:

```bash
npm run watch   # esbuild --watch, in one terminal
npx electron .  # in another
```

## Build the app / binary

```bash
npm run dist
```

Produces, in `release/`:

- `AlcoNotes.app` (in `release/mac-arm64/`) — the runnable app
- `AlcoNotes-0.1.0-arm64.dmg` — drag-to-install disk image
- `AlcoNotes-0.1.0-arm64-mac.zip` — zipped app

Built for Apple Silicon (arm64), unsigned (ad-hoc). Because it isn't
code-signed/notarized, the first launch needs right-click → **Open** (or
*System Settings → Privacy & Security → Open Anyway*).

## Layout

| File | Role |
|------|------|
| `main.js` | Electron main: windows, native menu, file I/O + notebook persistence |
| `preload.js` | `contextBridge` API exposed to the renderer |
| `src/renderer.js` | CodeMirror editor, live preview, status bar, formatting, autosave |
| `build.js` | esbuild config that bundles the renderer into `dist/` |
| `index.html` / `styles.css` | App shell + theming |

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| New / Open / Save (export) / Save As | `⌘N` / `⌘O` / `⌘S` / `⌘⇧S` |
| Find / Replace | `⌘F` / `⌘⌥F` |
| Toggle Preview | `⌘⇧P` |
| Editor only / Preview only | `⌘⇧E` / `⌘⇧R` |
| Bold / Italic / Code / Link | `⌘B` / `⌘I` / `⌘K` / `⌘⇧K` |
| Heading 1–3 | `⌘1` / `⌘2` / `⌘3` |
| Bulleted / Numbered list | `⌘⇧8` / `⌘⇧7` |
| Blockquote | `⌘⇧.` |
