'use strict';
/* Entity model. Every entity: {id, type, layer, color, ...geometry}.
 *  line     {p1,p2}
 *  pline    {pts,closed}
 *  circle   {c,r}
 *  arc      {c,r,a1,a2}            (counter-clockwise, radians)
 *  ellipse  {c,maj,ratio}          (maj = major semi-axis vector)
 *  text     {p,h,rot,text,align}   (single line; align left|center|right)
 *  mtext    {p,h,rot,width,text}   (multi line; p = top-left)
 *  leader   {pts,h,text}           (arrow at pts[0], note at last point)
 *  dim      {kind:linear|aligned|radius|diameter, p1,p2,pos,dirAng | c,r,pos, h, scale, text}
 *  revcloud {pts,arc}
 *  hatch    {loops,pattern,scale,angle}
 */
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';
const CAP_RATIO = 0.716; // cap height / em size for Arial
const LINE_SPACING = 1.6667;

const _measureCtx = document.createElement('canvas').getContext('2d');
const DEFAULT_TSTYLE = { name: 'Standard', font: 'Arial', width: 1, oblique: 0 };
const fontStack = (f) => (f && f !== 'Arial' ? `"${f}", ${FONT_FAMILY}` : FONT_FAMILY);
function textWidth(str, h, st) {
  st = st || DEFAULT_TSTYLE;
  _measureCtx.font = `100px ${fontStack(st.font)}`;
  return (_measureCtx.measureText(str || '').width / 100) * (h / CAP_RATIO) * (st.width || 1);
}
function wrapLines(text, h, width, st) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!width || width <= 0) { out.push(para); continue; }
    let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && textWidth(t, h, st) > width) { out.push(cur); cur = w; } else cur = t;
    }
    out.push(cur);
  }
  return out;
}

const HATCH_PATTERNS = {
  SOLID: null,
  ANSI31: [{ ang: 45, sp: 3.175 }],
  ANSI37: [{ ang: 45, sp: 3.175 }, { ang: 135, sp: 3.175 }],
  LINE: [{ ang: 0, sp: 3.175 }],
  NET: [{ ang: 0, sp: 3.175 }, { ang: 90, sp: 3.175 }],
  DASHED45: [{ ang: 45, sp: 6.35 }],
};

function fmtNum(v, dec = 2) {
  let s = (Math.round(v * 10 ** dec) / 10 ** dec).toFixed(dec);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

function arrowPts(tip, dir, size) {
  const base = G.sub(tip, G.mul(dir, size)), n = G.mul(G.perp(dir), size / 6);
  return [tip, G.add(base, n), G.sub(base, n)];
}

function readableAngle(a) {
  a = Math.atan2(Math.sin(a), Math.cos(a));
  if (a > Math.PI / 2 + 1e-6 || a < -Math.PI / 2 + 1e-6) a += Math.PI;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function ellipsePts(e, n = 96) {
  const min = G.mul(G.perp(e.maj), e.ratio), pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    pts.push({ x: e.c.x + e.maj.x * Math.cos(t) + min.x * Math.sin(t), y: e.c.y + e.maj.y * Math.cos(t) + min.y * Math.sin(t) });
  }
  return pts;
}

/* Polyline segments as primitives (straight or arc, from bulges). */
function plPrims(e) {
  const pts = e.pts, n = pts.length, cnt = e.closed ? n : n - 1, out = [];
  let off = 0;
  for (let i = 0; i < cnt; i++) {
    const a = pts[i], b = pts[(i + 1) % n], bu = (e.b && e.b[i]) || 0;
    const pr = Math.abs(bu) > 1e-9 && G.dist(a, b) > 1e-12 ? G.bulgePrim(a, b, bu, off) : G.seg(a, b, off);
    pr.i = i; out.push(pr); off += pr.len;
  }
  return out;
}
const hasBulges = (e) => !!(e.b && e.b.some((x) => Math.abs(x) > 1e-9));
/* Polyline as a point list (arcs tessellated). */
function plPoints(e) {
  if (!hasBulges(e)) return e.pts;
  const out = [];
  for (const p of plPrims(e)) {
    out.push(e.pts[p.i]);
    if (p.kind === 'arc') {
      const n = Math.max(2, Math.ceil(p.sweep / (3 * DEG)));
      for (let k = 1; k < n; k++) out.push(G.polar(p.c, p.a1 + (p.rev ? p.sweep * (1 - k / n) : (p.sweep * k) / n), p.r));
    }
  }
  if (!e.closed) out.push(e.pts[e.pts.length - 1]);
  return out;
}
const primMid = (pr) => (pr.kind === 'seg' ? G.mid(pr.a, pr.b) : G.polar(pr.c, pr.a1 + pr.sweep / 2, pr.r));
/* Centripetal Catmull-Rom curve through the fit points of a spline. */
function splinePts(e) {
  const P = e.fit, n = P.length;
  if (n < 3) return P.slice();
  const get = (i) => {
    if (e.closed) return P[((i % n) + n) % n];
    if (i < 0) return G.sub(G.mul(P[0], 2), P[1]);
    if (i > n - 1) return G.sub(G.mul(P[n - 1], 2), P[n - 2]);
    return P[i];
  };
  const out = [], cnt = e.closed ? n : n - 1, steps = 16;
  const L = (p, q, t0, t1, t) => (t1 - t0 < 1e-12 ? p : G.add(G.mul(p, (t1 - t) / (t1 - t0)), G.mul(q, (t - t0) / (t1 - t0))));
  for (let i = 0; i < cnt; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const t0 = 0, t1 = t0 + Math.sqrt(G.dist(p0, p1)) + 1e-9, t2 = t1 + Math.sqrt(G.dist(p1, p2)) + 1e-9, t3 = t2 + Math.sqrt(G.dist(p2, p3)) + 1e-9;
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const A1 = L(p0, p1, t0, t1, t), A2 = L(p1, p2, t1, t2, t), A3 = L(p2, p3, t2, t3, t);
      const B1 = L(A1, A2, t0, t2, t), B2 = L(A2, A3, t1, t3, t);
      out.push(L(B1, B2, t1, t2, t));
    }
  }
  if (!e.closed) out.push(P[n - 1]);
  return out;
}

function revcloudPts(pts, arcLen) {
  const out = [];
  if (pts.length < 3 || !(arcLen > 0)) return pts.slice();
  const sign = G.polyArea(pts) > 0 ? 1 : -1;
  const half = 60 * DEG;
  for (let i = 0; i < pts.length; i++) {
    const A = pts[i], B = pts[(i + 1) % pts.length];
    const L = G.dist(A, B);
    if (L < 1e-9) continue;
    const n = Math.max(1, Math.round(L / arcLen));
    const u = G.norm(G.sub(B, A));
    const outN = sign > 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
    for (let k = 0; k < n; k++) {
      const a = G.lerp(A, B, k / n), b = G.lerp(A, B, (k + 1) / n);
      const c = G.dist(a, b), R = c / (2 * Math.sin(half));
      const ctr = G.sub(G.mid(a, b), G.mul(outN, R * Math.cos(half)));
      const a0 = G.angle(ctr, a);
      const test = G.polar(ctr, a0 + 2 * half, R);
      const dirSign = G.dist(test, b) < c * 0.01 ? 1 : -1;
      for (let s = 0; s < 6; s++) out.push(G.polar(ctr, a0 + dirSign * (2 * half) * (s / 6), R));
    }
  }
  return out;
}

const E = {};
/* Blocks: E.ctxDoc is the current drawing (for block definitions); E.rev changes on every edit. */
E.ctxDoc = null;
E.rev = 0;
const _insCache = new WeakMap();
E.blockOf = (name) => (E.ctxDoc && E.ctxDoc.blocks ? E.ctxDoc.blocks[name] : null);
E.insertMatrix = (e) => { const blk = E.blockOf(e.name); return M2.insert(e.p, e.sx ?? 1, e.sy ?? 1, e.rot || 0, blk ? blk.base : { x: 0, y: 0 }); };
/* World-space child entities of a block reference (nested blocks flattened, attributes as text). */
E.children = (e, depth = 0) => {
  if (depth === 0) { const hit = _insCache.get(e); if (hit && hit.rev === E.rev) return hit.ents; }
  const blk = E.blockOf(e.name), out = [];
  if (blk && depth < 10) {
    const xf = XF.matrix(E.insertMatrix(e));
    const inherit = (c) => { if (!c.layer || c.layer === '0') c.layer = e.layer; if (!c.color || c.color === 'byblock') c.color = e.color; return c; };
    for (const c0 of blk.ents) {
      if (c0.type === 'attdef') continue;
      const c = inherit(E.clone(c0));
      if (c.type === 'insert') { for (const g of E.children(c, depth + 1)) out.push(E.transform(g, xf)); continue; }
      out.push(E.transform(c, xf));
    }
    for (const a of e.attribs || []) {
      if (a.invisible || a.value == null || a.value === '') continue;
      out.push(E.transform(inherit({ type: 'text', p: { ...a.p }, h: a.h, rot: a.rot || 0, text: String(a.value), align: a.align || 'left', layer: a.layer || '0', color: a.color || 'byblock' }), xf));
    }
  }
  if (depth === 0) _insCache.set(e, { rev: E.rev, ents: out });
  return out;
};
/* Simple world entities that make up e (block references expanded). */
E.flatten = (e) => (e.type === 'insert' ? E.children(e) : [e]);
/* Attribute values for a new reference of a block, from its attribute definitions. */
E.attribsFor = (blk, values = {}) => blk.ents.filter((c) => c.type === 'attdef').map((d) => ({
  tag: d.tag, value: values[d.tag] ?? d.def ?? '', p: { ...d.p }, h: d.h, rot: d.rot || 0, align: d.align || 'left', invisible: !!d.invisible, layer: d.layer, color: d.color,
}));

/* ---------- styles ---------- */
const DEFAULT_DSTYLE = { name: 'Standard', textStyle: 'Standard', txt: 2.5, asz: 2.5, arrow: 'closed', exo: 0.625, exe: 1.25, gap: 0.625, dec: 2, adec: 0, scale: 1, pre: '', suf: '', tad: 'above', dli: 3.75 };
E.tstyle = (name) => {
  const L = (E.ctxDoc && E.ctxDoc.textStyles) || [];
  return L.find((x) => x.name === name) || L.find((x) => x.name === 'Standard') || L[0] || DEFAULT_TSTYLE;
};
/* Effective dimension style of a dimension (legacy dims without a style keep their own size). */
E.dstyle = (e) => {
  const L = (E.ctxDoc && E.ctxDoc.dimStyles) || [];
  if (e.dimstyle) { const st = L.find((x) => x.name === e.dimstyle); if (st) return { ...DEFAULT_DSTYLE, ...st }; }
  const sc = e.scale || 1;
  return { ...DEFAULT_DSTYLE, scale: sc, txt: (e.h || 2.5 * sc) / sc, dec: E.ctxDoc ? E.ctxDoc.dimDec ?? 2 : 2 };
};
E.dimText = (e, meas, st) => {
  const v = e.kind === 'angular' ? fmtNum(meas, st.adec ?? 0) + '°' : (st.pre || '') + fmtNum(meas, st.dec) + (st.suf || '');
  if (e.text && e.text.length) return e.text.replace('<>', v);
  if (e.kind === 'radius') return 'R' + v;
  if (e.kind === 'diameter') return '⌀' + v;
  return v;
};
/* Arrowhead at tip; dir points from the dimension line into the tip; ln = direction of the dim line. */
function arrowOps(tip, dir, asz, type, ln) {
  switch (type) {
    case 'none': return [];
    case 'tick': { const t = G.rotate(ln || dir, { x: 0, y: 0 }, Math.PI / 4); return [{ op: 'poly', pts: [G.sub(tip, G.mul(t, asz / 2)), G.add(tip, G.mul(t, asz / 2))], lw: 2 }]; }
    case 'dot': { const pts = []; for (let i = 0; i < 16; i++) pts.push(G.polar(tip, (i / 16) * TAU, asz / 4)); return [{ op: 'fill', pts }]; }
    case 'open': { const p = arrowPts(tip, dir, asz); return [{ op: 'poly', pts: [p[1], p[0], p[2]] }]; }
    default: return [{ op: 'fill', pts: arrowPts(tip, dir, asz) }];
  }
}

E.dimOps = (e) => {
  const st = E.dstyle(e), s = st.scale || 1;
  const asz = st.asz * s, th = st.txt * s, gap = st.gap * s, exo = st.exo * s, exe = st.exe * s;
  const tst = st.textStyle, ops = [];
  const text = (p, rot, str, align) => ops.push({ op: 'text', p, h: th, rot, str, align, style: tst });
  if (e.kind === 'radius' || e.kind === 'diameter') {
    const r = e.r, c = e.c;
    let dir = G.norm(G.sub(e.pos, c));
    if (G.len(G.sub(e.pos, c)) < 1e-9) dir = { x: 1, y: 0 };
    const tip = G.polar(c, Math.atan2(dir.y, dir.x), r);
    const outside = G.dist(e.pos, c) > r;
    const meas = e.kind === 'radius' ? r : 2 * r;
    const arrowT = st.arrow === 'tick' ? 'closed' : st.arrow;
    if (e.kind === 'radius') {
      ops.push({ op: 'poly', pts: outside ? [c, e.pos] : [c, tip] });
      ops.push(...arrowOps(tip, outside ? G.mul(dir, -1) : dir, asz, arrowT));
    } else {
      const tip2 = G.sub(c, G.mul(dir, r));
      ops.push({ op: 'poly', pts: outside ? [tip2, e.pos] : [tip2, tip] });
      ops.push(...arrowOps(tip, outside ? G.mul(dir, -1) : dir, asz, arrowT));
      ops.push(...arrowOps(tip2, G.mul(dir, -1), asz, arrowT));
    }
    const right = e.pos.x >= c.x;
    const land = { x: e.pos.x + (right ? 1 : -1) * asz, y: e.pos.y };
    if (outside) ops.push({ op: 'poly', pts: [e.pos, land] });
    const tp = outside ? { x: land.x + (right ? gap : -gap), y: e.pos.y - th / 2 } : { x: e.pos.x, y: e.pos.y + gap };
    text(tp, 0, E.dimText(e, meas, st), outside ? (right ? 'left' : 'right') : 'center');
    return ops;
  }
  if (e.kind === 'angular') {
    const c = e.c, a1 = G.angle(c, e.p1), a2 = G.angle(c, e.p2), sw = G.ccwSweep(a1, a2), r = Math.max(G.dist(c, e.pos), 1e-9);
    for (const [a, p] of [[a1, e.p1], [a2, e.p2]]) {
      const rp = G.dist(c, p);
      if (r > rp + gap) ops.push({ op: 'poly', pts: [G.polar(c, a, rp + exo), G.polar(c, a, r + exe)] });
    }
    ops.push({ op: 'arc', c, r, a1, a2 });
    const e1 = G.polar(c, a1, r), e2 = G.polar(c, a2, r);
    const t1 = { x: Math.sin(a1), y: -Math.cos(a1) }, t2 = { x: -Math.sin(a2), y: Math.cos(a2) };
    const inside = r * sw > asz * 2.6;
    ops.push(...arrowOps(e1, inside ? t1 : G.mul(t1, -1), asz, st.arrow, t2));
    ops.push(...arrowOps(e2, inside ? t2 : G.mul(t2, -1), asz, st.arrow, t2));
    const am = a1 + sw / 2, raw = am - Math.PI / 2, ta = readableAngle(raw);
    const flipped = Math.abs(Math.atan2(Math.sin(ta - raw), Math.cos(ta - raw))) > 1;
    text(G.polar(c, am, r + gap + (flipped ? th : 0)), ta, E.dimText(e, sw / DEG, st), 'center');
    return ops;
  }
  if (e.kind === 'ordinate') {
    const axis = e.axis || 'x', p1 = e.p1, pos = e.pos;
    const val = axis === 'x' ? p1.x : p1.y;
    if (axis === 'x') {
      const sg = pos.y >= p1.y ? 1 : -1;
      ops.push({ op: 'poly', pts: [{ x: p1.x, y: p1.y + sg * exo }, { x: p1.x, y: pos.y - sg * Math.min(Math.abs(pos.y - p1.y) / 3, asz * 2) }, pos] });
      text({ x: pos.x + th / 2, y: pos.y + sg * gap }, Math.PI / 2, E.dimText(e, val, st), sg > 0 ? 'left' : 'right');
    } else {
      const sg = pos.x >= p1.x ? 1 : -1;
      ops.push({ op: 'poly', pts: [{ x: p1.x + sg * exo, y: p1.y }, { x: pos.x - sg * Math.min(Math.abs(pos.x - p1.x) / 3, asz * 2), y: p1.y }, pos] });
      text({ x: pos.x + sg * gap, y: pos.y - th / 2 }, 0, E.dimText(e, val, st), sg > 0 ? 'left' : 'right');
    }
    return ops;
  }
  let u;
  if (e.kind === 'aligned') u = G.norm(G.sub(e.p2, e.p1));
  else u = { x: Math.cos(e.dirAng || 0), y: Math.sin(e.dirAng || 0) };
  if (G.len(G.sub(e.p2, e.p1)) < 1e-12 && e.kind === 'aligned') u = { x: 1, y: 0 };
  const n = G.perp(u);
  const d1 = G.add(e.p1, G.mul(n, G.dot(G.sub(e.pos, e.p1), n)));
  const d2 = G.add(e.p2, G.mul(n, G.dot(G.sub(e.pos, e.p2), n)));
  const meas = Math.abs(G.dot(G.sub(e.p2, e.p1), u));
  for (const [p, d] of [[e.p1, d1], [e.p2, d2]]) {
    const v = G.sub(d, p), l = G.len(v);
    const nn = l > 1e-9 ? G.mul(v, 1 / l) : n;
    if (l > exo) ops.push({ op: 'poly', pts: [G.add(p, G.mul(nn, exo)), G.add(d, G.mul(nn, exe))] });
    else ops.push({ op: 'poly', pts: [d, G.add(d, G.mul(nn, exe))] });
  }
  const dd = G.dist(d1, d2);
  const du = dd > 1e-9 ? G.norm(G.sub(d2, d1)) : u;
  const str = E.dimText(e, meas, st);
  const tw = textWidth(str, th, E.tstyle(tst));
  const ta = readableAngle(Math.atan2(du.y, du.x));
  const up = { x: -Math.sin(ta), y: Math.cos(ta) };
  const mid = G.mid(d1, d2);
  const inside = st.arrow === 'tick' || st.arrow === 'none' || st.arrow === 'dot' ? dd > asz : dd > asz * 2.6;
  const centered = st.tad === 'centered' && dd > tw + 2 * gap + 2 * asz;
  if (inside) {
    if (centered) {
      ops.push({ op: 'poly', pts: [d1, G.sub(mid, G.mul(du, tw / 2 + gap))] });
      ops.push({ op: 'poly', pts: [G.add(mid, G.mul(du, tw / 2 + gap)), d2] });
    } else ops.push({ op: 'poly', pts: [d1, d2] });
    ops.push(...arrowOps(d1, G.mul(du, -1), asz, st.arrow, du));
    ops.push(...arrowOps(d2, du, asz, st.arrow, du));
  } else {
    ops.push({ op: 'poly', pts: [G.sub(d1, G.mul(du, asz * 2)), G.add(d2, G.mul(du, asz * 2))] });
    ops.push(...arrowOps(d1, du, asz, st.arrow, du));
    ops.push(...arrowOps(d2, G.mul(du, -1), asz, st.arrow, du));
  }
  text(centered ? G.sub(mid, G.mul(up, th / 2)) : G.add(mid, G.mul(up, gap)), ta, str, 'center');
  return ops;
};

/* ---------- tables ---------- */
E.tableGeom = (e) => {
  const W = e.cw.reduce((a, b) => a + b, 0), H = e.rh.reduce((a, b) => a + b, 0);
  const xs = [0], ys = [0];
  for (const w of e.cw) xs.push(xs[xs.length - 1] + w);
  for (const h of e.rh) ys.push(ys[ys.length - 1] + h);
  const L = (x, y) => G.add(e.p, G.rotate({ x, y: -y }, { x: 0, y: 0 }, e.rot || 0));
  return { W, H, xs, ys, L };
};
E.tableCellAt = (e, pt) => {
  const g = E.tableGeom(e);
  const q = G.rotate(G.sub(pt, e.p), { x: 0, y: 0 }, -(e.rot || 0));
  const x = q.x, y = -q.y;
  if (x < 0 || y < 0 || x > g.W || y > g.H) return null;
  let c = 0, r = 0;
  while (c < e.cw.length - 1 && x > g.xs[c + 1]) c++;
  while (r < e.rh.length - 1 && y > g.ys[r + 1]) r++;
  return { r, c };
};
function tableOps(e) {
  const g = E.tableGeom(e), ops = [], h = e.h, rot = e.rot || 0, st = E.tstyle(e.style);
  ops.push({ op: 'poly', pts: [g.L(0, 0), g.L(g.W, 0), g.L(g.W, g.H), g.L(0, g.H)], closed: true });
  for (let i = 1; i < g.ys.length - 1; i++) ops.push({ op: 'poly', pts: [g.L(0, g.ys[i]), g.L(g.W, g.ys[i])] });
  for (let j = 1; j < g.xs.length - 1; j++) ops.push({ op: 'poly', pts: [g.L(g.xs[j], 0), g.L(g.xs[j], g.H)] });
  e.cells.forEach((row, r) => row.forEach((txt, c) => {
    if (txt == null || txt === '') return;
    const lines = wrapLines(String(txt), h, e.cw[c] - h * 1.2, st);
    const bh = h + (lines.length - 1) * h * LINE_SPACING;
    const top = g.ys[r] + (e.rh[r] - bh) / 2;
    const center = r === 0 && e.header !== false;
    lines.forEach((str, k) => ops.push({ op: 'text', p: g.L(center ? g.xs[c] + e.cw[c] / 2 : g.xs[c] + h * 0.6, top + h + k * h * LINE_SPACING), h, rot, str, align: center ? 'center' : 'left', style: e.style }));
  }));
  return ops;
}

E.leaderGeom = (e) => {
  const pts = e.pts, n = pts.length, h = e.h || 2.5;
  const last = pts[n - 1], prev = pts[n - 2] || G.add(last, { x: -1, y: 0 });
  const dir = last.x >= prev.x ? 1 : -1;
  const land = { x: last.x + dir * h * 1.5, y: last.y };
  const lines = String(e.text ?? '').split('\n');
  const tx = land.x + dir * h * 0.6;
  return { dir, land, lines, tx, firstBase: last.y - h / 2 };
};

/* Drawing operations (world coordinates). */
E.ops = (e, doc) => {
  const dec = doc ? doc.dimDec : 2;
  switch (e.type) {
    case 'line': return [{ op: 'poly', pts: [e.p1, e.p2] }];
    case 'pline': return [{ op: 'poly', pts: plPoints(e), closed: !!e.closed }];
    case 'spline': return [{ op: 'poly', pts: splinePts(e), closed: !!e.closed }];
    case 'circle': return [{ op: 'circle', c: e.c, r: e.r }];
    case 'arc': return [{ op: 'arc', c: e.c, r: e.r, a1: e.a1, a2: e.a2 }];
    case 'ellipse': return [{ op: 'ellipse', c: e.c, rx: G.len(e.maj), ry: G.len(e.maj) * e.ratio, rot: Math.atan2(e.maj.y, e.maj.x) }];
    case 'text': return [{ op: 'text', p: e.p, h: e.h, rot: e.rot || 0, str: e.text, align: e.align || 'left', style: e.style }];
    case 'mtext': {
      const lines = wrapLines(e.text, e.h, e.width, E.tstyle(e.style)), rot = e.rot || 0;
      return lines.map((str, i) => ({ op: 'text', p: G.rotate(G.add(e.p, { x: 0, y: -e.h - i * e.h * LINE_SPACING }), e.p, rot), h: e.h, rot, str, align: 'left', style: e.style }));
    }
    case 'table': return tableOps(e);
    case 'viewport': return [{ op: 'poly', pts: vpCorners(e), closed: true }];
    case 'image': return [{ op: 'image', p: e.p, w: e.w, h: e.h, rot: e.rot || 0, src: e.src, opacity: e.opacity ?? 1 }];
    case 'leader': {
      const g = E.leaderGeom(e), h = e.h || 2.5, ops = [];
      ops.push({ op: 'poly', pts: [...e.pts, g.land] });
      if (e.pts.length > 1) {
        const d = G.norm(G.sub(e.pts[0], e.pts[1]));
        ops.push({ op: 'fill', pts: arrowPts(e.pts[0], d, h) });
      }
      g.lines.forEach((str, i) => ops.push({ op: 'text', p: { x: g.tx, y: g.firstBase - i * h * LINE_SPACING }, h, rot: 0, str, align: g.dir > 0 ? 'left' : 'right', style: e.style }));
      return ops;
    }
    case 'dim': return E.dimOps(e);
    case 'revcloud': return [{ op: 'poly', pts: revcloudPts(e.pts, e.arc), closed: true }];
    case 'hatch': return [{ op: 'hatch', loops: e.loops, pattern: e.pattern, scale: e.scale, angle: e.angle }];
    case 'attdef': return [{ op: 'text', p: e.p, h: e.h, rot: e.rot || 0, str: e.tag, align: e.align || 'left', style: e.style }];
    case 'insert': { const out = []; for (const c of E.children(e)) for (const op of E.ops(c, doc)) out.push(op); return out; }
  }
  return [];
};

E.textBox = (op) => {
  const h = op.h, w = op.str ? textWidth(op.str, h, E.tstyle(op.style)) : h * 0.5;
  const x0 = op.align === 'center' ? -w / 2 : op.align === 'right' ? -w : 0;
  return [{ x: x0, y: -0.22 * h }, { x: x0 + w, y: -0.22 * h }, { x: x0 + w, y: 1.08 * h }, { x: x0, y: 1.08 * h }]
    .map((q) => G.add(op.p, G.rotate(q, { x: 0, y: 0 }, op.rot || 0)));
};

function segsOf(pts, closed) {
  const out = [];
  let off = 0;
  const cnt = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < cnt; i++) { const s = G.seg(pts[i], pts[(i + 1) % pts.length], off); out.push(s); off += s.len; }
  return out;
}

/* Outline items used for picking, bounding boxes and crossing selection. */
E.outline = (e, doc) => {
  const out = [];
  const addAll = (arr) => { for (const x of arr) out.push(x); };
  for (const op of E.ops(e, doc)) {
    switch (op.op) {
      case 'poly': addAll(segsOf(op.pts, op.closed)); break;
      case 'fill': addAll(segsOf(op.pts, true)); break;
      case 'circle': out.push(G.arcPrim(op.c, op.r, 0, TAU)); break;
      case 'arc': out.push(G.arcPrim(op.c, op.r, op.a1, G.ccwSweep(op.a1, op.a2))); break;
      case 'ellipse': addAll(segsOf(ellipsePts(e), true)); break;
      case 'text': { const b = E.textBox(op); out.push({ kind: 'box', pts: b }); addAll(segsOf(b, true)); break; }
      case 'hatch': out.push({ kind: 'region', loops: op.loops }); for (const l of op.loops) addAll(segsOf(l, true)); break;
    }
  }
  if (e.type === 'table') { const g = E.tableGeom(e); out.push({ kind: 'box', pts: [g.L(0, 0), g.L(g.W, 0), g.L(g.W, g.H), g.L(0, g.H)] }); }
  if (e.type === 'image') { const c = imgCorners(e); out.push({ kind: 'region', loops: [c] }); addAll(segsOf(c, true)); }
  return out;
};

/* Geometric edges (for intersections, trimming, extending). */
E.prims = (e) => {
  switch (e.type) {
    case 'line': return [G.seg(e.p1, e.p2, 0)];
    case 'pline': return plPrims(e);
    case 'spline': return segsOf(splinePts(e), e.closed);
    case 'circle': return [G.arcPrim(e.c, e.r, 0, TAU)];
    case 'arc': return [G.arcPrim(e.c, e.r, e.a1, G.ccwSweep(e.a1, e.a2))];
    case 'ellipse': return segsOf(ellipsePts(e), true);
    case 'revcloud': return segsOf(revcloudPts(e.pts, e.arc), true);
    case 'viewport': return segsOf(vpCorners(e), true);
    case 'insert': { const out = []; for (const c of E.children(e)) for (const p of E.prims(c)) out.push(p); return out; }
  }
  return [];
};

E.hitDist = (e, p, tol, doc) => {
  let best = Infinity;
  for (const o of E.outline(e, doc)) {
    if (o.kind === 'box') { if (G.pointInPoly(p, o.pts)) return 0; }
    else if (o.kind === 'region') { if (G.pointInLoops(p, o.loops)) best = Math.min(best, tol * 0.8); }
    else best = Math.min(best, G.primDist(o, p));
  }
  return best;
};

E.bbox = (e, doc) => {
  const b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
  const add = (p) => { b.minx = Math.min(b.minx, p.x); b.miny = Math.min(b.miny, p.y); b.maxx = Math.max(b.maxx, p.x); b.maxy = Math.max(b.maxy, p.y); };
  for (const o of E.outline(e, doc)) {
    if (o.kind === 'seg') { add(o.a); add(o.b); }
    else if (o.kind === 'arc') {
      add(G.polar(o.c, o.a1, o.r)); add(G.polar(o.c, o.a1 + o.sweep, o.r));
      for (let k = 0; k < 4; k++) { const th = G.normAng(k * Math.PI / 2 - o.a1); if (o.sweep >= TAU - 1e-9 || th <= o.sweep) add(G.polar(o.c, k * Math.PI / 2, o.r)); }
    } else if (o.kind === 'box') o.pts.forEach(add);
  }
  return b;
};

E.inRect = (e, r, crossing, doc) => {
  const b = E.bbox(e, doc);
  if (!isFinite(b.minx)) return false;
  if (b.minx >= r.minx && b.maxx <= r.maxx && b.miny >= r.miny && b.maxy <= r.maxy) return true;
  if (!crossing) return false;
  if (b.maxx < r.minx || b.minx > r.maxx || b.maxy < r.miny || b.miny > r.maxy) return false;
  const corners = [{ x: r.minx, y: r.miny }, { x: r.maxx, y: r.miny }, { x: r.maxx, y: r.maxy }, { x: r.minx, y: r.maxy }];
  for (const o of E.outline(e, doc)) {
    if (o.kind === 'seg') { if (G.segRectHit(o.a, o.b, r)) return true; }
    else if (o.kind === 'arc') {
      const n = 48;
      let prev = G.polar(o.c, o.a1, o.r);
      for (let i = 1; i <= n; i++) { const q = G.polar(o.c, o.a1 + (o.sweep * i) / n, o.r); if (G.segRectHit(prev, q, r)) return true; prev = q; }
    } else if (o.kind === 'box') { if (corners.some((c) => G.pointInPoly(c, o.pts))) return true; }
    else if (o.kind === 'region') { if (corners.some((c) => G.pointInLoops(c, o.loops))) return true; }
  }
  return false;
};

/* Object snap candidates. */
E.snaps = (e, doc) => {
  const s = [];
  const add = (type, pt) => s.push({ type, pt });
  switch (e.type) {
    case 'line': add('end', e.p1); add('end', e.p2); add('mid', G.mid(e.p1, e.p2)); break;
    case 'pline': e.pts.forEach((p) => add('end', p)); for (const pr of plPrims(e)) { add('mid', primMid(pr)); if (pr.kind === 'arc') add('cen', pr.c); } break;
    case 'spline': if (e.fit.length) { add('end', e.fit[0]); add('end', e.fit[e.fit.length - 1]); } e.fit.forEach((p) => add('node', p)); break;
    case 'circle': add('cen', e.c); for (let k = 0; k < 4; k++) add('quad', G.polar(e.c, k * Math.PI / 2, e.r)); break;
    case 'arc': {
      const sw = G.ccwSweep(e.a1, e.a2);
      add('end', G.polar(e.c, e.a1, e.r)); add('end', G.polar(e.c, e.a2, e.r)); add('mid', G.polar(e.c, e.a1 + sw / 2, e.r)); add('cen', e.c);
      for (let k = 0; k < 4; k++) if (G.normAng(k * Math.PI / 2 - e.a1) <= sw) add('quad', G.polar(e.c, k * Math.PI / 2, e.r));
      break;
    }
    case 'ellipse': { const mn = G.mul(G.perp(e.maj), e.ratio); add('cen', e.c); [e.maj, G.mul(e.maj, -1), mn, G.mul(mn, -1)].forEach((v) => add('quad', G.add(e.c, v))); break; }
    case 'text': case 'mtext': case 'attdef': add('ins', e.p); break;
    case 'insert': { add('ins', e.p); const ch = E.children(e); if (ch.length < 3000) for (const c of ch) for (const q of E.snaps(c, doc)) s.push(q); break; }
    case 'leader': e.pts.forEach((p) => add('end', p)); break;
    case 'revcloud': e.pts.forEach((p) => add('end', p)); break;
    case 'viewport': vpCorners(e).forEach((p) => add('end', p)); break;
    case 'image': imgCorners(e).forEach((p) => add('end', p)); break;
    case 'dim':
      for (const op of E.ops(e, doc)) if (op.op === 'poly') { add('end', op.pts[0]); add('end', op.pts[op.pts.length - 1]); }
      break;
  }
  return s;
};

/* Grips (editable points). */
E.grips = (e) => {
  switch (e.type) {
    case 'line': return [e.p1, G.mid(e.p1, e.p2), e.p2];
    case 'pline': return [...e.pts, ...plPrims(e).map(primMid)];
    case 'spline': return e.fit.slice();
    case 'leader': case 'revcloud': return e.pts.slice();
    case 'circle': return [e.c, ...[0, 1, 2, 3].map((k) => G.polar(e.c, k * Math.PI / 2, e.r))];
    case 'arc': { const sw = G.ccwSweep(e.a1, e.a2); return [G.polar(e.c, e.a1, e.r), G.polar(e.c, e.a1 + sw / 2, e.r), G.polar(e.c, e.a2, e.r), e.c]; }
    case 'ellipse': { const mn = G.mul(G.perp(e.maj), e.ratio); return [e.c, G.add(e.c, e.maj), G.sub(e.c, e.maj), G.add(e.c, mn), G.sub(e.c, mn)]; }
    case 'text': case 'mtext': case 'attdef': case 'insert': return [e.p];
    case 'dim': return E.dimKeys(e).map((k) => e[k]);
    case 'table': return [e.p];
    case 'viewport': return vpCorners(e);
    case 'image': return imgCorners(e);
  }
  return [];
};

E.setGrip = (e, i, p) => {
  switch (e.type) {
    case 'line':
      if (i === 0) e.p1 = p; else if (i === 2) e.p2 = p;
      else { const d = G.sub(p, G.mid(e.p1, e.p2)); e.p1 = G.add(e.p1, d); e.p2 = G.add(e.p2, d); }
      break;
    case 'pline': {
      const n = e.pts.length;
      if (i < n) { e.pts[i] = p; break; }
      const j = i - n, a = e.pts[j], b = e.pts[(j + 1) % n], bu = (e.b && e.b[j]) || 0;
      if (Math.abs(bu) > 1e-9) { // arc segment: make it pass through the dragged point
        if (!e.b) e.b = e.pts.map(() => 0);
        e.b[j] = G.bulge3(a, p, b);
      } else { // straight segment: move it parallel
        const d = G.sub(p, G.mid(a, b));
        e.pts[j] = G.add(a, d); e.pts[(j + 1) % n] = G.add(b, d);
      }
      break;
    }
    case 'spline': e.fit[i] = p; break;
    case 'leader': case 'revcloud': e.pts[i] = p; break;
    case 'circle': if (i === 0) e.c = p; else e.r = Math.max(1e-9, G.dist(e.c, p)); break;
    case 'arc': {
      const g = E.grips(e);
      if (i === 3) { e.c = p; break; }
      g[i] = p;
      const a = G.arc3(g[0], g[1], g[2]);
      if (a) Object.assign(e, a);
      break;
    }
    case 'ellipse': {
      if (i === 0) { e.c = p; break; }
      const minLen = G.len(e.maj) * e.ratio;
      if (i === 1 || i === 2) {
        const v = i === 1 ? G.sub(p, e.c) : G.sub(e.c, p);
        if (G.len(v) > 1e-9) { e.maj = v; e.ratio = minLen / G.len(v); }
      } else {
        const r = G.dist(e.c, p) / G.len(e.maj);
        e.ratio = r;
      }
      if (e.ratio > 1) { const ml = G.len(e.maj) * e.ratio; e.maj = G.mul(G.norm(G.perp(e.maj)), ml); e.ratio = 1 / e.ratio; }
      break;
    }
    case 'text': case 'mtext': case 'attdef': case 'insert': e.p = p; break;
    case 'dim': { const k = E.dimKeys(e)[i]; if (k) e[k] = p; if (k !== 'pos' && e.assoc) delete e.assoc[k]; break; }
    case 'table': e.p = p; break;
    case 'image': { // scale about the opposite corner, keeping the aspect ratio
      const c = imgCorners(e), opp = c[(i + 2) % 4], d0 = G.dist(c[i], opp), d1 = G.dist(p, opp);
      if (d0 < 1e-12 || d1 < 1e-12) break;
      E.transform(e, XF.scale(opp, d1 / d0));
      break;
    }
    case 'viewport': {
      const c = vpCorners(e), opp = c[(i + 2) % 4];
      e.p1 = { x: Math.min(p.x, opp.x), y: Math.min(p.y, opp.y) }; e.p2 = { x: Math.max(p.x, opp.x), y: Math.max(p.y, opp.y) };
      break;
    }
  }
};

E.clone = (e) => JSON.parse(JSON.stringify(e));
function imgCorners(e) { const r = e.rot || 0; return [{ x: 0, y: 0 }, { x: e.w, y: 0 }, { x: e.w, y: e.h }, { x: 0, y: e.h }].map((q) => G.add(e.p, G.rotate(q, { x: 0, y: 0 }, r))); }
function vpCorners(e) { return [{ x: e.p1.x, y: e.p1.y }, { x: e.p2.x, y: e.p1.y }, { x: e.p2.x, y: e.p2.y }, { x: e.p1.x, y: e.p2.y }]; }
E.dimKeys = (e) => (e.kind === 'radius' || e.kind === 'diameter' ? ['pos'] : e.kind === 'angular' ? ['c', 'p1', 'p2', 'pos'] : e.kind === 'ordinate' ? ['p1', 'pos'] : ['p1', 'p2', 'pos']);

E.transform = (e, xf) => {
  const P = xf.p, s = Math.abs(xf.s);
  const angOf = (a) => { const v = xf.v({ x: Math.cos(a), y: Math.sin(a) }); return Math.atan2(v.y, v.x); };
  switch (e.type) {
    case 'line': e.p1 = P(e.p1); e.p2 = P(e.p2); break;
    case 'pline': case 'revcloud': e.pts = e.pts.map(P); if (e.type === 'revcloud') e.arc *= s; if (e.b && xf.mirror) e.b = e.b.map((x) => -x); break;
    case 'spline': e.fit = e.fit.map(P); break;
    case 'leader': e.pts = e.pts.map(P); e.h *= s; break;
    case 'circle': e.c = P(e.c); e.r *= s; break;
    case 'arc': {
      const st = P(G.polar(e.c, e.a1, e.r)), en = P(G.polar(e.c, e.a2, e.r));
      e.c = P(e.c); e.r *= s;
      if (xf.mirror) { e.a1 = G.angle(e.c, en); e.a2 = G.angle(e.c, st); } else { e.a1 = G.angle(e.c, st); e.a2 = G.angle(e.c, en); }
      break;
    }
    case 'ellipse': e.c = P(e.c); e.maj = xf.v(e.maj); break;
    case 'insert':
      e.p = P(e.p); e.sx = (e.sx ?? 1) * s; e.sy = (e.sy ?? 1) * s;
      if (xf.mirror) { e.rot = xf.rot - (e.rot || 0); e.sy = -e.sy; } else e.rot = (e.rot || 0) + xf.rot;
      break;
    case 'text': case 'mtext': case 'attdef':
      e.p = P(e.p); e.h *= s; if (e.width) e.width *= s;
      if (!xf.mirror) e.rot = angOf(e.rot || 0);
      else if (e.type === 'mtext') { /* keep readable */ }
      break;
    case 'dim':
      for (const k of ['p1', 'p2', 'pos', 'c']) if (e[k]) e[k] = P(e[k]);
      if (e.r) e.r *= s;
      if (e.kind === 'linear') e.dirAng = angOf(e.dirAng || 0);
      if (e.kind === 'angular' && xf.mirror) [e.p1, e.p2] = [e.p2, e.p1];
      if (e.kind === 'ordinate' && Math.abs(Math.sin(xf.rot)) > 0.7 && !xf.mirror) e.axis = e.axis === 'x' ? 'y' : 'x';
      break;
    case 'image': {
      const c = imgCorners(e).map(P);
      if (xf.mirror) { e.p = c[1]; e.rot = Math.atan2(c[0].y - c[1].y, c[0].x - c[1].x); } else { e.p = c[0]; e.rot = Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x); }
      e.w *= s; e.h *= s;
      break;
    }
    case 'viewport': {
      const a = P(e.p1), b = P(e.p2);
      e.p1 = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }; e.p2 = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
      break;
    }
    case 'table':
      e.p = P(e.p); e.h *= s; e.cw = e.cw.map((v) => v * s); e.rh = e.rh.map((v) => v * s);
      if (!xf.mirror) e.rot = angOf(e.rot || 0);
      break;
    case 'hatch':
      e.loops = e.loops.map((l) => l.map(P)); e.scale *= s; e.angle = angOf((e.angle || 0) * DEG) / DEG;
      break;
  }
  return e;
};
E.transformed = (e, xf) => E.transform(E.clone(e), xf);

/* ---------- curves (trim / extend / break) ---------- */
E.isCurve = (e) => ['line', 'arc', 'circle', 'pline'].includes(e.type);
E.isClosed = (e) => e.type === 'circle' || (e.type === 'pline' && e.closed);
E.length = (e) => E.prims(e).reduce((a, p) => a + p.len, 0);
E.paramAt = (e, p) => {
  let best = null;
  for (const pr of E.prims(e)) { const c = G.primClosest(pr, p); const d = G.dist(c.pt, p); if (!best || d < best.d) best = { d, s: c.s, pt: c.pt }; }
  return best;
};
E.pointAt = (e, s) => {
  const prims = E.prims(e), L = prims.reduce((a, p) => a + p.len, 0);
  if (E.isClosed(e)) s = ((s % L) + L) % L;
  for (const pr of prims) if (s <= pr.off + pr.len + 1e-12) return G.primPointAt(pr, s);
  return G.primPointAt(prims[prims.length - 1], s);
};
/* Sub-curve from s0 to s1 (closed curves may wrap: s1 < s0). */
E.sub = (e, s0, s1) => {
  const base = { layer: e.layer, color: e.color };
  if (e.type === 'line') { const L = G.dist(e.p1, e.p2); return { ...base, type: 'line', p1: G.lerp(e.p1, e.p2, s0 / L), p2: G.lerp(e.p1, e.p2, s1 / L) }; }
  if (e.type === 'arc') return { ...base, type: 'arc', c: { ...e.c }, r: e.r, a1: e.a1 + s0 / e.r, a2: e.a1 + s1 / e.r };
  if (e.type === 'circle') return { ...base, type: 'arc', c: { ...e.c }, r: e.r, a1: s0 / e.r, a2: s1 / e.r };
  if (e.type === 'pline') {
    const prims = E.prims(e), L = prims.reduce((acc, p) => acc + p.len, 0);
    if (e.closed && s1 <= s0) s1 += L;
    const pts = [], b = [];
    const loops = e.closed ? 2 : 1;
    for (let k = 0; k < loops; k++) for (const pr of prims) {
      const st = k * L + pr.off, en = st + pr.len, lo = Math.max(s0, st), hi = Math.min(s1, en);
      if (hi - lo <= 1e-9) continue;
      const pa = G.primPointAt(pr, lo - k * L);
      if (!pts.length || !G.same(pts[pts.length - 1], pa, 1e-9)) { pts.push(pa); b.push(0); }
      b[b.length - 1] = pr.kind === 'arc' ? (pr.rev ? -1 : 1) * Math.tan((hi - lo) / pr.r / 4) : 0;
      pts.push(G.primPointAt(pr, hi - k * L)); b.push(0);
    }
    return { ...base, type: 'pline', pts, b, closed: false };
  }
  return null;
};

/* ---------- offset ---------- */
E.offset = (e, d, side) => {
  const out = E.clone(e);
  delete out.id;
  if (e.type === 'line') {
    const n = G.perp(G.norm(G.sub(e.p2, e.p1)));
    const sg = G.dot(G.sub(side, e.p1), n) >= 0 ? 1 : -1;
    out.p1 = G.add(e.p1, G.mul(n, d * sg)); out.p2 = G.add(e.p2, G.mul(n, d * sg));
    return out;
  }
  if (e.type === 'circle' || e.type === 'arc') {
    const r = G.dist(side, e.c) < e.r ? e.r - d : e.r + d;
    if (r <= 1e-9) return null;
    out.r = r; return out;
  }
  if (e.type === 'pline') {
    const prims = E.prims(e), n = e.pts.length;
    if (!prims.length) return null;
    let near = prims[0], nd = Infinity;
    for (const pr of prims) { const dd = G.primDist(pr, side); if (dd < nd) { nd = dd; near = pr; } }
    const cp = G.primClosest(near, side).pt;
    let tan;
    if (near.kind === 'seg') tan = G.sub(near.b, near.a);
    else { tan = G.perp(G.sub(cp, near.c)); if (near.rev) tan = G.mul(tan, -1); }
    const sg = G.cross(tan, G.sub(side, cp)) >= 0 ? 1 : -1; // +1 = left of travel
    const P = [];
    for (const pr of prims) {
      const a = e.pts[pr.i], b = e.pts[(pr.i + 1) % n], bu = (e.b && e.b[pr.i]) || 0;
      if (pr.kind === 'seg') { const nn = G.mul(G.perp(G.norm(G.sub(b, a))), d * sg); P.push({ a: G.add(a, nn), b: G.add(b, nn), bu: 0 }); continue; }
      const rr = bu > 0 ? pr.r - d * sg : pr.r + d * sg;
      if (rr <= 1e-9) return null;
      const f = rr / pr.r;
      P.push({ a: G.add(pr.c, G.mul(G.sub(a, pr.c), f)), b: G.add(pr.c, G.mul(G.sub(b, pr.c), f)), bu });
    }
    const m = P.length, joins = e.closed ? m : m - 1;
    for (let i = 0; i < joins; i++) {
      const A = P[i], B = P[(i + 1) % m];
      if (A.bu === 0 && B.bu === 0) { const h = G.segSeg(A.a, A.b, B.a, B.b, true, true)[0]; if (h) { A.b = { x: h.x, y: h.y }; B.a = { x: h.x, y: h.y }; } }
    }
    const segs = [];
    P.forEach((p, i) => {
      segs.push(p);
      const nx = i + 1 < m ? P[i + 1] : e.closed ? P[0] : null;
      if (nx && !G.same(p.b, nx.a, 1e-9)) segs.push({ a: p.b, b: nx.a, bu: 0 });
    });
    out.pts = segs.map((q) => q.a); out.b = segs.map((q) => q.bu);
    if (!e.closed) { out.pts.push(segs[segs.length - 1].b); out.b.push(0); }
    return out;
  }
  if (e.type === 'ellipse') {
    // approximate: offset along normal by tessellation into a closed polyline
    const pts = ellipsePts(e, 96), inside = G.pointInPoly(side, pts);
    const c = e.c;
    const res = pts.map((p) => { const n = G.norm(G.sub(p, c)); return G.add(p, G.mul(n, inside ? -d : d)); });
    return { type: 'pline', pts: res, closed: true, layer: e.layer, color: e.color };
  }
  return null;
};

/* Closed boundary polygon for hatch / area. */
E.loop = (e) => {
  if (e.type === 'pline') {
    const pts = plPoints(e);
    if (e.closed && pts.length > 2) return pts.slice();
    if (pts.length > 3 && G.same(pts[0], pts[pts.length - 1], 1e-6)) return pts.slice(0, -1);
    return null;
  }
  if (e.type === 'spline') { const pts = splinePts(e); return e.closed && pts.length > 2 ? pts : null; }
  if (e.type === 'circle') { const n = 128, out = []; for (let i = 0; i < n; i++) out.push(G.polar(e.c, (i / n) * TAU, e.r)); return out; }
  if (e.type === 'ellipse') return ellipsePts(e, 128);
  if (e.type === 'revcloud') return revcloudPts(e.pts, e.arc);
  return null;
};
E.area = (e) => {
  if (e.type === 'circle') return Math.PI * e.r * e.r;
  if (e.type === 'ellipse') return Math.PI * G.len(e.maj) ** 2 * e.ratio;
  const l = E.loop(e);
  return l ? Math.abs(G.polyArea(l)) : null;
};

/* Explode compound entities into simple ones. */
E.explode = (e, doc) => {
  const base = { layer: e.layer, color: e.color };
  if (e.type === 'pline') return E.prims(e).map((s) => (s.kind === 'seg' ? { ...base, type: 'line', p1: { ...s.a }, p2: { ...s.b } } : { ...base, type: 'arc', c: { ...s.c }, r: s.r, a1: s.a1, a2: s.a1 + s.sweep }));
  if (e.type === 'spline') return [{ ...base, type: 'pline', pts: splinePts(e), closed: !!e.closed }];
  if (e.type === 'insert') return E.children(e).map((c) => { const n = E.clone(c); delete n.id; return n; });
  if (e.type === 'mtext') return E.ops(e, doc).map((op) => ({ ...base, type: 'text', p: op.p, h: op.h, rot: op.rot, text: op.str, align: 'left' }));
  if (['dim', 'leader', 'revcloud', 'table'].includes(e.type)) {
    const out = [];
    for (const op of E.ops(e, doc)) {
      if (op.op === 'poly') {
        if (op.pts.length === 2 && !op.closed) out.push({ ...base, type: 'line', p1: op.pts[0], p2: op.pts[1] });
        else out.push({ ...base, type: 'pline', pts: op.pts, closed: !!op.closed });
      } else if (op.op === 'fill') out.push({ ...base, type: 'pline', pts: op.pts, closed: true });
      else if (op.op === 'text') out.push({ ...base, type: 'text', p: op.p, h: op.h, rot: op.rot, text: op.str, align: op.align, style: op.style });
      else if (op.op === 'arc') out.push({ ...base, type: 'arc', c: op.c, r: op.r, a1: op.a1, a2: op.a2 });
    }
    return out;
  }
  return null;
};

E.label = (t) => ({ line: 'Line', pline: 'Polyline', spline: 'Spline', circle: 'Circle', arc: 'Arc', ellipse: 'Ellipse', text: 'Text', mtext: 'MText', leader: 'Leader', dim: 'Dimension', revcloud: 'Revision cloud', hatch: 'Hatch', table: 'Table', viewport: 'Viewport', image: 'Image', insert: 'Block reference', attdef: 'Attribute definition' }[t] || t);

E.describe = (e, doc) => {
  const f = (v) => fmtNum(v, 4), P = (p) => `X=${f(p.x)}  Y=${f(p.y)}`;
  const L = [`${E.label(e.type).toUpperCase()}   Layer: "${e.layer}"   Color: ${e.color}`];
  switch (e.type) {
    case 'line': L.push(`  from ${P(e.p1)}`, `  to   ${P(e.p2)}`, `  Length=${f(G.dist(e.p1, e.p2))}  Angle=${f(G.normAng(G.angle(e.p1, e.p2)) / DEG)}°`); break;
    case 'pline': L.push(`  ${e.pts.length} vertices, ${e.closed ? 'closed' : 'open'}`, `  Length=${f(E.length(e))}`); if (e.closed) L.push(`  Area=${f(E.area(e))}`); break;
    case 'circle': L.push(`  center ${P(e.c)}`, `  Radius=${f(e.r)}  Circumference=${f(TAU * e.r)}  Area=${f(Math.PI * e.r * e.r)}`); break;
    case 'arc': L.push(`  center ${P(e.c)}`, `  Radius=${f(e.r)}  Start=${f(G.normAng(e.a1) / DEG)}°  End=${f(G.normAng(e.a2) / DEG)}°  Length=${f(E.length(e))}`); break;
    case 'ellipse': L.push(`  center ${P(e.c)}`, `  Major=${f(G.len(e.maj))}  Minor=${f(G.len(e.maj) * e.ratio)}`); break;
    case 'text': case 'mtext': L.push(`  at ${P(e.p)}  Height=${f(e.h)}`, `  "${e.text}"`); break;
    case 'leader': L.push(`  arrow at ${P(e.pts[0])}`, `  "${e.text}"`); break;
    case 'dim': L.push(`  ${e.kind} dimension, style "${e.dimstyle || '(legacy)'}"${e.assoc && Object.keys(e.assoc).length ? ', associative' : ''}`); break;
    case 'table': L.push(`  ${e.rh.length} rows × ${e.cw.length} columns`); break;
    case 'image': L.push(`  "${e.name || 'image'}" ${fmtNum(e.w, 4)} × ${fmtNum(e.h, 4)}, opacity ${fmtNum((e.opacity ?? 1) * 100, 0)}%`); break;
    case 'viewport': L.push(`  ${fmtNum(e.p2.x - e.p1.x, 2)} × ${fmtNum(e.p2.y - e.p1.y, 2)} mm on paper, scale ${fmtNum(e.scale, 6)} paper mm per unit`); break;
    case 'hatch': L.push(`  Pattern=${e.pattern}  Scale=${e.scale}  Angle=${e.angle}°`); break;
    case 'insert': L.push(`  Block "${e.name}" at ${P(e.p)}`, `  Scale X=${f(e.sx ?? 1)} Y=${f(e.sy ?? 1)}  Rotation=${f(G.normAng(e.rot || 0) / DEG)}°`); for (const a of e.attribs || []) L.push(`  ${a.tag} = "${a.value}"`); break;
    case 'attdef': L.push(`  Tag=${e.tag}  Prompt="${e.prompt || ''}"  Default="${e.def || ''}"`); break;
  }
  return L;
};
