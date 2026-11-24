# HomeForge 3D

Easy 3D house builder. Place walls, doors, windows, floors, stairs and roofs, save any part as a **preset**, and export/import presets as files. Runs as a website, a Windows EXE, and an Android app (APK/AAB). Works offline.

## Status (checkpoint 2)

**Tested here (36 automated tests pass):** project model, hierarchy operations, bounded undo/redo, preset create/export/import with strict validation, built-in presets, editor store (tools, snap, re-parenting).

**Written but not compiled here** (this workspace has no network for `npm install`, so React/Three.js types were unavailable): the UI, viewport, storage, Electron shell and workflows. Run the first-run checks below and send any error.

## Layout (Unity style)

- Left: **Hierarchy** (collapse, double-click rename, drag and drop to re-parent, hide/lock, Group/Ungroup/Duplicate/Delete)
- Center: **Scene** with tools Hand / Move / Rotate / Scale, Snap, Frame, Reset, standard views, perspective/iso, orientation gizmo
- Right: **Inspector** (position, rotation, scale, size, material, save as preset)
- Bottom: **Project** (Parts library, Shapes, Materials, Import/Export)
- Drag the thin bars between panels to resize. On phones the panels slide over the 3D view.

## Controls

| Action | Mouse / keyboard | Touch |
|---|---|---|
| Orbit | left drag | one finger |
| Pan | right drag, or Hand tool (Q) | two fingers |
| Zoom | mouse wheel, `+` / `-`, or on-screen **+ / - / fit** buttons (hold to keep zooming) | pinch or buttons |
| Tools | Q hand, W move, E rotate, R scale | tool buttons |
| Frame | F | Frame button |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z | top bar |
| Duplicate / delete | Ctrl+D / Del | Hierarchy buttons |

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
