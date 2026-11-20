'use strict';
/* BananaCAD application: state, command runner, input, drawing loop, UI. */
const AUTOSAVE_KEY = 'bananacad.autosave.v1';
const OSNAP_MODES = [
  ['end', 'Endpoint'], ['mid', 'Midpoint'], ['cen', 'Center'], ['quad', 'Quadrant'],
  ['int', 'Intersection'], ['perp', 'Perpendicular'], ['ins', 'Insertion'], ['node', 'Node'], ['nea', 'Nearest'],
];

function newLayout(name) { return { name, paper: 'A3', orient: 'landscape', ents: [] }; }
/* doc.entities always refers to the active space (model or a layout sheet). */
function attachSpaces(doc) {
  const own = Object.getOwnPropertyDescriptor(doc, 'entities');
  if (own && !own.get) { if (!Array.isArray(doc.model)) doc.model = Array.isArray(doc.entities) ? doc.entities : []; delete doc.entities; }
  if (!Array.isArray(doc.model)) doc.model = [];
  if (!Array.isArray(doc.layouts) || !doc.layouts.length) doc.layouts = [newLayout('Layout1')];
  if (!Object.prototype.hasOwnProperty.call(doc, '_space')) Object.defineProperty(doc, '_space', { value: -1, writable: true, enumerable: false, configurable: true });
  if (doc._space >= doc.layouts.length) doc._space = -1;
  if (!Object.getOwnPropertyDescriptor(doc, 'entities')) Object.defineProperty(doc, 'entities', {
    enumerable: false, configurable: true,
    get() { return this._space < 0 ? this.model : this.layouts[this._space].ents; },
    set(v) { if (this._space < 0) this.model = v; else this.layouts[this._space].ents = v; },
  });
  if (!doc.layers.find((l) => l.name === 'Viewports')) doc.layers.push({ name: 'Viewports', color: '#808080', visible: true, locked: false, linetype: 'Continuous', plot: false });
  return doc;
}
function newDoc() {
  return attachSpaces({
    name: 'Drawing1', model: [], layouts: [newLayout('Layout1')], units: 'mm', nextId: 1,
    layers: [
      { name: '0', color: '#ffffff', visible: true, locked: false, linetype: 'Continuous' },
      { name: 'Annotation', color: '#ffff00', visible: true, locked: false, linetype: 'Continuous' },
      { name: 'Dimensions', color: '#00ffff', visible: true, locked: false, linetype: 'Continuous' },
      { name: 'Hidden', color: '#808080', visible: true, locked: false, linetype: 'Hidden' },
    ],
    blocks: {},
    textStyles: [{ name: 'Standard', font: 'Arial', width: 1, oblique: 0 }, { name: 'Notes', font: 'Arial Narrow', width: 1, oblique: 0 }, { name: 'Title', font: 'Times New Roman', width: 1, oblique: 0 }],
    textStyle: 'Standard',
    dimStyles: [
      { name: 'Standard', textStyle: 'Standard', txt: 2.5, asz: 2.5, arrow: 'closed', exo: 0.625, exe: 1.25, gap: 0.625, dec: 2, adec: 0, scale: 1, pre: '', suf: '', tad: 'above', dli: 3.75 },
      { name: 'Architectural', textStyle: 'Standard', txt: 2.5, asz: 2.5, arrow: 'tick', exo: 1.5, exe: 1.5, gap: 0.8, dec: 0, adec: 0, scale: 1, pre: '', suf: '', tad: 'above', dli: 5 },
    ],
    dimStyle: 'Standard',
    clayer: '0', ccolor: 'bylayer', textSize: 2.5, dimScale: 1, dimDec: 2,
    filletRad: 0, offsetDist: 1, lastRadius: undefined, revArc: 10,
    hatchPattern: 'ANSI31', hatchScale: 1, hatchAngle: 0,
  });
}

const App = {
  doc: newDoc(),
  view: { cx: 210, cy: 148, scale: 3 },
  settings: { grid: true, snap: false, ortho: false, osnap: true, dyn: true, polar: true, otrack: true, polarInc: 45, gridSize: 10, snapSize: 5, leaderMulti: false,
    osmodes: { end: true, mid: true, cen: true, quad: true, int: true, perp: true, ins: true, node: true, nea: false } },
  tracked: [],
  sel: new Set(),
  get space() { return this.doc._space; },
  spaceViews: {},
  activeVp: null,
  undoStack: [], redoStack: [],
  cmd: null, lastCmd: null, lastPoint: null,
  mouse: { sx: 0, sy: 0, over: false, world: { x: 0, y: 0 }, pt: { x: 0, y: 0 }, snap: null, shift: false },
  hover: null, win: null, drag: null, hidden: null, clipboard: null,
  rev: 0, cache: new Map(), viewStack: [], inputHistory: [], histPos: -1, ac: { items: [], idx: 0 },
  panel: 'props',

  /* ===================== init ===================== */
  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      cv: $('cv'), vp: $('viewport'), hist: $('history'), prompt: $('prompt'), input: $('cmdinput'), ac: $('ac'), dyn: $('dyn'),
      tip: $('osnaptip'), editor: $('editor'), edText: $('edtext'), coords: $('coords'), status: $('status'), ctx: $('ctxmenu'),
      side: $('side'), file: $('fileinput'), title: $('docname'), layerSel: $('layersel'), help: $('help'),
    };
    this.ctx2d = this.el.cv.getContext('2d');
    this.buildRibbon();
    this.bindEvents();
    this.resize();
    let restored = false;
    try {
      const s = localStorage.getItem(AUTOSAVE_KEY);
      if (s) { const o = JSON.parse(s); if (o && o.doc && ((o.doc.model && o.doc.model.length) || (o.doc.entities && o.doc.entities.length))) { this.doc = attachSpaces(Object.assign(newDoc(), o.doc)); this.doc._space = -1; if (o.view) this.view = o.view; if (o.settings) Object.assign(this.settings, o.settings, { osmodes: Object.assign(this.settings.osmodes, o.settings.osmodes || {}) }); restored = true; } }
    } catch (err) { /* storage unavailable */ }
    if (!restored) this.view = { cx: 210, cy: 148, scale: Math.max(0.5, (this.W - 40) / 440) };
    if (!this.doc.blocks) this.doc.blocks = {};
    E.ctxDoc = this.doc;
    this.print('BananaCAD — 2D drafting. Type a command (e.g. LINE or L) and press Enter. Press F1 for the command list.');
    if (restored) this.print(`Restored autosaved drawing "${this.doc.name}" (${this.doc.entities.length} objects).`);
    this.showPrompt();
    this.refreshUI();
    this.el.input.focus();
  },

  /* ===================== document helpers ===================== */
  layer(name) { return this.doc.layers.find((l) => l.name.toLowerCase() === String(name).toLowerCase()); },
  visibleEntities() {
    const v = new Set(this.doc.layers.filter((l) => l.visible).map((l) => l.name)), be = this.blockEdit;
    return this.doc.entities.filter((e) => v.has(e.layer) && !(be && e.id === be.insId));
  },
  selectableEntities() {
    const v = new Set(this.doc.layers.filter((l) => l.visible && !l.locked).map((l) => l.name)), be = this.blockEdit;
    return this.doc.entities.filter((e) => v.has(e.layer) && (!be || be.ids.has(e.id)));
  },
  selectedIds() { return [...this.sel].filter((id) => this.get(id)); },
  get(id) {
    if (!this.index) { this.index = new Map(); for (const e of this.doc.entities) this.index.set(e.id, e); }
    return this.index.get(id);
  },
  add(e) {
    delete e.assoc;
    e.id = this.doc.nextId++;
    if (!e.layer || !this.layer(e.layer)) e.layer = this.doc.clayer;
    if (!e.color) e.color = this.doc.ccolor;
    this.doc.entities.push(e);
    if (this.blockEdit) this.blockEdit.ids.add(e.id);
    this.index = null; this.changed();
    return e;
  },
  remove(id) {
    const i = this.doc.entities.findIndex((e) => e.id === id);
    if (i >= 0) this.doc.entities.splice(i, 1);
    this.sel.delete(id); this.index = null; this.changed();
  },
  changed() {
    E.ctxDoc = this.doc; E.rev++;
    this.rev++; this.cache.clear();
    this.requestRedraw();
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.autosave(), 600);
    if (!this.cmd) this.refreshProps();
  },
  autosave() {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ doc: this.doc, view: this.view, settings: this.settings })); } catch (err) { /* quota */ }
  },
  serialize() { const d = this.doc; return JSON.stringify({ m: d.model, la: d.layouts, l: d.layers, n: d.nextId, c: d.clayer, b: d.blocks, ts: d.textStyles, ds: d.dimStyles, t: d.textStyle, dd: d.dimStyle }); },
  captureState() { return this.serialize(); },
  restoreState(s) {
    const o = JSON.parse(s);
    this.doc.model = o.m; this.doc.layouts = o.la; if (this.doc._space >= o.la.length) this.doc._space = -1; this.doc.layers = o.l; this.doc.nextId = o.n; this.doc.clayer = o.c; if (o.b) this.doc.blocks = o.b; if (o.ts) { this.doc.textStyles = o.ts; this.doc.dimStyles = o.ds; this.doc.textStyle = o.t; this.doc.dimStyle = o.dd; }
    this.index = null;
    for (const id of [...this.sel]) if (!this.get(id)) this.sel.delete(id);
    this.changed(); this.refreshUI();
  },
  undo() {
    if (!this.undoStack.length) { this.print('Nothing to undo.'); return; }
    this.redoStack.push(this.serialize());
    this.restoreState(this.undoStack.pop());
    this.print('Undo');
  },
  redo() {
    if (!this.redoStack.length) { this.print('Nothing to redo.'); return; }
    this.undoStack.push(this.serialize());
    this.restoreState(this.redoStack.pop());
    this.print('Redo');
  },
  bbox(e) {
    let b = this.cache.get(e.id);
    if (!b) { b = E.bbox(e, this.doc); this.cache.set(e.id, b); }
    return b;
  },

  /* ===================== command runner ===================== */
  makeCtx() {
    const app = this;
    return {
      app, usedSel: false,
      get doc() { return app.doc; },
      add: (e) => app.add(e), remove: (id) => app.remove(id), get: (id) => app.get(id),
      changed: () => app.changed(), print: (m) => app.print(m),
    };
  },
  runCommand(name, opts) {
    const def = typeof name === 'string' ? Commands.lookup(name) : name;
    if (!def) { this.print(`Unknown command "${String(name).toUpperCase()}".  Press F1 for help.`); return; }
    if (this.cmd) this.cancel(true);
    this.hideAC();
    if (!def.sel && !def.transparent) this.sel.clear();
    this.print(`Command: ${def.name}`, 'cmd');
    const ctx = this.makeCtx();
    this.cmd = { def, ctx, gen: def.fn(ctx, opts), prompt: null, snap: def.noUndo ? null : this.serialize() };
    if (!def.internal && def.name !== 'UNDO' && def.name !== 'REDO') this.lastCmd = def.name;
    this.advance(undefined);
  },
  advance(value) {
    const cmd = this.cmd;
    if (!cmd) return;
    let r;
    try { r = cmd.gen.next(value); }
    catch (err) { console.error(err); this.print('Error: ' + err.message); this.finish(); return; }
    if (this.cmd !== cmd) return;
    if (r.done) { this.finish(); return; }
    cmd.prompt = r.value || { type: 'point', msg: '' };
    if (cmd.prompt.type === 'textedit') this.openEditor(cmd.prompt); else this.closeEditor();
    if (cmd.prompt.type === 'wait') {
      const pr = cmd.prompt, alive = () => this.cmd === cmd && cmd.prompt === pr;
      Promise.resolve(pr.promise).then((v) => { if (alive()) this.advance(v); }, (err) => { if (alive()) this.advance({ error: (err && err.message) || String(err) }); });
    }
    this.showPrompt();
    this.updateMouse();
    this.requestRedraw();
  },
  finish() {
    const cmd = this.cmd;
    if (!cmd) return;
    this.cmd = null;
    this.closeEditor();
    this.hidden = null; this.win = null; this.tracked = [];
    this.reassoc();
    if (cmd.snap && cmd.snap !== this.serialize()) {
      this.undoStack.push(cmd.snap); this.redoStack = [];
      if (this.undoStack.length > 200) this.undoStack.shift();
    }
    if (cmd.ctx.usedSel && !cmd.def.keepSel) this.sel.clear();
    this.showPrompt(); this.refreshUI(); this.requestRedraw();
  },
  cancel(silent) {
    if (!this.cmd) return;
    const cmd = this.cmd;
    try { cmd.gen.return(); } catch (err) { console.error(err); }
    if (!silent) this.print('*Cancel*');
    if (this.cmd === cmd) this.finish();
  },

  /* parse text typed at the command line for the current prompt */
  submit(raw) {
    const text = raw ?? '';
    if (!this.cmd) {
      const t = text.trim();
      if (!t) { if (this.lastCmd) this.runCommand(this.lastCmd); return; }
      this.inputHistory.push(t); this.histPos = -1;
      this.runCommand(t);
      return;
    }
    const pr = this.cmd.prompt;
    if (pr.type === 'textedit') { this.submitEditor(); return; }
    if (text.trim()) { this.inputHistory.push(text.trim()); this.histPos = -1; }
    this.print(`${this.promptText(pr)} ${text}`, 'echo');
    const v = this.parseInput(pr, text);
    if (v === undefined) { this.print(pr.type === 'point' ? 'Invalid point. Use x,y  @dx,dy  @dist<angle  or a distance.' : 'Invalid input.'); return; }
    if (pr.type === 'point' && v && typeof v.x === 'number') { this.lastPoint = v; this.lastSnapRef = null; }
    this.advance(v);
  },
  matchKeyword(pr, t) {
    if (!pr.keywords || !pr.keywords.length || !/[a-z]/i.test(t)) return null;
    const lt = t.toLowerCase();
    const exact = pr.keywords.find((k) => k.toLowerCase() === lt);
    if (exact) return exact;
    return pr.keywords.find((k) => k.toLowerCase().startsWith(lt)) || null;
  },
  parseInput(pr, raw) {
    const t = pr.type === 'string' ? raw.replace(/\s+$/, '') : raw.trim();
    if (pr.type === 'pan') return null;
    if (pr.type === 'wait') return undefined;
    if (pr.type === 'select') {
      if (!t) return this.selectedIds();
      if (/^all$/i.test(t)) { this.selectableEntities().forEach((e) => this.sel.add(e.id)); this.print(`${this.sel.size} found`); this.requestRedraw(); return undefined; }
      if (/^l(ast)?$/i.test(t)) { const e = this.doc.entities[this.doc.entities.length - 1]; if (e) this.sel.add(e.id); this.requestRedraw(); return undefined; }
      return undefined;
    }
    if (!t) return pr.def !== undefined ? pr.def : null;
    const kw = this.matchKeyword(pr, t);
    if (kw) return { kw };
    const num = (s) => (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? parseFloat(s) : NaN);
    switch (pr.type) {
      case 'point': {
        if (pr.allowNumber) { const m = /^([-+]?[\d.]+)x?$/i.exec(t); if (m && !isNaN(num(m[1]))) return { num: num(m[1]) }; }
        return this.parsePoint(t, pr.base) || undefined;
      }
      case 'distance': case 'number': { const v = num(t); return isNaN(v) ? undefined : v; }
      case 'int': { const v = num(t); return Number.isInteger(v) ? v : undefined; }
      case 'angle': { const v = num(t.replace(/^</, '').replace(/[d°]$/i, '')); return isNaN(v) ? undefined : v; }
      case 'string': return t;
      case 'kw': return undefined;
      case 'entity': return undefined;
    }
    return undefined;
  },
  parsePoint(t, base) {
    t = t.replace(/\s+/g, '');
    let rel = false;
    if (t[0] === '@') { rel = true; t = t.slice(1); if (!t) return base ? { ...base } : { x: 0, y: 0 }; }
    else if (t[0] === '#') t = t.slice(1);
    const N = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?)';
    let m = new RegExp(`^${N}<${N}$`, 'i').exec(t);
    if (m) {
      const v = G.polar({ x: 0, y: 0 }, parseFloat(m[2]) * DEG, parseFloat(m[1]));
      return rel && base ? G.add(base, v) : v;
    }
    m = new RegExp(`^${N},${N}$`, 'i').exec(t);
    if (m) {
      const v = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
      return rel && base ? G.add(base, v) : v;
    }
    m = new RegExp(`^${N}$`, 'i').exec(t);
    if (m && base) { // direct distance entry along the cursor direction
      let dir = G.sub(this.mouse.pt, base);
      if (G.len(dir) < 1e-12) dir = { x: 1, y: 0 };
      return G.add(base, G.mul(G.norm(dir), parseFloat(m[1])));
    }
    return null;
  },

  kwSep(pr) { return pr.type === 'kw' || !pr.msg || /[?:]$/.test(pr.msg) ? ' ' : ' or '; },
  promptText(pr) {
    if (!pr) return 'Command:';
    let s = pr.msg || '';
    if (pr.keywords && pr.keywords.length) s += `${this.kwSep(pr)}[${pr.keywords.join('/')}]`;
    if (pr.def !== undefined && pr.def !== null && pr.def !== '') s += ` <${typeof pr.def === 'number' ? fmtNum(pr.def, 4) : pr.def}>`;
    return s + ':';
  },
  showPrompt() {
    const el = this.el.prompt;
    el.innerHTML = '';
    const pr = this.cmd && this.cmd.prompt;
    if (!pr) { el.textContent = 'Command:'; this.updateDyn(); return; }
    const head = document.createElement('span');
    head.textContent = pr.msg || '';
    el.appendChild(head);
    if (pr.keywords && pr.keywords.length) {
      el.appendChild(document.createTextNode(this.kwSep(pr) + '['));
      pr.keywords.forEach((k, i) => {
        if (i) el.appendChild(document.createTextNode('/'));
        const s = document.createElement('span');
        s.className = 'kw'; s.textContent = k;
        s.onmousedown = (ev) => { ev.preventDefault(); this.submit(k); };
        el.appendChild(s);
      });
      el.appendChild(document.createTextNode(']'));
    }
    if (pr.def !== undefined && pr.def !== null && pr.def !== '') el.appendChild(document.createTextNode(` <${typeof pr.def === 'number' ? fmtNum(pr.def, 4) : pr.def}>`));
    el.appendChild(document.createTextNode(':'));
    this.updateDyn();
  },
  print(msg, cls) {
    const d = document.createElement('div');
    d.textContent = msg;
    if (cls) d.className = cls;
    this.el.hist.appendChild(d);
    while (this.el.hist.childNodes.length > 400) this.el.hist.firstChild.remove();
    this.el.hist.scrollTop = this.el.hist.scrollHeight;
  },
  expandHistory(force) {
    const c = document.getElementById('cmdline');
    c.classList.toggle('expanded', force === undefined ? !c.classList.contains('expanded') : force);
    this.el.hist.scrollTop = this.el.hist.scrollHeight;
    this.resize();
  },

  /* ===================== view ===================== */
  toScreen(p) { return { x: (p.x - this.view.cx) * this.view.scale + this.W / 2, y: this.H / 2 - (p.y - this.view.cy) * this.view.scale }; },
  toWorld(sx, sy) { return { x: (sx - this.W / 2) / this.view.scale + this.view.cx, y: (this.H / 2 - sy) / this.view.scale + this.view.cy }; },
  pushView() { this.viewStack.push({ ...this.view }); if (this.viewStack.length > 50) this.viewStack.shift(); },
  zoomExtents() {
    if (this.space >= 0) {
      const ps = paperSize(this.doc.layouts[this.space]);
      const b0 = Render.extents(this.doc) || { minx: 0, miny: 0, maxx: ps.w, maxy: ps.h };
      this.pushView();
      this.zoomRect({ minx: Math.min(0, b0.minx), miny: Math.min(0, b0.miny), maxx: Math.max(ps.w, b0.maxx), maxy: Math.max(ps.h, b0.maxy) }, false);
      return;
    }
    const b = Render.extents(this.doc);
    this.pushView();
    if (!b) { this.view = { cx: 210, cy: 148, scale: Math.max(0.5, (this.W - 40) / 440) }; this.requestRedraw(); return; }
    this.zoomRect(b, false);
  },
  setSpace(i) {
    if (i === this.space) return;
    if (this.cmd) this.cancel(true);
    this.spaceViews[this.space] = { ...this.view };
    this.doc._space = i;
    this.sel.clear(); this.index = null; this.activeVp = null; this.hover = null;
    if (i >= 0) {
      const L = this.doc.layouts[i];
      if (!L.ents.length && !L.init) { L.init = true; this.autoViewport(L); }
    }
    if (this.spaceViews[i]) this.view = { ...this.spaceViews[i] }; else this.zoomExtents();
    this.print(i < 0 ? 'Model space' : `Layout "${this.doc.layouts[i].name}" (${this.doc.layouts[i].paper} ${this.doc.layouts[i].orient})`);
    this.changed(); this.refreshUI(); this.buildLayoutBar();
  },
  autoViewport(L, rect) {
    const ps = paperSize(L), m = 10;
    const r = rect || { minx: m, miny: m, maxx: ps.w - m, maxy: ps.h - m };
    const ext = Render.extents(this.doc, this.doc.model) || { minx: 0, miny: 0, maxx: 100, maxy: 100 };
    const w = r.maxx - r.minx, h = r.maxy - r.miny;
    const vp = { type: 'viewport', p1: { x: r.minx, y: r.miny }, p2: { x: r.maxx, y: r.maxy }, cx: (ext.minx + ext.maxx) / 2, cy: (ext.miny + ext.maxy) / 2,
      scale: fitStdScale(this.doc, ext.maxx - ext.minx, ext.maxy - ext.miny, w * 0.95, h * 0.95), layer: 'Viewports', color: 'bylayer', id: this.doc.nextId++ };
    if (!this.layer('Viewports')) this.doc.layers.push({ name: 'Viewports', color: '#808080', visible: true, locked: false, linetype: 'Continuous', plot: false });
    L.ents.push(vp);
    return vp;
  },
  vpAt(p) {
    if (this.space < 0) return null;
    const vis = new Set(this.doc.layers.filter((l) => l.visible).map((l) => l.name));
    return this.doc.entities.filter((e) => e.type === 'viewport' && vis.has(e.layer)).reverse().find((v) => p.x > v.p1.x && p.x < v.p2.x && p.y > v.p1.y && p.y < v.p2.y) || null;
  },
  buildLayoutBar() {
    const bar = document.getElementById('layoutbar');
    if (!bar) return;
    bar.innerHTML = '';
    const mk = (label, i) => {
      const b = document.createElement('button');
      b.textContent = label; b.className = 'ltab' + (i === this.space ? ' on' : '');
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => this.setSpace(i);
      if (i >= 0) {
        b.ondblclick = () => this.renameLayout(i);
        b.oncontextmenu = (ev) => { ev.preventDefault(); this.layoutMenu(ev, i); };
      }
      bar.appendChild(b);
    };
    mk('Model', -1);
    this.doc.layouts.forEach((L, i) => mk(L.name, i));
    const add = document.createElement('button'); add.className = 'ltab add'; add.textContent = '+'; add.title = 'New layout';
    add.onclick = () => { this.doc.layouts.push(newLayout(this.uniqueLayoutName())); this.setSpace(this.doc.layouts.length - 1); };
    bar.appendChild(add);
    const hint = document.createElement('span'); hint.className = 'lhint';
    hint.textContent = this.space >= 0 ? (this.activeVp ? 'Inside viewport: wheel = zoom, middle-drag = pan · Esc to leave' : 'Paper space (mm) · double-click inside a viewport to pan/zoom it · right-click a tab for options') : '';
    bar.appendChild(hint);
  },
  uniqueLayoutName() { let i = this.doc.layouts.length + 1; while (this.doc.layouts.some((l) => l.name === `Layout${i}`)) i++; return `Layout${i}`; },
  renameLayout(i) {
    const L = this.doc.layouts[i], n = (prompt('Layout name', L.name) || '').trim();
    if (!n || n === L.name) return;
    if (this.doc.layouts.some((l) => l.name === n)) { this.print(`Layout "${n}" already exists.`); return; }
    this.pushUndoNow(); L.name = n; this.changed(); this.buildLayoutBar(); this.refreshUI();
  },
  deleteLayout(i) {
    if (this.doc.layouts.length < 2) { this.print('A drawing needs at least one layout.'); return; }
    if (!confirm(`Delete layout "${this.doc.layouts[i].name}"?`)) return;
    this.pushUndoNow();
    if (this.space === i) this.setSpace(-1);
    this.doc.layouts.splice(i, 1);
    if (this.space > i) this.doc._space--;
    this.changed(); this.buildLayoutBar();
  },
  layoutMenu(ev, i) {
    let m = document.getElementById('tabmenu');
    if (!m) { m = document.createElement('div'); m.id = 'tabmenu'; document.body.appendChild(m); document.addEventListener('mousedown', (e2) => { if (!m.contains(e2.target)) m.style.display = 'none'; }); }
    m.innerHTML = '';
    const item = (label, fn) => { const d = document.createElement('div'); d.className = 'ci'; d.textContent = label; d.onmousedown = (e2) => { e2.preventDefault(); m.style.display = 'none'; fn(); }; m.appendChild(d); };
    item('Rename…', () => this.renameLayout(i));
    item('Duplicate', () => { this.pushUndoNow(); const c = JSON.parse(JSON.stringify(this.doc.layouts[i])); c.name = this.uniqueLayoutName(); c.ents.forEach((e) => (e.id = this.doc.nextId++)); this.doc.layouts.push(c); this.setSpace(this.doc.layouts.length - 1); });
    item('Plot…', () => { this.setSpace(i); Plot.open(this); });
    item('Delete', () => this.deleteLayout(i));
    m.style.display = 'block';
    m.style.left = ev.clientX + 'px'; m.style.top = ev.clientY - m.offsetHeight - 4 + 'px';
  },
  zoomRect(b, push = true) {
    if (push) this.pushView();
    const w = Math.max(b.maxx - b.minx, 1e-6), h = Math.max(b.maxy - b.miny, 1e-6);
    this.view.cx = (b.minx + b.maxx) / 2; this.view.cy = (b.miny + b.maxy) / 2;
    this.view.scale = Math.min((this.W * 0.92) / w, (this.H * 0.92) / h);
    if (b.maxx - b.minx < 1e-9 && b.maxy - b.miny < 1e-9) this.view.scale = 10;
    this.requestRedraw();
  },
  zoomWindow(a, b) { this.zoomRect({ minx: Math.min(a.x, b.x), maxx: Math.max(a.x, b.x), miny: Math.min(a.y, b.y), maxy: Math.max(a.y, b.y) }); },
  zoomBy(f) { if (f > 0) { this.pushView(); this.view.scale *= f; this.requestRedraw(); } },
  zoomPrevious() { const v = this.viewStack.pop(); if (v) { this.view = v; this.requestRedraw(); } else this.print('No previous view.'); },
  zoomAt(sx, sy, f) {
    const before = this.toWorld(sx, sy);
    this.view.scale = G.clamp(this.view.scale * f, 1e-6, 1e7);
    const after = this.toWorld(sx, sy);
    this.view.cx += before.x - after.x; this.view.cy += before.y - after.y;
    this.updateMouse(); this.requestRedraw();
  },

  /* ===================== picking & snapping ===================== */
  pick(sx, sy, filter) {
    const p = this.toWorld(sx, sy), tol = 6 / this.view.scale;
    let best = null, bd = Infinity;
    for (const e of this.selectableEntities()) {
      if (filter && !filter(e)) continue;
      const b = this.bbox(e);
      if (p.x < b.minx - tol || p.x > b.maxx + tol || p.y < b.miny - tol || p.y > b.maxy + tol) continue;
      let d = E.hitDist(e, p, tol, this.doc);
      if (e.type === 'hatch') d += tol * 0.15; // edges of other objects win over hatch fills
      if (d <= tol && d <= bd) { bd = d; best = e; }
    }
    return best;
  },
  gripAt(sx, sy) {
    if (this.sel.size > 300) return null;
    for (const id of this.sel) {
      const e = this.get(id); if (!e) continue;
      const g = E.grips(e);
      for (let i = 0; i < g.length; i++) { const s = this.toScreen(g[i]); if (Math.abs(s.x - sx) <= 6 && Math.abs(s.y - sy) <= 6) return { id, index: i, pt: g[i] }; }
    }
    return null;
  },
  findOsnap(sx, sy, base) {
    const m = this.settings.osmodes;
    const p = this.toWorld(sx, sy), tol = 12 / this.view.scale;
    const near = [];
    for (const e of this.visibleEntities()) {
      if (this.hidden && this.hidden.has(e.id)) continue;
      const b = this.bbox(e);
      if (p.x < b.minx - tol || p.x > b.maxx + tol || p.y < b.miny - tol || p.y > b.maxy + tol) continue;
      near.push(e);
    }
    let best = null, bd = Infinity;
    const consider = (type, pt, ref) => { const d = G.dist(p, pt); if (d <= tol && d < bd) { bd = d; best = { type, pt, ref }; } };
    const curves = [];
    for (const e of near) {
      const cnt = {};
      for (const s of E.snaps(e, this.doc)) { const i = (cnt[s.type] = (cnt[s.type] || 0) + 1) - 1; if (m[s.type]) consider(s.type, s.pt, { id: e.id, type: s.type, i }); }
      const prims = E.prims(e);
      if (prims.length && prims.some((pr) => G.primDist(pr, p) <= tol)) curves.push({ e, prims });
    }
    if (m.int && curves.length > 1 && curves.length < 40) {
      for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++)
        for (const a of curves[i].prims) for (const b of curves[j].prims) {
          if (G.primDist(a, p) > tol || G.primDist(b, p) > tol) continue;
          for (const h of G.primIntersect(a, b)) consider('int', h);
        }
    }
    if (m.int) for (const c of curves) if (c.e.type === 'pline' && c.prims.length > 2) { /* self-intersections not snapped */ }
    if (m.perp && base && !best) {
      for (const c of curves) for (const pr of c.prims) {
        if (pr.kind === 'seg') { const t = G.projectT(base, pr.a, pr.b); if (t >= 0 && t <= 1) consider('perp', G.lerp(pr.a, pr.b, t)); }
        else { const d = G.dist(base, pr.c); if (d > 1e-9) { const q = G.polar(pr.c, G.angle(pr.c, base), pr.r); if (G.onArc(pr, G.arcTheta(pr, q))) consider('perp', q); } }
      }
    }
    if (!best && m.nea) for (const c of curves) for (const pr of c.prims) consider('nea', G.primClosest(pr, p).pt);
    return best;
  },
  takeSnapRef() { const r = this.lastSnapRef; this.lastSnapRef = null; return r || null; },
  /* Associative dimensions: move their points to follow the snapped geometry. */
  reassoc() {
    let n = 0;
    for (const e of this.doc.entities) {
      if (e.type !== 'dim' || !e.assoc) continue;
      for (const [k, ref] of Object.entries(e.assoc)) {
        if (k === 'circ') {
          const g = this.get(ref);
          if (!g || (g.type !== 'circle' && g.type !== 'arc')) { delete e.assoc.circ; continue; }
          if (!G.same(e.c, g.c, 1e-12) || Math.abs(e.r - g.r) > 1e-12) { const d = G.sub(g.c, e.c); e.pos = G.add(e.pos, d); e.c = { ...g.c }; e.r = g.r; n++; }
          continue;
        }
        const g = this.get(ref.id);
        const q = g && E.snaps(g, this.doc).filter((x) => x.type === ref.type)[ref.i];
        if (!q) { delete e.assoc[k]; continue; }
        if (!G.same(e[k], q.pt, 1e-12)) { e[k] = { ...q.pt }; n++; }
      }
      if (!Object.keys(e.assoc).length) delete e.assoc;
    }
    if (n) { E.rev++; this.cache.clear(); this.requestRedraw(); }
    return n;
  },
  /* Object snap tracking: hovering on a snap point for a moment acquires it (again = release). */
  acquire(snap) {
    if (!this.settings.otrack || !snap || snap.type === 'nea') { this._acq = null; return; }
    const now = Date.now();
    if (this._acq && G.same(this._acq.pt, snap.pt, 1e-9)) {
      if (!this._acq.done && now - this._acq.t > 400) {
        this._acq.done = true;
        const i = this.tracked.findIndex((q) => G.same(q, snap.pt, 1e-9));
        if (i >= 0) this.tracked.splice(i, 1); else { this.tracked.push({ ...snap.pt }); if (this.tracked.length > 7) this.tracked.shift(); }
      }
    } else {
      this._acq = { pt: { ...snap.pt }, t: now, done: false };
      clearTimeout(this._acqT);
      this._acqT = setTimeout(() => { this.updateMouse(); this.requestRedraw(); }, 450);
    }
  },
  /* Polar tracking from the base point and alignment lines through acquired points. */
  trackPoint(p, base) {
    const st = this.settings, tol = 10 / this.view.scale, lines = [];
    if (st.polar && base && G.dist(p, base) > 6 / this.view.scale) {
      const inc = (st.polarInc || 45) * DEG, k = Math.round(Math.atan2(p.y - base.y, p.x - base.x) / inc) * inc;
      lines.push({ o: base, u: { x: Math.cos(k), y: Math.sin(k) }, ray: true, label: 'Polar', ang: k });
    }
    if (st.otrack) for (const a of this.tracked) { lines.push({ o: a, u: { x: 1, y: 0 }, label: 'Track' }); lines.push({ o: a, u: { x: 0, y: 1 }, label: 'Track' }); }
    const near = lines.map((l) => { const d = G.sub(p, l.o); return { ...l, t: G.dot(d, l.u), perp: Math.abs(G.cross(l.u, d)) }; })
      .filter((l) => l.perp <= tol && (!l.ray || l.t > 0));
    if (!near.length) return null;
    let bestI = null;
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j];
      if (Math.abs(G.cross(a.u, b.u)) < 1e-9) continue;
      const h = G.segSeg(a.o, G.add(a.o, a.u), b.o, G.add(b.o, b.u), true, true)[0];
      if (h && G.dist(h, p) <= tol * 1.5 && (!bestI || G.dist(h, p) < bestI.d)) bestI = { pt: { x: h.x, y: h.y }, lines: [a, b], label: 'Intersection', d: G.dist(h, p) };
    }
    if (bestI) return bestI;
    const l = near.sort((a, b) => a.perp - b.perp)[0];
    return { pt: G.add(l.o, G.mul(l.u, l.t)), lines: [l], label: l.label };
  },
  wantsPoint(pr) { return pr && ['point', 'distance', 'angle'].includes(pr.type) && !pr.pickbox; },
  updateMouse() {
    const ms = this.mouse;
    ms.world = this.toWorld(ms.sx, ms.sy);
    let p = ms.world; ms.snap = null;
    const pr = this.cmd && this.cmd.prompt;
    if (this.wantsPoint(pr)) {
      const base = pr.base || pr._first;
      if (this.settings.osnap && ms.over) ms.snap = this.findOsnap(ms.sx, ms.sy, base);
      this.acquire(ms.snap);
      ms.track = null;
      if (ms.snap) p = ms.snap.pt;
      else {
        if (this.settings.snap) { const g = this.settings.snapSize; p = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }; }
        if (base && (this.settings.ortho !== ms.shift)) p = Math.abs(p.x - base.x) >= Math.abs(p.y - base.y) ? { x: p.x, y: base.y } : { x: base.x, y: p.y };
        else if (ms.over) { const t = this.trackPoint(ms.world, base); if (t) { p = t.pt; ms.track = t; } }
      }
    } else ms.track = null;
    ms.pt = p;
    this.hover = null;
    if (ms.over && !this.drag && (!this.cmd || (pr && (pr.type === 'select' || pr.type === 'entity')))) {
      const h = this.pick(ms.sx, ms.sy, pr && pr.filter);
      this.hover = h ? h.id : null;
    }
    const f = (v) => fmtNum(v, 4);
    this.el.coords.textContent = `${f(p.x)}, ${f(p.y)}`;
    this.updateDyn();
  },
  updateDyn() {
    const d = this.el.dyn, ms = this.mouse;
    const pr = this.cmd && this.cmd.prompt;
    const val = this.el.input.value;
    if (!this.settings.dyn || !ms.over || (!pr && !val) || (pr && pr.type === 'textedit')) { d.style.display = 'none'; return; }
    let msg = pr ? this.promptText(pr) : '';
    if (pr && pr.base && this.wantsPoint(pr)) {
      const dd = G.dist(pr.base, ms.pt), aa = G.normAng(G.angle(pr.base, ms.pt)) / DEG;
      msg += `   ${fmtNum(dd, 4)} < ${fmtNum(aa, 2)}°`;
    }
    d.innerHTML = '';
    if (msg) { const a = document.createElement('div'); a.className = 'dmsg'; a.textContent = msg; d.appendChild(a); }
    if (val || !pr) { const b = document.createElement('div'); b.className = 'dval'; b.textContent = val || ' '; d.appendChild(b); }
    d.style.display = 'block';
    d.style.left = Math.min(ms.sx + 22, this.W - d.offsetWidth - 4) + 'px';
    d.style.top = Math.min(ms.sy + 22, this.H - d.offsetHeight - 4) + 'px';
  },

  /* ===================== events ===================== */
  bindEvents() {
    const cv = this.el.cv, vp = this.el.vp;
    window.addEventListener('resize', () => this.resize());
    vp.addEventListener('mousemove', (ev) => this.onMove(ev));
    vp.addEventListener('mouseenter', () => { this.mouse.over = true; });
    vp.addEventListener('mouseleave', () => { this.mouse.over = false; this.hover = null; this.updateDyn(); this.requestRedraw(); });
    cv.addEventListener('mousedown', (ev) => this.onDown(ev));
    window.addEventListener('mouseup', (ev) => this.onUp(ev));
    cv.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top, f = ev.deltaY < 0 ? 1.2 : 1 / 1.2;
      const vp = this.activeVp && this.get(this.activeVp);
      if (vp) {
        if (vp.locked) { this.print('Viewport display is locked (unlock it in Properties).'); return; }
        const p = this.toWorld(sx, sy), P0 = G.mid(vp.p1, vp.p2);
        const m = { x: vp.cx + (p.x - P0.x) / vp.scale, y: vp.cy + (p.y - P0.y) / vp.scale };
        const ns = vp.scale * f;
        vp.cx = m.x - (m.x - vp.cx) * vp.scale / ns; vp.cy = m.y - (m.y - vp.cy) * vp.scale / ns; vp.scale = ns;
        this.changed(); this.refreshProps();
        return;
      }
      this.zoomAt(sx, sy, f);
    }, { passive: false });
    cv.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.onRight(ev); });
    cv.addEventListener('dblclick', (ev) => this.onDbl(ev));
    window.addEventListener('keydown', (ev) => this.onKey(ev));
    window.addEventListener('keyup', (ev) => { if (ev.key === 'Shift') { this.mouse.shift = false; this.updateMouse(); this.requestRedraw(); } });
    this.el.input.addEventListener('input', () => { this.updateAC(); this.updateDyn(); });
    this.el.input.addEventListener('blur', () => setTimeout(() => this.hideAC(), 150));
    this.el.edText.addEventListener('keydown', (ev) => this.onEditorKey(ev));
    this.el.edText.addEventListener('input', () => this.sizeEditor());
    document.getElementById('edok').onclick = () => this.submitEditor();
    document.getElementById('edcancel').onclick = () => this.cancel();
    this.el.file.addEventListener('change', () => this.onFile());
    this.el.layerSel.addEventListener('change', () => {
      const v = this.el.layerSel.value;
      const ids = this.selectedIds();
      if (ids.length && !this.cmd) { this.pushUndoNow(); ids.forEach((id) => (this.get(id).layer = v)); this.changed(); }
      else this.doc.clayer = v;
      this.refreshUI();
    });
    document.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => this.toggle(b.dataset.toggle)));
    document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => this.showPanel(b.dataset.panel)));
    document.getElementById('histtoggle').onclick = () => this.expandHistory();
    document.getElementById('helpclose').onclick = () => this.el.help.classList.remove('open');
    this.el.help.addEventListener('mousedown', (ev) => { if (ev.target === this.el.help) this.el.help.classList.remove('open'); });
    document.getElementById('sidetoggle').onclick = () => { document.body.classList.toggle('noside'); this.resize(); };
    document.addEventListener('mousedown', (ev) => { if (!this.el.ctx.contains(ev.target)) this.el.ctx.style.display = 'none'; });
    window.addEventListener('beforeunload', () => this.autosave());
    vp.addEventListener('dragover', (ev) => { ev.preventDefault(); vp.classList.add('drop'); });
    vp.addEventListener('dragleave', () => vp.classList.remove('drop'));
    vp.addEventListener('drop', (ev) => {
      ev.preventDefault(); vp.classList.remove('drop');
      const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (!f) return;
      if (this.cmd) this.cancel(true);
      if (this.doc.entities.length && !confirm(`Open "${f.name}" and replace the current drawing? (Save first if you need it.)`)) return;
      this.openBlob(f);
    });
  },
  resize() {
    const r = this.el.vp.getBoundingClientRect();
    this.W = Math.max(50, r.width); this.H = Math.max(50, r.height);
    this.dpr = window.devicePixelRatio || 1;
    this.el.cv.width = Math.round(this.W * this.dpr); this.el.cv.height = Math.round(this.H * this.dpr);
    this.el.cv.style.width = this.W + 'px'; this.el.cv.style.height = this.H + 'px';
    this.requestRedraw();
  },
  evPos(ev) { const r = this.el.cv.getBoundingClientRect(); return { sx: ev.clientX - r.left, sy: ev.clientY - r.top }; },
  onMove(ev) {
    const { sx, sy } = this.evPos(ev);
    const ms = this.mouse;
    ms.over = true; ms.shift = ev.shiftKey;
    if (this.drag) {
      if (this.drag.type === 'vppan') {
        const vp = this.get(this.drag.id);
        if (vp) { vp.cx -= (sx - ms.sx) / this.view.scale / vp.scale; vp.cy += (sy - ms.sy) / this.view.scale / vp.scale; this.changed(); }
      } else if (this.drag.type === 'pan') {
        this.view.cx -= (sx - ms.sx) / this.view.scale; this.view.cy += (sy - ms.sy) / this.view.scale;
      }
    }
    ms.sx = sx; ms.sy = sy;
    if (this.win && !this.win.dragged && Math.hypot(sx - this.win.sx, sy - this.win.sy) > 6 && this.win.down) this.win.dragged = true;
    this.updateMouse();
    this.requestRedraw();
  },
  onDown(ev) {
    ev.preventDefault();
    this.el.ctx.style.display = 'none';
    const { sx, sy } = this.evPos(ev);
    Object.assign(this.mouse, { sx, sy, over: true, shift: ev.shiftKey });
    this.updateMouse();
    if (ev.button === 1) {
      const vp = this.activeVp && this.get(this.activeVp);
      if (vp && !vp.locked) { this.pushUndoNow(); this.drag = { type: 'vppan', id: vp.id }; } else this.drag = { type: 'pan' };
      this.el.vp.classList.add('panning'); return;
    }
    if (ev.button !== 0) return;
    if (document.activeElement !== this.el.input && !(this.cmd && this.cmd.prompt.type === 'textedit')) this.el.input.focus();
    const pr = this.cmd && this.cmd.prompt;
    if (pr && pr.type === 'textedit') { this.submitEditor(); return; }
    if (pr && pr.type === 'pan') { this.drag = { type: 'pan' }; this.el.vp.classList.add('panning'); return; }
    if (!this.cmd || pr.type === 'select') { this.selectClick(sx, sy, ev.shiftKey); return; }
    if (pr.type === 'entity') {
      const e = this.pick(sx, sy);
      if (!e) { this.print('No object found.'); return; }
      if (pr.filter && !pr.filter(e)) { this.print(pr.filterMsg || 'Invalid object.'); return; }
      this.advance({ e, pt: this.mouse.world, shift: ev.shiftKey });
      return;
    }
    const p = this.mouse.pt;
    if (pr.type === 'point') { this.lastSnapRef = this.mouse.snap && this.mouse.snap.ref ? { ...this.mouse.snap.ref } : null; this.lastPoint = p; this.print(`${this.promptText(pr)} ${fmtNum(p.x, 4)},${fmtNum(p.y, 4)}`, 'echo'); this.advance(p); return; }
    if (pr.type === 'distance' || pr.type === 'angle') {
      const base = pr.base || pr._first;
      if (!base) { pr._first = p; pr.preview = pr.preview || null; this.requestRedraw(); return; }
      const v = pr.type === 'distance' ? (pr.project ? pr.project(p) : G.dist(base, p)) : G.normAng(G.angle(base, p)) / DEG;
      this.print(`${this.promptText(pr)} ${fmtNum(v, 4)}`, 'echo');
      this.advance(v);
    }
  },
  onUp(ev) {
    if (this.drag && (ev.button === 1 || ev.button === 0)) { this.drag = null; this.el.vp.classList.remove('panning'); this.autosave(); return; }
    if (ev.button === 0 && this.win) {
      this.win.down = false;
      if (this.win.dragged) { const { sx, sy } = this.evPos(ev); this.finishWindow(sx, sy, ev.shiftKey); }
    }
  },
  onRight(ev) {
    if (this.win) { this.win = null; this.requestRedraw(); return; }
    if (this.cmd) { this.submit(this.el.input.value); this.el.input.value = ''; return; }
    this.showContextMenu(ev);
  },
  onDbl(ev) {
    if (ev.button !== 0) return;
    const { sx, sy } = this.evPos(ev);
    if (this.cmd) return;
    if (this.space >= 0) {
      const p = this.toWorld(sx, sy), onEdge = this.pick(sx, sy);
      if (!onEdge || onEdge.type === 'viewport') {
        const vp = onEdge ? null : this.vpAt(p);
        this.activeVp = vp ? vp.id : null;
        this.sel.clear(); this.win = null;
        if (vp) { this.sel.add(vp.id); this.print(`Inside viewport (scale ${scaleLabel(this.doc, vp.scale)}): mouse wheel zooms, middle-drag pans. Esc or double-click outside to leave.`); }
        this.buildLayoutBar(); this.refreshUI(); this.requestRedraw();
        if (!onEdge) return;
      }
    }
    const e = this.pick(sx, sy);
    if (!e) return;
    if (['text', 'mtext', 'leader', 'dim'].includes(e.type)) { this.win = null; this.runCommand('TEXTEDIT', { id: e.id }); }
    else if (e.type === 'table') { this.win = null; this.runCommand('TABLEDIT', { id: e.id, pt: this.toWorld(sx, sy) }); }
    else if (e.type === 'insert' && (e.attribs || []).length) { this.win = null; this.runCommand('ATTEDIT', { id: e.id }); }
    else { this.sel.clear(); this.sel.add(e.id); this.showPanel('props'); this.refreshUI(); }
  },
  selectClick(sx, sy, shift) {
    if (this.win) { this.finishWindow(sx, sy, shift); return; }
    if (!this.cmd) {
      const g = this.gripAt(sx, sy);
      if (g) { this.runCommand(GRIP_CMD, g); return; }
    }
    const e = this.pick(sx, sy);
    if (e) {
      if (shift) this.sel.delete(e.id); else this.sel.add(e.id);
      this.afterSelChange();
      return;
    }
    this.win = { a: this.toWorld(sx, sy), sx, sy, dragged: false, down: true };
  },
  finishWindow(sx, sy, shift) {
    const w = this.win; this.win = null;
    const b = this.toWorld(sx, sy);
    const r = { minx: Math.min(w.a.x, b.x), maxx: Math.max(w.a.x, b.x), miny: Math.min(w.a.y, b.y), maxy: Math.max(w.a.y, b.y) };
    const crossing = sx < w.sx;
    let n = 0;
    for (const e of this.selectableEntities()) {
      if (E.inRect(e, r, crossing, this.doc)) { if (shift) this.sel.delete(e.id); else this.sel.add(e.id); n++; }
    }
    if (this.cmd) this.print(`${n} found`);
    this.afterSelChange();
  },
  afterSelChange() { this.refreshUI(); this.requestRedraw(); },
  selectAll() { this.selectableEntities().forEach((e) => this.sel.add(e.id)); this.print(`${this.sel.size} objects selected.`); this.afterSelChange(); },

  onKey(ev) {
    const tgt = ev.target, inp = this.el.input;
    if (tgt === this.el.edText) return;
    const tag = tgt && tgt.tagName;
    const other = tgt !== inp && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tgt && tgt.isContentEditable));
    if (other) { if (ev.key === 'Escape') tgt.blur(); return; }
    if (ev.key === 'Shift') { this.mouse.shift = true; this.updateMouse(); this.requestRedraw(); return; }
    const fkeys = { F1: () => this.showHelp(), F2: () => this.expandHistory(), F3: () => this.toggle('osnap'), F7: () => this.toggle('grid'), F8: () => this.toggle('ortho'), F9: () => this.toggle('snap'), F10: () => this.toggle('polar'), F11: () => this.toggle('otrack'), F12: () => this.toggle('dyn') };
    if (fkeys[ev.key]) { ev.preventDefault(); fkeys[ev.key](); return; }
    if (this.el.help.classList.contains('open')) { if (ev.key === 'Escape') this.el.help.classList.remove('open'); return; }
    if (ev.ctrlKey || ev.metaKey) {
      const k = ev.key.toLowerCase();
      const map = { z: 'UNDO', y: 'REDO', s: 'SAVE', o: 'OPEN', n: 'NEW', a: 'SELECTALL', c: 'COPYCLIP', v: 'PASTECLIP', x: 'CUTCLIP', p: 'PLOT' };
      if (k === 'z' && ev.shiftKey) { ev.preventDefault(); this.redo(); return; }
      if (map[k] && !(k === 'c' && window.getSelection().toString())) {
        ev.preventDefault();
        if (this.cmd && !['c', 'v', 'x', 'a'].includes(k)) this.cancel(true);
        if (k === 'z') { this.undo(); return; }
        if (k === 'y') { this.redo(); return; }
        if (this.cmd && k === 'a') { if (this.cmd.prompt.type === 'select') this.selectAll(); return; }
        if (this.cmd) return;
        this.runCommand(map[k]);
      }
      return;
    }
    const pr = this.cmd && this.cmd.prompt;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.hideAC();
      inp.value = '';
      if (this.win) { this.win = null; }
      else if (this.cmd) this.cancel();
      else if (this.activeVp) { this.activeVp = null; this.buildLayoutBar(); }
      else if (this.sel.size) { this.sel.clear(); this.afterSelChange(); }
      this.updateDyn(); this.requestRedraw();
      return;
    }
    const spaceIsEnter = ev.key === ' ' && !(pr && pr.type === 'string' && pr.spaces) && !(pr && pr.type === 'string' && inp.value.length && pr.spaces);
    if (ev.key === 'Enter' || spaceIsEnter) {
      ev.preventDefault();
      let v = inp.value;
      if (!this.cmd && this.ac.items.length && v.trim() && !Commands.lookup(v)) v = this.ac.items[this.ac.idx].name;
      inp.value = ''; this.hideAC();
      if (this.win) this.win = null;
      this.submit(v);
      this.updateDyn();
      return;
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      if (this.ac.items.length) { inp.value = this.ac.items[this.ac.idx].name; this.updateAC(); }
      return;
    }
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const dir = ev.key === 'ArrowUp' ? -1 : 1;
      if (this.ac.items.length) { this.ac.idx = (this.ac.idx + dir + this.ac.items.length) % this.ac.items.length; this.renderAC(); return; }
      const h = this.inputHistory;
      if (!h.length) return;
      if (this.histPos < 0) this.histPos = h.length;
      this.histPos = G.clamp(this.histPos + dir, 0, h.length);
      inp.value = h[this.histPos] || '';
      return;
    }
    if (ev.key === 'Delete' && !this.cmd && this.sel.size && !inp.value) { ev.preventDefault(); this.runCommand('ERASE'); return; }
    if (document.activeElement !== inp && ev.key.length === 1) inp.focus();
  },

  /* ===================== autocomplete ===================== */
  updateAC() {
    const v = this.el.input.value.trim().toUpperCase();
    if (this.cmd || !v || !/^[-A-Z?']/.test(v)) { this.hideAC(); return; }
    const items = Commands.list.filter((d) => d.name.startsWith(v) || d.aliases.some((a) => a.startsWith(v)));
    items.sort((a, b) => (b.aliases.includes(v) || b.name === v) - (a.aliases.includes(v) || a.name === v) || a.name.length - b.name.length);
    this.ac.items = items.slice(0, 10); this.ac.idx = 0;
    this.renderAC();
  },
  renderAC() {
    const el = this.el.ac;
    el.innerHTML = '';
    if (!this.ac.items.length) { el.style.display = 'none'; return; }
    this.ac.items.forEach((d, i) => {
      const row = document.createElement('div');
      row.className = 'acrow' + (i === this.ac.idx ? ' on' : '');
      row.innerHTML = `<b></b><i></i><span></span>`;
      row.children[0].textContent = d.name;
      row.children[1].textContent = d.aliases.length ? d.aliases.slice(0, 3).join(', ') : '';
      row.children[2].textContent = d.desc;
      row.onmousedown = (ev) => { ev.preventDefault(); this.el.input.value = ''; this.hideAC(); this.runCommand(d); };
      el.appendChild(row);
    });
    el.style.display = 'block';
  },
  hideAC() { this.ac.items = []; this.el.ac.style.display = 'none'; },

  /* ===================== in-place text editor ===================== */
  openEditor(pr) {
    const ed = this.el.editor, ta = this.el.edText;
    if (ed.classList.contains('open') && this._edPr === pr) return;
    this._edPr = pr;
    const s = this.toScreen(pr.at);
    const px = G.clamp((pr.h / CAP_RATIO) * this.view.scale, 13, 64);
    ta.style.fontSize = px + 'px';
    ta.style.color = Render.colorOf(this.doc, { layer: this.doc.clayer, color: this.doc.ccolor });
    ta.value = pr.initial || '';
    ta.dataset.multiline = pr.multiline ? '1' : '';
    ed.dataset.align = pr.align || 'left';
    ed.style.left = s.x + 'px';
    ed.style.top = (pr.multiline ? s.y - px * 0.3 : s.y - px * 1.15) + 'px';
    ed.style.transform = pr.align === 'right' ? 'translateX(-100%)' : pr.align === 'center' ? 'translateX(-50%)' : '';
    this._edMinW = pr.width ? Math.max(120, pr.width * this.view.scale) : 0;
    document.getElementById('edhint').textContent = pr.tabNext ? 'Tab = next cell · Enter = done · Esc = cancel' : pr.multiline ? 'Enter = new line · Ctrl+Enter or click outside = OK · Esc = cancel' : 'Enter = OK (empty line ends) · Esc = cancel';
    ed.classList.add('open');
    this.sizeEditor();
    setTimeout(() => { ta.focus(); if (pr.initial) ta.select(); }, 0);
  },
  sizeEditor() {
    const ta = this.el.edText;
    const ctx = this.ctx2d;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${ta.style.fontSize} ${FONT_FAMILY}`;
    const lines = ta.value.split('\n');
    const w = Math.max(...lines.map((l) => ctx.measureText(l + 'MM').width), 140, this._edMinW || 0);
    ctx.restore();
    ta.style.width = Math.min(w, this.W - 20) + 'px';
    ta.rows = Math.max(1, lines.length);
  },
  onEditorKey(ev) {
    const ta = this.el.edText;
    if (ev.key === 'Escape') { ev.preventDefault(); this.cancel(); this.el.input.focus(); return; }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || !ta.dataset.multiline)) { ev.preventDefault(); this.submitEditor(); }
    if (ev.key === 'Tab' && this._edPr && this._edPr.tabNext) { ev.preventDefault(); this._edTab = true; this.submitEditor(); }
    ev.stopPropagation();
  },
  submitEditor() {
    if (!this.cmd || this.cmd.prompt.type !== 'textedit') return;
    const v = this.el.edText.value;
    this.lastEditorTab = !!this._edTab; this._edTab = false;
    this.closeEditor();
    if (v) this.print(`Text: ${v.replace(/\n/g, ' ⏎ ')}`, 'echo');
    this.el.input.focus();
    this.advance(v);
  },
  closeEditor() { this.el.editor.classList.remove('open'); this._edPr = null; },

  /* ===================== toggles & panels ===================== */
  toggle(k) {
    this.settings[k] = !this.settings[k];
    if (k === 'ortho' && this.settings.ortho) this.settings.polar = false;
    if (k === 'polar' && this.settings.polar) this.settings.ortho = false;
    if (k === 'otrack' && !this.settings.otrack) this.tracked = [];
    const names = { grid: 'Grid', snap: 'Snap', ortho: 'Ortho', osnap: 'Osnap', dyn: 'Dynamic input', polar: 'Polar tracking', otrack: 'Object snap tracking', lwt: 'Lineweight display' };
    this.print(`<${names[k]} ${this.settings[k] ? 'on' : 'off'}>`);
    this.refreshUI(); this.updateMouse(); this.requestRedraw(); this.autosave();
  },
  pushUndoNow() { this.undoStack.push(this.serialize()); this.redoStack = []; },
  showPanel(p) {
    this.panel = p;
    document.body.classList.remove('noside');
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.panel === p));
    this.resize();
    this.refreshUI();
  },
  refreshUI() {
    document.querySelectorAll('[data-toggle]').forEach((b) => b.classList.toggle('on', !!this.settings[b.dataset.toggle]));
    const ls = this.el.layerSel;
    const ids = this.cmd ? [] : this.selectedIds();
    const shown = ids.length ? (new Set(ids.map((id) => this.get(id).layer)).size === 1 ? this.get(ids[0]).layer : '') : this.doc.clayer;
    ls.innerHTML = '';
    if (shown === '') { const o = document.createElement('option'); o.value = ''; o.textContent = '*VARIES*'; ls.appendChild(o); }
    for (const l of this.doc.layers) { const o = document.createElement('option'); o.value = l.name; o.textContent = l.name; ls.appendChild(o); }
    ls.value = shown;
    const lay = this.layer(shown || this.doc.clayer);
    document.getElementById('layerswatch').style.background = lay ? lay.color : '#fff';
    this.el.title.textContent = this.doc.name;
    this.buildLayoutBar();
    document.title = `${this.doc.name} — BananaCAD`;
    this.refreshProps();
  },
  refreshProps() {
    const body = document.getElementById('panelbody');
    if (!body || document.body.classList.contains('noside')) return;
    if (this.panel === 'layers') this.buildLayers(body);
    else if (this.panel === 'blocks') this.buildBlocks(body);
    else if (this.panel === 'styles') this.buildStyles(body);
    else if (this.panel === 'settings') this.buildSettings(body);
    else this.buildProps(body);
  },

  buildProps(body) {
    body.innerHTML = '';
    const ids = this.selectedIds();
    const h = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
    if (!ids.length && this.space >= 0) {
      const L = this.doc.layouts[this.space];
      body.appendChild(h('h4', null, `Layout: ${L.name}`));
      const tbl = h('div', 'grid2');
      const row = (label, el) => { tbl.appendChild(h('label', null, label)); tbl.appendChild(el); };
      const ps = h('select'); Object.keys(PAPERS).forEach((k) => { const o = h('option', null, `${k} (${PAPERS[k][0]}×${PAPERS[k][1]})`); o.value = k; ps.appendChild(o); }); ps.value = L.paper;
      ps.onchange = () => { this.pushUndoNow(); L.paper = ps.value; this.changed(); this.zoomExtents(); this.refreshUI(); };
      row('Paper size', ps);
      const or = h('select'); [['landscape', 'Landscape'], ['portrait', 'Portrait']].forEach(([v, l]) => { const o = h('option', null, l); o.value = v; or.appendChild(o); }); or.value = L.orient;
      or.onchange = () => { this.pushUndoNow(); L.orient = or.value; this.changed(); this.zoomExtents(); this.refreshUI(); };
      row('Orientation', or);
      body.appendChild(tbl);
      const acts = h('div', 'actions');
      const btn = (label, fn) => { const b = h('button', null, label); b.onclick = fn; acts.appendChild(b); };
      btn('Add viewport', () => this.runCommand('MVIEW'));
      btn('Add title block', () => {
        const p2 = paperSize(L);
        libraryEnsure(this.doc, 'Title block A3');
        const k = Math.min(p2.w / 420, p2.h / 297);
        this.runCommand('INSERT', { name: 'Title block A3' });
        if (this.cmd) { this.submit(`S`); this.submit(String(+k.toFixed(6))); this.submit('0,0'); }
      });
      btn('Plot this layout…', () => Plot.open(this));
      body.appendChild(acts);
      body.appendChild(h('div', 'muted', 'Paper space is in millimetres. Viewports show the model at an exact scale — select a viewport border to change its scale. Double-click inside a viewport to pan/zoom it.'));
      return;
    }
    if (!ids.length) {
      body.appendChild(h('div', 'muted', 'No selection. Click objects, or drag a window (left→right = inside, right→left = crossing).'));
      const tbl = h('div', 'grid2');
      const row = (label, el) => { tbl.appendChild(h('label', null, label)); tbl.appendChild(el); };
      const layerSel = h('select');
      this.doc.layers.forEach((l) => { const o = h('option', null, l.name); o.value = l.name; layerSel.appendChild(o); });
      layerSel.value = this.doc.clayer;
      layerSel.onchange = () => { this.doc.clayer = layerSel.value; this.refreshUI(); };
      row('Current layer', layerSel);
      row('Current color', this.colorControl(this.doc.ccolor, (v) => { this.doc.ccolor = v; this.refreshUI(); }));
      const ts = h('input'); ts.type = 'number'; ts.step = 'any'; ts.value = this.doc.textSize;
      ts.onchange = () => { if (+ts.value > 0) this.doc.textSize = +ts.value; };
      row('Text height', ts);
      body.appendChild(h('h4', null, 'Drawing'));
      body.appendChild(tbl);
      const info = h('div', 'muted', `${this.doc.entities.length} objects · ${this.doc.layers.length} layers`);
      body.appendChild(info);
      return;
    }
    const ents = ids.map((id) => this.get(id));
    const types = [...new Set(ents.map((e) => E.label(e.type)))];
    body.appendChild(h('h4', null, ents.length === 1 ? types[0] : `${ents.length} objects (${types.join(', ')})`));
    const tbl = h('div', 'grid2');
    body.appendChild(tbl);
    const apply = (fn) => { this.pushUndoNow(); ents.forEach(fn); this.reassoc(); this.changed(); this.refreshUI(); };
    const row = (label, el) => { tbl.appendChild(h('label', null, label)); tbl.appendChild(el); };
    const layerSel = h('select');
    const common = new Set(ents.map((e) => e.layer)).size === 1 ? ents[0].layer : '';
    if (!common) { const o = h('option', null, '*VARIES*'); o.value = ''; layerSel.appendChild(o); }
    this.doc.layers.forEach((l) => { const o = h('option', null, l.name); o.value = l.name; layerSel.appendChild(o); });
    layerSel.value = common;
    layerSel.onchange = () => layerSel.value && apply((e) => (e.layer = layerSel.value));
    row('Layer', layerSel);
    const commonColor = new Set(ents.map((e) => e.color)).size === 1 ? ents[0].color : 'bylayer';
    row('Color', this.colorControl(commonColor, (v) => apply((e) => (e.color = v))));
    {
      const lws = h('select');
      const cur = new Set(ents.map((e) => (e.lw == null ? 'bylayer' : String(e.lw))));
      [['bylayer', 'ByLayer'], ...LINEWEIGHTS.map((v) => [String(v), `${v.toFixed(2)} mm`])].forEach(([v, l]) => { const o = h('option', null, l); o.value = v; lws.appendChild(o); });
      if (cur.size > 1) { const o = h('option', null, '*VARIES*'); o.value = ''; lws.prepend(o); }
      lws.value = cur.size === 1 ? [...cur][0] : '';
      lws.onchange = () => lws.value && apply((e) => { if (lws.value === 'bylayer') delete e.lw; else e.lw = +lws.value; });
      row('Lineweight', lws);
    }
    const num = (label, get, set, ro) => {
      const i = h('input'); i.type = 'number'; i.step = 'any'; i.value = +(+get()).toFixed(6);
      if (ro) i.readOnly = true; else i.onchange = () => { const v = parseFloat(i.value); if (!isNaN(v)) apply((e) => set(e, v)); };
      row(label, i);
    };
    const sel = (label, options, get, set) => {
      const s2 = h('select');
      options.forEach((o) => { const op = h('option', null, o); op.value = o; s2.appendChild(op); });
      s2.value = get(); s2.onchange = () => apply((e) => set(e, s2.value));
      row(label, s2);
    };
    const tNames = this.doc.textStyles.map((t) => t.name), dNames = this.doc.dimStyles.map((t) => t.name);
    const txt = (label, get, set, multi) => {
      const i = h(multi ? 'textarea' : 'input'); i.value = get(); if (multi) i.rows = 3;
      i.onchange = () => apply((e) => set(e, i.value));
      row(label, i);
    };
    if (ents.length === 1) {
      const e = ents[0];
      switch (e.type) {
        case 'line':
          num('Start X', () => e.p1.x, (o, v) => (o.p1.x = v)); num('Start Y', () => e.p1.y, (o, v) => (o.p1.y = v));
          num('End X', () => e.p2.x, (o, v) => (o.p2.x = v)); num('End Y', () => e.p2.y, (o, v) => (o.p2.y = v));
          num('Length', () => G.dist(e.p1, e.p2), (o, v) => { const u = G.norm(G.sub(o.p2, o.p1)); o.p2 = G.add(o.p1, G.mul(u, v)); });
          num('Angle', () => G.normAng(G.angle(e.p1, e.p2)) / DEG, (o, v) => { o.p2 = G.polar(o.p1, v * DEG, G.dist(o.p1, o.p2)); });
          break;
        case 'circle':
          num('Center X', () => e.c.x, (o, v) => (o.c.x = v)); num('Center Y', () => e.c.y, (o, v) => (o.c.y = v));
          num('Radius', () => e.r, (o, v) => v > 0 && (o.r = v)); num('Diameter', () => e.r * 2, (o, v) => v > 0 && (o.r = v / 2));
          num('Area', () => Math.PI * e.r * e.r, null, true);
          break;
        case 'arc':
          num('Center X', () => e.c.x, (o, v) => (o.c.x = v)); num('Center Y', () => e.c.y, (o, v) => (o.c.y = v));
          num('Radius', () => e.r, (o, v) => v > 0 && (o.r = v));
          num('Start angle', () => G.normAng(e.a1) / DEG, (o, v) => (o.a1 = v * DEG)); num('End angle', () => G.normAng(e.a2) / DEG, (o, v) => (o.a2 = v * DEG));
          num('Arc length', () => E.length(e), null, true);
          break;
        case 'ellipse':
          num('Center X', () => e.c.x, (o, v) => (o.c.x = v)); num('Center Y', () => e.c.y, (o, v) => (o.c.y = v));
          num('Major radius', () => G.len(e.maj), (o, v) => v > 0 && (o.maj = G.mul(G.norm(o.maj), v)));
          num('Minor radius', () => G.len(e.maj) * e.ratio, (o, v) => v > 0 && (o.ratio = Math.min(1, v / G.len(o.maj))));
          break;
        case 'pline': {
          const cb = h('input'); cb.type = 'checkbox'; cb.checked = !!e.closed;
          cb.onchange = () => apply((o) => (o.closed = cb.checked));
          row('Closed', cb);
          num('Vertices', () => e.pts.length, null, true);
          num('Length', () => E.length(e), null, true);
          if (e.closed) num('Area', () => E.area(e), null, true);
          break;
        }
        case 'text':
          txt('Contents', () => e.text, (o, v) => (o.text = v));
          sel('Text style', tNames, () => E.tstyle(e.style).name, (o, v) => (o.style = v));
          num('Height', () => e.h, (o, v) => v > 0 && (o.h = v));
          num('Rotation', () => G.normAng(e.rot || 0) / DEG, (o, v) => (o.rot = v * DEG));
          { const s = h('select'); ['left', 'center', 'right'].forEach((a) => { const o = h('option', null, a); o.value = a; s.appendChild(o); }); s.value = e.align || 'left'; s.onchange = () => apply((o) => (o.align = s.value)); row('Justify', s); }
          num('Position X', () => e.p.x, (o, v) => (o.p.x = v)); num('Position Y', () => e.p.y, (o, v) => (o.p.y = v));
          break;
        case 'mtext':
          txt('Contents', () => e.text, (o, v) => (o.text = v), true);
          sel('Text style', tNames, () => E.tstyle(e.style).name, (o, v) => (o.style = v));
          num('Height', () => e.h, (o, v) => v > 0 && (o.h = v));
          num('Width (0=no wrap)', () => e.width || 0, (o, v) => v >= 0 && (o.width = v));
          num('Rotation', () => G.normAng(e.rot || 0) / DEG, (o, v) => (o.rot = v * DEG));
          break;
        case 'leader':
          txt('Note text', () => e.text, (o, v) => (o.text = v), true);
          sel('Text style', tNames, () => E.tstyle(e.style).name, (o, v) => (o.style = v));
          num('Text height', () => e.h, (o, v) => v > 0 && (o.h = v));
          break;
        case 'dim': {
          txt('Text override (<> = value)', () => e.text || '', (o, v) => (o.text = v === '<>' ? '' : v));
          sel('Dimension style', e.dimstyle ? dNames : ['(legacy)', ...dNames], () => e.dimstyle || '(legacy)', (o, v) => { if (v !== '(legacy)') { o.dimstyle = v; delete o.h; delete o.scale; } });
          if (!e.dimstyle) { num('Dim scale', () => e.scale || 1, (o, v) => { if (v > 0) { o.scale = v; o.h = 2.5 * v; } }); num('Text height', () => e.h || 2.5, (o, v) => v > 0 && (o.h = v)); }
          const lab = h('input'); lab.readOnly = true; lab.value = e.assoc && Object.keys(e.assoc).length ? 'Yes — follows geometry' : 'No'; row('Associative', lab);
          break;
        }
        case 'table': {
          sel('Text style', tNames, () => E.tstyle(e.style).name, (o, v) => (o.style = v));
          num('Text height', () => e.h, (o, v) => v > 0 && (o.h = v));
          txt('Column widths', () => e.cw.map((v) => +v.toFixed(4)).join(', '), (o, v) => { const a = v.split(/[,; ]+/).map(Number).filter((x) => x > 0); if (a.length) { while (a.length < o.cw.length) a.push(a[a.length - 1]); o.cw = a.slice(0, o.cw.length); } });
          txt('Row heights', () => e.rh.map((v) => +v.toFixed(4)).join(', '), (o, v) => { const a = v.split(/[,; ]+/).map(Number).filter((x) => x > 0); if (a.length) { while (a.length < o.rh.length) a.push(a[a.length - 1]); o.rh = a.slice(0, o.rh.length); } });
          const cb = h('input'); cb.type = 'checkbox'; cb.checked = e.header !== false; cb.onchange = () => apply((o) => (o.header = cb.checked)); row('Header row centered', cb);
          break;
        }
        case 'revcloud':
          num('Arc length', () => e.arc, (o, v) => v > 0 && (o.arc = v));
          break;
        case 'viewport': {
          const sc = h('select');
          const curL = scaleLabel(this.doc, e.scale);
          const opts = STD_SCALES.map(([l, n]) => [String(n), l]);
          if (!STD_SCALES.some(([l]) => l === curL)) opts.unshift(['custom', curL + ' (custom)']);
          opts.forEach(([v, l]) => { const o = h('option', null, l); o.value = v; sc.appendChild(o); });
          sc.value = STD_SCALES.find(([l]) => l === curL) ? String(STD_SCALES.find(([l]) => l === curL)[1]) : 'custom';
          sc.onchange = () => sc.value !== 'custom' && apply((o) => (o.scale = scaleFactor(this.doc, +sc.value)));
          row('Scale', sc);
          num('Custom 1:N', () => (UNITS_MM[this.doc.units || 'mm'] || 1) / e.scale, (o, v) => v > 0 && (o.scale = scaleFactor(this.doc, v)));
          num('View center X', () => e.cx, (o, v) => (o.cx = v)); num('View center Y', () => e.cy, (o, v) => (o.cy = v));
          num('Width (mm)', () => e.p2.x - e.p1.x, (o, v) => v > 0 && (o.p2.x = o.p1.x + v)); num('Height (mm)', () => e.p2.y - e.p1.y, (o, v) => v > 0 && (o.p2.y = o.p1.y + v));
          const lk = h('input'); lk.type = 'checkbox'; lk.checked = !!e.locked; lk.onchange = () => apply((o) => (o.locked = lk.checked)); row('Display locked', lk);
          const onb = h('input'); onb.type = 'checkbox'; onb.checked = e.on !== false; onb.onchange = () => apply((o) => (o.on = onb.checked)); row('Viewport on', onb);
          break;
        }
        case 'insert': {
          const nm = h('input'); nm.value = e.name; nm.readOnly = true; row('Block', nm);
          num('Position X', () => e.p.x, (o, v) => (o.p.x = v)); num('Position Y', () => e.p.y, (o, v) => (o.p.y = v));
          num('Scale X', () => e.sx ?? 1, (o, v) => v && (o.sx = v)); num('Scale Y', () => e.sy ?? 1, (o, v) => v && (o.sy = v));
          num('Rotation', () => G.normAng(e.rot || 0) / DEG, (o, v) => (o.rot = v * DEG));
          (e.attribs || []).forEach((a, i) => txt(a.tag, () => a.value ?? '', (o, v) => { if (o.attribs && o.attribs[i]) o.attribs[i].value = v; }));
          break;
        }
        case 'attdef':
          txt('Tag', () => e.tag, (o, v) => (o.tag = v.trim().toUpperCase().replace(/\s+/g, '_')));
          txt('Prompt', () => e.prompt || '', (o, v) => (o.prompt = v));
          txt('Default', () => e.def || '', (o, v) => (o.def = v));
          num('Height', () => e.h, (o, v) => v > 0 && (o.h = v));
          break;
        case 'hatch': {
          const s = h('select'); Object.keys(HATCH_PATTERNS).forEach((k) => { const o = h('option', null, k); o.value = k; s.appendChild(o); });
          s.value = e.pattern; s.onchange = () => apply((o) => (o.pattern = s.value)); row('Pattern', s);
          num('Scale', () => e.scale, (o, v) => v > 0 && (o.scale = v)); num('Angle', () => e.angle, (o, v) => (o.angle = v));
          num('Area', () => Math.abs(e.loops.reduce((a, l, i) => a + (i ? -1 : 1) * Math.abs(G.polyArea(l)), 0)), null, true);
          break;
        }
      }
    } else if (ents.every((e) => ['text', 'mtext', 'leader'].includes(e.type))) {
      num('Height', () => ents[0].h, (o, v) => v > 0 && (o.h = v));
    }
    const acts = h('div', 'actions');
    if (ents.length === 1 && ents[0].type === 'viewport') {
      const v = ents[0];
      const fb = h('button', null, 'Fit drawing'); fb.onclick = () => apply((o) => { const ext = Render.extents(this.doc, this.doc.model); if (!ext) return; o.cx = (ext.minx + ext.maxx) / 2; o.cy = (ext.miny + ext.maxy) / 2; o.scale = fitStdScale(this.doc, ext.maxx - ext.minx, ext.maxy - ext.miny, (o.p2.x - o.p1.x) * 0.95, (o.p2.y - o.p1.y) * 0.95); });
      acts.appendChild(fb);
      const ib = h('button', null, 'Pan/zoom inside'); ib.onclick = () => { this.activeVp = v.id; this.buildLayoutBar(); this.requestRedraw(); }; acts.appendChild(ib);
    }
    if (ents.length === 1 && ents[0].type === 'table') {
      const t = ents[0];
      const mkb = (label, fn) => { const b = h('button', null, label); b.onclick = () => apply(() => fn(t)); acts.appendChild(b); };
      mkb('+ Row', (o) => { o.rh.push(o.rh[o.rh.length - 1]); o.cells.push(o.cw.map(() => '')); });
      mkb('− Row', (o) => { if (o.rh.length > 1) { o.rh.pop(); o.cells.pop(); } });
      mkb('+ Column', (o) => { o.cw.push(o.cw[o.cw.length - 1]); o.cells.forEach((r) => r.push('')); });
      mkb('− Column', (o) => { if (o.cw.length > 1) { o.cw.pop(); o.cells.forEach((r) => r.pop()); } });
      const ed = h('button', null, 'Edit cells'); ed.onclick = () => this.runCommand('TABLEDIT', { id: t.id, pt: t.p }); acts.appendChild(ed);
    }
    if (ents.length === 1 && ents[0].type === 'insert') {
      const be = h('button', null, 'Edit block'); be.onclick = () => this.runCommand('BEDIT', { name: ents[0].name }); acts.appendChild(be);
      if ((ents[0].attribs || []).length) { const ae = h('button', null, 'Edit attributes'); ae.onclick = () => this.runCommand('ATTEDIT', { id: ents[0].id }); acts.appendChild(ae); }
    }
    for (const [label, c] of [['Move', 'MOVE'], ['Copy', 'COPY'], ['Rotate', 'ROTATE'], ['Scale', 'SCALE'], ['Mirror', 'MIRROR'], ['Erase', 'ERASE']]) {
      const b = h('button', null, label); b.onclick = () => this.runCommand(c); acts.appendChild(b);
    }
    body.appendChild(acts);
  },
  colorControl(value, onChange) {
    const wrap = document.createElement('div'); wrap.className = 'colorctl';
    const s = document.createElement('select');
    const opts = [['bylayer', 'ByLayer'], ['#ff0000', 'Red'], ['#ffff00', 'Yellow'], ['#00ff00', 'Green'], ['#00ffff', 'Cyan'], ['#0000ff', 'Blue'], ['#ff00ff', 'Magenta'], ['#ffffff', 'White'], ['#808080', 'Gray']];
    let found = false;
    for (const [v, l] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; s.appendChild(o); if (v === value) found = true; }
    if (!found) { const o = document.createElement('option'); o.value = value; o.textContent = value; s.appendChild(o); }
    s.value = value;
    const c = document.createElement('input'); c.type = 'color'; c.value = value === 'bylayer' ? '#ffffff' : value;
    s.onchange = () => onChange(s.value);
    c.onchange = () => onChange(c.value);
    wrap.append(s, c);
    return wrap;
  },
  thumb(ents, size = 84) {
    const c = document.createElement('canvas');
    c.width = size * 2; c.height = size * 2; c.style.width = '100%'; c.style.aspectRatio = '1';
    const ctx = c.getContext('2d');
    const b = Render.extents(this.doc, ents);
    if (!b) return c;
    const w = Math.max(b.maxx - b.minx, 1e-6), h = Math.max(b.maxy - b.miny, 1e-6);
    const st = { ctx, dpr: 2, W: size, H: size, view: { cx: (b.minx + b.maxx) / 2, cy: (b.miny + b.maxy) / 2, scale: (size * 0.82) / Math.max(w, h) }, doc: this.doc };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    Render.worldXf(st);
    for (const e of ents) Render.drawEntity(st, e, { color: '#d9e1e8' });
    return c;
  },
  buildBlocks(body) {
    body.innerHTML = '';
    const d = this.doc, h = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
    const acts = h('div', 'actions');
    for (const [label, fn] of [['Create block', () => this.runCommand('BLOCK')], ['Insert from file…', () => this.runCommand('INSERT', { file: true })], ['Purge unused', () => this.runCommand('PURGE')]]) {
      const b = h('button', null, label); b.onclick = fn; acts.appendChild(b);
    }
    body.appendChild(acts);
    const refs = {};
    const count = (list) => { for (const e of list) if (e.type === 'insert') refs[e.name] = (refs[e.name] || 0) + 1; };
    count(d.entities); Object.values(d.blocks).forEach((b) => count(b.ents));
    body.appendChild(h('h4', null, 'In this drawing'));
    const names = Object.keys(d.blocks).filter((n) => !n.startsWith('*')).sort((a, b) => a.localeCompare(b));
    if (!names.length) body.appendChild(h('div', 'muted', 'No blocks yet. Select objects and press "Create block" (BLOCK), or click a symbol from the library below.'));
    const grid = h('div', 'bgrid');
    for (const n of names) {
      const card = h('div', 'bcard');
      card.title = `Click to insert "${n}"`;
      card.appendChild(this.thumb(d.blocks[n].ents));
      card.appendChild(h('div', 'bname', n));
      card.appendChild(h('div', 'bmeta', `${refs[n] || 0} in use`));
      const tools = h('div', 'btools');
      const mk = (label, title, fn) => { const b = h('button', null, label); b.title = title; b.onclick = (ev) => { ev.stopPropagation(); fn(); }; tools.appendChild(b); };
      mk('✎', 'Edit block definition (BEDIT)', () => this.runCommand('BEDIT', { name: n }));
      mk('Aa', 'Rename block', () => {
        const nn = (prompt('New block name', n) || '').trim();
        if (!nn || nn === n) return;
        if (d.blocks[nn]) { this.print(`Block "${nn}" already exists.`); return; }
        this.pushUndoNow();
        d.blocks[nn] = { ...d.blocks[n], name: nn }; delete d.blocks[n];
        const fixN = (list) => list.forEach((e) => { if (e.type === 'insert' && e.name === n) e.name = nn; });
        fixN(d.entities); Object.values(d.blocks).forEach((b) => fixN(b.ents));
        this.changed(); this.refreshUI();
      });
      mk('✕', 'Delete block (and its references)', () => {
        const k = refs[n] || 0;
        if (k && !confirm(`"${n}" is used ${k} time(s). Delete the block and all its references?`)) return;
        this.pushUndoNow();
        const keep = (e) => !(e.type === 'insert' && e.name === n);
        d.entities = d.entities.filter(keep); Object.values(d.blocks).forEach((b) => (b.ents = b.ents.filter(keep)));
        delete d.blocks[n]; this.index = null;
        this.changed(); this.refreshUI();
      });
      card.appendChild(tools);
      card.onclick = () => this.runCommand('INSERT', { name: n });
      grid.appendChild(card);
    }
    body.appendChild(grid);
    body.appendChild(h('h4', null, 'Symbol library (mm)'));
    const lg = h('div', 'bgrid');
    for (const [n, lib] of Object.entries(LIBRARY)) {
      const card = h('div', 'bcard');
      card.title = `${lib.desc} — click to insert`;
      card.appendChild(this.thumb(lib.ents));
      card.appendChild(h('div', 'bname', n));
      card.onclick = () => this.runCommand('INSERT', { name: n });
      lg.appendChild(card);
    }
    body.appendChild(lg);
    body.appendChild(h('div', 'muted', 'Library symbols are drawn in millimetres on layer 0, so they take the layer of the block reference. Use Scale when inserting into drawings in other units.'));
  },
  buildStyles(body) {
    body.innerHTML = '';
    const d = this.doc, h = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
    const FONTS = ['Arial', 'Arial Narrow', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Consolas', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Calibri', 'Segoe UI', 'Comic Sans MS', 'Impact'];
    const upd = () => { this.changed(); this.refreshUI(); };
    // ---- text styles
    body.appendChild(h('h4', null, 'Text styles'));
    const tt = h('table', 'layers');
    tt.innerHTML = '<tr><th>Cur</th><th>Name</th><th>Font</th><th>Width</th><th>Slant°</th><th></th></tr>';
    for (const st of d.textStyles) {
      const tr = h('tr'); if (st.name === d.textStyle) tr.className = 'cur';
      const td = () => { const x = h('td'); tr.appendChild(x); return x; };
      const cur = h('input'); cur.type = 'radio'; cur.name = 'tstyle'; cur.checked = st.name === d.textStyle; cur.onchange = () => { d.textStyle = st.name; upd(); }; td().appendChild(cur);
      const nm = h('input'); nm.value = st.name; nm.className = 'lname';
      nm.onchange = () => {
        const v = nm.value.trim();
        if (!v || st.name === 'Standard' || d.textStyles.some((x) => x !== st && x.name === v)) { nm.value = st.name; return; }
        this.pushUndoNow();
        const fix = (list) => list.forEach((e) => { if (e.style === st.name) e.style = v; });
        fix(d.entities); Object.values(d.blocks).forEach((b) => fix(b.ents));
        d.dimStyles.forEach((ds) => { if (ds.textStyle === st.name) ds.textStyle = v; });
        if (d.textStyle === st.name) d.textStyle = v;
        st.name = v; upd();
      };
      td().appendChild(nm);
      const fs = h('select'); [...new Set([st.font, ...FONTS])].forEach((f) => { const o = h('option', null, f); o.value = f; o.style.fontFamily = f; fs.appendChild(o); });
      fs.value = st.font; fs.onchange = () => { this.pushUndoNow(); st.font = fs.value; upd(); }; td().appendChild(fs);
      const wf = h('input'); wf.type = 'number'; wf.step = '0.05'; wf.min = '0.1'; wf.value = st.width; wf.style.width = '52px';
      wf.onchange = () => { const v = +wf.value; if (v > 0) { this.pushUndoNow(); st.width = v; upd(); } }; td().appendChild(wf);
      const ob = h('input'); ob.type = 'number'; ob.step = '1'; ob.value = st.oblique || 0; ob.style.width = '46px';
      ob.onchange = () => { const v = +ob.value; if (Math.abs(v) <= 85) { this.pushUndoNow(); st.oblique = v; upd(); } }; td().appendChild(ob);
      const del = h('button', 'del', '×'); del.title = 'Delete style';
      del.onclick = () => {
        if (st.name === 'Standard') { this.print('The Standard text style cannot be deleted.'); return; }
        this.pushUndoNow();
        const fix = (list) => list.forEach((e) => { if (e.style === st.name) e.style = 'Standard'; });
        fix(d.entities); Object.values(d.blocks).forEach((b) => fix(b.ents));
        d.dimStyles.forEach((ds) => { if (ds.textStyle === st.name) ds.textStyle = 'Standard'; });
        if (d.textStyle === st.name) d.textStyle = 'Standard';
        d.textStyles = d.textStyles.filter((x) => x !== st); upd();
      };
      td().appendChild(del);
      tt.appendChild(tr);
    }
    body.appendChild(tt);
    const ta = h('div', 'actions'); const tb = h('button', null, '+ New text style');
    tb.onclick = () => { let i = 1; while (d.textStyles.some((x) => x.name === `Style${i}`)) i++; this.pushUndoNow(); d.textStyles.push({ name: `Style${i}`, font: 'Arial', width: 1, oblique: 0 }); upd(); };
    ta.appendChild(tb); body.appendChild(ta);
    // ---- dimension styles
    body.appendChild(h('h4', null, 'Dimension styles'));
    const top = h('div', 'grid2');
    const pick = h('select'); d.dimStyles.forEach((x) => { const o = h('option', null, x.name); o.value = x.name; pick.appendChild(o); });
    pick.value = d.dimStyle; pick.onchange = () => { d.dimStyle = pick.value; upd(); };
    top.append(h('label', null, 'Current style'), pick);
    body.appendChild(top);
    const st = d.dimStyles.find((x) => x.name === d.dimStyle) || d.dimStyles[0];
    const g = h('div', 'grid2');
    const field = (label, key, type, opts) => {
      let el;
      if (type === 'select') { el = h('select'); opts.forEach(([v, l]) => { const o = h('option', null, l); o.value = v; el.appendChild(o); }); el.value = st[key]; }
      else { el = h('input'); if (type === 'num') { el.type = 'number'; el.step = 'any'; } el.value = st[key] ?? ''; }
      el.onchange = () => {
        let v = el.value;
        if (type === 'num') { v = parseFloat(v); if (isNaN(v) || v < 0) { el.value = st[key]; return; } }
        if (key === 'name') { v = v.trim(); if (!v || d.dimStyles.some((x) => x !== st && x.name === v)) { el.value = st.name; return; } const old = st.name; d.entities.forEach((e) => { if (e.dimstyle === old) e.dimstyle = v; }); if (d.dimStyle === old) d.dimStyle = v; }
        this.pushUndoNow(); st[key] = v; upd();
      };
      g.append(h('label', null, label), el);
    };
    field('Name', 'name', 'text');
    field('Text style', 'textStyle', 'select', d.textStyles.map((x) => [x.name, x.name]));
    field('Arrowheads', 'arrow', 'select', [['closed', 'Closed filled'], ['open', 'Open'], ['tick', 'Architectural tick'], ['dot', 'Dot'], ['none', 'None']]);
    field('Text placement', 'tad', 'select', [['above', 'Above the line'], ['centered', 'Centered in the line']]);
    field('Overall scale', 'scale', 'num');
    field('Text height', 'txt', 'num');
    field('Arrow size', 'asz', 'num');
    field('Ext. line offset', 'exo', 'num');
    field('Ext. beyond dim line', 'exe', 'num');
    field('Text gap', 'gap', 'num');
    field('Decimals', 'dec', 'num');
    field('Angle decimals', 'adec', 'num');
    field('Prefix', 'pre', 'text');
    field('Suffix (e.g. " mm")', 'suf', 'text');
    field('Baseline spacing', 'dli', 'num');
    body.appendChild(g);
    const da = h('div', 'actions');
    const nb = h('button', null, '+ New (copy of current)');
    nb.onclick = () => { let i = 1; while (d.dimStyles.some((x) => x.name === `${st.name} ${i}`)) i++; this.pushUndoNow(); d.dimStyles.push({ ...st, name: `${st.name} ${i}` }); d.dimStyle = `${st.name} ${i}`; upd(); };
    const db = h('button', null, 'Delete');
    db.onclick = () => {
      if (d.dimStyles.length < 2) return;
      if (d.entities.some((e) => e.dimstyle === st.name) && !confirm(`Dimensions use "${st.name}". They will switch to "${d.dimStyles.find((x) => x !== st).name}". Continue?`)) return;
      this.pushUndoNow();
      const other = d.dimStyles.find((x) => x !== st).name;
      d.entities.forEach((e) => { if (e.dimstyle === st.name) e.dimstyle = other; });
      d.dimStyles = d.dimStyles.filter((x) => x !== st); d.dimStyle = other; upd();
    };
    const ap = h('button', null, 'Apply to selected dims');
    ap.onclick = () => { const ids = this.selectedIds().filter((id) => this.get(id).type === 'dim'); if (!ids.length) { this.print('Select dimensions first.'); return; } this.pushUndoNow(); ids.forEach((id) => { const e = this.get(id); e.dimstyle = st.name; delete e.h; delete e.scale; }); upd(); };
    da.append(nb, db, ap); body.appendChild(da);
    body.appendChild(h('div', 'muted', 'Sizes are on paper; "Overall scale" multiplies them (e.g. 50 for a 1:50 drawing in mm). Changes update every dimension that uses the style.'));
  },
  buildLayers(body) {
    body.innerHTML = '';
    const d = this.doc;
    const head = document.createElement('div'); head.className = 'actions';
    const add = document.createElement('button'); add.textContent = '+ New layer';
    add.onclick = () => {
      let i = 1; while (this.layer(`Layer${i}`)) i++;
      this.pushUndoNow();
      d.layers.push({ name: `Layer${i}`, color: '#ffffff', visible: true, locked: false, linetype: 'Continuous' });
      this.refreshUI(); this.changed();
    };
    head.appendChild(add);
    body.appendChild(head);
    const tbl = document.createElement('table'); tbl.className = 'layers';
    tbl.innerHTML = '<tr><th title="Current">Cur</th><th>Name</th><th title="On/Off">On</th><th title="Locked">Lock</th><th title="Plot">Plot</th><th>Color</th><th>Linetype</th><th title="Lineweight (mm)">LW</th><th></th></tr>';
    for (const l of d.layers) {
      const tr = document.createElement('tr');
      if (l.name === d.clayer) tr.className = 'cur';
      const td = () => { const x = document.createElement('td'); tr.appendChild(x); return x; };
      const cur = document.createElement('input'); cur.type = 'radio'; cur.name = 'clayer'; cur.checked = l.name === d.clayer;
      cur.onchange = () => { d.clayer = l.name; this.refreshUI(); }; td().appendChild(cur);
      const nm = document.createElement('input'); nm.value = l.name; nm.className = 'lname';
      nm.onchange = () => {
        const v = nm.value.trim();
        if (!v || (this.layer(v) && this.layer(v) !== l) || l.name === '0') { nm.value = l.name; if (l.name === '0') this.print('Layer 0 cannot be renamed.'); return; }
        this.pushUndoNow();
        d.entities.forEach((e) => { if (e.layer === l.name) e.layer = v; });
        if (d.clayer === l.name) d.clayer = v;
        l.name = v; this.changed(); this.refreshUI();
      };
      td().appendChild(nm);
      const on = document.createElement('input'); on.type = 'checkbox'; on.checked = l.visible;
      on.onchange = () => { l.visible = on.checked; for (const id of [...this.sel]) if (this.get(id).layer === l.name) this.sel.delete(id); this.changed(); }; td().appendChild(on);
      const lk = document.createElement('input'); lk.type = 'checkbox'; lk.checked = !!l.locked;
      lk.onchange = () => { l.locked = lk.checked; this.changed(); }; td().appendChild(lk);
      const pl = document.createElement('input'); pl.type = 'checkbox'; pl.checked = l.plot !== false; pl.title = 'Plot this layer';
      pl.onchange = () => { this.pushUndoNow(); l.plot = pl.checked; this.changed(); }; td().appendChild(pl);
      const col = document.createElement('input'); col.type = 'color'; col.value = l.color;
      col.onchange = () => { this.pushUndoNow(); l.color = col.value; this.changed(); this.refreshUI(); }; td().appendChild(col);
      const lt = document.createElement('select');
      Object.keys(LINETYPES).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = k; lt.appendChild(o); });
      lt.value = l.linetype || 'Continuous';
      lt.onchange = () => { this.pushUndoNow(); l.linetype = lt.value; this.changed(); }; td().appendChild(lt);
      const lw = document.createElement('select'); lw.className = 'lwsel';
      LINEWEIGHTS.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v.toFixed(2); lw.appendChild(o); });
      lw.value = l.lw == null ? 0.25 : l.lw;
      lw.onchange = () => { this.pushUndoNow(); l.lw = +lw.value; this.changed(); }; td().appendChild(lw);
      const del = document.createElement('button'); del.textContent = '×'; del.title = 'Delete layer'; del.className = 'del';
      del.onclick = () => {
        if (l.name === '0') { this.print('Layer 0 cannot be deleted.'); return; }
        if (l.name === d.clayer) { this.print('Cannot delete the current layer.'); return; }
        const n = d.entities.filter((e) => e.layer === l.name).length;
        if (n && !confirm(`Layer "${l.name}" has ${n} object(s). Delete the layer AND its objects?`)) return;
        this.pushUndoNow();
        d.entities = d.entities.filter((e) => e.layer !== l.name); this.index = null;
        d.layers = d.layers.filter((x) => x !== l);
        this.changed(); this.refreshUI();
      };
      td().appendChild(del);
      tbl.appendChild(tr);
    }
    body.appendChild(tbl);
    const hint = document.createElement('div'); hint.className = 'muted';
    hint.textContent = 'Tip: select objects and pick a layer in the status bar to move them to that layer. Command line: -LAYER.';
    body.appendChild(hint);
  },
  buildSettings(body) {
    body.innerHTML = '';
    const s = this.settings, d = this.doc;
    const h4 = document.createElement('h4'); h4.textContent = 'Object snap (F3)'; body.appendChild(h4);
    const os = document.createElement('div'); os.className = 'checks';
    for (const [k, label] of OSNAP_MODES) {
      const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!s.osmodes[k];
      c.onchange = () => { s.osmodes[k] = c.checked; this.autosave(); };
      l.append(c, document.createTextNode(' ' + label)); os.appendChild(l);
    }
    body.appendChild(os);
    const h42 = document.createElement('h4'); h42.textContent = 'Drafting'; body.appendChild(h42);
    const tbl = document.createElement('div'); tbl.className = 'grid2';
    const num = (label, get, set) => {
      const l = document.createElement('label'); l.textContent = label;
      const i = document.createElement('input'); i.type = 'number'; i.step = 'any'; i.value = get();
      i.onchange = () => { const v = parseFloat(i.value); if (!isNaN(v) && v >= 0) { set(v); this.requestRedraw(); this.autosave(); } };
      tbl.append(l, i);
    };
    { const l = document.createElement('label'); l.textContent = 'Polar angle step';
      const sl = document.createElement('select');
      [90, 45, 30, 22.5, 15, 10, 5].forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v + '°'; sl.appendChild(o); });
      sl.value = s.polarInc; sl.onchange = () => { s.polarInc = +sl.value; this.autosave(); };
      tbl.append(l, sl); }
    { const l = document.createElement('label'); l.textContent = 'Drawing units';
      const us = document.createElement('select');
      [['mm', 'Millimetres'], ['cm', 'Centimetres'], ['m', 'Metres'], ['in', 'Inches'], ['ft', 'Feet']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; us.appendChild(o); });
      us.value = d.units || 'mm'; us.onchange = () => { d.units = us.value; this.autosave(); };
      tbl.append(l, us); }
    num('Grid spacing', () => s.gridSize, (v) => v > 0 && (s.gridSize = v));
    num('Snap spacing', () => s.snapSize, (v) => v > 0 && (s.snapSize = v));
    num('Text height', () => d.textSize, (v) => v > 0 && (d.textSize = v));
    const cds = () => d.dimStyles.find((x) => x.name === d.dimStyle) || d.dimStyles[0];
    num('Dimension scale', () => cds().scale, (v) => { if (v > 0) { cds().scale = v; this.changed(); } });
    num('Dimension decimals', () => cds().dec, (v) => { cds().dec = Math.round(Math.min(8, v)); this.changed(); });
    num('Hatch scale', () => d.hatchScale, (v) => v > 0 && (d.hatchScale = v));
    num('Revcloud arc length', () => d.revArc, (v) => v > 0 && (d.revArc = v));
    body.appendChild(tbl);
    const lm = document.createElement('label'); lm.className = 'checks';
    const lc = document.createElement('input'); lc.type = 'checkbox'; lc.checked = !!s.leaderMulti;
    lc.onchange = () => { s.leaderMulti = lc.checked; this.autosave(); };
    lm.append(lc, document.createTextNode(' Leaders: allow more than 2 points (Enter to finish)'));
    body.appendChild(lm);
  },

  showContextMenu(ev) {
    const m = this.el.ctx;
    m.innerHTML = '';
    const item = (label, fn) => { const d = document.createElement('div'); d.className = 'ci'; d.textContent = label; d.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); m.style.display = 'none'; fn(); }; m.appendChild(d); };
    const sep = () => { const d = document.createElement('div'); d.className = 'sep'; m.appendChild(d); };
    if (this.lastCmd) item(`Repeat ${this.lastCmd}`, () => this.runCommand(this.lastCmd));
    if (this.sel.size) {
      sep();
      for (const c of ['ERASE', 'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'OFFSET', 'EXPLODE', 'COPYCLIP']) item(c[0] + c.slice(1).toLowerCase(), () => this.runCommand(c));
      sep();
      item('Properties', () => this.showPanel('props'));
      item('Deselect all', () => { this.sel.clear(); this.afterSelChange(); });
    } else {
      sep();
      item('Undo', () => this.undo()); item('Redo', () => this.redo());
      if (this.clipboard) item('Paste', () => this.runCommand('PASTECLIP'));
      sep();
      item('Zoom extents', () => this.zoomExtents()); item('Pan', () => this.runCommand('PAN')); item('Select all', () => this.selectAll());
    }
    m.style.display = 'block';
    const r = this.el.vp.getBoundingClientRect();
    m.style.left = Math.min(ev.clientX - r.left, this.W - m.offsetWidth - 4) + 'px';
    m.style.top = Math.min(ev.clientY - r.top, this.H - m.offsetHeight - 4) + 'px';
  },

  showHelp() {
    const body = document.getElementById('helpbody');
    if (!body.dataset.built) {
      const groups = [
        ['Draw', ['LINE', 'PLINE', 'RECTANG', 'CIRCLE', 'ARC', 'POLYGON', 'ELLIPSE', 'SPLINE', 'HATCH', 'REVCLOUD']],
        ['Annotate / comments', ['TEXT', 'MTEXT', 'MLEADER', 'TEXTEDIT', 'TABLE', 'TABLEDIT', 'STYLE']],
        ['Dimensions', ['DIMLINEAR', 'DIMALIGNED', 'DIMANGULAR', 'DIMRADIUS', 'DIMDIAMETER', 'DIMBASELINE', 'DIMCONTINUE', 'DIMORDINATE', 'DIMREASSOCIATE', 'DIMSTYLE', 'DIMSCALE', 'DIMDEC']],
        ['Modify', ['ERASE', 'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'STRETCH', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'CHAMFER', 'BREAK', 'BREAKATPOINT', 'JOIN', 'LENGTHEN', 'ALIGN', 'PEDIT', 'ARRAY', 'EXPLODE', 'MATCHPROP']],
        ['Blocks', ['BLOCK', 'INSERT', 'ATTDEF', 'ATTEDIT', 'ATTSYNC', 'BEDIT', 'BCLOSE', 'BLOCKSPALETTE', 'PURGE']],
        ['Inquiry & view', ['DIST', 'AREA', 'ID', 'LIST', 'ZOOM', 'PAN', 'REGEN']],
        ['Settings', ['LAYER', '-LAYER', 'COLOR', 'TEXTSIZE', 'DIMSCALE', 'DIMDEC', 'GRID', 'SNAP', 'ORTHO', 'OSNAP']],
        ['Layouts & plotting', ['LAYOUT', 'PAGESETUP', 'MVIEW', 'MSPACE', 'PSPACE', 'PLOT', 'UNITS']],
        ['File & edit', ['NEW', 'OPEN', 'SAVE', 'SAVEAS', 'EXPORT', 'PLOT', 'UNDO', 'REDO', 'COPYCLIP', 'CUTCLIP', 'PASTECLIP', 'SELECTALL', 'HELP']],
      ];
      let html = '';
      for (const [g, names] of groups) {
        html += `<h3>${g}</h3><table class="cmdtbl">`;
        for (const n of names) { const d = Commands.lookup(n); if (d) html += `<tr><td><code>${d.name}</code></td><td><code>${d.aliases.slice(0, 4).join(', ')}</code></td><td>${d.desc}</td></tr>`; }
        html += '</table>';
      }
      body.innerHTML = document.getElementById('helpintro').innerHTML + html;
      body.dataset.built = '1';
    }
    this.el.help.classList.add('open');
  },

  /* ===================== files ===================== */
  newDrawing() {
    this.doc = newDoc(); this.sel.clear(); this.blockEdit = null; this.activeVp = null; this.spaceViews = {}; this.undoStack = []; this.redoStack = []; this.index = null;
    this.view = { cx: 210, cy: 148, scale: Math.max(0.5, (this.W - 40) / 440) };
    this.changed(); this.refreshUI(); this.print('New drawing.');
  },
  saveFile() {
    const data = JSON.stringify({ app: 'BananaCAD', version: 1, doc: this.doc }, null, 1);
    IO.download(`${this.doc.name}.bcad`, data, 'application/json');
    this.print(`Saved "${this.doc.name}.bcad" to your downloads.`);
  },
  openFile() { this.el.file.value = ''; this.el.file.click(); },
  onFile() { const f = this.el.file.files[0]; if (f) this.openBlob(f); },
  openBlob(f) {
    if (/\.dwg$/i.test(f.name)) {
      this.print(`Reading DWG "${f.name}"…${IO._dwg ? '' : ' (loading the DWG reader the first time takes a few seconds)'}`);
      document.body.classList.add('busy');
      f.arrayBuffer()
        .then((buf) => IO.dwgToDXF(buf))
        .then((dxf) => this.loadText(f.name.replace(/\.dwg$/i, '.dxf'), dxf))
        .catch((err) => { console.error(err); this.print('Could not open DWG: ' + (err && err.message ? err.message : err)); })
        .finally(() => document.body.classList.remove('busy'));
      return;
    }
    const rd = new FileReader();
    rd.onload = () => this.loadText(f.name, String(rd.result));
    rd.readAsText(f);
  },
  loadText(name, text) {
    try {
      const base = name.replace(/\.[^.]+$/, '');
      if (/\.dxf$/i.test(name) || /^\s*0\s*\r?\n\s*SECTION/.test(text)) {
        const r = IO.fromDXF(text);
        const d = newDoc();
        d.name = base;
        d.blocks = r.blocks || {};
        for (const t of r.textStyles || []) { const ex = d.textStyles.find((x) => x.name === t.name); if (ex) Object.assign(ex, t); else d.textStyles.push(t); }
        for (const l of r.layers) { const ex = d.layers.find((x) => x.name === l.name); if (ex) Object.assign(ex, l); else d.layers.push(l); }
        const ensureLayers = (list) => { for (const e of list) if (e.layer && !d.layers.find((l) => l.name === e.layer)) d.layers.push({ name: e.layer, color: '#ffffff', visible: true, locked: false, linetype: 'Continuous' }); };
        Object.values(d.blocks).forEach((bk) => ensureLayers(bk.ents));
        for (const e of r.entities) { if (!d.layers.find((l) => l.name === e.layer)) d.layers.push({ name: e.layer, color: '#ffffff', visible: true, locked: false, linetype: 'Continuous' }); e.id = d.nextId++; d.entities.push(e); }
        this.doc = d;
        this.print(`Imported ${r.entities.length} objects and ${r.layers.length} layers from "${name}".`);
        const sk = Object.entries(r.skipped);
        if (sk.length) this.print(`Not imported: ${sk.map(([k, v]) => `${k}×${v}`).join(', ')}`);
      } else {
        const o = JSON.parse(text);
        const d = o.doc || o;
        if (!Array.isArray(d.entities) && !Array.isArray(d.model)) throw new Error('Not a BananaCAD drawing.');
        this.doc = attachSpaces(Object.assign(newDoc(), d));
        this.doc._space = -1;
        this.doc.blocks = this.doc.blocks || {};
        this.doc.name = this.doc.name || base;
        this.print(`Opened "${name}" (${this.doc.entities.length} objects).`);
      }
      this.sel.clear(); this.undoStack = []; this.redoStack = []; this.index = null; this.blockEdit = null; this.activeVp = null; this.spaceViews = {};
      this.changed(); this.refreshUI(); this.zoomExtents();
    } catch (err) { console.error(err); this.print('Could not open file: ' + err.message); }
  },
  /* Read a drawing file (DWG/DXF/BCAD) into {fileName, entities, blocks, layers}. */
  async readDrawing(f) {
    if (/\.dwg$/i.test(f.name)) { this.print(`Reading DWG "${f.name}"…`); return { fileName: f.name, ...IO.fromDXF(await IO.dwgToDXF(await f.arrayBuffer())) }; }
    const text = await f.text();
    if (/\.dxf$/i.test(f.name) || /^\s*0\s*\r?\n\s*SECTION/.test(text)) return { fileName: f.name, ...IO.fromDXF(text) };
    const o = JSON.parse(text), d = o.doc || o;
    const ents = d.model || d.entities;
    if (!Array.isArray(ents)) throw new Error('not a drawing file');
    return { fileName: f.name, entities: ents, blocks: d.blocks || {}, layers: d.layers || [] };
  },
  pickAndReadDrawing() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.dwg,.dxf,.bcad,.json';
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      inp.addEventListener('change', () => { const f = inp.files[0]; if (!f) { fin(null); return; } this.readDrawing(f).then(fin, (err) => fin({ error: err.message || String(err) })); });
      inp.addEventListener('cancel', () => fin(null));
      inp.click();
    });
  },
  /* Turn a read drawing into a block of this drawing (layers and nested blocks merged). */
  blockFromDrawing(f) {
    const d = this.doc;
    const stem = f.fileName.replace(/\.[^.]+$/, '');
    let name = stem, i = 2;
    while (d.blocks[name]) name = `${stem} (${i++})`;
    for (const l of f.layers || []) if (!this.layer(l.name)) d.layers.push({ ...l });
    const map = {};
    for (const bn of Object.keys(f.blocks || {})) { let nn = bn, k = 2; while (d.blocks[nn]) nn = `${bn} (${k++})`; map[bn] = nn; }
    const fix = (list) => list.map((e) => { const n = E.clone(e); delete n.id; if (n.type === 'insert' && map[n.name]) n.name = map[n.name]; if (n.layer && !this.layer(n.layer)) d.layers.push({ name: n.layer, color: '#ffffff', visible: true, locked: false, linetype: 'Continuous' }); return n; });
    for (const bn of Object.keys(f.blocks || {})) d.blocks[map[bn]] = { ...f.blocks[bn], name: map[bn], ents: fix(f.blocks[bn].ents) };
    d.blocks[name] = { name, base: { x: 0, y: 0 }, ents: fix(f.entities) };
    this.changed();
    return name;
  },
  exportAs(k) {
    k = String(k).toUpperCase();
    if (k === 'DXF') { IO.download(`${this.doc.name}.dxf`, IO.toDXF(this.doc), 'application/dxf'); this.print(`Exported "${this.doc.name}.dxf" (AutoCAD R12 DXF).`); }
    else if (k === 'SVG') { IO.download(`${this.doc.name}.svg`, Render.toSVG(this.doc), 'image/svg+xml'); this.print(`Exported "${this.doc.name}.svg".`); }
    else if (k === 'PNG') { this.renderPNG().toBlob((b) => { IO.download(`${this.doc.name}.png`, b); this.print(`Exported "${this.doc.name}.png".`); }); }
  },
  renderPNG(maxDim = 3000) {
    const b = Render.extents(this.doc, this.doc.model) || { minx: 0, miny: 0, maxx: 100, maxy: 100 };
    const w0 = Math.max(b.maxx - b.minx, 1e-6), h0 = Math.max(b.maxy - b.miny, 1e-6);
    const scale = (maxDim * 0.92) / Math.max(w0, h0);
    const W = Math.round(w0 * scale / 0.92), H = Math.round(h0 * scale / 0.92);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    const st = { ctx, dpr: 1, W, H, view: { cx: (b.minx + b.maxx) / 2, cy: (b.miny + b.maxy) / 2, scale }, doc: this.doc, print: true };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    st.lwt = this.settings.lwt;
    Render.drawDrawing(st, null, null, this.doc.model);
    return c;
  },

  /* ===================== drawing ===================== */
  requestRedraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.draw(); });
  },
  draw() {
    const ctx = this.ctx2d, W = this.W, H = this.H, dpr = this.dpr;
    const paper = this.space >= 0;
    const st = { ctx, dpr, W, H, view: this.view, doc: this.doc, print: paper, lwt: this.settings.lwt };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = paper ? '#5b616a' : '#1f252d'; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    E.ctxDoc = this.doc;
    if (paper) this.drawPaper(ctx, st);
    else if (this.settings.grid) this.drawGrid(ctx);
    const be = this.blockEdit;
    if (be) {
      const skip = new Set([...(this.hidden || []), ...be.ids]);
      if (be.insId) skip.add(be.insId);
      ctx.globalAlpha = 0.28; Render.drawDrawing(st, skip); ctx.globalAlpha = 1;
      Render.drawDrawing(st, this.hidden, be.ids);
    } else Render.drawDrawing(st, this.hidden);
    // highlights
    Render.worldXf(st);
    for (const id of this.sel) {
      const e = this.get(id); if (!e || (this.hidden && this.hidden.has(id))) continue;
      Render.drawEntity(st, e, { color: '#7fb4ff', dash: [6, 4], lw: 1.6 });
    }
    if (this.hover && !this.sel.has(this.hover)) { const e = this.get(this.hover); if (e) Render.drawEntity(st, e, { lw: 2.6 }); }
    // previews
    const pr = this.cmd && this.cmd.prompt;
    if (pr) {
      const ms = this.mouse;
      const base = pr.base || pr._first;
      if (base && this.wantsPoint(pr) && pr.rubber !== false && ms.over) {
        Render.drawOps(st, [{ op: 'poly', pts: [base, ms.pt] }], paper ? 'rgba(40,50,60,0.6)' : 'rgba(255,255,255,0.55)', { dash: [4, 4] });
      }
      let prev = [];
      try { if (pr.preview && ms.over && pr.type !== 'textedit') prev = pr.preview(ms.pt) || []; } catch (err) { console.error(err); }
      if (pr.previewEnt) prev.push(pr.previewEnt);
      for (const e of prev) {
        const t = { layer: this.doc.clayer, color: this.doc.ccolor, ...e };
        Render.worldXf(st);
        Render.drawEntity(st, t, { preview: true });
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // grips
    if (!this.cmd || (this.cmd.def === GRIP_CMD)) {
      if (this.sel.size <= 300) for (const id of this.sel) {
        const e = this.get(id); if (!e) continue;
        E.grips(e).forEach((g, i) => {
          const s = this.toScreen(g);
          const hot = this.cmd && this.cmd.def === GRIP_CMD && this.hotGrip && this.hotGrip.id === id && this.hotGrip.index === i;
          const hov = Math.abs(s.x - this.mouse.sx) <= 6 && Math.abs(s.y - this.mouse.sy) <= 6;
          ctx.fillStyle = hot ? '#ff3b3b' : hov ? '#ff9c3b' : '#2f7cf6';
          ctx.fillRect(s.x - 4.5, s.y - 4.5, 9, 9);
          ctx.strokeStyle = '#0b1a33'; ctx.lineWidth = 1; ctx.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
        });
      }
    }
    // window selection
    if (this.win) {
      const a = this.toScreen(this.win.a), b = { x: this.mouse.sx, y: this.mouse.sy };
      const crossing = b.x < a.x;
      ctx.fillStyle = crossing ? 'rgba(60,200,90,0.15)' : 'rgba(60,120,255,0.15)';
      ctx.strokeStyle = crossing ? '#5fe07f' : '#6f9cff';
      ctx.setLineDash(crossing ? [5, 4] : []);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.setLineDash([]);
    }
    if (this.tableCell) {
      const t = this.get(this.tableCell.id);
      if (t) {
        const g = E.tableGeom(t), { r, c } = this.tableCell;
        const q = [g.L(g.xs[c], g.ys[r]), g.L(g.xs[c + 1], g.ys[r]), g.L(g.xs[c + 1], g.ys[r + 1]), g.L(g.xs[c], g.ys[r + 1])].map((p) => this.toScreen(p));
        ctx.strokeStyle = '#3b8cff'; ctx.lineWidth = 2; ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
      }
    }
    this.drawUCS(ctx);
    if (be) {
      const msg = `BLOCK EDITOR — "${be.name}" · type BCLOSE to save or discard`;
      ctx.font = `600 13px ${FONT_FAMILY}`;
      const w = ctx.measureText(msg).width + 24;
      ctx.fillStyle = 'rgba(255,170,0,0.92)'; ctx.fillRect((W - w) / 2, 8, w, 26);
      ctx.fillStyle = '#1b1b1b'; ctx.textAlign = 'center'; ctx.fillText(msg, W / 2, 26); ctx.textAlign = 'left';
    }
    // tracking
    const ms = this.mouse;
    this.el.tip.style.display = 'none';
    if (this.cmd && this.tracked.length) {
      ctx.strokeStyle = '#4cd964'; ctx.lineWidth = 1.5;
      for (const a of this.tracked) { const s = this.toScreen(a); ctx.beginPath(); ctx.moveTo(s.x - 5, s.y); ctx.lineTo(s.x + 5, s.y); ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x, s.y + 5); ctx.stroke(); }
    }
    if (ms.track && ms.over) {
      ctx.strokeStyle = 'rgba(76,217,100,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      const big = (this.W + this.H) * 2;
      for (const l of ms.track.lines) {
        const o = this.toScreen(l.o), u = { x: l.u.x, y: -l.u.y };
        ctx.beginPath();
        if (l.ray) { ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + u.x * big, o.y + u.y * big); }
        else { ctx.moveTo(o.x - u.x * big, o.y - u.y * big); ctx.lineTo(o.x + u.x * big, o.y + u.y * big); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const s = this.toScreen(ms.track.pt);
      ctx.strokeStyle = '#4cd964'; ctx.beginPath(); ctx.moveTo(s.x - 5, s.y - 5); ctx.lineTo(s.x + 5, s.y + 5); ctx.moveTo(s.x + 5, s.y - 5); ctx.lineTo(s.x - 5, s.y + 5); ctx.stroke();
      const pr2 = this.cmd && this.cmd.prompt, b0 = pr2 && (pr2.base || pr2._first);
      let label = ms.track.label;
      if (b0) label += `: ${fmtNum(G.dist(b0, ms.track.pt), 4)} < ${fmtNum(G.normAng(G.angle(b0, ms.track.pt)) / DEG, 2)}°`;
      this.el.tip.textContent = label; this.el.tip.style.display = 'block';
      this.el.tip.style.left = s.x + 14 + 'px'; this.el.tip.style.top = s.y - 34 + 'px';
    }
    // osnap marker
    if (ms.snap && ms.over) {
      const s = this.toScreen(ms.snap.pt);
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2;
      const r = 7;
      ctx.beginPath();
      switch (ms.snap.type) {
        case 'end': ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r); break;
        case 'mid': ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x + r, s.y + r * 0.8); ctx.lineTo(s.x - r, s.y + r * 0.8); ctx.closePath(); break;
        case 'cen': ctx.arc(s.x, s.y, r, 0, TAU); break;
        case 'quad': ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x + r, s.y); ctx.lineTo(s.x, s.y + r); ctx.lineTo(s.x - r, s.y); ctx.closePath(); break;
        case 'int': ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r); ctx.moveTo(s.x + r, s.y - r); ctx.lineTo(s.x - r, s.y + r); break;
        case 'perp': ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y + r); ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x, s.y); ctx.lineTo(s.x, s.y + r); break;
        case 'ins': ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r); ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x + r, s.y); break;
        case 'node': ctx.arc(s.x, s.y, r, 0, TAU); ctx.moveTo(s.x - r * 0.7, s.y - r * 0.7); ctx.lineTo(s.x + r * 0.7, s.y + r * 0.7); ctx.moveTo(s.x + r * 0.7, s.y - r * 0.7); ctx.lineTo(s.x - r * 0.7, s.y + r * 0.7); break;
        case 'nea': ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y - r); ctx.lineTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y + r); ctx.closePath(); break;
      }
      ctx.stroke();
      const label = { end: 'Endpoint', mid: 'Midpoint', cen: 'Center', quad: 'Quadrant', int: 'Intersection', perp: 'Perpendicular', ins: 'Insertion', node: 'Node', nea: 'Nearest' }[ms.snap.type];
      this.el.tip.textContent = label;
      this.el.tip.style.display = 'block';
      this.el.tip.style.left = s.x + 12 + 'px'; this.el.tip.style.top = s.y - 30 + 'px';
    }
    // crosshair
    if (ms.over && !(pr && pr.type === 'textedit')) {
      const x = Math.round(ms.sx) + 0.5, y = Math.round(ms.sy) + 0.5;
      ctx.strokeStyle = paper ? 'rgba(30,36,44,0.8)' : 'rgba(235,240,245,0.75)'; ctx.lineWidth = 1;
      ctx.beginPath();
      const picking = !this.cmd || (pr && (pr.type === 'select' || pr.type === 'entity' || pr.pickbox));
      const gap = picking ? 6 : 0;
      ctx.moveTo(0, y); ctx.lineTo(x - gap, y); ctx.moveTo(x + gap, y); ctx.lineTo(W, y);
      ctx.moveTo(x, 0); ctx.lineTo(x, y - gap); ctx.moveTo(x, y + gap); ctx.lineTo(x, H);
      ctx.stroke();
      if (picking) ctx.strokeRect(x - 5, y - 5, 10, 10);
    }
  },
  /* Paper sheet + viewport contents for layouts. */
  drawPaper(ctx, st) {
    const L = this.doc.layouts[this.space], ps = paperSize(L);
    const a = this.toScreen({ x: 0, y: ps.h }), b = this.toScreen({ x: ps.w, y: 0 });
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(a.x + 6, a.y + 6, b.x - a.x, b.y - a.y);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    const vis = new Set(this.doc.layers.filter((l) => l.visible).map((l) => l.name));
    for (const vp of L.ents) {
      if (vp.type !== 'viewport' || !vis.has(vp.layer) || vp.on === false) continue;
      const q1 = this.toScreen({ x: vp.p1.x, y: vp.p2.y }), q2 = this.toScreen({ x: vp.p2.x, y: vp.p1.y });
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.beginPath(); ctx.rect(q1.x, q1.y, q2.x - q1.x, q2.y - q1.y); ctx.clip();
      const S = this.view.scale * vp.scale, sP0 = this.toScreen(G.mid(vp.p1, vp.p2));
      const st2 = { ...st, view: { cx: vp.cx - (sP0.x - this.W / 2) / S, cy: vp.cy + (sP0.y - this.H / 2) / S, scale: S } };
      Render.drawDrawing(st2, null, null, this.doc.model);
      ctx.restore();
      if (this.activeVp === vp.id) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.strokeStyle = '#3b8cff'; ctx.lineWidth = 3; ctx.strokeRect(q1.x, q1.y, q2.x - q1.x, q2.y - q1.y); }
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  },
  drawGrid(ctx) {
    const s = this.view.scale;
    let g = this.settings.gridSize;
    let k = 0;
    while (g * s < 12 && k++ < 30) g *= k % 2 ? 5 : 2;
    while (g * s > 120 && k++ < 60) g /= 5;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.W, this.H);
    const x0 = Math.floor(tl.x / g), x1 = Math.ceil(br.x / g), y0 = Math.floor(br.y / g), y1 = Math.ceil(tl.y / g);
    if ((x1 - x0) * (y1 - y0) > 1e6) return;
    ctx.lineWidth = 1;
    for (const major of [false, true]) {
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.085)' : 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      for (let i = x0; i <= x1; i++) { if ((i % 5 === 0) !== major) continue; const sx = Math.round(this.toScreen({ x: i * g, y: 0 }).x) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, this.H); }
      for (let j = y0; j <= y1; j++) { if ((j % 5 === 0) !== major) continue; const sy = Math.round(this.toScreen({ x: 0, y: j * g }).y) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(this.W, sy); }
      ctx.stroke();
    }
    const o = this.toScreen({ x: 0, y: 0 });
    ctx.strokeStyle = 'rgba(255,90,90,0.35)'; ctx.beginPath(); ctx.moveTo(0, Math.round(o.y) + 0.5); ctx.lineTo(this.W, Math.round(o.y) + 0.5); ctx.stroke();
    ctx.strokeStyle = 'rgba(90,220,110,0.35)'; ctx.beginPath(); ctx.moveTo(Math.round(o.x) + 0.5, 0); ctx.lineTo(Math.round(o.x) + 0.5, this.H); ctx.stroke();
  },
  drawUCS(ctx) {
    const x = 26, y = this.H - 26, L = 40;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff5a5a'; ctx.fillStyle = '#ff5a5a';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + L, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + L + 6, y); ctx.lineTo(x + L - 2, y - 4); ctx.lineTo(x + L - 2, y + 4); ctx.fill();
    ctx.strokeStyle = '#5adc6e'; ctx.fillStyle = '#5adc6e';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - L); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - L - 6); ctx.lineTo(x - 4, y - L + 2); ctx.lineTo(x + 4, y - L + 2); ctx.fill();
    ctx.font = '11px ' + FONT_FAMILY; ctx.fillStyle = '#cfd6dd';
    ctx.fillText('X', x + L + 9, y + 4); ctx.fillText('Y', x - 3, y - L - 10);
  },

  /* ===================== ribbon ===================== */
  buildRibbon() {
    const rb = document.getElementById('ribbon');
    rb.innerHTML = '';
    const tabs = document.createElement('div'); tabs.className = 'rtabs';
    const body = document.createElement('div'); body.className = 'rbody';
    rb.append(tabs, body);
    let current = null;
    try { current = localStorage.getItem('bananacad.ribbonTab'); } catch (err) { /* ignore */ }
    if (!RIBBON.some((t) => t.tab === current)) current = RIBBON[0].tab;
    const show = (name) => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === name));
      body.innerHTML = '';
      const tab = RIBBON.find((t) => t.tab === name);
      for (const [g, btns] of tab.groups) {
        const grp = document.createElement('div'); grp.className = 'rgroup';
        const row = document.createElement('div'); row.className = 'rbtns';
        for (const [cmd, label, icon] of btns) {
          const b = document.createElement('button');
          b.className = 'rbtn';
          const d = Commands.lookup(cmd);
          b.title = d ? `${d.name}${d.aliases.length ? ' (' + d.aliases.slice(0, 2).join(', ') + ')' : ''} — ${d.desc}` : label;
          b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[icon] || ICONS.cmd}</svg><span>${label}</span>`;
          b.onmousedown = (ev) => ev.preventDefault();
          b.onclick = () => { if (cmd === 'ZOOM_E') this.zoomExtents(); else this.runCommand(cmd); this.el.input.focus(); };
          row.appendChild(b);
        }
        const t = document.createElement('div'); t.className = 'rtitle'; t.textContent = g;
        grp.append(row, t); body.appendChild(grp);
      }
      try { localStorage.setItem('bananacad.ribbonTab', name); } catch (err) { /* ignore */ }
    };
    for (const t of RIBBON) {
      const b = document.createElement('button'); b.textContent = t.tab;
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => show(t.tab);
      tabs.appendChild(b);
    }
    show(current);
    document.querySelectorAll('[data-cmd]').forEach((b) => {
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => { const c = b.dataset.cmd; if (c.startsWith('EXPORT:')) this.runCommand('EXPORT', { format: c.slice(7) }); else this.runCommand(c); this.el.input.focus(); };
      const ic = b.dataset.icon; if (ic) b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24">${ICONS[ic]}</svg>`);
    });
  },
};

/* Grip editing: an internal command started by clicking a grip. */
const GRIP_CMD = {
  name: 'GRIP', aliases: [], desc: 'grip edit', internal: true, sel: true,
  fn: function* (c, g) {
    const e = c.get(g.id);
    if (!e) return;
    c.usedSel = false;
    c.app.hotGrip = g;
    c.print('** STRETCH **');
    let copy = false;
    try {
      for (;;) {
        c.app.hidden = copy ? null : new Set([g.id]);
        const p = yield { type: 'point', msg: 'Specify stretch point', keywords: ['Copy'], base: g.pt, preview: (m) => { const t = E.clone(e); E.setGrip(t, g.index, m); return [t]; } };
        if (!p) return;
        if (p.kw === 'Copy') { copy = true; c.print('Copy mode: each click places a copy. Enter to finish.'); continue; }
        if (copy) { const t = E.clone(e); delete t.id; E.setGrip(t, g.index, p); c.add(t); continue; }
        E.setGrip(e, g.index, p); c.changed();
        return;
      }
    } finally { c.app.hidden = null; c.app.hotGrip = null; }
  },
};

/* Ribbon layout: tabs -> groups -> [command, label, icon]. */
const RIBBON = [
  { tab: 'Home', groups: [
    ['Draw', [['LINE', 'Line', 'line'], ['PLINE', 'Polyline', 'pline'], ['CIRCLE', 'Circle', 'circle'], ['ARC', 'Arc', 'arc'], ['RECTANG', 'Rectangle', 'rect'], ['POLYGON', 'Polygon', 'polygon'], ['ELLIPSE', 'Ellipse', 'ellipse'], ['SPLINE', 'Spline', 'spline'], ['HATCH', 'Hatch', 'hatch'], ['REVCLOUD', 'Rev cloud', 'cloud']]],
    ['Modify', [['MOVE', 'Move', 'move'], ['COPY', 'Copy', 'copy'], ['ROTATE', 'Rotate', 'rotate'], ['SCALE', 'Scale', 'scale'], ['MIRROR', 'Mirror', 'mirror'], ['STRETCH', 'Stretch', 'stretch'], ['OFFSET', 'Offset', 'offset'], ['TRIM', 'Trim', 'trim'], ['EXTEND', 'Extend', 'extend'], ['FILLET', 'Fillet', 'fillet'], ['CHAMFER', 'Chamfer', 'chamfer'], ['BREAK', 'Break', 'break'], ['JOIN', 'Join', 'join'], ['LENGTHEN', 'Lengthen', 'lengthen'], ['ALIGN', 'Align', 'align'], ['ARRAY', 'Array', 'array'], ['PEDIT', 'Edit pline', 'pline'], ['EXPLODE', 'Explode', 'explode'], ['ERASE', 'Erase', 'erase'], ['MATCHPROP', 'Match', 'match']]],
    ['Utilities', [['DIST', 'Measure', 'dist'], ['AREA', 'Area', 'area'], ['LAYER', 'Layers', 'layers'], ['ZOOM_E', 'Extents', 'zoomext']]],
  ] },
  { tab: 'Annotate', groups: [
    ['Text & notes', [['TEXT', 'Text', 'text'], ['MTEXT', 'MText', 'mtext'], ['MLEADER', 'Leader note', 'leader'], ['REVCLOUD', 'Rev cloud', 'cloud'], ['TABLE', 'Table', 'table'], ['STYLE', 'Text style', 'tstyle']]],
    ['Dimensions', [['DIMLINEAR', 'Linear', 'dimlin'], ['DIMALIGNED', 'Aligned', 'dimali'], ['DIMANGULAR', 'Angular', 'dimang'], ['DIMRADIUS', 'Radius', 'dimrad'], ['DIMDIAMETER', 'Diameter', 'dimdia'], ['DIMBASELINE', 'Baseline', 'dimbase'], ['DIMCONTINUE', 'Continue', 'dimcont'], ['DIMORDINATE', 'Ordinate', 'dimord'], ['DIMSTYLE', 'Dim style', 'dstyle']]],
  ] },
  { tab: 'Insert', groups: [
    ['Block', [['INSERT', 'Insert', 'insert'], ['BLOCK', 'Create', 'blockmake'], ['BEDIT', 'Edit block', 'blockedit'], ['BCLOSE', 'Close editor', 'check'], ['BLOCKSPALETTE', 'Library', 'library'], ['PURGE', 'Purge', 'erase']]],
    ['Attributes', [['ATTDEF', 'Define', 'attdef'], ['ATTEDIT', 'Edit values', 'attedit'], ['ATTSYNC', 'Sync', 'sync']]],
    ['Import', [['OPEN', 'Open DWG/DXF', 'open']]],
  ] },
  { tab: 'Layout', groups: [
    ['Layouts', [['LAYOUT', 'Layouts', 'layout'], ['PAGESETUP', 'Page setup', 'page'], ['MVIEW', 'Viewport', 'viewport'], ['MSPACE', 'Into viewport', 'zoomwin'], ['PSPACE', 'Paper', 'page']]],
    ['Output', [['PLOT', 'Plot / PDF', 'print'], ['EXPORT', 'Export', 'export']]],
  ] },
  { tab: 'View', groups: [
    ['Navigate', [['ZOOM_E', 'Extents', 'zoomext'], ['ZOOM', 'Window', 'zoomwin'], ['PAN', 'Pan', 'pan'], ['REGEN', 'Regen', 'rotate']]],
    ['Palettes', [['LAYER', 'Layers', 'layers'], ['OSNAP', 'Settings', 'cmd'], ['HELP', 'Help', 'help']]],
  ] },
];
const ribbonAdd = (tab, group, btns) => {
  const t = RIBBON.find((x) => x.tab === tab);
  const g = t.groups.find((x) => x[0] === group);
  if (g) g[1].push(...btns); else t.groups.push([group, btns]);
};

/* ---------- small inline icons (24x24, stroke=currentColor) ---------- */
const ICONS = {
  line: '<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.6"/><circle cx="20" cy="4" r="1.6"/>',
  pline: '<path d="M3 18L9 8l6 8 6-10"/>',
  circle: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1"/>',
  arc: '<path d="M4 18A9 9 0 0 1 20 18"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
  polygon: '<path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="5.5"/>',
  hatch: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12l8-8M4 20L20 4M12 20l8-8"/>',
  cloud: '<path d="M6 18a3 3 0 0 1-.6-5.9A4 4 0 0 1 12.5 8a3.5 3.5 0 0 1 6 2.5 3.8 3.8 0 0 1-.5 7.5z"/>',
  text: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>',
  mtext: '<path d="M4 5h16M4 10h16M4 15h10M4 20h13"/>',
  leader: '<path d="M4 20l8-8h8"/><path d="M4 20l1.5-5 3.5 3.5z" fill="currentColor"/><path d="M14 7h6M14 4h6"/>',
  dimlin: '<path d="M4 6v12M20 6v12M4 12h16"/><path d="M4 12l3.5-2v4zM20 12l-3.5-2v4z" fill="currentColor"/>',
  dimali: '<path d="M4 14L14 4M10 20L20 10M7 17L17 7"/>',
  dimrad: '<circle cx="12" cy="12" r="8"/><path d="M12 12l5.6-5.6"/>',
  dimdia: '<circle cx="12" cy="12" r="8"/><path d="M6.3 17.7L17.7 6.3"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  copy: '<rect x="8" y="8" width="12" height="12"/><path d="M4 16V4h12"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  scale: '<rect x="3" y="11" width="10" height="10"/><path d="M13 11L21 3M15 3h6v6"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 6L3 18h6zM15 6l6 12h-6z"/>',
  offset: '<path d="M3 20c3-9 15-9 18 0"/><path d="M3 13c3-9 15-9 18 0" stroke-dasharray="3 2"/>',
  trim: '<path d="M14 3v18"/><path d="M3 12h11"/><path d="M14 12h7" stroke-dasharray="2 2"/>',
  extend: '<path d="M20 3v18"/><path d="M3 12h9"/><path d="M12 12h8" stroke-dasharray="2 2"/>',
  fillet: '<path d="M4 20V13a9 9 0 0 1 9-9h7"/>',
  array: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  explode: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/>',
  erase: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  match: '<path d="M14 3l7 7-6 6-7-7z"/><path d="M11 13l-6 6a2 2 0 0 0 0 0l-2 2"/>',
  zoomext: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="9" y="9" width="6" height="6"/>',
  zoomwin: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21"/>',
  pan: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6 7s-5-2-6.5-4.5L3 13a1.5 1.5 0 0 1 2.5-1.5L8 14"/>',
  dist: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  new: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>',
  open: '<path d="M3 6h6l2 2h10v12H3z"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h8M8 21v-7h8v7"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
  print: '<path d="M6 9V3h12v6M6 18H3v-9h18v9h-3M6 14h12v7H6z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  spline: '<path d="M3 17c3-9 6-9 9-3s6 6 9-6"/><circle cx="3" cy="17" r="1.3"/><circle cx="21" cy="8" r="1.3"/>',
  stretch: '<rect x="3" y="8" width="9" height="9" stroke-dasharray="2 2"/><path d="M8 8h13v9H8M17 12.5h5M19.5 10l2.5 2.5-2.5 2.5"/>',
  chamfer: '<path d="M4 20V10l6-6h10"/>',
  break: '<path d="M3 12h6M15 12h6"/><path d="M9 9v6M15 9v6" stroke-dasharray="1.5 1.5"/>',
  join: '<path d="M3 16l6-8M15 8l6 8"/><path d="M9 8h6"/><circle cx="9" cy="8" r="1.5"/><circle cx="15" cy="8" r="1.5"/>',
  lengthen: '<path d="M3 12h12"/><path d="M15 12h6" stroke-dasharray="2 2"/><path d="M18 9l3 3-3 3"/>',
  align: '<path d="M4 18l6-6M14 6h6v6"/><path d="M4 18h16" stroke-dasharray="2 2"/>',
  area: '<path d="M4 18l3-12 10 2 3 10z"/><path d="M8 14h6" stroke-dasharray="1.5 1.5"/>',
  cmd: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10l3 2-3 2M13 15h3"/>',
  layout: '<rect x="3" y="5" width="18" height="14"/><rect x="6" y="8" width="8" height="8"/><path d="M16 15h3"/>',
  page: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>',
  viewport: '<rect x="3" y="5" width="18" height="14"/><path d="M6 15l4-4 3 3 3-2 3 3"/>',
  table: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M3 14.5h18M9 4v16M15 4v16"/>',
  tstyle: '<path d="M4 18L9 5l5 13M6 13h6"/><path d="M15 18h6M18 9v9"/>',
  dimang: '<path d="M4 20L20 20M4 20L16 6"/><path d="M14 20a10 10 0 0 0-2.8-7"/>',
  dimbase: '<path d="M4 4v16M12 10v10M20 6v14M4 13h8M4 8h16"/>',
  dimcont: '<path d="M3 8v12M11 8v12M21 8v12M3 12h18"/><path d="M3 12l2.5-1.5v3zM11 12l-2.5-1.5v3zM11 12l2.5-1.5v3zM21 12l-2.5-1.5v3z" fill="currentColor"/>',
  dimord: '<path d="M4 20h16M4 20V4"/><path d="M10 20V8h6M16 20v-6h4" stroke-dasharray="2 1.5"/>',
  dstyle: '<path d="M4 14v6M20 14v6M4 17h16"/><path d="M6 4h12v6H6z"/>',
  insert: '<rect x="9" y="9" width="12" height="12"/><path d="M3 3l9 9M12 6v6H6"/>',
  blockmake: '<rect x="3" y="3" width="8" height="8"/><circle cx="17" cy="7" r="4"/><path d="M3 15h18v6H3z" stroke-dasharray="2 2"/>',
  blockedit: '<rect x="3" y="3" width="12" height="12" stroke-dasharray="2 2"/><path d="M13 21l1-4 7-7 3 3-7 7z"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  library: '<rect x="3" y="3" width="7" height="7"/><circle cx="17.5" cy="6.5" r="3.5"/><path d="M3 14h7v7H3zM14 14l7 7M21 14l-7 7"/>',
  attdef: '<path d="M4 6h10M9 6v12"/><rect x="13" y="12" width="8" height="8" rx="1"/><path d="M15 16h4"/>',
  attedit: '<rect x="3" y="6" width="14" height="10" rx="1"/><path d="M6 11h6M14 20l1-3 5-5 2 2-5 5z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14-4M4 13a8 8 0 0 0 14 4"/><path d="M6 3v4h4M18 21v-4h-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7V14M12 17v.5"/>',
};

window.addEventListener('DOMContentLoaded', () => App.init());
