'use strict';
/* BananaCAD application: state, command runner, input, drawing loop, UI. */
const AUTOSAVE_KEY = 'bananacad.autosave.v1';
const OSNAP_MODES = [
  ['end', 'Endpoint'], ['mid', 'Midpoint'], ['cen', 'Center'], ['quad', 'Quadrant'],
  ['int', 'Intersection'], ['perp', 'Perpendicular'], ['ins', 'Insertion'], ['nea', 'Nearest'],
];

function newDoc() {
  return {
    name: 'Drawing1', entities: [], nextId: 1,
    layers: [
      { name: '0', color: '#ffffff', visible: true, locked: false, linetype: 'Continuous' },
      { name: 'Annotation', color: '#ffff00', visible: true, locked: false, linetype: 'Continuous' },
      { name: 'Dimensions', color: '#00ffff', visible: true, locked: false, linetype: 'Continuous' },
      { name: 'Hidden', color: '#808080', visible: true, locked: false, linetype: 'Hidden' },
    ],
    clayer: '0', ccolor: 'bylayer', textSize: 2.5, dimScale: 1, dimDec: 2,
    filletRad: 0, offsetDist: 1, lastRadius: undefined, revArc: 10,
    hatchPattern: 'ANSI31', hatchScale: 1, hatchAngle: 0,
  };
}

const App = {
  doc: newDoc(),
  view: { cx: 210, cy: 148, scale: 3 },
  settings: { grid: true, snap: false, ortho: false, osnap: true, dyn: true, gridSize: 10, snapSize: 5, leaderMulti: false,
    osmodes: { end: true, mid: true, cen: true, quad: true, int: true, perp: true, ins: true, nea: false } },
  sel: new Set(),
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
      if (s) { const o = JSON.parse(s); if (o && o.doc && Array.isArray(o.doc.entities)) { this.doc = Object.assign(newDoc(), o.doc); if (o.view) this.view = o.view; if (o.settings) Object.assign(this.settings, o.settings, { osmodes: Object.assign(this.settings.osmodes, o.settings.osmodes || {}) }); restored = true; } }
    } catch (err) { /* storage unavailable */ }
    if (!restored) this.view = { cx: 210, cy: 148, scale: Math.max(0.5, (this.W - 40) / 440) };
    this.print('BananaCAD — 2D drafting. Type a command (e.g. LINE or L) and press Enter. Press F1 for the command list.');
    if (restored) this.print(`Restored autosaved drawing "${this.doc.name}" (${this.doc.entities.length} objects).`);
    this.showPrompt();
    this.refreshUI();
    this.el.input.focus();
  },

  /* ===================== document helpers ===================== */
  layer(name) { return this.doc.layers.find((l) => l.name.toLowerCase() === String(name).toLowerCase()); },
  visibleEntities() { const v = new Set(this.doc.layers.filter((l) => l.visible).map((l) => l.name)); return this.doc.entities.filter((e) => v.has(e.layer)); },
  selectableEntities() { const v = new Set(this.doc.layers.filter((l) => l.visible && !l.locked).map((l) => l.name)); return this.doc.entities.filter((e) => v.has(e.layer)); },
  selectedIds() { return [...this.sel].filter((id) => this.get(id)); },
  get(id) {
    if (!this.index) { this.index = new Map(); for (const e of this.doc.entities) this.index.set(e.id, e); }
    return this.index.get(id);
  },
  add(e) {
    e.id = this.doc.nextId++;
    if (!e.layer || !this.layer(e.layer)) e.layer = this.doc.clayer;
    if (!e.color) e.color = this.doc.ccolor;
    this.doc.entities.push(e);
    this.index = null; this.changed();
    return e;
  },
  remove(id) {
    const i = this.doc.entities.findIndex((e) => e.id === id);
    if (i >= 0) this.doc.entities.splice(i, 1);
    this.sel.delete(id); this.index = null; this.changed();
  },
  changed() {
    this.rev++; this.cache.clear();
    this.requestRedraw();
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.autosave(), 600);
    if (!this.cmd) this.refreshProps();
  },
  autosave() {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ doc: this.doc, view: this.view, settings: this.settings })); } catch (err) { /* quota */ }
  },
  serialize() { return JSON.stringify({ e: this.doc.entities, l: this.doc.layers, n: this.doc.nextId, c: this.doc.clayer }); },
  captureState() { return this.serialize(); },
  restoreState(s) {
    const o = JSON.parse(s);
    this.doc.entities = o.e; this.doc.layers = o.l; this.doc.nextId = o.n; this.doc.clayer = o.c;
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
    this.showPrompt();
    this.updateMouse();
    this.requestRedraw();
  },
  finish() {
    const cmd = this.cmd;
    if (!cmd) return;
    this.cmd = null;
    this.closeEditor();
    this.hidden = null; this.win = null;
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
    if (pr.type === 'point' && v && typeof v.x === 'number') this.lastPoint = v;
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
    const b = Render.extents(this.doc);
    this.pushView();
    if (!b) { this.view = { cx: 210, cy: 148, scale: Math.max(0.5, (this.W - 40) / 440) }; this.requestRedraw(); return; }
    this.zoomRect(b, false);
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
    const consider = (type, pt) => { const d = G.dist(p, pt); if (d <= tol && d < bd) { bd = d; best = { type, pt }; } };
    const curves = [];
    for (const e of near) {
      for (const s of E.snaps(e, this.doc)) if (m[s.type]) consider(s.type, s.pt);
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
  wantsPoint(pr) { return pr && ['point', 'distance', 'angle'].includes(pr.type) && !pr.pickbox; },
  updateMouse() {
    const ms = this.mouse;
    ms.world = this.toWorld(ms.sx, ms.sy);
    let p = ms.world; ms.snap = null;
    const pr = this.cmd && this.cmd.prompt;
    if (this.wantsPoint(pr)) {
      const base = pr.base || pr._first;
      if (this.settings.osnap && ms.over) ms.snap = this.findOsnap(ms.sx, ms.sy, base);
      if (ms.snap) p = ms.snap.pt;
      else {
        if (this.settings.snap) { const g = this.settings.snapSize; p = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }; }
        if (base && (this.settings.ortho !== ms.shift)) p = Math.abs(p.x - base.x) >= Math.abs(p.y - base.y) ? { x: p.x, y: base.y } : { x: base.x, y: p.y };
      }
    }
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
    cv.addEventListener('wheel', (ev) => { ev.preventDefault(); const r = cv.getBoundingClientRect(); this.zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
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
      if (this.drag.type === 'pan') {
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
    if (ev.button === 1) { this.drag = { type: 'pan' }; this.el.vp.classList.add('panning'); return; }
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
    if (pr.type === 'point') { this.lastPoint = p; this.print(`${this.promptText(pr)} ${fmtNum(p.x, 4)},${fmtNum(p.y, 4)}`, 'echo'); this.advance(p); return; }
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
    const e = this.pick(sx, sy);
    if (!e) return;
    if (['text', 'mtext', 'leader', 'dim'].includes(e.type)) { this.win = null; this.runCommand('TEXTEDIT', { id: e.id }); }
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
    const fkeys = { F1: () => this.showHelp(), F2: () => this.expandHistory(), F3: () => this.toggle('osnap'), F7: () => this.toggle('grid'), F8: () => this.toggle('ortho'), F9: () => this.toggle('snap'), F12: () => this.toggle('dyn') };
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
    document.getElementById('edhint').textContent = pr.multiline ? 'Enter = new line · Ctrl+Enter or click outside = OK · Esc = cancel' : 'Enter = OK (empty line ends) · Esc = cancel';
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
    ev.stopPropagation();
  },
  submitEditor() {
    if (!this.cmd || this.cmd.prompt.type !== 'textedit') return;
    const v = this.el.edText.value;
    this.closeEditor();
    if (v) this.print(`Text: ${v.replace(/\n/g, ' ⏎ ')}`, 'echo');
    this.el.input.focus();
    this.advance(v);
  },
  closeEditor() { this.el.editor.classList.remove('open'); this._edPr = null; },

  /* ===================== toggles & panels ===================== */
  toggle(k) {
    this.settings[k] = !this.settings[k];
    const names = { grid: 'Grid', snap: 'Snap', ortho: 'Ortho', osnap: 'Osnap', dyn: 'Dynamic input' };
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
    document.title = `${this.doc.name} — BananaCAD`;
    this.refreshProps();
  },
  refreshProps() {
    const body = document.getElementById('panelbody');
    if (!body || document.body.classList.contains('noside')) return;
    if (this.panel === 'layers') this.buildLayers(body);
    else if (this.panel === 'settings') this.buildSettings(body);
    else this.buildProps(body);
  },

  buildProps(body) {
    body.innerHTML = '';
    const ids = this.selectedIds();
    const h = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
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
    const apply = (fn) => { this.pushUndoNow(); ents.forEach(fn); this.changed(); this.refreshUI(); };
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
    const num = (label, get, set, ro) => {
      const i = h('input'); i.type = 'number'; i.step = 'any'; i.value = +(+get()).toFixed(6);
      if (ro) i.readOnly = true; else i.onchange = () => { const v = parseFloat(i.value); if (!isNaN(v)) apply((e) => set(e, v)); };
      row(label, i);
    };
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
          num('Height', () => e.h, (o, v) => v > 0 && (o.h = v));
          num('Rotation', () => G.normAng(e.rot || 0) / DEG, (o, v) => (o.rot = v * DEG));
          { const s = h('select'); ['left', 'center', 'right'].forEach((a) => { const o = h('option', null, a); o.value = a; s.appendChild(o); }); s.value = e.align || 'left'; s.onchange = () => apply((o) => (o.align = s.value)); row('Justify', s); }
          num('Position X', () => e.p.x, (o, v) => (o.p.x = v)); num('Position Y', () => e.p.y, (o, v) => (o.p.y = v));
          break;
        case 'mtext':
          txt('Contents', () => e.text, (o, v) => (o.text = v), true);
          num('Height', () => e.h, (o, v) => v > 0 && (o.h = v));
          num('Width (0=no wrap)', () => e.width || 0, (o, v) => v >= 0 && (o.width = v));
          num('Rotation', () => G.normAng(e.rot || 0) / DEG, (o, v) => (o.rot = v * DEG));
          break;
        case 'leader':
          txt('Note text', () => e.text, (o, v) => (o.text = v), true);
          num('Text height', () => e.h, (o, v) => v > 0 && (o.h = v));
          break;
        case 'dim':
          txt('Text override (<> = value)', () => e.text || '', (o, v) => (o.text = v === '<>' ? '' : v));
          num('Dim scale', () => e.scale || 1, (o, v) => { if (v > 0) { o.scale = v; o.h = 2.5 * v; } });
          num('Text height', () => e.h, (o, v) => v > 0 && (o.h = v));
          break;
        case 'revcloud':
          num('Arc length', () => e.arc, (o, v) => v > 0 && (o.arc = v));
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
    tbl.innerHTML = '<tr><th title="Current">Cur</th><th>Name</th><th title="On/Off">On</th><th title="Locked">Lock</th><th>Color</th><th>Linetype</th><th></th></tr>';
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
      const col = document.createElement('input'); col.type = 'color'; col.value = l.color;
      col.onchange = () => { this.pushUndoNow(); l.color = col.value; this.changed(); this.refreshUI(); }; td().appendChild(col);
      const lt = document.createElement('select');
      Object.keys(LINETYPES).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = k; lt.appendChild(o); });
      lt.value = l.linetype || 'Continuous';
      lt.onchange = () => { this.pushUndoNow(); l.linetype = lt.value; this.changed(); }; td().appendChild(lt);
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
    num('Grid spacing', () => s.gridSize, (v) => v > 0 && (s.gridSize = v));
    num('Snap spacing', () => s.snapSize, (v) => v > 0 && (s.snapSize = v));
    num('Text height', () => d.textSize, (v) => v > 0 && (d.textSize = v));
    num('Dimension scale', () => d.dimScale, (v) => v > 0 && (d.dimScale = v));
    num('Dimension decimals', () => d.dimDec, (v) => (d.dimDec = Math.round(Math.min(8, v))));
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
        ['Draw', ['LINE', 'PLINE', 'RECTANG', 'CIRCLE', 'ARC', 'POLYGON', 'ELLIPSE', 'HATCH', 'REVCLOUD']],
        ['Annotate / comments', ['TEXT', 'MTEXT', 'MLEADER', 'TEXTEDIT', 'DIMLINEAR', 'DIMALIGNED', 'DIMRADIUS', 'DIMDIAMETER']],
        ['Modify', ['ERASE', 'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'ARRAY', 'EXPLODE', 'MATCHPROP']],
        ['Inquiry & view', ['DIST', 'AREA', 'ID', 'LIST', 'ZOOM', 'PAN', 'REGEN']],
        ['Settings', ['LAYER', '-LAYER', 'COLOR', 'TEXTSIZE', 'DIMSCALE', 'DIMDEC', 'GRID', 'SNAP', 'ORTHO', 'OSNAP']],
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
    this.doc = newDoc(); this.sel.clear(); this.undoStack = []; this.redoStack = []; this.index = null;
    this.view = { cx: 210, cy: 148, scale: Math.max(0.5, (this.W - 40) / 440) };
    this.changed(); this.refreshUI(); this.print('New drawing.');
  },
  saveFile() {
    const data = JSON.stringify({ app: 'BananaCAD', version: 1, doc: this.doc }, null, 1);
    IO.download(`${this.doc.name}.bcad`, data, 'application/json');
    this.print(`Saved "${this.doc.name}.bcad" to your downloads.`);
  },
  openFile() { this.el.file.value = ''; this.el.file.click(); },
  onFile() {
    const f = this.el.file.files[0];
    if (!f) return;
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
        for (const l of r.layers) { const ex = d.layers.find((x) => x.name === l.name); if (ex) Object.assign(ex, l); else d.layers.push(l); }
        for (const e of r.entities) { if (!d.layers.find((l) => l.name === e.layer)) d.layers.push({ name: e.layer, color: '#ffffff', visible: true, locked: false, linetype: 'Continuous' }); e.id = d.nextId++; d.entities.push(e); }
        this.doc = d;
        this.print(`Imported ${r.entities.length} objects from "${name}".`);
        const sk = Object.entries(r.skipped);
        if (sk.length) this.print(`Skipped unsupported DXF entities: ${sk.map(([k, v]) => `${k}×${v}`).join(', ')}`);
      } else {
        const o = JSON.parse(text);
        const d = o.doc || o;
        if (!Array.isArray(d.entities)) throw new Error('Not a BananaCAD drawing.');
        this.doc = Object.assign(newDoc(), d);
        this.doc.name = this.doc.name || base;
        this.print(`Opened "${name}" (${this.doc.entities.length} objects).`);
      }
      this.sel.clear(); this.undoStack = []; this.redoStack = []; this.index = null;
      this.changed(); this.refreshUI(); this.zoomExtents();
    } catch (err) { console.error(err); this.print('Could not open file: ' + err.message); }
  },
  exportAs(k) {
    k = String(k).toUpperCase();
    if (k === 'DXF') { IO.download(`${this.doc.name}.dxf`, IO.toDXF(this.doc), 'application/dxf'); this.print(`Exported "${this.doc.name}.dxf" (AutoCAD R12 DXF).`); }
    else if (k === 'SVG') { IO.download(`${this.doc.name}.svg`, Render.toSVG(this.doc), 'image/svg+xml'); this.print(`Exported "${this.doc.name}.svg".`); }
    else if (k === 'PNG') { this.renderPNG().toBlob((b) => { IO.download(`${this.doc.name}.png`, b); this.print(`Exported "${this.doc.name}.png".`); }); }
  },
  renderPNG(maxDim = 3000) {
    const b = Render.extents(this.doc) || { minx: 0, miny: 0, maxx: 100, maxy: 100 };
    const w0 = Math.max(b.maxx - b.minx, 1e-6), h0 = Math.max(b.maxy - b.miny, 1e-6);
    const scale = (maxDim * 0.92) / Math.max(w0, h0);
    const W = Math.round(w0 * scale / 0.92), H = Math.round(h0 * scale / 0.92);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    const st = { ctx, dpr: 1, W, H, view: { cx: (b.minx + b.maxx) / 2, cy: (b.miny + b.maxy) / 2, scale }, doc: this.doc, print: true };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    Render.drawDrawing(st);
    return c;
  },

  /* ===================== drawing ===================== */
  requestRedraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.draw(); });
  },
  draw() {
    const ctx = this.ctx2d, W = this.W, H = this.H, dpr = this.dpr;
    const st = { ctx, dpr, W, H, view: this.view, doc: this.doc };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1f252d'; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (this.settings.grid) this.drawGrid(ctx);
    Render.drawDrawing(st, this.hidden);
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
        Render.drawOps(st, [{ op: 'poly', pts: [base, ms.pt] }], 'rgba(255,255,255,0.55)', { dash: [4, 4] });
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
    this.drawUCS(ctx);
    // osnap marker
    const ms = this.mouse;
    this.el.tip.style.display = 'none';
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
        case 'nea': ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y - r); ctx.lineTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y + r); ctx.closePath(); break;
      }
      ctx.stroke();
      const label = { end: 'Endpoint', mid: 'Midpoint', cen: 'Center', quad: 'Quadrant', int: 'Intersection', perp: 'Perpendicular', ins: 'Insertion', nea: 'Nearest' }[ms.snap.type];
      this.el.tip.textContent = label;
      this.el.tip.style.display = 'block';
      this.el.tip.style.left = s.x + 12 + 'px'; this.el.tip.style.top = s.y - 30 + 'px';
    }
    // crosshair
    if (ms.over && !(pr && pr.type === 'textedit')) {
      const x = Math.round(ms.sx) + 0.5, y = Math.round(ms.sy) + 0.5;
      ctx.strokeStyle = 'rgba(235,240,245,0.75)'; ctx.lineWidth = 1;
      ctx.beginPath();
      const picking = !this.cmd || (pr && (pr.type === 'select' || pr.type === 'entity' || pr.pickbox));
      const gap = picking ? 6 : 0;
      ctx.moveTo(0, y); ctx.lineTo(x - gap, y); ctx.moveTo(x + gap, y); ctx.lineTo(W, y);
      ctx.moveTo(x, 0); ctx.lineTo(x, y - gap); ctx.moveTo(x, y + gap); ctx.lineTo(x, H);
      ctx.stroke();
      if (picking) ctx.strokeRect(x - 5, y - 5, 10, 10);
    }
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
    const groups = [
      ['Draw', [['LINE', 'Line', 'line'], ['PLINE', 'Polyline', 'pline'], ['CIRCLE', 'Circle', 'circle'], ['ARC', 'Arc', 'arc'], ['RECTANG', 'Rectangle', 'rect'], ['POLYGON', 'Polygon', 'polygon'], ['ELLIPSE', 'Ellipse', 'ellipse'], ['HATCH', 'Hatch', 'hatch']]],
      ['Annotate', [['TEXT', 'Text', 'text'], ['MTEXT', 'MText', 'mtext'], ['MLEADER', 'Leader note', 'leader'], ['REVCLOUD', 'Rev cloud', 'cloud'], ['DIMLINEAR', 'Linear', 'dimlin'], ['DIMALIGNED', 'Aligned', 'dimali'], ['DIMRADIUS', 'Radius', 'dimrad'], ['DIMDIAMETER', 'Diameter', 'dimdia']]],
      ['Modify', [['MOVE', 'Move', 'move'], ['COPY', 'Copy', 'copy'], ['ROTATE', 'Rotate', 'rotate'], ['SCALE', 'Scale', 'scale'], ['MIRROR', 'Mirror', 'mirror'], ['OFFSET', 'Offset', 'offset'], ['TRIM', 'Trim', 'trim'], ['EXTEND', 'Extend', 'extend'], ['FILLET', 'Fillet', 'fillet'], ['ARRAY', 'Array', 'array'], ['EXPLODE', 'Explode', 'explode'], ['ERASE', 'Erase', 'erase'], ['MATCHPROP', 'Match', 'match']]],
      ['View & tools', [['ZOOM_E', 'Extents', 'zoomext'], ['ZOOM', 'Window', 'zoomwin'], ['PAN', 'Pan', 'pan'], ['DIST', 'Measure', 'dist'], ['LAYER', 'Layers', 'layers']]],
    ];
    const rb = document.getElementById('ribbon');
    for (const [g, btns] of groups) {
      const grp = document.createElement('div'); grp.className = 'rgroup';
      const row = document.createElement('div'); row.className = 'rbtns';
      for (const [cmd, label, icon] of btns) {
        const b = document.createElement('button');
        b.className = 'rbtn';
        const d = Commands.lookup(cmd);
        b.title = d ? `${d.name}${d.aliases.length ? ' (' + d.aliases.slice(0, 2).join(', ') + ')' : ''} — ${d.desc}` : 'Zoom extents';
        b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[icon] || ''}</svg><span>${label}</span>`;
        b.onmousedown = (ev) => ev.preventDefault();
        b.onclick = () => { if (cmd === 'ZOOM_E') this.zoomExtents(); else this.runCommand(cmd); this.el.input.focus(); };
        row.appendChild(b);
      }
      const t = document.createElement('div'); t.className = 'rtitle'; t.textContent = g;
      grp.append(row, t); rb.appendChild(grp);
    }
    document.querySelectorAll('[data-cmd]').forEach((b) => {
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => { const c = b.dataset.cmd; if (c.startsWith('EXPORT:')) this.runCommand('EXPORT', { format: c.slice(7) }); else this.runCommand(c); this.el.input.focus(); };
      const ic = b.dataset.icon; if (ic) b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24">${ICONS[ic]}</svg>`);
    });
  },
};

/* Printing (PLOT) via hidden iframe with the SVG output. */
App.plot = function () {
  const svg = Render.toSVG(this.doc);
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open();
  d.write(`<!doctype html><html><head><title>${this.doc.name}</title><style>@page{margin:10mm}html,body{margin:0;height:100%}svg{width:100%;height:100%}</style></head><body>${svg.replace(/^<\?xml[^>]*>/, '')}</body></html>`);
  d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1000); }, 250);
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
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7V14M12 17v.5"/>',
};

window.addEventListener('DOMContentLoaded', () => App.init());
