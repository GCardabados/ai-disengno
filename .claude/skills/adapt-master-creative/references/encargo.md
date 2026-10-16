# Encargo de adaptación (prueba interna)

> Copia este archivo a `runs/<AAAA-MM-DD>-<nombre-corto>/encargo.md`, rellénalo y pásaselo a Claude Code
> (`/adapt-master-creative runs/<…>/encargo.md`). `runs/` está fuera de Git: nada de lo que pongas aquí se sube
> salvo que lo decidas.
> Todo lo que escribas aquí es configuración de esta prueba. Nada se convierte en regla para otras piezas.

## 1. Prueba
- **Nombre:** <!-- p. ej. «Imagen 5 horizontal» -->
- **Quién revisa y acepta:** <!-- nombre declarado; no es una autenticación -->
- **Uso:** prueba interna (no publicación) <!-- cambia solo si se acuerda otra cosa -->

## 2. Maestra
- **Enlace de Figma con `node-id`:** <!-- https://www.figma.com/design/<archivo>/…?node-id=12-345 -->
- **Nombre exacto del frame maestro** (solo si el enlace apunta a una sección o página con varias piezas):
- **Permiso:** tengo asiento **Full** en ese archivo ☐ / trabajo sobre una copia del archivo ☐
  <!-- con asiento View o Dev se puede leer, pero no crear el clon -->

## 3. Destinos
| Nombre | Ancho × alto (px) | Emplazamiento (feed, stories, reels, display…) |
|---|---|---|
| | | |

## 4. Safe zone por destino
Marca **una** opción por destino:
- ☐ **Plantilla en Figma:** enlace con `node-id` de la sección o frame de guías:
  - Plantilla (si hay varias del mismo tamaño, p. ej. «Reel» o «Story»):
  - Capa (si la plantilla tiene varias, p. ej. «System Icons / UI Elements»):
  - Procedencia: ☐ cliente ☐ interna ☐ especificación oficial de la plataforma
  - Si no hay plantilla de ese tamaño exacto: ☐ no aplicar safe zone ☐ parar y preguntar
- ☐ **Sin safe zone** (solo el frame).
- ☐ **Margen interno de prueba** de ___ px por lado. Se declara como regla interna, no como especificación.

> El agente no escala una plantilla de otro tamaño ni la sustituye por porcentajes de terceros. Si hay
> ambigüedad, pregunta.

## 5. Reglas de marca y contenido
- **Logo** (nunca se deforma, rota, recorta, sustituye ni se cambia por dentro):
  - ☐ estándar: tamaño fijo, solo se traslada (por defecto)
  - ☐ **experimental**: se permite escalarlo proporcionalmente para este encargo. Factor máximo: ___.
    Autoriza: ___. El resultado se marcará como EXPERIMENTAL.
- **Copy:** no se añade, elimina ni reescribe nada. Cambiar saltos de línea no es reescribir.
- **Texto** (el texto no tiene tamaño ni posición fijos; marca lo permitido en esta prueba):
  - ☐ posición ☐ alineación ☐ ancho/alto de caja y reflujo ☐ saltos de línea ☐ cuerpo ☐ interlineado
  - Límites de la marca (déjalos vacíos si no los hay; el agente no inventa mínimos):
    cuerpo entre ___ % y ___ % del original; cuerpo mínimo ___ px.
  - Legales: ☐ no se reducen ☐ se pueden reducir hasta ___ % (autoriza: ___).
  - Tipografía (familia y estilo): no cambia salvo autorización específica: ___.
- **Fuentes:** no se sustituyen nunca. Si una fuente no está disponible en el entorno, el agente lo informa y esos
  textos solo se trasladan.
- **Persona o producto** (si los hay): ¿hacia dónde mira o señala la persona, y qué debe quedar protegido? ___
  (si no se indica, el agente lo propone y registra la decisión).
- **Mensaje:** principal ___ · secundarios ___ · oferta ___ · CTA ___ (si no se indica, el agente lo propone).
- **Imágenes:** ☐ se pueden escalar proporcionalmente ☐ solo trasladar
- **Decoración** (formas, cintas, fondos decorativos): ☐ se puede adaptar ☐ solo trasladar
- **Otras reglas de esta marca:**

## 6. Entrega esperada
- Enlace al clon y captura limpia.
- Captura con la safe zone superpuesta (generada fuera de Figma; la guía nunca entra en la creatividad).
- ☐ Superposición de atención estimada con flechas y numeración del recorrido de lectura (separada de la
  creatividad; es una estimación heurística del agente, no atención medida, y no lleva porcentajes).
- Validaciones (`check/report.md`) y dudas.
- Registro de la prueba (`registro-prueba.json`): tiempo, llamadas a Figma, intervenciones humanas, cambios técnicos.
