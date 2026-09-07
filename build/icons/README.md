# Linux / Windows application icons

One square RGBA PNG per freedesktop **hicolor** size. The names are load-bearing:

- electron-builder maps every file in this directory to
  `/usr/share/icons/hicolor/<size>x<size>/apps/cgpa-pilot.png` (the name it also
  writes into the `.desktop` file's `Icon=` key).
- A desktop environment only looks in the sizes `hicolor/index.theme` declares
  (16…512). A single `icon.png` therefore lands in `1024x1024/`, which nobody
  reads — that is how the logo "disappeared" from the applications menu and the
  dock in ≤ v1.0.24.
- Transparency matters as much as the sizes: a PNG without an alpha channel is
  drawn as a white tile on light panels and as a white slab in the Windows
  taskbar. Corners must be transparent (colour type 6 / RGBA).

## Regenerate

Artwork source: `build/icon.png` (1024×1024, no alpha). ImageMagick only:

```bash
convert build/icon.png -alpha set -fuzz 6% -fill none -draw 'matte 2,2 floodfill' /tmp/master.png
for s in 16 24 32 48 64 96 128 256 512; do
  convert /tmp/master.png -filter Lanczos -resize ${s}x${s} \
          -define png:color-type=6 -type TrueColorAlpha -strip build/icons/${s}x${s}.png
done
```

The flood fill knocks out only the *connected* white background around the
squircle, so the artwork keeps its own corner shape (no radius guessing) and the
white mortarboard inside the logo is untouched. `png:color-type=6` stops
ImageMagick from saving the tiny sizes as a palette PNG.

`build/icons/256x256.png` is additionally copied to `resources/icon.png`
(`extraResources`) so the running window can set its own icon — `nativeImage`
cannot read from inside `app.asar`, and that copy lives beside it.
