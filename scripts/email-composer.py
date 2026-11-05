#!/usr/bin/env python3
"""Genera el compositor guiado de emails (página HTML autocontenida) a partir del catálogo de bloques de un cliente
(client-knowledge/clients/<slug>/channels/email-blocks.json) y de las miniaturas de cada variante (<componentId>.jpg).
Uso: python3 email-composer.py --catalog RUTA [--thumbs DIR] --out compositor.html
Sin --thumbs usa `thumbsDir` del catálogo (relativa a la carpeta del cliente, la que contiene channels/).
La página no escribe en Figma: produce el brief (pcb.email-template-brief.v1) que luego usa email-template-*."""
import argparse, base64, json, os

ap = argparse.ArgumentParser()
ap.add_argument('--catalog', required=True); ap.add_argument('--thumbs'); ap.add_argument('--out', required=True)
a = ap.parse_args()
cat = json.load(open(a.catalog, encoding='utf-8'))
tdir = a.thumbs or (os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(a.catalog))), cat['thumbsDir']) if cat.get('thumbsDir') else None)
if not tdir or not os.path.isdir(tdir): print(f'⚠ Sin carpeta de miniaturas ({tdir}): las tarjetas saldrán vacías')
thumbs = {}
for b in cat['blocks']:
    for v in b['variants']:
        p = os.path.join(tdir or '', v['componentId'].replace(':', '_') + '.jpg')
        if os.path.exists(p): thumbs[v['componentId']] = 'data:image/jpeg;base64,' + base64.b64encode(open(p, 'rb').read()).decode()
data = {k: cat[k] for k in ('client', 'version', 'status', 'figma', 'options', 'blocks', 'templates', 'pending')}
html = open(os.path.join(os.path.dirname(__file__), 'email-composer.template.html'), encoding='utf-8').read()
html = html.replace('/*__CATALOG__*/null', json.dumps(data, ensure_ascii=False)).replace('/*__THUMBS__*/null', json.dumps(thumbs))
open(a.out, 'w', encoding='utf-8').write(html)
print(f'✓ {a.out} ({len(html)//1024} KB, {len(thumbs)} miniaturas)')
