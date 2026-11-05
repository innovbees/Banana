# BananaCAD — 2D drafting in the browser

An AutoCAD-style 2D drafting program. It runs offline with no install and no build step.
Open `cad/index.html` in Chrome, Edge or Firefox (double-click the file), or serve the folder:

```bash
cd cad && python3 -m http.server 8000   # then open http://localhost:8000
```

## Working like AutoCAD

- **Command line:** type a command or alias (`L`, `C`, `REC`, `TR`, `O`…) and press **Enter** or **Space**. As you type, autocomplete lists matching commands. **Enter**, **Space** or a right-click on an empty command line repeats the last command, and **Esc** cancels.
- **Prompts and options:** prompts read the same way as in AutoCAD, e.g. `Specify next point or [Close/Undo]:`. To pick an option, type its first letters or click it. A value in `<…>` is the default; press Enter to accept it.
- **Coordinates:** type `100,50` for an absolute point, `@30,0` for a point relative to the last one, or `@50<45` for a relative polar point. You can also point the cursor in a direction and type a length (direct distance).
- **Drafting aids:** Object snaps show yellow markers for Endpoint, Midpoint, Center, Quadrant, Intersection, Perpendicular, Insertion and Nearest. The function keys are F3 OSNAP, F7 GRID, F8 ORTHO (hold Shift to flip it temporarily), F9 SNAP and F12 dynamic input next to the cursor.
- **Selection:** click objects to select them. A window drawn **left→right** selects only objects fully inside it, and one drawn **right→left** is a crossing window that also selects objects it touches. Shift+click removes an object. Click a blue **grip** to stretch it. Typing `C` at a grip makes copies.
- **View:** the mouse wheel zooms at the cursor, a middle-button drag pans, and `Z` then `E` zooms to the extents.

## Comments, notes and annotation

| Command | Aliases | What it does |
|---|---|---|
| `MLEADER` | `LE`, `NOTE`, `COMMENT` | Arrow + landing + a note typed in place (multi-line) |
| `MTEXT` | `T`, `MT` | Paragraph text that wraps inside a box |
| `TEXT` | `DT`, `TX` | Single-line text typed in place. Enter starts a new line, and an empty line ends the command |
| `TEXTEDIT` | `ED`, or double-click | Edit text, notes, leaders or dimension text |
| `REVCLOUD` | `RC` | Revision cloud around an area, for markups |
| `DIMLINEAR` / `DIMALIGNED` / `DIMRADIUS` / `DIMDIAMETER` | `DLI` / `DAL` / `DRA` / `DDI` | Dimensions (`T` option overrides the text, `<>` = measured value) |

The default drawing has an **Annotation** layer, so you can put notes on it and switch them all on or off at once.

## All commands

**Draw:** `LINE L`, `PLINE PL`, `RECTANG REC`, `CIRCLE C` (2P/3P/Diameter), `ARC A` (3-point or Center), `POLYGON POL`, `ELLIPSE EL`, `HATCH H` (SOLID, ANSI31, ANSI37, LINE, NET, DASHED45; pick inside a closed boundary)
**Modify:** `MOVE M`, `COPY CO`, `ROTATE RO` (Copy/Reference), `SCALE SC` (Copy/Reference), `MIRROR MI`, `OFFSET O` (Through), `TRIM TR`, `EXTEND EX`, `FILLET F` (Radius), `ARRAY AR` (Rectangular/Polar), `EXPLODE X`, `ERASE E`/Delete, `MATCHPROP MA`
**Inquiry:** `DIST DI`, `AREA AA`, `ID`, `LIST LI`
**View:** `ZOOM Z` (Extents/Window/Previous/nX), `PAN P`, `REGEN RE`
**Settings:** `LAYER LA` (layer manager), `-LAYER` (Make/Set/ON/OFF/Color/Lock), `COLOR`, `TEXTSIZE`, `DIMSCALE`, `DIMDEC`, `GRID`, `SNAP`, `ORTHO`, `OSNAP`
**File/edit:** `NEW`, `OPEN`, `SAVE`, `SAVEAS`, `EXPORT` (DXF/SVG/PNG), `PLOT`, `UNDO U`, `REDO`, Ctrl+C/X/V, Ctrl+A, `HELP` (F1)

## Files

- **Opening DWG:** Open (Ctrl+O), or drag a `.dwg` file onto the drawing area. BananaCAD reads AutoCAD DWG files using LibreDWG, which runs inside your browser, so files are never uploaded. LibreDWG supports most versions from R13 to 2018 and later. The DWG reader is about 3.4 MB and loads the first time you open a DWG.
- **Opening DXF:** The importer handles lines, polylines (including arc segments), circles, arcs, ellipses, splines, text, MTEXT, attributes, hatches, leaders and multileader notes. It also handles blocks, including nested, scaled, rotated and mirrored ones, and dimensions. Blocks and dimensions are converted into ordinary objects. Layers keep their colour, linetype and on/off state. Paper-space layouts, xrefs, images and 3D objects are skipped, and the command line tells you what was left out.
- **Saving:** Save / Open use the native `.bcad` format, which is JSON. Your work is also autosaved in the browser.
- **Sending a drawing back to AutoCAD:** Export DXF writes AutoCAD R12 ASCII DXF. AutoCAD, LibreCAD, DraftSight and others open it directly, and in AutoCAD you can use `SAVEAS` to turn it into DWG. Writing DWG directly isn't supported because LibreDWG's DWG writer is still experimental.
- **Export SVG / PNG and PLOT** produce a white-background print. White and very light colours are output as black.

The DWG reader lives in `lib/libredwg/`, which is LibreDWG (GPL-3.0); see `lib/libredwg/NOTICE.md`.

## Code layout

| File | Purpose |
|---|---|
| `js/geom.js` | Vector math, intersections, polygon and hatch helpers |
| `js/entities.js` | Entity types: drawing ops, picking, snaps, grips, transforms, trim/offset support |
| `js/render.js` | Canvas renderer and SVG export |
| `js/io.js` | DWG import (via LibreDWG), DXF import/export with block expansion, downloads |
| `js/commands.js` | All commands, written as generators that `yield` prompts |
| `js/app.js` | Command runner, command line, mouse/keyboard, panels, drawing loop |

To add a command, call `defCmd('NAME', ['ALIAS'], 'description', function* (c) { const p = yield P.point('Specify point'); … })`.
