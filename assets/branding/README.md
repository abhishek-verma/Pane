# Pane Brand Assets

Minimal Pane mark: a square with a bottom-right cutout (negative space window).

## Files

| File | Use |
|------|-----|
| `pane-mark.svg` | Default — `currentColor`, adapts to theme; use for app icons too |
| `pane-mark-black.svg` | Light backgrounds |
| `pane-mark-white.svg` | Dark backgrounds |
| `pane-poster.svg` | README / social hero (1280×640) |
| `png/` | Raster exports at common sizes |

For app icons and favicons, use `pane-mark.svg` (or the black/white variant). Add padding in the consuming app if the platform clips rounded corners.

## Regenerate PNGs

```bash
./assets/branding/export-pngs.sh
```

Requires [resvg](https://github.com/linebender/resvg) (`brew install resvg`). Uses SVG sources directly so the cutout stays **transparent** (macOS Quick Look / `qlmanage` fills holes white — do not use it).

Verification runs automatically after export (`verify-pngs.swift`).

## Proportions

- Canvas: 100×100
- Cutout: 24×24 (24% of edge length)
- Inset from bottom-right: 10 units
