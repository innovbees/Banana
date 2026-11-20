'use strict';
/* Built-in block library. Sizes are in millimetres; insert with a scale for other units.
 * Objects use layer 0 / color ByBlock so they take the layer and color of the block reference. */
const LIBRARY = (() => {
  const B = { layer: '0', color: 'byblock' };
  const line = (x1, y1, x2, y2) => ({ ...B, type: 'line', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });
  const rect = (x1, y1, x2, y2) => ({ ...B, type: 'pline', pts: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }], closed: true });
  const arc = (cx, cy, r, d1, d2) => ({ ...B, type: 'arc', c: { x: cx, y: cy }, r, a1: d1 * DEG, a2: d2 * DEG });
  const circle = (cx, cy, r) => ({ ...B, type: 'circle', c: { x: cx, y: cy }, r });
  const text = (x, y, h, t, align = 'left') => ({ ...B, type: 'text', p: { x, y }, h, rot: 0, text: t, align });
  const att = (tag, prompt, def, x, y, h) => ({ ...B, type: 'attdef', tag, prompt, def, p: { x, y }, h, rot: 0, align: 'left' });
  const rounded = (x1, y1, x2, y2, r) => ({ ...B, type: 'pline', closed: true,
    pts: [{ x: x1 + r, y: y1 }, { x: x2 - r, y: y1 }, { x: x2, y: y1 + r }, { x: x2, y: y2 - r }, { x: x2 - r, y: y2 }, { x: x1 + r, y: y2 }, { x: x1, y: y2 - r }, { x: x1, y: y1 + r }],
    b: [0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8)] });
  const door = (w) => [rect(0, 0, 40, w), arc(0, 0, w, 0, 90)];
  const O = { x: 0, y: 0 };
  return {
    'Door 900': { desc: 'Single door, 900 wide, opening 90°', base: O, ents: door(900) },
    'Door 800': { desc: 'Single door, 800 wide', base: O, ents: door(800) },
    'Door 750': { desc: 'Single door, 750 wide (bathroom)', base: O, ents: door(750) },
    'Double door 1600': { desc: 'Double door, 2 × 800', base: O, ents: [rect(0, 0, 40, 800), arc(0, 0, 800, 0, 90), rect(1560, 0, 1600, 800), arc(1600, 0, 800, 90, 180)] },
    'Sliding door 1800': { desc: 'Two-panel sliding door in a 150 wall', base: O, ents: [rect(0, 40, 950, 75), rect(850, 75, 1800, 110), line(0, 0, 0, 150), line(1800, 0, 1800, 150)] },
    'Window 1200': { desc: 'Window in a 230 wall, 1200 wide', base: O, ents: [rect(0, 0, 1200, 230), line(0, 105, 1200, 105), line(0, 125, 1200, 125)] },
    'Window 1800': { desc: 'Window in a 230 wall, 1800 wide', base: O, ents: [rect(0, 0, 1800, 230), line(0, 105, 1800, 105), line(0, 125, 1800, 125), line(900, 105, 900, 125)] },
    'Bed double 1500': { desc: 'Double bed 1500 × 2000 with pillows', base: O, ents: [rect(0, 0, 1500, 2000), rounded(100, 1650, 700, 1900, 60), rounded(800, 1650, 1400, 1900, 60), line(0, 1450, 1500, 1450), line(0, 1450, 300, 1600)] },
    'Bed queen 1600': { desc: 'Queen bed 1600 × 2000', base: O, ents: [rect(0, 0, 1600, 2000), rounded(100, 1650, 750, 1900, 60), rounded(850, 1650, 1500, 1900, 60), line(0, 1450, 1600, 1450), line(0, 1450, 300, 1600)] },
    'Bed single 900': { desc: 'Single bed 900 × 2000', base: O, ents: [rect(0, 0, 900, 2000), rounded(100, 1650, 800, 1900, 60), line(0, 1450, 900, 1450), line(0, 1450, 250, 1600)] },
    'Bedside table': { desc: 'Bedside table 450 × 400', base: O, ents: [rect(0, 0, 450, 400), circle(225, 200, 120)] },
    'Wardrobe 1800': { desc: 'Wardrobe 1800 × 600, 3 doors', base: O, ents: [rect(0, 0, 1800, 600), line(600, 0, 600, 600), line(1200, 0, 1200, 600), line(50, 300, 1750, 300)] },
    'Desk 1200': { desc: 'Desk 1200 × 600 with chair', base: O, ents: [rect(0, 0, 1200, 600), rounded(375, -500, 825, -50, 60)] },
    'Sofa 3 seat': { desc: '3-seat sofa 2100 × 900', base: O, ents: [rounded(0, 0, 2100, 900, 80), rect(150, 0, 1950, 650), line(750, 0, 750, 650), line(1350, 0, 1350, 650)] },
    'Dining table 4': { desc: 'Round table Ø900 with 4 chairs', base: O, ents: [circle(0, 0, 450), rect(-225, 500, 225, 900), rect(-225, -900, 225, -500), rect(500, -225, 900, 225), rect(-900, -225, -500, 225)] },
    'WC': { desc: 'Toilet (back to wall at base point)', base: { x: 0, y: 0 }, ents: [rect(-250, -200, 250, 0), { ...B, type: 'ellipse', c: { x: 0, y: -480 }, maj: { x: 0, y: 280 }, ratio: 0.68 }] },
    'Washbasin': { desc: 'Washbasin 600 × 450 (back to wall)', base: O, ents: [rect(-300, -450, 300, 0), { ...B, type: 'ellipse', c: { x: 0, y: -220 }, maj: { x: 220, y: 0 }, ratio: 0.7 }, circle(0, -60, 25)] },
    'Shower 900': { desc: 'Shower tray 900 × 900', base: O, ents: [rect(0, 0, 900, 900), line(0, 0, 900, 900), line(900, 0, 0, 900), circle(450, 450, 40)] },
    'North arrow': { desc: 'North arrow', base: O, ents: [circle(0, 0, 500), { ...B, type: 'pline', closed: true, pts: [{ x: 0, y: 450 }, { x: 160, y: -320 }, { x: 0, y: -160 }, { x: -160, y: -320 }] }, text(0, 560, 220, 'N', 'center')] },
    'Title block A3': {
      desc: 'A3 sheet border + title block (paper mm) with attributes', base: O,
      ents: [
        rect(0, 0, 420, 297), rect(10, 10, 410, 287), rect(250, 10, 410, 60),
        line(250, 40, 410, 40), line(250, 25, 410, 25), line(330, 10, 330, 40), line(370, 10, 370, 25),
        text(252, 56, 1.8, 'TITLE'), text(252, 36.5, 1.8, 'PROJECT'), text(332, 36.5, 1.8, 'DRAWN BY'),
        text(252, 21.5, 1.8, 'DATE'), text(332, 21.5, 1.8, 'SCALE'), text(372, 21.5, 1.8, 'SHEET'),
        att('TITLE', 'Drawing title', 'Floor plan', 252, 45, 5), att('PROJECT', 'Project', '', 252, 28.5, 3), att('DRAWN', 'Drawn by', '', 332, 28.5, 3),
        att('DATE', 'Date', '', 252, 13.5, 3), att('SCALE', 'Scale', '1:50', 332, 13.5, 3), att('SHEET', 'Sheet', '1/1', 372, 13.5, 3),
      ],
    },
  };
})();

/* Copy a library symbol into the drawing's block table (once). */
function libraryEnsure(doc, name) {
  if (doc.blocks[name]) return name;
  const lib = LIBRARY[name];
  if (!lib) return null;
  doc.blocks[name] = { name, base: { ...lib.base }, ents: JSON.parse(JSON.stringify(lib.ents)), desc: lib.desc };
  return name;
}
