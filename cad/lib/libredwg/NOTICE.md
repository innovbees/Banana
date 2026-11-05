# LibreDWG (DWG reader)

BananaCAD reads `.dwg` files using **LibreDWG** compiled to WebAssembly.
LibreDWG is distributed by the npm package [`@mlightcad/libredwg-web`](https://github.com/mlightcad/libredwg-web), and this folder contains version 0.8.1 of that package.

- `libredwg-web.js` is the package's `wasm/libredwg-web.js` loader. It was changed in two places so it loads as a plain `<script>` and works when `index.html` is opened straight from disk:
  - `export default` was replaced with a global
  - `import.meta.url` was replaced with the script URL
- `libredwg-wasm.js` is the package's `wasm/libredwg-web.wasm`, unmodified, stored gzip-compressed as base64.

These two files are loaded only when you open a DWG file.

**License:** LibreDWG and `@mlightcad/libredwg-web` are licensed under the **GNU General Public License v3.0**.
The source code is available at https://github.com/LibreDWG/libredwg and https://github.com/mlightcad/libredwg-web.
If you distribute BananaCAD together with these files, the GPL-3.0 terms apply to that distribution.
