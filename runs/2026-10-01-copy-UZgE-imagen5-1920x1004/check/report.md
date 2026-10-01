# DEMO pendiente de revisión humana — 1920×1004

> No es una aprobación de producción. La maestra no se modifica; el resultado es un clon en una sección de salida.

- Frame creado: ` DEMO_1920x1004 · 960x1200_PAM_Meta_2 · pendiente de revisión humana ` (` 2118:121 `) → https://www.figma.com/design/UZgEPO8UUe9IDwTWitBbgF/?node-id=2118-121
- Sección de salida: ` 2096:121 `
- Maestra: ` 28:140 ` (960×1200)
- Zona segura: margen de prueba de 0 px por lado (regla interna de esta ejecución, no especificación) — SIN safe zone: la plantilla indicada (sección 67:75 «Foundation Grid / Safe Zone / Meta / Tiktok», página «Safe Zones») solo tiene guías 1:1, 4:5, 3:4, Reel 9:16, Story 9:16 y TikTok 9:16; ninguna de 1920×1004 ni horizontal. Por instrucción de la persona no se aplica ninguna ni se escala otra. Solo se exige que el contenido quede dentro del frame; los márgenes de 100 px son una decisión de composición, no una zona segura.
- Captura: ` runs/2026-10-01-copy-UZgE-imagen5-1920x1004/evidence/demo-2118-121-v1.png `
- Fuentes (nunca se sustituyen; ✗ = no cargable por el plugin en este entorno): Mutualidad Black ✗ · Mutualidad Bold ✗ · Mutualidad Regular ✗ · Rufina Bold ✓ · Rufina Regular ✓. Carga exigida por las operaciones: no (solo traslaciones de texto).

## Estado agregado: **revisión humana**

| Comprobación | Tipo | Estado | Hallazgos | Qué cubre |
|---|---|---|---|---|
| target_dimensions | deterministic | superada | — | Ancho/alto exactos del frame destino y recorte activo. |
| nodes_preserved | deterministic | superada | — | Mismo conjunto de nodos, tipos, nombres, padres y orden de apilado (por correspondencia de la relectura). |
| content_preserved | deterministic | superada | — | Igualdad exacta de caracteres, segmentos de estilo (fuente, cuerpo, interlineado, color), pinturas, efectos, visibilidad, opacidad, máscaras y geometría vectorial. No evalúa el render. |
| allowed_operations | deterministic | superada | — | Posición de cada caja respecto al plan (±0.01 px), tamaño exacto de todo lo que solo se traslada, factor único en ancho y alto de las imágenes escaladas y parte lineal exacta de cada transformación. |
| logo_locked | deterministic | superada | — | Ancho/alto exactos, transformaciones lineales exactas, recorte y posición de cada nodo respecto al bloque del logo. El render del logo lo confirma la captura. |
| demo_safe_area | deterministic | superada | — | Cajas completas de los elementos importantes dentro del frame y de la zona segura: margen de prueba de 0 px por lado (regla interna de esta ejecución, no especificación) — SIN safe zone: la plantilla indicada (sección 67:75 «Foundation Grid / Safe Zone / Meta / Tiktok», página «Safe Zones») solo tiene guías 1:1, 4:5, 3:4, Reel 9:16, Story 9:16 y TikTok 9:16; ninguna de 1920×1004 ni horizontal. Por instrucción de la persona no se aplica ninguna ni se escala otra. Solo se exige que el contenido quede dentro del frame; los márgenes de 100 px son una decisión de composición, no una zona segura.. Las cajas de texto no prueban ausencia de truncamiento visual. |
| background_coverage | deterministic | superada | — | Cobertura por cajas del ancho y del borde inferior; regiones protegidas (declaradas por el agente) completas y sin cajas de texto encima. No mide píxeles. |
| layout_order_and_cta | deterministic | superada | — | Por cajas de render (±1 px): cada elemento del orden de lectura queda debajo o a la derecha del anterior sin empezar por encima; el CTA centrado bajo su bloque de copy y separado de él sin compartir franja. No evalúa jerarquía visual. |
| effective_visibility | deterministic | superada | — | Contenido importante visible (sin ocultar, opacidad acumulada 1), con render dentro del frame y sin formas opacas pintadas encima (por cajas). El contraste y la legibilidad los juzga la captura. |
| master_unchanged | deterministic | superada | — | Hash exacto de cada registro de la maestra releída tras escribir frente al payload del inventario. |
| visual_agent_review | visual | revisión humana | HIERARCHY_PRESERVED 28:158,28:174; READING_ORDER_TWO_COLUMNS 28:164,28:160,28:162,28:165,28:166,28:177; RIGHT_COLUMN_SPARSE 28:141,28:165,28:166,28:177; LOGO_POSITION_CHANGED 28:141; NO_SAFE_ZONE_APPLIED 28:140; MISSING_FONT_ENVIRONMENT 28:160,28:161,28:167,28:176,28:177 | Inspección visual del agente sobre una captura del clon. No sustituye la revisión de la diseñadora. |

## Operaciones aplicadas al clon

- Traslación rígida ` offer ` (` 28:158 `): Columna izquierda: bloque de oferta (forma verde + titular + 4,10 % + rentabilidad) sin editar, centrado en vertical junto con el sello (111…893).
- Traslación rígida ` badge ` (` 28:174 `): Sello en la muesca de la forma con la misma relación que en la maestra (+281, +563 respecto al bloque).
- Traslación rígida ` logo ` (` 28:141 `): Columna derecha, arriba: alineado con el borde superior de la forma verde.
- Traslación rígida ` claim ` (` 28:165 `): Claim con su línea superior alineada con «de rentabilidad garantizada 1 año» (la lectura continúa de la oferta a la columna derecha).
- Traslación rígida ` cta ` (` 28:166 `): CTA a la derecha del claim con la misma relación que en la maestra (+509, +11).
- Traslación rígida ` legal ` (` 28:177 `): Legal al pie de la columna derecha; su base coincide con la del sello (y≈893).
- Frame raíz: 960×1200 → 1920×1004 con resizeWithoutConstraints (sin escalar hijos).

## Decisiones para la diseñadora

- Safe zone: la plantilla 67:75 no tiene guía para 1920×1004; por tu instrucción no se aplica ninguna. Si existe una guía horizontal (p. ej. 1,91:1 de Meta) en otro nodo, indícalo y se recomprueba.
- Distribución D2 elegida (oferta a toda altura a la izquierda; logo, claim+CTA y legal en columna derecha) frente a D1 (logo encima de la oferta: sin aire vertical y mitad superior derecha vacía).
- Logo arriba a la derecha (en la maestra va arriba a la izquierda).
- Columna derecha aireada: posible aumento de cuerpo del claim/CTA si se autoriza.
- El claim comparte línea superior con «de rentabilidad garantizada 1 año»; el legal, base con el sello.
