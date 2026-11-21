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
rect(RW + T, 0, RW + 1400, RL - 3300, 'A-ROBE'); text(RW + 750, RL - 4100, 'WIR 2', 80, 'A-ROBE'); text(RW + 750, RL - 2620, 'ROBE WALKWAY 900 TO ENSUITE', 50, 'A-ROBE')
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
for x, z, lab in [(700, 1200, 'D1'), (2000, 1200, 'D2'), (3300, 1200, 'M1'), (700, 2400, 'A1'), (700, 3200, 'A2'), (3300, 2400, 'B1'), (3300, 3200, 'B2')]:
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
msp.add_lwpolyline([(RW + 6300, RL + 200), (RW + 6380, RL - 50), (RW + 6300, RL + 20), (RW + 6220, RL - 50)], close=True, dxfattribs={'layer': 'A-TEXT'}); text(RW + 6300, RL + 320, 'N', 120)
# walnut barn door, ceiling-mounted black track, slides south (open position dashed)
doc.layers.add('E-LITE-AIM', color=2, linetype='DASHED'); doc.layers.add('I-DOOR-BARN', color=30); doc.layers.add('I-DOOR-BARN-OPEN', color=30, linetype='DASHED')
msp.add_line((3885, RL - 2300), (3885, RL - 4400), dxfattribs={'layer': 'I-DOOR-BARN'})
rect(3865, RL - 3350, 3905, RL - 2350, 'I-DOOR-BARN')
rect(3865, RL - 4300, 3905, RL - 3300, 'I-DOOR-BARN-OPEN')
text(RW + 160, RL - 3550, 'WALNUT BARN DOOR 1000 x 2200 x 40', 50, 'I-DOOR-BARN', al=TA.MIDDLE_LEFT)
text(RW + 160, RL - 3650, 'BLACK TRACK 2100 CEILING-MOUNTED, SLIDES SOUTH', 40, 'I-DOOR-BARN', al=TA.MIDDLE_LEFT)
# lighting: extra fittings, gimbal aim lines, schedule (all 2700K, CRI 90+, dimmable)
msp.add_circle((4650, RL - 2850), 45, dxfattribs={'layer': 'E-LITE'}); text(4720, RL - 2950, 'W1', 45, 'E-LITE', al=TA.MIDDLE_LEFT)
for x, z, tx, tz in [(700, 2400, 0, 2400), (700, 3200, 0, 3200), (3300, 1200, 3700, 1750), (3300, 2400, 3865, 2450), (3300, 3200, 3865, 3150)]:
    msp.add_line((x, RL - z), (tx, RL - tz), dxfattribs={'layer': 'E-LITE-AIM'})
for x0 in (BX0 - 20 - 450, BX1 + 20): text(x0 + 225, HB + 470, 'PENDANT', 35, 'E-LITE')
msp.add_circle((120, RL - 120), 60, dxfattribs={'layer': 'E-LITE'}); text(220, RL - 120, 'FLOOR LAMP (PLUG-IN)', 35, 'E-LITE', al=TA.MIDDLE_LEFT)
sx, sy = RW + 1700, RL + 0
rows = [('TAG', 'FITTING', 'X FROM W', 'FROM N', 'CIRCUIT / SWITCH'),
        ('D1', 'Downlight 90 cut-out 8-10W (chair/table)', '700', '1200', 'C1 dimmer at entry'),
        ('D2', 'Downlight 90 cut-out 8-10W (centre)', '2000', '1200', 'C1 dimmer at entry'),
        ('M1', 'Gimbal 8W, aim mirror/person 1300 AFF', '3300', '1200', 'C1 dimmer at entry'),
        ('A1', 'Gimbal 8W 24-36 deg, aim art 1450 AFF', '700', '2400', 'C2 feature dimmer'),
        ('A2', 'Gimbal 8W 24-36 deg, aim art 1450 AFF', '700', '3200', 'C2 feature dimmer'),
        ('B1', 'Gimbal 8W 24-36 deg, wash barn door', '3300', '2400', 'C2 feature dimmer'),
        ('B2', 'Gimbal 8W 24-36 deg, wash barn door', '3300', '3200', 'C2 feature dimmer'),
        ('ML', '2 opal LED bars 1500 long, sides of mirror', '3960', '1210/2190', 'C5 switch at mirror'),
        ('PEN', '2 bedside pendants, 600-700 above NS', '725/3275', '4150', 'C3 2-way entry + bed'),
        ('W1', 'Downlight in robe walkway', '4650', '2850', 'C4 sensor or switch'),
        ('ALL', 'Symmetric about bed axis X=2000; 2700K CRI90+ dim', '', '', 'Licensed electrician')]
cols = [0, 330, 2050, 2550, 3000]; rh = 150
doc.layers.add('E-LITE-SCHED', color=2)
rect(sx, sy - rh * len(rows), sx + 4200, sy, 'E-LITE-SCHED')
text(sx, sy + 120, 'LIGHTING SCHEDULE (positions mm from inner west / north walls)', 70, 'E-LITE-SCHED', al=TA.MIDDLE_LEFT)
for i, row in enumerate(rows):
    y = sy - rh * (i + 0.5)
    if i: msp.add_line((sx, sy - rh * i), (sx + 4200, sy - rh * i), dxfattribs={'layer': 'E-LITE-SCHED'})
    for c, v in zip(cols, row): text(sx + c + 40, y, v, 50 if i else 55, 'E-LITE-SCHED', al=TA.MIDDLE_LEFT)
for zc in (1212, 2188): rect(3930, RL - zc - 12, 3975, RL - zc + 12, 'E-LITE')
text(3900, RL - 2290, 'ML', 40, 'E-LITE', al=TA.MIDDLE_RIGHT)
doc.set_modelspace_vport(height=8000, center=(4600, 2600)); doc.saveas(OUT); print('saved', OUT)
