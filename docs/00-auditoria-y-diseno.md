# Paid Creative Builder — Auditoría y diseño

Versión: **v2.1** (2026-09-29) · Estado: arquitectura aceptada.
- **H0**: cerrado (entorno fijado, Zod, typecheck real).
- **H1**: implementado. Lectura real completada el 2026-09-30 (instantánea y manifiesto borrador de `4:142`). Aprobación pendiente: revisor sin designar, fuentes inestables y fusión de entidades.

Historial de cambios: §10 (v2 → v2.1) y §11 (v1 → v2).

---

## 1. Auditoría de los archivos existentes

Inventario: `references/Paid SKILL/SKILL.md`, `references/meta-ads-specs.md`, `references/google-ads-specs.md`, 7 PNG de safe zones y 1 PNG resumen. No hay git ni ninguna maestra de ejemplo.

### 1.1 `SKILL.md` — guion conversacional, no especificación

| # | Hallazgo | Tratamiento |
|---|---|---|
| S1 | Incluye carrusel, vídeo, Stories/Reels, Lead Ads, exportación y construir la maestra como paso previo. | **Decisión de alcance**, no incompatibilidad: el MVP se limita a piezas estáticas y a frames en Figma. La exportación **no estaba prohibida** por el encargo (solo la publicación automática); se aplaza. Vídeo y carrusel quedan fuera del alcance estático. |
| S2 | Pide "reajustar jerarquía (qué se recorta, qué se reescala…)" sin excluir el logo. | **Contradice** las invariantes del logo y la prohibición de recortar contenido sin autorización. No se hereda. |
| S3 | Nombra herramientas concretas (`figma-use`, `get_design_context`, `use_figma`…). | Nombrarlas no es un problema. Sí lo es **dar por hecha su disponibilidad**, porque el texto no condiciona su uso a comprobarla. En esta sesión se ha comprobado que existen (§1.5). `figma-generate-design` sirve para generación libre y no aplica aquí. |
| S4 | Los enlaces `references/*.md` son relativos a `references/Paid SKILL/`, donde esos archivos no existen. | Referencias rotas. |
| S5 | Propone dos convenciones de nombre (`cliente_plataforma_formato_tamaño_idioma` y `cliente_plataforma_ubicación_tamaño`). | Hay que fijar una sola. |
| S6 | Dice "verificadas a fecha 2026-09-17" sin aportar evidencia. | Se trata como procedencia declarada pero no comprobada. |
| S7 | Alcance Meta/Google, pero las PNG incluyen TikTok. | Inconsistencia de alcance. |

### 1.2 `meta-ads-specs.md`

| # | Hallazgo |
|---|---|
| M1 | Stories/Reels figuran como **sin verificar** en el propio documento. |
| M2 | Safe zone "~14 % arriba y abajo". La PNG `story-916` mide 220 px (11,5 %) y `reel-916-icons` tiene forma de L con 450 px abajo. Stories y Reels comparten 9:16, pero **no por eso comparten safe zone**: son reglas distintas. |
| M3 | 4:5 aparece como 1440×1800 (recomendado) y como 1080×1350 ("seguro"). Hay que elegir destino. |
| M4 | Lead Ads en Instagram: 600×315/600×600/600×750. Parecen mínimos; hay que verificarlo. |
| M5 | No hay safe zone para Feed en el documento. Que falte aquí **no demuestra que Meta no tenga especificación**. |
| M6 | Las PNG incluyen 3:4 (1080×1440), que no aparece en la tabla. |

### 1.3 `google-ads-specs.md`

| # | Hallazgo |
|---|---|
| G1 | Display: la cuadrada "recomendada" es 600×600, frente a 1200×1200 en Demand Gen y PMax. Hay que verificarlo. |
| G2 | No recoge ninguna safe zone. **La ausencia en nuestras referencias no demuestra que Google no tenga reglas** (recortes automáticos, superposiciones, límites de texto). Hasta investigarlo y aprobar una regla, o una declaración firmada de no aplicabilidad, el destino queda **bloqueado**. |
| G3 | Los logotipos 1:1 y 4:1 son activos independientes, no adaptaciones de una maestra. |
| G4 | Los IDs de artículo no se han verificado en esta sesión. |

### 1.4 PNG de safe zones — medidas por píxel

Son ráster, sin fuente citada. Las etiquetas indican **alto×ancho** ("1350 × 1080"), así que se normaliza siempre a `width×height`. Algunos textos de la interfaz ("8,4 Tsd.") apuntan a una plantilla de terceros en alemán. **Su procedencia es desconocida**: como mucho pueden entrar como regla `internal` si alguien del equipo las adopta (§3.3). Nunca como `platform_official`.

| Archivo | W×H | Zona blanca medida (px, inclusiva) |
|---|---|---|
| `safe-zone-post-11` | 1080×1080 | x 90–989, y 120–959 |
| `safe-zone-post-34` | 1080×1440 | x 90–989, y 120–1319 |
| `safe-zone-post-45` | 1080×1350 | x 90–989, y ≈120–1230; líneas "Explore Grid" en y 132/1218, bandas "Profile Grid" en x ≈34/1046 |
| `safe-zone-story-916` | 1080×1920 | x 90–989, y 220–1699 |
| `safe-zone-reel-916-icons` | 1080×1920 | L: x 90–989/y 220–850 ∪ x 90–909/y 851–1469 |
| `safe-zone-reel-916-meta` | 1080×1920 | La misma L más superposiciones de recorte de grid |
| `safe-zone-tiktok-916` | 1080×1920 | Lectura visual aproximada: x 120–960/y 252–1278, con muesca x ≤ 840 desde y 360 |

Las PNG mezclan **exclusión por UI** con **recorte de previsualización de grid**. Son conceptos distintos (§3.3).

### 1.5 Entorno real detectado

- **MCP oficial de Figma** conectado, con `get_metadata`, `get_design_context`, `get_screenshot` y `use_figma` (JavaScript de la Plugin API), entre otras.
- `whoami`: asiento **View** (equipo *starter*) y **Dev** (organización *The Cocktail*). Hay que distinguir dos problemas:
  - **Permisos de edición del archivo.** Dependen del asiento y de cómo esté compartido el archivo. Con View o Dev probablemente **no hay permiso de edición**. Ningún mecanismo técnico (MCP, plugin o REST) debe usarse para eludirlo: se necesita un asiento o permiso adecuado, o un archivo propio editable.
  - **Limitaciones técnicas del MCP**, que existen aunque haya permisos: `use_figma` no admite `setPluginData`, `createImageAsync` ni `loadAllPagesAsync`; el código tiene un máximo de 50 000 caracteres; no hay estado entre llamadas; hay límites de uso por plan. Además, el contexto de página se reinicia en cada llamada.
  - **Sin verificar:** si `use_figma` exige permiso de edición también para scripts de solo lectura. Si es así, H1 necesita otra vía de lectura (§2.3).
- **OCR local**: `tesseract 5.5.2` con `eng`, `osd` y `snum`. **No tiene `spa`.** No se usa hasta que se autorice.
- Máquina local: Node v25.6.1 (versión *Current*, no LTS) y npm 11.9.0. No hay pnpm ni gestor de versiones de Node (nvm, fnm, volta…). Entorno fijado en §9.

---

## 2. Decisión técnica: integración con Figma

### 2.1 Núcleo y puertos

El núcleo en TypeScript es puro. Figma queda detrás de un puerto de lectura en dos fases: **preparar la petición** y **luego ingerir la respuesta**. El agente es solo el transporte y no toma decisiones.

| Adaptador | Función | Estado |
|---|---|---|
| `mcp-relay` | Genera un script de lectura cerrado para `use_figma`. El agente lo ejecuta, **guarda la respuesta original** y el CLI la ingiere. | Script implementado; **no ejecutado en real** |
| `mock` | Ejecuta **el mismo script** contra un `figma` falso y de solo lectura (cualquier escritura lanza una excepción). Toda su salida lleva `source: "MOCK"`. | Implementado |
| `plugin` (alternativa) | Solo se justificaría ante **limitaciones técnicas del MCP** demostradas en la prueba: tamaño de script, falta de estado, límites de uso o APIs bloqueadas. **No resuelve la falta de permisos de edición** porque se ejecuta con los permisos del usuario. | No implementado; requiere justificación |
| REST (solo lectura) | Vía de contingencia para leer si `use_figma` exige edición. Requiere un token personal en una variable de entorno, nunca en el repositorio. **Nunca se usa para modificar nodos.** | No implementado; pendiente de decisión |

### 2.2 Script de lectura (H1)

- `figma.getNodeByIdAsync(root)`. Carga la página con `page.loadAsync()` si existe, **sin** `setCurrentPageAsync`, para no cambiar la vista del usuario.
- Recorre en preorden, que coincide con el orden de pintado.
- Captura por nodo:
  - Transformaciones relativa y absoluta.
  - `absoluteBoundingBox` y `absoluteRenderBounds`.
  - Recortes (`clipsContent`), máscaras (`isMask`, `maskType`).
  - Restricciones y auto-layout.
  - Rellenos y trazos: `imageHash`, `scaleMode`, `imageTransform`, `scalingFactor` y filtros.
  - Efectos.
  - Texto completo: `characters`, `hasMissingFont`, `textAutoResize`, `textTruncation`, `maxLines`, alineaciones, `leadingTrim` y segmentos con estilos (`getStyledTextSegments`).
  - Digest de la geometría vectorial.
  - Componente principal de las instancias.
- Si una propiedad no se puede leer, se registra en `readErrors`. No se inventa un valor.
- **Garantía de solo lectura**: el script no contiene llamadas de mutación. Se comprueba de dos formas: una lista estática de llamadas prohibidas y la ejecución en MOCK contra nodos que lanzan excepción ante cualquier escritura. **No se ha comprobado en real.**

### 2.3 Fidelidad del transporte (punto 11)

La respuesta de `use_figma` llega al agente y el agente la reenvía. Ese reenvío puede alterarla (truncado o transcripción). Por eso:

1. El script devuelve `{payload: <string JSON>, digest: sha256(payload), payloadLength}`. El SHA-256 se calcula **dentro de Figma** en JavaScript puro sobre UTF-8.
2. La respuesta original se guarda **tal cual** (`raw-response.txt`, con su propio SHA-256) antes de parsearla. Si el entorno vuelca automáticamente la salida de la herramienta a un archivo, se copia ese archivo en lugar de transcribirla.
3. `ingest` recalcula el digest y rechaza cualquier discrepancia (`TRANSPORT_DIGEST_MISMATCH`).
4. La validación estructural (esquemas Zod) **solo comprueba la forma**. No prueba fidelidad: eso lo aporta el digest.
5. **Sin verificar:** el formato exacto con el que `use_figma` envuelve el valor devuelto. `ingest` acepta el sobre directamente o un único bloque JSON que lo contenga; cualquier otra cosa se rechaza. Se ajustará tras la primera lectura real.
6. **Alcance de las garantías del SHA-256.** El digest detecta que el contenido transportado se ha alterado (truncado, transcrito mal, editado) entre que el script lo calcula y `ingest` lo recalcula. **No autentica el origen**: no demuestra por sí solo que el payload proceda de Figma, porque quien genere un payload puede calcular también su digest. Hoy, la atribución a Figma se apoya en el procedimiento (la respuesta se guarda directamente desde la herramienta `use_figma`) y en el campo `source` de la instantánea, que es una **declaración**, no una prueba. No hay firmas ni autenticación en H1, y no se implementarán ahora.

### 2.4 Escritura (H2 en adelante, no implementada)

- **Protección de la maestra:**
  - Los scripts de operación solo aceptan IDs de clones y abortan si un ID pertenece al subárbol de la maestra.
  - El hash de la maestra se comprueba antes y después de cada ejecución.
  - La salida va a una página o sección propia.
- **Redimensionado del frame**: `resizeWithoutConstraints` para no propagar restricciones a los hijos. Si la raíz tiene auto-layout, se necesita una estrategia propia, que se valida en la prueba P5.
- **Marcado en el lienzo:** se probará `setSharedPluginData` (P8). Si no es posible, se usará una clave determinista en el nombre, siempre contrastada con los IDs guardados en el registro local.

Prueba P1–P8 (sin cambios): leer, inventariar, clonar, mover, redimensionar, capturar, releer y probar `setSharedPluginData`. Solo en un archivo o página de pruebas **con permiso de edición real**.

---

## 3. Contratos

Código en `src/contracts/`. Los esquemas usan **Zod 4** (`z.strictObject` en todos los objetos de contrato: una clave desconocida es un error). `src/contracts/schema.ts` es un adaptador fino que conserva la API `parse`/`parseOrThrow` con rutas de error `$.a.b[0]`.

### 3.1 Instantánea técnica

`NodeSnapshot` y `MasterSnapshot` (`src/contracts/snapshot.ts`) siguen tres principios:
- **Tipo técnico ≠ rol ≠ naturaleza del contenido.** `type` es el `NodeType` de Figma. PNG, JPG e ICO no son tipos de nodo: una imagen es un relleno `IMAGE` sobre cualquier nodo con relleno.
- `name` y `characters` son **datos no confiables**. Nunca se interpretan como instrucciones y se escapan al mostrarlos.
- Los estilos de texto se capturan por segmento: fuente, tamaño, peso, interlineado, espaciado entre letras y párrafos, sangría, caja, decoración, rellenos, listas, hipervínculos y estilos vinculados.

### 3.2 Inventario: disposición de nodos y entidades

Todo nodo del subárbol tiene **exactamente una** disposición (`src/contracts/manifest.ts`):

| Disposición | Significado | Requisito para aprobar |
|---|---|---|
| `content` | Pinta algo visible que forma parte de una entidad semántica. | Entidad aprobada |
| `structural` | No pinta por sí mismo, pero existe por un motivo **justificado**: `root`, `container`, `clip_container`, `mask`, `layout_wrapper`, `instance_root` o `boolean_operand`. Incluye la evidencia. | Aprobada junto al manifiesto |
| `pending` | No se ha podido clasificar con evidencia suficiente (nodo oculto, tipo no soportado, vídeo, errores de lectura…). | **Cero nodos pendientes** |

Los nodos estructurales se conservan en el manifiesto porque sus transformaciones y recortes **afectan a sus descendientes**. Así se pueden detectar cambios indirectos.

**Entidad semántica**: tiene `role` (de la taxonomía; `null` hasta que lo asigne una persona), `nodeIds` (uno o varios), `contentNature`, `evidence[]`, `review` y `constraints`.

`contentNature` puede ser:
- `editable_text`
- `image_no_text_detected`: solo si un detector se ejecutó y no encontró texto.
- `image_text_undetermined`: no hay detector ejecutado o no es concluyente.
- `image_embedded_text`
- `image_with_editable_text_overlay`: composición propuesta que una persona debe aceptar.
- `vectorized_text`
- `vector_graphic`
- `vector_undetermined`
- `shape`
- `mixed_composition`
- `unknown`

El nombre de capa **nunca** determina la naturaleza del contenido. Solo puede generar una **pista de rol** (`layer_name_hint`, confianza baja) comparándolo con palabras clave configuradas por proyecto.

### 3.3 Safe zones: procedencia frente a aprobación (punto 2)

```ts
SafeZoneRule {
  ruleId, version,
  appliesTo: { platform, placement, surface?, width, height },   // se asocia por ubicación, NUNCA solo por proporción
  geometry: { allowed: Region, exclusions: Region[], gridCrops?: Region[] },
  provenance:
    | { kind: 'platform_official'; sourceUrl; retrievedAt; retrievedBy; evidencePath; evidenceSha256 }
    | { kind: 'client';   document; providedBy; receivedAt; evidencePath? }
    | { kind: 'internal'; authoredBy; authoredAt; rationale; derivedFrom? },   // p. ej. las PNG de 1.4
}
SafeZoneApproval { ruleId, version, projectId, approvedBy, approvedAt, scope: placements[] }
```

- **Procedencia** es de dónde sale la regla. **Aprobación** es la decisión de un proyecto de usarla. Son registros separados.
- Una regla `internal` o `client` **nunca** se presenta como oficial. Solo `platform_official` requiere URL y evidencia de captura, y aun así no implica aprobación para el proyecto.
- Un `Destination` referencia explícitamente los `ruleId` aprobados. No existe herencia por proporción: Stories 9:16 y Reels 9:16 son reglas distintas.
- Un destino sin regla aprobada queda **bloqueado** (`SAFE_ZONE_UNAPPROVED`). La alternativa es `SafeZoneNotApplicable { placement, statedBy, statedAt, rationale, investigatedSources[] }`, que exige haber buscado especificaciones de plataforma, no solo haber consultado nuestras referencias.
- Los recortes de grid (`gridCrops`) se tratan aparte de las exclusiones. Su severidad es una decisión de proyecto (D4).

### 3.4 Restricciones de entidad, atomicidad, regiones protegidas y relaciones (punto 3)

**Invariantes globales** (en código, `GLOBAL_INVARIANTS`, no configurables):
- La maestra es inmutable.
- No se añade, elimina, sustituye ni reescribe contenido.
- El logo solo admite traslación: su parte lineal (escala, rotación, sesgo), su tamaño, su recorte, su geometría y sus rellenos no cambian.
- Los elementos protegidos quedan íntegros dentro de la zona permitida.

**Restricciones por entidad** (`EntityConstraints`):
- `allowOps ⊆ {translate, resize_text_box, recrop_background}`.
- `allowReflow`: permite cambiar los saltos de línea sin cambiar el texto.
- `atomicGroup`: las entidades del mismo grupo se mueven como un sólido, con un único vector de traslación.
- `protectedRegions`: rectángulos en coordenadas locales del nodo (por ejemplo, la zona de producto de una imagen) que deben seguir visibles, sin recortar ni tapar, y dentro de la safe zone.
- `mustBeInSafeZone`.

**Regla de precedencia**: las restricciones de entidad **solo pueden endurecer**. Si una entidad de rol `logo` declara `allowOps` distinto de `[]` o `['translate']`, o `allowReflow: true`, o un `atomicGroup` con entidades que no son logo y que exija escalar, el manifiesto **no se puede aprobar** (`ENTITY_CONSTRAINT_LOOSENS_INVARIANT`).

**Relaciones obligatorias** (`Relation`), a nivel de manifiesto y con un predicado geométrico verificable:
- `rigid(a, b)`: misma traslación.
- `contained_in(a, b)`: por ejemplo, un texto superpuesto que debe quedar dentro de su imagen.
- `order(a, b, axis, direction)`
- `min_gap(a, b, px)`
- `z_above(a, b)`
- `aligned(a, b, edge)`

Cada relación tiene su propio estado de revisión.

### 3.5 Logo: comparación numérica en coordenadas del frame (punto 5)

Para cada nodo `n` del logo: `R(n) = A(frame)⁻¹ · A(n)` (transformaciones afines 3×3, con `frame` = raíz de la maestra o de la adaptación).

| Magnitud | Condición |
|---|---|
| Parte lineal `L = R[0..1][0..1]` | `‖L_maestra − L_adapt‖∞ ≤ ε_lin` |
| `width` y `height` del nodo | `|Δ| ≤ ε_px` |
| Traslación | Libre, pero **la misma** para todos los nodos del logo (`|Δt_i − Δt_j| ≤ ε_px`) |
| Rellenos de imagen | `scaleMode`, `imageTransform`, `scalingFactor` e `imageHash` idénticos |
| Geometría vectorial | Digest idéntico |
| Región visible | `renderBounds ∩ recortes de ancestros ∩ máscaras` debe ser igual a `renderBounds` en ambos casos. Además, las mismas máscaras con la misma transformación relativa. |

`ε_lin = 1e-6` y `ε_px = 0.01` son **tolerancias de representación numérica** (coma flotante y serialización). **No autorizan ningún cambio de tamaño.** Un proyecto puede reducirlas, nunca ampliarlas. Se usan coordenadas relativas al frame para que la posición del frame en el lienzo no afecte al resultado y para captar escalados indirectos de ancestros (restricciones `SCALE`, grupos reescalados).

### 3.6 Texto y oclusión: qué se demuestra y qué no (punto 6)

**Truncamiento o desbordamiento de texto.** Comprobaciones deterministas (implementación en H3):
1. `hasMissingFont` → `not_evaluable`: el render usa una fuente de sustitución y sus métricas no son fiables.
2. `characters` y segmentos idénticos a los de la maestra.
3. `textTruncation`/`maxLines` distintos de la maestra → `fail`. Si están activos en ambas y la caja cambia → `needs_review`, porque la API no indica si la elipsis está activa.
4. `renderBounds` fuera de su caja (cuando `textAutoResize = NONE`) o fuera de un ancestro que recorta → `fail`.
5. Altura de la caja con `HEIGHT` distinta de la maestra → aviso de posible cambio de saltos de línea. Si `allowReflow` es falso → `fail`.

**Limitaciones declaradas:** la API no expone el número de líneas, los saltos ni los glifos recortados. `renderBounds` no refleja el recorte por máscara, y `leadingTrim` y el interlineado pueden desplazar glifos respecto a la caja. Por eso un `pass` significa "**no detectado por estas comprobaciones**", no "demostrado sin truncamiento". La inspección visual complementa, pero no sustituye.

**Oclusión.** Se considera oclusor cualquier nodo visible pintado después (preorden) cuyo `renderBounds` corte al elemento:
- Ningún corte → `pass`, bajo el supuesto de que `renderBounds` es conservador (**se verificará en H2**).
- Corte que ya existía en la maestra con la misma geometría relativa y una relación aprobada → `pass` con referencia a esa línea base.
- Corte nuevo con un oclusor de opacidad demostrada (relleno `SOLID` sólido, opacidad 1, `NORMAL`, sin máscara, sin rotación) → `fail`.
- Cualquier otro corte (imágenes con alfa, formas no rectangulares, modos de fusión, efectos) → `needs_review`.

Los rectángulos envolventes **no** prueban la oclusión píxel a píxel.

### 3.7 Estados y agregación (punto 7)

| Estado | Significado | ¿Aprobable? |
|---|---|---|
| `pass` | La comprobación se ejecutó y no encontró infracción. | Sí (automático, si todo es `pass`) |
| `needs_review` | Se ejecutó y el resultado es ambiguo. | Solo por una persona, que queda registrada |
| `not_evaluable` | No se pudo ejecutar (faltan datos, fuente ausente, sin captura). | **No.** Hay que resolver la causa y volver a ejecutar |
| `fail` | Infracción demostrada. | **No.** No hay excepción posible |

Agregado por destino: `fail` > `not_evaluable` > `needs_review` > `pass`. **Se conservan las listas por estado**, sin colapsarlas en un único valor. La inspección visual solo puede **añadir** hallazgos o empeorar el estado, nunca mejorarlo. Implementado en `src/contracts/validation.ts`.

### 3.8 Inviabilidad demostrada frente a solución no encontrada (punto 8)

```ts
PlanOutcome =
  | { status: 'planned'; ops; ... }
  | { status: 'infeasible_proven'; certificate: Certificate[] }        // hechos comprobables por un validador independiente,
                                                                      // p. ej. "ancho del logo 412 px > rectángulo permitido más ancho 380 px"
  | { status: 'no_solution_found'; strategiesTried: string[]; bestAttemptFindings: Finding[] }
```

Ambos bloquean el destino. Solo `infeasible_proven` se comunica como "**inviable**", y su certificado se revalida. `no_solution_found` se comunica como "**no resuelto con las estrategias disponibles**" y puede requerir intervención manual.

### 3.9 Operaciones (punto 9)

Una sola lista, compartida por `allowOps` y por `Operation`: `translate`, `resize_text_box` y `recrop_background`. Las operaciones de frame `clone_master` y `resize_frame` no dependen de ninguna entidad. **`scale_uniform` se elimina**: el MVP no escala ningún elemento.

- `translate { entityId | atomicGroup, dx, dy }`: mueve todos los nodos de la entidad o del grupo con el mismo vector.
- `resize_text_box { entityId, width }`:
  - Precondiciones: nodo `TEXT` con `textAutoResize === 'HEIGHT'` en la maestra, `allowOps` que la incluya, `allowReflow = true` y sin `hasMissingFont`.
  - **Solo se fija el ancho.** La altura la recalcula Figma y el ejecutor la **lee** después. El planificador no la fija ni la supone.
  - No cambia `textAutoResize`, ni el texto, ni los estilos.
  - Con `NONE` o `WIDTH_AND_HEIGHT`, la operación **no está disponible**.
  - Antes hay que cargar las fuentes actuales del nodo.
- `recrop_background { entityId, imageTransform }`: requiere autorización explícita por entidad. Las `protectedRegions` deben seguir visibles. Desactivada por defecto.

**Cobertura en uniones de rectángulos.** Un elemento E (su `renderBounds` en coordenadas del frame; si está rotado, su caja alineada a los ejes, que es conservadora) está contenido en la unión `U = ∪ Aᵢ` si y solo si `E ∖ A₁ ∖ A₂ ∖ … = ∅`. Se implementa con resta sucesiva de rectángulos (cada resta produce hasta 4 fragmentos) y se exige que el área restante sea menor o igual que `ε_px²`. **Comprobar cada `Aᵢ` por separado es incorrecto**: un elemento que cruza el codo de una L quedaría rechazado aunque esté cubierto. Las exclusiones exigen `área(E ∩ Xⱼ) = 0`. Convención: intervalos semiabiertos `[x, x+w)`. La medida inclusiva de píxeles 90–989 se escribe `x=90, w=900`.

### 3.10 Hashes (punto 10)

- **Serialización canónica** (`src/hash/canonical.ts`):
  - Claves ordenadas por unidades UTF-16.
  - Sin espacios.
  - Números redondeados a 4 decimales, con `-0` convertido en `0`. `NaN`, `Infinity` y `undefined` se rechazan.
  - Arrays en su orden, que es significativo (hijos, rellenos, segmentos).
  - Cadenas **sin normalizar** (una "é" compuesta y una descompuesta dan hashes distintos, a propósito).
  - Formato: `sha256:` + hex sobre `{"v":"pcb.hash.v1","kind":…,"data":…}`.
  - Redondear a 1e-4 oculta cambios menores de 0,0001 px. Se acepta y queda documentado.
- **Detección de cambios en la maestra** (implementada): huella de la maestra frente a la del manifiesto aprobado, dividida en `structure` (IDs, tipos, padres, orden), `content`, `layout` y `metadata` (nombres). **Cualquier** diferencia invalida la aprobación. El diff por categoría solo sirve para que la persona entienda qué cambió.
- **Comparación maestra–clon** (H3, no implementada): usa proyecciones **sin IDs**, emparejadas mediante `NodeMapping`. Los IDs nuevos del clon, el nombre, el tamaño y la posición del frame raíz son diferencias **esperadas** y nunca cuentan como cambios de contenido.

---

## 4. Plan incremental

| Hito | Entrega | Escribe en Figma | Estado |
|---|---|---|---|
| **H0** | Node LTS fijado, lockfile, TypeScript con `tsc --noEmit` estricto, Zod, `node:test`, contratos, hash canónico, CLI. | No | **Cerrado** |
| **H1** | Script de lectura, ingesta con digest, MOCK, clasificador con evidencia, manifiesto con huella de reglas, vista de revisión, plantilla, aprobación y verificación de la maestra. | **No** | **Implementado y probado con MOCK; integración real pendiente** |
| H2 | Prueba P1–P8 en un archivo de pruebas con permiso de edición. | Solo en el archivo de pruebas | Bloqueado (permisos) |
| H3 | Validadores deterministas (logo, cobertura, texto, oclusión, dimensiones) y comparación maestra–clon. | No | — |
| H4 | Planificador con `PlanOutcome` de tres estados. | No | — |
| H5 | Ejecutor con relay e idempotencia. | Sí | — |
| H6 | Informe, inspección visual y aprobación. | No | — |

---

## 5. Decisiones pendientes

Bloquean la ejecución real de H1:
1. ~~URL de la maestra~~ Recibida: `PNVvElNrs9t2ShZNq72Sst`, nodo `4:90`.
2. **Autorización explícita para leerla mediante el MCP** (una llamada de solo lectura a `use_figma`).
3. **Permiso separado** si se obtienen o inspeccionan capturas. La lectura estructural no las necesita.
4. **Persona que aprobará el inventario.**

No bloquean la lectura estructural: el OCR (lo que no pueda determinarse queda indeterminado y se resuelve en la revisión humana) ni los cambios en `references/`.

Necesarias antes de H2 y siguientes:

6. Permiso de edición en un archivo de pruebas (no se puede resolver por vía técnica).
7. Si `use_figma` no permite leer con asiento Dev: ¿se autoriza leer por REST con un token personal en una variable de entorno?
8. Reglas de safe zone: qué se adopta, con qué procedencia y quién aprueba. Severidad de los recortes de grid (D4).
9. Operaciones permitidas por rol: ¿`resize_text_box`? ¿`recrop_background`?
10. Resoluciones de destino (4:5 en 1080×1350 o 1440×1800), TikTok y 3:4.
11. Taxonomía definitiva (la de `config/example.project.json` es una **propuesta**).
12. Convención de nombres y página de salida.
13. Si la exportación de activos se incluye en una fase posterior.

---

### 5.1 Pendientes técnicos registrados (sin ampliar alcance)

- **T1.** Validar `npm ci` y `npm run check` en Node 24.21.0, la versión declarada. Hasta ahora solo se han ejecutado en 25.6.1.
- **T2. Resuelto (2026-09-30).**
  - **Hashes de integridad exactos:** `pcb.hash.v2` usa la representación más corta que reproduce el mismo double, sin redondeo; solo normaliza `-0`.
  - **Tolerancias aparte:** las comparaciones geométricas con tolerancia están en `src/geometry/tolerance.ts`. `verify-master` muestra la magnitud (`maxNumericDelta`), pero la decisión la toma la huella exacta.
  - **Versionado:** las huellas llevan `version: pcb.fingerprint.v2`. Comparar huellas de versiones distintas se rechaza con error explícito.
  - **Consecuencia:** los manifiestos y las instantáneas anteriores (v1) no son comparables.

### 5.2 Primera lectura real (2026-09-29)

- Una única llamada a `use_figma` sobre `PNVvElNrs9t2ShZNq72Sst` / `4:90`, con el script `pcb.read-script.v1` (SHA-256 del enviado = SHA-256 del guardado).
- Resultado: el script **se detuvo en su propia validación**, `PCB_ROOT_MUST_BE_SCENE_NODE`. `4:90` es una **página**, no el frame de la maestra. No se generó payload ni se ejecutó la ingesta. No se modificó el documento.
- Hallazgo: con el asiento actual, `use_figma` **sí ejecuta** el script en este archivo y `getNodeByIdAsync` resuelve el nodo. Queda sin verificar la lectura completa de propiedades.
- Evidencia en `runs/2026-09-29-read-4-90/`, fuera de git: script, petición, llamada y resultado originales extraídos del registro de la sesión.

### 5.3 Segundo intento de lectura (2026-09-29)

- Antes de la llamada se añadió al script una **condición más estricta**, `pcb.read-script.v2`: la raíz debe ser `FRAME` y, si no lo es, el script se detiene antes de leer nada e informa del tipo real (`PCB_ROOT_TYPE_MISMATCH`). La ingesta comprueba lo mismo (`ROOT_TYPE_MISMATCH`). No se amplía lo que se acepta: solo se restringe.
- Una única llamada sobre `PNVvElNrs9t2ShZNq72Sst` / `4:141` (SHA-256 del script enviado = SHA-256 del guardado).
- Resultado: `PCB_ROOT_TYPE_MISMATCH expected=FRAME actual=SECTION`. `4:141` es una **SECTION**. No se leyó ningún nodo ni se ejecutó la ingesta.
- Evidencia en `runs/2026-09-29-read-4-141/`.

### 5.4 Descubrimiento desde el punto de entrada y tercer intento (2026-09-29)

- **Cambio de flujo:** se separan `entryNodeId` (el nodo del enlace del usuario, que puede ser página, sección u otro contenedor) y `masterNodeId` (la raíz de la composición).
  - Un script de descubrimiento de solo lectura (`pcb.discover-script.v1`) devuelve las coincidencias de nombre y los hijos directos.
  - El núcleo (`resolve-master.ts`) resuelve de forma determinista: nombre exacto y único, si no normalizado y único; con varios candidatos pregunta; si el tipo no es FRAME se detiene.
  - La relación `entry` se conserva en la instantánea y en el manifiesto y **no altera la huella de la maestra**.
- **Descubrimiento real sobre `4:141`** (SECTION "Imagen 2", página "Figma Agent + Claude Skill"): una única coincidencia, el FRAME `4:142` "960x1200_Taxdown_SVA2" de 960×1200, único hijo de la sección y con 36 descendientes. El nombre real usa `x` y el indicado `×`, así que se resolvió por `normalized_name`. Digest verificado.
- **Lectura del inventario sobre `4:142`:** el script llegó a Figma, pero **la respuesta llegó truncada a 20 KB** (marca `// truncated to 20kb`: 13 de 36 nodos). El registro de la sesión también la guarda truncada. La ingesta la rechaza (`ENVELOPE_NOT_FOUND`). No hay instantánea.
- **Ajuste propuesto (no implementado):** transporte por fragmentos, descrito en el mensaje al usuario. Requiere autorización para varias llamadas.

### 5.5 Inventario real completo (2026-09-30)

- **Transporte por fragmentos** (`pcb.read-script.v4`, `src/figma/chunks.ts`):
  - **Presupuesto:** 12 000 B UTF-8 por fragmento, medidos sobre el texto ya escapado como JSON. Tope de la respuesta completa: 16 384 B, frente al límite observado de 20 480.
  - **Contenido de cada fragmento:** `setId`, índice, total, longitudes y SHA-256 del fragmento y del payload completo.
  - **Ensamblado:** lo hace el código. Detecta fragmentos ausentes, duplicados (idénticos o incompatibles), desorden, truncamiento, alteraciones y mezcla de conjuntos.
  - **Límite:** exigir el mismo hash de contenido en todas las llamadas **detecta** inconsistencias, pero **no garantiza una captura atómica** de Figma. Un cambio que se revierta entre llamadas no es observable.
- **Hallazgo real: `hasMissingFont` no es estable entre llamadas.** Los textos en "Mutualidad" alternan entre `true` y `false` de una llamada a otra sin que nadie edite el archivo. Esto hizo que el payload variase entre tres estados (intentos 1 y 2, rechazados con `SET_MISMATCH`).
  - **Diagnóstico:** modo `node-digests` de solo lectura, con hash por nodo y registros completos de los nodos que varían.
  - **Corrección:** `hasMissingFont` sale del payload estable y pasa a `call.missingFontNodeIds`. La instantánea registra la observación de cada llamada, su unión y si fue estable (`environment`).
  - **Aprobación:** se bloquea si **cualquier** llamada observó una fuente ausente.
- **Intento 3:** 6 de 6 fragmentos del mismo conjunto (`set_b9bb2f62d2fbd569`). 36 nodos. Huella de la maestra `sha256:71ec4a08…`.
- **Correcciones del clasificador tras ver datos reales** (versión 2):
  - Los descendientes de una máscara son estructurales (`mask`).
  - Las pistas de rol comparan palabras completas: "Rectangle" ya no activa `cta`.
- **Limitación detectada, no resuelta:** la revisión humana no puede **fusionar entidades**. El logo real aparece como dos grupos de vectores (símbolo y marca denominativa) y la taxonomía exige exactamente un logo.

### 5.6 Primera adaptación DEMO 1080×1080 (2026-09-30): bloqueada por permisos de escritura

- **Propuestas del agente** (`pcb.agent-proposals.v1`, `src/inventory/proposals.ts`): roles para las 14 entidades y agrupaciones semánticas mínimas (logo = símbolo + logotipo + 4:160 adjunto; CTA = 4:155 + 4:156; bloque titular + importe), con evidencia estructural y visual (captura). Estado fijo `agent_proposal`: no se escriben en el manifiesto ni cuentan como revisión humana. La multiplicidad de la taxonomía se cuenta por unidad agrupada (el logo en dos entidades cuenta como uno).
- **4:160** se conserva: la ausencia de render bounds no prueba que sea irrelevante; se mueve con el logo.
- **Composición específica** (`pcb.demo-composition.v1`, `src/demo/plan.ts`), no un planificador universal: traslaciones rígidas por bloque (logo, titular+importe, foto+cinta+máscara, bloque inferior con su sombra), ensanche del degradado de oscurecimiento 4:146 (efecto no-contenido) y `resizeWithoutConstraints` del frame raíz. Margen de 54 px como **regla interna de demo**, no especificación oficial. El plan rechaza antes de tocar Figma: nodos en dos bloques, nodos dentro de frames intermedios, redimensionar imágenes, texto o el logo.
- **Script de escritura** (`pcb.adapt-script.v1`, `src/figma/adapt-script.ts`): solo escribe en un clon dentro de una sección de salida; guardas en tiempo de ejecución contra ids de la maestra; carga las fuentes existentes y se detiene si alguna falla (no sustituye); no duplica clones.
- **Validación** (`src/demo/check.ts`) sobre la relectura del clon: dimensiones, conservación de nodos/jerarquía/orden, contenido exacto, operaciones permitidas, logo bloqueado, zona interna de prueba, cobertura de fondo y región protegida, maestra intacta por hashes por nodo (`src/figma/digests.ts`) y revisión visual (solo puede empeorar el estado).
- **Resultado real:** `use_figma` rechazó la escritura: *"To use MCP tools that make edits, you'll need a Full seat"*. El script no llegó a ejecutarse. Comprobado después en solo lectura: los 36 hashes por nodo y el hash del payload de la maestra coinciden con el inventario (`b9bb2f62…`) y no existe ninguna sección ni clon nuevos. No se usó ninguna vía alternativa.
- **Para desbloquear:** una cuenta con asiento Full en el equipo del archivo (o que otra persona con asiento Full ejecute `runs/2026-09-30-demo-1080/adapt-request.json`). Después: releer el clon, captura, `demo-check`.

#### 5.6.1 Ejecución en la copia `UZgEPO8UUe9IDwTWitBbgF` (asiento Full)

- Descubrimiento `1:536` (SECTION) → maestra `1:537`. Lectura por fragmentos (6/6). Comparada sin IDs con `4:142`: **idéntica** (36 nodos, contenido y geometría relativa); composición y propuestas traducidas por correspondencia en preorden.
- **Fuentes:** en la copia "Mutualidad" no es cargable por el plugin (`loadFontAsync` falla), aunque el render del servidor la muestra. v1 del script se detuvo antes de clonar. v2: solo exige cargar fuentes si alguna operación toca la maquetación de un texto (aquí solo hay traslaciones) y nunca asigna `fontName`; además es todo-o-nada (si algo falla tras clonar, descarta su propio clon).
- **Fallo propio detectado en la relectura:** `figma.createSection()` crea en la página actual del plugin (la primera), no en la de la maestra. Corregido en v3 (`page.appendChild(section)` + comprobación `PCB_OUTPUT_NOT_ON_MASTER_PAGE`); la sección ya creada se trasladó a la página de la maestra con un script acotado a esa sección.
- **Fallo propio del validador:** un GROUP cuyos hijos se mueven por bloques distintos cambia de caja; su geometría es derivada y ahora se valida a través de sus hijos (prueba añadida).
- **Resultado:** clon `2009:122` en la sección `2009:121`. Deterministas 8/8 superadas; maestra intacta por hashes por nodo; revisión visual del agente: `needs_review` (corte vertical de la cinta en el borde de su máscara, oferta más alta sobre la persona, pie de foto recortado, fuente no cargable en este entorno). Estado: **DEMO pendiente de revisión humana**.

#### 5.6.2 Corrección de la cinta y repetibilidad (2026-09-30)

- **Causa del corte:** el borde recto (x=986,5) de la forma de máscara «Vector 3» (1:547); además el extremo de la cinta (1:548) quedaba dentro del frame en 1080 px. Ampliar solo la máscara habría dejado a la vista ese extremo; mover cinta+máscara habría roto el paso por detrás de los brazos.
- **Corrección mínima:** operación declarada `vectorEdits` (solo decoración o su máscara; nunca logo, texto ni imágenes): vértice final y tirador de llegada de la cinta → sale por el borde derecho; los dos vértices del borde recto de la máscara → x=1160. La máscara solo afecta a la cinta.
- **Actualización sin duplicar:** script v4 con modo `patch` sobre el clon existente, precedido de comprobación de hashes por nodo del clon (sin cambios manuales). Guarda `from` por vértice (idempotente; se detiene ante cambios ajenos).
- **Validador de GROUP:** su caja se deriva siempre de los hijos; rotación/escala, opacidad, fusión, máscara, efectos, recorte y modo de maquetación del contenedor se siguen comprobando. Nueva comprobación `vector_edits` con sondas antes/después.
- **Taxonomía:** rol propuesto `supplementary_info` («Más información…»); no hay evidencia de que sea texto legal.
- **Resultado:** deterministas 9/9 superadas; revisión visual `needs_review`. Procedimiento: `docs/01-demo-1080-procedimiento.md`.

## 6. Limitaciones declaradas de H1

- Sin OCR: ninguna imagen puede ser `image_no_text_detected` ni `image_embedded_text` salvo por **declaración humana**, que queda registrada como evidencia `human_statement`.
- La detección de texto vectorizado es solo una **pista** (agrupación de vectores alineados). Siempre requiere revisión.
- La composición "imagen con texto editable superpuesto" se propone por solape de `renderBounds` y orden de pintado. Es una propuesta, no una prueba.
- Un manifiesto **no se puede aprobar** si algún texto tiene `hasMissingFont`: la propia maestra se estaría leyendo con una fuente de sustitución.
- Los nodos ocultos quedan `pending`. Una persona decide si forman parte del contenido.

---

## 7. Seguridad y procedencia

- **MOCK es una procedencia, no un estado.** `source: "MOCK"` se conserva en la instantánea y en el manifiesto también **después de aprobar**: un manifiesto MOCK aprobado sigue siendo MOCK. No se puede aprobar un manifiesto contra una instantánea de otra procedencia (`SOURCE_MISMATCH`). Los informes MOCK lo indican en el título, la cabecera y el cierre, y el CLI antepone `[MOCK]` a sus mensajes.
- **`--by` (y `reviewer`) registran un nombre declarado. No autentican a ninguna persona.** Cualquiera que ejecute el CLI puede escribir cualquier nombre. `config.approvers` restringe qué nombres se aceptan, pero sigue siendo una comprobación sobre texto declarado. No hay firmas ni autenticación en H1.
- Los nombres de capa, los textos y los metadatos son datos. En la vista de revisión se muestran escapados dentro de bloques de código. Hay una prueba con un nombre de capa que imita una instrucción.
- No hay credenciales en el repositorio (`.gitignore` excluye `.env*` y `runs/`).
- No se envía ningún activo a servicios externos. El OCR local sigue sujeto a autorización.

---

## 8. Aprobación vinculada a reglas

`manifest.rules` guarda una huella canónica (`src/inventory/rules.ts`) de las reglas con las que se clasificó el inventario. `review-apply` y `approve` la recalculan con la configuración recibida y rechazan cualquier diferencia (`RULES_CHANGED_SINCE_INVENTORY`). La huella se calcula sobre el **contenido**, no sobre los identificadores: cambiar una pista de nombre o una multiplicidad sin tocar `taxonomy.version` también se detecta.

| Cubre | Motivo |
|---|---|
| `projectId` | Identidad del proyecto |
| `taxonomy.id`, `taxonomy.version`, `taxonomy.roles[*]` completos (id, label, multiplicidad, protección, safe zone, operaciones por defecto, pistas de nombre), **incluido su orden** | Clasificación (pistas), aprobación (multiplicidad) y restricciones heredadas |
| `tolerances` | Invariantes numéricas |
| `approvers` | Quién puede aprobar |
| `ocr` | Qué detectores intervienen en la clasificación |
| `heuristics` | Umbrales del clasificador |
| Código: `GLOBAL_INVARIANTS`, `NUMERIC_TOLERANCE_MAX`, `CLASSIFIER` (id y versión) | Una modificación del código de reglas también invalida la aprobación |

**Excluidos:** `schema` (formato), `status` (estado administrativo del archivo de configuración) y `visualReview` (afecta a H6, no al inventario).

Detalle de serialización: los números se codifican con su representación exacta (`String(n)`) antes del hash canónico, porque este redondea a 4 decimales y confundiría tolerancias como 1e-6 y 1e-7. Una prueba lo detectó.

---

## 9. Entorno

- **Node 24 LTS**, fijado en `24.21.0`: `.nvmrc`, `.node-version`, `engines` y `devEngines` en `package.json` (`>=24.21.0 <25`). Node 24 es la línea LTS activa a 2026-09-29 y ejecuta TypeScript quitando los tipos, sin pasos de compilación.
- **Dependencias exactas** (`.npmrc`: `save-exact=true`) con `package-lock.json`: `zod@4.6.5` (ejecución) y `typescript@7.0.2` y `@types/node@24.19.0` (desarrollo). Sin paquetes globales.
- `npm run typecheck` = `tsc --noEmit` estricto (`strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`). `npm run check` = typecheck + pruebas.
- **Pendiente:** las comprobaciones se han ejecutado en Node 25.6.1, el único disponible en la máquina. npm avisa (`EBADDEVENGINES`, sin fallar, `onFail: warn`). Falta ejecutarlas en Node 24.21.0, lo que requiere instalarlo con un gestor de versiones (acción del usuario).

---

## 10. Cambios v2 → v2.1

1. Se cierra H0: Node LTS fijado, lockfile, typecheck real y Zod en lugar del validador propio. Los contratos y el comportamiento se mantienen.
2. Se añade la huella de reglas en el manifiesto (§8).
3. Se documentan el alcance del SHA-256, la procedencia MOCK tras la aprobación y el significado de `--by` (§2.3, §7).
4. Se fija el estado de H1: "Implementado y probado con MOCK; integración real pendiente".

## 11. Cambios v1 → v2

1. Se separan los permisos de edición de las limitaciones del MCP. El plugin deja de ser una alternativa para los permisos.
2. Las safe zones separan procedencia (oficial, cliente o interna) y aprobación, sin herencia por proporción. La ausencia en nuestras referencias ya no se toma como prueba de que no existan.
3. Se añaden invariantes globales, restricciones por entidad que solo endurecen, atomicidad, regiones protegidas y relaciones.
4. Se añaden las disposiciones de nodo: contenido, estructural justificado y pendiente.
5. Las tolerancias del logo son solo numéricas, en coordenadas del frame.
6. Se declaran las limitaciones de las comprobaciones de truncamiento y oclusión, y se capturan los estilos de texto.
7. Se define la agregación de estados con cuatro significados distintos.
8. Se distingue inviabilidad demostrada de solución no encontrada.
9. Se elimina `scale_uniform`, se define `resize_text_box` (solo ancho) y la cobertura de uniones por resta.
10. Se define la serialización canónica y se separa la detección de cambios en la maestra de la comparación con el clon.
11. Se conserva la respuesta original y se añade un digest de transporte. La validación estructural no prueba fidelidad.
12. Se corrigen S1 (la exportación se aplaza, no estaba prohibida) y S3 (nombrar herramientas frente a presuponerlas).
