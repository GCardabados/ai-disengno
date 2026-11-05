# Emails desde bloques y plantillas del cliente

Modo para clientes que ya tienen en Figma un **sistema de bloques** (componentes) y **plantillas** construidos a partir
de sus emails aprobados. El email no se diseña desde cero: se **monta con instancias** de esos bloques y se rellenan
los huecos con el brief. Primer cliente con catálogo: AXA (`client-knowledge/clients/axa/channels/email-blocks.json`).

## Piezas

| Pieza | Dónde | Qué es |
|---|---|---|
| Catálogo `ck.email-blocks.v1` | `client-knowledge/clients/<slug>/channels/email-blocks.json` | Bloques (id de componente/variantes, huecos con rol y ejemplo, tipo fijo/variable), plantillas (secuencias de bloques), opciones (idioma, canal, legal), fuentes sustitutas y pendientes. Lo valida `knowledge-check`. |
| Bloques y plantillas en Figma | `figma.pageId` / `blocksSection` / `templatesSection` del catálogo; cada plantilla con su frame (`templates[].figmaId`) y cada bloque con su componente (`nodeId`). `knowledge-context` los resume con enlaces en `emailBlocks` | Componentes con huecos `slot:<rol>_<n>`. Las plantillas son frames de instancias, solo de referencia visual. |
| Brief `pcb.email-template-brief.v1` | `R/brief.json` | Cliente, intención, asunto, preheader, idioma, canal, legal, composición (`{template}` o `{blocks[]}`) y contenido por posición (`slots`, `images`, `links`, `hide`, `omit`). Contrato: `src/contracts/email-template.ts`. |
| Compositor guiado | `scripts/email-composer.py` + `email-composer.template.html` | Página web autocontenida: plantillas, bloques vacíos con miniatura, añadir/ordenar/quitar, variantes de footer y cierre, vista previa y el **esqueleto del brief** con `[PENDIENTE: …]` en cada hueco. No escribe en Figma. |

## Bloques fijos y variables

- **Fijo**: misma estructura y mismo contenido (mediador, cierre, valoración, footer, legal). Solo cambia por
  **variante** (idioma, canal, tipo de footer, entidad legal), que se resuelve sola desde el brief.
- **Variable**: misma estructura, distinto copy o imagen. Cada hueco es `slot:<rol>_<n>` (`titulo`, `texto`,
  `destacado`, `cta`, `nota`, `imagen`, `notas`…). Un hueco no usado se oculta con `hide`; un bloque entero, con `omit`.
- **Canal** (p. ej. AXA): `axa` fija `Canal=AXA` en el mediador, `directo` lo oculta, `racc` usa `Canal=RACC` y solo
  existe en castellano. Lo declara `options.canal` del catálogo; no se deduce.
- El cierre con texto propio usa la variante `Idioma=Personalizado` (por composición o porque el brief le da copy).

## Las tres formas de elegir la estructura

1. **Plantilla predefinida**: `composition: { "template": "<key>" }` (`email-template-list --client C`).
2. **Compositor guiado**: la persona elige plantilla o compone con los bloques vacíos y copia el brief generado.
   Generarlo: `python3 <PCB>/scripts/email-composer.py --catalog <catálogo> --out R/compositor.html` y publicarlo
   (Artifact) o abrirlo en local. Miniaturas: `thumbsDir` del catálogo (AXA: `assets/email-blocks/`, un
   `<componentId con _>.jpg` por variante, sacado con `get_screenshot` del componente); `--thumbs DIR` la sustituye.
   Sin miniatura la tarjeta sale vacía; el resto funciona.
3. **Manual en Figma**: la persona arma el email con instancias de los bloques. La skill no lo regenera: revisa con
   `get_metadata`/`get_screenshot` y, si se quiere rellenar con el script, se transcribe la secuencia a
   `composition: { "blocks": [...] }`.

## Flujo

1. `email-template-list --client C` → plantillas, bloques y opciones.
2. Brief (de la plantilla, del compositor o escrito a mano) en `R/brief.json`. Copys con origen; los que faltan,
   `[PENDIENTE: …]` con `source: placeholder`. No se inventan datos comerciales ni legales.
3. `email-template-check --brief R/brief.json --out R/resumen.md` (0 listo, 4 faltan copys/imágenes/confirmación,
   2 inválido). Bloquea: plantilla/bloque/hueco/variante inexistente, canal no disponible en ese idioma, copy igual al
   texto de ejemplo del bloque, placeholder sin marcar, borrador con datos comerciales sin fuente. Lista como aviso los
   textos que siguen `[PENDIENTE]`.
4. Punto de validación con la persona → `email-template-confirm --brief … --by NOMBRE --note "<lo que dijo>"`.
5. `email-template-request --brief … --out R/request.json` → enviar `code` **tal cual** con `use_figma`. Crea un frame
   nuevo en la sección `figma.sectionName` con instancias de los bloques, rellena textos (negritas `**…**`), copia
   imágenes desde el nodo indicado, oculta huecos, anota pendientes y añade un frame con asunto/preheader/notas.
   Nada existente se modifica; si falla, borra solo lo suyo.
6. Guardar la respuesta original en `R/result.txt` → `email-template-verify --brief … --result R/result.txt`: cada hueco
   con su texto exacto (hash), visibilidad según canal, imágenes colocadas y sin textos de ejemplo.
7. `get_screenshot` del email y entrega como en el modo general (§7 del SKILL).

## Límites conocidos

- **Fuentes**: `use_figma` solo carga Google Fonts, Apple y las subidas a la org del archivo. Las fuentes del cliente
  no disponibles se sustituyen por las declaradas en `fonts` del catálogo (AXA: Arimo por Arial, Gelasio por Georgia y
  por Publico Headline). Es una decisión anotada, no una norma de marca.
- Textos en fuentes no cargables dentro de un bloque (p. ej. saludo en Tahoma) no se pueden editar por script: el
  catálogo los marca como pendientes.
- Las imágenes deben estar ya en el archivo destino (id del nodo); el script no sube imágenes.
- Catálogo en `draft`: todo lo producido es **propuesta**. Los legales son observados, no validados por el cliente.
