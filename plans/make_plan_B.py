"""Bedroom 1 plan, option B: Elyse bed with headboard towards the south window, gap behind it."""
import sys
OUT = sys.argv[1]
GAP = float(sys.argv[2]) if len(sys.argv) > 2 else 0.40   # gap between window wall and back of headboard (m)

S = 150; X0, Y0 = 170, 150
X = lambda m: X0 + m * S; Y = lambda m: Y0 + m * S
INK = '#2b2622'; QUIET = '#6b625a'; GRID = '#e3ddd4'; WALL = '#2b2622'
WAL = '#7a5233'; WAL_L = '#e9dccb'; BED = '#f3ece0'; BED_E = '#a8998a'
ACC = '#c0392b'; GREEN = '#1e8449'; LIGHT = '#d4a017'; MIR = '#cfe3ec'; STONE = '#e6dccb'; BLUE = '#3b7ea1'
b = []
def t(x, y, s, size=12, fill=INK, anchor='start', weight='400', rot=None):
    tr = f' transform="rotate({rot} {x} {y})"' if rot is not None else ''
    b.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}"{tr}>{s}</text>')
def r(x0, z0, x1, z1, fill='none', stroke=INK, sw=1.2, rx=0, dash=None, op=1):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    b.append(f'<rect x="{X(x0):.1f}" y="{Y(z0):.1f}" width="{(x1-x0)*S:.1f}" height="{(z1-z0)*S:.1f}" fill="{fill}" fill-opacity="{op}" stroke="{stroke}" stroke-width="{sw}" rx="{rx}"{d}/>')
def ln(x0, z0, x1, z1, c=INK, sw=1, dash=None, tick=False):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    m = ' marker-end="url(#tk)" marker-start="url(#tk)"' if tick else ''
    b.append(f'<line x1="{X(x0):.1f}" y1="{Y(z0):.1f}" x2="{X(x1):.1f}" y2="{Y(z1):.1f}" stroke="{c}" stroke-width="{sw}"{d}{m}/>')
def dimh(x0, x1, z, label, off=-5, c=INK, size=11):
    ln(x0, z, x1, z, c, 1, tick=True); t((X(x0)+X(x1))/2, Y(z)+off, label, size, c, 'middle')
def dimv(x, z0, z1, label, off=-5, c=INK, size=11):
    ln(x, z0, x, z1, c, 1, tick=True); t(X(x)+off, (Y(z0)+Y(z1))/2, label, size, c, 'middle', rot=-90)
def circ(x, z, rad, fill='none', stroke=INK, sw=1.2):
    b.append(f'<circle cx="{X(x):.1f}" cy="{Y(z):.1f}" r="{rad}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

RW, RL, T = 4.0, 4.9, 0.11
BW, BL = 2.06, 2.43
HB_Z1 = RL - GAP                 # back of headboard
FOOT = HB_Z1 - BL                # foot of bed
BX0, BX1 = 2.0 - BW / 2, 2.0 + BW / 2
NSW, NSD = 0.45, 0.45
NS = [(BX0 - 0.02 - NSW, BX0 - 0.02), (BX1 + 0.02, BX1 + 0.02 + NSW)]
NS_Z0, NS_Z1 = HB_Z1 - NSD, HB_Z1

# room
r(0, 0, RW, RL, '#f7f5f2', 'none', 0)
for xx in range(1, 4): ln(xx, 0, xx, RL, GRID, 0.6)
for zz in range(1, 5): ln(0, zz, RW, zz, GRID, 0.6)
r(-T, -T, 0, RL + T, WALL, WALL, 0); r(-T, -T, RW + T, 0, WALL, WALL, 0)
r(0, RL, 0.85, RL + T, WALL, WALL, 0); r(3.15, RL, RW + T, RL + T, WALL, WALL, 0)
r(0.85, RL + 0.03, 3.15, RL + 0.08, '#dbe9f1', BLUE, 1.5)
r(RW, -T, RW + T, 0.1, WALL, WALL, 0); r(RW, 1.0, RW + T, 2.4, WALL, WALL, 0); r(RW, 3.3, RW + T, RL + T, WALL, WALL, 0)
b.append(f'<path d="M{X(RW)} {Y(0.1)} L{X(RW-0.9)} {Y(0.1)} A{0.9*S} {0.9*S} 0 0 0 {X(RW)} {Y(1.0)}" fill="{ACC}" fill-opacity="0.06" stroke="{ACC}" stroke-width="1" stroke-dasharray="5 4"/>')
ln(RW, 0.1, RW - 0.9, 0.1, ACC, 3)
t(X(RW) + 16, Y(0.5), 'ENTRY DOOR 900', 11, ACC, 'start', '700')
for z0, z1, lab in [(1.0, 2.4, 'WIR 1'), (3.3, 4.9, 'WIR 2')]:
    r(RW + T, z0, RW + 1.4, z1, '#efebe5', '#9a948c', 1); t((X(RW + T) + X(RW + 1.4)) / 2, Y((z0 + z1) / 2), lab, 12, QUIET, 'middle')
t((X(RW + T) + X(RW + 1.4)) / 2, Y(2.82), 'robe walkway 900', 10.5, QUIET, 'middle'); t((X(RW + T) + X(RW + 1.4)) / 2, Y(2.82) + 14, 'to ensuite →', 10.5, QUIET, 'middle')

# robe walkway opening left open (no door)

# curtains (ceiling track) - still fully operable behind the bed
ln(0.7, 4.82, 3.3, 4.82, '#b8a99a', 3, dash='2 3')
# bed
r(BX0, FOOT, BX1, HB_Z1, BED, BED_E, 1.8, rx=10)
r(BX0, HB_Z1 - 0.12, BX1, HB_Z1, '#e2d6c6', BED_E, 1.4, rx=4)
r(BX0 + 0.1, FOOT + 0.1, BX1 - 0.1, HB_Z1 - 0.18, '#fbfaf7', '#cfc6b8', 1, rx=8)
for xc in (1.57, 2.43):
    r(xc - 0.36, HB_Z1 - 0.6, xc + 0.36, HB_Z1 - 0.2, '#ffffff', '#cfc6b8', 1, rx=10)
ln(BX0 + 0.1, FOOT + 0.5, BX1 - 0.1, FOOT + 0.5, '#cfc6b8', 1, dash='4 3')
t(X(2.0), Y(FOOT + 1.05), 'ELYSE KING BED', 14, INK, 'middle', '700')
t(X(2.0), Y(FOOT + 1.05) + 17, '2060 W × 2430 L, headboard 930 H', 11.5, QUIET, 'middle')
t(X(2.0), Y(FOOT + 1.05) + 32, 'head to the SOUTH (window)', 11, GREEN, 'middle', '700')
# nightstands + pendants
for x0, x1 in NS:
    r(x0, NS_Z0, x1, NS_Z1, WAL_L, WAL, 1.5); t(X((x0 + x1) / 2), Y((NS_Z0 + NS_Z1) / 2) + 4, 'NS', 10.5, WAL, 'middle', '700')
    circ((x0 + x1) / 2, (NS_Z0 + NS_Z1) / 2 - 0.12, 6, '#fffdf6', '#b08d57', 1.5)
# artwork on the west wall, between the reading corner and the west nightstand
r(0, 1.9, 0.04, 3.7, '#c77d5a', '#b08d57', 1.2); t(X(0.14), Y(2.8), 'ARTWORK 1800 × 900 (centre 1450 AFF)', 10.5, '#8a4f33', 'middle', '700', rot=-90)
# mirror + floor drawer: east wall between door and robe walkway (faces west)
# floor drawer 750 x 380 + arched mirror cabinet 1000 x 1950 x 150 resting on its top (mirror door hinged on north edge)
r(3.62, 1.325, 4.0, 2.075, WAL_L, WAL, 1.5); r(3.85, 1.325, 4.0, 2.075, 'none', WAL, 1.2, dash='4 3'); r(3.832, 1.4, 3.85, 2.0, MIR, '#b08d57', 1.2)
b.append(f'<path d="M{X(3.85)} {Y(2.0)} A{0.6*S} {0.6*S} 0 0 1 {X(3.85-0.6)} {Y(1.4)}" fill="none" stroke="{WAL}" stroke-width="0.8" stroke-dasharray="3 3"/>')
for zc in (1.3625, 2.0375): r(3.825, zc - 0.012, 3.85, zc + 0.012, '#fff1b8', LIGHT, 1.2)
t(X(3.74), Y(1.7), 'DRAWER + MIRROR', 9, WAL, 'middle', '700', rot=-90)
# lounge corner: north-west
b.append(f'<g transform="translate({X(0.5):.1f} {Y(0.55):.1f}) rotate(-40)"><rect x="{-0.36*S:.1f}" y="{-0.36*S:.1f}" width="{0.72*S:.1f}" height="{0.72*S:.1f}" rx="16" fill="#cbbfb0" stroke="#7d6e60" stroke-width="1.5"/><rect x="{-0.36*S:.1f}" y="{-0.36*S:.1f}" width="{0.72*S:.1f}" height="{0.16*S:.1f}" rx="8" fill="#a8998a"/></g>')
t(X(0.5), Y(0.55) + 4, 'CHAIR', 10, INK, 'middle', '700')
circ(0.42, 1.3, 0.2 * S, STONE, '#a89886', 1.2); t(X(0.42), Y(1.3) + 4, 'table', 9.5, QUIET, 'middle')
circ(0.12, 0.12, 7, '#b08d57', '#7a6234', 1)
# ceiling lights (none over the bed)
for (x, z, lab) in [(0.7, 1.2, 'D1'), (2.0, 1.2, 'D2'), (3.3, 1.2, 'D3'), (0.7, 2.4, 'A1'), (0.7, 3.2, 'A2'), (3.3, 2.4, 'D4'), (3.3, 3.2, 'D5')]:
    circ(x, z, 5, '#fff6d6', LIGHT, 1.4); t(X(x) + 8, Y(z) + 4, lab, 9.5, '#7a5a00', 'start', '700')

# dimensions
dimh(0, RW, -0.45, '4000', -6, INK, 12); dimv(-0.45, 0, RL, '4900', -8, INK, 12)
zc = HB_Z1 - 0.9
dimh(0, BX0, zc, f'{round(BX0*1000)}', -5, GREEN); dimh(BX0, BX1, zc + 0.15, '2060', -5); dimh(BX1, RW, zc, f'{round((RW-BX1)*1000)}', -5, GREEN)
dimv(1.2, 0, FOOT, f'{round(FOOT*1000)} foot of bed to north wall', -6, GREEN)
dimv(1.2, FOOT, HB_Z1, '2430', -6)
dimv(1.2, HB_Z1, RL, f'{round(GAP*1000)} gap', 14, ACC, 11)
dimh(NS[1][0], NS[1][1], NS_Z0 - 0.08, '450', -5, QUIET, 10)
dimh(0.85, 3.15, 5.08, 'window 2300 (centred, sill 560)', 14, BLUE, 10.5)
dimv(3.55, 1.325, 2.075, '750', -6, QUIET, 10)
dimv(0.3, 1.9, 3.7, 'art 1800', 14, '#8a4f33', 10)

# legend + notes
t(X(RW + 1.7), Y(-0.45), '', 1)
b.append(f'<g transform="translate({X(RW+1.9):.1f} {Y(-0.45):.1f})"><polygon points="0,-20 8,6 0,1 -8,6" fill="{INK}"/><text x="0" y="22" font-size="13" font-weight="700" text-anchor="middle" fill="{INK}">N</text></g>')
nx, ny = X(RW + 1.65), Y(0.6)
notes = [('LAYOUT B - HEAD TO THE WINDOW', GREEN, '700'),
         (f'Gap window wall to headboard: {round(GAP*1000)}', INK, '400'),
         ('  - curtains open/close behind the bed', QUIET, '400'),
         ('  - reach to open the window', QUIET, '400'),
         ('Headboard 930 H is above the 560 sill:', INK, '400'),
         ('  it covers the lowest 370 of the glass', QUIET, '400'),
         ('Nightstands (550 H) sit below the sill', INK, '400'),
         (f'Walkways beside bed: {round(BX0*1000)} each side', INK, '400'),
         (f'Foot of bed to north wall: {round(FOOT*1000)}', INK, '400'),
         ('Walnut headboard wall removed', INK, '400'),
         ('East wall: floor drawer + arched mirror cabinet', INK, '400'),
         ('Lounge chair moved to NW corner', INK, '400'),
         ('Artwork on west wall, centre 2.8 m from north wall', INK, '400'),
         ('Lights on a symmetric grid: 700 off west and east walls', INK, '400'),
         ('A1-A2 art gimbals; D1-D5 plain downlights', INK, '400'),
         ('Robe opening left open (no door)', INK, '400'),
         ('ML: LED bars either side of the mirror', INK, '400'),
         ('Head to south = Vastu-preferred', GREEN, '400')]
b.append(f'<rect x="{nx-12}" y="{ny-22}" width="330" height="{len(notes)*20+18}" rx="8" fill="#ffffff" stroke="#bfb6aa"/>')
for i, (n, c, w) in enumerate(notes):
    t(nx, ny + i * 20, n, 12 if i else 13, c, 'start', w)

W_, H_ = 1400, 1000
title = '<text x="24" y="38" font-size="22" font-weight="700" fill="#2b2622">Bedroom 1 — layout B: Elyse bed with its head towards the window</text>'
sub = f'<text x="24" y="62" font-size="13.5" fill="#6b625a">All dimensions in mm · {round(GAP*1000)} mm gap between window wall and headboard · ceiling 2.4 m · light grey carpet · north up</text>'
defs = f'<defs><marker id="tk" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M5 0L5 10" stroke="{INK}" stroke-width="1.6"/></marker></defs>'
open(OUT, 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W_}" height="{H_}" viewBox="0 0 {W_} {H_}" font-family="Helvetica, Arial, sans-serif"><rect width="{W_}" height="{H_}" fill="#ffffff"/>{defs}{title}{sub}{"".join(b)}</svg>')
print('written', OUT, 'foot-to-north', round(FOOT, 3), 'side gaps', round(BX0, 3))
