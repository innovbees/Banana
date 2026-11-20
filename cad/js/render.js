'use strict';
/* Canvas renderer and SVG exporter (both driven by E.ops). */
const LINETYPES = {
  Continuous: [],
  Dashed: [10, 5],
  Hidden: [5, 4],
  Center: [18, 4, 4, 4],
  Phantom: [18, 4, 4, 4, 4, 4],
  Dot: [1.5, 4],
};

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
const printColor = (c) => (luminance(c) > 0.8 ? '#000000' : c);
const LINEWEIGHTS = [0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11];

const IMAGES = new Map();
/* Cached HTMLImageElement for a data URL; calls Render.onImageLoad when it becomes ready. */
function imageFor(src) {
  let img = IMAGES.get(src);
  if (!img) { img = new Image(); img.onload = () => { if (Render.onImageLoad) Render.onImageLoad(); }; img.src = src; IMAGES.set(src, img); }
  return img.complete && img.naturalWidth ? img : null;
}
const drawRank = (e) => (e.type === 'image' ? 0 : e.type === 'hatch' ? 1 : 2);

const Render = {
  layerOf(doc, e) { return doc.layers.find((l) => l.name === e.layer) || doc.layers[0]; },
  colorOf(doc, e) { return !e.color || e.color === 'bylayer' ? this.layerOf(doc, e).color : e.color; },
  dashOf(doc, e) { return LINETYPES[this.layerOf(doc, e).linetype] || []; },
  /* Lineweight in mm (ByLayer -> layer, default 0.25). */
  lwOf(doc, e) { const v = e.lw == null || e.lw === 'bylayer' ? this.layerOf(doc, e).lw : e.lw; return v == null || v === 'default' ? 0.25 : +v; },

  /* st: {ctx, dpr, W, H, view:{cx,cy,scale}, doc} */
  worldXf(st) {
    const s = st.view.scale, d = st.dpr;
    st.ctx.setTransform(d * s, 0, 0, -d * s, d * (st.W / 2 - st.view.cx * s), d * (st.H / 2 + st.view.cy * s));
  },
  toScreen(st, p) { return { x: (p.x - st.view.cx) * st.view.scale + st.W / 2, y: st.H / 2 - (p.y - st.view.cy) * st.view.scale }; },

  drawOps(st, ops, color, opt = {}) {
    const ctx = st.ctx, s = st.view.scale;
    const lw = (opt.lw || 1) / s;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash((opt.dash || []).map((v) => v / s));
    for (const op of ops) {
      switch (op.op) {
        case 'poly':
          if (op.pts.length < 2) break;
          ctx.beginPath(); ctx.moveTo(op.pts[0].x, op.pts[0].y);
          for (let i = 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i].x, op.pts[i].y);
          if (op.closed) ctx.closePath();
          if (op.lw) { ctx.lineWidth = Math.max(op.lw, opt.lw || 1) / s; ctx.stroke(); ctx.lineWidth = lw; } else ctx.stroke();
          break;
        case 'circle': ctx.beginPath(); ctx.arc(op.c.x, op.c.y, Math.max(op.r, 0), 0, TAU); ctx.stroke(); break;
        case 'arc': ctx.beginPath(); ctx.arc(op.c.x, op.c.y, Math.max(op.r, 0), op.a1, op.a1 + G.ccwSweep(op.a1, op.a2), false); ctx.stroke(); break;
        case 'ellipse': ctx.beginPath(); ctx.ellipse(op.c.x, op.c.y, Math.max(op.rx, 0), Math.max(op.ry, 0), op.rot, 0, TAU); ctx.stroke(); break;
        case 'fill':
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(op.pts[0].x, op.pts[0].y);
          for (let i = 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i].x, op.pts[i].y);
          ctx.closePath(); ctx.fill();
          ctx.setLineDash((opt.dash || []).map((v) => v / s));
          break;
        case 'text': this.drawText(st, op, color); break;
        case 'hatch': this.drawHatch(st, op, color, opt); break;
        case 'image': {
          const img = imageFor(op.src);
          ctx.save();
          ctx.translate(op.p.x, op.p.y); ctx.rotate(op.rot || 0);
          if (img && !opt.preview && !opt.color) { ctx.globalAlpha = op.opacity ?? 1; ctx.translate(0, op.h); ctx.scale(1, -1); ctx.drawImage(img, 0, 0, op.w, op.h); }
          else { ctx.setLineDash([4 / s, 4 / s]); ctx.strokeRect(0, 0, op.w, op.h); }
          ctx.restore();
          break;
        }
      }
    }
    ctx.setLineDash([]);
  },

  drawText(st, op, color) {
    const ctx = st.ctx, s = st.view.scale;
    const px = (op.h / CAP_RATIO) * s;
    if (!op.str) return;
    const ts = E.tstyle(op.style);
    if (px < 2.5) { // greeked text
      const w = textWidth(op.str, op.h, ts);
      const x0 = op.align === 'center' ? -w / 2 : op.align === 'right' ? -w : 0;
      const a = G.add(op.p, G.rotate({ x: x0, y: op.h * 0.4 }, { x: 0, y: 0 }, op.rot || 0));
      const b = G.add(op.p, G.rotate({ x: x0 + w, y: op.h * 0.4 }, { x: 0, y: 0 }, op.rot || 0));
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1;
      return;
    }
    const sp = this.toScreen(st, op.p);
    ctx.save();
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.translate(sp.x, sp.y); ctx.rotate(-(op.rot || 0));
    if (ts.oblique) ctx.transform(1, 0, -Math.tan(ts.oblique * DEG), 1, 0, 0);
    if (ts.width && ts.width !== 1) ctx.scale(ts.width, 1);
    ctx.font = `${px}px ${fontStack(ts.font)}`; ctx.textAlign = op.align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(op.str, 0, 0);
    ctx.restore();
  },

  drawHatch(st, op, color, opt) {
    const ctx = st.ctx, s = st.view.scale;
    if (!op.loops.length) return;
    const path = () => { ctx.beginPath(); for (const l of op.loops) { ctx.moveTo(l[0].x, l[0].y); for (let i = 1; i < l.length; i++) ctx.lineTo(l[i].x, l[i].y); ctx.closePath(); } };
    const pat = HATCH_PATTERNS[op.pattern];
    if (!pat) { path(); ctx.globalAlpha = opt.preview ? 0.4 : 1; ctx.fill('evenodd'); ctx.globalAlpha = 1; return; }
    ctx.setLineDash([]);
    for (const fam of pat) {
      const sp = fam.sp * (op.scale || 1);
      const segs = sp * s < 2 ? null : G.hatchSegments(op.loops, (fam.ang + (op.angle || 0)) * DEG, sp, 3000);
      if (!segs) { path(); ctx.globalAlpha = 0.25; ctx.fill('evenodd'); ctx.globalAlpha = 1; return; }
      ctx.beginPath();
      for (const [a, b] of segs) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }
  },

  drawEntity(st, e, opt = {}) {
    if (e.type === 'insert') {
      for (const c of E.children(e)) { const l = this.layerOf(st.doc, c); if (l && !l.visible) continue; this.drawEntity(st, c, opt); }
      return;
    }
    const color = opt.color || (st.print ? printColor(this.colorOf(st.doc, e)) : this.colorOf(st.doc, e));
    let lw = opt.lw;
    if (lw == null && st.lwt) lw = Math.max(1, this.lwOf(st.doc, e) * 3.78 * (st.lwScale || 1));
    this.drawOps(st, E.ops(e, st.doc), color, { dash: opt.dash || this.dashOf(st.doc, e), lw, preview: opt.preview });
  },

  /* Draw a whole drawing (used by on-screen render and PNG export). */
  drawDrawing(st, skip, only, list) {
    const doc = st.doc, vis = new Set(doc.layers.filter((l) => l.visible).map((l) => l.name));
    let ents = (list || doc.entities).filter((e) => vis.has(e.layer) && !(skip && skip.has(e.id)) && (!only || only.has(e.id)));
    if (st.bbox) { // skip objects outside the visible area
      const v = st.view, hw = st.W / 2 / v.scale, hh = st.H / 2 / v.scale;
      const r = { minx: v.cx - hw, maxx: v.cx + hw, miny: v.cy - hh, maxy: v.cy + hh };
      ents = ents.filter((e) => { const b = st.bbox(e); return !isFinite(b.minx) || !(b.maxx < r.minx || b.minx > r.maxx || b.maxy < r.miny || b.miny > r.maxy); });
    }
    this.worldXf(st);
    for (let k = 0; k < 3; k++) for (const e of ents) if (drawRank(e) === k) this.drawEntity(st, e);
  },

  extents(doc, ents) {
    const b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
    for (const e of ents || doc.entities) {
      const l = this.layerOf(doc, e);
      if (!ents && l && !l.visible) continue;
      const q = E.bbox(e, doc);
      if (!isFinite(q.minx)) continue;
      b.minx = Math.min(b.minx, q.minx); b.miny = Math.min(b.miny, q.miny); b.maxx = Math.max(b.maxx, q.maxx); b.maxy = Math.max(b.maxy, q.maxy);
    }
    return isFinite(b.minx) ? b : null;
  },

  toSVG(doc) {
    const b = this.extents(doc, doc.model) || { minx: 0, miny: 0, maxx: 100, maxy: 100 };
    const w0 = Math.max(b.maxx - b.minx, 1e-6), h0 = Math.max(b.maxy - b.miny, 1e-6);
    const m = Math.max(w0, h0) * 0.04;
    const vb = [b.minx - m, -(b.maxy + m), w0 + 2 * m, h0 + 2 * m];
    const sw = Math.max(vb[2], vb[3]) / 1400;
    const n = (v) => +v.toFixed(6);
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const out = [];
    const vis = new Set(doc.layers.filter((l) => l.visible).map((l) => l.name));
    const ents = [];
    for (const e0 of doc.model || doc.entities) if (vis.has(e0.layer)) for (const e of E.flatten(e0)) if (vis.has(e.layer)) ents.push(e);
    ents.sort((a, b2) => drawRank(a) - drawRank(b2));
    for (const e of ents) {
      const c = printColor(this.colorOf(doc, e));
      const dash = this.dashOf(doc, e);
      const da = dash.length ? ` stroke-dasharray="${dash.map((v) => n(v * sw)).join(' ')}"` : '';
      const st = `fill="none" stroke="${c}" stroke-width="${n(sw)}"${da}`;
      for (const op of E.ops(e, doc)) {
        switch (op.op) {
          case 'poly': out.push(`<${op.closed ? 'polygon' : 'polyline'} points="${op.pts.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')}" ${op.lw ? st.replace(/stroke-width="[^"]*"/, `stroke-width="${n(sw * op.lw)}"`) : st}/>`); break;
          case 'fill': out.push(`<polygon points="${op.pts.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')}" fill="${c}"/>`); break;
          case 'circle': out.push(`<circle cx="${n(op.c.x)}" cy="${n(op.c.y)}" r="${n(op.r)}" ${st}/>`); break;
          case 'arc': {
            const sw2 = G.ccwSweep(op.a1, op.a2), p1 = G.polar(op.c, op.a1, op.r), p2 = G.polar(op.c, op.a2, op.r);
            if (sw2 >= TAU - 1e-9) { out.push(`<circle cx="${n(op.c.x)}" cy="${n(op.c.y)}" r="${n(op.r)}" ${st}/>`); break; }
            out.push(`<path d="M${n(p1.x)} ${n(p1.y)} A${n(op.r)} ${n(op.r)} 0 ${sw2 > Math.PI ? 1 : 0} 1 ${n(p2.x)} ${n(p2.y)}" ${st}/>`); break;
          }
          case 'ellipse': out.push(`<ellipse cx="${n(op.c.x)}" cy="${n(op.c.y)}" rx="${n(op.rx)}" ry="${n(op.ry)}" transform="rotate(${n(op.rot / DEG)} ${n(op.c.x)} ${n(op.c.y)})" ${st}/>`); break;
          case 'text':
            if (!op.str) break;
            { const ts = E.tstyle(op.style);
            out.push(`<text transform="translate(${n(op.p.x)} ${n(op.p.y)}) rotate(${n((op.rot || 0) / DEG)}) scale(1 -1)${ts.oblique ? ` skewX(${n(-ts.oblique)})` : ''}${ts.width && ts.width !== 1 ? ` scale(${n(ts.width)} 1)` : ''}" font-family="${esc(fontStack(ts.font)).replace(/"/g, "'")}" font-size="${n(op.h / CAP_RATIO)}" text-anchor="${{ left: 'start', center: 'middle', right: 'end' }[op.align || 'left']}" fill="${c}" xml:space="preserve">${esc(op.str)}</text>`); }
            break;
          case 'image':
            out.push(`<image href="${op.src}" x="0" y="0" width="${n(op.w)}" height="${n(op.h)}" preserveAspectRatio="none" opacity="${n(op.opacity ?? 1)}" transform="translate(${n(op.p.x)} ${n(op.p.y)}) rotate(${n((op.rot || 0) / DEG)}) translate(0 ${n(op.h)}) scale(1 -1)"/>`);
            break;
          case 'hatch': {
            const d = op.loops.map((l) => 'M' + l.map((p) => `${n(p.x)} ${n(p.y)}`).join(' L') + ' Z').join(' ');
            const pat = HATCH_PATTERNS[op.pattern];
            if (!pat) { out.push(`<path d="${d}" fill="${c}" fill-rule="evenodd" stroke="none"/>`); break; }
            for (const fam of pat) {
              const segs = G.hatchSegments(op.loops, (fam.ang + (op.angle || 0)) * DEG, fam.sp * (op.scale || 1), 5000);
              if (!segs) { out.push(`<path d="${d}" fill="${c}" fill-opacity="0.25" fill-rule="evenodd" stroke="none"/>`); break; }
              out.push(`<path d="${segs.map(([a, b2]) => `M${n(a.x)} ${n(a.y)}L${n(b2.x)} ${n(b2.y)}`).join('')}" fill="none" stroke="${c}" stroke-width="${n(sw * 0.7)}"/>`);
            }
            break;
          }
        }
      }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(n).join(' ')}" width="${Math.round(vb[2] >= vb[3] ? 1600 : (1600 * vb[2]) / vb[3])}" height="${Math.round(vb[3] > vb[2] ? 1600 : (1600 * vb[3]) / vb[2])}">\n<rect x="${n(vb[0])}" y="${n(vb[1])}" width="${n(vb[2])}" height="${n(vb[3])}" fill="#ffffff"/>\n<g transform="scale(1 -1)" stroke-linecap="round" stroke-linejoin="round">\n${out.join('\n')}\n</g>\n</svg>\n`;
  },
};
