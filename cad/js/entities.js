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
function textWidth(str, h) {
  _measureCtx.font = `100px ${FONT_FAMILY}`;
  return (_measureCtx.measureText(str || '').width / 100) * (h / CAP_RATIO);
}
function wrapLines(text, h, width) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!width || width <= 0) { out.push(para); continue; }
    let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && textWidth(t, h) > width) { out.push(cur); cur = w; } else cur = t;
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

E.dimText = (e, meas, dec) => {
  const v = fmtNum(meas, dec);
  if (e.text && e.text.length) return e.text.replace('<>', v);
  if (e.kind === 'radius') return 'R' + v;
  if (e.kind === 'diameter') return '⌀' + v;
  return v;
};

E.dimOps = (e, dec = 2) => {
  const s = e.scale || 1, asz = 2.5 * s, th = e.h || 2.5 * s, gap = 0.625 * s, ext = 1.25 * s;
  const ops = [];
  if (e.kind === 'radius' || e.kind === 'diameter') {
    const r = e.r, c = e.c;
    let dir = G.norm(G.sub(e.pos, c));
    if (G.len(G.sub(e.pos, c)) < 1e-9) dir = { x: 1, y: 0 };
    const tip = G.polar(c, Math.atan2(dir.y, dir.x), r);
    const outside = G.dist(e.pos, c) > r;
    const meas = e.kind === 'radius' ? r : 2 * r;
    if (e.kind === 'radius') {
      ops.push({ op: 'poly', pts: outside ? [c, e.pos] : [c, tip] });
      ops.push({ op: 'fill', pts: arrowPts(tip, outside ? G.mul(dir, -1) : dir, asz) });
    } else {
      const tip2 = G.sub(c, G.mul(dir, r));
      ops.push({ op: 'poly', pts: outside ? [tip2, e.pos] : [tip2, tip] });
      ops.push({ op: 'fill', pts: arrowPts(tip, outside ? G.mul(dir, -1) : dir, asz) });
      ops.push({ op: 'fill', pts: arrowPts(tip2, G.mul(dir, -1), asz) });
    }
    const right = e.pos.x >= c.x;
    const land = { x: e.pos.x + (right ? 1 : -1) * asz, y: e.pos.y };
    if (outside) ops.push({ op: 'poly', pts: [e.pos, land] });
    const tp = outside ? { x: land.x + (right ? gap : -gap), y: e.pos.y - th / 2 } : { x: e.pos.x, y: e.pos.y + gap };
    ops.push({ op: 'text', p: tp, h: th, rot: 0, str: E.dimText(e, meas, dec), align: outside ? (right ? 'left' : 'right') : 'center' });
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
    if (l > gap) ops.push({ op: 'poly', pts: [G.add(p, G.mul(nn, gap)), G.add(d, G.mul(nn, ext))] });
    else ops.push({ op: 'poly', pts: [d, G.add(d, G.mul(nn, ext))] });
  }
  const dd = G.dist(d1, d2);
  const du = dd > 1e-9 ? G.norm(G.sub(d2, d1)) : u;
  const inside = dd > asz * 2.6;
  if (inside) {
    ops.push({ op: 'poly', pts: [d1, d2] });
    ops.push({ op: 'fill', pts: arrowPts(d1, G.mul(du, -1), asz) });
    ops.push({ op: 'fill', pts: arrowPts(d2, du, asz) });
  } else {
    ops.push({ op: 'poly', pts: [G.sub(d1, G.mul(du, asz * 2)), G.add(d2, G.mul(du, asz * 2))] });
    ops.push({ op: 'fill', pts: arrowPts(d1, du, asz) });
    ops.push({ op: 'fill', pts: arrowPts(d2, G.mul(du, -1), asz) });
  }
  const ta = readableAngle(Math.atan2(du.y, du.x));
  const up = { x: -Math.sin(ta), y: Math.cos(ta) };
  ops.push({ op: 'text', p: G.add(G.mid(d1, d2), G.mul(up, gap)), h: th, rot: ta, str: E.dimText(e, meas, dec), align: 'center' });
  return ops;
};

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
    case 'pline': return [{ op: 'poly', pts: e.pts, closed: !!e.closed }];
    case 'circle': return [{ op: 'circle', c: e.c, r: e.r }];
    case 'arc': return [{ op: 'arc', c: e.c, r: e.r, a1: e.a1, a2: e.a2 }];
    case 'ellipse': return [{ op: 'ellipse', c: e.c, rx: G.len(e.maj), ry: G.len(e.maj) * e.ratio, rot: Math.atan2(e.maj.y, e.maj.x) }];
    case 'text': return [{ op: 'text', p: e.p, h: e.h, rot: e.rot || 0, str: e.text, align: e.align || 'left' }];
    case 'mtext': {
      const lines = wrapLines(e.text, e.h, e.width), rot = e.rot || 0;
      return lines.map((str, i) => ({ op: 'text', p: G.rotate(G.add(e.p, { x: 0, y: -e.h - i * e.h * LINE_SPACING }), e.p, rot), h: e.h, rot, str, align: 'left' }));
    }
    case 'leader': {
      const g = E.leaderGeom(e), h = e.h || 2.5, ops = [];
      ops.push({ op: 'poly', pts: [...e.pts, g.land] });
      if (e.pts.length > 1) {
        const d = G.norm(G.sub(e.pts[0], e.pts[1]));
        ops.push({ op: 'fill', pts: arrowPts(e.pts[0], d, h) });
      }
      g.lines.forEach((str, i) => ops.push({ op: 'text', p: { x: g.tx, y: g.firstBase - i * h * LINE_SPACING }, h, rot: 0, str, align: g.dir > 0 ? 'left' : 'right' }));
      return ops;
    }
    case 'dim': return E.dimOps(e, dec);
    case 'revcloud': return [{ op: 'poly', pts: revcloudPts(e.pts, e.arc), closed: true }];
    case 'hatch': return [{ op: 'hatch', loops: e.loops, pattern: e.pattern, scale: e.scale, angle: e.angle }];
  }
  return [];
};

E.textBox = (op) => {
  const h = op.h, w = op.str ? textWidth(op.str, h) : h * 0.5;
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
  for (const op of E.ops(e, doc)) {
    switch (op.op) {
      case 'poly': out.push(...segsOf(op.pts, op.closed)); break;
      case 'fill': out.push(...segsOf(op.pts, true)); break;
      case 'circle': out.push(G.arcPrim(op.c, op.r, 0, TAU)); break;
      case 'arc': out.push(G.arcPrim(op.c, op.r, op.a1, G.ccwSweep(op.a1, op.a2))); break;
      case 'ellipse': out.push(...segsOf(ellipsePts(e), true)); break;
      case 'text': { const b = E.textBox(op); out.push({ kind: 'box', pts: b }, ...segsOf(b, true)); break; }
      case 'hatch': out.push({ kind: 'region', loops: op.loops }); for (const l of op.loops) out.push(...segsOf(l, true)); break;
    }
  }
  return out;
};

/* Geometric edges (for intersections, trimming, extending). */
E.prims = (e) => {
  switch (e.type) {
    case 'line': return [G.seg(e.p1, e.p2, 0)];
    case 'pline': return segsOf(e.pts, e.closed);
    case 'circle': return [G.arcPrim(e.c, e.r, 0, TAU)];
    case 'arc': return [G.arcPrim(e.c, e.r, e.a1, G.ccwSweep(e.a1, e.a2))];
    case 'ellipse': return segsOf(ellipsePts(e), true);
    case 'revcloud': return segsOf(revcloudPts(e.pts, e.arc), true);
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
    case 'pline': e.pts.forEach((p) => add('end', p)); for (const sg of E.prims(e)) add('mid', G.mid(sg.a, sg.b)); break;
    case 'circle': add('cen', e.c); for (let k = 0; k < 4; k++) add('quad', G.polar(e.c, k * Math.PI / 2, e.r)); break;
    case 'arc': {
      const sw = G.ccwSweep(e.a1, e.a2);
      add('end', G.polar(e.c, e.a1, e.r)); add('end', G.polar(e.c, e.a2, e.r)); add('mid', G.polar(e.c, e.a1 + sw / 2, e.r)); add('cen', e.c);
      for (let k = 0; k < 4; k++) if (G.normAng(k * Math.PI / 2 - e.a1) <= sw) add('quad', G.polar(e.c, k * Math.PI / 2, e.r));
      break;
    }
    case 'ellipse': { const mn = G.mul(G.perp(e.maj), e.ratio); add('cen', e.c); [e.maj, G.mul(e.maj, -1), mn, G.mul(mn, -1)].forEach((v) => add('quad', G.add(e.c, v))); break; }
    case 'text': case 'mtext': add('ins', e.p); break;
    case 'leader': e.pts.forEach((p) => add('end', p)); break;
    case 'revcloud': e.pts.forEach((p) => add('end', p)); break;
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
    case 'pline': case 'leader': case 'revcloud': return e.pts.slice();
    case 'circle': return [e.c, ...[0, 1, 2, 3].map((k) => G.polar(e.c, k * Math.PI / 2, e.r))];
    case 'arc': { const sw = G.ccwSweep(e.a1, e.a2); return [G.polar(e.c, e.a1, e.r), G.polar(e.c, e.a1 + sw / 2, e.r), G.polar(e.c, e.a2, e.r), e.c]; }
    case 'ellipse': { const mn = G.mul(G.perp(e.maj), e.ratio); return [e.c, G.add(e.c, e.maj), G.sub(e.c, e.maj), G.add(e.c, mn), G.sub(e.c, mn)]; }
    case 'text': case 'mtext': return [e.p];
    case 'dim': return e.kind === 'radius' || e.kind === 'diameter' ? [e.pos] : [e.p1, e.p2, e.pos];
  }
  return [];
};

E.setGrip = (e, i, p) => {
  switch (e.type) {
    case 'line':
      if (i === 0) e.p1 = p; else if (i === 2) e.p2 = p;
      else { const d = G.sub(p, G.mid(e.p1, e.p2)); e.p1 = G.add(e.p1, d); e.p2 = G.add(e.p2, d); }
      break;
    case 'pline': case 'leader': case 'revcloud': e.pts[i] = p; break;
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
    case 'text': case 'mtext': e.p = p; break;
    case 'dim':
      if (e.kind === 'radius' || e.kind === 'diameter') e.pos = p;
      else if (i === 0) e.p1 = p; else if (i === 1) e.p2 = p; else e.pos = p;
      break;
  }
};

E.clone = (e) => JSON.parse(JSON.stringify(e));

E.transform = (e, xf) => {
  const P = xf.p, s = Math.abs(xf.s);
  const angOf = (a) => { const v = xf.v({ x: Math.cos(a), y: Math.sin(a) }); return Math.atan2(v.y, v.x); };
  switch (e.type) {
    case 'line': e.p1 = P(e.p1); e.p2 = P(e.p2); break;
    case 'pline': case 'revcloud': e.pts = e.pts.map(P); if (e.type === 'revcloud') e.arc *= s; break;
    case 'leader': e.pts = e.pts.map(P); e.h *= s; break;
    case 'circle': e.c = P(e.c); e.r *= s; break;
    case 'arc': {
      const st = P(G.polar(e.c, e.a1, e.r)), en = P(G.polar(e.c, e.a2, e.r));
      e.c = P(e.c); e.r *= s;
      if (xf.mirror) { e.a1 = G.angle(e.c, en); e.a2 = G.angle(e.c, st); } else { e.a1 = G.angle(e.c, st); e.a2 = G.angle(e.c, en); }
      break;
    }
    case 'ellipse': e.c = P(e.c); e.maj = xf.v(e.maj); break;
    case 'text': case 'mtext':
      e.p = P(e.p); e.h *= s; if (e.width) e.width *= s;
      if (!xf.mirror) e.rot = angOf(e.rot || 0);
      else if (e.type === 'mtext') { /* keep readable */ }
      break;
    case 'dim':
      for (const k of ['p1', 'p2', 'pos', 'c']) if (e[k]) e[k] = P(e[k]);
      if (e.r) e.r *= s;
      if (e.kind === 'linear') e.dirAng = angOf(e.dirAng || 0);
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
    const prims = E.prims(e), L = prims.reduce((a, p) => a + p.len, 0);
    if (e.closed && s1 <= s0) s1 += L;
    const pts = [E.pointAt(e, s0)];
    const loops = e.closed ? 2 : 1;
    for (let k = 0; k < loops; k++) for (const pr of prims) { const v = k * L + pr.off + pr.len; if (v > s0 + 1e-9 && v < s1 - 1e-9) pts.push({ ...pr.b }); }
    pts.push(E.pointAt(e, s1));
    return { ...base, type: 'pline', pts, closed: false };
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
    const segs = E.prims(e);
    if (!segs.length) return null;
    let near = segs[0], nd = Infinity;
    for (const s of segs) { const dd = G.distToSeg(side, s.a, s.b); if (dd < nd) { nd = dd; near = s; } }
    const sg = G.cross(G.sub(near.b, near.a), G.sub(side, near.a)) >= 0 ? 1 : -1;
    const off = segs.map((s) => { const n = G.mul(G.perp(G.norm(G.sub(s.b, s.a))), d * sg); return [G.add(s.a, n), G.add(s.b, n)]; });
    const join = (A, B) => { const h = G.segSeg(A[0], A[1], B[0], B[1], true, true); return h.length ? { x: h[0].x, y: h[0].y } : A[1]; };
    const pts = [];
    if (e.closed) for (let i = 0; i < off.length; i++) pts.push(join(off[(i - 1 + off.length) % off.length], off[i]));
    else { pts.push(off[0][0]); for (let i = 1; i < off.length; i++) pts.push(join(off[i - 1], off[i])); pts.push(off[off.length - 1][1]); }
    out.pts = pts; return out;
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
    if (e.closed && e.pts.length > 2) return e.pts.slice();
    if (e.pts.length > 3 && G.same(e.pts[0], e.pts[e.pts.length - 1], 1e-6)) return e.pts.slice(0, -1);
    return null;
  }
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
  if (e.type === 'pline') return E.prims(e).map((s) => ({ ...base, type: 'line', p1: { ...s.a }, p2: { ...s.b } }));
  if (e.type === 'mtext') return E.ops(e, doc).map((op) => ({ ...base, type: 'text', p: op.p, h: op.h, rot: op.rot, text: op.str, align: 'left' }));
  if (['dim', 'leader', 'revcloud'].includes(e.type)) {
    const out = [];
    for (const op of E.ops(e, doc)) {
      if (op.op === 'poly') {
        if (op.pts.length === 2 && !op.closed) out.push({ ...base, type: 'line', p1: op.pts[0], p2: op.pts[1] });
        else out.push({ ...base, type: 'pline', pts: op.pts, closed: !!op.closed });
      } else if (op.op === 'fill') out.push({ ...base, type: 'pline', pts: op.pts, closed: true });
      else if (op.op === 'text') out.push({ ...base, type: 'text', p: op.p, h: op.h, rot: op.rot, text: op.str, align: op.align });
    }
    return out;
  }
  return null;
};

E.label = (t) => ({ line: 'Line', pline: 'Polyline', circle: 'Circle', arc: 'Arc', ellipse: 'Ellipse', text: 'Text', mtext: 'MText', leader: 'Leader', dim: 'Dimension', revcloud: 'Revision cloud', hatch: 'Hatch' }[t] || t);

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
    case 'dim': L.push(`  ${e.kind}`); break;
    case 'hatch': L.push(`  Pattern=${e.pattern}  Scale=${e.scale}  Angle=${e.angle}°`); break;
  }
  return L;
};
