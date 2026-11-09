#!/usr/bin/env python3
"""Slap and Talk sound-zone heatmap v2 – continuous fields from shared/cityfx.mjs."""
from PIL import Image, ImageDraw, ImageFont
import math, os, subprocess, json

# Pull live numbers from the module so the PNG can't drift from the code.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = subprocess.check_output([
    'node', '--input-type=module', '-e',
    """
import { FIELD, PEAKS, fieldAmounts, cityFxAt } from './shared/cityfx.mjs';
const W=96, N=192; // 0.5 m samples
const grid=[];
for (let iz=0; iz<N; iz++) {
  const row=[];
  for (let ix=0; ix<N; ix++) {
    const x = -48 + (ix+0.5)*W/N, z = -48 + (iz+0.5)*W/N;
    const A = fieldAmounts(x,z);
    row.push({x,z, d:A.delay, r:A.reverb, f:A.flanger, c:A.chorus, g:A.glitch, q:A.freq,
              a:A.peakA, b:A.peakB, pc:A.peakC, pd:A.peakD});
  }
  grid.push(row);
}
console.log(JSON.stringify({ FIELD, PEAKS, grid, N, W }));
"""
], text=True, cwd=ROOT)
data = json.loads(src)
FIELD, PEAKS, grid, N, W = data['FIELD'], data['PEAKS'], data['grid'], data['N'], data['W']

# --- canvas (large, clear text – owner has poor eyesight) ---
OUT_W = 2600
MARGIN = 160
TOP = 200
BOTTOM = 360
MAP_PX = OUT_W - 2 * MARGIN
OUT_H = TOP + MAP_PX + BOTTOM
SCALE = MAP_PX / 96

def to_px(x, z):
    return MARGIN + (x + 48) * SCALE, TOP + (z + 48) * SCALE

img = Image.new('RGB', (OUT_W, OUT_H), '#0b0f14')
draw = ImageDraw.Draw(img)
px = Image.new('RGBA', (OUT_W, OUT_H), (0,0,0,0))
pxdraw = ImageDraw.Draw(px)

def font(size):
    for path in (
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

F_TITLE = font(64)
F_BIG = font(42)
F_MED = font(32)
F_SM = font(26)
F_TINY = font(22)

# colours per effect (RGBA)
COLS = {
    'd': (26, 92, 255),    # Delay blue
    'r': (140, 50, 255),   # Reverb purple
    'f': (220, 100, 0),    # Flanger orange
    'c': (0, 170, 170),    # Chorus teal
    'g': (220, 20, 90),    # Glitch magenta
    'q': (40, 200, 80),    # Freq shift green (was Clean)
}
PEAK_COL = (255, 230, 80)

# city frame
c0, c1 = to_px(-48, -48), to_px(48, 48)
draw.rectangle([c0, c1], fill='#121820', outline='#e8eef5', width=6)

# paint fields (additive blend of semi-transparent colours)
cell = MAP_PX / N
for iz, row in enumerate(grid):
    for ix, s in enumerate(row):
        x0 = MARGIN + ix * cell
        y0 = TOP + iz * cell
        # composite strongest contributions
        r = g = b = 0.0
        total = 0.0
        for key, col in COLS.items():
            a = s[key]
            if a < 0.02: continue
            r += col[0] * a; g += col[1] * a; b += col[2] * a; total += a
        # peaks as yellow overlay
        peak = max(s['a'], s['b'], s['pc'], s['pd'])
        if peak > 0.05:
            r += PEAK_COL[0] * peak * 1.2
            g += PEAK_COL[1] * peak * 1.2
            b += PEAK_COL[2] * peak * 1.2
            total += peak * 1.2
        if total < 0.02: continue
        # normalise & boost visibility
        scale = min(1.0, total) / total
        rr = int(min(255, r * scale * 1.15))
        gg = int(min(255, g * scale * 1.15))
        bb = int(min(255, b * scale * 1.15))
        alpha = int(min(230, 40 + 200 * min(1.0, total)))
        pxdraw.rectangle([x0, y0, x0 + cell + 1, y0 + cell + 1], fill=(rr, gg, bb, alpha))

img = Image.alpha_composite(img.convert('RGBA'), px).convert('RGB')
draw = ImageDraw.Draw(img)

# plots / houses
PLOT, HOUSE = 32, 16
PLOT_NS = [1, 2, 3, 4, None, 5, 6, 7, 8]
for k, hn in enumerate(PLOT_NS):
    i, j = (k % 3) - 1, k // 3 - 1
    x, z = i * PLOT, j * PLOT
    # plot outline
    half = (PLOT - 0.8) / 2
    draw.rectangle([to_px(x - half, z - half), to_px(x + half, z + half)], outline='#445566', width=2)
    # house
    hh = HOUSE / 2
    fill = '#1a5a3a' if hn is None else '#2a3340'
    draw.rectangle([to_px(x - hh, z - hh), to_px(x + hh, z + hh)], fill=fill, outline='#d0d8e0', width=3)
    # door facing south
    dx, dz = x, z + hh
    draw.rectangle([to_px(dx - 1.3, dz - 0.2), to_px(dx + 1.3, dz + 0.4)], fill='#111')

# quarter labels (big)
labels = [
    (-32, -32, 'DELAY', COLS['d']),
    ( 32, -32, 'REVERB', COLS['r']),
    (-32,   0, 'FLANGER', COLS['f']),
    ( 32,   0, 'CHORUS', COLS['c']),
    (-32,  32, 'GLITCH', COLS['g']),
    ( 32,  32, 'FREQ\nSHIFT', COLS['q']),
    (  0,   0, 'TOWN\nHALL', (180, 220, 180)),
]
for x, z, text, col in labels:
    px_, py_ = to_px(x, z)
    for i, line in enumerate(text.split('\n')):
        bbox = draw.textbbox((0, 0), line, font=F_BIG)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((px_ - tw / 2, py_ - th / 2 + i * (th + 4) - (th if '\n' in text else 0) / 2),
                  line, font=F_BIG, fill=col)

# Peaks A–D – unique 3-effect combos + falloff ring (peakR)
PEAK_FILLS = {
    'peakA': (255, 110, 40),   # dist+delay+freq
    'peakB': (255, 230, 80),   # bitcrush+reverb+chorus
    'peakC': (255, 80, 160),   # dist+flanger+stutter
    'peakD': (120, 220, 255),  # bitcrush+freq+reverb
}
DIST_COL = PEAK_FILLS['peakA']
CRUSH_COL = PEAK_FILLS['peakB']
for p in PEAKS:
    px_, py_ = to_px(p['x'], p['z'])
    fill = PEAK_FILLS.get(p['id'], (255, 230, 80))
    rr = FIELD['peakR'] * SCALE
    draw.ellipse([px_ - rr, py_ - rr, px_ + rr, py_ + rr], outline=fill, width=3)
    R = 28
    draw.ellipse([px_ - R, py_ - R, px_ + R, py_ + R], fill=fill, outline='#111', width=4)
    letter = p['id'][-1]
    bbox = draw.textbbox((0, 0), letter, font=F_BIG)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((px_ - tw / 2, py_ - th / 2 - 4), letter, font=F_BIG, fill='#111')
    pair = '+'.join(p['effects'])
    bbox = draw.textbbox((0, 0), pair, font=F_TINY)
    tw = bbox[2] - bbox[0]
    draw.text((px_ - tw / 2, py_ + R + 6), pair, font=F_TINY, fill=fill)

# compass
draw.text((MARGIN + 20, TOP + 20), 'N ↑', font=F_MED, fill='#e8eef5')

# title + legend
draw.text((MARGIN, 40), 'Slap and Talk – sound zones v2', font=F_TITLE, fill='#e8eef5')
draw.text((MARGIN, 120), f'Continuous fields · alleys blend · peaks ~{FIELD["peakR"]} m · each peak a unique 3-effect stack', font=F_SM, fill='#9aa8b8')

# legend at bottom
legend = [
    ('Delay (NW corner, slow)', COLS['d']),
    ('Reverb (NE corner, slow)', COLS['r']),
    ('Glitch (SW corner, slow)', COLS['g']),
    ('Freq shift (SE corner, slow)', COLS['q']),
    ('Flanger (W side, half-disc)', COLS['f']),
    ('Chorus (E side, half-disc)', COLS['c']),
    ('Peak A dist+delay+freq', PEAK_FILLS['peakA']),
    ('Peak B bitcrush+reverb+chorus', PEAK_FILLS['peakB']),
    ('Peak C dist+flanger+stutter', PEAK_FILLS['peakC']),
    ('Peak D bitcrush+freq+reverb', PEAK_FILLS['peakD']),
]
lx, ly = MARGIN, TOP + MAP_PX + 40
for i, (name, col) in enumerate(legend):
    col_i = i % 4
    row_i = i // 4
    x = lx + col_i * 580
    y = ly + row_i * 70
    draw.rectangle([x, y, x + 40, y + 40], fill=col, outline='#fff', width=2)
    draw.text((x + 55, y + 4), name, font=F_MED, fill='#e8eef5')

draw.text((MARGIN, OUT_H - 70),
          'Town Hall ≈ silent · delay time short near Delay house → ⅛-note mid-alley · each intersection stacks 3 unique effects',
          font=F_SM, fill='#9aa8b8')

out = '/workspace/slapandtalk-soundmap-v2.png'
img.save(out, 'PNG')
print('wrote', out, img.size)
