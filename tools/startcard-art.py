# The start card's art (Jens, 2 Nov 2026), made from his own pictures – no image generator:
#   client/public/start/card.webp   = knappar/menue.png (1143x1489 → 1075x1400) with the printed "TO:" painted out
#   client/public/start/enter.png   = his hand-drawn red "enter" cut from the mockup start-card-1.jpg
#   client/public/start/orjoin.png  = his hand-drawn red "...or Join" cut from the same mockup
# The mockup is the same photo at the same size as menue.png, so the cut-outs sit where he drew them.
# Where his white mockup text ("new room") crossed the red strokes, the strokes are filled back in.
# Run: python3 tools/startcard-art.py <menue.png> <start-card-1.jpg> <out dir>   (needs opencv-python, numpy)
import sys, json
import cv2, numpy as np

menue, mock, out = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = 1075, 1400

# ---- the card: paint out "TO:" ----
card = cv2.imread(menue, cv2.IMREAD_UNCHANGED)
card = cv2.resize(card, (W, H), interpolation=cv2.INTER_AREA)
bgr, a = card[:, :, :3].copy(), card[:, :, 3]
x0, y0, x1, y1 = 180, 728, 330, 822                  # around the printed "TO:"
roi = bgr[y0:y1, x0:x1].astype(int)
red = ((roi[:, :, 2] - roi[:, :, 1]) > 28) & ((roi[:, :, 2] - roi[:, :, 0]) > 28)
mask = np.zeros((H, W), np.uint8); mask[y0:y1, x0:x1][red] = 255
mask = cv2.dilate(mask, np.ones((7, 7), np.uint8))
clean = cv2.inpaint(bgr, mask, 9, cv2.INPAINT_TELEA)
# a little of the card's paper grain back over the painted spot
noise = np.random.default_rng(7).normal(0, 2.2, clean.shape)
m3 = (cv2.GaussianBlur(mask, (9, 9), 0) / 255.0)[:, :, None]
clean = np.clip(clean + noise * m3, 0, 255).astype(np.uint8)
cv2.imwrite(f'{out}/card.webp', np.dstack([clean, a]), [cv2.IMWRITE_WEBP_QUALITY, 90])

# ---- the lettering ----
mk = cv2.imread(mock)
mk = cv2.resize(mk, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
b, g, r = mk[:, :, 0], mk[:, :, 1], mk[:, :, 2]
paper = np.median(cv2.resize(cv2.imread(menue)[:, :, :3], (W, H))[300:450, 100:900].reshape(-1, 3), axis=0)  # the card's beige
ink_mask = ((r - g) > 55) & ((r - b) > 55)
ink = np.median(mk[ink_mask].reshape(-1, 3), axis=0)  # his red
white = (r > 215) & (g > 215) & (b > 215)
# "redness" 0..1 between paper and ink (soft edges)
def redness(px):
  d = ink - paper
  return np.clip(((px - paper) @ d) / (d @ d), 0, 1)
alpha_all = redness(mk.reshape(-1, 3)).reshape(H, W)
alpha_all[~(ink_mask | (alpha_all > 0.35))] = 0
boxes = {}
def cut(name, x0, y0, x1, y1, fill_white=False):
  al = alpha_all[y0:y1, x0:x1].copy()
  if fill_white:  # strokes crossed by the white mockup text: close the gaps (only on white pixels)
    hard = (al > 0.5).astype(np.uint8) * 255
    closed = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    wt = cv2.dilate(white[y0:y1, x0:x1].astype(np.uint8) * 255, np.ones((5, 5), np.uint8)) > 0
    fill = (closed > 0) & wt
    al[fill] = 1.0
    al = np.maximum(al, cv2.GaussianBlur((al > 0.5).astype(np.float32), (3, 3), 0) * (fill | (al > 0)))
  # specks (paper grain, the mockup's text edges) out: keep only real strokes
  n, lab, stats, _ = cv2.connectedComponentsWithStats((al > 0.3).astype(np.uint8), 8)
  keep = np.zeros(n, bool); keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= 80
  al[~keep[lab]] = 0
  # smooth the stroke edges (where the white text was cut out they are ragged)
  hard = cv2.morphologyEx((al > 0.5).astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
  al = np.where(hard > 0, np.maximum(al, 0.98), al * (cv2.dilate(hard, np.ones((3, 3), np.uint8)) > 0))
  al = cv2.GaussianBlur(al.astype(np.float32), (3, 3), 0)
  ys, xs = np.nonzero(al > 0.05); pad = 6
  ty0, ty1, tx0, tx1 = max(0, ys.min() - pad), ys.max() + pad, max(0, xs.min() - pad), xs.max() + pad
  al = al[ty0:ty1, tx0:tx1]
  rgba = np.zeros(al.shape + (4,), np.uint8)
  rgba[:, :, :3] = ink.astype(np.uint8); rgba[:, :, 3] = (al * 255).astype(np.uint8)
  cv2.imwrite(f'{out}/{name}.png', rgba)
  boxes[name] = {'x': (x0 + tx0) / W, 'y': (y0 + ty0) / H, 'w': al.shape[1] / W, 'h': al.shape[0] / H}
cut('enter', 40, 330, 1060, 880, fill_white=True)
cut('orjoin', 20, 940, 1000, 1170)
print(json.dumps(boxes))
