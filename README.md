# paid-creative-builder

Adaptación verificable de maestras estáticas de Figma a destinos publicitarios.
Diseño y decisiones: [docs/00-auditoria-y-diseno.md](docs/00-auditoria-y-diseno.md).

**Estado:**
- **H0: cerrado.**
- **H1: implementado; primera lectura real completada** (maestra `4:142`, manifiesto borrador sin aprobar).
- **DEMO 1080×1080: creada en una copia del archivo** (clon `2009:122`), pendiente de revisión humana. En el archivo original la escritura vía MCP requiere asiento Full (ver §5.6 de la documentación).
- **T1 resuelto (2026-10-01):** `npm ci` y `npm run check` validados en Node 24.21.0 (binario oficial de nodejs.org,
  SHA-256 verificado; npm 11.19.0) y en 25.6.1.
- **Piloto compartible:** guía de inicio en [docs/03-guia-inicio.md](docs/03-guia-inicio.md), encargo en
  [plantillas/encargo.md](plantillas/encargo.md), `npm run doctor` (entorno) y `npm run ejemplo` (flujo sin Figma).
  Los resultados de `runs/` quedan fuera de Git por defecto.
- **Criterios 2026-10:** texto flexible dentro de los límites del proyecto (`textPolicy`), logo en modo estándar o
  experimental por encargo (`logoPolicy`), relación persona–mensaje y recorrido de lectura (`messagePlan`), con
  superposición de atención estimada (heurística, separada de la creatividad). Ver la skill.

Ningún comando del CLI escribe en Figma. `adapt-request` solo genera el script de escritura (DEMO) que actúa sobre un clon; lo ejecuta `use_figma` y requiere asiento Full.

## Requisitos

Node **24.21.0 LTS** (`.nvmrc` / `.node-version`). Node ejecuta el TypeScript directamente, quitando los tipos. Dependencias locales exactas con `package-lock.json`.

```bash
npm ci
```

```bash
npm run check
```

`check` ejecuta `typecheck` (`tsc --noEmit`, estricto) y las pruebas (`node --test`).

## Flujo H1

0. Si el enlace apunta a una página o sección: `discover-request` y `resolve`, que dan `entryNodeId → masterNodeId`.
1. `node src/cli.ts read-request --file-key <KEY> --node-id <MASTER> --chunk-index 0 --out …` (y cada índice hasta `chunkCount`).
2. El agente ejecuta cada `code` con `use_figma` (solo lectura) y **guarda cada respuesta original tal cual**.
3. `node src/cli.ts ingest --raw r0.txt --raw r1.txt … --file-key <KEY> --node-id <MASTER> --source mcp [--discovery d.json] --out runs/<run>`
   Ensambla los fragmentos, verifica todos los hashes, la estructura y el árbol, y calcula las huellas exactas.
4. `node src/cli.ts inventory --snapshot runs/<run>/snapshot.json --config <config> --out runs/<run>/inventory`
   Genera `manifest.draft.json`, `review.md` y `review.template.json`.
5. Una persona edita la revisión → `review-apply` → `approve --by "<nombre>"`.
   `--by` registra un **nombre declarado**; no autentica a nadie. La aprobación exige que la maestra
   y las reglas (huella de configuración) sean las mismas que en el inventario.
6. Antes de usar el manifiesto: `verify-master` con una lectura nueva.

Garantías: los SHA-256 detectan alteraciones del contenido transportado, pero **no autentican** que proceda de Figma.
La procedencia `MOCK` se conserva también después de aprobar.

Para probar sin Figma: `node src/cli.ts mock-read --fixture base --out <dir>` y el paso 3 con `--source mock` (etiquetado MOCK en todos los artefactos).

## Estructura

- `src/contracts/` — esquemas y tipos: instantánea, manifiesto, configuración, destinos y safe zones, validación.
- `src/hash/` — serialización canónica, huellas y diff de la maestra.
- `src/figma/` — script de lectura (`use_figma`), ingesta y `mock/` (MOCK).
- `src/inventory/` — clasificador heurístico con evidencia y ciclo de vida del manifiesto.
- `src/report/` — vista de revisión en Markdown con escape de datos no confiables.
- `config/example.project.json` — taxonomía **propuesta** (pendiente de aprobación).
- `references/` — material inicial, no verificado (ver auditoría).
