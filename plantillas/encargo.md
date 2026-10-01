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
- **Logo:** solo se traslada. Esta regla es fija: ni escala, ni recorte, ni rotación.
- **Copy:** no se añade, elimina ni reescribe nada.
- **Texto** (marca lo permitido en esta prueba):
  - ☐ solo trasladar (por defecto)
  - ☐ se puede proponer reflujo (cambio de ancho de caja)
  - ☐ se puede proponer cambio de cuerpo, entre ___ % y ___ % del original
  > El piloto solo **ejecuta** traslaciones de texto. Reflujo y cambios de cuerpo se **proponen**
  > con valores concretos y esperan tu visto bueno.
- **Fuentes:** no se sustituyen nunca.
- **Imágenes:** ☐ se pueden escalar proporcionalmente ☐ solo trasladar
- **Decoración** (formas, cintas, fondos decorativos): ☐ se puede adaptar ☐ solo trasladar
- **Otras reglas de esta marca:**

## 6. Entrega esperada
- Enlace al clon y captura limpia.
- Captura con la safe zone superpuesta (generada fuera de Figma; la guía nunca entra en la creatividad).
- Validaciones (`check/report.md`) y dudas.
- Registro de la prueba (`registro-prueba.json`): tiempo, llamadas a Figma, intervenciones humanas, cambios técnicos.
