# Extrae del registro de la sesión las llamadas use_figma de esta iteración (por prefijo de descripción) y sus
# respuestas originales, sin transcripción manual. Uso: python3 extract.py <out_dir> <prefijo_descripción> <etiqueta>
import json, hashlib, sys, os
out, prefix, label = sys.argv[1], sys.argv[2], sys.argv[3]
f='/Users/gabrielcardaba/.claude/projects/-Users-gabrielcardaba-Documents-paid-creative-builder/76f0c8f0-e3f2-421b-bc57-58b6d8b4f7bf.jsonl'
uses=[]; results={}
for line in open(f):
    o=json.loads(line); m=o.get('message')
    if not isinstance(m,dict) or not isinstance(m.get('content'),list): continue
    for b in m['content']:
        if not isinstance(b,dict): continue
        if b.get('type')=='tool_use' and b.get('name','').endswith('use_figma') and b['input'].get('description','').startswith(prefix): uses.append(b)
        if b.get('type')=='tool_result': results[b['tool_use_id']]=b
os.makedirs(out, exist_ok=True); rows=[]
for u in uses:
    r=results.get(u['id'])
    if r is None: continue
    c=r['content']; raw = c if isinstance(c,str) else json.dumps(c, ensure_ascii=False)
    tag=f'{label}-{u["id"][-8:]}'
    open(os.path.join(out,f'raw-response-{tag}.txt'),'w',encoding='utf-8').write(raw)
    json.dump({'tool_use_id':u['id'],'input':u['input']}, open(os.path.join(out,f'tool-call-{tag}.json'),'w'), ensure_ascii=False, indent=2)
    rows.append({'toolUseId':u['id'],'scriptSha256':hashlib.sha256(u['input']['code'].encode()).hexdigest(),'raw':f'raw-response-{tag}.txt','isError':bool(r.get('is_error')),'rawBytes':len(raw.encode())})
json.dump(rows, open(os.path.join(out,f'calls-{label}.json'),'w'), indent=2)
print(json.dumps(rows, indent=1))
