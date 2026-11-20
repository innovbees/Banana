"""Bedroom 1 layout B (Elyse bed, head to the south window, gap behind) as DXF R2018 in mm.
Origin = inner SW corner of room, +X east, +Y north.  Usage: python3 make_plan_B_dxf.py out.dxf [gap_mm]"""
import sys, math
import ezdxf
from ezdxf.enums import TextEntityAlignment as TA
OUT = sys.argv[1]; GAP = float(sys.argv[2]) if len(sys.argv) > 2 else 400
doc = ezdxf.new('R2018', setup=True); doc.units = ezdxf.units.MM; doc.header['$INSUNITS'] = 4; doc.header['$MEASUREMENT'] = 1
msp = doc.modelspace()
for n, c, lt in [('A-WALL', 7, 'Continuous'), ('A-GLAZ', 5, 'Continuous'), ('A-DOOR', 1, 'Continuous'), ('A-ROBE', 8, 'Continuous'),
                 ('I-FURN-BED', 40, 'Continuous'), ('I-FURN', 42, 'Continuous'), ('I-JOIN-MIRROR', 30, 'Continuous'), ('I-ART', 32, 'Continuous'),
                 ('I-CURTAIN', 9, 'DOT'), ('E-LITE', 2, 'Continuous'), ('A-DIMS', 3, 'Continuous'), ('A-TEXT', 7, 'Continuous')]:
    doc.layers.add(n, color=c, linetype=lt)
ds = doc.dimstyles.new('MM25'); ds.dxf.dimtxt = 70; ds.dxf.dimasz = 50; ds.dxf.dimexe = 40; ds.dxf.dimexo = 30; ds.dxf.dimdec = 0; ds.dxf.dimtad = 1; ds.dxf.dimgap = 20; ds.dxf.dimtsz = 40
RW, RL, T = 4000, 4900, 110
def rect(x0, y0, x1, y1, layer): msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, dxfattribs={'layer': layer})
def text(x, y, s, h=70, layer='A-TEXT', rot=0, al=TA.MIDDLE_CENTER): msp.add_text(s, height=h, rotation=rot, dxfattribs={'layer': layer}).set_placement((x, y), align=al)
def dh(x0, x1, y, by): msp.add_linear_dim(base=(x0, by), p1=(x0, y), p2=(x1, y), dimstyle='MM25', dxfattribs={'layer': 'A-DIMS'}).render()
def dv(y0, y1, x, bx): msp.add_linear_dim(base=(bx, y0), p1=(x, y0), p2=(x, y1), angle=90, dimstyle='MM25', dxfattribs={'layer': 'A-DIMS'}).render()
# walls / openings (Y measured from the south wall)
rect(-T, -T, 0, RL + T, 'A-WALL'); rect(0, RL, RW + T, RL + T, 'A-WALL')
rect(RW, RL - 100, RW + T, RL, 'A-WALL'); rect(RW, RL - 2400, RW + T, RL - 1000, 'A-WALL'); rect(RW, -T, RW + T, RL - 3300, 'A-WALL')
rect(0, -T, 850, 0, 'A-WALL'); rect(3150, -T, RW, 0, 'A-WALL'); rect(850, -T, 3150, 0, 'A-GLAZ'); msp.add_line((850, -T / 2), (3150, -T / 2), dxfattribs={'layer': 'A-GLAZ'})
text(2000, -T - 130, 'WINDOW 2300 W x 1540 H, SILL 560, HEAD 2100', 60, 'A-GLAZ')
hinge = (RW, RL - 100); msp.add_line(hinge, (RW - 900, RL - 100), dxfattribs={'layer': 'A-DOOR'})
msp.add_arc(center=hinge, radius=900, start_angle=180, end_angle=270, dxfattribs={'layer': 'A-DOOR'}); text(RW + 160, RL - 550, 'ENTRY 900', 60, 'A-DOOR', al=TA.MIDDLE_LEFT)
rect(RW + T, RL - 2400, RW + 1400, RL - 1000, 'A-ROBE'); text(RW + 750, RL - 1700, 'WIR 1', 80, 'A-ROBE')
rect(RW + T, 0, RW + 1400, RL - 3300, 'A-ROBE'); text(RW + 750, RL - 4100, 'WIR 2', 80, 'A-ROBE'); text(RW + 750, RL - 2850, 'ROBE WALKWAY 900 TO ENSUITE', 50, 'A-ROBE')
# bed: head to south, GAP from the window wall
BW, BL = 2060, 2430; BX0, BX1 = 2000 - BW / 2, 2000 + BW / 2; HB = GAP; FOOT = GAP + BL
rect(BX0, HB, BX1, FOOT, 'I-FURN-BED'); rect(BX0, HB, BX1, HB + 120, 'I-FURN-BED'); rect(BX0 + 100, HB + 180, BX1 - 100, FOOT - 100, 'I-FURN-BED')
for xc in (1570, 2430): rect(xc - 360, HB + 200, xc + 360, HB + 600, 'I-FURN-BED')
text(2000, HB + 1800, 'NICK SCALI ELYSE KING BED', 90, 'I-FURN-BED'); text(2000, HB + 1650, '2060 W x 2430 L, HEADBOARD 930 H - HEAD TO SOUTH', 60, 'I-FURN-BED')
for x0 in (BX0 - 20 - 450, BX1 + 20):
    rect(x0, HB, x0 + 450, HB + 450, 'I-FURN'); text(x0 + 225, HB + 225, 'NS 450x450', 50, 'I-FURN'); msp.add_circle((x0 + 225, HB + 345), 85, dxfattribs={'layer': 'E-LITE'})
msp.add_line((700, 80), (3300, 80), dxfattribs={'layer': 'I-CURTAIN'}); text(2000, 170, 'CURTAIN TRACK FIXED TO CEILING (OPERABLE BEHIND BED)', 40, 'I-CURTAIN')
# artwork north wall, mirror unit east wall, lounge NW
rect(0, RL - 3700, 40, RL - 1900, 'I-ART'); text(130, RL - 2800, 'ARTWORK 1800 x 900, CENTRE 1450 AFF', 50, 'I-ART', rot=90)
rect(3650, RL - 2200, 4000, RL - 1200, 'I-JOIN-MIRROR'); rect(3970, RL - 2150, 4000, RL - 1250, 'I-JOIN-MIRROR')
text(3800, RL - 1700, 'MIRROR 900x1900 ON FLOOR DRAWER 1000x350', 45, 'I-JOIN-MIRROR', rot=90)
cx, cy, a = 500, RL - 550, math.radians(40)
msp.add_lwpolyline([(cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)) for x, y in [(-360, -360), (360, -360), (360, 360), (-360, 360)]], close=True, dxfattribs={'layer': 'I-FURN'})
text(cx, cy, 'CHAIR', 45, 'I-FURN'); msp.add_circle((420, RL - 1300), 200, dxfattribs={'layer': 'I-FURN'}); text(420, RL - 1300, 'TABLE', 40, 'I-FURN')
for x, z, lab in [(600, 1000, 'D1'), (2000, 1000, 'D2'), (3300, 1700, 'M1'), (3520, 3300, 'D3'), (3620, 550, 'P1'), (700, 2400, 'A1'), (700, 3200, 'A2')]:
    y = RL - z; msp.add_circle((x, y), 45, dxfattribs={'layer': 'E-LITE'}); text(x + 70, y, lab, 45, 'E-LITE', al=TA.MIDDLE_LEFT)
# dimensions
dh(0, RW, RL + T, RL + 650); dv(0, RL, -T, -650)
yd = HB + 900
dh(0, BX0, yd, yd + 120); dh(BX0, BX1, yd + 150, yd + 270); dh(BX1, RW, yd, yd + 120)
dv(0, HB, 1200, 1200); dv(HB, FOOT, 1200, 1200); dv(FOOT, RL, 1200, 1200)
dh(850, 3150, -T, -520); dv(RL - 2200, RL - 1200, 3550, 3550)
tb_x = RW + 1700; rect(tb_x, -T, tb_x + 3200, -T + 1500, 'A-TEXT')
for i, s in enumerate(['BEDROOM 1 - LAYOUT B: HEAD TO WINDOW', f'Elyse king 2060 x 2430, headboard 930 H, {int(GAP)} gap to window wall',
                       'Room 4000 x 4900, ceiling 2400, carpet', 'Units: millimetres   Scale 1:25 at A3 (plot)', 'Origin 0,0 = inner SW corner; +X east, +Y north',
                       'Check all dimensions on site before ordering']):
    text(tb_x + 100, -T + 1350 - i * 210, s, 85 if i == 0 else 60, al=TA.MIDDLE_LEFT)
msp.add_lwpolyline([(RW + 2000, RL + 200), (RW + 2080, RL - 50), (RW + 2000, RL + 20), (RW + 1920, RL - 50)], close=True, dxfattribs={'layer': 'A-TEXT'}); text(RW + 2000, RL + 320, 'N', 120)
doc.set_modelspace_vport(height=7000, center=(3000, 2400)); doc.saveas(OUT); print('saved', OUT)
