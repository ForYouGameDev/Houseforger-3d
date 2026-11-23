# HomeForge 3D

Easy 3D house builder. Place walls, doors, windows, floors, stairs and roofs, save any part as a **preset**, and export/import presets as files. Runs as a website, a Windows EXE, and an Android app (APK/AAB). Works offline.

## Status (checkpoint 1)

Built and tested here: project model, scene tree (group/ungroup/hide/lock/delete/duplicate), bounded undo/redo, preset create/export/import with strict validation, built-in presets, editor store. **31 automated tests pass.**

Written but **not yet compiled or run** (this workspace had no network for `npm install`): React UI, Three.js viewport, IndexedDB storage, Electron shell, GitHub workflows. Run the first-run checks below and send me any errors; I will fix them.

## First run

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run dev        # website at http://localhost:5173
```

## Builds (GitHub Actions)

| Target | Workflow | Output |
|---|---|---|
| Checks | `ci.yml` (every push/PR) | typecheck, lint, tests, build |
| Windows EXE | `windows-exe.yml` (manual or `v*` tag) | installer + portable `.exe` artifact |
| Android | `android.yml` (manual or `v*` tag) | debug APK, AAB (+ signed release APK if secrets set) |
| Website | `web.yml` (push to main) | GitHub Pages (enable Pages: Settings -> Pages -> Source: GitHub Actions) |

Play Store needs a signed AAB. Add secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Files

- `src/core` pure logic (no React/Three): project, presets, history, math
- `src/editor/store.ts` editor state; every edit is one undoable step
- `src/render/viewport.ts` Three.js viewport
- `src/ui` React UI (Easy mode default, Advanced optional)
- `src/storage` IndexedDB + cross-platform file save/open
- `electron/` secure main + preload (no Node in the page)

## Preset files

`.homeforge-presets` is JSON. Imports are validated (sizes, nesting depth, materials) and always get fresh ids.

## Next prompts

Planned: wall drawing tool with snapping, doors/windows cut into walls, roof generator, floors/levels, GLB/OBJ export, texture materials.
