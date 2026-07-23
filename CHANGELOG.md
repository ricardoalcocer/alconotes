# Changelog

All notable changes to Buffer are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com); versions follow [semver](https://semver.org).
Every PR bumps the version and adds an entry — minor for features, patch for fixes.

> Versions 0.2.0–0.17.1 were reconstructed retroactively from the merge history
> when versioning discipline was introduced in 0.18.0 (#23): each feature PR
> counted as a minor bump, each fix as a patch, dated by its actual merge.

## [0.19.0] — 2026-07-22
- **Outline sidebar** (⌘⇧O, or the toolbar's sidebar button) — the note's heading
  structure at a glance: click to jump, cursor section tracked live, resizable,
  width remembered (#24)

## [0.18.0] — 2026-07-22
- **Versioning** — this changelog, semver discipline, real version in the About
  panel, live version badge in the README, conventions recorded in CLAUDE.md (#23)

## [0.17.1] — 2026-07-22
- Fixed: macOS "contains malware" false positive on unsigned builds — the packaged
  app is now ad-hoc signed by `npm run dist` (#22)
- Fixed: accidentally committed 66k-line renderer bundle removed from the repo root (#22)

## [0.17.0] — 2026-07-22
- **Highlights** — Bear-style `==text==` markup (⌘⇧H), theme-aware, in preview and PDF (#21)

## [0.16.0] — 2026-07-16
- **Open from Obsidian…** menu item (#20)

## [0.15.0] — 2026-07-14
- **Always on Top** (Window menu, ⌘⌥T), persisted (#19)

## [0.14.0] — 2026-07-14
- **Window memory** — reopens at the position and size you left it (#18)

## [0.13.1] — 2026-07-14
- Tray icon now mirrors the app icon's M↓ mark (#17)

## [0.13.0] — 2026-07-14
- **Menu bar icon** — Buffer keeps running with the window closed; one click
  summons the notebook back (#16)

## [0.12.0] — 2026-07-14
- **Export as PDF** (⌘⌥P) — print-styled, images/checkboxes/tables included (#13)

## [0.11.0] — 2026-07-14
- **Automatic backups** — hourly + at-launch snapshots; closed notebooks go to
  trash instead of being deleted (#12)

## [0.10.0] — 2026-07-14
- **Open With / Finder integration** — registered as a macOS Markdown editor (#11)

## [0.9.0] — 2026-07-13
- **⌘digit hints** shown on tabs (#10)

## [0.8.0] — 2026-07-13
- **⌘1–⌘9 tab switching**, browser-style; headings moved to ⌘⌥1/2/3 (#8, #9)

## [0.7.0] — 2026-07-13
- **Checkboxes** — GFM task lists, tickable right in the preview (#7)
- Fixed: empty task items (`- [ ] `) render as checkboxes; checkboxes follow dark mode

## [0.6.0] — 2026-07-13
- **Images** — drag & drop / paste, stored in a sidecar assets folder (#6)

## [0.5.0] — 2026-07-09
- **Renamed to Buffer** — was AlcoNotes (#5)

## [0.4.0] — 2026-07-09
- **⌘-click links** in the editor open in the browser (#4)

## [0.3.0] — 2026-07-09
- **Appearance** — light/dark/system toggle, persisted (#3)

## [0.2.0] — 2026-07-09
- **Tabs** — perpetual notebook tabs + real file tabs, session restored on relaunch (#2)

## [0.1.0] — 2026-07-09
- Initial AlcoNotes: a single perpetual auto-saved scratch note, CodeMirror 6
  editor, optional live preview, native menus, packaged `.app`/`.dmg` (#1)
