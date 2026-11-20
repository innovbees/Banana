# acad-ts (DWG writer)

BananaCAD writes `.dwg` files using [acad-ts](https://github.com/node-projects/acad-ts) version 3.7.0, a TypeScript port of [ACadSharp](https://github.com/DomCR/ACadSharp).
It is MIT licensed; see `LICENSE` in this folder.

`acad-ts.js` is the package's `dist/index-min.js` bundle. It was changed in one place: the final ES-module `export {...}` statement was turned into a global `globalThis.AcadTs = {...}`, so the file loads as a plain `<script>` from a page opened straight from disk. The file is loaded only the first time you save or export a DWG.

BananaCAD works around one problem in this version: block-reference attributes are not registered with the document, so BananaCAD registers them itself (see `js/dwgout.js`).
