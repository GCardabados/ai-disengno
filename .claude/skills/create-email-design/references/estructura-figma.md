# Estructura del email en Figma (contrato con revisión y maquetación)

Pensada para que la persona revise y edite, y para que el pipeline de maquetación (`ai-mkt-automation`, skill
`email-builder`) construya el HTML desde los frames sin interpretar nada raro. Ese pipeline lee **un frame por versión**,
toma cada hijo de primer nivel como una banda/módulo, traduce el auto layout a tablas y copia colores, medidas y textos
**literalmente**. Por eso aquí todo es entero, en auto layout y con nombres funcionales.

## Sección de salida

Una sección por encargo, con el nombre que diga el brief (`figma.sectionName`, p. ej. `EMAIL · mutualidad · área privada`),
a la derecha de lo que haya en la página. Dentro, de izquierda a derecha:

| Frame | Contenido |
|---|---|
| `Email_<Nombre>_Desktop` | El email desktop: auto layout vertical, ancho fijo (600 por defecto), alto ajustable. |
| `Email_<Nombre>_Componentes` | Conjuntos de componentes del encargo (cabecera, pie, botones) con variantes `Breakpoint=Desktop/Mobile`. |
| `Email_<Nombre>_Mobile` | El email mobile (375 por defecto, o el ancho del cliente). |
| `Email_<Nombre>_Asunto` | Asunto y preheader con su estado (aprobado / PROPUESTA / PENDIENTE). |
| `Email_<Nombre>_Notas` | Notas de revisión y desarrollo: propuestas, pendientes, decisiones, supuestos, responsive, accesibilidad, dark mode, desarrollo, reglas internas y conflictos. |

Nada existente se toca. Si ya hay un frame con el mismo nombre, el script no duplica: se cambia `name` (p. ej. `AreaPrivadaV2`).

## Módulos (hijos de primer nivel de cada versión)

Nombre = `id` funcional del módulo en kebab-case (`header`, `hero`, `ventajas`, `legales`, `footer`…), igual en desktop
y mobile y, si existe, igual que el id del módulo HTML del cliente (`channels/email.json → modules[].htmlModuleId`).

| Tipo | Desktop | Mobile |
|---|---|---|
| `header` | Ver online (opcional) + logo, centrado o a la izquierda según el cliente. **Instancia** de `Email/Cabecera`. | Igual; logo ≤ 60 % del ancho útil y ≥ su mínimo. |
| `hero` | Imagen a ancho completo sin texto encima + banda con antetítulo, titular H1, párrafos y CTA. | Imagen al 100 % (misma proporción o recorte mobile anotado), titular un escalón menor, CTA ancho completo. |
| `text` | Titular + párrafos + CTA opcional a una columna. | Igual con márgenes mobile; párrafos largos a la izquierda. |
| `image-text` | 2 columnas (imagen y texto) que suman exactamente el ancho útil. | Apiladas en el orden del código (si la imagen va a la derecha, queda debajo; anotado). |
| `columns` | Filas de 2 o 3 elementos (imagen, título, texto, enlace). | 1 columna, elementos apilados en orden. |
| `cta` | Texto opcional + botón centrado. | Botón a ancho completo, 48 px. |
| `legal` | Textos legales 12 px en texto vivo. | Igual. |
| `footer` | Textos del pie y obligatorios (baja, remitente…). **Instancia** de `Email/Pie`. | Igual. |

## Capas dentro de un módulo

Vocabulario compartido con el pipeline: `Antetitulo`, `Titular`, `Parrafo1..n`, `CTA` (botón) con `CTA_texto`,
`Imagen_desktop` / `Imagen_mobile`, `ImgIzq_dk|mb` / `ImgDer_dk|mb`, `Elemento_n` (`Imagen_n_dk|mb`, `Titulo_n`,
`Texto_n`, `Enlace_n`), `Legal`, `Footer_<id>`, `Logotipo`, `Ver_online`. Contenedores: `Textos`, `Contenido`,
`Columnas`, `Fila_n`, `Elementos`.

## Estados visibles

- **Copy propuesto por el agente**: el nombre de la capa termina en ` [PROPUESTA]` y lleva anotación; además se lista en
  Notas. Al aprobarlo, se quita el sufijo (o se edita el texto).
- **Placeholder**: el texto empieza por `[PENDIENTE: …]` (visible en el diseño, imposible de publicar por descuido) y la
  capa termina en ` [PENDIENTE]`.
- **Imagen pendiente**: rectángulo gris con `[IMAGEN PENDIENTE] <qué> · <ancho×alto @2x>` y anotación con el alt.
- **Logo pendiente**: hueco con borde discontinuo `[LOGO PENDIENTE]` del tamaño previsto.
- **URL pendiente**: la anotación del CTA dice `#FALTA-URL` (convención del pipeline: nunca se inventa una URL).

## Anotaciones (Dev Mode)

En cada módulo: comportamiento responsive. En cada imagen: alt y tamaño de exportación. En cada CTA y enlace: URL. En
cada copy propuesto o pendiente: su estado. Si el archivo no admite anotaciones, todo sigue en el frame de Notas.

## Componentes y estilos

- Se reutilizan los del cliente si están **publicados en una librería declarada** en `client.json → figma.libraries`
  (filtrar `search_design_system` con `includeLibraryKeys`). Componentes locales de otro archivo no se pueden instanciar:
  se anota cuál es el del cliente (`modules[].figma`) para producción.
- Si no hay, el script crea solo lo reutilizable del encargo: `Email/Cabecera`, `Email/Pie`, `Email/Botón primario`
  (y secundario), cada uno con variantes `Breakpoint=Desktop` / `Breakpoint=Mobile`, e instancias en los emails con los
  textos como overrides. No se crea un sistema de diseño completo.
- Colores y medidas literales (HEX de la paleta del cliente, enteros). Sin estilos ni variables nuevas salvo que el
  cliente ya los tenga en su librería.
