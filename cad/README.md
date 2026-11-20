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
- **Drafting aids:** Object snaps show yellow markers for Endpoint, Midpoint, Center, Quadrant, Intersection, Perpendicular, Insertion, Node and Nearest. **Polar tracking** (F10) locks the cursor to angle steps you choose (90°, 45°, 30°, 15°…). **Object snap tracking** (F11) works like AutoCAD's: hover over a snap point for half a second to acquire it, then the cursor lines up with it horizontally or vertically, or with the intersection of two such lines. The other function keys are F3 OSNAP, F7 GRID, F8 ORTHO (hold Shift to flip it temporarily), F9 SNAP and F12 dynamic input next to the cursor.
- **Selection:** click objects to select them. A window drawn **left→right** selects only objects fully inside it, and one drawn **right→left** is a crossing window that also selects objects it touches. Shift+click removes an object. Click a blue **grip** to stretch it. Typing `C` at a grip makes copies.
- **View:** the mouse wheel zooms at the cursor, a middle-button drag pans, and `Z` then `E` zooms to the extents.
- **Ribbon:** the toolbar is split into Home, Annotate, Insert, Layout and View tabs. The side panel has Properties, Layers, Blocks, Styles and Settings tabs.

## Comments, notes and annotation

| Command | Aliases | What it does |
|---|---|---|
| `MLEADER` | `LE`, `NOTE`, `COMMENT` | Arrow + landing + a note typed in place (multi-line) |
| `MTEXT` | `T`, `MT` | Paragraph text that wraps inside a box |
| `TEXT` | `DT`, `TX` | Single-line text typed in place. Enter starts a new line, and an empty line ends the command |
| `TEXTEDIT` | `ED`, or double-click | Edit text, notes, leaders or dimension text |
| `REVCLOUD` | `RC` | Revision cloud around an area, for markups |
| `TABLE` / `TABLEDIT` | `TB`, or double-click | Table. Type into the cells and press Tab to move to the next cell |
| `DIMLINEAR` / `DIMALIGNED` / `DIMANGULAR` / `DIMRADIUS` / `DIMDIAMETER` | `DLI` / `DAL` / `DAN` / `DRA` / `DDI` | Dimensions (`T` option overrides the text, `<>` = measured value) |
| `DIMBASELINE` / `DIMCONTINUE` / `DIMORDINATE` | `DBA` / `DCO` / `DOR` | Stacked, chained and X/Y ordinate dimensions |
| `STYLE` / `DIMSTYLE` | `ST` / `D` | Text styles (font, width factor, slant) and dimension styles (arrowheads incl. architectural ticks, sizes, decimals, prefix/suffix, overall scale) |

The default drawing has an **Annotation** layer, so you can put notes on it and switch them all on or off at once.
Dimensions are **associative**: if you pick their points with object snaps, they stay attached to the geometry and update when you move, stretch or edit it. `DIMREASSOCIATE` re-attaches a dimension.

## Blocks (reusable symbols)

- `BLOCK` (`B`) turns selected objects into a named block. `INSERT` (`I`) places a block from the drawing, from the built-in **library** or from any DWG/DXF/BCAD file, with a scale and rotation.
- **Attributes** are editable text fields inside blocks, such as room names or title-block fields. Define them with `ATTDEF` and edit the values with `ATTEDIT` or by double-clicking the block. `ATTSYNC` updates existing blocks after you change a block's definition.
- `BEDIT` edits a block in place, with the rest of the drawing greyed out. `BCLOSE` saves the changes, and every copy of the block updates.
- The **Blocks** panel shows thumbnails of the drawing's blocks plus the symbol library. The library is drawn in mm and includes doors, windows, beds, a wardrobe, desk, sofa, dining table, WC, washbasin, shower, a north arrow and an A3 title block with attribute fields.
- `PURGE` removes unused blocks and layers.

## Layouts, lineweights and plotting

- The tabs under the drawing switch between **Model** and **layout sheets**. A layout is a paper sheet (A4–A0, Letter, Legal, Tabloid, ANSI C/D) laid out in millimetres.
- A layout holds **viewports** that show the model at an exact scale (1:1 … 1:1000). New layouts get a viewport fitted to the drawing automatically.
- To change a viewport, select its border and set the scale in Properties. Double-click inside a viewport to pan and zoom it.
- Layout commands: `LAYOUT`, `PAGESETUP`, `MVIEW`, `MSPACE`/`PSPACE` and `UNITS`. The drawing units (mm by default) decide what "1:50" means.
- **Lineweights** are set per layer and per object. The **LWT** button in the status bar shows them on screen. In the Layers panel you can also mark a layer **not to plot**, which new layouts use for their Viewports layer.
- `PLOT` (Ctrl+P) creates a **vector PDF**. A layout prints 1:1 on its sheet. The model prints at a chosen scale or fitted to the paper, with optional monochrome and lineweights.

## Selection, groups and images

- `QSELECT` (Quick Select) selects objects by type, layer, colour, text content or block name. It can start a new selection, add to the current one or remove from it. `SELECTSIMILAR` selects everything with the same type and layer as the objects already selected.
- `GROUP` (`G`) groups objects so that clicking one selects all of them. `UNGROUP` dissolves a group, and Ctrl+Shift+A (`PICKSTYLE`) turns group selection off and on. Copies of a group become a new group of their own.
- `IMAGEATTACH` (`IAT`) places a PNG or JPG image, such as a scanned plan or a photo, so you can trace over it. In Properties you can lower its opacity and set its size. To scale it to real size, use `SCALE` with the Reference option or `ALIGN` on a known length. Images are saved inside the `.bcad` file and are included in PDF plots.
- **Large drawings:** the drawing is rendered once into a cached layer, so moving the mouse only redraws the cursor and highlights. Objects outside the view are skipped. In a test drawing with 60,000 objects, a mouse move costs almost nothing and a redraw takes about 0.1 s.

## All commands

**Draw:** `LINE L`, `PLINE PL` (with Arc segments), `RECTANG REC`, `CIRCLE C` (2P/3P/Diameter), `ARC A` (3-point or Center), `POLYGON POL`, `ELLIPSE EL`, `SPLINE SPL`, `HATCH H` (SOLID, ANSI31, ANSI37, LINE, NET, DASHED45; pick inside any enclosed area, even one bounded by separate lines), `REVCLOUD RC`
**Modify:** `MOVE M`, `COPY CO`, `ROTATE RO` (Copy/Reference), `SCALE SC` (Copy/Reference), `MIRROR MI`, `STRETCH S`, `OFFSET O` (Through), `TRIM TR`, `EXTEND EX`, `FILLET F` (Radius), `CHAMFER CHA`, `BREAK BR`, `BREAKATPOINT`, `JOIN J`, `LENGTHEN LEN` (DElta/Percent/Total/DYnamic), `ALIGN AL`, `PEDIT PE`, `ARRAY AR` (Rectangular/Polar), `EXPLODE X`, `ERASE E`/Delete, `MATCHPROP MA`
**Blocks:** `BLOCK B`, `INSERT I`, `ATTDEF`, `ATTEDIT`, `ATTSYNC`, `BEDIT`, `BCLOSE`, `PURGE`, `BLOCKSPALETTE`
**Layouts:** `LAYOUT`, `PAGESETUP`, `MVIEW MV`, `MSPACE MS`, `PSPACE PS`, `UNITS`, `PLOT`
**Selection & images:** `QSELECT`, `SELECTSIMILAR`, `GROUP G`, `UNGROUP`, `PICKSTYLE`, `IMAGEATTACH IAT`
**Inquiry:** `DIST DI`, `AREA AA`, `ID`, `LIST LI`
**View:** `ZOOM Z` (Extents/Window/Previous/nX), `PAN P`, `REGEN RE`
**Settings:** `LAYER LA` (layer manager), `-LAYER` (Make/Set/ON/OFF/Color/Lock), `COLOR`, `TEXTSIZE`, `DIMSCALE`, `DIMDEC`, `GRID`, `SNAP`, `ORTHO`, `OSNAP`
**File/edit:** `NEW`, `OPEN`, `SAVE`, `SAVEAS` (DWG 2000–2018 / DXF / BCAD), `EXPORT` (DWG/DXF/SVG/PNG), `PLOT` (PDF), `UNDO U`, `REDO`, Ctrl+C/X/V, Ctrl+A, `HELP` (F1)

## Files

- **Opening DWG:** Open (Ctrl+O), or drag a `.dwg` file onto the drawing area. BananaCAD reads AutoCAD DWG files using LibreDWG, which runs inside your browser, so files are never uploaded. LibreDWG supports most versions from R13 to 2018 and later. The DWG reader is about 3.4 MB and loads the first time you open a DWG.
- **Creating and editing DWG:**
  - **Saving an opened DWG:** open a `.dwg`, edit it and press **Ctrl+S**. It is saved back as DWG in the same AutoCAD version. In Chrome or Edge it writes straight into the same file after asking for permission once. In other browsers you choose a location, or it downloads.
  - **New drawings:** use `SAVEAS` with the DWG format and choose AutoCAD **2018, 2013, 2010, 2007, 2004 or 2000**. The **DWG** button in the top bar exports a copy.
  - **What is written:** objects are written as native AutoCAD objects: lines, arcs, circles, ellipses, polylines with arc segments, TEXT, MTEXT, hatches (solid and patterns, with islands), **real dimensions**, blocks with attributes, layers (colour, linetype, lineweight, on/off, plot), and text and dimension styles.
  - **Saved as simpler objects:** splines become polylines, and leaders become a polyline, an arrow and MTEXT. Tables are split into lines and text.
  - **Not saved to DWG:** layout sheets and images. Keep a `.bcad` copy if you need those.
  - **Library:** DWG writing uses acad-ts (MIT, about 1.2 MB), which loads the first time you save a DWG.
- **Opening DXF:** The importer handles lines, polylines (including arc segments), circles, arcs, ellipses, splines, text, MTEXT, attributes, hatches, leaders and multileader notes. Blocks stay blocks, including nested, scaled, rotated, mirrored and arrayed ones, and keep their attributes. Dimensions come in as single objects. Layers keep their colour, linetype and on/off state, and text styles keep their fonts. Paper-space layouts, xrefs, images and 3D objects are skipped, and the command line tells you what was left out.
- **Saving:** Save / Open use the native `.bcad` format, which is JSON. Your work is also autosaved in the browser.
- **DXF:** Export DXF writes AutoCAD R12 ASCII DXF of the model, with blocks, attributes, layers and text styles. Use it for programs that don't read DWG.
- **PLOT** writes a PDF to scale. **Export SVG / PNG** writes the model. All of them print on white, and white and very light colours come out black.

The DWG reader lives in `lib/libredwg/`, which is LibreDWG (GPL-3.0); see `lib/libredwg/NOTICE.md`. The DWG writer lives in `lib/acad-ts/`, which is acad-ts (MIT); see `lib/acad-ts/NOTICE.md`.

## Code layout

| File | Purpose |
|---|---|
| `js/geom.js` | Vector math, intersections, polygon and hatch helpers |
| `js/entities.js` | Entity types: drawing ops, picking, snaps, grips, transforms, trim/offset support |
| `js/render.js` | Canvas renderer and SVG export |
| `js/io.js` | DWG import (via LibreDWG), DXF import/export (blocks, attributes, styles), downloads |
| `js/library.js` | Built-in block/symbol library |
| `js/plot.js` | Paper sizes, scales, vector PDF writer, Plot dialog |
| `js/dwgout.js` | DWG writing (BananaCAD drawing → native AutoCAD objects via acad-ts) |
| `js/commands.js` | All commands, written as generators that `yield` prompts |
| `js/app.js` | Command runner, command line, mouse/keyboard, panels, drawing loop |

To add a command, call `defCmd('NAME', ['ALIAS'], 'description', function* (c) { const p = yield P.point('Specify point'); … })`.
