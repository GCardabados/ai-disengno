# paid-creative-builder

Adaptación verificable de maestras estáticas de Figma a destinos publicitarios.
Diseño y decisiones: [docs/00-auditoria-y-diseno.md](docs/00-auditoria-y-diseno.md).

**Estado: H0 mínimo + H1.** Solo lectura e inventario. Ningún comando escribe en Figma.
La lectura real **no se ha ejecutado todavía**: todo lo probado es MOCK o funciones puras.

## Requisitos

Node ≥ 23.6 (ejecuta TypeScript de forma nativa). Sin dependencias instaladas; la comprobación de tipos (`tsc`) está pendiente de autorizar.

```bash
npm test
```

## Flujo H1

1. `node src/cli.ts read-request --file-key <KEY> --node-id <ID> --out runs/<run>/read-request.json`
2. El agente ejecuta `code` con la herramienta `use_figma` (solo lectura) y **guarda la respuesta original tal cual** en `runs/<run>/raw-response.txt`.
3. `node src/cli.ts ingest --raw runs/<run>/raw-response.txt --file-key <KEY> --node-id <ID> --source mcp --out runs/<run>`
   Verifica el digest calculado dentro de Figma, la estructura y el árbol, y calcula las huellas.
4. `node src/cli.ts inventory --snapshot runs/<run>/snapshot.json --config <config> --out runs/<run>/inventory`
   Genera `manifest.draft.json`, `review.md` y `review.template.json`.
5. Una persona edita la revisión → `review-apply` → `approve --by "<nombre>"`.
6. Antes de usar el manifiesto: `verify-master` con una lectura nueva.

Para probar sin Figma: `node src/cli.ts mock-read --fixture base --out <dir>` y el paso 3 con `--source mock` (etiquetado MOCK en todos los artefactos).

## Estructura

- `src/contracts/` — esquemas y tipos: instantánea, manifiesto, configuración, destinos y safe zones, validación.
- `src/hash/` — serialización canónica, huellas y diff de la maestra.
- `src/figma/` — script de lectura (`use_figma`), ingesta y `mock/` (MOCK).
- `src/inventory/` — clasificador heurístico con evidencia y ciclo de vida del manifiesto.
- `src/report/` — vista de revisión en Markdown con escape de datos no confiables.
- `config/example.project.json` — taxonomía **propuesta** (pendiente de aprobación).
- `references/` — material inicial, no verificado (ver auditoría).
