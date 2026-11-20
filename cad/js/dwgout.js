'use strict';
/* DWG writing: builds an AutoCAD document with acad-ts (MIT, lib/acad-ts) from the
 * BananaCAD drawing and serialises it with its DWG writer. Objects become their native
 * AutoCAD types (lines, arcs, LWPOLYLINEs with arcs, MTEXT, HATCH, real dimensions,
 * blocks with attributes, layers, text and dimension styles). */
const DwgOut = {
  VERSIONS: { 2018: 'AC1032', 2013: 'AC1027', 2010: 'AC1024', 2007: 'AC1021', 2004: 'AC1018', 2000: 'AC1015' },
  VERSION_NAMES: { AC1032: '2018', AC1027: '2013', AC1024: '2010', AC1021: '2007', AC1018: '2004', AC1015: '2000', AC1014: '2000', AC1012: '2000', AC1009: '2000' },

  async load() {
    if (!globalThis.AcadTs) await IO.loadScript('lib/acad-ts/acad-ts.js');
    if (!globalThis.AcadTs) throw new Error('DWG writer failed to load (keep the "lib" folder next to index.html)');
    return globalThis.AcadTs;
  },

  /* Returns { bytes: Uint8Array, report: { skipped: {type: n}, exploded: {type: n} } } */
  async toDWG(doc, year = '2018') {
    const A = await this.load();
    const cad = this.build(A, doc, this.VERSIONS[year] || 'AC1032');
    const bytes = A.DwgWriter.writeToBuffer(cad.doc);
    return { bytes, report: cad.report };
  },

  build(A, doc, ver) {
    const report = { skipped: {}, exploded: {} };
    const inc = (o, k) => (o[k] = (o[k] || 0) + 1);
    const cad = new A.CadDocument(A.ACadVersion[ver]);
    const XYZ = (p, z = 0) => new A.XYZ(p.x, p.y, z);
    const XY = (p) => new A.XY(p.x, p.y);
    E.ctxDoc = doc;
    try { cad.header.insUnits = { mm: A.UnitsType.Millimeters, cm: A.UnitsType.Centimeters, m: A.UnitsType.Meters, in: A.UnitsType.Inches, ft: A.UnitsType.Feet }[doc.units || 'mm']; } catch (err) { /* optional */ }

    // ---- colours & lineweights
    const color = (c) => {
      if (!c || c === 'bylayer') return new A.Color(256);
      if (c === 'byblock') return new A.Color(0);
      const aci = hexToAci(c);
      if (aciToHex(aci).toLowerCase() === String(c).toLowerCase()) return new A.Color(aci);
      const n = parseInt(String(c).replace('#', ''), 16);
      return new A.Color((n >> 16) & 255, (n >> 8) & 255, n & 255);
    };
    const LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
    const lweight = (mm) => { if (mm == null || mm === 'bylayer') return A.LineWeightType.ByLayer; const v = Math.round(mm * 100); return LW.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), 25); };

    // ---- linetypes
    const LT = { Dashed: ['DASHED', [12.7, -6.35]], Hidden: ['HIDDEN', [6.35, -3.175]], Center: ['CENTER', [31.75, -6.35, 6.35, -6.35]], Phantom: ['PHANTOM', [31.75, -6.35, 6.35, -6.35, 6.35, -6.35]], Dot: ['DOT', [0, -6.35]] };
    const ltypes = {};
    const ltype = (name) => {
      if (!name || name === 'Continuous' || !LT[name]) return null;
      if (ltypes[name]) return ltypes[name];
      const [n, segs] = LT[name];
      let lt = cad.lineTypes.tryGetValue(n);
      if (!lt) {
        lt = new A.LineType(n); lt.description = name;
        for (const len of segs) { const s = new A.LineTypeSegment(); s.length = len; lt.addSegment(s); }
        cad.lineTypes.add(lt);
      }
      return (ltypes[name] = lt);
    };

    // ---- layers
    const layers = {};
    for (const l of doc.layers) {
      let L = cad.layers.tryGetValue(l.name);
      if (!L) { L = new A.Layer(l.name); cad.layers.add(L); }
      L.color = color(l.color === 'bylayer' ? '#ffffff' : l.color);
      L.isOn = l.visible !== false;
      L.lineWeight = lweight(l.lw == null ? 0.25 : l.lw);
      L.plotFlag = l.plot !== false;
      const lt = ltype(l.linetype); if (lt) L.lineType = lt;
      layers[l.name] = L;
    }
    if (!cad.layers.tryGetValue('Defpoints')) { const dp = new A.Layer('Defpoints'); dp.plotFlag = false; cad.layers.add(dp); } // needed by dimension blocks
    const layerOf = (name) => layers[name] || layers['0'] || cad.layers.tryGetValue('0');

    // ---- text styles
    const tstyles = {};
    for (const t of doc.textStyles || []) {
      let S = cad.textStyles.tryGetValue(t.name);
      if (!S) { S = new A.TextStyle(t.name); cad.textStyles.add(S); }
      S.filename = IO.fontFile(t.font); S.width = t.width || 1; S.obliqueAngle = (t.oblique || 0) * DEG;
      tstyles[t.name] = S;
    }
    const tstyle = (name) => tstyles[(E.tstyle(name) || {}).name] || cad.textStyles.tryGetValue('Standard');

    // ---- dimension styles
    const dstyles = {};
    const dimStyleFor = (e) => {
      const st = E.dstyle(e), key = e.dimstyle || `legacy-${st.scale}-${st.txt}`;
      if (dstyles[key]) return dstyles[key];
      const name = e.dimstyle || `Legacy ${fmtNum(st.scale, 3)}`;
      let D = cad.dimensionStyles.tryGetValue(name);
      if (!D) { D = new A.DimensionStyle(name); cad.dimensionStyles.add(D); }
      D.textHeight = st.txt; D.arrowSize = st.asz; D.scaleFactor = st.scale || 1;
      D.extensionLineOffset = st.exo; D.extensionLineExtension = st.exe; D.dimensionLineGap = st.gap;
      D.decimalPlaces = st.dec; D.angularDecimalPlaces = st.adec || 0;
      D.postFix = (st.pre || st.suf) ? `${st.pre || ''}<>${st.suf || ''}` : '';
      D.textVerticalAlignment = st.tad === 'centered' ? A.DimensionTextVerticalAlignment.Centered : A.DimensionTextVerticalAlignment.Above;
      D.tickSize = st.arrow === 'tick' ? st.asz : 0;
      const ts = tstyle(st.textStyle); if (ts) D.style = ts;
      return (dstyles[key] = D);
    };

    // ---- blocks (create all records first so nested references resolve)
    let dimCount = 0;
    const blockName = (n) => (n.startsWith('*') ? `_${n.slice(1).replace(/[^A-Za-z0-9_-]/g, '_')}` : n);
    const blocks = {};
    for (const n of Object.keys(doc.blocks || {})) {
      const br = new A.BlockRecord(blockName(n));
      br.blockEntity.basePoint = XYZ(doc.blocks[n].base || { x: 0, y: 0 });
      cad.blockRecords.add(br);
      blocks[n] = br;
    }

    // ---- entities
    const common = (ent, e) => {
      ent.layer = layerOf(e.layer);
      ent.color = color(e.color);
      ent.lineWeight = lweight(e.lw);
      return ent;
    };
    const text = (op, e) => {
      const t = new A.TextEntity();
      t.value = op.str; t.height = op.h; t.rotation = op.rot || 0; t.insertPoint = XYZ(op.p);
      const st = tstyle(op.style); if (st) t.style = st;
      const ts = E.tstyle(op.style); if (ts.width && ts.width !== 1) t.widthFactor = ts.width;
      if (op.align === 'center' || op.align === 'right') { t.horizontalAlignment = op.align === 'center' ? A.TextHorizontalAlignment.Center : A.TextHorizontalAlignment.Right; t.alignmentPoint = XYZ(op.p); }
      return common(t, e);
    };
    const lwpoly = (pts, bulges, closed, e) => {
      const verts = pts.map((p, i) => { const v = new A.LwPolylineVertex(XY(p)); v.bulge = (bulges && bulges[i]) || 0; return v; });
      const pl = new A.LwPolyline(verts); pl.isClosed = !!closed;
      return common(pl, e);
    };
    const exploded = (e, quiet) => {
      if (!quiet) inc(report.exploded, E.label(e.type));
      const out = [];
      for (const op of E.ops(e, doc)) {
        if (op.op === 'poly') out.push(op.pts.length === 2 && !op.closed ? common(new A.Line(XYZ(op.pts[0]), XYZ(op.pts[1])), e) : lwpoly(op.pts, null, op.closed, e));
        else if (op.op === 'fill') { const q = op.pts; out.push(common(new A.Solid(XYZ(q[0]), XYZ(q[1]), XYZ(q[q.length > 3 ? 3 : 2]), XYZ(q[2])), e)); }
        else if (op.op === 'text' && op.str) out.push(text(op, e));
        else if (op.op === 'arc') out.push(common(new A.Arc(XYZ(op.c), op.r, op.a1, op.a2), e));
        else if (op.op === 'circle') out.push(common(new A.Circle(XYZ(op.c), op.r), e));
      }
      return out;
    };
    const hatchPattern = (e) => {
      const fams = HATCH_PATTERNS[e.pattern];
      const pat = new A.HatchPattern(e.pattern || 'ANSI31');
      for (const f of fams) {
        const ln = new A.HatchPatternLine();
        const a = f.ang * DEG, sp = f.sp;
        ln.angle = a; ln.basePoint = new A.XY(0, 0); ln.offset = new A.XY(-Math.sin(a) * sp, Math.cos(a) * sp); ln.dashLengths = [];
        pat.lines.push(ln);
      }
      return pat;
    };
    const conv = (e) => {
      switch (e.type) {
        case 'line': return [common(new A.Line(XYZ(e.p1), XYZ(e.p2)), e)];
        case 'circle': return [common(new A.Circle(XYZ(e.c), e.r), e)];
        case 'arc': return [common(new A.Arc(XYZ(e.c), e.r, G.normAng(e.a1), G.normAng(e.a2)), e)];
        case 'ellipse': {
          const el = new A.Ellipse(); el.center = XYZ(e.c); el.majorAxisEndPoint = XYZ(e.maj); el.radiusRatio = e.ratio; el.startParameter = 0; el.endParameter = TAU;
          return [common(el, e)];
        }
        case 'pline': return [lwpoly(e.pts, e.b, e.closed, e)];
        case 'spline': return [lwpoly(E.ops(e, doc)[0].pts, null, e.closed, e)];
        case 'revcloud': return [lwpoly(E.ops(e, doc)[0].pts, null, true, e)];
        case 'text': return [text({ p: e.p, h: e.h, rot: e.rot, str: e.text, align: e.align, style: e.style }, e)];
        case 'mtext': {
          const m = new A.MText();
          m.value = String(e.text).replace(/\n/g, '\\P'); m.height = e.h; m.insertPoint = XYZ(e.p); m.rectangleWidth = e.width || 0; m.rotation = e.rot || 0;
          m.attachmentPoint = A.AttachmentPointType.TopLeft;
          const st = tstyle(e.style); if (st) m.style = st;
          return [common(m, e)];
        }
        case 'leader': {
          const out = [], g = E.leaderGeom(e), h = e.h || 2.5;
          out.push(lwpoly([...e.pts, g.land], null, false, e));
          if (e.pts.length > 1) { const q = arrowPts(e.pts[0], G.norm(G.sub(e.pts[0], e.pts[1])), h); out.push(common(new A.Solid(XYZ(q[0]), XYZ(q[1]), XYZ(q[2]), XYZ(q[2])), e)); }
          const m = new A.MText();
          m.value = String(e.text || '').replace(/\n/g, '\\P'); m.height = h;
          m.attachmentPoint = g.dir > 0 ? A.AttachmentPointType.TopLeft : A.AttachmentPointType.TopRight;
          m.insertPoint = XYZ({ x: g.tx, y: g.firstBase + h });
          const st = tstyle(e.style); if (st) m.style = st;
          out.push(common(m, e));
          return out;
        }
        case 'dim': {
          try {
            let d;
            if (e.kind === 'linear' || e.kind === 'aligned') {
              const ops = E.dimOps(e), u = e.kind === 'aligned' ? G.norm(G.sub(e.p2, e.p1)) : { x: Math.cos(e.dirAng || 0), y: Math.sin(e.dirAng || 0) };
              const n = G.perp(u), d2 = G.add(e.p2, G.mul(n, G.dot(G.sub(e.pos, e.p2), n)));
              d = e.kind === 'linear' ? new A.DimensionLinear() : new A.DimensionAligned();
              d.firstPoint = XYZ(e.p1); d.secondPoint = XYZ(e.p2); d.definitionPoint = XYZ(d2);
              if (e.kind === 'linear') d.rotation = e.dirAng || 0;
              const t = ops.find((o) => o.op === 'text'); if (t) d.textMiddlePoint = XYZ(t.p);
            } else if (e.kind === 'radius' || e.kind === 'diameter') {
              const dir = G.norm(G.sub(e.pos, e.c)), tip = G.add(e.c, G.mul(dir, e.r));
              if (e.kind === 'radius') { d = new A.DimensionRadius(); d.definitionPoint = XYZ(e.c); d.angleVertex = XYZ(tip); }
              else { d = new A.DimensionDiameter(); d.definitionPoint = XYZ(G.sub(e.c, G.mul(dir, e.r))); d.angleVertex = XYZ(tip); }
              d.textMiddlePoint = XYZ(e.pos);
            } else if (e.kind === 'angular') {
              d = new A.DimensionAngular3Pt(); d.angleVertex = XYZ(e.c); d.firstPoint = XYZ(e.p1); d.secondPoint = XYZ(e.p2); d.definitionPoint = XYZ(e.pos);
            } else if (e.kind === 'ordinate') {
              d = new A.DimensionOrdinate(); d.definitionPoint = new A.XYZ(0, 0, 0); d.featureLocation = XYZ(e.p1); d.leaderEndpoint = XYZ(e.pos); d.isOrdinateTypeX = (e.axis || 'x') === 'x';
            }
            if (!d) return exploded(e);
            d.style = dimStyleFor(e);
            d.text = e.text || '';
            common(d, e);
            // The dimension's display block is filled with BananaCAD's own dimension geometry
            // (acad-ts 3.7's generator is incomplete for aligned/ordinate/angular dimensions).
            const br = new A.BlockRecord(`*D${++dimCount}`);
            cad.blockRecords.add(br);
            for (const x of exploded({ ...e, layer: '0', color: 'byblock', lw: null }, true)) br.entities.add(x);
            d.block = br;
            return [d];
          } catch (err) { console.warn('dimension export', err); return exploded(e); }
        }
        case 'hatch': {
          const h = new A.Hatch();
          for (const loop of e.loops) {
            const pe = new A.HatchBoundaryPathPolyline(); pe.isClosed = true; pe.vertices = loop.map((p) => XYZ(p, 0));
            const path = new A.HatchBoundaryPath([pe]);
            h.paths.push(path);
          }
          if (!HATCH_PATTERNS[e.pattern]) { h.isSolid = true; h.pattern = A.HatchPattern.solid; h.patternType = A.HatchPatternType.SolidFill; }
          else { h.isSolid = false; h.pattern = hatchPattern(e); h.patternType = A.HatchPatternType.Custom; h.patternScale = e.scale || 1; h.patternAngle = (e.angle || 0) * DEG; }
          return [common(h, e)];
        }
        case 'table': return exploded(e);
        case 'attdef': {
          const a = new A.AttributeDefinition();
          a.tag = e.tag; a.prompt = e.prompt || e.tag; a.value = e.def || ''; a.insertPoint = XYZ(e.p); a.height = e.h; a.rotation = e.rot || 0;
          if (e.invisible) a.flags = 1;
          const st = tstyle(e.style); if (st) a.style = st;
          return [common(a, e)];
        }
        case 'insert': {
          const br = blocks[e.name];
          if (!br) { inc(report.skipped, 'Block reference to a missing block'); return []; }
          const ins = new A.Insert(br);
          ins.insertPoint = XYZ(e.p); ins.xScale = e.sx ?? 1; ins.yScale = e.sy ?? 1; ins.rotation = e.rot || 0;
          common(ins, e);
          if ((e.attribs || []).length) {
            const xf = XF.matrix(E.insertMatrix(e));
            const auto = [...ins.attributes];
            for (const at of e.attribs) {
              const t = E.transform({ type: 'text', p: { ...at.p }, h: at.h, rot: at.rot || 0, text: at.value }, xf);
              let ae = auto.find((x) => x.tag === at.tag);
              if (!ae) { ae = new A.AttributeEntity(); ae.tag = at.tag; if (typeof ins.attributes.add === 'function') ins.attributes.add(ae); else continue; }
              ae.value = String(at.value ?? ''); ae.insertPoint = XYZ(t.p); ae.height = t.h; ae.rotation = t.rot || 0;
              if (at.invisible) ae.flags = 1;
              ae.layer = ins.layer;
            }
          }
          return [ins];
        }
        case 'image': inc(report.skipped, 'Image (attach it again in AutoCAD)'); return [];
        case 'viewport': return [];
      }
      inc(report.skipped, E.label(e.type));
      return [];
    };
    // acad-ts 3.7 does not register an insert's attributes with the document; do it here
    // (otherwise they get handle 0 and are lost when the DWG is written).
    const regAttribs = (x) => {
      if (!(x instanceof A.Insert) || !x.attributes.length) return;
      for (const at of x.attributes) { at.owner = x; if (!at.document) cad._addCadObject(at); }
      if (!x.attributes.seqend) x.attributes.seqend = new A.Seqend();
      x.attributes.seqend.owner = x;
      if (!x.attributes.seqend.document) cad._addCadObject(x.attributes.seqend);
    };
    for (const [n, blk] of Object.entries(doc.blocks || {})) for (const e of blk.ents) for (const x of conv(e)) { blocks[n].entities.add(x); regAttribs(x); }
    for (const e of doc.model || doc.entities) for (const x of conv(e)) { cad.modelSpace.entities.add(x); regAttribs(x); }
    const lays = (doc.layouts || []).reduce((a, l) => a + l.ents.length, 0);
    if (lays) report.skipped['Layout sheets (paper space)'] = lays;
    return { doc: cad, report };
  },
};
