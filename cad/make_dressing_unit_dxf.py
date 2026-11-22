"""Sliding pill-shaped dressing unit (east wall) - workshop drawing as DXF R2018, millimetres.
Usage: python3 make_dressing_unit_dxf.py OUT.dxf [width_mm=500] [table=1]
Views: A front closed, B front open, C plan section at 1000 AFF, D side section, E position on the east wall, F LED rim detail."""
import sys, math
import ezdxf
from ezdxf.enums import TextEntityAlignment as TA

OUT = sys.argv[1]
W = float(sys.argv[2]) if len(sys.argv) > 2 else 500.0
TABLE = (sys.argv[3] != '0') if len(sys.argv) > 3 else True
H, Y0, R = 1900.0, 100.0, W / 2          # height, gap above floor, end radius
D, RIM, MT, MRIM = 200.0, 25.0, 30.0, 30.0   # cabinet depth, cabinet rim, mirror panel thickness, mirror rim width
TL, TD, TT, TY = 280.0, 200.0, 35.0, 890.0   # side table length, depth, thickness, underside height
SHELVES = [650, 950, 1250, 1550, 1800]       # shelf tops AFF
RUNNERS = [580, 1720]                        # runner centre heights AFF
LED_W = 10.0

doc = ezdxf.new('R2018', setup=True)
doc.units = ezdxf.units.MM; doc.header['$INSUNITS'] = 4; doc.header['$MEASUREMENT'] = 1
msp = doc.modelspace()
for n, c, lt in [('A-WALL', 7, 'Continuous'), ('J-CAB', 30, 'Continuous'), ('J-MIRROR', 5, 'Continuous'), ('J-MIRROR-OPEN', 5, 'DASHED'),
                 ('J-SHELF', 32, 'Continuous'), ('J-HW', 8, 'Continuous'), ('J-TABLE', 30, 'Continuous'), ('E-LED', 2, 'Continuous'),
                 ('A-DIMS', 3, 'Continuous'), ('A-TEXT', 7, 'Continuous'), ('A-HIDDEN', 8, 'HIDDEN')]:
    doc.layers.add(n, color=c, linetype=lt)
ds = doc.dimstyles.new('MM25')
ds.dxf.dimtxt = 45; ds.dxf.dimasz = 30; ds.dxf.dimexe = 25; ds.dxf.dimexo = 20; ds.dxf.dimdec = 0
ds.dxf.dimtad = 1; ds.dxf.dimgap = 12; ds.dxf.dimtsz = 25; ds.dxf.dimlunit = 2

def line(a, b, layer): msp.add_line(a, b, dxfattribs={'layer': layer})
def rect(x0, y0, x1, y1, layer): msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, dxfattribs={'layer': layer})
def text(x, y, s, h=45, layer='A-TEXT', al=TA.MIDDLE_CENTER, rot=0): msp.add_text(s, height=h, rotation=rot, dxfattribs={'layer': layer}).set_placement((x, y), align=al)
def dh(x0, x1, y, by): msp.add_linear_dim(base=(x0, by), p1=(x0, y), p2=(x1, y), dimstyle='MM25', dxfattribs={'layer': 'A-DIMS'}).render()
def dv(y0, y1, x, bx): msp.add_linear_dim(base=(bx, y0), p1=(x, y0), p2=(x, y1), angle=90, dimstyle='MM25', dxfattribs={'layer': 'A-DIMS'}).render()
def pill(cx, y0, w, h, layer):
    """Stadium outline, width w, height h, bottom at y0, centred on cx. Bulge 1 = semicircle."""
    r = w / 2
    msp.add_lwpolyline([(cx + r, y0 + r, 0), (cx + r, y0 + h - r, 1), (cx - r, y0 + h - r, 0), (cx - r, y0 + r, 1)],
                       format='xyb', close=True, dxfattribs={'layer': layer})
def title(x, y, s): text(x, y, s, 60, al=TA.MIDDLE_LEFT)

def front(ox, opened):
    """Front elevation; ox = x of cabinet centre. Floor at y=0."""
    line((ox - 1100, 0), (ox + 800, 0), 'A-WALL'); text(ox - 1050, -60, 'FFL (carpet)', 35, al=TA.MIDDLE_LEFT)
    pill(ox, Y0, W, H, 'J-CAB'); pill(ox, Y0 + RIM, W - 2 * RIM, H - 2 * RIM, 'J-CAB')
    if TABLE:
        tx0 = ox + R
        msp.add_lwpolyline([(tx0, TY), (tx0 + TL, TY), (tx0 + TL, TY + TT), (tx0, TY + TT)], close=True, dxfattribs={'layer': 'J-TABLE'})
    sh = -W if opened else 0
    if opened:
        for y in SHELVES: rect(ox - R + RIM, y - 18, ox + R - RIM, y, 'J-SHELF')
        for y in RUNNERS: rect(ox - R + RIM, y - 22, ox + R - RIM, y + 23, 'J-HW')
    mx = ox + sh
    lay = 'J-MIRROR'
    pill(mx, Y0, W, H, lay); pill(mx, Y0 + MRIM, W - 2 * MRIM, H - 2 * MRIM, lay)
    for s in (-1, 1):   # LED strips in the straight part of the rim
        x = mx + s * (R - MRIM / 2)
        rect(x - LED_W / 2, Y0 + R - 50, x + LED_W / 2, Y0 + H - R + 50, 'E-LED')
    for k in range(3):  # glass hatch marks
        x = mx - 60 + k * 50; line((x, Y0 + H / 2 - 120 + k * 30), (x + 120, Y0 + H / 2 + 20 + k * 30), lay)
    # dimensions
    dv(0, Y0, ox + R + (TL if TABLE else 0) + 120, ox + R + (TL if TABLE else 0) + 170)
    dv(Y0, Y0 + H, ox + R + (TL if TABLE else 0) + 120, ox + R + (TL if TABLE else 0) + 260)
    dh(mx - R, mx + R, Y0 + H, Y0 + H + 150)
    if TABLE and not opened:
        dh(ox + R, ox + R + TL, TY + TT, TY + TT + 120)
        dv(0, TY + TT, ox + R + TL + 40, ox + R + TL + 80)
    if opened:
        dh(mx - R, ox - R, Y0 - 40, Y0 - 160); text((mx + ox) / 2 - R / 2, Y0 - 230, f'SLIDE TRAVEL {int(W)}', 40)
        for y in SHELVES: text(ox + R + 30, y - 9, f'{y}', 30, al=TA.MIDDLE_LEFT)

# ---------------- A / B front elevations ----------------
AX, BX = 1300, 3700
front(AX, False); title(AX - 1100, 2350, 'A  FRONT ELEVATION - CLOSED')
front(BX, True); title(BX - 1100, 2350, f'B  FRONT ELEVATION - MIRROR SLID {int(W)} TO THE LEFT (NORTH)')

# ---------------- C plan section at 1000 AFF ----------------
CX, CY = 6600, 600          # wall face line is y = CY; room is below (toward -y)
line((CX - 1100, CY), (CX + 900, CY), 'A-WALL'); line((CX - 1100, CY + 110), (CX + 900, CY + 110), 'A-WALL')
text(CX - 1050, CY + 55, 'EAST WALL (studs - fix through cabinet back)', 30, al=TA.MIDDLE_LEFT)
rect(CX - R, CY - D, CX + R, CY, 'J-CAB'); rect(CX - R + RIM, CY - D + RIM, CX + R - RIM, CY, 'J-CAB')
rect(CX - R, CY - D - MT, CX + R, CY - D, 'J-MIRROR')
rect(CX - R - W, CY - D - MT, CX + R - W, CY - D, 'J-MIRROR-OPEN')
for s in (-1, 1): rect(CX + s * (R - MRIM / 2) - LED_W / 2, CY - D - MT - 2, CX + s * (R - MRIM / 2) + LED_W / 2, CY - D - MT + 8, 'E-LED')
rect(CX - R + RIM, CY - D + 2, CX + R - RIM, CY - D + 15, 'J-HW')
if TABLE:
    msp.add_lwpolyline([(CX + R, CY, 0), (CX + R + TL - TD / 2, CY, 1), (CX + R + TL - TD / 2, CY - TD, 0), (CX + R, CY - TD, 0)],
                       format='xyb', close=True, dxfattribs={'layer': 'J-TABLE'})
    dh(CX + R, CX + R + TL, CY - TD, CY - TD - 120)
dv(CY - D - MT, CY, CX - R - W - 60, CX - R - W - 160); dv(CY - D, CY, CX + R + (TL if TABLE else 0) + 60, CX + R + (TL if TABLE else 0) + 140)
dh(CX - R - W, CX + R, CY - D - MT, CY - D - MT - 160)
text(CX - R, CY - D - MT - 330, 'mirror parked open (dashed)', 32, al=TA.MIDDLE_LEFT)
text(CX, CY - D + 50, 'runner (x2)', 28)
title(CX - 1100, 2350, 'C  PLAN SECTION AT 1000 AFF')
text(CX - 1100, 2250, 'room side at bottom; north (entry door) to the left', 32, al=TA.MIDDLE_LEFT)

# ---------------- D side section ----------------
DX = 9000                    # wall face at x = DX, room to the left
line((DX, -50), (DX, 2400), 'A-WALL'); line((DX + 110, -50), (DX + 110, 2400), 'A-WALL'); line((DX - 700, 0), (DX + 110, 0), 'A-WALL')
rect(DX - D, Y0, DX, Y0 + H, 'J-CAB'); rect(DX - D - MT, Y0, DX - D, Y0 + H, 'J-MIRROR')
for y in SHELVES: rect(DX - D + 10, y - 18, DX - RIM, y, 'J-SHELF')
for y in RUNNERS: rect(DX - D - 5, y - 22, DX - D + 10, y + 23, 'J-HW')
if TABLE: rect(DX - TD, TY, DX, TY + TT, 'A-HIDDEN')
dh(DX - D - MT, DX, Y0 + H, Y0 + H + 120); dh(DX - D, DX, Y0 + H, Y0 + H + 220)
dv(0, Y0, DX + 160, DX + 200); dv(Y0, Y0 + H, DX + 160, DX + 300)
title(DX - 700, 2350, 'D  SIDE SECTION')
text(DX - D - MT - 40, 1000, '600 HEAVY-DUTY FULL-EXTENSION SIDE RUNNERS x2, MIN 45 kg', 28, rot=90)

# ---------------- E position on the east wall ----------------
EX, EY = 1000, -3300          # z (from north wall) runs left->right; 1 mm = 1 unit
z = lambda mm: EX + (mm - 900)
line((z(900), EY), (z(2600), EY), 'A-WALL')
rect(z(900), EY, z(1000), EY + 2100, 'A-WALL'); text(z(950), EY + 1050, 'ENTRY DOOR FRAME', 30, rot=90)
zc = 1800; c0, c1 = zc - R, zc + R
rect(z(c0), EY + Y0, z(c1), EY + Y0 + H, 'J-CAB'); text(z(zc), EY + 1100, 'CABINET', 35)
rect(z(c0 - W), EY + Y0, z(c1 - W), EY + Y0 + H, 'J-MIRROR-OPEN'); text(z(zc - W), EY + 1100, 'MIRROR OPEN', 35)
if TABLE: rect(z(c1), EY + TY, z(c1 + TL), EY + TY + TT, 'J-TABLE')
rect(z(2350), EY, z(2400), EY + 2300, 'A-HIDDEN'); text(z(2375), EY + 1150, 'BARN DOOR EDGE (CLOSED)', 30, rot=90)
rect(z(2400), EY, z(2600), EY + 2400, 'A-WALL'); text(z(2500), EY + 1200, 'ROBE OPENING', 35, rot=90)
for a, b in [(1000, c0 - W), (c0 - W, c0), (c0, c1)] + ([(c1, c1 + TL), (c1 + TL, 2350)] if TABLE else [(c1, 2350)]):
    dh(z(a), z(b), EY + 2200, EY + 2420)
text(z(1350), EY - 300, f'cabinet centre {zc} from inner north wall', 32)
title(EX, EY + 2700, 'E  POSITION ON THE EAST WALL (looking east, mm from the north wall)')

# ---------------- F LED detail ----------------
FX, FY = 6400, -2400
rect(FX, FY, FX + 600, FY + MT * 6, 'J-MIRROR'); text(FX + 300, FY - 60, 'MIRROR RIM (x6 scale)', 32)
rect(FX + 120, FY + MT * 6 - 60, FX + 180, FY + MT * 6, 'E-LED'); text(FX + 150, FY + MT * 6 + 60, '10 W x 8 D GROOVE, ALU CHANNEL + OPAL COVER', 28)
rect(FX + 300, FY, FX + 600, FY + 30, 'J-MIRROR'); text(FX + 450, FY + 100, 'MIRROR 5 mm ON 12 PLY', 28)
title(FX, FY + 500, 'F  LED STRIP IN MIRROR RIM')

# ---------------- notes + title block ----------------
NX, NY = 9700, 2300
notes = [f'SLIDING DRESSING UNIT - EAST WALL - {int(W)} W x {int(H)} H x {int(D)} D',
         'Cabinet: pill shape, 25 walnut-veneer rim, 18 shelves, ply back; hung 100 above carpet',
         f'Mirror panel: {int(W)} x {int(H)} pill, 30 thick walnut rim, 5 mm mirror bonded to 12 ply',
         f'Runners: 2 x 600 heavy-duty full extension, min 45 kg, travel {int(W)}',
         ('Side table: ' + f'{int(TL)} x {int(TD)} x {int(TT)}, round end R{int(TD/2)}, top at {int(TY+TT)} AFF, south side') if TABLE else 'No side table',
         'LED (ML): 2 x opal micro channel in mirror rim, 24 V 2700K CRI90+',
         '  power: flexible 24 V cable loop / carrier behind mirror (600 slack)',
         '  driver in cabinet top; 240 V by licensed electrician',
         'Fix cabinet to at least 2 studs; check wall before ordering',
         'Units: mm. Check all dimensions on site.']
rect(NX, NY - 80 * len(notes) - 80, NX + 2900, NY + 60, 'A-TEXT')
for i, s in enumerate(notes): text(NX + 60, NY - i * 80, s, 50 if i == 0 else 36, al=TA.MIDDLE_LEFT)

doc.set_modelspace_vport(height=6500, center=(6000, -500))
doc.saveas(OUT); print('saved', OUT)
