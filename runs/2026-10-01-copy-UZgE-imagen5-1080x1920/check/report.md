# DEMO pendiente de revisión humana — 1080×1920

> No es una aprobación de producción. La maestra no se modifica; el resultado es un clon en una sección de salida.

- Frame creado: ` DEMO_1080x1920_Meta · 960x1200_PAM_Meta_2 · pendiente de revisión humana ` (` 2096:122 `) → https://www.figma.com/design/UZgEPO8UUe9IDwTWitBbgF/?node-id=2096-122
- Sección de salida: ` 2096:121 `
- Maestra: ` 28:140 ` (960×1200)
- Zona segura: regla meta_reels_stories_9x16@guía pública 2026 (fuentes secundarias) (internal) — Zona segura de Meta pedida por la persona para esta prueba interna. Se usa la más restrictiva para 9:16 (Reels; cubre también Stories): 14 % arriba (≈269 px), 35 % abajo (672 px) y 6 % a los lados (≈65 px). Cifras de guías públicas de terceros (adnova.ai, adsuploader.com, 1clickreport.com), no verificadas en la página oficial de Meta; por eso la procedencia es 'internal'.
- Captura: ` runs/2026-10-01-copy-UZgE-imagen5-1080x1920/evidence/demo-2096-122-v1.png `
- Fuentes (nunca se sustituyen; ✗ = no cargable por el plugin en este entorno): Mutualidad Black ✗ · Mutualidad Bold ✗ · Mutualidad Regular ✗ · Rufina Bold ✓ · Rufina Regular ✓. Carga exigida por las operaciones: no (solo traslaciones de texto).

## Estado agregado: **revisión humana**

| Comprobación | Tipo | Estado | Hallazgos | Qué cubre |
|---|---|---|---|---|
| target_dimensions | deterministic | superada | — | Ancho/alto exactos del frame destino y recorte activo. |
| nodes_preserved | deterministic | superada | — | Mismo conjunto de nodos, tipos, nombres, padres y orden de apilado (por correspondencia de la relectura). |
| content_preserved | deterministic | superada | — | Igualdad exacta de caracteres, segmentos de estilo (fuente, cuerpo, interlineado, color), pinturas, efectos, visibilidad, opacidad, máscaras y geometría vectorial. No evalúa el render. |
| allowed_operations | deterministic | superada | — | Posición de cada caja respecto al plan (±0.01 px), tamaño exacto de todo lo que solo se traslada, factor único en ancho y alto de las imágenes escaladas y parte lineal exacta de cada transformación. |
| logo_locked | deterministic | superada | — | Ancho/alto exactos, transformaciones lineales exactas, recorte y posición de cada nodo respecto al bloque del logo. El render del logo lo confirma la captura. |
| demo_safe_area | deterministic | superada | — | Cajas completas de los elementos importantes dentro del frame y de la zona segura: regla meta_reels_stories_9x16@guía pública 2026 (fuentes secundarias) (internal) — Zona segura de Meta pedida por la persona para esta prueba interna. Se usa la más restrictiva para 9:16 (Reels; cubre también Stories): 14 % arriba (≈269 px), 35 % abajo (672 px) y 6 % a los lados (≈65 px). Cifras de guías públicas de terceros (adnova.ai, adsuploader.com, 1clickreport.com), no verificadas en la página oficial de Meta; por eso la procedencia es 'internal'.. Las cajas de texto no prueban ausencia de truncamiento visual. |
| background_coverage | deterministic | superada | — | Cobertura por cajas del ancho y del borde inferior; regiones protegidas (declaradas por el agente) completas y sin cajas de texto encima. No mide píxeles. |
| vector_edits | deterministic | superada | — | Vértices y tiradores editados en su destino (±0,5 px), todos los demás de ese vector sin cambios (±0,05 px), en coordenadas del frame; misma topología; grosor de trazo declarado. |
| layout_order_and_cta | deterministic | superada | — | Por cajas de render (±1 px): cada elemento del orden de lectura queda debajo o a la derecha del anterior sin empezar por encima; el CTA centrado bajo su bloque de copy y separado de él sin compartir franja. No evalúa jerarquía visual. |
| effective_visibility | deterministic | superada | — | Contenido importante visible (sin ocultar, opacidad acumulada 1), con render dentro del frame y sin formas opacas pintadas encima (por cajas). El contraste y la legibilidad los juzga la captura. |
| master_unchanged | deterministic | superada | — | Hash exacto de cada registro de la maestra releída tras escribir frente al payload del inventario. |
| visual_agent_review | visual | revisión humana | READING_ORDER_OK_VISUALLY 28:141,28:164,28:160,28:162,28:176,28:165,28:166,28:177; TIGHT_VERTICAL_RHYTHM 28:141,28:159,28:165,28:177; DECORATION_SHORTENED 28:159; EMPTY_BANDS_BY_PLATFORM 28:140; MISSING_FONT_ENVIRONMENT 28:160,28:161,28:167,28:176,28:177 | Inspección visual del agente sobre una captura del clon. No sustituye la revisión de la diseñadora. |

## Operaciones aplicadas al clon

- Traslación rígida ` logo ` (` 28:141 `): Arriba a la izquierda dentro de la zona segura (bajo la franja de perfil de Reels), alineado con el borde izquierdo de la forma verde como en la maestra.
- Traslación rígida ` offer ` (` 28:158 `): Bloque de oferta centrado en el ancho; con la forma acortada su borde superior queda a 30 px del logo.
- Traslación rígida ` badge ` (` 28:174 `): Insignia encajada en la muesca de la forma, con la misma relación que en la maestra (la muesca sube 10 px).
- Traslación rígida ` claim ` (` 28:165 `): Claim de producto a la izquierda bajo la insignia.
- Traslación rígida ` cta ` (` 28:166 `): CTA a la derecha del claim, misma relación que en la maestra.
- Traslación rígida ` legal ` (` 28:177 `): Legal al pie de la zona segura (fuera de la franja inferior de Reels, donde lo taparían los textos y botones de la interfaz).
- Edición vectorial (decoración) ` 28:159 `: 7 vértice(s), 0 tirador(es). Forma verde de la oferta (decoración): se acorta su relleno vacío 37 px arriba y 30 px en las esquinas inferiores (la muesca de la insignia sube 10 px) para que todo el contenido quepa en los 979 px útiles de la zona segura sin tocar textos. Se conservan sus 8 vértices y el redondeo.
- Frame raíz: 960×1200 → 1080×1920 con resizeWithoutConstraints (sin escalar hijos).

## Decisiones para la diseñadora

- Zona segura: se aplicó la de Reels (la más restrictiva: 14 % arriba, 35 % abajo, 6 % a los lados), que también cubre Stories. Si la pieza es solo para Stories (≈14 %/20 %), hay ~290 px más de alto útil y se podría devolver el aire de la maestra sin tocar la forma. ¿Para qué emplazamiento es?
- Procedencia de los porcentajes de Meta: fuentes secundarias (no una especificación oficial consultada); declarada como provenance «internal».
- Forma verde acortada de 661 a 594 px (solo vértices; textos intactos). Alternativa: conservar la forma y reducir el cuerpo del legal o del claim (cambio de cuerpo que requiere tu autorización).
- Legal a ~1 px del límite inferior y separado 25 px del claim (59 px en la maestra).
- Roles dudosos: el texto del sello se propuso como supplementary_info (no legal); el «*» va agrupado con el precio; el frame oculto «Zonasegura_Feed» se conserva oculto y sin cambios.
