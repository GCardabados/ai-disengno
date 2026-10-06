#!/usr/bin/env python3
"""Superposición de ATENCIÓN ESTIMADA y FLUJO DE LECTURA (separada de la creatividad final; nunca se escribe en Figma).

Uso:
  python3 scripts/attention-overlay.py --screenshot CAPTURA.png --flow flow.json --out atencion.png [--notes-out notas.json]

`flow.json` lo genera `node src/cli.ts attention-flow …` (recorrido previsto en messagePlan + cajas del clon).
Este script añade una estimación de contraste por elemento a partir de los píxeles de la captura (diferencia de
luminancia entre los percentiles 5 y 95 dentro de la caja) y dibuja:
  - un mapa de calor HEURÍSTICO (peso ∝ √área × contraste, atenuado según el orden previsto),
  - flechas y numeración del recorrido de lectura previsto,
  - la advertencia: es una estimación heurística del agente, no atención medida; sin porcentajes.
"""
import argparse, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('--screenshot', required=True)
ap.add_argument('--flow', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--notes-out')
a = ap.parse_args()

flow = json.load(open(a.flow))
im = Image.open(a.screenshot).convert('RGB')
W, H = flow['target']['width'], flow['target']['height']
if im.size != (W, H):
    raise SystemExit(f'La captura mide {im.size[0]}×{im.size[1]} y el destino {W}×{H}: pide la captura a tamaño real.')
px = np.asarray(im).astype(float) / 255.0
lum = 0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2]

notes = list(flow['notes'])
els = flow['elements']
for e in els:
    r = e['rect']
    x0, y0 = max(0, int(r['x'])), max(0, int(r['y']))
    x1, y1 = min(W, int(math.ceil(r['x'] + r['width']))), min(H, int(math.ceil(r['y'] + r['height'])))
    patch = lum[y0:y1, x0:x1]
    e['contrastEstimate'] = float(np.percentile(patch, 95) - np.percentile(patch, 5)) if patch.size else 0.0
    if e['contrastEstimate'] < 0.25:
        notes.append(f"Paso {e['order']} ({e['nodeId']}): contraste estimado bajo en la captura; puede perder peso en el recorrido.")
# Peso heurístico relativo (sin unidades ni porcentajes) y comparación con el orden previsto.
for e in els:
    e['weight'] = math.sqrt(max(e['area'], 1.0)) * max(e['contrastEstimate'], 0.05)
by_weight = sorted(els, key=lambda e: -e['weight'])
for rank, e in enumerate(by_weight, 1):
    e['heuristicRank'] = rank
for e in els:
    if e['order'] > 1 and e['heuristicRank'] == 1:
        notes.append(f"Paso {e['order']} ({e['nodeId']}) es el de mayor peso visual estimado: podría leerse antes que el paso 1.")

# Mapa de calor: gaussianas por elemento, atenuadas según el orden previsto (lectura secuencial).
heat = np.zeros((H, W))
yy, xx = np.mgrid[0:H, 0:W]
maxw = max(e['weight'] for e in els) if els else 1.0
for e in els:
    c = e['center']; r = e['rect']
    sx, sy = max(r['width'] / 2, 20), max(r['height'] / 2, 20)
    w = (e['weight'] / maxw) * (0.85 ** (e['order'] - 1))
    heat += w * np.exp(-(((xx - c['x']) / sx) ** 2 + ((yy - c['y']) / sy) ** 2) / 2)
if heat.max() > 0:
    heat /= heat.max()
col = np.zeros((H, W, 4), dtype=np.uint8)
col[..., 0] = 255
col[..., 1] = (140 * (1 - heat)).astype(np.uint8)
col[..., 3] = (170 * heat).astype(np.uint8)
over = Image.fromarray(col, 'RGBA').filter(ImageFilter.GaussianBlur(4))
base = Image.alpha_composite(im.convert('RGBA'), over)
d = ImageDraw.Draw(base)

def font(sz):
    try:
        return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', sz)
    except Exception:
        return ImageFont.load_default()

R = max(16, round(min(W, H) / 40))
fn = font(R)
pos = {e['order']: e['center'] for e in els}
for ar in flow['arrows']:
    p, q = pos[ar['from']], pos[ar['to']]
    d.line([(p['x'], p['y']), (q['x'], q['y'])], fill=(20, 60, 200, 255), width=max(3, R // 6))
    ang = math.atan2(q['y'] - p['y'], q['x'] - p['x'])
    tip = (q['x'] - R * math.cos(ang), q['y'] - R * math.sin(ang))
    for s in (-0.5, 0.5):
        d.line([tip, (tip[0] - R * math.cos(ang + s), tip[1] - R * math.sin(ang + s))], fill=(20, 60, 200, 255), width=max(3, R // 6))
for e in els:
    c = e['center']
    d.ellipse([c['x'] - R, c['y'] - R, c['x'] + R, c['y'] + R], fill=(20, 60, 200, 235), outline=(255, 255, 255, 255), width=3)
    t = str(e['order'])
    d.text((c['x'] - d.textlength(t, font=fn) / 2, c['y'] - R * 0.6), t, fill=(255, 255, 255, 255), font=fn)

legend = 'ESTIMACIÓN HEURÍSTICA DEL AGENTE: no es atención medida ni eye tracking (sin porcentajes). Números y flechas: recorrido previsto.'
ls = max(12, round(min(W, H) / 45))
lf = font(ls)
while ls > 12 and d.textlength(legend, font=lf) > W - 24:
    ls -= 1
    lf = font(ls)
d.rectangle([0, 0, W, ls * 2], fill=(255, 255, 255, 230))
d.text((12, ls * 0.4), legend, fill=(160, 0, 80, 255), font=lf)
base.convert('RGB').save(a.out)
if a.notes_out:
    json.dump({'disclaimer': flow['disclaimer'], 'elements': [{k: e[k] for k in ('order', 'nodeId', 'role', 'contrastEstimate', 'heuristicRank')} for e in els], 'notes': notes}, open(a.notes_out, 'w'), ensure_ascii=False, indent=1)
print(a.out)
for n in notes:
    print('  -', n)
