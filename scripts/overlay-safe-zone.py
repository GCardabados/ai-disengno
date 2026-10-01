#!/usr/bin/env python3
"""Superpone la safe zone de una composición sobre la captura del clon (solo en local; la guía nunca va a Figma).

Uso:
  python3 scripts/overlay-safe-zone.py --screenshot CAPTURA.png --composition composition.json --out CAPTURA-overlay.png

Dibuja: borde del frame (magenta), zona permitida (verde), exclusiones (rojo translúcido) y una leyenda con la
procedencia. Con `internal_demo_rule` y margen 0 lo indica como «sin safe zone». La captura debe tener el tamaño del
destino (get_screenshot con maxDimension = lado mayor del destino).
"""
import argparse, json
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('--screenshot', required=True)
ap.add_argument('--composition', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()

comp = json.load(open(a.composition))
im = Image.open(a.screenshot).convert('RGBA')
W, H = comp['target']['width'], comp['target']['height']
if im.size != (W, H):
    raise SystemExit(f'La captura mide {im.size[0]}×{im.size[1]} y el destino {W}×{H}: pide la captura a tamaño real.')
sa = comp['safeArea']
ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
d = ImageDraw.Draw(ov)
d.rectangle([0, 0, W - 1, H - 1], outline=(220, 0, 120, 255), width=6)
if sa['kind'] == 'safe_zone_rule':
    r = sa['allowed']
    d.rectangle([r['x'], r['y'], r['x'] + r['width'], r['y'] + r['height']], outline=(0, 170, 60, 255), width=4)
    for ex in sa.get('exclusions', []):
        q = ex['rect']
        d.rectangle([q['x'], q['y'], q['x'] + q['width'], q['y'] + q['height']], fill=(230, 0, 0, 70), outline=(230, 0, 0, 200), width=2)
    legend = f"Safe zone: {sa['ruleId']} ({sa['provenance']}). Verde: permitido · Rojo: exclusiones · Magenta: frame."
elif sa['marginPx'] > 0:
    m = sa['marginPx']
    d.rectangle([m, m, W - m, H - m], outline=(0, 170, 60, 255), width=4)
    legend = f"Margen interno de prueba de {m} px (no es una especificación). Magenta: frame."
else:
    legend = 'Sin safe zone aplicada (no hay plantilla dedicada o el encargo lo indica). Magenta: límite del frame.'
def load(sz):
    try:
        return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', sz)
    except Exception:
        return ImageFont.load_default()
size = max(12, round(min(W, H) / 40))
font = load(size)
while size > 12 and d.textlength(legend, font=font) > W - 24:
    size -= 1
    font = load(size)
d.rectangle([0, H - size * 2, W, H], fill=(255, 255, 255, 225))
d.text((12, H - size * 1.6), legend, fill=(180, 0, 90, 255), font=font)
Image.alpha_composite(im, ov).convert('RGB').save(a.out)
print(a.out)
