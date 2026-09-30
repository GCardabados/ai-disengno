# Extrae del registro de la sesión las llamadas use_figma de lectura v3 sobre 4:142 y sus respuestas originales,
# sin transcripción manual. Uso: python3 extract.py <run_dir> <attempt> <first_tool_use_id_exclusive|->
import json, hashlib, sys, os, re
run, attempt, after = sys.argv[1], sys.argv[2], sys.argv[3]
SCRIPT_TAG = sys.argv[4] if len(sys.argv) > 4 else 'pcb.read-script.v3'
f='/Users/gabrielcardaba/.claude/projects/-Users-gabrielcardaba-Documents-paid-creative-builder/76f0c8f0-e3f2-421b-bc57-58b6d8b4f7bf.jsonl'
uses=[]; results={}
for line in open(f):
    o=json.loads(line); m=o.get('message')
    if not isinstance(m,dict) or not isinstance(m.get('content'),list): continue
    for b in m['content']:
        if not isinstance(b,dict): continue
        if b.get('type')=='tool_use' and b.get('name','').endswith('use_figma') and SCRIPT_TAG in b['input'].get('code','') and 'var MODE = "chunk"' in b['input']['code'] and '"4:142"' in b['input']['code']:
            uses.append(b)
        if b.get('type')=='tool_result': results[b['tool_use_id']]=b
ids=[u['id'] for u in uses]
if after!='-': uses=uses[ids.index(after)+1:]
out=os.path.join(run, f'attempt-{attempt}'); os.makedirs(out, exist_ok=True)
rows=[]
for u in uses:
    code=u['input']['code']; idx=int(re.search(r'var CHUNK_INDEX = (\d+);', code).group(1))
    r=results.get(u['id'])
    if r is None: continue
    c=r['content']; raw = c if isinstance(c,str) else json.dumps(c, ensure_ascii=False)
    p=os.path.join(out, f'raw-response-chunk{idx}-{u["id"][-8:]}.txt')
    open(p,'w',encoding='utf-8').write(raw)
    json.dump({'tool_use_id':u['id'],'input':u['input']}, open(p.replace('raw-response','tool-call').replace('.txt','.json'),'w'), ensure_ascii=False, indent=2)
    rows.append({'toolUseId':u['id'],'chunkIndex':idx,'scriptSha256':hashlib.sha256(code.encode()).hexdigest(),'rawPath':p,'rawBytes':len(raw.encode()),'isError':bool(r.get('is_error'))})
json.dump(rows, open(os.path.join(out,'calls.json'),'w'), indent=2)
print(json.dumps(rows, indent=1))
