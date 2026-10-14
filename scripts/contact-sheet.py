#!/usr/bin/env python3
"""Hoja de contacto de una tanda de variantes (solo en local; nunca se escribe en Figma).

Uso:
  python3 scripts/contact-sheet.py --image "Maestra=evidence/maestra.png" --image "Medicina · Sevilla=evidence/medicina-sevilla.png" \
      [--columns 3] [--thumb 360] --out evidence/hoja-contacto.png

Coloca las capturas en una cuadrícula con su etiqueta debajo, a la misma escala, para revisar la consistencia entre
variantes (encuadre, legibilidad, contraste). Las etiquetas son las que se pasan; no se lee nada de la imagen.
"""
import argparse
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('--image', action='append', required=True, help='ETIQUETA=RUTA (en orden)')
ap.add_argument('--columns', type=int, default=3)
ap.add_argument('--thumb', type=int, default=360, help='lado mayor de cada miniatura en px')
ap.add_argument('--out', required=True)
a = ap.parse_args()

items = []
for spec in a.image:
    if '=' not in spec:
        raise SystemExit(f'Formato esperado ETIQUETA=RUTA: {spec}')
    label, path = spec.split('=', 1)
    im = Image.open(path).convert('RGB')
    im.thumbnail((a.thumb, a.thumb))
    items.append((label, im))

pad, label_h = 24, 36
cols = max(1, min(a.columns, len(items)))
rows = (len(items) + cols - 1) // cols
W = cols * (a.thumb + pad) + pad
H = rows * (a.thumb + label_h + pad) + pad
sheet = Image.new('RGB', (W, H), (245, 245, 245))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('Arial.ttf', 18)
except OSError:
    font = ImageFont.load_default()
for i, (label, im) in enumerate(items):
    r, c = divmod(i, cols)
    x = pad + c * (a.thumb + pad)
    y = pad + r * (a.thumb + label_h + pad)
    sheet.paste(im, (x + (a.thumb - im.width) // 2, y + (a.thumb - im.height) // 2))
    d.rectangle([x - 1, y - 1, x + a.thumb, y + a.thumb], outline=(200, 200, 200))
    d.text((x, y + a.thumb + 8), label, fill=(30, 30, 30), font=font)
sheet.save(a.out)
print(f'{len(items)} pieza(s) → {a.out}')
