'use strict';
/* AutoCAD-style commands written as generators. Each `yield` is a prompt; the
 * runner (app.js) resumes the generator with the user's answer:
 *   point  -> {x,y} | null (Enter)        distance/number/int/angle -> Number | null
 *   string -> String | null                select -> [ids]
 *   entity -> {e, pt} | null               textedit -> String | null
 *   any prompt with keywords may also return {kw:'Keyword'}.
 * Esc aborts the generator (finally-blocks still run).
 */
const Commands = { list: [], map: new Map() };

function defCmd(name, aliases, desc, fn, flags = {}) {
  const d = { name, aliases, desc, fn, ...flags };
  Commands.list.push(d);
  Commands.map.set(name, d);
  for (const a of aliases) Commands.map.set(a, d);
}
Commands.lookup = (s) => Commands.map.get(String(s).trim().toUpperCase().replace(/^[_.']+/, ''));

/* ---------- prompt helpers ---------- */
const P = {
  point: (msg, o = {}) => ({ type: 'point', msg, ...o }),
  dist: (msg, o = {}) => ({ type: 'distance', msg, ...o }),
  num: (msg, o = {}) => ({ type: 'number', msg, ...o }),
  int: (msg, o = {}) => ({ type: 'int', msg, ...o }),
  angle: (msg, o = {}) => ({ type: 'angle', msg, ...o }),
  str: (msg, o = {}) => ({ type: 'string', msg, ...o }),
  kw: (msg, keywords, o = {}) => ({ type: 'kw', msg, keywords, ...o }),
  ent: (msg, o = {}) => ({ type: 'entity', msg, ...o }),
  text: (o) => ({ type: 'textedit', msg: 'Enter text', ...o }),
};

function* getSel(c, msg = 'Select objects') {
  c.usedSel = true;
  const pre = c.app.selectedIds();
  if (pre.length) { c.print(`${pre.length} found`); return pre; }
  const r = yield { type: 'select', msg };
  return r || [];
}

const rectPts = (a, b) => [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
const isTexty = (e) => ['text', 'mtext', 'leader'].includes(e.type);

/* ======================= DRAW ======================= */
defCmd('LINE', ['L'], 'Draw straight line segments', function* (c) {
  let p1 = yield P.point('Specify first point');
  if (!p1) { if (!c.app.lastPoint) return; p1 = c.app.lastPoint; }
  const start = p1, made = [];
  for (;;) {
    const kws = made.length >= 2 ? ['Close', 'Undo'] : made.length ? ['Undo'] : [];
    const r = yield P.point('Specify next point', { keywords: kws, base: p1, preview: (m) => [{ type: 'line', p1, p2: m }] });
    if (!r) return;
    if (r.kw === 'Undo') { const e = made.pop(); c.remove(e.id); p1 = e.p1; continue; }
    if (r.kw === 'Close') { c.add({ type: 'line', p1, p2: start }); return; }
    made.push(c.add({ type: 'line', p1, p2: r }));
    p1 = r;
  }
});

/* Tangent direction at the end of the last polyline segment. */
function plEndDir(pts, bs) {
  const n = pts.length;
  if (n < 2) return { x: 1, y: 0 };
  const a = pts[n - 2], b = pts[n - 1], bu = bs[n - 2] || 0;
  const ch = G.norm(G.sub(b, a));
  return Math.abs(bu) > 1e-9 ? G.rotate(ch, { x: 0, y: 0 }, 2 * Math.atan(bu)) : ch;
}
/* Bulge of the tangent arc that leaves p in direction dir and ends at q. */
function tangentBulge(p, dir, q) {
  const v = G.sub(q, p);
  if (G.len(v) < 1e-12) return 0;
  const al = Math.atan2(G.cross(dir, v), G.dot(dir, v));
  return Math.tan(al / 2);
}

defCmd('PLINE', ['PL'], 'Polyline: straight and arc segments as one object', function* (c) {
  const p0 = yield P.point('Specify start point');
  if (!p0) return;
  const pts = [p0], bs = [];
  let closed = false, arc = false;
  const curve = (m) => (arc ? tangentBulge(pts[pts.length - 1], plEndDir(pts, bs), m) : 0);
  try {
    for (;;) {
      const last = pts[pts.length - 1];
      const kws = [arc ? 'Line' : 'Arc'];
      if (pts.length >= 2) kws.push('Close');
      if (pts.length >= 2) kws.push('Undo');
      const r = yield P.point(arc ? 'Specify endpoint of arc' : 'Specify next point', { keywords: kws, base: last, rubber: !arc,
        preview: (m) => [{ type: 'pline', pts: [...pts, m], b: [...bs, curve(m), 0], closed: false }] });
      if (!r) return;
      if (r.kw === 'Arc') { arc = true; continue; }
      if (r.kw === 'Line') { arc = false; continue; }
      if (r.kw === 'Undo') { if (pts.length > 1) { pts.pop(); bs.pop(); } continue; }
      if (r.kw === 'Close') { bs.push(curve(pts[0])); closed = true; return; }
      bs.push(curve(r)); pts.push(r);
    }
  } finally {
    if (pts.length >= 2) {
      const b = closed ? bs : [...bs, 0];
      c.add({ type: 'pline', pts, b: b.some((x) => x) ? b : undefined, closed });
    }
  }
});

defCmd('SPLINE', ['SPL'], 'Smooth curve through the points you pick', function* (c) {
  const p0 = yield P.point('Specify first point');
  if (!p0) return;
  const fit = [p0];
  let closed = false;
  try {
    for (;;) {
      const kws = fit.length >= 3 ? ['Close', 'Undo'] : fit.length >= 2 ? ['Undo'] : [];
      const r = yield P.point('Enter next point', { keywords: kws, base: fit[fit.length - 1], rubber: false, preview: (m) => [{ type: 'spline', fit: [...fit, m], closed: false }] });
      if (!r) return;
      if (r.kw === 'Undo') { if (fit.length > 1) fit.pop(); continue; }
      if (r.kw === 'Close') { closed = true; return; }
      fit.push(r);
    }
  } finally {
    if (fit.length >= 2) c.add(fit.length === 2 ? { type: 'line', p1: fit[0], p2: fit[1] } : { type: 'spline', fit, closed });
  }
});

defCmd('RECTANG', ['REC', 'RECTANGLE'], 'Draw a rectangle', function* (c) {
  const p1 = yield P.point('Specify first corner point');
  if (!p1) return;
  for (;;) {
    const r = yield P.point('Specify other corner point', { keywords: ['Dimensions'], base: p1, rubber: false, preview: (m) => [{ type: 'pline', pts: rectPts(p1, m), closed: true }] });
    if (!r) return;
    if (r.kw === 'Dimensions') {
      const w = yield P.dist('Specify length for rectangles', { def: c.doc.rectW || 10 });
      if (w == null) return;
      const h = yield P.dist('Specify width for rectangles', { def: c.doc.rectH || 10 });
      if (h == null) return;
      c.doc.rectW = w; c.doc.rectH = h;
      const corner = (m) => ({ x: p1.x + (m.x >= p1.x ? w : -w), y: p1.y + (m.y >= p1.y ? h : -h) });
      const q = yield P.point('Specify other corner point (pick direction)', { base: p1, rubber: false, preview: (m) => [{ type: 'pline', pts: rectPts(p1, corner(m)), closed: true }] });
      if (!q) return;
      c.add({ type: 'pline', pts: rectPts(p1, corner(q)), closed: true });
      return;
    }
    c.add({ type: 'pline', pts: rectPts(p1, r), closed: true });
    return;
  }
});

defCmd('CIRCLE', ['C'], 'Draw a circle', function* (c) {
  const r0 = yield P.point('Specify center point for circle', { keywords: ['3P', '2P'] });
  if (!r0) return;
  if (r0.kw === '2P') {
    const a = yield P.point('Specify first end point of circle\'s diameter'); if (!a) return;
    const b = yield P.point('Specify second end point of circle\'s diameter', { base: a, preview: (m) => [{ type: 'circle', c: G.mid(a, m), r: G.dist(a, m) / 2 }] });
    if (!b) return;
    c.add({ type: 'circle', c: G.mid(a, b), r: G.dist(a, b) / 2 }); return;
  }
  if (r0.kw === '3P') {
    const a = yield P.point('Specify first point on circle'); if (!a) return;
    const b = yield P.point('Specify second point on circle', { base: a }); if (!b) return;
    const q = yield P.point('Specify third point on circle', { rubber: false, preview: (m) => { const k = G.arc3(a, b, m); return k ? [{ type: 'circle', c: k.c, r: k.r }] : []; } });
    if (!q) return;
    const k = G.arc3(a, b, q);
    if (!k) { c.print('Points are collinear.'); return; }
    c.add({ type: 'circle', c: k.c, r: k.r }); return;
  }
  const ctr = r0;
  let r = yield P.dist('Specify radius of circle', { keywords: ['Diameter'], base: ctr, def: c.doc.lastRadius, preview: (m) => [{ type: 'circle', c: ctr, r: G.dist(ctr, m) }] });
  if (r && r.kw === 'Diameter') {
    const d = yield P.dist('Specify diameter of circle', { base: ctr, def: c.doc.lastRadius ? c.doc.lastRadius * 2 : undefined, preview: (m) => [{ type: 'circle', c: ctr, r: G.dist(ctr, m) / 2 }] });
    if (d == null) return;
    r = d / 2;
  }
  if (r == null || !(r > 0)) return;
  c.doc.lastRadius = r;
  c.add({ type: 'circle', c: ctr, r });
});

defCmd('ARC', ['A'], 'Draw an arc (3 points, or center/start/end)', function* (c) {
  const r0 = yield P.point('Specify start point of arc', { keywords: ['Center'] });
  if (!r0) return;
  if (r0.kw === 'Center') {
    const ctr = yield P.point('Specify center point of arc'); if (!ctr) return;
    const s = yield P.point('Specify start point of arc', { base: ctr }); if (!s) return;
    const rad = G.dist(ctr, s), a1 = G.angle(ctr, s);
    const e = yield P.point('Specify end point of arc (counter-clockwise)', { base: ctr, preview: (m) => [{ type: 'arc', c: ctr, r: rad, a1, a2: G.angle(ctr, m) }] });
    if (!e) return;
    c.add({ type: 'arc', c: ctr, r: rad, a1, a2: G.angle(ctr, e) }); return;
  }
  const p1 = r0;
  const p2 = yield P.point('Specify second point of arc', { base: p1 }); if (!p2) return;
  const p3 = yield P.point('Specify end point of arc', { rubber: false, preview: (m) => { const k = G.arc3(p1, p2, m); return k ? [{ type: 'arc', ...k }] : [{ type: 'line', p1, p2: m }]; } });
  if (!p3) return;
  const k = G.arc3(p1, p2, p3);
  if (!k) { c.print('Points are collinear.'); return; }
  c.add({ type: 'arc', ...k });
});

defCmd('POLYGON', ['POL'], 'Draw a regular polygon', function* (c) {
  const n = yield P.int('Enter number of sides', { def: c.doc.polySides || 4 });
  if (n == null) return;
  if (n < 3 || n > 1024) { c.print('Requires an integer between 3 and 1024.'); return; }
  c.doc.polySides = n;
  const r0 = yield P.point('Specify center of polygon', { keywords: ['Edge'] });
  if (!r0) return;
  if (r0.kw === 'Edge') {
    const a = yield P.point('Specify first endpoint of edge'); if (!a) return;
    const mk = (b) => { const pts = [a, b]; const ext = TAU / n; let ang = G.angle(a, b), cur = b; const L = G.dist(a, b); for (let i = 2; i < n; i++) { ang += ext; cur = G.polar(cur, ang, L); pts.push(cur); } return pts; };
    const b = yield P.point('Specify second endpoint of edge', { base: a, preview: (m) => [{ type: 'pline', pts: mk(m), closed: true }] });
    if (!b) return;
    c.add({ type: 'pline', pts: mk(b), closed: true }); return;
  }
  const ctr = r0;
  const m0 = yield P.kw('Enter an option', ['Inscribed', 'Circumscribed'], { def: c.doc.polyMode || 'Inscribed' });
  if (m0 == null) return;
  const mode = m0.kw || m0;
  c.doc.polyMode = mode;
  const mk = (rad, ang) => {
    const R = mode === 'Circumscribed' ? rad / Math.cos(Math.PI / n) : rad;
    const a0 = mode === 'Circumscribed' ? ang + Math.PI / n : ang;
    return Array.from({ length: n }, (_, i) => G.polar(ctr, a0 + (i * TAU) / n, R));
  };
  const r = yield P.point('Specify radius of circle', { base: ctr, preview: (m) => [{ type: 'pline', pts: mk(G.dist(ctr, m), G.angle(ctr, m) - (mode === 'Circumscribed' ? Math.PI / n : 0)), closed: true }], allowNumber: true });
  if (!r) return;
  if (typeof r.num === 'number') c.add({ type: 'pline', pts: mk(r.num, -Math.PI / 2 + (mode === 'Circumscribed' ? 0 : Math.PI / n)), closed: true });
  else c.add({ type: 'pline', pts: mk(G.dist(ctr, r), G.angle(ctr, r) - (mode === 'Circumscribed' ? Math.PI / n : 0)), closed: true });
});

defCmd('ELLIPSE', ['EL'], 'Draw an ellipse', function* (c) {
  const r0 = yield P.point('Specify axis endpoint of ellipse', { keywords: ['Center'] });
  if (!r0) return;
  let ctr, maj;
  if (r0.kw === 'Center') {
    ctr = yield P.point('Specify center of ellipse'); if (!ctr) return;
    const a = yield P.point('Specify endpoint of axis', { base: ctr }); if (!a) return;
    maj = G.sub(a, ctr);
  } else {
    const b = yield P.point('Specify other endpoint of axis', { base: r0 }); if (!b) return;
    ctr = G.mid(r0, b); maj = G.sub(b, ctr);
  }
  const L = G.len(maj);
  if (L < 1e-9) return;
  const mk = (d) => { let e = { type: 'ellipse', c: ctr, maj, ratio: d / L }; if (e.ratio > 1) e = { type: 'ellipse', c: ctr, maj: G.mul(G.norm(G.perp(maj)), d), ratio: L / d }; return e; };
  const d = yield P.dist('Specify distance to other axis', { base: ctr, preview: (m) => [mk(Math.max(1e-9, Math.abs(G.dot(G.sub(m, ctr), G.norm(G.perp(maj))))))], project: (m) => Math.abs(G.dot(G.sub(m, ctr), G.norm(G.perp(maj)))) });
  if (d == null || !(d > 0)) return;
  c.add(mk(d));
});

/* Region detection: the smallest face of the planar graph formed by all visible
 * geometry that contains p (lines, arcs, polylines… need not be closed shapes). */
function findRegion(c, p) {
  const segs = [];
  for (const e of c.app.visibleEntities()) {
    if (['hatch', 'text', 'mtext', 'dim', 'leader'].includes(e.type)) continue;
    for (const pr of E.prims(e)) {
      if (pr.kind === 'seg') { if (pr.len > 1e-12) segs.push([pr.a, pr.b]); continue; }
      const n = Math.max(8, Math.ceil(pr.sweep / (4 * DEG)));
      let prev = G.polar(pr.c, pr.a1, pr.r);
      for (let k = 1; k <= n; k++) { const q = G.polar(pr.c, pr.a1 + (pr.sweep * k) / n, pr.r); segs.push([prev, q]); prev = q; }
    }
  }
  if (!segs.length || segs.length > 60000) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [a, b] of segs) for (const q of [a, b]) { minx = Math.min(minx, q.x); miny = Math.min(miny, q.y); maxx = Math.max(maxx, q.x); maxy = Math.max(maxy, q.y); }
  const diag = Math.hypot(maxx - minx, maxy - miny) || 1;
  // spatial grid for intersection tests
  const cell = Math.max(diag / Math.sqrt(segs.length) * 2, 1e-9), grid = new Map();
  const ts = segs.map(() => [0, 1]);
  segs.forEach(([a, b], i) => {
    const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell), y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x + ',' + y; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i); }
  });
  const tested = new Set();
  for (const list of grid.values()) for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
    const i = Math.min(list[u], list[v]), j = Math.max(list[u], list[v]), key = i * 1e6 + j;
    if (tested.has(key)) continue;
    tested.add(key);
    const [a, b] = segs[i], [cc, dd] = segs[j];
    for (const h of G.segSeg(a, b, cc, dd)) { ts[i].push(G.clamp(h.t, 0, 1)); ts[j].push(G.clamp(h.u, 0, 1)); }
  }
  const q = diag * 1e-8;
  const verts = new Map(), pos = [];
  const vid = (pt) => { const k = Math.round(pt.x / q) + ',' + Math.round(pt.y / q); let id = verts.get(k); if (id === undefined) { id = pos.length; verts.set(k, id); pos.push(pt); } return id; };
  const adj = new Map(), edges = new Set();
  const link = (u, v) => { if (u === v) return; const k = u < v ? u + ':' + v : v + ':' + u; if (edges.has(k)) return; edges.add(k); for (const [x, y] of [[u, v], [v, u]]) { let l = adj.get(x); if (!l) adj.set(x, (l = [])); l.push(y); } };
  segs.forEach(([a, b], i) => {
    const t = [...new Set(ts[i])].sort((x, y) => x - y);
    let prev = vid(G.lerp(a, b, t[0]));
    for (let k = 1; k < t.length; k++) { const cur = vid(G.lerp(a, b, t[k])); link(prev, cur); prev = cur; }
  });
  for (const [v, l] of adj) l.sort((x, y) => G.angle(pos[v], pos[x]) - G.angle(pos[v], pos[y]));
  // first edge hit by a ray from p towards +x
  let best = null, bx = Infinity;
  for (const k of edges) {
    const [u, v] = k.split(':').map(Number), a = pos[u], b = pos[v];
    if ((a.y > p.y) === (b.y > p.y)) continue;
    const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
    if (x > p.x && x < bx) { bx = x; best = [u, v]; }
  }
  if (!best) return null;
  let [u, v] = best;
  if (G.cross(G.sub(pos[v], pos[u]), G.sub(p, pos[u])) < 0) [u, v] = [v, u];
  const startU = u, startV = v, loop = [];
  for (let steps = 0; steps < 200000; steps++) {
    loop.push(pos[u]);
    const l = adj.get(v), back = l.indexOf(u);
    const w = l[(back - 1 + l.length) % l.length]; // next edge clockwise from the one we came in on
    u = v; v = w;
    if (u === startU && v === startV) break;
  }
  if (loop.length < 3 || G.polyArea(loop) <= 0 || !G.pointInPoly(p, loop)) return null;
  const loops = [loop];
  const area = G.polyArea(loop);
  for (const e of c.app.visibleEntities()) {
    if (e.type === 'hatch') continue;
    const l = E.loop(e);
    if (l && Math.abs(G.polyArea(l)) < area * 0.999 && !G.pointInPoly(p, l) && l.every((pt) => G.pointInPoly(pt, loop))) loops.push(l);
  }
  return loops;
}

function findBoundary(c, p) {
  const cands = [];
  for (const e of c.app.visibleEntities()) {
    if (e.type === 'hatch') continue;
    const l = E.loop(e);
    if (l) cands.push({ e, l, a: Math.abs(G.polyArea(l)) });
  }
  const containing = cands.filter((k) => G.pointInPoly(p, k.l)).sort((a, b) => a.a - b.a);
  if (!containing.length) return null;
  const outer = containing[0];
  const loops = [outer.l];
  for (const k of cands) if (k !== outer && k.a < outer.a && k.l.every((q) => G.pointInPoly(q, outer.l))) loops.push(k.l);
  return loops;
}

defCmd('HATCH', ['H', 'BH', 'BHATCH'], 'Fill a closed area with a hatch pattern', function* (c) {
  const d = c.doc;
  for (;;) {
    c.print(`Current hatch: Pattern=${d.hatchPattern}  Scale=${d.hatchScale}  Angle=${d.hatchAngle}`);
    const r = yield P.point('Pick internal point', { keywords: ['Pattern', 'Scale', 'Angle', 'Select'], pickbox: true });
    if (!r) return;
    if (r.kw === 'Pattern') {
      const s = yield P.str(`Enter pattern name (${Object.keys(HATCH_PATTERNS).join(', ')})`, { def: d.hatchPattern });
      if (s == null) continue;
      const k = s.toUpperCase();
      if (k in HATCH_PATTERNS) d.hatchPattern = k; else c.print(`Unknown pattern "${s}".`);
      continue;
    }
    if (r.kw === 'Scale') { const s = yield P.num('Specify hatch pattern scale', { def: d.hatchScale }); if (s > 0) d.hatchScale = s; continue; }
    if (r.kw === 'Angle') { const s = yield P.num('Specify hatch pattern angle', { def: d.hatchAngle }); if (s != null) d.hatchAngle = s; continue; }
    let loops;
    if (r.kw === 'Select') {
      const s = yield P.ent('Select closed object', { filter: (e) => !!E.loop(e), filterMsg: 'Object must be a closed polyline, circle, ellipse or cloud.' });
      if (!s) continue;
      loops = [E.loop(s.e)];
    } else loops = findRegion(c, r) || findBoundary(c, r);
    if (!loops) { c.print('No closed boundary found around that point. Make sure the area is fully enclosed (lines must meet or cross).'); continue; }
    c.add({ type: 'hatch', loops, pattern: d.hatchPattern, scale: d.hatchScale, angle: d.hatchAngle });
    const pat = HATCH_PATTERNS[d.hatchPattern];
    if (pat && G.hatchSegments(loops, 0, pat[0].sp * d.hatchScale, 3000) === null) c.print('Note: pattern is very dense at this scale — increase the hatch Scale.');
  }
});

defCmd('REVCLOUD', ['RC', 'CLOUD'], 'Draw a revision cloud around an area (markup)', function* (c) {
  const d = c.doc;
  for (;;) {
    c.print(`Arc length: ${d.revArc}`);
    const r = yield P.point('Specify first corner point', { keywords: ['Arc length', 'Object'] });
    if (!r) return;
    if (r.kw === 'Arc length') { const s = yield P.dist('Specify arc length', { def: d.revArc }); if (s > 0) d.revArc = s; continue; }
    if (r.kw === 'Object') {
      const s = yield P.ent('Select object', { filter: (e) => !!E.loop(e) || e.type === 'pline', filterMsg: 'Select a closed polyline, rectangle, circle or ellipse.' });
      if (!s) return;
      let pts = E.loop(s.e) || s.e.pts.slice();
      if (s.e.type === 'circle' || s.e.type === 'ellipse') pts = pts.filter((_, i) => i % 4 === 0);
      c.add({ type: 'revcloud', pts, arc: d.revArc, layer: s.e.layer });
      c.remove(s.e.id);
      return;
    }
    const q = yield P.point('Specify opposite corner', { base: r, rubber: false, preview: (m) => [{ type: 'revcloud', pts: rectPts(r, m), arc: d.revArc }] });
    if (!q) return;
    c.add({ type: 'revcloud', pts: rectPts(r, q), arc: d.revArc });
    return;
  }
});

/* ======================= ANNOTATE ======================= */
defCmd('TEXT', ['DT', 'DTEXT', 'TX'], 'Single-line text (type in place, Enter for next line)', function* (c) {
  const d = c.doc;
  let align = 'left';
  let p;
  for (;;) {
    p = yield P.point('Specify start point of text', { keywords: ['Justify'] });
    if (!p) return;
    if (p.kw === 'Justify') {
      const j = yield P.kw('Enter an option', ['Left', 'Center', 'Right'], { def: 'Left' });
      if (j) align = (j.kw || j).toLowerCase();
      continue;
    }
    break;
  }
  const h = yield P.dist('Specify height', { base: p, def: d.textSize });
  if (h == null || !(h > 0)) return;
  d.textSize = h;
  const rot = yield P.angle('Specify rotation angle of text', { base: p, def: 0 });
  if (rot == null) return;
  const r = rot * DEG;
  for (;;) {
    const t = yield P.text({ at: p, h, rot: r, multiline: false, align });
    if (t == null || t === '') return;
    c.add({ type: 'text', p, h, rot: r, text: t, align, style: d.textStyle });
    p = G.add(p, G.rotate({ x: 0, y: -h * LINE_SPACING }, { x: 0, y: 0 }, r));
  }
});

defCmd('MTEXT', ['T', 'MT'], 'Multiline text / notes in a box', function* (c) {
  const d = c.doc;
  const p1 = yield P.point('Specify first corner');
  if (!p1) return;
  let p2;
  for (;;) {
    c.print(`Current text height: ${d.textSize}`);
    p2 = yield P.point('Specify opposite corner', { keywords: ['Height'], base: p1, rubber: false, preview: (m) => [{ type: 'pline', pts: rectPts(p1, m), closed: true }] });
    if (!p2) return;
    if (p2.kw === 'Height') { const h = yield P.dist('Specify height', { def: d.textSize }); if (h > 0) d.textSize = h; continue; }
    break;
  }
  const at = { x: Math.min(p1.x, p2.x), y: Math.max(p1.y, p2.y) };
  const width = Math.abs(p2.x - p1.x);
  const t = yield P.text({ at, h: d.textSize, rot: 0, multiline: true, width });
  if (!t) return;
  c.add({ type: 'mtext', p: at, h: d.textSize, rot: 0, width, text: t, style: d.textStyle });
});

defCmd('MLEADER', ['MLD', 'LE', 'LEADER', 'QLEADER', 'NOTE', 'COMMENT'], 'Leader with a note/comment (arrow + text)', function* (c) {
  const d = c.doc;
  const p0 = yield P.point('Specify leader arrowhead location');
  if (!p0) return;
  const pts = [p0];
  const mk = (extra) => ({ type: 'leader', pts: extra ? [...pts, extra] : pts.slice(), h: d.textSize, text: '' });
  for (;;) {
    const r = yield P.point(pts.length === 1 ? 'Specify leader landing location' : 'Specify next point (Enter to type note)', { base: pts[pts.length - 1], rubber: false, preview: (m) => [mk(m)] });
    if (!r) { if (pts.length >= 2) break; return; }
    pts.push(r);
    if (pts.length >= 2 && !c.app.settings.leaderMulti) break;
  }
  const g = E.leaderGeom(mk());
  const t = yield P.text({ at: { x: g.tx, y: g.firstBase + d.textSize }, h: d.textSize, rot: 0, multiline: true, align: g.dir > 0 ? 'left' : 'right', previewEnt: mk() });
  if (t == null || t === '') { c.print('Leader cancelled (no text).'); return; }
  c.add({ type: 'leader', pts, h: d.textSize, text: t, style: d.textStyle });
});

function autoDirAng(p1, p2, m) {
  const minx = Math.min(p1.x, p2.x), maxx = Math.max(p1.x, p2.x), miny = Math.min(p1.y, p2.y), maxy = Math.max(p1.y, p2.y);
  if (m.x >= minx && m.x <= maxx) return 0;
  if (m.y >= miny && m.y <= maxy) return Math.PI / 2;
  const dx = Math.min(Math.abs(m.x - minx), Math.abs(m.x - maxx)), dy = Math.min(Math.abs(m.y - miny), Math.abs(m.y - maxy));
  return dx > dy ? Math.PI / 2 : 0;
}

function* dimCmd(c, kind) {
  const d = c.doc;
  const p1 = yield P.point('Specify first extension line origin');
  if (!p1) return;
  const r1 = c.app.takeSnapRef();
  const p2 = yield P.point('Specify second extension line origin', { base: p1 });
  if (!p2) return;
  const r2 = c.app.takeSnapRef();
  let text = '', fixed = null;
  const mk = (m) => ({ type: 'dim', kind, p1, p2, pos: m, dirAng: fixed != null ? fixed : autoDirAng(p1, p2, m), dimstyle: d.dimStyle, text });
  for (;;) {
    const kws = kind === 'linear' ? ['Text', 'Horizontal', 'Vertical', 'Rotated'] : ['Text'];
    const r = yield P.point('Specify dimension line location', { keywords: kws, rubber: false, preview: (m) => [mk(m)] });
    if (!r) return;
    if (r.kw === 'Text') { const t = yield P.str('Enter dimension text (<> = measured value)', { def: '<>', spaces: true }); if (t != null) text = t === '<>' ? '' : t; continue; }
    if (r.kw === 'Horizontal') { fixed = 0; continue; }
    if (r.kw === 'Vertical') { fixed = Math.PI / 2; continue; }
    if (r.kw === 'Rotated') { const a = yield P.angle('Specify angle of dimension line', { def: 0 }); if (a != null) fixed = a * DEG; continue; }
    const e = c.add(mk(r));
    setAssoc(e, { p1: r1, p2: r2 });
    d.lastDimId = e.id;
    const meas = kind === 'aligned' ? G.dist(p1, p2) : Math.abs(G.dot(G.sub(p2, p1), { x: Math.cos(e.dirAng), y: Math.sin(e.dirAng) }));
    c.print(`Dimension text = ${fmtNum(meas, E.dstyle(e).dec)}`);
    return;
  }
}
function setAssoc(e, refs) {
  const a = {};
  for (const [k, v] of Object.entries(refs)) if (v) a[k] = v;
  if (Object.keys(a).length) e.assoc = a;
}
defCmd('DIMLINEAR', ['DLI', 'DIMLIN'], 'Horizontal / vertical dimension', (c) => dimCmd(c, 'linear'));
defCmd('DIMALIGNED', ['DAL', 'DIMALI'], 'Aligned dimension', (c) => dimCmd(c, 'aligned'));

function* dimRadCmd(c, kind) {
  const d = c.doc;
  const s = yield P.ent(`Select arc or circle`, { filter: (e) => e.type === 'circle' || e.type === 'arc', filterMsg: 'Object must be an arc or circle.' });
  if (!s) return;
  let text = '';
  const mk = (m) => ({ type: 'dim', kind, c: { ...s.e.c }, r: s.e.r, pos: m, dimstyle: d.dimStyle, text });
  for (;;) {
    const r = yield P.point('Specify dimension line location', { keywords: ['Text'], rubber: false, preview: (m) => [mk(m)] });
    if (!r) return;
    if (r.kw === 'Text') { const t = yield P.str('Enter dimension text (<> = measured value)', { def: '<>', spaces: true }); if (t != null) text = t === '<>' ? '' : t; continue; }
    const e = c.add(mk(r));
    e.assoc = { circ: s.e.id };
    c.print(`Dimension text = ${fmtNum(kind === 'radius' ? s.e.r : 2 * s.e.r, E.dstyle(e).dec)}`);
    return;
  }
}
defCmd('DIMRADIUS', ['DRA', 'DIMRAD'], 'Radius dimension', (c) => dimRadCmd(c, 'radius'));
defCmd('DIMDIAMETER', ['DDI', 'DIMDIA'], 'Diameter dimension', (c) => dimRadCmd(c, 'diameter'));

defCmd('TEXTEDIT', ['ED', 'DDEDIT'], 'Edit text, note, leader or dimension text', function* (c, opts) {
  const once = !!(opts && opts.id);
  for (;;) {
    let e;
    if (once) e = c.get(opts.id);
    else {
      const s = yield P.ent('Select an annotation object', { filter: (x) => isTexty(x) || x.type === 'dim', filterMsg: 'Select text, mtext, a leader or a dimension.' });
      if (!s) return;
      e = s.e;
    }
    if (!e) return;
    if (e.type === 'dim') {
      const t = yield P.str('Enter new dimension text (<> = measured value)', { def: e.text || '<>', spaces: true });
      if (t != null) { e.text = t === '<>' ? '' : t; c.changed(); }
      if (once) return;
      continue;
    }
    let at = e.p, align = e.align || 'left';
    if (e.type === 'leader') { const g = E.leaderGeom(e); at = { x: g.tx, y: g.firstBase + e.h }; align = g.dir > 0 ? 'left' : 'right'; }
    let t;
    try {
      c.app.hidden = new Set([e.id]);
      t = yield P.text({ at, h: e.h, rot: e.rot || 0, multiline: e.type !== 'text', width: e.width || 0, initial: e.text, align });
    } finally { c.app.hidden = null; }
    if (t != null && t !== '') { e.text = t; c.changed(); }
    if (once) return;
  }
});

/* ======================= MODIFY ======================= */
defCmd('ERASE', ['E', 'DELETE'], 'Delete objects', function* (c) {
  const ids = yield* getSel(c);
  ids.forEach((id) => c.remove(id));
  if (ids.length) c.print(`${ids.length} object(s) erased.`);
}, { sel: true });

function ghost(c, ids, xf) { return ids.map((id) => c.get(id)).filter(Boolean).map((e) => E.transformed(e, xf)); }

defCmd('MOVE', ['M'], 'Move objects', function* (c) {
  const ids = yield* getSel(c); if (!ids.length) return;
  const base = yield P.point('Specify base point'); if (!base) return;
  const to = yield P.point('Specify second point', { base, preview: (m) => ghost(c, ids, XF.move(G.sub(m, base))) });
  if (!to) return;
  const xf = XF.move(G.sub(to, base));
  ids.forEach((id) => E.transform(c.get(id), xf)); c.changed();
}, { sel: true });

defCmd('COPY', ['CO', 'CP'], 'Copy objects (repeat until Enter)', function* (c) {
  const ids = yield* getSel(c); if (!ids.length) return;
  const base = yield P.point('Specify base point'); if (!base) return;
  for (;;) {
    const to = yield P.point('Specify second point (Enter to finish)', { base, preview: (m) => ghost(c, ids, XF.move(G.sub(m, base))) });
    if (!to) return;
    const xf = XF.move(G.sub(to, base));
    ids.forEach((id) => { const n = E.transformed(c.get(id), xf); delete n.id; c.add(n, true); });
  }
}, { sel: true });

defCmd('ROTATE', ['RO'], 'Rotate objects about a base point', function* (c) {
  const ids = yield* getSel(c); if (!ids.length) return;
  const base = yield P.point('Specify base point'); if (!base) return;
  let copy = false, refAng = 0;
  for (;;) {
    const r = yield P.angle('Specify rotation angle', { keywords: ['Copy', 'Reference'], base, def: c.doc.lastRot || 0, preview: (m) => ghost(c, ids, XF.rotate(base, G.angle(base, m) - refAng)) });
    if (r == null) return;
    if (r.kw === 'Copy') { copy = true; c.print('Rotating a copy of the selected objects.'); continue; }
    if (r.kw === 'Reference') { const a = yield P.angle('Specify the reference angle', { def: 0 }); if (a != null) refAng = a * DEG; continue; }
    const ang = r * DEG - refAng;
    c.doc.lastRot = r;
    const xf = XF.rotate(base, ang);
    ids.forEach((id) => { if (copy) { const n = E.transformed(c.get(id), xf); delete n.id; c.add(n, true); } else E.transform(c.get(id), xf); });
    c.changed(); return;
  }
}, { sel: true });

defCmd('SCALE', ['SC'], 'Scale objects about a base point', function* (c) {
  const ids = yield* getSel(c); if (!ids.length) return;
  const base = yield P.point('Specify base point'); if (!base) return;
  let copy = false;
  for (;;) {
    const r = yield P.dist('Specify scale factor', { keywords: ['Copy', 'Reference'], base, def: 1, preview: (m) => { const f = G.dist(base, m); return f > 1e-9 ? ghost(c, ids, XF.scale(base, f)) : []; } });
    if (r == null) return;
    if (r.kw === 'Copy') { copy = true; c.print('Scaling a copy of the selected objects.'); continue; }
    let f = r;
    if (r.kw === 'Reference') {
      const a = yield P.dist('Specify reference length', { def: 1 }); if (!(a > 0)) return;
      const b = yield P.dist('Specify new length'); if (!(b > 0)) return;
      f = b / a;
    }
    if (!(f > 0)) { c.print('Scale factor must be positive.'); continue; }
    const xf = XF.scale(base, f);
    ids.forEach((id) => { if (copy) { const n = E.transformed(c.get(id), xf); delete n.id; c.add(n, true); } else E.transform(c.get(id), xf); });
    c.changed(); return;
  }
}, { sel: true });

defCmd('MIRROR', ['MI'], 'Mirror objects across a line', function* (c) {
  const ids = yield* getSel(c); if (!ids.length) return;
  const a = yield P.point('Specify first point of mirror line'); if (!a) return;
  const b = yield P.point('Specify second point of mirror line', { base: a, preview: (m) => (G.dist(a, m) > 1e-9 ? ghost(c, ids, XF.mirror(a, m)) : []) });
  if (!b || G.dist(a, b) < 1e-12) return;
  const k = yield P.kw('Erase source objects?', ['Yes', 'No'], { def: 'No' });
  if (k == null) return;
  const erase = (k.kw || k) === 'Yes';
  const xf = XF.mirror(a, b);
  ids.forEach((id) => { if (erase) E.transform(c.get(id), xf); else { const n = E.transformed(c.get(id), xf); delete n.id; c.add(n, true); } });
  c.changed();
}, { sel: true });

defCmd('OFFSET', ['O'], 'Create parallel copies (offset) of lines, arcs, circles, polylines', function* (c) {
  const d = c.doc;
  const r = yield P.dist('Specify offset distance', { keywords: ['Through'], def: d.offsetDist });
  if (r == null) return;
  const through = r.kw === 'Through';
  if (!through) { if (!(r > 0)) return; d.offsetDist = r; }
  const ok = (e) => ['line', 'pline', 'circle', 'arc', 'ellipse'].includes(e.type);
  for (;;) {
    const s = yield P.ent('Select object to offset (Enter to exit)', { filter: ok, filterMsg: 'Cannot offset that object.' });
    if (!s) return;
    const dist = (m) => (through ? E.hitDist(s.e, m, 0, d) : d.offsetDist);
    const side = yield P.point(through ? 'Specify through point' : 'Specify point on side to offset', { preview: (m) => { const o = E.offset(s.e, dist(m), m); return o ? [o] : []; } });
    if (!side) return;
    const o = E.offset(s.e, dist(side), side);
    if (o) c.add(o, true); else c.print('Cannot offset that far.');
  }
});

/* Intersections of entity e with every other visible curve (params along e). */
function cutParams(c, e) {
  const own = E.prims(e), out = [];
  for (const f of c.app.visibleEntities()) {
    if (f.id === e.id) continue;
    const fp = E.prims(f);
    if (!fp.length) continue;
    for (const p of own) for (const q of fp) for (const h of G.primIntersect(p, q)) out.push(h.sp);
  }
  return out.sort((a, b) => a - b);
}

function trimEntity(c, e, pick) {
  if (!E.isCurve(e)) { c.print('Only lines, arcs, circles and polylines can be trimmed.'); return false; }
  const L = E.length(e), eps = Math.max(1e-9, L * 1e-9);
  const sp = E.paramAt(e, pick).s;
  const closed = E.isClosed(e);
  let S = cutParams(c, e);
  if (!closed) S = S.filter((s) => s > eps && s < L - eps);
  S = S.filter((s, i) => i === 0 || s - S[i - 1] > eps);
  if (!S.length) { c.remove(e.id); return true; }
  const pieces = [];
  if (!closed) {
    const lo = S.filter((s) => s < sp).pop();
    const hi = S.find((s) => s > sp);
    if (lo !== undefined) pieces.push(E.sub(e, 0, lo));
    if (hi !== undefined) pieces.push(E.sub(e, hi, L));
  } else {
    if (S.length < 2) { c.print('Need at least two cutting intersections to trim a closed object.'); return false; }
    let lo = S.filter((s) => s < sp).pop(); if (lo === undefined) lo = S[S.length - 1];
    let hi = S.find((s) => s > sp); if (hi === undefined) hi = S[0];
    pieces.push(E.sub(e, hi, lo));
  }
  c.remove(e.id);
  for (const p of pieces) if (p && E.length(p) > eps) c.add(p, true);
  return true;
}

function extendEntity(c, e, pick) {
  const all = c.app.visibleEntities().filter((f) => f.id !== e.id).flatMap((f) => E.prims(f));
  if (e.type === 'line' || (e.type === 'pline' && !e.closed)) {
    const pts = e.type === 'line' ? [e.p1, e.p2] : e.pts;
    const L = E.length(e), sp = E.paramAt(e, pick).s;
    const atEnd = sp > L / 2;
    if (e.type === 'pline' && e.b && Math.abs(e.b[atEnd ? e.pts.length - 2 : 0] || 0) > 1e-9) { c.print('The end segment is an arc; only straight ends can be extended.'); return false; }
    const tip = atEnd ? pts[pts.length - 1] : pts[0], prev = atEnd ? pts[pts.length - 2] : pts[1];
    const dir = G.norm(G.sub(tip, prev));
    let best = Infinity;
    for (const pr of all) {
      if (pr.kind === 'seg') for (const h of G.segSeg(tip, G.add(tip, dir), pr.a, pr.b, true, false)) { if (h.t > 1e-9 && h.t < best) best = h.t; }
      else for (const h of G.lineCircle(tip, G.add(tip, dir), pr.c, pr.r)) { if (h.t > 1e-9 && h.t < best && G.onArc(pr, G.arcTheta(pr, h))) best = h.t; }
    }
    if (!isFinite(best)) { c.print('Object does not intersect an edge.'); return false; }
    const np = G.add(tip, G.mul(dir, best));
    if (e.type === 'line') { if (atEnd) e.p2 = np; else e.p1 = np; } else { if (atEnd) e.pts[e.pts.length - 1] = np; else e.pts[0] = np; }
    c.changed(); return true;
  }
  if (e.type === 'arc') {
    const sw = G.ccwSweep(e.a1, e.a2);
    const th = G.normAng(G.angle(e.c, pick) - e.a1);
    const atEnd = th > sw / 2 && th <= sw ? true : th > sw ? G.normAng(th - sw) < G.normAng(TAU - th) : false;
    let best = Infinity;
    const consider = (p) => {
      const a = G.angle(e.c, p);
      const delta = atEnd ? G.normAng(a - e.a2) : G.normAng(e.a1 - a);
      if (delta > 1e-9 && delta + sw < TAU - 1e-9 && delta < best) best = delta;
    };
    for (const pr of all) {
      if (pr.kind === 'seg') { for (const h of G.lineCircle(pr.a, pr.b, e.c, e.r)) if (h.t >= -1e-9 && h.t <= 1 + 1e-9) consider(h); }
      else for (const h of G.circleCircle(e.c, e.r, pr.c, pr.r)) if (G.onArc(pr, G.arcTheta(pr, h))) consider(h);
    }
    if (!isFinite(best)) { c.print('Object does not intersect an edge.'); return false; }
    if (atEnd) e.a2 += best; else e.a1 -= best;
    c.changed(); return true;
  }
  c.print('Only lines, arcs and open polylines can be extended.');
  return false;
}

function* trimExtend(c, mode) {
  c.print(`Quick mode: all objects act as boundary edges. ${mode === 'trim' ? 'Shift+click to extend instead.' : 'Shift+click to trim instead.'}`);
  const hist = [];
  for (;;) {
    const s = yield P.ent(mode === 'trim' ? 'Select object to trim (Enter to exit)' : 'Select object to extend (Enter to exit)', { keywords: ['Undo'] });
    if (!s) return;
    if (s.kw === 'Undo') { const h = hist.pop(); if (h) c.app.restoreState(h); else c.print('Nothing to undo.'); continue; }
    const snap = c.app.captureState();
    const doTrim = (mode === 'trim') !== !!s.shift;
    if (doTrim ? trimEntity(c, s.e, s.pt) : extendEntity(c, s.e, s.pt)) hist.push(snap);
  }
}
defCmd('TRIM', ['TR'], 'Trim objects at intersections', (c) => trimExtend(c, 'trim'));
defCmd('EXTEND', ['EX'], 'Extend objects to meet other objects', (c) => trimExtend(c, 'extend'));

defCmd('FILLET', ['F'], 'Round (or square, R=0) the corner between two lines', function* (c) {
  const d = c.doc;
  let first;
  for (;;) {
    c.print(`Current settings: Radius = ${fmtNum(d.filletRad, 4)}`);
    first = yield P.ent('Select first line', { keywords: ['Radius'], filter: (e) => e.type === 'line', filterMsg: 'FILLET works on lines (explode polylines first).' });
    if (!first) return;
    if (first.kw === 'Radius') { const r = yield P.dist('Specify fillet radius', { def: d.filletRad }); if (r != null && r >= 0) d.filletRad = r; continue; }
    break;
  }
  const second = yield P.ent('Select second line', { filter: (e) => e.type === 'line' && e.id !== first.e.id, filterMsg: 'Select a different line.' });
  if (!second) return;
  const l1 = first.e, l2 = second.e;
  const h = G.segSeg(l1.p1, l1.p2, l2.p1, l2.p2, true, true)[0];
  if (!h) { c.print('Lines are parallel.'); return; }
  const P0 = { x: h.x, y: h.y };
  const side = (l, pick) => {
    const pp = G.lerp(l.p1, l.p2, G.projectT(pick, l.p1, l.p2));
    let u = G.sub(pp, P0);
    if (G.len(u) < 1e-9) u = G.sub(G.dist(l.p1, P0) > G.dist(l.p2, P0) ? l.p1 : l.p2, P0);
    u = G.norm(u);
    const far = G.dot(G.sub(l.p1, P0), u) >= G.dot(G.sub(l.p2, P0), u) ? l.p1 : l.p2;
    return { u, far };
  };
  const s1 = side(l1, first.pt), s2 = side(l2, second.pt);
  const r = d.filletRad;
  if (r <= 1e-12) { l1.p1 = s1.far; l1.p2 = P0; l2.p1 = s2.far; l2.p2 = P0; c.changed(); return; }
  const th = Math.acos(G.clamp(G.dot(s1.u, s2.u), -1, 1));
  if (th < 1e-6 || Math.PI - th < 1e-6) { c.print('Cannot fillet collinear lines.'); return; }
  const t = r / Math.tan(th / 2);
  if (t > G.dist(P0, s1.far) + 1e-9 || t > G.dist(P0, s2.far) + 1e-9) { c.print('Radius is too large.'); return; }
  const T1 = G.add(P0, G.mul(s1.u, t)), T2 = G.add(P0, G.mul(s2.u, t));
  const ctr = G.add(P0, G.mul(G.norm(G.add(s1.u, s2.u)), r / Math.sin(th / 2)));
  let a1 = G.angle(ctr, T1), a2 = G.angle(ctr, T2);
  if (G.ccwSweep(a1, a2) > Math.PI) [a1, a2] = [a2, a1];
  l1.p1 = s1.far; l1.p2 = T1; l2.p1 = s2.far; l2.p2 = T2;
  c.add({ type: 'arc', c: ctr, r, a1, a2, layer: l1.layer });
  c.changed();
});

defCmd('EXPLODE', ['X'], 'Break polylines, dimensions, leaders and mtext into simple objects', function* (c) {
  const ids = yield* getSel(c);
  let n = 0;
  for (const id of ids) {
    const e = c.get(id), parts = E.explode(e, c.doc);
    if (!parts) continue;
    c.remove(id); parts.forEach((p) => c.add(p, true)); n++;
  }
  c.print(n ? `${n} object(s) exploded.` : 'Nothing to explode.');
}, { sel: true });

defCmd('ARRAY', ['AR', 'ARRAYRECT', 'ARRAYPOLAR'], 'Rectangular or polar array of copies', function* (c) {
  const ids = yield* getSel(c); if (!ids.length) return;
  const k = yield P.kw('Enter array type', ['Rectangular', 'Polar'], { def: 'Rectangular' });
  if (k == null) return;
  const type = k.kw || k;
  const ents = ids.map((id) => c.get(id));
  const ext = Render.extents(c.doc, ents) || { minx: 0, maxx: 10, miny: 0, maxy: 10 };
  if (type === 'Rectangular') {
    const rows = yield P.int('Enter the number of rows', { def: 3 }); if (rows == null || rows < 1) return;
    const cols = yield P.int('Enter the number of columns', { def: 4 }); if (cols == null || cols < 1) return;
    const dy = rows > 1 ? yield P.num('Specify the distance between rows', { def: +((ext.maxy - ext.miny) * 1.5 || 10).toFixed(4) }) : 0; if (dy == null) return;
    const dx = cols > 1 ? yield P.num('Specify the distance between columns', { def: +((ext.maxx - ext.minx) * 1.5 || 10).toFixed(4) }) : 0; if (dx == null) return;
    if (rows * cols * ents.length > 20000) { c.print(`That would create ${rows * cols * ents.length} objects — too many.`); return; }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      if (!i && !j) continue;
      const xf = XF.move({ x: j * dx, y: i * dy });
      ents.forEach((e) => { const n = E.transformed(e, xf); delete n.id; c.add(n, true); });
    }
    c.print(`Created ${rows * cols - 1} copies.`);
  } else {
    const ctr = yield P.point('Specify center point of array'); if (!ctr) return;
    const n = yield P.int('Enter the number of items', { def: 6 }); if (n == null || n < 2) return;
    if (n * ents.length > 20000) { c.print('Too many items.'); return; }
    const fill = yield P.num('Specify the angle to fill (+=ccw, -=cw)', { def: 360 }); if (fill == null) return;
    const step = Math.abs(Math.abs(fill) - 360) < 1e-9 ? (fill * DEG) / n : (fill * DEG) / (n - 1);
    for (let i = 1; i < n; i++) {
      const xf = XF.rotate(ctr, step * i);
      ents.forEach((e) => { const m = E.transformed(e, xf); delete m.id; c.add(m, true); });
    }
    c.print(`Created ${n - 1} copies.`);
  }
}, { sel: true });

defCmd('MATCHPROP', ['MA', 'PAINTER'], 'Copy layer/color/text height from one object to others', function* (c) {
  const s = yield P.ent('Select source object'); if (!s) return;
  const src = s.e;
  c.print(`Current active settings: Layer "${src.layer}", Color ${src.color}${isTexty(src) ? ', Text height ' + fmtNum(src.h, 4) : ''}`);
  for (;;) {
    const t = yield P.ent('Select destination object (Enter to exit)'); if (!t) return;
    t.e.layer = src.layer; t.e.color = src.color;
    if (isTexty(src) && isTexty(t.e)) t.e.h = src.h;
    c.changed();
  }
});

/* ======================= INQUIRY ======================= */
defCmd('DIST', ['DI', 'MEASUREGEOM'], 'Measure distance and angle between two points', function* (c) {
  const a = yield P.point('Specify first point'); if (!a) return;
  const b = yield P.point('Specify second point', { base: a }); if (!b) return;
  const f = (v) => fmtNum(v, Math.max(4, c.doc.dimDec));
  c.print(`Distance = ${f(G.dist(a, b))},  Angle in XY plane = ${f(G.normAng(G.angle(a, b)) / DEG)}°`);
  c.print(`Delta X = ${f(b.x - a.x)},  Delta Y = ${f(b.y - a.y)}`);
}, { transparent: true });

defCmd('ID', [], 'Show the coordinates of a point', function* (c) {
  const p = yield P.point('Specify point'); if (!p) return;
  c.print(`X = ${fmtNum(p.x, 4)}     Y = ${fmtNum(p.y, 4)}`);
}, { transparent: true });

defCmd('AREA', ['AA'], 'Measure area and perimeter (points or object)', function* (c) {
  const r = yield P.point('Specify first corner point', { keywords: ['Object'] }); if (!r) return;
  if (r.kw === 'Object') {
    const s = yield P.ent('Select object', { filter: (e) => E.area(e) != null, filterMsg: 'Object has no area (must be closed).' }); if (!s) return;
    const per = s.e.type === 'circle' ? TAU * s.e.r : E.length(s.e) || G.polyPerimeter(E.loop(s.e));
    c.print(`Area = ${fmtNum(E.area(s.e), 4)},  Perimeter = ${fmtNum(per, 4)}`); return;
  }
  const pts = [r];
  for (;;) {
    const q = yield P.point('Specify next point (Enter to finish)', { base: pts[pts.length - 1], preview: (m) => [{ type: 'pline', pts: [...pts, m], closed: true }] });
    if (!q) break;
    pts.push(q);
  }
  if (pts.length < 3) return;
  c.print(`Area = ${fmtNum(Math.abs(G.polyArea(pts)), 4)},  Perimeter = ${fmtNum(G.polyPerimeter(pts), 4)}`);
}, { transparent: true });

defCmd('LIST', ['LI', 'LS'], 'List properties of selected objects', function* (c) {
  const ids = yield* getSel(c);
  for (const id of ids) E.describe(c.get(id), c.doc).forEach((l) => c.print(l));
  c.app.expandHistory(true);
}, { sel: true });

/* ======================= VIEW ======================= */
defCmd('ZOOM', ['Z'], 'Zoom: Extents / Window / factor', function* (c) {
  const r = yield P.point('Specify corner of window, enter a scale factor (nX)', { keywords: ['All', 'Extents', 'Window', 'Previous'], allowNumber: true, rubber: false });
  if (!r) return;
  if (r.kw === 'All' || r.kw === 'Extents') { c.app.zoomExtents(); return; }
  if (r.kw === 'Previous') { c.app.zoomPrevious(); return; }
  if (typeof r.num === 'number') { c.app.zoomBy(r.num); return; }
  let a = r;
  if (r.kw === 'Window') { a = yield P.point('Specify first corner'); if (!a) return; }
  const b = yield P.point('Specify opposite corner', { base: a, rubber: false, preview: (m) => [{ type: 'pline', pts: rectPts(a, m), closed: true, color: '#7fb4ff' }] });
  if (!b) return;
  c.app.zoomWindow(a, b);
}, { transparent: true });

defCmd('PAN', ['P'], 'Real-time pan (drag with left mouse, Enter/Esc to exit)', function* () {
  yield { type: 'pan', msg: 'Press Esc or Enter to exit, or drag to pan' };
}, { transparent: true });

defCmd('REGEN', ['RE', 'REDRAW', 'R'], 'Redraw the screen', function* (c) { c.app.requestRedraw(); }, { transparent: true });

/* ======================= SETTINGS ======================= */
defCmd('LAYER', ['LA'], 'Open the Layer manager', function* (c) { c.app.showPanel('layers'); }, { transparent: true });

defCmd('-LAYER', ['-LA'], 'Layer options on the command line', function* (c) {
  const d = c.doc;
  for (;;) {
    const r = yield P.kw(`Current layer: "${d.clayer}"  Enter an option`, ['Make', 'Set', 'New', 'ON', 'OFF', 'Color', 'Lock', 'Unlock']);
    if (r == null) return;
    const k = r.kw || r;
    const name = yield P.str(k === 'Make' || k === 'New' ? 'Enter name for new layer' : `Enter name of layer(s) to ${k.toLowerCase()}`, { spaces: true });
    if (!name) continue;
    if (k === 'Color') {
      const col = yield P.str('Enter color name, number (1-255) or #hex');
      const hex = parseColor(col);
      if (!hex || hex === 'bylayer') { c.print('Invalid color.'); continue; }
      const l = c.app.layer(name); if (l) l.color = hex; else c.print(`Layer "${name}" not found.`);
    } else if (k === 'Make' || k === 'New') {
      if (!c.app.layer(name)) d.layers.push({ name, color: '#ffffff', visible: true, locked: false, linetype: 'Continuous' });
      if (k === 'Make') d.clayer = name;
    } else {
      const l = c.app.layer(name);
      if (!l) { c.print(`Layer "${name}" not found.`); continue; }
      if (k === 'Set') d.clayer = name;
      if (k === 'ON') l.visible = true;
      if (k === 'OFF') { if (name === d.clayer) c.print('Turning off the current layer.'); l.visible = false; }
      if (k === 'Lock') l.locked = true;
      if (k === 'Unlock') l.locked = false;
    }
    c.app.refreshUI();
  }
}, { transparent: true });

const COLOR_NAMES = { red: 1, yellow: 2, green: 3, cyan: 4, blue: 5, magenta: 6, white: 7, gray: 8, grey: 8 };
function parseColor(s) {
  if (s == null) return null;
  s = String(s).trim().toLowerCase();
  if (s === 'bylayer' || s === 'b') return 'bylayer';
  if (COLOR_NAMES[s]) return aciToHex(COLOR_NAMES[s]);
  if (/^\d+$/.test(s) && +s >= 1 && +s <= 255) return aciToHex(+s);
  if (/^#?[0-9a-f]{6}$/.test(s)) return s[0] === '#' ? s : '#' + s;
  return null;
}

defCmd('COLOR', ['COL', 'COLOUR'], 'Set the color for new objects', function* (c) {
  const s = yield P.str('Enter default object color (ByLayer, red, yellow, green, cyan, blue, magenta, white, 1-255, #hex)', { def: c.doc.ccolor });
  if (s == null) return;
  const h = parseColor(s);
  if (!h) { c.print('Invalid color.'); return; }
  c.doc.ccolor = h; c.app.refreshUI();
}, { transparent: true });

function setVar(name, key, msg, check = (v) => v > 0) {
  defCmd(name, [], msg, function* (c) {
    const v = yield P.num(`Enter new value for ${name}`, { def: c.doc[key] });
    if (v == null) return;
    if (!check(v)) { c.print('Invalid value.'); return; }
    c.doc[key] = v; c.app.refreshUI(); c.app.requestRedraw();
  }, { transparent: true });
}
setVar('TEXTSIZE', 'textSize', 'Default text height');
const curDimStyle = (c) => c.doc.dimStyles.find((x) => x.name === c.doc.dimStyle) || c.doc.dimStyles[0];
defCmd('DIMSCALE', [], 'Overall scale of the current dimension style', function* (c) {
  const st = curDimStyle(c);
  const v = yield P.num(`Enter overall scale for dimension style "${st.name}"`, { def: st.scale });
  if (v > 0) { st.scale = v; c.changed(); c.app.refreshUI(); }
}, { transparent: true });
defCmd('DIMDEC', [], 'Decimal places in the current dimension style', function* (c) {
  const st = curDimStyle(c);
  const v = yield P.int(`Enter decimal places for dimension style "${st.name}"`, { def: st.dec });
  if (v != null && v >= 0 && v <= 8) { st.dec = v; c.changed(); c.app.refreshUI(); }
}, { transparent: true });

defCmd('GRID', [], 'Grid display and spacing', function* (c) {
  const s = c.app.settings;
  const r = yield P.num('Specify grid spacing', { keywords: ['ON', 'OFF'], def: s.gridSize });
  if (r == null) return;
  if (r.kw) s.grid = r.kw === 'ON'; else if (r > 0) { s.gridSize = r; s.grid = true; }
  c.app.refreshUI();
}, { transparent: true });

defCmd('SNAP', ['SN'], 'Snap-to-grid spacing', function* (c) {
  const s = c.app.settings;
  const r = yield P.num('Specify snap spacing', { keywords: ['ON', 'OFF'], def: s.snapSize });
  if (r == null) return;
  if (r.kw) s.snap = r.kw === 'ON'; else if (r > 0) { s.snapSize = r; s.snap = true; }
  c.app.refreshUI();
}, { transparent: true });

defCmd('ORTHO', [], 'Toggle orthogonal mode (F8)', function* (c) { c.app.toggle('ortho'); }, { transparent: true });
defCmd('OSNAP', ['OS', 'DSETTINGS', 'DS'], 'Object snap settings (F3 toggles)', function* (c) { c.app.showPanel('settings'); }, { transparent: true });

/* ======================= EDIT / FILE ======================= */
defCmd('UNDO', ['U'], 'Undo the last operation', function* (c) { c.app.undo(); }, { transparent: true, noUndo: true });
defCmd('REDO', ['MREDO'], 'Redo', function* (c) { c.app.redo(); }, { transparent: true, noUndo: true });

defCmd('COPYCLIP', [], 'Copy selection to clipboard (Ctrl+C)', function* (c) {
  const ids = yield* getSel(c); if (!ids.length) return;
  c.app.clipboard = ids.map((id) => E.clone(c.get(id)));
  c.print(`${ids.length} object(s) copied to clipboard.`);
}, { sel: true, transparent: true });
defCmd('CUTCLIP', [], 'Cut selection to clipboard (Ctrl+X)', function* (c) {
  const ids = yield* getSel(c); if (!ids.length) return;
  c.app.clipboard = ids.map((id) => E.clone(c.get(id)));
  ids.forEach((id) => c.remove(id));
}, { sel: true });
defCmd('PASTECLIP', [], 'Paste from clipboard (Ctrl+V)', function* (c) {
  const cb = c.app.clipboard;
  if (!cb || !cb.length) { c.print('Clipboard is empty.'); return; }
  const ext = Render.extents(c.doc, cb);
  const base = { x: ext.minx, y: ext.miny };
  const p = yield P.point('Specify insertion point', { preview: (m) => cb.map((e) => E.transformed(e, XF.move(G.sub(m, base)))) });
  if (!p) return;
  cb.forEach((e) => { const n = E.transformed(e, XF.move(G.sub(p, base))); delete n.id; c.add(n, true); });
});
defCmd('SELECTALL', ['ALL'], 'Select all objects (Ctrl+A)', function* (c) { c.app.selectAll(); }, { transparent: true, keepSel: true });

defCmd('NEW', ['QNEW'], 'Start a new drawing', function* (c) {
  if (c.doc.entities.length) {
    const k = yield P.kw('Discard the current drawing?', ['Yes', 'No'], { def: 'No' });
    if (!k || (k.kw || k) !== 'Yes') return;
  }
  c.app.newDrawing();
}, { noUndo: true });
defCmd('OPEN', [], 'Open a drawing (.dwg / .dxf / .bcad)', function* (c) { c.app.openFile(); }, { noUndo: true });
defCmd('SAVE', ['QSAVE'], 'Save the drawing (.bcad)', function* (c) { c.app.saveFile(); }, { transparent: true });
defCmd('SAVEAS', [], 'Save the drawing under a new name', function* (c) {
  const n = yield P.str('Enter file name', { def: c.doc.name, spaces: true });
  if (!n) return;
  c.doc.name = n.replace(/\.(bcad|json)$/i, ''); c.app.saveFile(); c.app.refreshUI();
}, { transparent: true });
defCmd('EXPORT', ['EXP', 'DXFOUT', 'SVGOUT', 'PNGOUT'], 'Export to DXF (AutoCAD), SVG or PNG', function* (c, opts) {
  let k = opts && opts.format;
  if (!k) { const r = yield P.kw('Export format', ['DXF', 'SVG', 'PNG'], { def: 'DXF' }); if (r == null) return; k = r.kw || r; }
  c.app.exportAs(k);
}, { transparent: true });
defCmd('PLOT', ['PRINT', 'EXPORTPDF'], 'Plot to PDF: model at a scale, or a layout sheet', function* (c) { Plot.open(c.app); }, { transparent: true });
defCmd('HELP', ['?', 'COMMANDS'], 'Show the command reference (F1)', function* (c) { c.app.showHelp(); }, { transparent: true });

/* ======================= MORE MODIFY (group 1) ======================= */
const inR = (p, r) => p.x >= r.minx && p.x <= r.maxx && p.y >= r.miny && p.y <= r.maxy;
const rectOf = (a, b) => ({ minx: Math.min(a.x, b.x), maxx: Math.max(a.x, b.x), miny: Math.min(a.y, b.y), maxy: Math.max(a.y, b.y) });

function stretchEnt(e, d, r, doc) {
  const mv = (p) => (inR(p, r) ? G.add(p, d) : p);
  if (E.inRect(e, r, false, doc)) { E.transform(e, XF.move(d)); return; }
  switch (e.type) {
    case 'line': e.p1 = mv(e.p1); e.p2 = mv(e.p2); break;
    case 'pline': case 'leader': case 'revcloud': e.pts = e.pts.map(mv); break;
    case 'spline': e.fit = e.fit.map(mv); break;
    case 'hatch': e.loops = e.loops.map((l) => l.map(mv)); break;
    case 'dim': for (const k of ['p1', 'p2', 'pos']) if (e[k]) e[k] = mv(e[k]); break;
    case 'arc': {
      const g = E.grips(e), s0 = inR(g[0], r), s2 = inR(g[2], r);
      if (s0 || s2) { const k = G.arc3(s0 ? G.add(g[0], d) : g[0], g[1], s2 ? G.add(g[2], d) : g[2]); if (k) Object.assign(e, k); }
      break;
    }
    case 'circle': case 'ellipse': if (inR(e.c, r)) E.transform(e, XF.move(d)); break;
    default: if (e.p && inR(e.p, r)) E.transform(e, XF.move(d));
  }
}

defCmd('STRETCH', ['S'], 'Stretch: move the vertices inside a crossing window', function* (c) {
  c.print('Select objects to stretch with a crossing window: vertices inside the window move, objects fully inside move entirely.');
  const a = yield P.point('Specify first corner'); if (!a) return;
  const b = yield P.point('Specify opposite corner', { base: a, rubber: false, preview: (m) => [{ type: 'pline', pts: rectPts(a, m), closed: true, color: '#5fe07f' }] });
  if (!b) return;
  const r = rectOf(a, b);
  const ids = c.app.selectableEntities().filter((e) => E.inRect(e, r, true, c.doc)).map((e) => e.id);
  if (!ids.length) { c.print('No objects found.'); return; }
  c.print(`${ids.length} found`);
  c.app.sel = new Set(ids); c.usedSel = true;
  const base = yield P.point('Specify base point'); if (!base) return;
  const ghostS = (m) => ids.map((id) => { const t = E.clone(c.get(id)); stretchEnt(t, G.sub(m, base), r, c.doc); return t; });
  const to = yield P.point('Specify second point', { base, preview: ghostS });
  if (!to) return;
  ids.forEach((id) => stretchEnt(c.get(id), G.sub(to, base), r, c.doc));
  c.changed();
});

function breakEnt(c, e, p1, p2) {
  const L = E.length(e), eps = Math.max(1e-9, L * 1e-9);
  const s1 = E.paramAt(e, p1).s, s2 = E.paramAt(e, p2).s;
  const pieces = [];
  if (E.isClosed(e)) {
    if (Math.abs(s1 - s2) < eps) { c.print('A closed object needs two different break points.'); return false; }
    pieces.push(E.sub(e, s2, s1));
  } else {
    const lo = Math.min(s1, s2), hi = Math.max(s1, s2);
    if (hi - lo < eps) { if (lo > eps && lo < L - eps) pieces.push(E.sub(e, 0, lo), E.sub(e, lo, L)); else { c.print('Break point is at an end of the object.'); return false; } }
    else { if (lo > eps) pieces.push(E.sub(e, 0, lo)); if (hi < L - eps) pieces.push(E.sub(e, hi, L)); }
  }
  c.remove(e.id);
  pieces.filter(Boolean).forEach((p) => c.add(p));
  return true;
}
defCmd('BREAK', ['BR'], 'Break an object between two points (or at one point with @)', function* (c) {
  const s = yield P.ent('Select object', { filter: E.isCurve, filterMsg: 'Select a line, arc, circle or polyline.' });
  if (!s) return;
  let p1 = s.pt;
  let p2 = yield P.point('Specify second break point (@ = break at first point)', { keywords: ['First'], base: p1, rubber: false });
  if (!p2) return;
  if (p2.kw === 'First') {
    p1 = yield P.point('Specify first break point'); if (!p1) return;
    p2 = yield P.point('Specify second break point (@ = same point)', { base: p1, rubber: false }); if (!p2) return;
  }
  breakEnt(c, s.e, E.paramAt(s.e, p1).pt, E.paramAt(s.e, p2).pt);
});
defCmd('BREAKATPOINT', ['BRP'], 'Split an object into two at a point', function* (c) {
  const s = yield P.ent('Select object', { filter: (e) => E.isCurve(e) && !E.isClosed(e), filterMsg: 'Select a line, arc or open polyline.' });
  if (!s) return;
  const p = yield P.point('Specify break point'); if (!p) return;
  const q = E.paramAt(s.e, p).pt;
  breakEnt(c, s.e, q, q);
});

/* --- path helpers for JOIN / PEDIT --- */
function pathOf(e) {
  if (e.type === 'line') return { pts: [e.p1, e.p2], b: [0] };
  if (e.type === 'arc') { const sw = G.ccwSweep(e.a1, e.a2); return { pts: [G.polar(e.c, e.a1, e.r), G.polar(e.c, e.a2, e.r)], b: [Math.tan(sw / 4)] }; }
  if (e.type === 'pline' && !e.closed) return { pts: e.pts.slice(), b: e.pts.slice(0, -1).map((_, i) => (e.b && e.b[i]) || 0) };
  return null;
}
const revPath = (p) => ({ pts: p.pts.slice().reverse(), b: p.b.slice().reverse().map((x) => -x) });
function joinPaths(paths, tol) {
  const items = paths.slice(), chains = [];
  while (items.length) {
    let ch = { pts: items[0].pts.slice(), b: items[0].b.slice(), ids: [items[0].id] };
    items.shift();
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i], S = ch.pts[0], En = ch.pts[ch.pts.length - 1];
        const near = (a, b) => G.dist(a, b) <= tol;
        let add = null, front = false;
        if (near(En, it.pts[0])) add = it; else if (near(En, it.pts[it.pts.length - 1])) add = revPath(it);
        else if (near(S, it.pts[it.pts.length - 1])) { add = it; front = true; } else if (near(S, it.pts[0])) { add = revPath(it); front = true; }
        if (!add) continue;
        if (front) ch = { pts: [...add.pts.slice(0, -1), ...ch.pts], b: [...add.b, ...ch.b], ids: [...ch.ids, it.id] };
        else ch = { pts: [...ch.pts, ...add.pts.slice(1)], b: [...ch.b, ...add.b], ids: [...ch.ids, it.id] };
        items.splice(i, 1); changed = true; break;
      }
    }
    chains.push(ch);
  }
  return chains.map((ch) => {
    let closed = false;
    if (ch.pts.length > 2 && G.dist(ch.pts[0], ch.pts[ch.pts.length - 1]) <= tol) { ch.pts.pop(); closed = true; }
    const b = closed ? ch.b : [...ch.b, 0];
    return { ids: ch.ids, ent: { type: 'pline', pts: ch.pts, b: b.some((x) => Math.abs(x) > 1e-12) ? b : undefined, closed } };
  });
}
const joinTol = (c) => { const x = Render.extents(c.doc); return x ? Math.max(1e-6, Math.hypot(x.maxx - x.minx, x.maxy - x.miny) * 1e-7) : 1e-6; };

defCmd('JOIN', ['J'], 'Join touching lines, arcs and polylines into one polyline', function* (c) {
  const ids = yield* getSel(c, 'Select objects to join');
  const paths = ids.map((id) => { const p = pathOf(c.get(id)); return p ? { ...p, id } : null; }).filter(Boolean);
  if (paths.length < 2) { c.print('Select at least two lines, arcs or open polylines whose ends touch.'); return; }
  let n = 0;
  for (const ch of joinPaths(paths, joinTol(c))) {
    if (ch.ids.length < 2) continue;
    const src = c.get(ch.ids[0]);
    let ent = ch.ent;
    // collinear straight lines become a single line
    if (!ent.closed && !ent.b && ent.pts.length > 2 && ent.pts.every((p) => Math.abs(G.cross(G.sub(ent.pts[ent.pts.length - 1], ent.pts[0]), G.sub(p, ent.pts[0]))) < 1e-9 * G.dist(ent.pts[0], ent.pts[ent.pts.length - 1]) ** 2))
      ent = { type: 'line', p1: ent.pts[0], p2: ent.pts[ent.pts.length - 1] };
    ch.ids.forEach((id) => c.remove(id));
    c.add({ ...ent, layer: src.layer, color: src.color });
    n += ch.ids.length;
  }
  c.print(n ? `${n} objects joined.` : 'Nothing joined: the ends of the objects do not touch.');
}, { sel: true });

function cornerSides(l1, pick1, l2, pick2) {
  const h = G.segSeg(l1.p1, l1.p2, l2.p1, l2.p2, true, true)[0];
  if (!h) return null;
  const P0 = { x: h.x, y: h.y };
  const side = (l, pick) => {
    const pp = G.lerp(l.p1, l.p2, G.projectT(pick, l.p1, l.p2));
    let u = G.sub(pp, P0);
    if (G.len(u) < 1e-9) u = G.sub(G.dist(l.p1, P0) > G.dist(l.p2, P0) ? l.p1 : l.p2, P0);
    u = G.norm(u);
    return { u, far: G.dot(G.sub(l.p1, P0), u) >= G.dot(G.sub(l.p2, P0), u) ? l.p1 : l.p2 };
  };
  return { P0, s1: side(l1, pick1), s2: side(l2, pick2) };
}

defCmd('CHAMFER', ['CHA'], 'Bevel the corner between two lines', function* (c) {
  const d = c.doc;
  if (d.chamA == null) { d.chamA = 0; d.chamB = 0; }
  let first;
  for (;;) {
    c.print(`Current chamfer: Dist1 = ${fmtNum(d.chamA, 4)}, Dist2 = ${fmtNum(d.chamB, 4)}`);
    first = yield P.ent('Select first line', { keywords: ['Distance'], filter: (e) => e.type === 'line', filterMsg: 'CHAMFER works on lines (explode polylines first).' });
    if (!first) return;
    if (first.kw === 'Distance') {
      const a = yield P.dist('Specify first chamfer distance', { def: d.chamA }); if (a == null || a < 0) continue;
      const b = yield P.dist('Specify second chamfer distance', { def: a }); if (b == null || b < 0) continue;
      d.chamA = a; d.chamB = b; continue;
    }
    break;
  }
  const second = yield P.ent('Select second line', { filter: (e) => e.type === 'line' && e.id !== first.e.id, filterMsg: 'Select a different line.' });
  if (!second) return;
  const k = cornerSides(first.e, first.pt, second.e, second.pt);
  if (!k) { c.print('Lines are parallel.'); return; }
  const { P0, s1, s2 } = k;
  if (d.chamA > G.dist(P0, s1.far) + 1e-9 || d.chamB > G.dist(P0, s2.far) + 1e-9) { c.print('Distance is too large.'); return; }
  const T1 = G.add(P0, G.mul(s1.u, d.chamA)), T2 = G.add(P0, G.mul(s2.u, d.chamB));
  first.e.p1 = s1.far; first.e.p2 = T1; second.e.p1 = s2.far; second.e.p2 = T2;
  if (G.dist(T1, T2) > 1e-9) c.add({ type: 'line', p1: T1, p2: T2, layer: first.e.layer });
  c.changed();
});

function lengthenEnt(c, e, pick, deltaFn) {
  const L = E.length(e), atEnd = E.paramAt(e, pick).s > L / 2;
  const delta = deltaFn(L);
  if (!isFinite(delta)) return;
  if (L + delta <= 1e-9) { c.print('That would make the object zero length.'); return; }
  if (e.type === 'line') {
    const u = G.norm(G.sub(e.p2, e.p1));
    if (atEnd) e.p2 = G.add(e.p2, G.mul(u, delta)); else e.p1 = G.sub(e.p1, G.mul(u, delta));
  } else if (e.type === 'arc') {
    const da = delta / e.r;
    if (G.ccwSweep(e.a1, e.a2) + da >= TAU) { c.print('Arc would close on itself.'); return; }
    if (atEnd) e.a2 += da; else e.a1 -= da;
  } else if (e.type === 'pline') {
    const n = e.pts.length, i = atEnd ? n - 2 : 0;
    if (e.b && Math.abs(e.b[i] || 0) > 1e-9) { c.print('The end segment is an arc; LENGTHEN works on straight polyline ends.'); return; }
    const a = atEnd ? e.pts[n - 2] : e.pts[1], b = atEnd ? e.pts[n - 1] : e.pts[0];
    const u = G.norm(G.sub(b, a));
    if (atEnd) e.pts[n - 1] = G.add(b, G.mul(u, delta)); else e.pts[0] = G.add(b, G.mul(u, delta));
  }
  c.changed();
}
defCmd('LENGTHEN', ['LEN'], 'Change the length of lines, arcs and open polylines', function* (c) {
  const d = c.doc;
  let mode = d.lenMode || 'DElta';
  const okE = (e) => ['line', 'arc'].includes(e.type) || (e.type === 'pline' && !e.closed);
  for (;;) {
    const r = yield P.ent(`Select an object to measure (current mode: ${mode})`, { keywords: ['DElta', 'Percent', 'Total', 'DYnamic'] });
    if (!r) return;
    if (r.kw) {
      mode = r.kw;
      if (mode === 'DElta') { const v = yield P.num('Enter delta length (negative shortens)', { def: d.lenDelta || 0 }); if (v == null) continue; d.lenDelta = v; }
      if (mode === 'Percent') { const v = yield P.num('Enter percentage length', { def: d.lenPct || 100 }); if (!(v > 0)) continue; d.lenPct = v; }
      if (mode === 'Total') { const v = yield P.dist('Specify total length', { def: d.lenTotal || 1 }); if (!(v > 0)) continue; d.lenTotal = v; }
      d.lenMode = mode;
      break;
    }
    c.print(`Current length: ${fmtNum(E.length(r.e) || 0, 4)}`);
  }
  for (;;) {
    const s = yield P.ent('Select an object to change near the end to lengthen (Enter to exit)', { filter: okE, filterMsg: 'Select a line, arc or open polyline.' });
    if (!s) return;
    if (mode === 'DYnamic') {
      const L = E.length(s.e), atEnd = E.paramAt(s.e, s.pt).s > L / 2;
      const endPt = atEnd ? E.pointAt(s.e, L) : E.pointAt(s.e, 0);
      const before = E.pointAt(s.e, atEnd ? L * 0.999 : L * 0.001);
      const u = G.norm(G.sub(endPt, before));
      const p = yield P.point('Specify new end point', { base: endPt, preview: (m) => { const t = E.clone(s.e); lengthenEnt({ print() {}, changed() {} }, t, s.pt, () => G.dot(G.sub(m, endPt), u)); return [t]; } });
      if (!p) return;
      lengthenEnt(c, s.e, s.pt, () => G.dot(G.sub(p, endPt), u));
      continue;
    }
    lengthenEnt(c, s.e, s.pt, (L) => (mode === 'DElta' ? d.lenDelta : mode === 'Percent' ? (L * d.lenPct) / 100 - L : d.lenTotal - L));
  }
});

defCmd('ALIGN', ['AL'], 'Move + rotate (+ scale) objects so two source points match two destination points', function* (c) {
  const ids = yield* getSel(c); if (!ids.length) return;
  const s1 = yield P.point('Specify first source point'); if (!s1) return;
  const d1 = yield P.point('Specify first destination point', { base: s1 }); if (!d1) return;
  const s2 = yield P.point('Specify second source point (Enter = just move)');
  if (!s2) { const xf = XF.move(G.sub(d1, s1)); ids.forEach((id) => E.transform(c.get(id), xf)); c.changed(); return; }
  const d2 = yield P.point('Specify second destination point', { base: d1 }); if (!d2) return;
  const k = yield P.kw('Scale objects based on alignment points?', ['Yes', 'No'], { def: 'No' });
  if (k == null) return;
  const f = (k.kw || k) === 'Yes' && G.dist(s1, s2) > 1e-12 ? G.dist(d1, d2) / G.dist(s1, s2) : 1;
  const ang = G.angle(d1, d2) - G.angle(s1, s2);
  const m = M2.mul([Math.cos(ang) * f, Math.sin(ang) * f, -Math.sin(ang) * f, Math.cos(ang) * f, d1.x, d1.y], [1, 0, 0, 1, -s1.x, -s1.y]);
  const xf = XF.matrix(m);
  ids.forEach((id) => E.transform(c.get(id), xf));
  c.changed();
}, { sel: true });

defCmd('PEDIT', ['PE'], 'Edit polylines: close/open, join, decurve, reverse; convert lines/arcs', function* (c) {
  const s = yield P.ent('Select polyline', { filter: (e) => ['pline', 'line', 'arc'].includes(e.type), filterMsg: 'Select a polyline, line or arc.' });
  if (!s) return;
  let e = s.e;
  if (e.type !== 'pline') {
    const k = yield P.kw('Object selected is not a polyline. Do you want to turn it into one?', ['Yes', 'No'], { def: 'Yes' });
    if (!k || (k.kw || k) !== 'Yes') return;
    const p = pathOf(e);
    c.remove(e.id);
    e = c.add({ type: 'pline', pts: p.pts, b: p.b.some((x) => x) ? [...p.b, 0] : undefined, closed: false, layer: s.e.layer, color: s.e.color });
  }
  const hist = [];
  for (;;) {
    c.app.sel = new Set([e.id]);
    const r = yield P.kw('Enter an option', [e.closed ? 'Open' : 'Close', 'Join', 'Decurve', 'Reverse', 'Undo']);
    if (r == null) { c.app.sel = new Set(); return; }
    const k = r.kw || r;
    if (k === 'Undo') { const h = hist.pop(); if (h) { Object.keys(e).forEach((q) => delete e[q]); Object.assign(e, h); c.changed(); } continue; }
    hist.push(E.clone(e));
    if (k === 'Close') { e.closed = true; if (e.b) e.b[e.pts.length - 1] = 0; }
    if (k === 'Open') e.closed = false;
    if (k === 'Decurve') delete e.b;
    if (k === 'Reverse') { const n = e.pts.length; e.pts.reverse(); if (e.b) { const segs = e.closed ? n : n - 1; const old = e.b.slice(0, segs); const nb = old.slice().reverse().map((x) => -x); if (e.closed) { nb.push(nb.shift()); } e.b = [...nb, ...(e.closed ? [] : [0])]; } }
    if (k === 'Join') {
      if (e.closed) { c.print('Cannot join to a closed polyline.'); hist.pop(); continue; }
      c.app.sel = new Set();
      const ids = yield { type: 'select', msg: 'Select objects to join' };
      const paths = [{ ...pathOf(e), id: e.id }, ...(ids || []).filter((id) => id !== e.id).map((id) => { const p = pathOf(c.get(id)); return p ? { ...p, id } : null; }).filter(Boolean)];
      const ch = joinPaths(paths, joinTol(c)).find((q) => q.ids.includes(e.id));
      if (ch && ch.ids.length > 1) {
        ch.ids.filter((id) => id !== e.id).forEach((id) => c.remove(id));
        e.pts = ch.ent.pts; e.b = ch.ent.b; e.closed = ch.ent.closed;
        c.print(`${ch.ids.length - 1} segments added to polyline.`);
      } else c.print('Nothing joined: ends do not touch.');
    }
    c.changed();
  }
});

/* ======================= BLOCKS (group 2) ======================= */
const blockNames = (doc) => Object.keys(doc.blocks || {}).filter((n) => !n.startsWith('*')).sort((a, b) => a.localeCompare(b));
const findBlockName = (doc, s) => { const t = String(s).trim().toLowerCase(); return Object.keys(doc.blocks || {}).find((n) => n.toLowerCase() === t) || Object.keys(LIBRARY).find((n) => n.toLowerCase() === t) || null; };
function blockUses(doc, name, target, seen = new Set()) {
  if (name === target) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const b = doc.blocks[name];
  return !!b && b.ents.some((e) => e.type === 'insert' && blockUses(doc, e.name, target, seen));
}
/* Make block references match their block's attribute definitions (keeps typed values). */
function attSync(c, name) {
  const blk = c.doc.blocks[name];
  if (!blk) return 0;
  let n = 0;
  for (const e of c.doc.entities) {
    if (e.type !== 'insert' || e.name !== name) continue;
    const old = Object.fromEntries((e.attribs || []).map((a) => [a.tag, a.value]));
    e.attribs = E.attribsFor(blk, old);
    n++;
  }
  if (n) c.changed();
  return n;
}

defCmd('BLOCK', ['B', 'BMAKE'], 'Create a block (reusable symbol) from selected objects', function* (c) {
  const d = c.doc;
  let name = yield P.str('Enter block name', { spaces: true });
  if (!name) return;
  name = name.trim();
  if (!name || /[<>/\\":;?*|=`]/.test(name)) { c.print('Invalid block name.'); return; }
  const existing = Object.keys(d.blocks).find((n) => n.toLowerCase() === name.toLowerCase());
  if (existing) {
    const k = yield P.kw(`Block "${existing}" already exists. Redefine it?`, ['Yes', 'No'], { def: 'No' });
    if (!k || (k.kw || k) !== 'Yes') return;
    name = existing;
  }
  const base = yield P.point('Specify insertion base point'); if (!base) return;
  const ids = yield* getSel(c, 'Select objects for the block');
  if (!ids.length) { c.print('No objects selected.'); return; }
  if (ids.some((id) => { const e = c.get(id); return e.type === 'insert' && blockUses(d, e.name, name); })) { c.print('A block cannot contain itself.'); return; }
  const k = yield P.kw('Then', ['Convert', 'Retain', 'Delete'], { def: 'Convert' });
  if (k == null) return;
  const mode = k.kw || k;
  const ents = ids.map((id) => { const n = E.clone(c.get(id)); delete n.id; return n; });
  d.blocks[name] = { name, base: { ...base }, ents };
  if (mode !== 'Retain') ids.forEach((id) => c.remove(id));
  if (mode === 'Convert') c.add({ type: 'insert', name, p: { ...base }, sx: 1, sy: 1, rot: 0, attribs: E.attribsFor(d.blocks[name]) });
  if (existing) attSync(c, name);
  c.changed();
  c.print(`Block "${name}" ${existing ? 'redefined' : 'created'} (${ents.length} objects).`);
  c.app.refreshUI();
}, { sel: true });

defCmd('INSERT', ['I', 'DDINSERT', 'CLASSICINSERT'], 'Insert a block (from this drawing, the library or a file)', function* (c, opts) {
  const d = c.doc;
  let name = opts && opts.name ? findBlockName(d, opts.name) : null;
  if (opts && opts.file) name = { kw: 'File' };
  while (!name || typeof name !== 'string') {
    if (!name) {
      const names = blockNames(d);
      const r = yield P.str(`Enter block name${names.length ? ' (' + names.slice(0, 6).join(', ') + (names.length > 6 ? ', …' : '') + ')' : ''}`, { keywords: ['File', 'Library', '?'], def: d.lastBlock && d.blocks[d.lastBlock] ? d.lastBlock : undefined, spaces: true });
      if (r == null) return;
      name = r.kw ? r : findBlockName(d, r);
      if (!name) { c.print(`Block "${r}" not found. Type ? to list blocks, L for the library, or F to insert a file.`); continue; }
    }
    if (name.kw === '?') { const ns = blockNames(d); c.print(ns.length ? 'Blocks: ' + ns.join(', ') : 'No blocks in this drawing.'); c.print('Library: ' + Object.keys(LIBRARY).join(', ')); c.app.expandHistory(true); name = null; continue; }
    if (name.kw === 'Library') { c.app.showPanel('blocks'); c.print('Library: ' + Object.keys(LIBRARY).join(', ')); name = null; continue; }
    if (name.kw === 'File') {
      const f = yield { type: 'wait', msg: 'Choose a drawing file to insert as a block…', promise: c.app.pickAndReadDrawing() };
      if (!f || f.error) { if (f && f.error) c.print('Could not read file: ' + f.error); return; }
      name = c.app.blockFromDrawing(f);
      c.print(`Block "${name}" created from ${f.fileName} (${d.blocks[name].ents.length} objects).`);
    }
  }
  if (LIBRARY[name] && !d.blocks[name]) libraryEnsure(d, name);
  const blk = d.blocks[name];
  d.lastBlock = name;
  let sx = 1, sy = 1, rot = 0;
  for (;;) {
    const mk = (p) => ({ type: 'insert', name, p, sx, sy, rot, attribs: E.attribsFor(blk) });
    const r = yield P.point(`Specify insertion point for "${name}"`, { keywords: ['Scale', 'Rotate'], preview: (m) => [mk(m)] });
    if (!r) return;
    if (r.kw === 'Scale') { const v = yield P.num('Specify scale factor', { def: sx }); if (v) { sx = v; sy = v; } continue; }
    if (r.kw === 'Rotate') { const v = yield P.angle('Specify rotation angle', { def: (rot / DEG) || 0 }); if (v != null) rot = v * DEG; continue; }
    const values = {};
    for (const ad of blk.ents.filter((x) => x.type === 'attdef')) {
      const v = yield P.str(`Enter attribute value — ${ad.prompt || ad.tag}`, { def: ad.def || '', spaces: true });
      if (v == null) return;
      values[ad.tag] = v;
    }
    c.add({ type: 'insert', name, p: r, sx, sy, rot, attribs: E.attribsFor(blk, values) });
    c.app.refreshUI();
    return;
  }
});

defCmd('ATTDEF', ['ATT', 'DDATTDEF'], 'Define an attribute (editable text field) for a block', function* (c) {
  const d = c.doc;
  let tag = yield P.str('Enter attribute tag name (no spaces)');
  if (!tag) return;
  tag = tag.trim().toUpperCase();
  if (/\s/.test(tag)) { c.print('Tags cannot contain spaces.'); return; }
  const prompt = yield P.str('Enter attribute prompt', { def: tag, spaces: true }); if (prompt == null) return;
  const def = yield P.str('Enter default value', { def: '', spaces: true }); if (def == null) return;
  const p = yield P.point('Specify start point'); if (!p) return;
  const h = yield P.dist('Specify text height', { base: p, def: d.textSize }); if (!(h > 0)) return;
  c.add({ type: 'attdef', tag, prompt, def, p, h, rot: 0, align: 'left', style: d.textStyle });
  c.print('Include this attribute definition when you create the block with BLOCK.');
});

defCmd('ATTEDIT', ['ATE', 'EATTEDIT', 'DDATTE'], 'Edit the attribute values of a block reference', function* (c, opts) {
  let e = opts && opts.id ? c.get(opts.id) : null;
  if (!e) {
    const s = yield P.ent('Select a block reference', { filter: (x) => x.type === 'insert' && (x.attribs || []).length, filterMsg: 'That block has no attributes.' });
    if (!s) return;
    e = s.e;
  }
  for (const a of e.attribs) {
    const v = yield P.str(`${a.tag}`, { def: a.value ?? '', spaces: true });
    if (v == null) return;
    a.value = v;
    c.changed();
  }
});

defCmd('ATTSYNC', [], 'Update block references to match the block\'s attribute definitions', function* (c) {
  const r = yield P.str('Enter name of block to synchronize', { def: c.doc.lastBlock, spaces: true });
  if (!r) return;
  const name = findBlockName(c.doc, r);
  if (!name || !c.doc.blocks[name]) { c.print('Block not found.'); return; }
  c.print(`${attSync(c, name)} reference(s) of "${name}" updated.`);
});

defCmd('BEDIT', ['BE', 'REFEDIT'], 'Edit a block definition in place (BCLOSE to finish)', function* (c, opts) {
  const app = c.app, d = c.doc;
  if (app.blockEdit) { c.print(`Already editing "${app.blockEdit.name}". Use BCLOSE first.`); return; }
  let ins = null, name = opts && opts.name;
  if (!name) {
    const s = yield P.ent('Select a block reference to edit', { keywords: ['Name'], filter: (x) => x.type === 'insert', filterMsg: 'Select a block reference.' });
    if (!s) return;
    if (s.kw === 'Name') { const r = yield P.str('Enter block name', { spaces: true, def: d.lastBlock }); if (!r) return; name = findBlockName(d, r); }
    else { ins = s.e; name = ins.name; }
  }
  if (!name || !d.blocks[name]) { c.print('Block not found.'); return; }
  if (!ins) ins = d.entities.find((x) => x.type === 'insert' && x.name === name) || null;
  const m = ins ? E.insertMatrix(ins) : M2.mul([1, 0, 0, 1, app.view.cx, app.view.cy], [1, 0, 0, 1, -d.blocks[name].base.x, -d.blocks[name].base.y]);
  app.blockEdit = { name, insId: ins ? ins.id : null, m, ids: new Set() };
  const xf = XF.matrix(m);
  for (const e of d.blocks[name].ents) { const n = E.transform(E.clone(e), xf); delete n.id; c.add(n); }
  c.print(`Block editor: editing "${name}". Draw and modify as usual; other objects are greyed out. Type BCLOSE when you are done.`);
  app.refreshUI();
});

defCmd('BCLOSE', ['BC', 'REFCLOSE'], 'Finish editing a block: Save or Discard changes', function* (c) {
  const app = c.app, be = app.blockEdit, d = c.doc;
  if (!be) { c.print('Not editing a block.'); return; }
  const k = yield P.kw(`Save changes to block "${be.name}"?`, ['Save', 'Discard'], { def: 'Save' });
  if (k == null) return;
  const ids = [...be.ids].filter((id) => c.get(id));
  if ((k.kw || k) === 'Save') {
    const xf = XF.matrix(M2.inv(be.m));
    d.blocks[be.name].ents = ids.map((id) => { const n = E.transform(E.clone(c.get(id)), xf); delete n.id; return n; });
  }
  app.blockEdit = null;
  ids.forEach((id) => c.remove(id));
  if ((k.kw || k) === 'Save') { const n = attSync(c, be.name); c.print(`Block "${be.name}" saved${n ? `; ${n} reference(s) updated` : ''}.`); }
  else c.print('Changes discarded.');
  c.changed(); app.refreshUI();
});

defCmd('PURGE', ['PU'], 'Remove unused blocks and layers', function* (c) {
  const k = yield P.kw('Purge', ['Blocks', 'Layers', 'All'], { def: 'All' });
  if (k == null) return;
  const what = k.kw || k, d = c.doc;
  let nb = 0, nl = 0;
  if (what !== 'Layers') {
    for (let changed = true; changed;) {
      changed = false;
      const used = new Set();
      const visit = (list) => { for (const e of list) if (e.type === 'insert' && !used.has(e.name)) { used.add(e.name); if (d.blocks[e.name]) visit(d.blocks[e.name].ents); } };
      visit(d.model); d.layouts.forEach((l) => visit(l.ents));
      for (const n of Object.keys(d.blocks)) if (!used.has(n)) { delete d.blocks[n]; nb++; changed = true; }
    }
  }
  if (what !== 'Blocks') {
    const used = new Set(['0', d.clayer]);
    const visit = (list) => { for (const e of list) { used.add(e.layer); } };
    visit(d.model); d.layouts.forEach((l) => visit(l.ents)); Object.values(d.blocks).forEach((b) => visit(b.ents));
    used.add('Viewports');
    const before = d.layers.length;
    d.layers = d.layers.filter((l) => used.has(l.name));
    nl = before - d.layers.length;
  }
  c.print(`Purged ${nb} block(s) and ${nl} layer(s).`);
  c.changed(); c.app.refreshUI();
});

defCmd('BLOCKSPALETTE', ['BP', 'BLOCKS', 'LIBRARY'], 'Show the Blocks panel (drawing blocks + symbol library)', function* (c) { c.app.showPanel('blocks'); }, { transparent: true });


/* ======================= ANNOTATION (group 3) ======================= */
defCmd('STYLE', ['ST', 'TEXTSTYLE'], 'Text styles (font, width factor, slant)', function* (c) { c.app.showPanel('styles'); }, { transparent: true });
defCmd('DIMSTYLE', ['D', 'DST', 'DDIM'], 'Dimension styles (arrows, sizes, decimals, scale)', function* (c) { c.app.showPanel('styles'); }, { transparent: true });

defCmd('DIMANGULAR', ['DAN', 'DIMANG'], 'Angular dimension (two lines, an arc, or 3 points)', function* (c) {
  const d = c.doc;
  const segOf = (s) => { if (s.e.type === 'line') return s.e; let best = null; for (const pr of E.prims(s.e)) if (pr.kind === 'seg' && (!best || G.primDist(pr, s.pt) < G.primDist(best, s.pt))) best = pr; return best ? { type: 'line', p1: best.a, p2: best.b, id: s.e.id } : null; };
  const s1 = yield P.ent('Select arc, circle, line, or Enter to specify vertex', { filter: (e) => ['line', 'arc', 'circle', 'pline'].includes(e.type), filterMsg: 'Select a line, polyline segment, arc or circle.' });
  let base = null, refs = {};
  if (!s1) {
    const v = yield P.point('Specify angle vertex'); if (!v) return; const rv = c.app.takeSnapRef();
    const a = yield P.point('Specify first angle endpoint', { base: v }); if (!a) return; const ra = c.app.takeSnapRef();
    const b = yield P.point('Specify second angle endpoint', { base: v }); if (!b) return; const rb = c.app.takeSnapRef();
    base = { c: v, p1: a, p2: b, mode: 'pts' }; refs = { c: rv, p1: ra, p2: rb };
  } else if (s1.e.type === 'arc') {
    base = { c: { ...s1.e.c }, p1: G.polar(s1.e.c, s1.e.a1, s1.e.r), p2: G.polar(s1.e.c, s1.e.a2, s1.e.r), mode: 'fixed' };
  } else if (s1.e.type === 'circle') {
    const b = yield P.point('Specify second angle endpoint'); if (!b) return;
    base = { c: { ...s1.e.c }, p1: E.paramAt(s1.e, s1.pt).pt, p2: b, mode: 'pts' };
  } else {
    const s2 = yield P.ent('Select second line', { filter: (e) => e.type === 'line' || e.type === 'pline', filterMsg: 'Select another line or polyline segment.' });
    if (!s2) return;
    const L1 = segOf(s1), L2 = segOf(s2);
    if (!L1 || !L2) { c.print('Select straight segments.'); return; }
    const h = G.segSeg(L1.p1, L1.p2, L2.p1, L2.p2, true, true)[0];
    if (!h) { c.print('Lines are parallel.'); return; }
    const v = { x: h.x, y: h.y };
    const reach = (l, u) => Math.max(G.dot(G.sub(l.p1, v), u), G.dot(G.sub(l.p2, v), u), 0);
    base = { c: v, l1: L1, l2: L2, mode: 'lines', reach };
  }
  let text = '';
  const mk = (m) => {
    let p1 = base.p1, p2 = base.p2;
    if (base.mode === 'lines') {
      const u1 = G.norm(G.sub(base.l1.p2, base.l1.p1)), u2 = G.norm(G.sub(base.l2.p2, base.l2.p1)), am = G.angle(base.c, m);
      let best = null;
      const cands = [];
      for (const da of [u1, G.mul(u1, -1)]) for (const db of [u2, G.mul(u2, -1)]) { cands.push({ d1: da, l1: base.l1, d2: db, l2: base.l2 }); cands.push({ d1: db, l1: base.l2, d2: da, l2: base.l1 }); }
      for (const k of cands) {
        const a1 = Math.atan2(k.d1.y, k.d1.x), sw = G.ccwSweep(a1, Math.atan2(k.d2.y, k.d2.x));
        if (sw < Math.PI + 1e-9 && G.normAng(am - a1) <= sw) { best = k; break; }
      }
      if (!best) best = cands[0];
      p1 = G.add(base.c, G.mul(best.d1, Math.max(base.reach(best.l1, best.d1), 1e-6)));
      p2 = G.add(base.c, G.mul(best.d2, Math.max(base.reach(best.l2, best.d2), 1e-6)));
    } else if (base.mode === 'pts') {
      const a1 = G.angle(base.c, p1), sw = G.ccwSweep(a1, G.angle(base.c, p2));
      if (G.normAng(G.angle(base.c, m) - a1) > sw) [p1, p2] = [p2, p1];
    }
    return { type: 'dim', kind: 'angular', c: { ...base.c }, p1, p2, pos: m, dimstyle: d.dimStyle, text };
  };
  for (;;) {
    const r = yield P.point('Specify dimension arc line location', { keywords: ['Text'], rubber: false, preview: (m) => [mk(m)] });
    if (!r) return;
    if (r.kw === 'Text') { const t = yield P.str('Enter dimension text (<> = measured value)', { def: '<>', spaces: true }); if (t != null) text = t === '<>' ? '' : t; continue; }
    const e = c.add(mk(r));
    if (base.mode === 'pts') setAssoc(e, refs);
    c.print(`Dimension text = ${fmtNum(G.ccwSweep(G.angle(e.c, e.p1), G.angle(e.c, e.p2)) / DEG, E.dstyle(e).adec)}°`);
    return;
  }
});

function* chainDim(c, mode) {
  const d = c.doc;
  let base = d.lastDimId ? c.get(d.lastDimId) : null;
  const okBase = (e) => e && e.type === 'dim' && (e.kind === 'linear' || e.kind === 'aligned');
  if (!okBase(base)) {
    const s = yield P.ent(`Select ${mode === 'baseline' ? 'base' : 'continued'} dimension`, { filter: okBase, filterMsg: 'Select a linear or aligned dimension.' });
    if (!s) return;
    base = s.e;
  }
  let k = 0, prev = base;
  for (;;) {
    const u = prev.kind === 'aligned' ? G.norm(G.sub(prev.p2, prev.p1)) : { x: Math.cos(prev.dirAng || 0), y: Math.sin(prev.dirAng || 0) };
    const n = G.perp(u), ang = Math.atan2(u.y, u.x);
    const st = E.dstyle(base);
    const o0 = G.dot(base.pos, n), side = Math.sign(o0 - G.dot(base.p1, n)) || 1;
    const mk = (q) => {
      const o = mode === 'baseline' ? o0 + side * (k + 1) * st.dli * st.scale : G.dot(prev.pos, n);
      const from = mode === 'baseline' ? base.p1 : prev.p2;
      return { type: 'dim', kind: 'linear', p1: { ...from }, p2: q, pos: G.add(q, G.mul(n, o - G.dot(q, n))), dirAng: ang, dimstyle: base.dimstyle, text: '' };
    };
    const r = yield P.point('Specify second extension line origin (Enter to finish)', { keywords: ['Select'], base: mode === 'baseline' ? base.p1 : prev.p2, rubber: false, preview: (m) => [mk(m)] });
    if (!r) return;
    if (r.kw === 'Select') {
      const s = yield P.ent('Select dimension', { filter: okBase, filterMsg: 'Select a linear or aligned dimension.' });
      if (s) { base = prev = s.e; k = 0; }
      continue;
    }
    const ref = c.app.takeSnapRef();
    const e = c.add(mk(r));
    const pRef = mode === 'baseline' ? (base.assoc && base.assoc.p1) : (prev.assoc && prev.assoc.p2);
    setAssoc(e, { p1: pRef, p2: ref });
    d.lastDimId = e.id;
    k++;
    if (mode === 'continue') prev = e;
  }
}
defCmd('DIMBASELINE', ['DBA', 'DIMBASE'], 'Baseline dimensions from the first extension line of the last dimension', (c) => chainDim(c, 'baseline'));
defCmd('DIMCONTINUE', ['DCO', 'DIMCONT'], 'Chain of dimensions continuing from the last dimension', (c) => chainDim(c, 'continue'));

defCmd('DIMORDINATE', ['DOR', 'DIMORD'], 'Ordinate dimension (X or Y distance from the origin 0,0)', function* (c) {
  const d = c.doc;
  const p1 = yield P.point('Specify feature location'); if (!p1) return;
  const ref = c.app.takeSnapRef();
  let axis = null, text = '';
  const mk = (m) => ({ type: 'dim', kind: 'ordinate', p1, pos: m, axis: axis || (Math.abs(m.x - p1.x) > Math.abs(m.y - p1.y) ? 'y' : 'x'), dimstyle: d.dimStyle, text });
  for (;;) {
    const r = yield P.point('Specify leader endpoint', { keywords: ['Xdatum', 'Ydatum', 'Text'], base: p1, rubber: false, preview: (m) => [mk(m)] });
    if (!r) return;
    if (r.kw === 'Xdatum') { axis = 'x'; continue; }
    if (r.kw === 'Ydatum') { axis = 'y'; continue; }
    if (r.kw === 'Text') { const t = yield P.str('Enter dimension text (<> = measured value)', { def: '<>', spaces: true }); if (t != null) text = t === '<>' ? '' : t; continue; }
    const e = c.add(mk(r));
    setAssoc(e, { p1: ref });
    return;
  }
});

defCmd('DIMREASSOCIATE', ['DRE'], 'Re-attach a dimension\'s points to geometry (pick snapped points again)', function* (c) {
  const s = yield P.ent('Select dimension', { filter: (e) => e.type === 'dim' && ['linear', 'aligned', 'ordinate'].includes(e.kind), filterMsg: 'Select a linear, aligned or ordinate dimension.' });
  if (!s) return;
  const e = s.e, refs = {};
  for (const k of e.kind === 'ordinate' ? ['p1'] : ['p1', 'p2']) {
    const p = yield P.point(`Specify ${k === 'p1' ? 'first' : 'second'} extension line origin (use an object snap)`);
    if (!p) return;
    e[k] = p; refs[k] = c.app.takeSnapRef();
  }
  setAssoc(e, refs);
  c.changed();
  c.print(Object.keys(e.assoc || {}).length ? 'Dimension is now associative.' : 'No object snaps were used — dimension is not associative.');
});

/* ---------- tables ---------- */
function* editCells(c, e, r0, c0) {
  let r = r0, col = c0;
  for (;;) {
    const g = E.tableGeom(e);
    const at = g.L(g.xs[col] + e.h * 0.6, g.ys[r] + (e.rh[r] - e.h) / 2);
    let t;
    try {
      c.app.tableCell = { id: e.id, r, c: col };
      t = yield P.text({ at, h: e.h, rot: 0, multiline: false, initial: e.cells[r][col] || '', align: 'left', width: e.cw[col] - e.h, msg: `Cell ${String.fromCharCode(65 + col)}${r + 1} (Tab = next cell, Enter = done)`, tabNext: true });
    } finally { c.app.tableCell = null; }
    if (t == null) return;
    e.cells[r][col] = t;
    c.changed();
    if (!c.app.lastEditorTab) return;
    col++;
    if (col >= e.cw.length) { col = 0; r++; }
    if (r >= e.rh.length) {
      const k = yield P.kw('Add a new row?', ['Yes', 'No'], { def: 'No' });
      if (!k || (k.kw || k) !== 'Yes') return;
      e.rh.push(e.rh[e.rh.length - 1]); e.cells.push(e.cw.map(() => ''));
      c.changed();
    }
  }
}
defCmd('TABLE', ['TB'], 'Insert a table and type into its cells', function* (c) {
  const d = c.doc;
  const cols = yield P.int('Enter number of columns', { def: d.tblCols || 3 }); if (!(cols >= 1 && cols <= 50)) return;
  const rows = yield P.int('Enter number of rows (including the header row)', { def: d.tblRows || 4 }); if (!(rows >= 1 && rows <= 500)) return;
  const h = d.textSize;
  const cw = yield P.dist('Specify column width', { def: d.tblCw || +(h * 16).toFixed(4) }); if (!(cw > 0)) return;
  const rh = yield P.dist('Specify row height', { def: d.tblRh || +(h * 2.6).toFixed(4) }); if (!(rh > 0)) return;
  Object.assign(d, { tblCols: cols, tblRows: rows, tblCw: cw, tblRh: rh });
  const mk = (p) => ({ type: 'table', p, rot: 0, h, style: d.textStyle, cw: Array(cols).fill(cw), rh: Array(rows).fill(rh), cells: Array.from({ length: rows }, () => Array(cols).fill('')) });
  const p = yield P.point('Specify insertion point (top-left corner)', { preview: (m) => [mk(m)] });
  if (!p) return;
  const e = c.add(mk(p));
  yield* editCells(c, e, 0, 0);
});
defCmd('TABLEDIT', ['TABLEEDIT', 'TED'], 'Edit table cells (Tab moves to the next cell)', function* (c, opts) {
  let e, cell;
  if (opts && opts.id) { e = c.get(opts.id); cell = E.tableCellAt(e, opts.pt) || { r: 0, c: 0 }; }
  else {
    const s = yield P.ent('Select a table cell', { filter: (x) => x.type === 'table', filterMsg: 'Select a table.' });
    if (!s) return;
    e = s.e; cell = E.tableCellAt(e, s.pt) || { r: 0, c: 0 };
  }
  yield* editCells(c, e, cell.r, cell.c);
});


/* ======================= LAYOUTS & PLOTTING (group 4) ======================= */
defCmd('LAYOUT', ['LO', 'LAYOUTS'], 'Create, switch, rename or delete layout sheets', function* (c) {
  const app = c.app, d = c.doc;
  const r = yield P.kw(`Layouts: ${d.layouts.map((l) => l.name).join(', ')}. Enter an option`, ['New', 'Set', 'Rename', 'Delete', 'Model']);
  if (r == null) return;
  const k = r.kw || r;
  if (k === 'Model') { app.setSpace(-1); return; }
  if (k === 'New') {
    const n = yield P.str('Enter new layout name', { def: app.uniqueLayoutName(), spaces: true }); if (!n) return;
    if (d.layouts.some((l) => l.name === n)) { c.print('A layout with that name exists.'); return; }
    d.layouts.push(newLayout(n.trim())); app.setSpace(d.layouts.length - 1); return;
  }
  const n = yield P.str(`Enter layout name`, { def: app.space >= 0 ? d.layouts[app.space].name : d.layouts[0].name, spaces: true }); if (!n) return;
  const i = d.layouts.findIndex((l) => l.name.toLowerCase() === n.trim().toLowerCase());
  if (i < 0) { c.print(`Layout "${n}" not found.`); return; }
  if (k === 'Set') app.setSpace(i);
  if (k === 'Delete') app.deleteLayout(i);
  if (k === 'Rename') {
    const nn = yield P.str('Enter new name', { spaces: true }); if (!nn) return;
    if (d.layouts.some((l) => l.name === nn.trim())) { c.print('A layout with that name exists.'); return; }
    d.layouts[i].name = nn.trim(); c.changed(); app.buildLayoutBar();
  }
}, { transparent: true });

defCmd('PAGESETUP', ['PSETUP'], 'Paper size and orientation of the current layout', function* (c) {
  const app = c.app, d = c.doc;
  if (app.space < 0) { c.print('Switch to a layout tab first (PAGESETUP sets the sheet of a layout; model plots choose paper in PLOT).'); return; }
  const L = d.layouts[app.space];
  const p = yield P.kw('Paper size', Object.keys(PAPERS), { def: L.paper }); if (p == null) return;
  const o = yield P.kw('Orientation', ['Landscape', 'Portrait'], { def: L.orient === 'portrait' ? 'Portrait' : 'Landscape' }); if (o == null) return;
  L.paper = p.kw || p; L.orient = (o.kw || o).toLowerCase();
  c.changed(); app.zoomExtents(); app.refreshUI();
}, { transparent: true });

defCmd('MVIEW', ['MV', 'VPORTS'], 'Create a layout viewport showing the model at a scale', function* (c) {
  const app = c.app, d = c.doc;
  if (app.space < 0) { c.print('Viewports live on layout sheets. Click a layout tab (bottom) first.'); return; }
  const L = d.layouts[app.space];
  const a = yield P.point('Specify corner of viewport', { keywords: ['Fit'] }); if (!a) return;
  let r;
  if (a.kw === 'Fit') { const ps = paperSize(L); r = { minx: 10, miny: 10, maxx: ps.w - 10, maxy: ps.h - 10 }; }
  else {
    const b = yield P.point('Specify opposite corner', { base: a, rubber: false, preview: (m) => [{ type: 'pline', pts: rectPts(a, m), closed: true }] });
    if (!b) return;
    r = rectOf(a, b);
    if (r.maxx - r.minx < 1 || r.maxy - r.miny < 1) { c.print('Viewport is too small.'); return; }
  }
  const vp = app.autoViewport(L, r);
  c.changed();
  c.print(`Viewport created at scale ${scaleLabel(d, vp.scale)}. Select its border to change the scale in Properties.`);
});

defCmd('MSPACE', ['MS'], 'Work inside a layout viewport (pan/zoom the model view)', function* (c) {
  const app = c.app;
  if (app.space < 0) { c.print('Already in model space.'); return; }
  const vps = c.doc.entities.filter((e) => e.type === 'viewport');
  if (!vps.length) { c.print('This layout has no viewports (use MVIEW).'); return; }
  let vp = vps.length === 1 ? vps[0] : null;
  if (!vp) { const s = yield P.ent('Select viewport border', { filter: (e) => e.type === 'viewport', filterMsg: 'Select a viewport border.' }); if (!s) return; vp = s.e; }
  app.activeVp = vp.id; app.buildLayoutBar(); app.requestRedraw();
  c.print('Inside viewport: mouse wheel zooms, middle-drag pans. Type PSPACE or press Esc to return to paper.');
}, { transparent: true });
defCmd('PSPACE', ['PS'], 'Return to paper space from inside a viewport', function* (c) { c.app.activeVp = null; c.app.buildLayoutBar(); c.app.requestRedraw(); }, { transparent: true });

defCmd('UNITS', ['UN'], 'Drawing units (used for plot and viewport scales)', function* (c) {
  const names = { mm: 'Millimeters', cm: 'Centimeters', m: 'Meters', in: 'Inches', ft: 'Feet' };
  const r = yield P.kw('Drawing units', Object.values(names), { def: names[c.doc.units || 'mm'] }); if (r == null) return;
  const v = r.kw || r;
  c.doc.units = Object.keys(names).find((k) => names[k] === v) || 'mm';
  c.print(`Drawing units: ${v}. A 1:100 plot now means 1 ${c.doc.units} on paper = 100 ${c.doc.units} in the drawing.`);
  c.app.refreshUI();
}, { transparent: true });
