# DEMO pendiente de revisión humana — 1080×1080

> No es una aprobación de producción. La maestra no se modifica; el resultado es un clon en una sección de salida.

- Frame creado: ` DEMO_1080x1080 · 960x1200_Taxdown_SVA2 · pendiente de revisión humana ` (` 2009:122 `) → https://www.figma.com/design/UZgEPO8UUe9IDwTWitBbgF/?node-id=2009-122
- Sección de salida: ` 2009:121 `
- Maestra: ` 1:537 ` (960×1200)
- Zona interna de prueba: 54 px por lado — Margen de prueba de 54 px por lado. Regla interna de la demo: no hay safe zone aprobada para este destino y esto NO es una especificación oficial.
- Captura: ` runs/2026-09-30-copy-UZgE/evidence/demo-2009-122.png `
- Fuentes (nunca se sustituyen; ✗ = no cargable por el plugin en este entorno): Mutualidad Black ✗ · Mutualidad Bold ✗ · Mutualidad Regular ✗ · Rufina Bold ✓ · Rufina Regular ✓. Carga exigida por las operaciones: no (solo traslaciones de texto).

## Estado agregado: **revisión humana**

| Comprobación | Tipo | Estado | Hallazgos | Qué cubre |
|---|---|---|---|---|
| target_dimensions | deterministic | superada | — | Ancho/alto exactos del frame destino y recorte activo. |
| nodes_preserved | deterministic | superada | — | Mismo conjunto de nodos, tipos, nombres, padres y orden de apilado (por correspondencia de la relectura). |
| content_preserved | deterministic | superada | — | Igualdad exacta de caracteres, segmentos de estilo (fuente, cuerpo, interlineado, color), pinturas, efectos, visibilidad, opacidad, máscaras y geometría vectorial. No evalúa el render. |
| allowed_operations | deterministic | superada | — | Posición de cada caja respecto al plan (±0.01 px), tamaño exacto de todo lo que solo se traslada y parte lineal exacta de cada transformación. |
| logo_locked | deterministic | superada | — | Ancho/alto exactos, transformaciones lineales exactas, recorte y posición de cada nodo respecto al bloque del logo. El render del logo lo confirma la captura. |
| demo_safe_area | deterministic | superada | — | Cajas completas de los elementos importantes dentro del frame y del margen interno de 54 px (regla interna de demo). Las cajas de texto no prueban ausencia de truncamiento visual. |
| background_coverage | deterministic | superada | — | Cobertura por cajas del ancho y del borde inferior; regiones protegidas (declaradas por el agente) completas y sin cajas de texto encima. No mide píxeles. |
| master_unchanged | deterministic | superada | — | Hash exacto de cada registro de la maestra releída tras escribir frente al payload del inventario. |
| visual_agent_review | visual | revisión humana | DECORATION_CUT_BY_MASK_EDGE 1:548,1:547,2009:135,2009:134; BODY_TEXT_HIGHER_ON_SUBJECT 1:549,2009:136; PHOTO_BOTTOM_CROPPED 1:539,2009:126; FONT_NOT_LOADABLE_IN_ENV 2009:138,2009:139,2009:158,2009:159 | Inspección visual del agente sobre una captura del clon. No sustituye la revisión de la diseñadora. |

## Operaciones aplicadas al clon

- Traslación rígida ` logo ` (` 1:553 `): Mismo margen izquierdo que la maestra (90); sube 26 px para ganar altura.
- Traslación rígida ` message ` (` 1:571 `, ` 1:572 `): Titular + importe como bloque rígido; +60 px en x conserva su posición respecto al eje central (960→1080); 36 px bajo el logo (65 en la maestra).
- Traslación rígida ` photo ` (` 1:539 `, ` 1:542 `): Foto y grupo de la cinta+máscara juntos (la máscara está alineada con la foto). x=-1 para no dejar franja a la izquierda; queda 7 px bajo el importe como en la maestra; se recortan 65 px del pie de la foto.
- Traslación rígida ` bottom ` (` 1:549 `, ` 1:550 `, ` 1:552 `, ` 1:540 `): Oferta, CTA, información complementaria y su sombra de legibilidad como bloque rígido (separaciones de la maestra); +60 px en x (constraints CENTER); el pie queda 2 px por encima del margen de 54.
- Redimensionado de efecto ` 1:541 `: El degradado de oscurecimiento (975 px) no cubre 1080 px de ancho: se ensancha sin cambiar su altura ni su perfil vertical y se ancla al borde inferior.
- Frame raíz: 960×1200 → 1080×1080 con resizeWithoutConstraints (sin escalar hijos).

## Decisiones para la diseñadora

- Corte vertical de la cinta rosa (borde de su máscara) arriba a la derecha: ¿aceptable, o ampliar la máscara / mover la cinta (operaciones que la demo no se permite)?
- Oferta (1:549) más alta sobre la persona que en la maestra: ¿aceptable o prefieres reducir otros espacios?
- Recorte de 65 px del pie de la foto.
- Ensanchado del degradado de oscurecimiento 1:541 (975 → 1110 px, efecto no-contenido).
- Información complementaria desplazada +60 px (constraint CENTER de la maestra) en lugar de quedarse alineada a la izquierda con el margen de 56 px.
- Roles propuestos por el agente: 1:549 como body (tú lo describiste como texto principal), 1:572 como price, 1:552 como legal.
- 1:555 (imagen totalmente recortada dentro del contenedor del logo): conservada; decidir qué es.
