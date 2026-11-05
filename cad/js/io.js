'use strict';
/* File I/O: native JSON (.bcad), DXF (R12 ASCII) import/export, downloads. */
const ACI = (() => {
  const t = [];
  t[1] = [255, 0, 0]; t[2] = [255, 255, 0]; t[3] = [0, 255, 0]; t[4] = [0, 255, 255]; t[5] = [0, 0, 255]; t[6] = [255, 0, 255]; t[7] = [255, 255, 255]; t[8] = [128, 128, 128]; t[9] = [192, 192, 192];
  const bright = [1, 1, 0.65, 0.65, 0.5, 0.5, 0.3, 0.3, 0.15, 0.15];
  for (let i = 10; i < 250; i++) {
    const h = (Math.floor((i - 10) / 10) * 15) / 60, k = (i - 10) % 10, v = bright[k], s = k % 2 ? 0.5 : 1;
    const f = (n) => { const kk = (n + h) % 6; return v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1)); };
    t[i] = [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
  }
  [51, 80, 105, 130, 190, 255].forEach((g, j) => (t[250 + j] = [g, g, g]));
  return t;
})();
const hex2 = (n) => n.toString(16).padStart(2, '0');
const aciToHex = (i) => { const c = ACI[Math.abs(i)] || ACI[7]; return '#' + c.map(hex2).join(''); };
const hexToAci = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 7;
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  let best = 7, bd = Infinity;
  for (let i = 1; i < 256; i++) { const c = ACI[i]; const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
};

const IO = {
  download(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  /* ---------------- DXF export (AC1009 / R12) ---------------- */
  toDXF(doc) {
    const L = [];
    const w = (c, v) => { L.push(String(c)); L.push(typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(8).replace(/0+$/, '0')) : String(v)); };
    const ext = Render.extents(doc) || { minx: 0, miny: 0, maxx: 100, maxy: 100 };
    w(0, 'SECTION'); w(2, 'HEADER');
    w(9, '$ACADVER'); w(1, 'AC1009');
    w(9, '$INSBASE'); w(10, 0); w(20, 0); w(30, 0);
    w(9, '$EXTMIN'); w(10, ext.minx); w(20, ext.miny); w(30, 0);
    w(9, '$EXTMAX'); w(10, ext.maxx); w(20, ext.maxy); w(30, 0);
    w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'TABLES');
    w(0, 'TABLE'); w(2, 'LTYPE'); w(70, 1);
    w(0, 'LTYPE'); w(2, 'CONTINUOUS'); w(70, 0); w(3, 'Solid line'); w(72, 65); w(73, 0); w(40, 0);
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'LAYER'); w(70, doc.layers.length);
    for (const l of doc.layers) { w(0, 'LAYER'); w(2, l.name); w(70, l.locked ? 4 : 0); w(62, (l.visible ? 1 : -1) * hexToAci(l.color)); w(6, 'CONTINUOUS'); }
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'STYLE'); w(70, 1);
    w(0, 'STYLE'); w(2, 'STANDARD'); w(70, 0); w(40, 0); w(41, 1); w(50, 0); w(71, 0); w(42, 2.5); w(3, 'txt'); w(4, '');
    w(0, 'ENDTAB');
    w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    const head = (type, e) => { w(0, type); w(8, e.layer); if (e.color && e.color !== 'bylayer') w(62, hexToAci(e.color)); };
    const P = (p, k = 0) => { w(10 + k, p.x); w(20 + k, p.y); w(30 + k, 0); };
    const poly = (e, pts, closed) => {
      if (pts.length === 2 && !closed) { head('LINE', e); P(pts[0]); P(pts[1], 1); return; }
      head('POLYLINE', e); w(66, 1); P({ x: 0, y: 0 }); w(70, closed ? 1 : 0);
      for (const p of pts) { w(0, 'VERTEX'); w(8, e.layer); P(p); }
      w(0, 'SEQEND'); w(8, e.layer);
    };
    for (const e of doc.entities) {
      if (e.type === 'ellipse') { poly(e, E.loop(e), true); continue; }
      for (const op of E.ops(e, doc)) {
        switch (op.op) {
          case 'poly': poly(e, op.pts, op.closed); break;
          case 'fill': {
            head('SOLID', e); const p = op.pts; P(p[0]); P(p[1], 1); P(p[2], 2); P(p[3] || p[2], 3); break;
          }
          case 'circle': head('CIRCLE', e); P(op.c); w(40, op.r); break;
          case 'arc': head('ARC', e); P(op.c); w(40, op.r); w(50, G.normAng(op.a1) / DEG); w(51, G.normAng(op.a2) / DEG); break;
          case 'text': {
            if (!op.str) break;
            head('TEXT', e); P(op.p); w(40, op.h); w(1, op.str);
            if (op.rot) w(50, G.normAng(op.rot) / DEG);
            const j = { left: 0, center: 1, right: 2 }[op.align || 'left'];
            if (j) { w(72, j); P(op.p, 1); }
            break;
          }
          case 'hatch': {
            for (const l of op.loops) poly(e, l, true);
            const pat = HATCH_PATTERNS[op.pattern];
            if (pat) for (const fam of pat) {
              const segs = G.hatchSegments(op.loops, (fam.ang + (op.angle || 0)) * DEG, fam.sp * (op.scale || 1), 5000) || [];
              for (const [a, b] of segs) { head('LINE', e); P(a); P(b, 1); }
            }
            break;
          }
        }
      }
    }
    w(0, 'ENDSEC'); w(0, 'EOF');
    return L.join('\r\n') + '\r\n';
  },

  /* ---------------- DXF import ----------------
   * Reads model-space entities, layers and blocks. Block references (INSERT),
   * dimensions (stored as anonymous blocks) and nested blocks are expanded
   * into plain entities. */
  fromDXF(text) {
    const lines = text.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const c = parseInt(lines[i].trim(), 10);
      if (isNaN(c)) continue;
      pairs.push([c, lines[i + 1].replace(/\s+$/, '')]);
    }
    const objs = [];
    let section = null, expectName = false, cur = null;
    for (const [c, v0] of pairs) {
      if (c === 0) {
        if (cur) objs.push(cur);
        cur = null;
        const v = v0.trim();
        if (v === 'SECTION') { expectName = true; continue; }
        if (v === 'ENDSEC') { section = null; continue; }
        if (section === 'ENTITIES' || section === 'BLOCKS' || (section === 'TABLES' && v === 'LAYER')) cur = { type: v, g: [], section };
      } else if (c === 2 && expectName) { section = v0.trim(); expectName = false; }
      else if (cur) cur.g.push([c, v0]);
    }
    if (cur) objs.push(cur);

    const skipped = {};
    const skip = (t) => (skipped[t] = (skipped[t] || 0) + 1);
    const get = (o, c, d) => { const p = o.g.find((x) => x[0] === c); return p ? p[1] : d; };
    const num = (o, c, d = 0) => { const v = get(o, c); const n = v === undefined ? NaN : parseFloat(v); return isNaN(n) ? d : n; };
    const all = (o, c) => o.g.filter((x) => x[0] === c).map((x) => x[1]);
    const P = (o, cx, d) => ({ x: num(o, cx, d ? d.x : 0), y: num(o, cx + 10, d ? d.y : 0) });
    const uni = (s) => String(s).replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/%%[cC]/g, '⌀').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%').replace(/%%[uUoO]/g, '');
    const cleanMText = (s) => uni(s)
      .replace(/\\P/g, '\n').replace(/\\~/g, ' ').replace(/\\[ACcFfHhQqTtWwp][^;]*;/g, '').replace(/\\[LlOoKkNn]/g, '')
      .replace(/\\S([^;]*);/g, (m, x) => x.replace(/[#^]/, '/')).replace(/\\([\\{}])/g, '$1').replace(/(^|[^\\])[{}]/g, '$1').replace(/[{}]/g, '');
    const base = (o) => {
      const col = parseInt(get(o, 62, '256'), 10);
      let color = col === 0 ? 'byblock' : col > 0 && col < 256 ? aciToHex(col) : 'bylayer';
      const tc = get(o, 420);
      if (tc !== undefined && col !== 0 && col !== 256) color = '#' + (parseInt(tc, 10) & 0xffffff).toString(16).padStart(6, '0');
      return { layer: (get(o, 8, '0') || '0').trim() || '0', color };
    };
    // affine matrices [a,b,c,d,e,f]: (x,y) -> (a x + c y + e, b x + d y + f)
    const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
    const ID = [1, 0, 0, 1, 0, 0];
    const FLIP = [-1, 0, 0, 1, 0, 0]; // OCS with extrusion (0,0,-1)
    const mxf = (m) => {
      const det = m[0] * m[3] - m[1] * m[2];
      return { p: (q) => ({ x: m[0] * q.x + m[2] * q.y + m[4], y: m[1] * q.x + m[3] * q.y + m[5] }), v: (q) => ({ x: m[0] * q.x + m[2] * q.y, y: m[1] * q.x + m[3] * q.y }), s: Math.sqrt(Math.abs(det)), rot: Math.atan2(m[1], m[0]), mirror: det < 0 };
    };
    const flipped = (o) => num(o, 230, 1) < 0;
    const ocs = (o, e) => (flipped(o) && e ? E.transform(e, mxf(FLIP)) : e);
    const bulgePts = (p1, p2, b, out) => {
      if (!b || Math.abs(b) < 1e-9) return;
      const th = 4 * Math.atan(b), d = G.dist(p1, p2);
      if (d < 1e-12) return;
      const r = (d * (1 + b * b)) / (4 * Math.abs(b));
      const u = G.norm(G.sub(p2, p1));
      const c = G.add(G.mid(p1, p2), G.mul(G.perp(u), (d * (1 - b * b)) / (4 * b)));
      const a1 = G.angle(c, p1), n = Math.max(4, Math.ceil(Math.abs(th) / (10 * DEG)));
      for (let k = 1; k < n; k++) out.push(G.polar(c, a1 + (th * k) / n, r));
    };
    const bspline = (deg, knots, ctrl) => {
      const n = ctrl.length;
      if (deg < 1 || n <= deg || knots.length !== n + deg + 1) return ctrl;
      const t0 = knots[deg], t1 = knots[n], out = [], samples = Math.min(400, n * 10);
      for (let s = 0; s <= samples; s++) {
        const t = t0 + ((t1 - t0) * s) / samples;
        let k = deg;
        while (k < n - 1 && !(t >= knots[k] && t < knots[k + 1])) k++;
        const d = ctrl.slice(k - deg, k + 1).map((q) => ({ ...q }));
        for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
          const i = j + k - deg, den = knots[i + deg - r + 1] - knots[i];
          d[j] = G.lerp(d[j - 1], d[j], den ? (t - knots[i]) / den : 0);
        }
        out.push(d[deg]);
      }
      return out;
    };
    const arcPts = (c, r, a1, a2, ccw, out) => {
      if (!ccw) { a1 = -a1; a2 = -a2; }
      const sw = ccw ? G.ccwSweep(a1, a2) : -G.ccwSweep(a2, a1);
      const n = Math.max(4, Math.ceil(Math.abs(sw) / (8 * DEG)));
      for (let k = 0; k <= n; k++) out.push(G.polar(c, a1 + (sw * k) / n, r));
    };
    const hatchLoops = (o) => {
      const g = o.g;
      let i = g.findIndex((x) => x[0] === 91);
      if (i < 0) return [];
      const npaths = parseInt(g[i][1], 10); i++;
      const seek = (code) => { while (i < g.length && g[i][0] !== code) i++; return i < g.length ? g[i++][1] : undefined; };
      const f = (code) => parseFloat(seek(code));
      const loops = [];
      for (let p = 0; p < npaths; p++) {
        const flags = parseInt(seek(92), 10);
        if (isNaN(flags)) break;
        const pts = [];
        if (flags & 2) {
          const hasBulge = seek(72) === '1'; seek(73);
          const n = parseInt(seek(93), 10) || 0;
          const vs = [];
          for (let k = 0; k < n; k++) { const v = { x: f(10), y: f(20), b: 0 }; if (hasBulge && g[i] && g[i][0] === 42) v.b = parseFloat(g[i++][1]); vs.push(v); }
          vs.forEach((v, k) => { pts.push({ x: v.x, y: v.y }); bulgePts(v, vs[(k + 1) % vs.length], v.b, pts); });
        } else {
          const n = parseInt(seek(93), 10) || 0;
          for (let k = 0; k < n; k++) {
            const t = seek(72);
            if (t === '1') { pts.push({ x: f(10), y: f(20) }, { x: f(11), y: f(21) }); }
            else if (t === '2') { const c = { x: f(10), y: f(20) }, r = f(40), a1 = f(50) * DEG, a2 = f(51) * DEG; arcPts(c, r, a1, a2, seek(73) !== '0', pts); }
            else if (t === '3') {
              const c = { x: f(10), y: f(20) }, maj = { x: f(11), y: f(21) }, ratio = f(40);
              let a1 = f(50) * DEG, a2 = f(51) * DEG; const ccw = seek(73) !== '0';
              if (!ccw) { a1 = -a1; a2 = -a2; }
              const sw = ccw ? G.ccwSweep(a1, a2) : -G.ccwSweep(a2, a1), mn = G.mul(G.perp(maj), ratio), m = 24;
              for (let s = 0; s <= m; s++) { const t2 = a1 + (sw * s) / m; pts.push({ x: c.x + maj.x * Math.cos(t2) + mn.x * Math.sin(t2), y: c.y + maj.y * Math.cos(t2) + mn.y * Math.sin(t2) }); }
            } else if (t === '4') {
              const deg = parseInt(seek(94), 10); seek(73); seek(74);
              const nk = parseInt(seek(95), 10) || 0, nc = parseInt(seek(96), 10) || 0;
              const knots = []; for (let q = 0; q < nk; q++) knots.push(f(40));
              const ctrl = []; for (let q = 0; q < nc; q++) ctrl.push({ x: f(10), y: f(20) });
              pts.push(...bspline(deg, knots, ctrl));
            } else break;
          }
        }
        const clean = pts.filter((q, k) => isFinite(q.x) && isFinite(q.y) && (k === 0 || !G.same(q, pts[k - 1], 1e-9)));
        if (clean.length > 2 && G.same(clean[0], clean[clean.length - 1], 1e-9)) clean.pop();
        if (clean.length > 2) loops.push(clean);
      }
      return loops;
    };

    /* Convert one list of DXF objects into entities (+ pseudo '_insert' / '_dim' refs). */
    const convert = (list, inBlock) => {
      const out = [];
      let polyline = null;
      for (const o of list) {
        const b = base(o);
        if (!inBlock && get(o, 67) === '1') { if (o.type !== 'SEQEND' && o.type !== 'VERTEX') skip('paper space'); continue; }
        try {
          switch (o.type) {
            case 'LINE': out.push({ ...b, type: 'line', p1: P(o, 10), p2: P(o, 11) }); break;
            case 'CIRCLE': out.push(ocs(o, { ...b, type: 'circle', c: P(o, 10), r: num(o, 40) })); break;
            case 'ARC': out.push(ocs(o, { ...b, type: 'arc', c: P(o, 10), r: num(o, 40), a1: num(o, 50) * DEG, a2: num(o, 51) * DEG })); break;
            case 'ELLIPSE': {
              const c = P(o, 10), maj = P(o, 11), ratio = num(o, 40, 1);
              const s = num(o, 41, 0), en = num(o, 42, TAU);
              if (Math.abs(G.ccwSweep(s, en) - TAU) < 1e-6) out.push({ ...b, type: 'ellipse', c, maj, ratio });
              else {
                const mn = G.mul(G.perp(maj), ratio), pts = [], sw = G.ccwSweep(s, en), n = 48;
                for (let k = 0; k <= n; k++) { const t = s + (sw * k) / n; pts.push({ x: c.x + maj.x * Math.cos(t) + mn.x * Math.sin(t), y: c.y + maj.y * Math.cos(t) + mn.y * Math.sin(t) }); }
                out.push({ ...b, type: 'pline', pts, closed: false });
              }
              break;
            }
            case 'LWPOLYLINE': {
              const verts = [];
              let v = null;
              for (const [c, val] of o.g) {
                if (c === 10) { v = { x: parseFloat(val), y: 0, b: 0 }; verts.push(v); }
                else if (c === 20 && v) v.y = parseFloat(val);
                else if (c === 42 && v) v.b = parseFloat(val);
              }
              const closed = (parseInt(get(o, 70, '0'), 10) & 1) === 1;
              const pts = [];
              verts.forEach((p, i) => { pts.push({ x: p.x, y: p.y }); const q = verts[i + 1] || (closed ? verts[0] : null); if (q) bulgePts(p, q, p.b, pts); });
              if (pts.length > 1) out.push(ocs(o, { ...b, type: 'pline', pts, closed }));
              break;
            }
            case 'POLYLINE': {
              const fl = parseInt(get(o, 70, '0'), 10);
              polyline = fl & (16 | 64) ? { skip: true } : { ...b, type: 'pline', pts: [], bulges: [], closed: (fl & 1) === 1, flip: flipped(o) };
              if (polyline.skip) skip('3D mesh');
              break;
            }
            case 'VERTEX':
              if (polyline && !polyline.skip && !(parseInt(get(o, 70, '0'), 10) & 16)) { polyline.pts.push(P(o, 10)); polyline.bulges.push(num(o, 42, 0)); }
              break;
            case 'SEQEND':
              if (polyline && !polyline.skip) {
                const pts = [], src = polyline.pts;
                src.forEach((p, i) => { pts.push(p); const q = src[i + 1] || (polyline.closed ? src[0] : null); if (q) bulgePts(p, q, polyline.bulges[i], pts); });
                const flip = polyline.flip;
                delete polyline.bulges; delete polyline.flip; polyline.pts = pts;
                if (pts.length > 1) out.push(flip ? E.transform(polyline, mxf(FLIP)) : polyline);
              }
              polyline = null;
              break;
            case 'TEXT': case 'ATTRIB': {
              if (o.type === 'ATTRIB' && (parseInt(get(o, 70, '0'), 10) & 1)) break;
              const str = uni(get(o, 1, ''));
              if (!str.trim()) break;
              const j = parseInt(get(o, 72, '0'), 10), vj = parseInt(get(o, o.type === 'ATTRIB' ? 74 : 73, '0'), 10);
              const h = num(o, 40, 2.5);
              let rot = num(o, 50, 0) * DEG, p = P(o, 10), align = 'left';
              if ((j === 3 || j === 5) && get(o, 11) !== undefined) rot = G.angle(p, P(o, 11));
              else if ((j || vj) && get(o, 11) !== undefined) {
                p = P(o, 11);
                align = j === 1 || j === 4 ? 'center' : j === 2 ? 'right' : 'left';
                const dy = j === 4 || vj === 2 ? -h / 2 : vj === 3 ? -h : vj === 1 ? h * 0.25 : 0;
                if (dy) p = G.add(p, G.rotate({ x: 0, y: dy }, { x: 0, y: 0 }, rot));
              }
              out.push({ ...b, type: 'text', p, h, rot, text: str, align });
              break;
            }
            case 'MTEXT': {
              const txt = cleanMText(all(o, 3).join('') + get(o, 1, ''));
              if (!txt.trim()) break;
              let rot = num(o, 50, 0) * DEG;
              if (get(o, 11) !== undefined) rot = Math.atan2(num(o, 21), num(o, 11));
              const h = num(o, 40, 2.5), width = num(o, 41, 0);
              const e = { ...b, type: 'mtext', p: P(o, 10), h, width, rot, text: txt };
              const att = parseInt(get(o, 71, '1'), 10);
              if (att > 1 && att <= 9) {
                const ls = wrapLines(txt, h, width);
                const w = width || Math.max(...ls.map((l) => textWidth(l, h)));
                const H = h + (ls.length - 1) * h * LINE_SPACING;
                const col = (att - 1) % 3, row = Math.floor((att - 1) / 3);
                e.p = G.add(e.p, G.rotate({ x: -col * w / 2, y: row * H / 2 }, { x: 0, y: 0 }, rot));
              }
              out.push(e);
              break;
            }
            case 'SOLID': case 'TRACE': {
              const k3 = get(o, 13) !== undefined ? 3 : 2;
              const p = [0, 1, k3, 2].map((k) => P(o, 10 + k));
              out.push(ocs(o, { ...b, type: 'hatch', loops: [p], pattern: 'SOLID', scale: 1, angle: 0 }));
              break;
            }
            case 'HATCH': {
              const loops = hatchLoops(o);
              if (!loops.length) { skip('HATCH (unreadable boundary)'); break; }
              const name = (get(o, 2, 'SOLID') || '').trim().toUpperCase();
              const pattern = get(o, 70) === '1' || name === 'SOLID' ? 'SOLID' : HATCH_PATTERNS[name] ? name : 'ANSI31';
              out.push(ocs(o, { ...b, type: 'hatch', loops, pattern, scale: num(o, 41, 1) || 1, angle: num(o, 52, 0) }));
              break;
            }
            case 'SPLINE': {
              const deg = parseInt(get(o, 71, '3'), 10);
              const knots = all(o, 40).map(parseFloat);
              const ctrl = [], fit = [];
              let last = null;
              for (const [c, val] of o.g) {
                if (c === 10) { last = { x: parseFloat(val), y: 0 }; ctrl.push(last); }
                else if (c === 20 && last && ctrl[ctrl.length - 1] === last) last.y = parseFloat(val);
                else if (c === 11) { last = { x: parseFloat(val), y: 0 }; fit.push(last); }
                else if (c === 21 && last && fit[fit.length - 1] === last) last.y = parseFloat(val);
              }
              const pts = ctrl.length > deg ? bspline(deg, knots, ctrl) : fit;
              if (pts.length > 1) out.push({ ...b, type: 'pline', pts, closed: false });
              break;
            }
            case 'LEADER': {
              const pts = [];
              let v = null;
              for (const [c, val] of o.g) { if (c === 10) { v = { x: parseFloat(val), y: 0 }; pts.push(v); } else if (c === 20 && v) v.y = parseFloat(val); }
              if (pts.length > 1) {
                out.push({ ...b, type: 'pline', pts, closed: false });
                const sz = num(o, 41, 0) || G.dist(pts[0], pts[1]) * 0.15;
                out.push({ ...b, type: 'hatch', loops: [arrowPts(pts[0], G.norm(G.sub(pts[0], pts[1])), sz)], pattern: 'SOLID', scale: 1, angle: 0 });
              }
              break;
            }
            case 'MULTILEADER': case 'MLEADER': {
              let inLeader = false, inLine = false, inCtx = false, conn = null, line = null, text = '', tpos = null, h = null, asz = null;
              const leaderLines = [];
              for (const [c, val] of o.g) {
                const v = val.trim();
                if (c === 300 && v.startsWith('CONTEXT_DATA')) inCtx = true;
                else if (c === 301) inCtx = false;
                else if (c === 302 && v.startsWith('LEADER')) { inLeader = true; conn = null; }
                else if (c === 303) inLeader = false;
                else if (c === 304 && v.startsWith('LEADER_LINE')) { inLine = true; line = []; }
                else if (c === 305) { if (inLine && line) leaderLines.push({ pts: line, conn }); inLine = false; }
                else if (c === 304) text = val;
                else if (inLine && c === 10) line.push({ x: parseFloat(val), y: 0 });
                else if (inLine && c === 20 && line.length) line[line.length - 1].y = parseFloat(val);
                else if (inLeader && !inLine && c === 10 && !conn) conn = { x: parseFloat(val), y: 0 };
                else if (inLeader && !inLine && c === 20 && conn && conn.y === 0) conn.y = parseFloat(val);
                else if (inCtx && !inLeader && c === 12 && !tpos) tpos = { x: parseFloat(val), y: 0 };
                else if (inCtx && !inLeader && c === 22 && tpos && tpos.y === 0) tpos.y = parseFloat(val);
                else if (inCtx && !inLeader && c === 41 && h == null) h = parseFloat(val);
                else if (inCtx && c === 140 && asz == null) asz = parseFloat(val);
              }
              h = h > 0 ? h : 2.5;
              for (const L of leaderLines) {
                const pts = L.conn ? [...L.pts, L.conn] : L.pts;
                if (pts.length < 2) continue;
                out.push({ ...b, type: 'pline', pts, closed: false });
                out.push({ ...b, type: 'hatch', loops: [arrowPts(pts[0], G.norm(G.sub(pts[0], pts[1])), asz > 0 ? asz : h)], pattern: 'SOLID', scale: 1, angle: 0 });
              }
              const t = cleanMText(text || '');
              if (t.trim() && tpos) out.push({ ...b, type: 'mtext', p: tpos, h, width: 0, rot: 0, text: t });
              break;
            }
            case 'INSERT': {
              const sx = num(o, 41, 1), sy = num(o, 42, 1);
              out.push({ ...b, type: '_insert', name: (get(o, 2, '') || '').trim(), p: P(o, 10), sx, sy, rot: num(o, 50, 0) * DEG,
                cols: Math.max(1, num(o, 70, 1)), rows: Math.max(1, num(o, 71, 1)), cs: num(o, 44, 0), rs: num(o, 45, 0), flip: flipped(o) });
              break;
            }
            case 'DIMENSION': {
              const dt = parseInt(get(o, 70, '0'), 10) & 7;
              out.push({ ...b, type: '_dim', name: (get(o, 2, '') || '').trim(), off: P(o, 12), dt, p10: P(o, 10), p13: P(o, 13), p14: P(o, 14), ang: num(o, 50, 0) * DEG, text: uni(get(o, 1, '')) });
              break;
            }
            case 'BLOCK': case 'ENDBLK': case 'ATTDEF': case 'POINT': case 'VIEWPORT': break;
            default: skip(o.type);
          }
        } catch (err) { skip(o.type + ' (error)'); }
      }
      return out;
    };

    // tables
    const layers = [];
    for (const o of objs) {
      if (o.section !== 'TABLES' || o.type !== 'LAYER') continue;
      const col = parseInt(get(o, 62, '7'), 10), fl = parseInt(get(o, 70, '0'), 10);
      let color = aciToHex(Math.abs(col) || 7);
      const tc = get(o, 420);
      if (tc !== undefined) color = '#' + (parseInt(tc, 10) & 0xffffff).toString(16).padStart(6, '0');
      const lt = (get(o, 6, '') || '').toUpperCase();
      const linetype = /HIDDEN|DASHED2/.test(lt) ? 'Hidden' : /CENTER/.test(lt) ? 'Center' : /PHANTOM/.test(lt) ? 'Phantom' : /DASH/.test(lt) ? 'Dashed' : /DOT/.test(lt) ? 'Dot' : 'Continuous';
      const name = (get(o, 2, '0') || '0').trim();
      if (!layers.find((l) => l.name === name)) layers.push({ name, color, visible: col >= 0 && !(fl & 1), locked: (fl & 4) !== 0, linetype });
    }
    // blocks
    const blockObjs = new Map();
    let blk = null;
    const model = [];
    for (const o of objs) {
      if (o.section === 'BLOCKS') {
        if (o.type === 'BLOCK') { blk = { name: (get(o, 2, '') || '').trim(), base: P(o, 10), objs: [] }; blockObjs.set(blk.name.toUpperCase(), blk); }
        else if (o.type === 'ENDBLK') blk = null;
        else if (blk) blk.objs.push(o);
      } else if (o.section === 'ENTITIES') model.push(o);
    }
    const blocks = new Map();
    const blockEnts = (name) => {
      const k = name.toUpperCase();
      if (!blocks.has(k)) { const bo = blockObjs.get(k); blocks.set(k, bo ? { base: bo.base, ents: convert(bo.objs, true) } : null); }
      return blocks.get(k);
    };
    const MAX = 400000;
    const ents = [];
    const emit = (e, m, parent) => {
      if (ents.length >= MAX) { skip('objects over limit'); return; }
      const n = E.clone(e);
      if (parent) {
        if (n.layer === '0') n.layer = parent.layer;
        if (n.color === 'byblock') n.color = parent.color;
      }
      if (m !== ID) E.transform(n, mxf(m));
      if (n.color === 'byblock') n.color = 'bylayer';
      ents.push(n);
    };
    const expand = (list, m, parent, depth) => {
      for (const e of list) {
        if (e.type === '_insert' || e.type === '_dim') {
          const me = parent ? { layer: e.layer === '0' ? parent.layer : e.layer, color: e.color === 'byblock' ? parent.color : e.color } : { layer: e.layer, color: e.color };
          const bk = e.name ? blockEnts(e.name) : null;
          if (e.type === '_dim') {
            if (bk && bk.ents.length && depth < 12) { expand(bk.ents, mul(m, [1, 0, 0, 1, e.off.x, e.off.y]), me, depth + 1); continue; }
            const isAligned = e.dt === 1;
            if (e.dt === 0 || isAligned) emit({ type: 'dim', kind: isAligned ? 'aligned' : 'linear', p1: e.p13, p2: e.p14, pos: e.p10, dirAng: e.ang, h: 2.5, scale: 1, text: e.text, layer: me.layer, color: me.color }, m, null);
            else skip('DIMENSION (no block)');
            continue;
          }
          if (!bk) { skip(`INSERT of missing block`); continue; }
          if (depth > 12) { skip('INSERT (nested too deep)'); continue; }
          for (let r = 0; r < e.rows; r++) for (let c = 0; c < e.cols; c++) {
            const cs = Math.cos(e.rot), sn = Math.sin(e.rot);
            const off = { x: c * e.cs, y: r * e.rs };
            const at = { x: e.p.x + off.x * cs - off.y * sn, y: e.p.y + off.x * sn + off.y * cs };
            let im = mul([cs, sn, -sn, cs, at.x, at.y], mul([e.sx, 0, 0, e.sy, 0, 0], [1, 0, 0, 1, -bk.base.x, -bk.base.y]));
            if (e.flip) im = mul(FLIP, im);
            expand(bk.ents, mul(m, im), me, depth + 1);
          }
          continue;
        }
        emit(e, m, parent);
      }
    };
    expand(convert(model, false), ID, null, 0);
    return { layers, entities: ents, skipped };
  },

  /* ---------------- DWG import (via LibreDWG WebAssembly) ---------------- */
  loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => reject(new Error(`could not load ${src} — keep the "lib" folder next to index.html`));
      document.head.appendChild(s);
    });
  },
  dwgModule() {
    if (!this._dwg) {
      this._dwg = (async () => {
        if (!globalThis.createLibreDwgModule) await this.loadScript('lib/libredwg/libredwg-web.js');
        if (!globalThis.LIBREDWG_WASM_GZ_B64) await this.loadScript('lib/libredwg/libredwg-wasm.js');
        const b64 = globalThis.LIBREDWG_WASM_GZ_B64;
        const bin = atob(b64), gz = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
        if (typeof DecompressionStream === 'undefined') throw new Error('this browser is too old to read DWG files (needs DecompressionStream)');
        const wasm = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
        delete globalThis.LIBREDWG_WASM_GZ_B64;
        return globalThis.createLibreDwgModule({ wasmBinary: wasm, print: () => {}, printErr: () => {} });
      })();
      this._dwg.catch(() => { this._dwg = null; });
    }
    return this._dwg;
  },
  /* Convert DWG bytes to DXF text using LibreDWG. */
  async dwgToDXF(buf) {
    const m = await this.dwgModule();
    const fin = '/bananacad_in.dwg', fout = '/bananacad_out.dxf';
    const exists = (f) => { try { return m.FS.analyzePath(f, false).exists; } catch (err) { return false; } };
    let code, bytes = null;
    try {
      m.FS.writeFile(fin, new Uint8Array(buf));
      code = m.dwg_write_dxf(fin, fout);
      if (exists(fout)) bytes = m.FS.readFile(fout);
    } finally {
      if (exists(fin)) m.FS.unlink(fin);
      if (exists(fout)) m.FS.unlink(fout);
    }
    if (!bytes || !bytes.length) throw new Error(`LibreDWG could not read this DWG (error code ${code}). Try saving it as DXF from AutoCAD instead.`);
    return new TextDecoder('utf-8').decode(bytes);
  },
};
