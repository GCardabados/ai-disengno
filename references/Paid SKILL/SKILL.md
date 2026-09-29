---
name: paid-creative-builder
description: Orquesta la creación y adaptación de piezas de publicidad paid (Meta Ads e Google Ads) en Figma, partiendo de una pieza maestra ya diseñada y generando el resto de tamaños/formatos exigidos por cada plataforma según las especificaciones oficiales vigentes. Actívala siempre que el usuario pida crear anuncios, banners, creatividades paid, adaptar/redimensionar una pieza a varios formatos, o mencione Meta Ads, Facebook/Instagram Ads, Google Ads, Display, Demand Gen, Performance Max, Feed, Stories, Reels, Lead Ads, o "adaptaciones" de una campaña publicitaria — incluso si el usuario no la nombra explícitamente. Es la skill que debe arrancar la conversación cuando alguien empieza a trabajar en un encargo de piezas paid (por ejemplo, tras un simple "hola" al abrir un proyecto de este tipo).
---

# Paid Creative Builder

Ayuda a crear el set completo de piezas de un anuncio paid a partir de UNA pieza maestra ya maquetada en Figma, generando el resto de formatos/tamaños que exige cada plataforma (Meta Ads, Google Ads) sin perder marca, mensaje ni jerarquía visual.

Esta skill es genérica a propósito: no asume cliente, cuenta de Figma, sistema de diseño ni objetivo de campaña. Todo eso se pregunta al arrancar, porque cada proyecto (cada cuenta/cliente) tiene su propio archivo de Figma, su propio branding y sus propios formatos objetivo. No la conviertas en algo hardcodeado para un único cliente.

## Flujo de inicio (obligatorio, siempre antes de tocar Figma)

En cuanto esta skill entra en juego — porque el usuario pide piezas paid, adaptaciones de un anuncio, o simplemente saluda ("hola") para arrancar un encargo de este tipo — abre la conversación reuniendo estos datos. No avances a producir nada en Figma sin tenerlos:

1. **Qué se necesita crear o adaptar**: ¿es una pieza nueva desde cero o adaptaciones de una ya existente? ¿Qué tipo de piezas (imagen estática, carrusel, vídeo, Stories/Reels)? ¿Para qué plataforma(s) — Meta, Google Ads, o ambas — y, si lo sabe, para qué campaña/objetivo (awareness, tráfico, leads, conversión)? El objetivo de campaña importa porque cambia qué formatos son obligatorios (p. ej. Lead Ads en Meta pide medidas distintas al Feed estándar).
2. **En qué archivo de Figma se va a trabajar**: pide el link del archivo (y la página/frame si ya lo tiene claro). Si no existe todavía un archivo, pregunta si hay que crear uno o si se debe partir de un archivo de plantillas de la cuenta.
3. **La pieza maestra**: exige que exista ya un diseño maestro completo — con todos los elementos que las adaptaciones van a necesitar (logo, imagen/producto, titular, cuerpo de texto, CTA, disclaimers legales, colores/tipografías de marca) — antes de generar el resto de tamaños. Si no existe, no improvises una desde cero por tu cuenta: dile al usuario que hace falta esa pieza base primero (puede diseñarla él, pedirte que la construyas como un paso previo explícito, o señalarte un componente/frame ya existente en el archivo que cumpla ese rol). Generar adaptaciones sin una maestra fiable produce piezas inconsistentes entre sí.
4. **Idiomas y variantes de copy**, si aplica (una campaña multi-mercado puede necesitar el mismo set de tamaños en varios idiomas).
5. **Qué entregable final espera**: ¿los frames dentro de Figma son suficientes, o también hay que exportar los assets (PNG/JPG/MP4) con una convención de nombres concreta para subirlos al gestor de anuncios? Si hace falta exportar, pregunta la convención de nombres que usa la cuenta (cliente_plataforma_formato_tamaño_idioma suele ser un buen punto de partida si no tienen una propia).

Si el proyecto ya tiene un sistema de diseño documentado (tokens, tipografías, reglas de contraste, etc. — por ejemplo, en memoria o en un archivo del propio proyecto), respétalo en vez de improvisar estilos nuevos.

## Determinar los tamaños exactos por plataforma

Nunca inventes ni "redondees de memoria" las dimensiones de un formato publicitario: Meta y Google las cambian con cierta frecuencia, y un tamaño mal exportado puede rebotar en el gestor de anuncios o publicarse recortado.

1. Consulta primero las tablas ya recopiladas en:
   - [references/google-ads-specs.md](references/google-ads-specs.md)
   - [references/meta-ads-specs.md](references/meta-ads-specs.md)
2. Esas tablas están verificadas a fecha 2026-09-17, pero pueden haber cambiado. Si el formato que necesitas no está cubierto, si hay dudas, o si el encargo es para un entregable real (no un boceto interno), verifica en vivo contra la fuente oficial antes de fijar el tamaño final:
   - Google Ads: https://support.google.com/google-ads/answer/13676244 (índice) y los enlaces específicos por tipo de campaña listados en el reference.
   - Meta: https://www.facebook.com/business/ads-guide (herramienta interactiva: elige objetivo + ubicación + formato)
3. Si el usuario no tiene claro qué formatos necesita, propón el set mínimo razonable según la plataforma elegida (ver "tamaños seguros más usados" al final de cada reference) y confírmalo con él antes de producir nada.

## Generar las adaptaciones en Figma

Esta skill decide **qué** hay que crear (tamaños, formatos, cantidad) y **con qué criterio de marca**, pero no debe reinventar cómo manipular Figma a bajo nivel — eso ya existe como herramienta dedicada en este entorno y hay que delegárselo:

- Usa las skills/herramientas de Figma ya disponibles (`figma-use`, `figma-generate-design`, `get_design_context`, `get_screenshot`, `use_figma`) para leer la pieza maestra, entender sus componentes/auto-layout, y construir cada adaptación redimensionando y reordenando esos mismos elementos — no recreando todo desde cero a mano ni describiendo el resultado en texto.
- Si el conector de Figma no está autorizado en la sesión, dile al usuario que necesita autorizarlo (vía `claude mcp` o los ajustes de conectores) antes de poder ejecutar cambios reales en el archivo.
- Para cada adaptación nueva: parte de la pieza maestra, aplica el tamaño/relación de aspecto objetivo, reajusta jerarquía (qué se recorta, qué se reescala, qué cambia de posición) para que el mensaje principal y el CTA sigan siendo legibles, y respeta zonas de seguridad cuando el formato las tenga (p. ej. Stories/Reels).
- Nombra los frames de forma consistente y trazable al formato de origen (cliente_plataforma_ubicación_tamaño), para que sea fácil auditar qué falta o qué sobra.

## Qué NO hacer

- No generes tamaños "a ojo" sin contrastarlos con las referencias o la fuente oficial.
- No produzcas el set completo de adaptaciones si todavía no hay una pieza maestra validada — para ahí y pregunta primero.
- No asumas un único cliente, cuenta de Figma o paleta de marca: cada vez que se invoque la skill en un proyecto nuevo, vuelve a preguntar los datos del flujo de inicio.
- No exportes ni publiques nada fuera de Figma sin que el usuario confirme la convención de nombres y el destino.
