"""Bedroom 1 plan (Nick Scali Elyse) as a CAD drawing: DXF R2018, millimetres, layered, dimensioned.
Coordinates: origin = inner south-west corner of the room, +X east, +Y north."""
import sys, math
import ezdxf
from ezdxf.enums import TextEntityAlignment

OUT = sys.argv[1]
doc = ezdxf.new('R2018', setup=True)
doc.units = ezdxf.units.MM
doc.header['$INSUNITS'] = 4
doc.header['$MEASUREMENT'] = 1
msp = doc.modelspace()

LAYERS = {  # name: (ACI colour, linetype)
    'A-WALL': (7, 'Continuous'), 'A-GLAZ': (5, 'Continuous'), 'A-DOOR': (1, 'Continuous'),
    'A-ROBE': (8, 'Continuous'), 'I-JOIN-HEADWALL': (30, 'Continuous'), 'I-JOIN-MIRROR': (30, 'Continuous'),
    'I-FURN-BED': (40, 'Continuous'), 'I-FURN': (42, 'Continuous'), 'I-ART': (32, 'Continuous'),
    'I-SLED-HIDDEN': (4, 'DASHED'), 'I-CURTAIN': (9, 'DOT'), 'E-LITE': (2, 'Continuous'),
    'A-DIMS': (3, 'Continuous'), 'A-TEXT': (7, 'Continuous'), 'A-CLEAR': (3, 'DASHED'),
}
for n, (c, lt) in LAYERS.items():
    doc.layers.add(n, color=c, linetype=lt)

ds = doc.dimstyles.new('MM25')
ds.dxf.dimtxt = 70; ds.dxf.dimasz = 50; ds.dxf.dimexe = 40; ds.dxf.dimexo = 30
ds.dxf.dimdec = 0; ds.dxf.dimtad = 1; ds.dxf.dimgap = 20; ds.dxf.dimtsz = 40  # architectural ticks
ds.dxf.dimlunit = 2

RW, RL = 4000, 4900
Yz = lambda z: RL - z          # convert "mm from north wall" to Y

def rect(x0, y0, x1, y1, layer, closed=True):
    msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=closed, dxfattribs={'layer': layer})
def rz(x0, z0, x1, z1, layer):   # rect given x and "from north" z
    rect(x0, Yz(z1), x1, Yz(z0), layer)
def text(x, y, s, h=70, layer='A-TEXT', rot=0, align=TextEntityAlignment.MIDDLE_CENTER):
    msp.add_text(s, height=h, rotation=rot, dxfattribs={'layer': layer}).set_placement((x, y), align=align)
def dim_h(x0, x1, y, base_y):
    msp.add_linear_dim(base=(x0, base_y), p1=(x0, y), p2=(x1, y), dimstyle='MM25', dxfattribs={'layer': 'A-DIMS'}).render()
def dim_v(y0, y1, x, base_x):
    msp.add_linear_dim(base=(base_x, y0), p1=(x, y0), p2=(x, y1), angle=90, dimstyle='MM25', dxfattribs={'layer': 'A-DIMS'}).render()

# ---------------- walls (110 thick, outer outline) ----------------
T = 110
# west + north as one L, east + south pieces split at openings
rect(-T, -T, 0, RL + T, 'A-WALL')                       # west
rect(0, RL, RW + T, RL + T, 'A-WALL')                    # north
rect(RW, Yz(100), RW + T, RL, 'A-WALL')                  # east: NE nib 0-100 from north
rect(RW, Yz(2400), RW + T, Yz(1000), 'A-WALL')           # east: between door and robe walkway
rect(RW, -T, RW + T, Yz(3300), 'A-WALL')                 # east: south of robe walkway
rect(0, -T, 850, 0, 'A-WALL'); rect(3150, -T, RW, 0, 'A-WALL')   # south wall either side of window
# window 2300 centred, sill 560 / head 2100
rect(850, -T, 3150, 0, 'A-GLAZ'); msp.add_line((850, -T / 2), (3150, -T / 2), dxfattribs={'layer': 'A-GLAZ'})
text(2000, -T - 120, 'WINDOW 2300 W x 1540 H, SILL 560, HEAD 2100', 60, 'A-GLAZ')
# entry door 900, east wall 100-1000 from north, hinged at north jamb, opens into room
hinge = (RW, Yz(100))
msp.add_line(hinge, (RW - 900, Yz(100)), dxfattribs={'layer': 'A-DOOR'})
msp.add_arc(center=hinge, radius=900, start_angle=180, end_angle=270, dxfattribs={'layer': 'A-DOOR'})
text(RW + 160, Yz(550), 'ENTRY 900', 60, 'A-DOOR', align=TextEntityAlignment.MIDDLE_LEFT)
# robes + walkway (context)
rect(RW + T, Yz(2400), RW + 1400, Yz(1000), 'A-ROBE'); text(RW + 750, Yz(1700), 'WIR 1', 80, 'A-ROBE')
rect(RW + T, 0, RW + 1400, Yz(3300), 'A-ROBE'); text(RW + 750, Yz(4100), 'WIR 2', 80, 'A-ROBE')
text(RW + 750, Yz(2850), 'ROBE WALKWAY 900 TO ENSUITE', 50, 'A-ROBE')

# ---------------- headboard wall, bed, nightstands ----------------
rz(3200, 1350, 3300, 4350, 'I-JOIN-HEADWALL')
text(3250, Yz(2850), 'WALNUT HEADBOARD WALL 3000 x 100, 1200 H, 20 CAP', 55, 'I-JOIN-HEADWALL', rot=90)
BX1 = 3180; BX0 = BX1 - 2430; BZ0, BZ1 = 2850 - 1030, 2850 + 1030
rz(BX0, BZ0, BX1, BZ1, 'I-FURN-BED')
rz(BX1 - 120, BZ0, BX1, BZ1, 'I-FURN-BED')               # upholstered headboard, 930 H
rz(BX0 + 100, BZ0 + 100, BX1 - 180, BZ1 - 100, 'I-FURN-BED')   # mattress
for zc in (2420, 3280):
    rz(BX1 - 600, zc - 360, BX1 - 200, zc + 360, 'I-FURN-BED')
text((BX0 + BX1) / 2 - 150, Yz(2780), 'NICK SCALI ELYSE KING BED', 90, 'I-FURN-BED')
text((BX0 + BX1) / 2 - 150, Yz(2950), '2060 W x 2430 L, HEADBOARD 930 H', 65, 'I-FURN-BED')
for z0, z1 in ((1350, 1800), (3900, 4350)):
    rz(2740, z0, 3190, z1, 'I-FURN'); text(2965, Yz((z0 + z1) / 2), 'NS 450x450', 50, 'I-FURN')
    msp.add_circle((2965, Yz((z0 + z1) / 2 - 120)), 85, dxfattribs={'layer': 'E-LITE'})   # pendant
# hidden sled
rz(2600, 1350, 3300, 4350, 'I-SLED-HIDDEN')
rz(BX0 + 250, BZ0 + 30, 2600, BZ1 - 30, 'I-SLED-HIDDEN')
text(1700, Yz(1650), 'PLY SLED UNDER BED (HIDDEN) - SIZE TO BED LEGS', 45, 'I-SLED-HIDDEN')

# ---------------- west wall: mirror unit + artwork ----------------
rz(0, 500, 350, 1500, 'I-JOIN-MIRROR'); rz(0, 550, 30, 1450, 'I-JOIN-MIRROR')
text(200, Yz(1000), 'MIRROR 900x1900 ON FLOOR DRAWER 1000x350x300', 45, 'I-JOIN-MIRROR', rot=90)
rz(0, 1950, 40, 3750, 'I-ART'); text(110, Yz(2850), 'ARTWORK 1800 x 900, CENTRE 1450 AFF', 50, 'I-ART', rot=90)

# ---------------- lounge corner ----------------
cx, cy, a = 450, Yz(4430), math.radians(35)
pts = [(-360, -360), (360, -360), (360, 360), (-360, 360)]
msp.add_lwpolyline([(cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)) for x, y in pts], close=True, dxfattribs={'layer': 'I-FURN'})
text(cx, cy, 'CHAIR MAX 720', 45, 'I-FURN')
msp.add_circle((1050, Yz(4620)), 200, dxfattribs={'layer': 'I-FURN'}); text(1050, Yz(4620), 'TABLE', 40, 'I-FURN')
msp.add_circle((120, Yz(3970)), 60, dxfattribs={'layer': 'I-FURN'})

# ---------------- curtain track ----------------
msp.add_line((700, Yz(4820)), (3300, Yz(4820)), dxfattribs={'layer': 'I-CURTAIN'})
text(2000, Yz(4740), 'CURTAIN TRACK FIXED TO CEILING', 40, 'I-CURTAIN')

# ---------------- recessed lights ----------------
for x, z, lab in [(1000, 1200, 'D1'), (2200, 1200, 'D2'), (1000, 4350, 'D3'), (2200, 4350, 'D4'), (3620, 550, 'P1'),
                  (3650, 2850, 'P2'), (750, 2450, 'A1'), (750, 3250, 'A2'), (700, 1000, 'M1')]:
    msp.add_circle((x, Yz(z)), 45, dxfattribs={'layer': 'E-LITE'})
    msp.add_line((x - 32, Yz(z) - 32), (x + 32, Yz(z) + 32), dxfattribs={'layer': 'E-LITE'})
    msp.add_line((x - 32, Yz(z) + 32), (x + 32, Yz(z) - 32), dxfattribs={'layer': 'E-LITE'})
    text(x + 70, Yz(z), lab, 45, 'E-LITE', align=TextEntityAlignment.MIDDLE_LEFT)

# ---------------- dimensions ----------------
dim_h(0, RW, RL + T, RL + 650)                          # 4000 overall
dim_v(0, RL, -T, -650)                                  # 4900 overall
yc = Yz(2050)
for x0, x1 in [(0, BX0), (BX1, 3200), (3200, 3300), (3300, RW)]:
    dim_h(x0, x1, yc, yc + 120)
dim_h(BX0, BX1, Yz(3720), Yz(3720) + 120)               # bed length 2430
for z0, z1 in [(0, 1350), (1350, 4350), (4350, RL)]:
    dim_v(Yz(z1), Yz(z0), 3520, 3520)
for z0, z1 in [(0, BZ0), (BZ0, BZ1), (BZ1, RL)]:
    dim_v(Yz(z1), Yz(z0), 600, 600)
dim_h(850, 3150, -T, -500)                              # window
dim_h(2740, 3190, Yz(4350), Yz(4350) - 150)             # nightstand
dim_v(Yz(1500), Yz(500), 350, 550)                      # mirror unit width

# ---------------- title block ----------------
tb_x, tb_y = RW + 1700, -T
rect(tb_x, tb_y, tb_x + 3200, tb_y + 1500, 'A-TEXT')
for i, s in enumerate(['BEDROOM 1 - FURNITURE & SET-OUT PLAN', 'Bed: Nick Scali Elyse king 2060 x 2430, headboard 930 H',
                       'Room 4000 x 4900, ceiling 2400, 90 cove cornice, carpet', 'Units: millimetres   Scale 1:25 at A3 (plot)',
                       'Origin 0,0 = inner SW corner of room; +X east, +Y north', 'Layers: A-* architecture, I-* interiors, E-LITE lighting',
                       'Check all dimensions on site before ordering or cutting']):
    text(tb_x + 100, tb_y + 1350 - i * 190, s, 85 if i == 0 else 60, 'A-TEXT', align=TextEntityAlignment.MIDDLE_LEFT)
# north arrow
msp.add_lwpolyline([(RW + 2000, RL + 200), (RW + 2080, RL - 50), (RW + 2000, RL + 20), (RW + 1920, RL - 50)], close=True, dxfattribs={'layer': 'A-TEXT'})
text(RW + 2000, RL + 320, 'N', 120, 'A-TEXT')

doc.set_modelspace_vport(height=7000, center=(3000, 2400))
doc.saveas(OUT)
print('saved', OUT)
