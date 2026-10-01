#!/usr/bin/env python3
"""Mediciones GEOMÉTRICAS de una adaptación a partir de datos (no es una evaluación visual):

  - separación mínima entre los glifos del titular y la silueta de la persona (canal alfa del recorte, escalado y
    colocado como en la relectura del clon);
  - márgenes de la parte alta de la silueta (codos) respecto a los bordes superior y derecho;
  - distancia mínima entre la cinta visible (píxeles de su color en la captura) y las cajas de render de los textos;
  - separación entre la región protegida (cara) y la caja de render de la oferta.

Uso:
  python3 scripts/measure-layout.py --clone-snapshot S.json --master-snapshot M.json --alpha FOTO.png \
      --screenshot CAPTURA.png --composition C.json --headline 1:571 --photo 1:539 --offer 1:549 --cta 1:550 \
      --ribbon-rgb 209,164,196 --out OUT.json

La captura de la foto (`--alpha`) es la de `get_screenshot` del nodo de la foto en la MAESTRA (contentsOnly), recortada
por el frame de la maestra; su origen se toma del frame de la maestra.
"""
import argparse, json
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
for k in ('clone-snapshot', 'master-snapshot', 'alpha', 'screenshot', 'composition', 'headline', 'photo', 'offer', 'cta', 'out'):
    ap.add_argument('--' + k, required=True)
ap.add_argument('--ribbon-rgb', default='209,164,196')
a = ap.parse_args()

cs, ms = json.load(open(a.clone_snapshot)), json.load(open(a.master_snapshot))
comp = json.load(open(a.composition))
idmap = {}
for m, c in zip(ms['nodes'], cs['nodes']):  # mismo preorden (nodes_preserved lo garantiza)
    idmap[m['id']] = c
mroot, croot = ms['nodes'][0], cs['nodes'][0]
W, H = int(croot['width']), int(croot['height'])
def rel(n, root, key='absoluteRenderBounds'):
    b, r = n[key], root['absoluteBoundingBox']
    return None if b is None else (b['x'] - r['x'], b['y'] - r['y'], b['width'], b['height'])

# Silueta: alfa de la foto de la maestra -> coordenadas del frame del clon.
mph = next(n for n in ms['nodes'] if n['id'] == a.photo)
cph = idmap[a.photo]
mx, my = rel(mph, mroot, 'absoluteBoundingBox')[:2]
cx, cy, cw, _ = rel(cph, croot, 'absoluteBoundingBox')
s = cw / mph['width']
alpha = np.array(Image.open(a.alpha).convert('RGBA'))[:, :, 3] > 128
ys, xs = np.nonzero(alpha)
# El render está recortado por el frame de la maestra: empieza en max(0, posición de la foto) en cada eje.
px = cx + s * (xs + max(0.0, -mx))
py = cy + s * (ys + max(0.0, -my))
inside = (px >= 0) & (px < W) & (py >= 0) & (py < H)
P = np.stack([px[inside], py[inside]], 1)

shot = np.array(Image.open(a.screenshot).convert('RGB')).astype(int)
def glyph_pixels(node_id, test):
    x, y, w, h = rel(idmap[node_id], croot)
    x0, y0, x1, y1 = int(max(0, x)), int(max(0, y)), int(min(W, x + w + 1)), int(min(H, y + h + 1))
    sub = shot[y0:y1, x0:x1]
    yy, xx = np.nonzero(test(sub))
    return np.stack([xx + x0, yy + y0], 1).astype(float)
dark = lambda c: (c[..., 0] < 40) & (c[..., 1] > 45) & (c[..., 1] < 100) & (c[..., 2] > 35) & (c[..., 2] < 85)
Hg = glyph_pixels(a.headline, dark)

def min_dist(A, B, step=3):
    A, B = A[::step], B[::step]
    best = 1e9
    for i in range(0, len(A), 2000):
        d = np.sqrt(((A[i:i + 2000, None, :] - B[None, :, :]) ** 2).sum(-1)).min()
        best = min(best, d)
    return float(best)

out = {}
out['headline_to_person_min_px'] = round(min_dist(Hg, P), 1)
top_rows = P[P[:, 1] < P[:, 1].min() + 0.25 * (P[:, 1].max() - P[:, 1].min())]
out['person_top_margin_px'] = round(float(P[:, 1].min()), 1)
out['upper_silhouette_right_margin_px'] = round(float(W - top_rows[:, 0].max()), 1)
out['photo_scale'] = round(s, 4)
out['photo_bottom_px'] = round(cy + s * mph['height'], 2)

# Cinta visible en la captura (fuera del botón, que comparte color).
rgb = np.array([int(v) for v in a.ribbon_rgb.split(',')])
pink = (np.abs(shot - rgb).sum(-1) < 40)
bx, by, bw, bh = rel(idmap[a.cta], croot)
pink[int(by):int(by + bh) + 1, int(bx):int(bx + bw) + 1] = False
# Descarta componentes diminutos (tonos de piel parecidos): la cinta es una banda continua.
from collections import deque
seen = np.zeros_like(pink)
for y0, x0 in zip(*np.nonzero(pink)):
    if seen[y0, x0]:
        continue
    blob, q = [], deque([(y0, x0)]); seen[y0, x0] = True
    while q:
        y, x = q.popleft(); blob.append((y, x))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and pink[yy, xx] and not seen[yy, xx]:
                seen[yy, xx] = True; q.append((yy, xx))
    if len(blob) < 200:
        for y, x in blob: pink[y, x] = False
ry, rx = np.nonzero(pink)
R = np.stack([rx, ry], 1).astype(float)
texts = [n for n in ms['nodes'] if n.get('text')]
d_txt = {}
for t in texts:
    b = rel(idmap[t['id']], croot)
    if not b or len(R) == 0:
        continue
    x, y, w, h = b
    dx = np.maximum(0, np.maximum(x - R[:, 0], R[:, 0] - (x + w)))
    dy = np.maximum(0, np.maximum(y - R[:, 1], R[:, 1] - (y + h)))
    d_txt[t['id']] = round(float(np.sqrt(dx * dx + dy * dy).min()), 1)
out['ribbon_visible_px'] = int(pink.sum())
out['ribbon_to_text_render_box_min_px'] = d_txt

# Región protegida (cara) frente a la oferta.
for pr in comp['protectedRegions']:
    if pr['nodeId'] == a.photo:
        k = s
        face_bottom = cy + (pr['rect']['y'] + pr['rect']['height']) * k
        ob = rel(idmap[a.offer], croot)
        out['face_region_to_offer_render_px'] = round(ob[1] - face_bottom, 1)
json.dump(out, open(a.out, 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
