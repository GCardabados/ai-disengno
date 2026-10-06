# Estado del proyecto AI Diseño

Fecha de corte: 2026-10-01.
Fuente: conversación histórica aportada por el responsable.
Este documento no implica una inspección nueva del repositorio.

## Propósito

Crear un repositorio para automatizar procesos de diseño.
La primera skill adapta piezas maestras estáticas de Figma a otros
tamaños, preservando contenido, logo y safe zones.

El sistema debe identificar elementos, distinguir su función semántica
de su representación técnica y permitir validar las adaptaciones.

Debe distinguir especialmente:
- Texto editable.
- Imagen con texto incrustado.
- Imagen con texto superpuesto en nodos independientes.
- Texto vectorizado.
- Composiciones mixtas.

## Entorno

Repositorio:
https://github.com/GCardabados/ai-disengno

Desarrollo y ejecución: Claude Code.
Integración utilizada: MCP de Figma con ejecución de Plugin API.
Núcleo: TypeScript, Zod y pruebas automatizadas.

El agente de WPP Open acompaña y revisa; no se presupone que ejecute
las herramientas disponibles en Claude Code.

## Capacidades demostradas según el historial

- Descubrir una maestra desde enlaces a secciones o contenedores.
- Separar entryNodeId de masterNodeId.
- Leer estructura real de Figma.
- Transportar resultados por fragmentos para evitar truncamientos.
- Ensamblar y validar snapshots.
- Inventariar elementos y proponer roles.
- Agrupar semánticamente entidades compuestas.
- Crear clones y actualizar salidas.
- Adaptar composiciones y determinadas geometrías decorativas.
- Conservar la maestra y comprobar el logo.
- Releer resultados y producir informes.
- Ejecutar el flujo desde una skill de Claude Code.

El alcance exacto de operaciones y contratos debe comprobarse en
el código vigente si resulta necesario.

## Pruebas realizadas

### Primera maestra: 1080×1080
- Demo aceptada por el usuario.
- Se corrigió la salida de una cinta decorativa.
- Frame: 2009:122.
- Aceptación limitada a esa versión, no publicación.

### Primera maestra: 1200×628
- Primera versión no aprobada.
- Problemas: orden del CTA, cinta fragmentada y poco espacio.
- Segunda versión evaluada con 85/100 y aceptada con observaciones.
- Frame aceptado: 2075:121.
- Run:
  runs/2026-10-01-copy-UZgE-1200x628-v2/

### Segunda maestra: Imagen 5 → 1080×1920
- Maestra: 28:140, 960x1200_PAM_Meta_2.
- Entrada: sección 28:139.
- Resultado: frame 2096:122.
- Valoración visual del usuario: 65/100.
- Cumplimiento percibido de safe zones: aproximadamente 95 %.
- No equivale a una medición automática ni a cumplimiento completo.
- Claude reportó unos 29 minutos, 19 lecturas, 1 escritura,
  2 capturas y ningún cambio de código.
- Run:
  runs/2026-10-01-copy-UZgE-imagen5-1080x1920/

En esta ejecución se utilizó una zona interna basada en fuentes secundarias.
No consta que se aplicara la plantilla de safe zones aportada por el usuario.
Debe aclararse la correspondencia antes de afirmar cumplimiento.

## Estado actual

El flujo funciona con más de una maestra.
La reutilización técnica está demostrada de forma inicial.
La calidad visual es variable y sigue requiriendo revisión humana.

La prioridad ya no es aumentar infraestructura:
es preparar un piloto compartible para miembros del equipo.

## Próxima tarea propuesta, todavía no confirmada como ejecutada

1. Adaptar Imagen 5 a un formato horizontal.
2. Utilizar la plantilla de safe zones de Figma aportada por el usuario.
3. Entregar captura limpia y con superposición de la guía.
4. Preparar instalación, configuración y primera prueba para compañeros.

Faltan en este resumen el tamaño horizontal definitivo y el enlace
exacto a la plantilla correspondiente.

## Pendientes

- T1: validar instalación y tests en la versión declarada de Node.
  Se reportó Node 24.21.0 declarado y ejecución en 25.6.1.
  Confirmar compatibilidad y disponibilidad al preparar el piloto.
- Verificar cómo se ingieren las safe zones diseñadas en Figma.
- Mejorar composición sin desarrollo específico en cada pieza.
- Comprobar disponibilidad de fuentes cuando una operación las necesite.
- Revisar qué material de runs/ está autorizado para compartirse.
- Probar onboarding con compañeros que no conocen el proyecto.

T2 —separación de hashes exactos y tolerancias geométricas— figura
resuelto en el historial.

## Preferencias del responsable

- Quiere avanzar hacia un producto funcional y compartible.
- Prefiere autonomía técnica y pocas interrupciones.
- No quiere acumular restricciones temporales como reglas permanentes.
- Prefiere prompts concretos para Claude Code.
- No quiere repetir auditorías ni reconstruir funcionalidades existentes.