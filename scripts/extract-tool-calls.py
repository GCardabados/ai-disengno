#!/usr/bin/env python3
"""Extrae del registro de una sesión de Claude Code las llamadas use_figma y sus respuestas ORIGINALES, sin
transcripción manual. Cada llamada se guarda como tool-call-<label>-<id>.json (entrada exacta) y
raw-response-<label>-<id>.txt (respuesta tal cual), más calls-<label>.json con el SHA-256 del script enviado.

Uso:
  python3 scripts/extract-tool-calls.py --out DIR --prefix "PCB read-only inventory of FRAME 1:537" --label chunk \
      [--transcript RUTA.jsonl] [--set-id set_xxxxxxxxxxxxxxxx] [--last N]

--prefix   selecciona por el inicio de la 'description' de la llamada (la genera el CLI).
--set-id   conserva solo respuestas que contienen ese conjunto de fragmentos (descarta lecturas anteriores).
--last N   conserva solo las N últimas llamadas que coinciden.
Por defecto usa el registro .jsonl más reciente del proyecto actual.
"""
import argparse, glob, hashlib, json, os

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--prefix', required=True)
ap.add_argument('--label', required=True)
ap.add_argument('--transcript')
ap.add_argument('--set-id')
ap.add_argument('--last', type=int)
a = ap.parse_args()

if a.transcript:
    path = a.transcript
else:
    proj = os.path.expanduser('~/.claude/projects/' + os.getcwd().replace('/', '-'))
    files = sorted(glob.glob(os.path.join(proj, '*.jsonl')), key=os.path.getmtime)
    if not files:
        raise SystemExit(f'No hay registros de sesión en {proj}')
    path = files[-1]

uses, results = [], {}
for line in open(path, encoding='utf-8'):
    o = json.loads(line)
    m = o.get('message')
    if not isinstance(m, dict) or not isinstance(m.get('content'), list):
        continue
    for b in m['content']:
        if not isinstance(b, dict):
            continue
        if b.get('type') == 'tool_use' and b.get('name', '').endswith('use_figma') and b['input'].get('description', '').startswith(a.prefix):
            uses.append(b)
        if b.get('type') == 'tool_result':
            results[b['tool_use_id']] = b

if a.last:
    uses = uses[-a.last:]
os.makedirs(a.out, exist_ok=True)
rows = []
for u in uses:
    r = results.get(u['id'])
    if r is None:
        continue
    c = r['content']
    raw = c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)
    if a.set_id and a.set_id not in raw:
        continue
    tag = f'{a.label}-{u["id"][-8:]}'
    open(os.path.join(a.out, f'raw-response-{tag}.txt'), 'w', encoding='utf-8').write(raw)
    json.dump({'tool_use_id': u['id'], 'input': u['input']}, open(os.path.join(a.out, f'tool-call-{tag}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    rows.append({'toolUseId': u['id'], 'scriptSha256': hashlib.sha256(u['input']['code'].encode()).hexdigest(),
                 'raw': f'raw-response-{tag}.txt', 'isError': bool(r.get('is_error')), 'rawBytes': len(raw.encode())})
json.dump({'transcript': os.path.basename(path), 'calls': rows}, open(os.path.join(a.out, f'calls-{a.label}.json'), 'w'), indent=2)
print(json.dumps(rows, indent=1))
