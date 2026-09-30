# DEMO 1080×1080 — procedimiento para repetir la adaptación

Estado del resultado: **DEMO pendiente de revisión humana** (no es aprobación de producción).
Las rutas `runs/…` contienen evidencia y datos de la pieza; el código está en `src/`.

Cada llamada a Figma se hace con `use_figma` enviando **exactamente** el `code` del JSON que genera el CLI, y cada
respuesta original se guarda sin transcribir (`runs/*/extract.py` la extrae del registro de la sesión y verifica que
el SHA-256 del script enviado coincide con el generado).

## 0. Requisitos

- Node 24.21.0 (T1 pendiente: validado solo en 25.6.1), `npm ci`, `npm run check`.
- Asiento **Full** en el archivo de Figma donde se escribe (con View/Dev el MCP rechaza la escritura).

## 1. Localizar la maestra (solo lectura)

```
node src/cli.ts discover-request --file-key K --entry-node-id ENTRADA --target-name "960x1200_Taxdown_SVA2" --out R/discover/request.json
# use_figma → guardar respuesta
node src/cli.ts resolve --raw R/discover/raw-response-….txt --file-key K --entry-node-id ENTRADA --target-name "…" --out R/discover/discovery.json
```

## 2. Leer la maestra por fragmentos (solo lectura)

```
for i in 0 1 2 3 4 5; do node src/cli.ts read-request --file-key K --node-id MAESTRA --chunk-index $i --out R/read/read-request-$i.json; done
# use_figma × N (el fragmento 0 indica chunkCount) → guardar respuestas
node src/cli.ts ingest --raw … (una por fragmento) --file-key K --node-id MAESTRA --source mcp --discovery R/discover/discovery.json --out R/ingest
node src/cli.ts inventory --snapshot R/ingest/snapshot.json --config config/example.project.json --out R/inventory
```

Si la maestra es una copia de otra ya inventariada, comparar sin IDs (`runs/2026-09-30-copy-UZgE/compare.ts`) y
traducir composición y propuestas por correspondencia en preorden.

## 3. Propuestas del agente (roles y agrupaciones)

```
node src/cli.ts proposals-check --manifest R/inventory/manifest.draft.json --proposals R/agent-proposals.json --config config/example.project.json
```

## 4. Plan y escritura sobre un clon

```
node src/cli.ts demo-plan --snapshot R/ingest/snapshot.json --composition R/composition.json --out R/plan.json
# Primera vez (crea sección de salida + clon):
node src/cli.ts adapt-request --plan R/plan.json --composition R/composition.json --file-key K --clone-name "DEMO_1080x1080 · … · pendiente de revisión humana" --out R/adapt-request.json
# Actualizar un clon existente SIN duplicar la salida (solo ediciones vectoriales de decoración):
node src/cli.ts adapt-request … --mode patch --existing-clone-id CLON --out R/patch-request.json
```

Antes de un `patch`: comprobar que nadie tocó el clon desde la última relectura:

```
node src/cli.ts read-request --file-key K --node-id CLON --mode node-digests --out R/clone-digests-request.json
# use_figma → guardar
node src/cli.ts digests-compare --master-raw (fragmentos de la última relectura del clon)… --digests R/raw-response-clone-digests-….txt
```

Si difiere: **no** aplicar el patch; conservar los cambios manuales e informar. El propio script también se detiene
si un vértice no está ni en su posición `from` ni en su destino (`PCB_VERTEX_UNEXPECTED`).

## 5. Verificación

```
node src/cli.ts vector-probe-request --file-key K --frame-id CLON --node-id … --out R/probe-request.json   # antes y después
# relectura del clon por fragmentos (paso 2 con --node-id CLON) + node-digests de la maestra
node src/cli.ts demo-check --snapshot R/ingest/snapshot.json --clone-snapshot R/clone-ingest/snapshot.json \
  --adapt-result R/adapt-result….json --plan R/plan.json --composition R/composition.json --config config/example.project.json \
  --master-raw (fragmentos de la maestra)… --digests R/raw-response-master-digests-….txt \
  --vector-before … --vector-after … --visual R/visual-review.json --meta R/report-meta.json --out R/check
```

`get_screenshot` del clon → revisión visual → `visual-review.json` (solo puede empeorar el estado).

## 6. Qué es específico de esta pieza y qué es reutilizable

| Específico de la pieza (datos en `runs/…/composition.json` y `agent-proposals.json`) | Reutilizable (código en `src/`) |
|---|---|
| Bloques rígidos y sus destinos (logo, titular+importe, foto+cinta+máscara, bloque inferior) | Descubrimiento, lectura por fragmentos, ingesta, huellas y hashes por nodo |
| Ensanche del degradado 1:541 (975→1110) | Inventario, clasificador, propuestas del agente y su validación |
| Ediciones vectoriales de la cinta 1:548 y de su máscara 1:547 (vértices/tiradores en coordenadas del destino) | Contrato de composición y plan: traslaciones rígidas, efectos, ediciones vectoriales con guardas |
| Región protegida de la cara (foto 1:539) y margen de prueba de 54 px | Script de escritura create/patch: solo clon, sin sustituir fuentes, todo o nada, idempotente |
| Roles propuestos (p. ej. 1:552 como información complementaria) | Validadores deterministas, sonda vectorial, informe |

Lo específico es DATO revisable; ninguna regla de la pieza está codificada en `src/`.
