# DEMO pendiente de revisión humana — 1200×628

> No es una aprobación de producción. La maestra no se modifica; el resultado es un clon en una sección de salida.

- Frame creado: ` DEMO_1200x628_v2 · 960x1200_Taxdown_SVA2 · pendiente de revisión humana ` (` 2075:121 `) → https://www.figma.com/design/UZgEPO8UUe9IDwTWitBbgF/?node-id=2075-121
- Sección de salida: ` 2009:121 `
- Maestra: ` 1:537 ` (960×1200)
- Zona segura: margen de prueba de 54 px por lado (regla interna de esta ejecución, no especificación) — Margen de 54 px declarado SOLO para esta prueba interna 1200×628; no es especificación oficial ni valor general.
- Captura: ` runs/2026-10-01-copy-UZgE-1200x628-v2/evidence/demo-2075-121-v2.png `
- Fuentes (nunca se sustituyen; ✗ = no cargable por el plugin en este entorno): Mutualidad Black ✗ · Mutualidad Bold ✗ · Mutualidad Regular ✗ · Rufina Bold ✓ · Rufina Regular ✓. Carga exigida por las operaciones: no (solo traslaciones de texto).

## Estado agregado: **revisión humana**

| Comprobación | Tipo | Estado | Hallazgos | Qué cubre |
|---|---|---|---|---|
| target_dimensions | deterministic | superada | — | Ancho/alto exactos del frame destino y recorte activo. |
| nodes_preserved | deterministic | superada | — | Mismo conjunto de nodos, tipos, nombres, padres y orden de apilado (por correspondencia de la relectura). |
| content_preserved | deterministic | superada | — | Igualdad exacta de caracteres, segmentos de estilo (fuente, cuerpo, interlineado, color), pinturas, efectos, visibilidad, opacidad, máscaras y geometría vectorial. No evalúa el render. |
| allowed_operations | deterministic | superada | — | Posición de cada caja respecto al plan (±0.01 px), tamaño exacto de todo lo que solo se traslada, factor único en ancho y alto de las imágenes escaladas y parte lineal exacta de cada transformación. |
| logo_locked | deterministic | superada | — | Ancho/alto exactos, transformaciones lineales exactas, recorte y posición de cada nodo respecto al bloque del logo. El render del logo lo confirma la captura. |
| demo_safe_area | deterministic | superada | — | Cajas completas de los elementos importantes dentro del frame y de la zona segura: margen de prueba de 54 px por lado (regla interna de esta ejecución, no especificación) — Margen de 54 px declarado SOLO para esta prueba interna 1200×628; no es especificación oficial ni valor general.. Las cajas de texto no prueban ausencia de truncamiento visual. |
| background_coverage | deterministic | superada | — | Cobertura por cajas del ancho y del borde inferior; regiones protegidas (declaradas por el agente) completas y sin cajas de texto encima. No mide píxeles. |
| vector_edits | deterministic | superada | — | Vértices y tiradores editados en su destino (±0,5 px), todos los demás de ese vector sin cambios (±0,05 px), en coordenadas del frame; misma topología; grosor de trazo declarado. |
| layout_order_and_cta | deterministic | superada | — | Por cajas de render (±1 px): cada elemento del orden de lectura queda debajo o a la derecha del anterior sin empezar por encima; el CTA centrado bajo su bloque de copy y separado de él sin compartir franja. No evalúa jerarquía visual. |
| decoration_masks | deterministic | superada | — | Cada forma de la máscara de decoración tiene superficie dentro del frame y solapa la caja de render de la decoración (por cajas, no por píxeles: la continuidad visual de la cinta la juzga la captura). |
| effective_visibility | deterministic | superada | — | Contenido importante visible (sin ocultar, opacidad acumulada 1), con render dentro del frame y sin formas opacas pintadas encima (por cajas). El contraste y la legibilidad los juzga la captura. |
| master_unchanged | deterministic | superada | — | Hash exacto de cada registro de la maestra releída tras escribir frente al payload del inventario. |
| visual_agent_review | visual | revisión humana | READING_ORDER_OK_VISUALLY 1:571,1:572,1:549,1:550; PRICE_LEFT_ALIGNED 1:572,1:571; RIBBON_CONTINUOUS 1:548,1:543; RIBBON_THINNER 1:548; PHOTO_SMALLER 1:539; CLEARANCE_LIMITED_BY_ASSET 1:571,1:539; FACE_CLOSE_TO_OFFER 1:539,1:549; WHITE_OFFER_OVER_SHIRT 1:549; LEFT_EDGE_INTEGRATED 1:539,1:541,1:540; FONT_NOT_LOADABLE_IN_ENV 2075:137,2075:138,2075:157,2075:158 | Inspección visual del agente sobre una captura del clon. No sustituye la revisión de la diseñadora. |

## Operaciones aplicadas al clon

- Traslación rígida ` logo ` (` 1:553 `): Arriba a la izquierda, sin cambios de tamaño ni disposición interna.
- Traslación rígida ` headline ` (` 1:571 `): Elemento dominante en la columna izquierda, 6 px más arriba que en la v1 para dejar sitio al bloque oferta+CTA.
- Traslación rígida ` price ` (` 1:572 `): Cierra el mensaje bajo el titular, alineado a su borde izquierdo (no centrado: centrado chocaría con la oferta, que necesita la franja derecha). Su línea superior coincide con la de la oferta.
- Traslación rígida ` offer ` (` 1:549 `, ` 1:540 `): Oferta a la derecha, después del mensaje; con su sombra de legibilidad en la misma relación que en la maestra. Empieza justo bajo la región protegida de la cara.
- Traslación rígida ` cta ` (` 1:550 `): «Saber más» después de la oferta, centrado bajo ella (centro de su render) y separado ~21 px; su borde inferior en la zona de prueba.
- Traslación rígida ` info ` (` 1:552 `): Pie informativo abajo a la izquierda.
- Redimensionado de efecto ` 1:541 `: Degradado oscuro a todo el ancho; empieza bajo la cara para oscurecer la oferta y el CTA en la misma proporción que en la maestra.
- Redimensionado de efecto ` 1:544 `: Forma rectangular de la máscara: zona por delante del brazo izquierdo por donde baja la cinta. Su borde derecho es el de la maestra escalado con la foto (x=914,8, en el pelo).
- Edición vectorial (máscara de decoración) ` 1:545 `: 12 vértice(s), 24 tirador(es). Forma de máscara del hueco de fondo bajo el brazo derecho: su contorno sigue el hueco real del recorte (canal alfa del activo, escala ×0,6, 12 vértices como en la maestra) para que la cinta asome por todo el hueco sin tramos ocultos sobre fondo.
- Edición vectorial (máscara de decoración) ` 1:546 `: 6 vértice(s), 14 tirador(es). Borde del pelo donde la cinta pasa por detrás de la cabeza: misma forma de la maestra, escalada con la foto (×0,6).
- Edición vectorial (máscara de decoración) ` 1:547 `: 13 vértice(s), 26 tirador(es). Región visible a la derecha del brazo derecho (contorno exterior del brazo medido en el activo) por encima de la oferta, y zona libre sobre la persona donde discurre el bucle superior de la cinta. Mismos 13 vértices que en la maestra.
- Edición vectorial (decoración) ` 1:548 `: 7 vértice(s), 12 tirador(es). Cinta rediseñada para el formato horizontal: entra por el borde derecho alto, rodea por encima la cabeza, baja por delante del brazo izquierdo, pasa por detrás de la cabeza, asoma por el hueco bajo el brazo derecho, pasa por detrás de ese brazo y sale por el borde derecho por encima de la oferta (sin invadir texto). El tramo de la maestra junto al pelo se conserva escalado con la foto (×0,6, también el grosor).
- Frame raíz: 960×1200 → 1200×628 con resizeWithoutConstraints (sin escalar hijos).

## Decisiones para la diseñadora

- «desde 60 €» alineado a la izquierda bajo el titular, compartiendo línea superior con la oferta: ¿aceptable o prefieres otra solución (p. ej. reducir algún texto, que hoy no está permitido)?
- Escala de la foto ×0,6 apoyada abajo: separación titular–brazo ~35 px y codo derecho a ~33 px del borde, limitadas por el corte del recorte en la cintura. Más aire exigiría dejar ese corte a la vista o mover/escalar textos.
- Grosor de la cinta 24 px (escala con la foto) y nuevo bucle por encima de la cabeza: ¿mantiene la intención de la maestra?
- Barbilla a ~20 px de la oferta y final de la oferta sobre la camisa clara.
- Margen de 54 px como regla interna SOLO de esta prueba; no es una especificación oficial de 1200×628.
