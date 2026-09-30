# DEMO pendiente de revisión humana — 1200×628

> No es una aprobación de producción. La maestra no se modifica; el resultado es un clon en una sección de salida.

- Frame creado: ` DEMO_1200x628 · 960x1200_Taxdown_SVA2 · pendiente de revisión humana ` (` 2048:121 `) → https://www.figma.com/design/UZgEPO8UUe9IDwTWitBbgF/?node-id=2048-121
- Sección de salida: ` 2009:121 `
- Maestra: ` 1:537 ` (960×1200)
- Zona segura: margen de prueba de 54 px por lado (regla interna de esta ejecución, no especificación) — Margen de 54 px declarado SOLO para esta prueba interna 1200×628; no es especificación oficial ni valor general.
- Captura: ` runs/2026-09-30-copy-UZgE-1200x628/evidence/demo-2048-121-v3.png `
- Fuentes (nunca se sustituyen; ✗ = no cargable por el plugin en este entorno): Mutualidad Black ✗ · Mutualidad Bold ✗ · Mutualidad Regular ✗ · Rufina Bold ✓ · Rufina Regular ✓. Carga exigida por las operaciones: no (solo traslaciones de texto).

## Estado agregado: **revisión humana**

| Comprobación | Tipo | Estado | Hallazgos | Qué cubre |
|---|---|---|---|---|
| target_dimensions | deterministic | superada | — | Ancho/alto exactos del frame destino y recorte activo. |
| nodes_preserved | deterministic | superada | — | Mismo conjunto de nodos, tipos, nombres, padres y orden de apilado (por correspondencia de la relectura). |
| content_preserved | deterministic | superada | — | Igualdad exacta de caracteres, segmentos de estilo (fuente, cuerpo, interlineado, color), pinturas, efectos, visibilidad, opacidad, máscaras y geometría vectorial. No evalúa el render. |
| allowed_operations | deterministic | superada | — | Posición de cada caja respecto al plan (±0.01 px), tamaño exacto de todo lo que solo se traslada y parte lineal exacta de cada transformación. |
| logo_locked | deterministic | superada | — | Ancho/alto exactos, transformaciones lineales exactas, recorte y posición de cada nodo respecto al bloque del logo. El render del logo lo confirma la captura. |
| demo_safe_area | deterministic | superada | — | Cajas completas de los elementos importantes dentro del frame y de la zona segura: margen de prueba de 54 px por lado (regla interna de esta ejecución, no especificación) — Margen de 54 px declarado SOLO para esta prueba interna 1200×628; no es especificación oficial ni valor general.. Las cajas de texto no prueban ausencia de truncamiento visual. |
| background_coverage | deterministic | superada | — | Cobertura por cajas del ancho y del borde inferior; regiones protegidas (declaradas por el agente) completas y sin cajas de texto encima. No mide píxeles. |
| master_unchanged | deterministic | superada | — | Hash exacto de cada registro de la maestra releída tras escribir frente al payload del inventario. |
| visual_agent_review | visual | revisión humana | RIBBON_FRAGMENTS 1:548,2048:134; PHOTO_LEFT_SEAM 1:539,2048:125; PHOTO_CROPPED_LANDSCAPE 1:539; HEADLINE_NEAR_SUBJECT 1:571,2048:157; CTA_OFFER_ADJACENT 1:550,1:549; GRADIENT_RESHAPED 1:541,2048:127; FONT_NOT_LOADABLE_IN_ENV 2048:137,2048:138,2048:157,2048:158 | Inspección visual del agente sobre una captura del clon. No sustituye la revisión de la diseñadora. |

## Operaciones aplicadas al clon

- Traslación rígida ` logo ` (` 1:553 `): Esquina superior izquierda, alineado con el titular y la información complementaria.
- Traslación rígida ` message ` (` 1:571 `, ` 1:572 `): Titular + importe como bloque rígido en la columna izquierda (el titular no puede estrecharse: «personalizado» ocupa ~717 px).
- Traslación rígida ` photo ` (` 1:539 `, ` 1:542 `): Foto con cinta+máscara (alineadas con los brazos) a la derecha; la cara queda completa y a la derecha del titular; se recortan el antebrazo derecho y el pie de la foto.
- Traslación rígida ` offer ` (` 1:549 `, ` 1:540 `): Oferta blanca sobre la parte baja oscurecida de la foto, con su sombra de legibilidad; bajo la cara y el importe.
- Traslación rígida ` cta ` (` 1:550 `): CTA en la columna izquierda, bajo el importe (no cabe con la oferta en la altura disponible).
- Traslación rígida ` info ` (` 1:552 `): Información complementaria abajo a la izquierda, en el borde de la zona de prueba.
- Redimensionado de efecto ` 1:541 `: Oscurecimiento inferior a todo el ancho (también bajo la columna izquierda: fondo de la información complementaria clara) y más corto para no oscurecer el titular.
- Redimensionado de efecto ` 1:544 `: Forma rectangular de la máscara de la cinta: su borde izquierdo cortaba la cinta en vertical (detrás del titular en x≈451 y, al probar x=745, sobre la manga). Se recoge hasta su borde derecho (1 px): la cinta solo asoma entre brazo y pelo y tras la mano, como en la maestra. Solo OCULTA decoración; no revela nada.
- Frame raíz: 960×1200 → 1200×628 con resizeWithoutConstraints (sin escalar hijos).

## Decisiones para la diseñadora

- Cinta en 1200×628: (a) ocultar los dos fragmentos que quedan (sin cinta en este formato), (b) rediseñar su trazado para este formato, o (c) aceptar los fragmentos actuales.
- Composición horizontal nueva (no derivada del cuadrado): titular y logo a la izquierda, foto a la derecha desde x=600, CTA a la izquierda y oferta a la derecha en la franja inferior.
- Recorte de la foto: antebrazo derecho y parte baja fuera de cuadro; cara completa.
- Degradado de oscurecimiento 1:541 redimensionado a 1230×378 (efecto no-contenido).
- Margen de 54 px como regla interna SOLO de esta prueba (internal_demo_rule); no es una especificación oficial de 1200×628.
