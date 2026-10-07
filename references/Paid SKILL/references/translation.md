# Modo traducción: traducir piezas existentes en Figma

Lee este archivo solo cuando el encargo sea traducir/localizar piezas que ya existen en Figma (no crear ni adaptar tamaños). El objetivo es producir la versión en el idioma destino de cada frame sin romper maquetación ni marca, con el usuario validando el copy antes de tocar Figma y gastando los mínimos tokens posibles.

El flujo tiene dos puntos de parada obligatorios: la **confirmación del copy** (paso 3) y, si falla alguna fuente, la **decisión sobre la fuente** (paso 4). No escribas nada en Figma antes de superarlos: corregir una tabla cuesta mucho menos que rehacer frames, y una fuente sustituida sin avisar puede llegar a publicarse fuera de marca.

## 1. Preguntas previas (una sola ronda, agrupadas)

Pregunta solo lo que no se deduzca del mensaje del usuario:

- **Alcance**: link de Figma con `node-id` de la página/sección/frames a traducir, y cuál es la **pieza maestra**: el frame del que se extraen y etiquetan los textos. Si el usuario no la indica, usa el frame de mayor tamaño o el que se llame "master"/"maestra", y dilo.
- **Idioma y variante**: el que pida el usuario. En inglés, pregunta si es en-US o en-GB solo si el mercado no está claro, porque afecta a la ortografía (color/colour) y a los formatos de precio y fecha.
- **Dónde dejar el resultado**: por defecto, duplicar los frames junto a los originales con sufijo de idioma (`_EN`, `_FR`…), sin sobrescribir el original. Sobrescribe solo si el usuario lo pide explícitamente: el original suele seguir haciendo falta para el mercado local.
- **Términos que no se traducen**: marca, producto, claims registrados, hashtags. Si la cuenta tiene glosario o memoria con estos términos, úsalo sin preguntar.
- **Legales**: tradúcelos, pero márcalos en el informe como "pendiente de validación legal", porque suelen requerir un texto aprobado por el cliente.

## 2. Extraer y etiquetar los textos de la pieza maestra (barato)

No uses `get_design_context` ni `get_screenshot` para esto: devuelven código, estilos e imágenes que no hacen falta para traducir y multiplican el coste en tokens. Si necesitas saber qué frames hay bajo un nodo, usa `get_metadata` (solo estructura).

Ejecuta con `use_figma` el script [scripts/extract-texts.js](../scripts/extract-texts.js) con el id de la pieza maestra y, si hay más, los de las adaptaciones. En una sola llamada devuelve:

- `fields`: los textos de la pieza maestra en orden de lectura (de arriba abajo y de izquierda a derecha), cada uno con su etiqueta (`Texto 1`, `Texto 2`…), el nombre de la capa en Figma y si mezcla estilos (p. ej. una palabra en negrita).
- `extra`: textos que solo aparecen en las adaptaciones y no en la maestra. Se etiquetan a continuación (`Texto N+1`…).
- `fonts`: las fuentes usadas y si se pueden cargar. Se comprueba aquí para no gastar una llamada extra (ver paso 4).

Las adaptaciones de una misma campaña comparten copy, así que cada texto único se traduce una sola vez aunque aparezca en 12 tamaños.

## 3. Traducir y pedir confirmación (parada obligatoria)

Traduce todos los campos en una sola pasada y presenta **dos bloques** con las mismas etiquetas, para que el usuario pueda comparar línea a línea y referirse a cada campo por su número:

```
Original (ES)
Texto 1 · Titular: Nueva emisión limitada del Plan Ahorro Multiplica
Texto 2 · CTA: Más información
Texto 3 · Legal: Rentabilidad sujeta a condiciones…

Traducción (EN)
Text 1 · Titular: New limited issue of the Multiplica Savings Plan
Text 2 · CTA: Learn more
Text 3 · Legal: Returns subject to terms… ⚠ pendiente de validación legal
```

Después de las dos listas, pregunta si confirma el copy o quiere cambiar algún texto, por ejemplo: "¿Lo doy por bueno o quieres cambiar algún texto? Puedes decirme algo como *Text 1: …*". Si el usuario modifica un campo, actualiza solo ese, vuelve a mostrar únicamente los campos cambiados y pide confirmación otra vez. No pases al paso 4 sin un OK explícito.

Usa la etiqueta en el idioma de cada bloque (`Texto` en el original, `Text` en inglés, `Texte` en francés…) y conserva el nombre de capa de Figma tal cual. Así el usuario lo localiza en el panel de capas.

Criterios de traducción:

- **Copy publicitario, no traducción literal**: titulares cortos y con gancho, en el registro de la marca. Si el original es un juego de palabras, adapta la idea en vez de calcarla y avisa con una nota junto a ese campo.
- **Longitud**: intenta que ocupe lo mismo o menos que el original. Si una traducción es claramente más larga, señálalo junto al campo (`+20 % de longitud`) para que el usuario decida antes de maquetar.
- **CTAs**: usa la forma estándar del botón de la plataforma cuando exista (Más información → Learn more, Comprar ahora → Shop now, Regístrate → Sign up, Descargar → Download, Reservar → Book now). Así el texto de la pieza coincide con el botón del gestor de anuncios.
- **Formatos locales**: precios, fechas y unidades se adaptan al mercado. Las divisas no se convierten: solo cambia el formato.
- Respeta las mayúsculas del original y no traduzcas los términos excluidos.
- **Estilos mixtos**: si un campo viene marcado como de estilos mixtos, indícalo junto al campo ("lleva una parte en negrita"). Pregunta qué parte de la traducción debe llevar ese estilo, porque al reemplazar el texto se pierde el formato parcial.

## 4. Comprobar las fuentes (antes de duplicar nada)

El script del paso 2 ya devolvió `fonts` con `loadable: true/false` para cada familia y estilo. Si alguna no se puede cargar (no está instalada, es una fuente local de otra máquina o de una librería sin acceso), **para y avisa** antes de duplicar. Sustituirla en silencio por otra produciría piezas fuera de marca que parecen terminadas.

Avisa con este formato:

> ⚠ La fuente **Brand Sans Bold** no está disponible en esta sesión de Figma. Afecta a: Text 1, Text 2.
> Opciones:
> 1. Activar/instalar la fuente (o abrir el archivo desde un equipo que la tenga) y volver a lanzarlo. **Recomendado.**
> 2. Usar temporalmente **[sugerencia]** (Google Fonts, métricas parecidas) y marcar las piezas como pendientes de fuente.
> 3. Usar otra fuente que me indiques.

Para la sugerencia de la opción 2, elige una fuente de Google Fonts del mismo tipo y con proporciones parecidas, y explica en una línea por qué. Orientación:

| Tipo de la fuente original | Sugerencias |
|---|---|
| Sans geométrica (Futura, Avenir, Gotham, Circular) | Montserrat, Poppins, Outfit, Figtree |
| Grotesca/neogrotesca (Helvetica, Arial, Neue Haas, Aktiv) | Inter, Roboto, Archivo |
| Sans humanista (Frutiger, Myriad, Gill Sans, Segoe) | Open Sans, Source Sans 3, Lato, Noto Sans |
| Condensada (DIN Condensed, Bebas, Oswald) | Oswald, Barlow Condensed, Roboto Condensed |
| Serif de texto (Garamond, Times, Georgia) | EB Garamond, Merriweather, Source Serif 4 |
| Serif display/alto contraste (Didot, Bodoni) | Playfair Display, Bodoni Moda |

Mantén el mismo peso y estilo (Bold → Bold). Antes de proponerla, comprueba con `figma.listAvailableFontsAsync()` que la sugerencia existe en esa sesión de Figma. Si no reconoces la fuente original, pregunta al usuario en vez de adivinar.

Si el usuario elige la opción 2 o la 3, la sustitución se aplica **solo a las copias traducidas**, nunca al original. Las copias se marcan como `_EN_PENDIENTE-FUENTE` y el informe final indica qué fuente se usó en lugar de cuál.

## 5. Aplicar en Figma

Ejecuta con `use_figma` el script [scripts/apply-translations.js](../scripts/apply-translations.js) con:

- los ids de los frames;
- el diccionario `{original: traducción}` aprobado en el paso 3;
- el modo (`duplicate` u `overwrite`) y el sufijo de idioma;
- `FONT_FALLBACK` vacío, o con la sustitución aprobada en el paso 4.

El script comprueba las fuentes otra vez antes de duplicar. Si falta alguna sin fallback aprobado, no crea nada y devuelve el error, así nunca quedan copias a medias. Si todo va bien, devuelve solo lo que requiere atención: textos sin traducción, posibles desbordamientos y frames marcados como pendientes de fuente.

## 6. Verificación (solo lo marcado)

- Haz `get_screenshot` únicamente de los frames que el script marcó como posible desbordamiento o con fallback de fuente. No hace falta capturar todos.
- Si hay desbordamiento, prueba primero a acortar la traducción (proponlo al usuario con la etiqueta del campo). Reduce el tamaño de fuente solo como último recurso, como mucho un paso de la escala tipográfica de la marca, y avísalo.
- Revisa las zonas de seguridad de Stories/Reels (ver meta-ads-specs.md) si el texto ha cambiado de alto.

## 7. Informe final (corto)

Una tabla con: frame original → frame traducido, textos ajustados, textos pendientes de validación (legales, juegos de palabras) y frames **pendientes de fuente**, indicando qué fuente sustituye a cuál. No vuelvas a listar todas las traducciones: ya se aprobaron en el paso 3.
