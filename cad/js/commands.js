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

defCmd('PLINE', ['PL'], 'Draw a polyline (connected segments as one object)', function* (c) {
  const p0 = yield P.point('Specify start point');
  if (!p0) return;
  const pts = [p0];
  let closed = false;
  try {
    for (;;) {
      const last = pts[pts.length - 1];
      const kws = pts.length >= 3 ? ['Close', 'Undo'] : pts.length >= 2 ? ['Undo'] : [];
      const r = yield P.point('Specify next point', { keywords: kws, base: last, preview: (m) => [{ type: 'pline', pts: [...pts, m], closed: false }] });
      if (!r) return;
      if (r.kw === 'Undo') { if (pts.length > 1) pts.pop(); continue; }
      if (r.kw === 'Close') { closed = true; return; }
      pts.push(r);
    }
  } finally {
    if (pts.length >= 2) c.add({ type: 'pline', pts, closed });
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
    } else loops = findBoundary(c, r);
    if (!loops) { c.print('No closed boundary found. Boundaries must be closed polylines, rectangles, polygons, circles or ellipses.'); continue; }
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
    c.add({ type: 'text', p, h, rot: r, text: t, align });
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
  c.add({ type: 'mtext', p: at, h: d.textSize, rot: 0, width, text: t });
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
  c.add({ type: 'leader', pts, h: d.textSize, text: t });
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
  const p2 = yield P.point('Specify second extension line origin', { base: p1 });
  if (!p2) return;
  let text = '', fixed = null;
  const mk = (m) => ({ type: 'dim', kind, p1, p2, pos: m, dirAng: fixed != null ? fixed : autoDirAng(p1, p2, m), h: 2.5 * d.dimScale, scale: d.dimScale, text });
  for (;;) {
    const kws = kind === 'linear' ? ['Text', 'Horizontal', 'Vertical', 'Rotated'] : ['Text'];
    const r = yield P.point('Specify dimension line location', { keywords: kws, rubber: false, preview: (m) => [mk(m)] });
    if (!r) return;
    if (r.kw === 'Text') { const t = yield P.str('Enter dimension text (<> = measured value)', { def: '<>', spaces: true }); if (t != null) text = t === '<>' ? '' : t; continue; }
    if (r.kw === 'Horizontal') { fixed = 0; continue; }
    if (r.kw === 'Vertical') { fixed = Math.PI / 2; continue; }
    if (r.kw === 'Rotated') { const a = yield P.angle('Specify angle of dimension line', { def: 0 }); if (a != null) fixed = a * DEG; continue; }
    const e = c.add(mk(r));
    const meas = kind === 'aligned' ? G.dist(p1, p2) : Math.abs(G.dot(G.sub(p2, p1), { x: Math.cos(e.dirAng), y: Math.sin(e.dirAng) }));
    c.print(`Dimension text = ${fmtNum(meas, d.dimDec)}`);
    return;
  }
}
defCmd('DIMLINEAR', ['DLI', 'DIMLIN'], 'Horizontal / vertical dimension', (c) => dimCmd(c, 'linear'));
defCmd('DIMALIGNED', ['DAL', 'DIMALI'], 'Aligned dimension', (c) => dimCmd(c, 'aligned'));

function* dimRadCmd(c, kind) {
  const d = c.doc;
  const s = yield P.ent(`Select arc or circle`, { filter: (e) => e.type === 'circle' || e.type === 'arc', filterMsg: 'Object must be an arc or circle.' });
  if (!s) return;
  let text = '';
  const mk = (m) => ({ type: 'dim', kind, c: { ...s.e.c }, r: s.e.r, pos: m, h: 2.5 * d.dimScale, scale: d.dimScale, text });
  c.print(`Dimension text = ${fmtNum(kind === 'radius' ? s.e.r : 2 * s.e.r, d.dimDec)}`);
  for (;;) {
    const r = yield P.point('Specify dimension line location', { keywords: ['Text'], rubber: false, preview: (m) => [mk(m)] });
    if (!r) return;
    if (r.kw === 'Text') { const t = yield P.str('Enter dimension text (<> = measured value)', { def: '<>', spaces: true }); if (t != null) text = t === '<>' ? '' : t; continue; }
    c.add(mk(r)); return;
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
setVar('DIMSCALE', 'dimScale', 'Overall scale of dimension arrows/text');
setVar('DIMDEC', 'dimDec', 'Decimal places in dimensions', (v) => v >= 0 && v <= 8 && Number.isInteger(v));

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
defCmd('PLOT', ['PRINT'], 'Print the drawing (fit to page)', function* (c) { c.app.plot(); }, { transparent: true });
defCmd('HELP', ['?', 'COMMANDS'], 'Show the command reference (F1)', function* (c) { c.app.showHelp(); }, { transparent: true });
