# Buffer — repo conventions

macOS (Apple Silicon) Electron Markdown notebook. Sources: `main.js` (Electron main),
`preload.js`, `src/renderer.js` (bundled to `dist/` by esbuild), `index.html`, `styles.css`.

## Workflow
- Every feature/fix goes on a branch with a PR. The user merges unless they explicitly
  say otherwise. Never push to main without being asked.
- **Every PR bumps the semver version in `package.json` (minor = feature, patch = fix)
  and adds a `CHANGELOG.md` entry.** No exceptions — the About panel and the README
  badge report it.
- README: each feature PR also updates the features table, the shortcuts table, and
  the roadmap in the same PR.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Testing
- Smoke tests boot the REAL `main.js` (wrapper script copied to the repo root — Electron
  resolves `index.html` relative to the main script's directory). Seed a temp userData
  dir via `ALCONOTES_USER_DATA`; `ALCONOTES_TEST_HOOKS=1` exposes `app.__tray` /
  `app.__showWindow`.

## Build & install rhythm
- `npm run dist` builds and **ad-hoc signs** `release/mac-arm64/Buffer.app` (the signing
  step is load-bearing: unsigned Electron apps trip macOS XProtect's malware false
  positive). Install: quit Buffer → `rm -rf /Applications/Buffer.app` → `cp -R` →
  `lsregister -f` → `open -a Buffer`.
- If dev Electron gets SIGKILLed after an npm install, its bundle signature broke:
  verify the download against Electron's SHASUMS, then
  `codesign --force --deep --sign - node_modules/electron/dist/Electron.app`.
