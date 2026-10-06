# Guía de inicio: tu primera prueba de adaptación

Piloto **interno** para adaptar una pieza maestra de Figma a otros tamaños con Claude Code. No hay aplicación web.
El agente crea **clones** en una sección de salida y nunca modifica la maestra. El resultado es siempre
«DEMO pendiente de revisión humana».

## 1. Preparar el entorno (una vez)

1. **Clona el repositorio** y abre la carpeta en Claude Code.
2. **Instala Node 24.21.0.** Es la versión fijada en `.nvmrc`; con nvm basta `nvm install && nvm use`.
3. **Instala las dependencias y comprueba el entorno:**
   ```bash
   npm ci
   ```
   ```bash
   npm run doctor
   ```
   ```bash
   npm run check
   ```
   `doctor` revisa Node, dependencias, Python, configuración y `.gitignore`, y explica qué falta. No instala nada.
   Python 3 es necesario para extraer las evidencias del registro de la sesión. Las mediciones y superposiciones
   necesitan además numpy y Pillow: `pip install numpy pillow`.
4. **Conecta el servidor MCP de Figma en Claude Code** y autorízalo con tu cuenta. Para crear clones necesitas
   **asiento Full** en el archivo. Con asiento View o Dev se puede leer, pero no escribir; en ese caso trabaja en
   una copia del archivo.
5. **Prueba sin Figma:**
   ```bash
   npm run ejemplo
   ```
   Recorre lectura simulada, inventario, plan, predicción y script de escritura con una maestra sintética. El
   resultado queda en `runs/ejemplo-offline/`, que está fuera de Git.

## 2. Preparar tu prueba

1. Crea la carpeta `runs/<AAAA-MM-DD>-<nombre-corto>/` y copia ahí
   [`plantillas/encargo.md`](../plantillas/encargo.md).
2. Rellena el encargo: maestra, destinos, safe zone y reglas de texto (ver §4).
3. En Claude Code escribe:
   ```text
   /adapt-master-creative runs/<AAAA-MM-DD>-<nombre-corto>/encargo.md
   ```

## 3. Qué hace el agente y cuándo te pregunta

1. **Comprueba el entorno** con `doctor` y el conector de Figma.
2. **Lee la maestra** desde el enlace, en solo lectura, y propone roles: logo, titular, CTA, legal…
3. **Resuelve la safe zone.** Si das una plantilla, la lee y la elige **solo por tamaño exacto**. Te pregunta si
   hay varias candidatas (p. ej. Reel y Story del mismo tamaño) o si ninguna corresponde. Nunca escala una
   plantilla de otro formato.
4. **Compara un par de distribuciones,** elige una y predice el resultado sin tocar Figma (`precheck`).
5. **Crea el clon,** lo relee y comprueba estructura, contenido, logo, zona segura y sus exclusiones, orden de
   lectura, visibilidad y que la maestra no ha cambiado.
6. **Te entrega:**
   - el enlace;
   - la captura limpia;
   - la captura con la safe zone superpuesta, hecha fuera de Figma;
   - el informe;
   - las dudas;
   - el registro de la prueba.

**Para y pregunta** cuando la decisión es de diseño o de marca, cuando falta un permiso, o cuando algo solo se
resolvería relajando una regla. Ejemplos: un texto que no cabe sin cambiar el cuerpo, o una safe zone ambigua.

## 4. Dónde se configura cada cosa

Ninguna de estas cosas requiere editar código.

| Qué | Dónde | Quién lo escribe |
|---|---|---|
| Maestra (archivo, nodo, nombre) y destinos | `runs/<prueba>/job.json` (`pcb.adapt-job.v1`; se valida con `node src/cli.ts job-check --job …`) | El agente, a partir del encargo |
| Safe zone de un destino | `composition.json` → `safeArea`. Hay tres tipos (ver la lista bajo la tabla) | El agente, con tu decisión del encargo |
| Composición del destino | `runs/<prueba>/<destino>/composition.json`: bloques que se mueven, imágenes que se escalan, decoración que se edita, orden de lectura | El agente; tú la revisas |
| Límites de texto del proyecto | `config/<proyecto>.project.json` → `textPolicy`: qué es editable (`editable`), rango de cuerpo (`fontScale`) y cuerpo mínimo (`minFontSizePx`). Sin límites configurados no se inventan mínimos. Parte de `config/example.project.json` | Una persona del proyecto |
| Ediciones de texto de un destino | `composition.json` → `textEdits` (caja, alineación, saltos, cuerpo, interlineado) y `legalNodeIds` | El agente, dentro de los límites |
| Modo del logo en el encargo | `composition.json` → `logoPolicy`: `standard` (por defecto) o `experimental` con `scale` y `authorization` | Tú, en el encargo |
| Mensaje, persona y recorrido | `composition.json` → `messagePlan` (principal, secundarios, oferta, CTA, persona/producto y su señal, recorrido previsto) | El agente; tú lo revisas |
| Persona que acepta | `record-acceptance --by "Nombre"`, solo cuando tú lo pides | El agente, a petición tuya |

Tipos de `safeArea`:
- **Plantilla de Figma:** `safe_zone_rule` con `allowed`, `exclusions`, `provenance` y `source`. Sale de
  `safe-zone-template-request` y `safe-zone-resolve`.
- **Sin safe zone:** `internal_demo_rule` con `marginPx: 0`.
- **Margen interno declarado:** `internal_demo_rule` con `marginPx`.

Las invariantes están en el código y ningún encargo puede relajarlas:
- La maestra no se toca.
- No se añade, quita ni reescribe contenido. Cambiar saltos de línea no es reescribir.
- El logo nunca se deforma, rota, recorta, sustituye ni se cambia por dentro. Su tamaño es fijo salvo que el encargo
  active el modo experimental.
- No se sustituyen fuentes, y la tipografía no cambia sin autorización específica.

## 5. Después de la prueba

- Revisa el clon en Figma y da tu valoración. El agente la anota en el registro de la prueba.
- Si la versión vale como demo, pide expresamente: «registra mi aceptación de esta versión». La aceptación queda
  ligada por huellas a ese clon concreto y no es una autorización de publicación.
- Las carpetas de `runs/` no se suben a Git. Si se decide conservar una, se versiona con `git add -f`.

## 6. Limitaciones del piloto

[Plantilla de encargo](../plantillas/encargo.md) · [Skill](../.claude/skills/adapt-master-creative/SKILL.md) ·
[Procedimiento detallado](01-demo-1080-procedimiento.md)

- **Texto:** se ejecutan caja, alineación, saltos de línea, cuerpo e interlineado, pero no en textos dentro de
  contenedores con maquetación automática (p. ej. el texto de un botón), porque cambiaría el contenedor. Requiere que
  la fuente cargue en el entorno; si no carga, se informa y solo se traslada.
- **Logo experimental:** la forma interna de cada vector se valida por su caja, no por sus vértices. El render lo
  confirma la captura.
- **Atención:** la superposición de atención es una estimación heurística del agente, no atención medida.
- **Orden de lectura:** la comprobación automática sigue filas y pilas. En composiciones a dos columnas se declara
  la secuencia comprobable, y el resto lo juzga la revisión visual.
- **Fuentes:** si la fuente de la marca no se puede cargar en el entorno (`text-capabilities-check`), los textos se
  trasladan igualmente, pero no se puede editar su cuerpo, caja ni saltos. Es una limitación del entorno, no de la marca.
- **Plantillas de safe zone:** la forma permitida se reconoce por nombre (*square*, *permitido*, *allowed*), y las
  demás formas de la capa se tratan como exclusiones. Hay que confirmarlo en la captura superpuesta.
- **Llamadas a Figma:** el MCP limita el tamaño de respuesta, así que una maestra se lee en varios fragmentos
  (unas 7 llamadas por pieza de tamaño medio).
- **Revisión visual:** la del agente no sustituye a la humana. No hay OCR.
