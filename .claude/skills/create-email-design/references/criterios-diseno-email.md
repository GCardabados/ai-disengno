# Criterios de diseño de email (valores por defecto de la skill)

Se aplican **solo cuando el conocimiento del cliente no fija la regla**. Cada valor que el plan toma de aquí queda
registrado como **regla interna declarada** (`internalRules` del plan), nunca como norma de marca. Si el cliente define
el valor (`channels/email.json` o una plantilla aprobada), manda el cliente y este documento no se consulta.

Referencia de accesibilidad: **WCAG 2.2 nivel AA** en los criterios que dependen del diseño. Un archivo de Figma **no
garantiza** la accesibilidad del email implementado: el HTML final debe validarse (orden del código, `alt`, `lang`,
roles de tabla, tamaños reales en cada cliente de correo). La skill entrega el diseño y las indicaciones para lograrlo.

## 1. Lienzo y retícula

| Parámetro | Desktop | Mobile | Justificación |
|---|---|---|---|
| Ancho del email | **600 px** (640 si la plantilla del cliente lo usa) | **375 px** de diseño; comprobar a **320 px** | 600 px cabe en los paneles de vista previa de Outlook/Gmail web sin escalado. 375 px es el ancho de referencia de iPhone; 320 px es el ancho de *reflow* de WCAG 1.4.10. |
| Margen lateral del contenido | 32 px (ancho útil 536) | 20 px (ancho útil 335) | Medida de ~65–70 caracteres a 16 px en desktop y ~40–45 en mobile. Nunca < 16 px en mobile. |
| Unidad de espaciado | 8 px | 8 px | Múltiplos de 8 se trasladan sin decimales a `padding` de tabla. |
| Padding vertical de cada banda (módulo) | 40 px (cabecera 24, legales 24, pie 32) | 32 px (cabecera y legales 20, pie 24) | Agrupa por proximidad sin cortar la lectura; las bandas se apilan sin separación extra. |
| Separación interna (título→texto→CTA) | 16 / 24 px | 12 / 24 px | |
| Columnas | máx. 2 (3 solo para iconos o rejillas de producto pequeñas) | 1 (apiladas) | Más de 2 columnas con texto no se leen a 600 px y complican el apilado. |

## 2. Tipografía

| Rol | Desktop (tamaño/interlineado) | Mobile | Notas |
|---|---|---|---|
| Titular (H1) | 32/40 | 26/32 | Máx. ~3 líneas en mobile. |
| Subtítulo (H2) | 24/32 | 22/28 | |
| Cuerpo | 16/24 | 16/24 | **No se reduce en mobile.** |
| Texto secundario | 14/20 | 14/20 | |
| CTA | 16/20 negrita | 16/20 negrita | |
| Legal / pie | 12/18 | 12/18 | Mínimo absoluto 12 px. iOS Mail agranda el texto < 13 px si el HTML no lo impide: avisar a desarrollo. |

- **Política de fuentes del canal.** Por defecto, **texto vivo solo en fuentes de sistema** (web-safe): es la doctrina
  del pipeline de maquetación (`ai-mkt-automation`, linter W4) y lo único que se ve igual en Gmail y Outlook para
  Windows. Si el cliente declara `web_font_with_fallback`, se diseña con su fuente y la pila de fallback, y los textos
  deben aguantar el fallback (auto layout con altura ajustable, sin cajas de ancho justo).
- **Figma no tiene fuentes de sistema** (en el entorno de `use_figma` no existen Arial, Georgia, Verdana ni Tahoma). Se
  diseña con un **sustituto métrico declarado**: Arimo para Arial/Helvetica, Tinos para Times New Roman, Gelasio para
  Georgia (comprobar disponibilidad). El sustituto se registra en `channels/email.json → typography.roles[].figma`
  y en las notas de desarrollo («implementar con Arial, Helvetica, sans-serif»). Nunca se sustituye en silencio.
- La fuente de marca, si no es web-safe, solo aparece dentro de imágenes (con su alt) y nunca para mensaje, oferta o CTA.
- Una fuente que no carga en Figma **no se sustituye en silencio**: se para y se pregunta (igual que el resto de skills).
- Párrafos alineados a la izquierda. El centrado solo para bloques de ≤ 3 líneas (titulares, CTA, pie).
- Texto vivo siempre: nada de titulares ni precios dentro de imágenes (WCAG 1.4.5; con imágenes bloqueadas se perdería).

## 3. CTA

- **Un CTA principal por email** (o por módulo de producto), identificable a primera vista: color de acción de la
  marca, el de mayor peso visual de la pieza. Los secundarios, en estilo enlace o contorno.
- Botón **construido en texto vivo** (botón «a prueba de balas»: celda con fondo + enlace con *padding*), nunca imagen.
- Alto mínimo **44 px** (desktop y mobile; 48 px recomendado en mobile). WCAG 2.2 AA (2.5.8) exige 24×24 px; 44 px es
  la recomendación de 2.5.5 / Apple HIG y evita toques fallidos.
- Mobile: **ancho completo** del área de contenido (o mínimo 50 %), centrado.
- Texto de acción descriptivo («Solicita información», no «Haz clic aquí») — WCAG 2.4.4.
- Contraste texto/botón ≥ 4,5:1 y botón/fondo del módulo ≥ 3:1 (1.4.11); si el botón no alcanza 3:1 con su fondo,
  necesita borde que lo alcance.
- Radio: el de la marca. En Outlook clásico para Windows las esquinas pueden salir rectas: el botón tiene que seguir
  siendo correcto con esquinas rectas (avisar en las notas).

## 4. Color, contraste y enlaces

- Texto normal ≥ **4,5:1**; texto grande (≥ 24 px regular o ≥ 18,66 px negrita) ≥ **3:1** (WCAG 1.4.3).
- Elementos no textuales que transmiten información (iconos, bordes de botón, campos) ≥ **3:1** (1.4.11).
- **Enlaces en texto subrayados**, no solo por color (1.4.1). El color de enlace es el de la marca si lo define.
- Ninguna información solo por color (estados, «nuevo», «agotado»): siempre con texto.

## 5. Imágenes

- Toda imagen con su **texto alternativo** propuesto (en las notas de desarrollo); las decorativas, marcadas
  `alt=""`. El alt describe la función, no «imagen de…».
- El email se tiene que **entender con las imágenes bloqueadas**: mensaje principal, oferta y CTA en texto vivo. Cada
  imagen lleva un color de fondo de respaldo (el dominante de la imagen o el del módulo).
- Proporción orientativa: que las imágenes no sean la mayor parte del contenido informativo; evitar emails «una sola imagen».
- Exportación @2x (p. ej. hero de 600 px → archivo de 1200 px). PNG para logos (el SVG no funciona en Gmail ni
  Outlook); JPG para fotos.
- **Texto sobre imagen** (imagen de fondo): solo si es imprescindible. Outlook para Windows necesita VML; el texto debe
  ir en HTML encima con un color de fondo de respaldo con contraste suficiente. Por defecto, imagen y texto separados.
- GIF animado: el primer fotograma debe contener el mensaje (Outlook para Windows solo muestra ese).

## 6. Mobile no es desktop reducido

| Aspecto | Regla de transformación |
|---|---|
| Columnas | 2–3 columnas → 1, **en el orden del código** (izquierda antes que derecha). Rejillas de producto 2×2 pueden mantenerse en 2 si cada celda ≥ 150 px y el CTA conserva 44 px. |
| Orden | El mismo orden de lectura que desktop. Si en desktop la imagen va a la derecha (zigzag) y en mobile debe ir encima, se anota: requiere `dir="rtl"` u otra técnica; si no compensa, se mantiene el orden del código. |
| Espaciado | Margen lateral 32 → 20 px; padding vertical de las bandas 40 → 32 px. |
| Imágenes | Hero a ancho completo (375 px) manteniendo proporción; si el punto de interés se pierde, se pide un **recorte mobile** (asset aparte, anotado). Imágenes de columna → ancho completo. |
| Alineación | Párrafos de más de 3 líneas centrados en desktop → izquierda en mobile. |
| CTA | Ancho completo, 48 px de alto. |
| Tipografía | Titulares bajan un escalón; el cuerpo no baja de 16 px. |
| Contenido | Mismo contenido en ambos. Ocultar bloques en mobile no es fiable en todos los clientes y deja a parte de la audiencia sin información: evitarlo. |
| Navegación | Máx. 3–4 enlaces; en mobile, en una o dos filas. Sin menús hamburguesa. |

Diseñar para que funcione **incluso sin media queries** (algunas apps de Gmail con cuentas no-Gmail las ignoran):
columnas que se apilan solas (técnica híbrida/fluida) y anchos máximos en vez de fijos.

## 7. Patrones web que no se trasladan

No proponer (o señalar el coste si el brief lo pide): menús hamburguesa o desplegables, carruseles, acordeones,
pestañas, *hover* como única pista, formularios, vídeo incrustado (usar imagen con botón de reproducir → enlace),
contadores en vivo (solo como imagen generada por servicio externo, anotado), cabeceras fijas, superposiciones o
posicionamiento absoluto, rejillas CSS complejas, iconos SVG o de fuente, degradados o sombras imprescindibles para
leer algo, modales.

## 8. Dark mode

- El diseño base es en modo claro. **Si el cliente define reglas de dark mode, se siguen** y se diseña una vista de
  comprobación; si no, se anotan los riesgos para desarrollo:
  - Logo: versión con fondo transparente que funcione sobre oscuro (o con contorno/halo claro). Logos oscuros en PNG
    transparente desaparecen al invertir.
  - Evitar textos o iconos negros en PNG transparente; evitar `#FFFFFF`/`#000000` puros en grandes superficies (algunos
    clientes los invierten de forma agresiva).
  - Los colores de marca pueden invertirse parcialmente (Gmail app, Outlook): comprobar que el CTA conserva contraste.
- El comportamiento varía por cliente: Apple Mail respeta `prefers-color-scheme`; Gmail app y Outlook invierten total
  o parcialmente sin control completo. No prometer un dark mode idéntico.

## 9. Estructura y contenido mínimo

- **Preheader** (40–100 caracteres) que complemente el asunto, no lo repita.
- Cabecera con logo (enlazado a la web del cliente si así lo indica la marca). Ver online, si la plataforma lo usa.
- Pie con: baja/gestión de preferencias **visible** (contraste ≥ 4,5:1, nunca escondida), identificación legal del
  remitente y textos legales del cliente. Si faltan, placeholders `[PENDIENTE: …]`, nunca inventados.
- Longitud: priorizar. Emails muy largos se recortan (Gmail recorta el HTML de más de ~102 KB): proponer qué recortar.

## 10. Patrones engañosos (prohibidos)

Botones falsos dentro de imágenes, urgencia o escasez no respaldadas por el brief, «Re:»/«Fwd:» o elementos que
imitan conversaciones o notificaciones del sistema, baja escondida o de bajo contraste, letra pequeña que contradice
el titular, casillas o controles falsos, precios sin sus condiciones cuando el cliente las exige.

## 11. Comprobaciones previstas en la skill (resumen)

| Criterio | Dónde se comprueba |
|---|---|
| Contraste de texto y CTA (1.4.3, 1.4.11) | Plan (colores) y relectura (pares reales texto/fondo) |
| Tamaño mínimo de texto y de CTA (2.5.8) | Plan y relectura |
| Enlaces subrayados (1.4.1) | Relectura (`textDecoration`) |
| Alt de cada imagen, orden de lectura (1.1.1, 1.3.2) | Notas de desarrollo generadas desde el plan |
| Texto vivo, sin texto en imagen (1.4.5) | Relectura (todo copy es nodo TEXT) |
| Mobile a 320 px (1.4.10) | Revisión visual de la captura mobile; propuesto, no automático |
| Dark mode | Revisión visual; propuesto, no automático |
