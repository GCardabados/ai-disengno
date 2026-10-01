# Nota sobre verify-sent de las sondas vectoriales

`verify-sent` informa 0/1 en `post/calls-probe-after.json`, `pre/calls-v1-probe.json` y `pre/calls-master-probe.json`.
En los tres casos la única diferencia es el salto de línea final: el SHA-256 del código generado sin el `\n` final
coincide exactamente con el del script enviado (comprobado con `hashlib.sha256(code.rstrip('\n'))`). El resto de las
llamadas de esta ejecución coinciden byte a byte.
