# Changelog

All notable changes to Buffer are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com); versions follow [semver](https://semver.org).
Every PR bumps the version and adds an entry — minor for features, patch for fixes.

## [1.0.0] — 2026-07-22 — the roadtrip release 🏜️

Everything below shipped across a roadtrip through Park City, Bryce Canyon,
Lone Rock and Mesa Verde.

### Added
- **Tabs** — perpetual notebook tabs + real file tabs, session restored on relaunch (#2)
- **Appearance** — light/dark/system toggle, persisted (#3)
- **⌘-click links** in the editor open in the browser (#4)
- **Renamed to Buffer** — was AlcoNotes (#5)
- **Images** — drag & drop / paste, stored in a sidecar assets folder (#6)
- **Checkboxes** — GFM task lists, tickable right in the preview (#7)
- **⌘1–⌘9 tab switching**, browser-style, with ⌘digit hints on the tabs (#8, #9, #10)
- **Open With / Finder integration** — registered as a macOS Markdown editor (#11)
- **Automatic backups** — hourly + at-launch snapshots; closed notebooks go to trash instead of being deleted (#12)
- **Export as PDF** (⌘⌥P) — print-styled, images/checkboxes/tables included (#13)
- **Menu bar icon** — Buffer keeps running with the window closed; one click summons it; the icon mirrors the app's M↓ mark (#16, #17)
- **Window memory** — reopens at the position and size you left it (#18)
- **Always on Top** (Window menu, ⌘⌥T), persisted (#19)
- **Open from Obsidian…** menu item (#20)
- **Highlights** — Bear-style `==text==` markup (⌘⇧H), theme-aware, in preview and PDF (#21)
- **Versioning** — this changelog, semver discipline, live version in the About panel and README badge (#23)

### Fixed
- Empty task items (`- [ ] `) render as checkboxes; checkboxes follow dark mode (post-#7)
- macOS "contains malware" false positive on unsigned builds — packaged app is now ad-hoc signed by `npm run dist` (#22)
- Accidentally committed 66k-line renderer bundle removed from the repo root (#22)

## [0.1.0] — 2026-07-09

- Initial AlcoNotes: a single perpetual auto-saved scratch note, CodeMirror 6 editor,
  optional live preview, native menus, packaged `.app`/`.dmg` (#1)
