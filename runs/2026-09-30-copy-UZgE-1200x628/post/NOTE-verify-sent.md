# Nota sobre verify-sent de `master-digests` (post)

`verify-sent --request pre/master-digests-request.json --calls post/calls-master-digests.json` informa 0/1 idénticos.
La única diferencia es el salto de línea final: el SHA-256 del código generado sin el `\n` final
(`dc69f875…341c`) coincide exactamente con el SHA del script enviado. Comprobado con:

    python3 -c "import json,hashlib;c=json.load(open('pre/master-digests-request.json'))['code'];print(hashlib.sha256(c.rstrip('\n').encode()).hexdigest())"

El resultado (payload `sha256:c0f17a13…0689`, 36 nodos, `digests-compare` equal=true) confirma que la maestra 1:537
no cambió tras crear y parchear el clon 2048:121.
