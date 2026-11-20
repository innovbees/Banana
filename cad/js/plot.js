'use strict';
/* Plotting: paper sizes, scales, a small vector PDF writer and the Plot dialog. */
const PAPERS = {
  A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8], 'ANSI C': [431.8, 558.8], 'ANSI D': [558.8, 863.6],
};
const UNITS_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const STD_SCALES = [['1:1', 1], ['1:2', 2], ['1:5', 5], ['1:10', 10], ['1:20', 20], ['1:25', 25], ['1:50', 50], ['1:75', 75], ['1:100', 100], ['1:200', 200], ['1:250', 250], ['1:500', 500], ['1:1000', 1000], ['2:1', 0.5], ['5:1', 0.2], ['10:1', 0.1]];
const MM2PT = 72 / 25.4;

function paperSize(L) {
  const [a, b] = PAPERS[L.paper] || PAPERS.A3;
  return L.orient === 'portrait' ? { w: a, h: b } : { w: b, h: a };
}
/* Paper mm per drawing unit for a 1:N scale. */
const scaleFactor = (doc, N) => (UNITS_MM[doc.units || 'mm'] || 1) / N;
function scaleLabel(doc, s) {
  const N = (UNITS_MM[doc.units || 'mm'] || 1) / s;
  for (const [l, n] of STD_SCALES) if (Math.abs(n - N) / n < 1e-6) return l;
  return N >= 1 ? `1:${+N.toFixed(2)}` : `${+(1 / N).toFixed(2)}:1`;
}
/* Largest standard scale at which `w × h` drawing units fit in `pw × ph` paper mm. */
function fitStdScale(doc, w, h, pw, ph) {
  const fit = Math.min(pw / Math.max(w, 1e-9), ph / Math.max(h, 1e-9));
  let best = null;
  for (const [, N] of STD_SCALES) { const s = scaleFactor(doc, N); if (s <= fit * 1.0001 && (!best || s > best)) best = s; }
  return best || fit;
}

/* ---------------- PDF writer ---------------- */
class PdfPage {
  constructor(wmm, hmm) { this.w = wmm * MM2PT; this.h = hmm * MM2PT; this.c = []; this.imgs = []; this.imgIndex = new Map(); }
  /* Register an image (re-encoded as JPEG through a canvas) and return its resource name. */
  image(img, src) {
    if (this.imgIndex.has(src)) return this.imgIndex.get(src);
    const cv = document.createElement('canvas');
    const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
    const b64 = cv.toDataURL('image/jpeg', 0.9).split(',')[1], bin = atob(b64);
    const name = `Im${this.imgs.length + 1}`;
    this.imgs.push({ name, w: cv.width, h: cv.height, data: bin });
    this.imgIndex.set(src, name);
    return name;
  }
  n(v) { if (!isFinite(v)) v = 0; const s = (Math.round(v * 1000) / 1000).toFixed(3); return s.replace(/\.?0+$/, '') || '0'; }
  push(s) { this.c.push(s); }
  rgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || [0, '000000']; const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => this.n(x / 255)).join(' '); }
  color(hex) { const c = this.rgb(hex); this.push(`${c} RG ${c} rg`); }
  cm(m) { this.push(`${m.map((v) => this.n(v)).join(' ')} cm`); }
  path(pts, closed) { if (pts.length < 2) return; this.push(`${this.n(pts[0].x)} ${this.n(pts[0].y)} m`); for (let i = 1; i < pts.length; i++) this.push(`${this.n(pts[i].x)} ${this.n(pts[i].y)} l`); if (closed) this.push('h'); }
  /* Elliptical arc c + ax·cos t + by·sin t for t in [t0, t0+sw] as Bézier curves (appends to path). */
  earc(c, ax, by, t0, sw, move) {
    const segs = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2))), d = sw / segs, k = (4 / 3) * Math.tan(d / 4);
    const P = (u, v) => ({ x: c.x + ax.x * u + by.x * v, y: c.y + ax.y * u + by.y * v });
    let t = t0, p0 = P(Math.cos(t), Math.sin(t));
    if (move) this.push(`${this.n(p0.x)} ${this.n(p0.y)} m`);
    for (let i = 0; i < segs; i++) {
      const t1 = t + d;
      const c1 = P(Math.cos(t) - k * Math.sin(t), Math.sin(t) + k * Math.cos(t));
      const c2 = P(Math.cos(t1) + k * Math.sin(t1), Math.sin(t1) - k * Math.cos(t1));
      const p1 = P(Math.cos(t1), Math.sin(t1));
      this.push(`${this.n(c1.x)} ${this.n(c1.y)} ${this.n(c2.x)} ${this.n(c2.y)} ${this.n(p1.x)} ${this.n(p1.y)} c`);
      t = t1; p0 = p1;
    }
  }
  text(op, font, size, wf, obl, w) {
    const r = op.rot || 0, cs = Math.cos(r), sn = Math.sin(r), tn = Math.tan((obl || 0) * DEG);
    const x0 = op.align === 'center' ? -w / 2 : op.align === 'right' ? -w : 0;
    const x = op.p.x + cs * x0, y = op.p.y + sn * x0;
    const m = [cs * wf, sn * wf, cs * tn - sn, sn * tn + cs, x, y];
    this.push(`BT /${font} ${this.n(size)} Tf ${m.map((v) => this.n(v)).join(' ')} Tm (${PdfPage.str(op.str)}) Tj ET`);
  }
  static str(s) {
    const map = { '⌀': 0xd8, '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };
    let out = '';
    for (const ch of String(s)) {
      let code = ch.codePointAt(0);
      if (map[ch]) code = map[ch]; else if (code > 255 || (code < 32 && code !== 9)) code = 63;
      const c = String.fromCharCode(code);
      out += c === '\\' || c === '(' || c === ')' ? '\\' + c : c;
    }
    return out;
  }
  build(title) {
    const content = this.c.join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.n(this.w)} ${this.n(this.h)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >>${this.imgs.length ? ` /XObject << ${this.imgs.map((im, i) => `/${im.name} ${9 + i} 0 R`).join(' ')} >>` : ''} >> >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
      `<< /Title (${PdfPage.str(title || 'Drawing')}) /Producer (BananaCAD) >>`,
      ...this.imgs.map((im) => `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n${im.data}\nendstream`),
    ];
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
}

const Plot = {
  /* Draw a list of entities into the PDF. `upt` = PDF points per drawing unit (for line widths). */
  drawList(pdf, doc, list, upt, cfg) {
    const lay = (e) => doc.layers.find((l) => l.name === e.layer) || doc.layers[0];
    const flat = [];
    for (const e0 of list) {
      const l0 = lay(e0);
      if (!l0.visible || l0.plot === false || e0.type === 'viewport') continue;
      for (const e of E.flatten(e0)) { const l = lay(e); if (l.visible && l.plot !== false) flat.push(e); }
    }
    flat.sort((a, b) => drawRank(a) - drawRank(b));
    for (const e of flat) {
      const col = cfg.mono ? '#000000' : printColor(Render.colorOf(doc, e));
      pdf.color(col);
      const lwmm = cfg.lwt ? Math.max(Render.lwOf(doc, e), 0.05) : 0.18;
      const lw = (lwmm * MM2PT) / upt;
      const dash = Render.dashOf(doc, e).map((v) => (v * 0.35 * MM2PT) / upt);
      pdf.push(`${pdf.n(lw)} w ${dash.length ? `[${dash.map((v) => pdf.n(v)).join(' ')}] 0 d` : '[] 0 d'}`);
      for (const op of E.ops(e, doc)) {
        switch (op.op) {
          case 'poly':
            if (op.lw) pdf.push(`${pdf.n(lw * 2)} w`);
            pdf.path(op.pts, op.closed); pdf.push('S');
            if (op.lw) pdf.push(`${pdf.n(lw)} w`);
            break;
          case 'fill': pdf.path(op.pts, true); pdf.push('f'); break;
          case 'image': {
            const img = imageFor(op.src);
            if (!img) break;
            const nm = pdf.image(img, op.src), r = op.rot || 0, cs = Math.cos(r), sn = Math.sin(r);
            pdf.push('q'); pdf.cm([op.w * cs, op.w * sn, -op.h * sn, op.h * cs, op.p.x, op.p.y]); pdf.push(`/${nm} Do Q`);
            break;
          }
          case 'circle': pdf.earc(op.c, { x: op.r, y: 0 }, { x: 0, y: op.r }, 0, TAU, true); pdf.push('h S'); break;
          case 'arc': pdf.earc(op.c, { x: op.r, y: 0 }, { x: 0, y: op.r }, op.a1, G.ccwSweep(op.a1, op.a2), true); pdf.push('S'); break;
          case 'ellipse': { const cs = Math.cos(op.rot), sn = Math.sin(op.rot); pdf.earc(op.c, { x: op.rx * cs, y: op.rx * sn }, { x: -op.ry * sn, y: op.ry * cs }, 0, TAU, true); pdf.push('h S'); break; }
          case 'text': {
            if (!op.str) break;
            const ts = E.tstyle(op.style), fam = (ts.font || '').toLowerCase();
            const font = /times|georgia|serif/.test(fam) ? 'F2' : /courier|consolas|mono/.test(fam) ? 'F3' : 'F1';
            pdf.text(op, font, op.h / CAP_RATIO, ts.width || 1, ts.oblique || 0, textWidth(op.str, op.h, ts));
            break;
          }
          case 'hatch': {
            const pat = HATCH_PATTERNS[op.pattern];
            const loops = () => { for (const l of op.loops) pdf.path(l, true); };
            if (!pat) { loops(); pdf.push('f*'); break; }
            for (const fam of pat) {
              const segs = G.hatchSegments(op.loops, (fam.ang + (op.angle || 0)) * DEG, fam.sp * (op.scale || 1), 20000);
              if (!segs) { pdf.push('q'); pdf.color(cfg.mono ? '#bbbbbb' : '#cccccc'); loops(); pdf.push('f* Q'); break; }
              pdf.push(`${pdf.n(lw * 0.7)} w [] 0 d`);
              for (const [a, b] of segs) pdf.path([a, b], false);
              pdf.push('S');
            }
            break;
          }
        }
      }
    }
  },

  /* Build a PDF for model space or a layout. */
  pdf(app, cfg) {
    const doc = app.doc;
    E.ctxDoc = doc;
    if (cfg.space >= 0) {
      const L = doc.layouts[cfg.space], ps = paperSize(L), pdf = new PdfPage(ps.w, ps.h);
      pdf.push('1 j 1 J');
      pdf.push('q'); pdf.cm([MM2PT, 0, 0, MM2PT, 0, 0]);
      for (const vp of L.ents.filter((e) => e.type === 'viewport' && e.on !== false)) {
        const l = doc.layers.find((x) => x.name === vp.layer);
        if (l && !l.visible) continue;
        const P0 = G.mid(vp.p1, vp.p2), s = vp.scale;
        pdf.push('q');
        pdf.push(`${pdf.n(vp.p1.x)} ${pdf.n(vp.p1.y)} ${pdf.n(vp.p2.x - vp.p1.x)} ${pdf.n(vp.p2.y - vp.p1.y)} re W n`);
        pdf.cm([s, 0, 0, s, P0.x - vp.cx * s, P0.y - vp.cy * s]);
        this.drawList(pdf, doc, doc.model, s * MM2PT, cfg);
        pdf.push('Q');
      }
      this.drawList(pdf, doc, L.ents, MM2PT, cfg);
      for (const vp of L.ents.filter((e) => e.type === 'viewport')) {
        const l = doc.layers.find((x) => x.name === vp.layer);
        if (!l || !l.visible || l.plot === false) continue;
        pdf.color('#000000'); pdf.push(`${pdf.n(0.25)} w [] 0 d`); pdf.path(vpCorners(vp), true); pdf.push('S');
      }
      pdf.push('Q');
      return { bytes: pdf.build(`${doc.name} - ${L.name}`), paper: ps, scale: null };
    }
    // model space
    const [a, b] = PAPERS[cfg.paper] || PAPERS.A3;
    const ps = cfg.orient === 'portrait' ? { w: a, h: b } : { w: b, h: a };
    const pdf = new PdfPage(ps.w, ps.h);
    let area = cfg.area === 'display' ? (() => { const tl = app.toWorld(0, 0), br = app.toWorld(app.W, app.H); return { minx: tl.x, maxx: br.x, miny: br.y, maxy: tl.y }; })() : Render.extents(doc, doc.model);
    if (!area) area = { minx: 0, miny: 0, maxx: 100, maxy: 100 };
    const m = cfg.margin ?? 10, aw = area.maxx - area.minx, ah = area.maxy - area.miny;
    const s = cfg.scaleN === 'fit' ? Math.min((ps.w - 2 * m) / Math.max(aw, 1e-9), (ps.h - 2 * m) / Math.max(ah, 1e-9)) : scaleFactor(doc, cfg.scaleN);
    const cx = (area.minx + area.maxx) / 2, cy = (area.miny + area.maxy) / 2;
    pdf.push('1 j 1 J');
    pdf.push('q'); pdf.cm([MM2PT, 0, 0, MM2PT, 0, 0]);
    pdf.push(`${pdf.n(m)} ${pdf.n(m)} ${pdf.n(ps.w - 2 * m)} ${pdf.n(ps.h - 2 * m)} re W n`);
    pdf.cm([s, 0, 0, s, ps.w / 2 - cx * s, ps.h / 2 - cy * s]);
    this.drawList(pdf, doc, doc.model, s * MM2PT, cfg);
    pdf.push('Q');
    return { bytes: pdf.build(doc.name), paper: ps, scale: s };
  },

  /* ---------------- dialog ---------------- */
  open(app) {
    const doc = app.doc, inLayout = app.space >= 0;
    const L = inLayout ? doc.layouts[app.space] : null;
    const prev = doc.plotCfg || {};
    const box = document.getElementById('plotdlg');
    const body = document.getElementById('plotbody');
    body.innerHTML = '';
    const h = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
    body.appendChild(h('h2', null, 'Plot / Export PDF'));
    const g = h('div', 'grid2');
    const sel = (label, opts, val) => { const s = h('select'); opts.forEach(([v, l]) => { const o = h('option', null, l); o.value = v; s.appendChild(o); }); s.value = val; g.append(h('label', null, label), s); return s; };
    const what = sel('What to plot', [['-1', 'Model space'], ...doc.layouts.map((l, i) => [String(i), `Layout: ${l.name}`])], String(app.space));
    const paper = sel('Paper size', Object.keys(PAPERS).map((k) => [k, `${k} (${PAPERS[k][0]} × ${PAPERS[k][1]} mm)`]), L ? L.paper : prev.paper || 'A3');
    const orient = sel('Orientation', [['landscape', 'Landscape'], ['portrait', 'Portrait']], L ? L.orient : prev.orient || 'landscape');
    const area = sel('Plot area', [['extents', 'Extents (whole drawing)'], ['display', 'Current display']], prev.area || 'extents');
    const scale = sel('Scale', [['fit', 'Fit to paper'], ...STD_SCALES.map(([l, n]) => [String(n), l])], prev.scaleN != null ? String(prev.scaleN) : 'fit');
    const mono = h('input'); mono.type = 'checkbox'; mono.checked = prev.mono ?? true;
    g.append(h('label', null, 'Monochrome (black)'), mono);
    const lwt = h('input'); lwt.type = 'checkbox'; lwt.checked = prev.lwt ?? true;
    g.append(h('label', null, 'Plot lineweights'), lwt);
    body.appendChild(g);
    const info = h('div', 'muted');
    body.appendChild(info);
    const refresh = () => {
      const lay = what.value !== '-1';
      [paper, orient, area, scale].forEach((x) => (x.disabled = false));
      if (lay) {
        const LL = doc.layouts[+what.value];
        paper.value = LL.paper; orient.value = LL.orient; paper.disabled = orient.disabled = area.disabled = scale.disabled = true;
        info.textContent = `Layouts plot 1:1 on their sheet (${LL.paper} ${LL.orient}); each viewport keeps its own scale. Change paper in the layout's page setup.`;
      } else {
        const ext = Render.extents(doc, doc.model);
        const u = doc.units || 'mm';
        info.textContent = ext ? `Drawing extents: ${fmtNum(ext.maxx - ext.minx, 2)} × ${fmtNum(ext.maxy - ext.miny, 2)} ${u}. Scales assume drawing units = ${u} (change in Settings).` : 'Nothing to plot.';
      }
    };
    what.onchange = refresh; refresh();
    const cfg = () => ({ space: +what.value, paper: paper.value, orient: orient.value, area: area.value, scaleN: scale.value === 'fit' ? 'fit' : +scale.value, mono: mono.checked, lwt: lwt.checked });
    const acts = h('div', 'actions');
    const run = (mode) => {
      const c = cfg();
      doc.plotCfg = { paper: c.paper, orient: c.orient, area: c.area, scaleN: c.scaleN, mono: c.mono, lwt: c.lwt };
      const r = this.pdf(app, c);
      const name = `${doc.name}${c.space >= 0 ? ' - ' + doc.layouts[c.space].name : ''}.pdf`;
      const blob = new Blob([r.bytes], { type: 'application/pdf' });
      if (mode === 'open') { const url = URL.createObjectURL(blob); const w = window.open(url, '_blank'); if (!w) IO.download(name, blob); setTimeout(() => URL.revokeObjectURL(url), 60000); }
      else IO.download(name, blob);
      app.print(`Plotted ${name} (${fmtNum(r.paper.w, 1)} × ${fmtNum(r.paper.h, 1)} mm${r.scale ? ', scale ' + scaleLabel(doc, r.scale) : ''}).`);
      box.classList.remove('open');
    };
    const b1 = h('button', 'primary', 'Download PDF'); b1.onclick = () => run('download');
    const b2 = h('button', null, 'Open PDF to print'); b2.onclick = () => run('open');
    const b3 = h('button', null, 'Cancel'); b3.onclick = () => box.classList.remove('open');
    acts.append(b1, b2, b3); body.appendChild(acts);
    box.classList.add('open');
  },
};
