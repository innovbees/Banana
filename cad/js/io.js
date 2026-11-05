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

  /* ---------------- DXF import ---------------- */
  fromDXF(text) {
    const lines = text.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].replace(/\s+$/, '')]);
    const layers = [], ents = [], skipped = {};
    let section = null, expectName = false, cur = null, polyline = null;
    const objs = [];
    for (const [c, v] of pairs) {
      if (c === 0) {
        if (cur) objs.push(cur);
        cur = null;
        if (v === 'SECTION') { expectName = true; continue; }
        if (v === 'ENDSEC') { section = null; continue; }
        if (section === 'ENTITIES' || (section === 'TABLES' && v === 'LAYER')) cur = { type: v, g: [] };
      } else if (c === 2 && expectName) { section = v.trim(); expectName = false; }
      else if (cur) cur.g.push([c, v]);
    }
    if (cur) objs.push(cur);

    const get = (o, c, d) => { const p = o.g.find((x) => x[0] === c); return p ? p[1] : d; };
    const num = (o, c, d = 0) => { const v = get(o, c); return v === undefined ? d : parseFloat(v); };
    const base = (o) => {
      const col = parseInt(get(o, 62, '256'), 10);
      return { layer: (get(o, 8, '0') || '0').trim(), color: col > 0 && col < 256 ? aciToHex(col) : 'bylayer' };
    };
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
    const cleanMText = (s) => s
      .replace(/\\P/g, '\n').replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '').replace(/\\[LlOoKk]/g, '')
      .replace(/\\S([^;]*);/g, (m, x) => x.replace(/[#^]/, '/')).replace(/[{}]/g, '').replace(/%%[cC]/g, '⌀').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');

    for (const o of objs) {
      const b = base(o);
      switch (o.type) {
        case 'LAYER': {
          const col = parseInt(get(o, 62, '7'), 10);
          layers.push({ name: (get(o, 2, '0') || '0').trim(), color: aciToHex(col || 7), visible: col >= 0, locked: (parseInt(get(o, 70, '0'), 10) & 4) !== 0, linetype: 'Continuous' });
          break;
        }
        case 'LINE': ents.push({ ...b, type: 'line', p1: { x: num(o, 10), y: num(o, 20) }, p2: { x: num(o, 11), y: num(o, 21) } }); break;
        case 'CIRCLE': ents.push({ ...b, type: 'circle', c: { x: num(o, 10), y: num(o, 20) }, r: num(o, 40) }); break;
        case 'ARC': ents.push({ ...b, type: 'arc', c: { x: num(o, 10), y: num(o, 20) }, r: num(o, 40), a1: num(o, 50) * DEG, a2: num(o, 51) * DEG }); break;
        case 'ELLIPSE': {
          const c = { x: num(o, 10), y: num(o, 20) }, maj = { x: num(o, 11), y: num(o, 21) }, ratio = num(o, 40, 1);
          const s = num(o, 41, 0), en = num(o, 42, TAU);
          if (Math.abs(G.ccwSweep(s, en) - TAU) < 1e-6) ents.push({ ...b, type: 'ellipse', c, maj, ratio });
          else {
            const mn = G.mul(G.perp(maj), ratio), pts = [], sw = G.ccwSweep(s, en), n = 48;
            for (let k = 0; k <= n; k++) { const t = s + (sw * k) / n; pts.push({ x: c.x + maj.x * Math.cos(t) + mn.x * Math.sin(t), y: c.y + maj.y * Math.cos(t) + mn.y * Math.sin(t) }); }
            ents.push({ ...b, type: 'pline', pts, closed: false });
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
          verts.forEach((p, i) => {
            pts.push({ x: p.x, y: p.y });
            const q = verts[i + 1] || (closed ? verts[0] : null);
            if (q) bulgePts(p, q, p.b, pts);
          });
          if (pts.length > 1) ents.push({ ...b, type: 'pline', pts, closed });
          break;
        }
        case 'POLYLINE': polyline = { ...b, type: 'pline', pts: [], bulges: [], closed: (parseInt(get(o, 70, '0'), 10) & 1) === 1 }; break;
        case 'VERTEX': if (polyline) { polyline.pts.push({ x: num(o, 10), y: num(o, 20) }); polyline.bulges.push(num(o, 42, 0)); } break;
        case 'SEQEND':
          if (polyline) {
            const pts = [], src = polyline.pts;
            src.forEach((p, i) => { pts.push(p); const q = src[i + 1] || (polyline.closed ? src[0] : null); if (q) bulgePts(p, q, polyline.bulges[i], pts); });
            delete polyline.bulges; polyline.pts = pts;
            if (pts.length > 1) ents.push(polyline);
            polyline = null;
          }
          break;
        case 'TEXT': {
          const j = parseInt(get(o, 72, '0'), 10), vj = parseInt(get(o, 73, '0'), 10);
          const p = (j || vj) && get(o, 11) !== undefined ? { x: num(o, 11), y: num(o, 21) } : { x: num(o, 10), y: num(o, 20) };
          ents.push({ ...b, type: 'text', p, h: num(o, 40, 2.5), rot: num(o, 50, 0) * DEG, text: cleanMText(get(o, 1, '')), align: j === 1 || j === 4 ? 'center' : j === 2 ? 'right' : 'left' });
          break;
        }
        case 'MTEXT': {
          const txt = o.g.filter((x) => x[0] === 3).map((x) => x[1]).join('') + get(o, 1, '');
          let rot = num(o, 50, 0) * DEG;
          if (get(o, 11) !== undefined) rot = Math.atan2(num(o, 21), num(o, 11));
          ents.push({ ...b, type: 'mtext', p: { x: num(o, 10), y: num(o, 20) }, h: num(o, 40, 2.5), width: num(o, 41, 0), rot, text: cleanMText(txt) });
          break;
        }
        case 'SOLID': {
          const k3 = get(o, 13) !== undefined ? 3 : 2;
          const p = [0, 1, k3, 2].map((k) => ({ x: num(o, 10 + k), y: num(o, 20 + k) }));
          ents.push({ ...b, type: 'hatch', loops: [p], pattern: 'SOLID', scale: 1, angle: 0 });
          break;
        }
        default:
          if (o.type !== 'ATTRIB' && o.type !== 'ATTDEF') skipped[o.type] = (skipped[o.type] || 0) + 1;
      }
    }
    return { layers, entities: ents, skipped };
  },
};
