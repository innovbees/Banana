'use strict';
/* Geometry helpers: vectors, angles, intersections, polygons, hatching. */
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const G = {
  pt: (x, y) => ({ x, y }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  mul: (a, s) => ({ x: a.x * s, y: a.y * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y,
  cross: (a, b) => a.x * b.y - a.y * b.x,
  len: (a) => Math.hypot(a.x, a.y),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  norm: (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; },
  perp: (a) => ({ x: -a.y, y: a.x }),
  lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
  mid: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
  angle: (a, b) => Math.atan2(b.y - a.y, b.x - a.x),
  polar: (p, ang, d) => ({ x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d }),
  same: (a, b, eps = 1e-9) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
};

G.normAng = (a) => { a %= TAU; if (a < 0) a += TAU; if (a >= TAU - 1e-12) a = 0; return a; };
/* Counter-clockwise sweep from a1 to a2, in (0, 2π]. */
G.ccwSweep = (a1, a2) => { const s = G.normAng(a2 - a1); return s < 1e-12 ? TAU : s; };

G.rotate = (p, c, ang) => {
  const s = Math.sin(ang), co = Math.cos(ang), dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
};

G.projectT = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  return l2 < 1e-24 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
};
G.closestOnSeg = (p, a, b) => G.lerp(a, b, G.clamp(G.projectT(p, a, b), 0, 1));
G.distToSeg = (p, a, b) => G.dist(p, G.closestOnSeg(p, a, b));

/* ---------- primitives: {kind:'seg',a,b,off,len} | {kind:'arc',c,r,a1,sweep,off,len} ---------- */
G.seg = (a, b, off = 0) => ({ kind: 'seg', a, b, off, len: G.dist(a, b) });
G.arcPrim = (c, r, a1, sweep, off = 0) => ({ kind: 'arc', c, r, a1, sweep, off, len: r * sweep });

G.arcTheta = (pr, p) => {
  let t = G.normAng(Math.atan2(p.y - pr.c.y, p.x - pr.c.x) - pr.a1);
  return t;
};
G.onArc = (pr, theta, eps = 1e-9) => pr.sweep >= TAU - 1e-9 || theta <= pr.sweep + eps || theta >= TAU - eps;

G.primClosest = (pr, p) => {
  if (pr.kind === 'seg') {
    const t = G.clamp(G.projectT(p, pr.a, pr.b), 0, 1);
    return { pt: G.lerp(pr.a, pr.b, t), s: pr.off + t * pr.len };
  }
  let th = G.arcTheta(pr, p);
  if (!G.onArc(pr, th)) {
    // nearer end
    const e1 = G.polar(pr.c, pr.a1, pr.r), e2 = G.polar(pr.c, pr.a1 + pr.sweep, pr.r);
    th = G.dist(p, e1) < G.dist(p, e2) ? 0 : pr.sweep;
  } else if (th > pr.sweep) th = 0;
  return { pt: G.polar(pr.c, pr.a1 + th, pr.r), s: pr.off + th * pr.r };
};
G.primDist = (pr, p) => G.dist(p, G.primClosest(pr, p).pt);
G.primPointAt = (pr, s) => {
  const l = s - pr.off;
  if (pr.kind === 'seg') return G.lerp(pr.a, pr.b, pr.len ? l / pr.len : 0);
  return G.polar(pr.c, pr.a1 + l / pr.r, pr.r);
};

/* ---------- raw intersections ---------- */
G.segSeg = (a, b, c, d, inf1 = false, inf2 = false) => {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-14 * (Math.abs(rx) + Math.abs(ry) + 1) * (Math.abs(sx) + Math.abs(sy) + 1)) return [];
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  const e = 1e-9;
  if (!inf1 && (t < -e || t > 1 + e)) return [];
  if (!inf2 && (u < -e || u > 1 + e)) return [];
  return [{ x: a.x + rx * t, y: a.y + ry * t, t, u }];
};

G.lineCircle = (a, b, c, r) => {
  const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - c.x, fy = a.y - c.y;
  const A = dx * dx + dy * dy;
  if (A < 1e-24) return [];
  const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  let disc = B * B - 4 * A * C;
  const tol = 1e-10 * Math.max(1, B * B);
  if (disc < -tol) return [];
  if (disc < tol) disc = 0;
  const sq = Math.sqrt(disc);
  const ts = disc === 0 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.map((t) => ({ x: a.x + dx * t, y: a.y + dy * t, t }));
};

G.circleCircle = (c1, r1, c2, r2) => {
  const d = G.dist(c1, c2);
  if (d < 1e-12) return [];
  const tol = 1e-9 * Math.max(1, r1 + r2);
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  let h2 = r1 * r1 - a * a;
  if (h2 < 0) h2 = 0;
  const h = Math.sqrt(h2);
  const px = c1.x + ((c2.x - c1.x) * a) / d, py = c1.y + ((c2.y - c1.y) * a) / d;
  if (h < 1e-12) return [{ x: px, y: py }];
  const ox = (-(c2.y - c1.y) * h) / d, oy = ((c2.x - c1.x) * h) / d;
  return [{ x: px + ox, y: py + oy }, { x: px - ox, y: py - oy }];
};

/* Intersections of two primitives; returns [{x,y,sp,sq}] with params along each. */
G.primIntersect = (p, q) => {
  const out = [];
  if (p.kind === 'seg' && q.kind === 'seg') {
    for (const h of G.segSeg(p.a, p.b, q.a, q.b)) out.push({ x: h.x, y: h.y, sp: p.off + G.clamp(h.t, 0, 1) * p.len, sq: q.off + G.clamp(h.u, 0, 1) * q.len });
  } else if (p.kind === 'seg' && q.kind === 'arc') {
    for (const h of G.lineCircle(p.a, p.b, q.c, q.r)) {
      if (h.t < -1e-9 || h.t > 1 + 1e-9) continue;
      const th = G.arcTheta(q, h);
      if (!G.onArc(q, th)) continue;
      out.push({ x: h.x, y: h.y, sp: p.off + G.clamp(h.t, 0, 1) * p.len, sq: q.off + (th > q.sweep ? 0 : th) * q.r });
    }
  } else if (p.kind === 'arc' && q.kind === 'seg') {
    for (const h of G.primIntersect(q, p)) out.push({ x: h.x, y: h.y, sp: h.sq, sq: h.sp });
  } else {
    for (const h of G.circleCircle(p.c, p.r, q.c, q.r)) {
      const t1 = G.arcTheta(p, h), t2 = G.arcTheta(q, h);
      if (!G.onArc(p, t1) || !G.onArc(q, t2)) continue;
      out.push({ x: h.x, y: h.y, sp: p.off + (t1 > p.sweep ? 0 : t1) * p.r, sq: q.off + (t2 > q.sweep ? 0 : t2) * q.r });
    }
  }
  return out;
};

/* Circle through 3 points; returns {c,r,a1,a2} (CCW arc from p1 through p2 to p3) or null. */
G.arc3 = (p1, p2, p3) => {
  const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const c = { x: (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, y: (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d };
  const r = G.dist(c, p1);
  const ccw = G.cross(G.sub(p2, p1), G.sub(p3, p2)) > 0;
  const s = G.angle(c, p1), e = G.angle(c, p3);
  return ccw ? { c, r, a1: s, a2: e } : { c, r, a1: e, a2: s };
};

/* ---------- polygons ---------- */
G.polyArea = (pts) => {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
};
G.polyPerimeter = (pts, closed = true) => {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += G.dist(pts[i], pts[i + 1]);
  if (closed && pts.length > 2) l += G.dist(pts[pts.length - 1], pts[0]);
  return l;
};
G.pointInPoly = (p, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
G.pointInLoops = (p, loops) => loops.reduce((acc, l) => (G.pointInPoly(p, l) ? !acc : acc), false);

/* Parallel hatch segments clipped to loops (even-odd). Returns null if too dense. */
G.hatchSegments = (loops, ang, spacing, maxLines = 4000) => {
  const u = { x: Math.cos(ang), y: Math.sin(ang) }, n = { x: -u.y, y: u.x };
  let lo = Infinity, hi = -Infinity;
  for (const l of loops) for (const p of l) { const d = G.dot(p, n); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  if (!isFinite(lo) || spacing <= 0) return [];
  const k0 = Math.ceil(lo / spacing), k1 = Math.floor(hi / spacing);
  if (k1 - k0 > maxLines) return null;
  const segs = [];
  for (let k = k0; k <= k1; k++) {
    const o = k * spacing, ss = [];
    for (const l of loops) {
      for (let i = 0; i < l.length; i++) {
        const a = l[i], b = l[(i + 1) % l.length];
        const da = G.dot(a, n) - o, db = G.dot(b, n) - o;
        if ((da > 0) !== (db > 0)) { const t = da / (da - db); ss.push(G.dot(G.lerp(a, b, t), u)); }
      }
    }
    ss.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ss.length; i += 2) {
      segs.push([{ x: u.x * ss[i] + n.x * o, y: u.y * ss[i] + n.y * o }, { x: u.x * ss[i + 1] + n.x * o, y: u.y * ss[i + 1] + n.y * o }]);
    }
  }
  return segs;
};

G.segRectHit = (a, b, r) => {
  const inside = (p) => p.x >= r.minx && p.x <= r.maxx && p.y >= r.miny && p.y <= r.maxy;
  if (inside(a) || inside(b)) return true;
  const c = [{ x: r.minx, y: r.miny }, { x: r.maxx, y: r.miny }, { x: r.maxx, y: r.maxy }, { x: r.minx, y: r.maxy }];
  for (let i = 0; i < 4; i++) if (G.segSeg(a, b, c[i], c[(i + 1) % 4]).length) return true;
  return false;
};

/* Point → transformation helpers (affine). */
const XF = {
  move: (d) => ({ p: (q) => G.add(q, d), v: (q) => ({ ...q }), s: 1, rot: 0, mirror: false }),
  rotate: (c, a) => ({ p: (q) => G.rotate(q, c, a), v: (q) => G.rotate(q, { x: 0, y: 0 }, a), s: 1, rot: a, mirror: false }),
  scale: (c, f) => ({ p: (q) => G.add(c, G.mul(G.sub(q, c), f)), v: (q) => G.mul(q, f), s: f, rot: 0, mirror: false }),
  mirror: (a, b) => {
    const u = G.norm(G.sub(b, a));
    const refl = (q) => { const d = G.dot(q, u); return { x: 2 * d * u.x - q.x, y: 2 * d * u.y - q.y }; };
    return { p: (q) => G.add(a, refl(G.sub(q, a))), v: refl, s: 1, rot: 2 * Math.atan2(u.y, u.x), mirror: true };
  },
};
