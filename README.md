<div align="center">

<img src="build/icon-1024.png" alt="AlcoNotes" width="140" />

# AlcoNotes

### The Markdown notebook that's *always already open.*

A fast, native-feeling macOS Markdown editor in the spirit of
[**CotEditor**](https://coteditor.com) — but built around one idea:
**open the app and your note is right there.** No "New Document", no
"Save As", no lost thoughts. Just keep writing.

<br/>

![macOS](https://img.shields.io/badge/macOS-Apple_Silicon-000000?style=for-the-badge&logo=apple&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31-47848F?style=for-the-badge&logo=electron&logoColor=white)
![CodeMirror 6](https://img.shields.io/badge/CodeMirror-6-d30707?style=for-the-badge&logo=codemirror&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-3fb950?style=for-the-badge)

![Last commit](https://img.shields.io/github/last-commit/ricardoalcocer/alconotes?color=8b5cf6)
![Repo size](https://img.shields.io/github/repo-size/ricardoalcocer/alconotes?color=3f8cff)
![Made with Markdown](https://img.shields.io/badge/made%20with-Markdown-1a1a1a?logo=markdown)
![Stars](https://img.shields.io/github/stars/ricardoalcocer/alconotes?style=social)

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshot-light.png" />
  <img alt="AlcoNotes — split editor and live preview" src="docs/screenshot-dark.png" width="860" />
</picture>

</div>

---

## ✨ Why AlcoNotes

Most editors treat a blank document as a *chore* you have to name and save.
AlcoNotes treats your notebook as a **place you return to** — a single, perpetual
scratch note that's saved for you on every keystroke and picks up exactly where you
left off.

> 💡 Think of it as the sticky note you never lose — with real Markdown superpowers.

## 🚀 Features

| | |
|---|---|
| 📓 **Perpetual notebook** | Launches straight into your always-there note. Auto-saved continuously — never marked "unsaved", never nags you on quit. |
| ✍️ **Real Markdown editor** | CodeMirror 6 with live syntax highlighting, line numbers, active-line highlight, bracket matching & soft wrap. |
| 👀 **Optional live preview** | A one-click toggle (or `⌘⇧P`) for a rendered side-by-side preview. Off by default — it's there when you want it. |
| 🌗 **Native & theme-aware** | Hidden-inset title bar, system fonts, and automatic light/dark that follows macOS. |
| 💾 **Save only if you want** | `⌘S` / Save As exports a `.md` copy without disturbing your notebook. `⌘N` opens a throwaway doc; `⌘O` opens any file. |
| 🔎 **Find & Replace** | `⌘F` / `⌘⌥F` powered by CodeMirror's search. |
| 🔠 **Formatting shortcuts** | Bold, italic, code, links, headings, lists & blockquotes — all one keystroke away. |
| 📊 **Live status bar** | Line/column, selection length, word count & character count. |

## 📥 Get it

Grab a build from [**Releases**](https://github.com/ricardoalcocer/alconotes/releases),
or build it yourself below.

> ℹ️ Builds are unsigned (ad-hoc), so the first launch needs **right-click → Open**
> (or *System Settings → Privacy & Security → Open Anyway*).

## 🛠️ Develop

```bash
npm install     # first time
npm start       # bundle the renderer + launch
```

Live-rebuild the renderer while hacking:

```bash
npm run watch   # esbuild --watch  (terminal 1)
npx electron .  # (terminal 2)
```

## 📦 Build the app

```bash
npm run dist
```

Outputs to `release/`:

- 🍎 `AlcoNotes.app` — the runnable app (`release/mac-arm64/`)
- 💽 `AlcoNotes-<version>-arm64.dmg` — drag-to-install disk image
- 🗜️ `AlcoNotes-<version>-arm64-mac.zip` — zipped app

Built for Apple Silicon (arm64). The app icon is generated into
`build/icon.icns` and embedded automatically.

## 📁 Where your note lives

Your perpetual notebook is a plain Markdown file:

```
~/Library/Application Support/AlcoNotes/scratch.md
```

Back it up, `grep` it, symlink it into iCloud/Dropbox — it's just Markdown.
The renderer autosaves it ~400 ms after you stop typing (and once more on close),
so it survives quits without a save.

## ⌨️ Keyboard shortcuts

| Action | Shortcut | | Action | Shortcut |
|---|---|---|---|---|
| New | `⌘N` | | Toggle Preview | `⌘⇧P` |
| Open | `⌘O` | | Editor only | `⌘⇧E` |
| Save (export) | `⌘S` | | Preview only | `⌘⇧R` |
| Save As | `⌘⇧S` | | Bold / Italic | `⌘B` / `⌘I` |
| Find | `⌘F` | | Inline Code / Link | `⌘K` / `⌘⇧K` |
| Replace | `⌘⌥F` | | Heading 1–3 | `⌘1` · `⌘2` · `⌘3` |
| Bulleted list | `⌘⇧8` | | Numbered list | `⌘⇧7` |
| Blockquote | `⌘⇧.` | | | |

## 🧱 How it's built

| File | Role |
|------|------|
| `main.js` | Electron main — windows, native menu, file I/O & notebook persistence |
| `preload.js` | `contextBridge` API exposed to the renderer |
| `src/renderer.js` | CodeMirror editor, live preview, status bar, formatting, autosave |
| `build.js` | esbuild config that bundles the renderer into `dist/` |
| `index.html` · `styles.css` | App shell + theming |

**Stack:** Electron · CodeMirror 6 · markdown-it · esbuild · electron-builder

## 🗺️ Roadmap

- [x] Perpetual auto-saved notebook
- [x] Live preview toggle
- [x] Packaged `.app` / `.dmg` with a custom icon
- [ ] **Tabs** for multiple documents
- [ ] Optional custom notebook location (iCloud/Dropbox sync)
- [ ] Export to HTML / PDF

## 📄 License

[MIT](LICENSE) © [Ricardo Alcocer](https://github.com/ricardoalcocer)

<div align="center"><sub>Built with ☕ and Markdown.</sub></div>
