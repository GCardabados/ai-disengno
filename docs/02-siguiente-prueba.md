# Siguiente prueba con otra maestra — resumen

## Cómo invocar
En Claude Code, dentro de este repo: *"Adapta esta pieza de Figma a estos tamaños: <enlace con node-id> → 1200×628, …"*.
Se usa la skill `.claude/skills/adapt-master-creative/SKILL.md` (procedimiento: `docs/01-demo-1080-procedimiento.md`).

## Qué datos necesita
- Enlace de Figma con `node-id` (entrada) y nombre del FRAME maestro si hay varios candidatos.
- Asiento **Full** en ese archivo (con View/Dev no se puede escribir el clon).
- Tamaños destino y, por cada uno, la zona segura **con procedencia** (regla oficial/cliente) o un margen de prueba
  declarado como tal.
- Configuración del proyecto: taxonomía de roles y transformaciones permitidas por elemento (en especial del texto).
- Quién revisa y acepta (nombre declarado para `record-acceptance`).

## Qué resuelve automáticamente
- Localizar la maestra, inventariarla por fragmentos y verificar que no cambia (hashes por nodo).
- Proponer roles, bloques rígidos y regiones protegidas (propuestas, no aprobaciones).
- Proponer una composición por destino, predecirla sin tocar Figma (`precheck`) y escribirla en un clon o una copia
  (`create` / `patch` / `copy`), con traslaciones, efectos, escala proporcional de imágenes y edición de decoraciones.
- Validar: estructura, contenido, logo, zona segura, cobertura, orden de lectura y CTA, máscaras, visibilidad y
  mediciones geométricas; entregar enlace, captura e informe.

## Limitaciones vigentes
- Texto flexible dentro de los límites del proyecto (`textPolicy`), salvo textos dentro de contenedores con
  maquetación automática; sin sustituir fuentes (si no cargan, solo se trasladan).
- Logo: tamaño fijo en modo estándar; escala proporcional solo en modo experimental activado por el encargo.
- Sin OCR; la revisión visual del agente no sustituye a la humana.
- Los activos recortados limitan el encuadre (p. ej. un recorte que termina en la cintura).
- Las decoraciones que pasan por detrás de una persona exigen trazar máscaras sobre la silueta; se simulan antes.
- Validado en Node 24.21.0 (versión fijada) y 25.6.1. Márgenes de prueba de 54 px no son especificación.
- Para compañeros: empezar por `docs/03-guia-inicio.md` y `plantillas/encargo.md`.

## Qué registrar en la siguiente ejecución
Rellenar `docs/02-registro-prueba.template.json` (copiarlo a la carpeta de la ejecución):
tiempo, llamadas a Figma (lectura/escritura/capturas), intervenciones humanas, cambios de código y valoración.
