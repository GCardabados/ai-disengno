# Brief de email

> Copia este archivo a `runs/<AAAA-MM-DD>-<cliente>-<email>/brief.md`, rellena lo que sepas y pásaselo a Claude Code
> (`/create-email-design runs/<…>/brief.md`). **Lo que no sepas, déjalo vacío**: el agente continúa con supuestos
> explícitos o propone, y solo pregunta lo que bloquee una decisión importante. `runs/` está fuera de Git.

## 1. Cliente y encargo
- **Cliente** (slug en `client-knowledge/clients/`): <!-- si no existe, primero alta con la plantilla mínima -->
- **Nombre del email** (sin espacios, irá a Figma como `Email_<Nombre>_Desktop`):
- **Campaña / journey:**
- **Idioma:** es

## 2. Comunicación
- **Objetivo** (informar, activar, convertir, retener…):
- **Audiencia** (quién lo recibe y qué sabe ya):
- **Mensaje principal** (una frase):
- **Acción principal (CTA)** y **URL de destino:** <!-- sin URL → «#FALTA-URL»; nunca se inventa -->
- **Acciones secundarias** (si las hay):

## 3. Contenido
Marca cada texto como **aprobado** (se usa exacto) o **borrador/idea** (el agente puede proponer redacción).
Si falta un texto, el agente lo propone marcado como PROPUESTA. **Nunca** inventa precios, condiciones, plazos,
rentabilidades, datos de producto ni afirmaciones comerciales: si hacen falta, ponlos aquí.

- **Asunto:**
- **Preheader:**
- **Titular principal:**
- **Texto principal:**
- **Bloques adicionales** (ventajas, pasos, productos, testimonios…), con su texto:
- **Legales / condiciones obligatorias:**

## 4. Recursos
- **Archivo de Figma y página donde crearlo** (enlace con `node-id` de la página): <!-- escribir requiere asiento Full -->
- **Imágenes** (enlace con `node-id` de cada una, ya en ese archivo de Figma) o descripción de lo que debe mostrar:
- **Plantilla o email anterior de referencia** (opcional; es referencia, no norma):
- **Assets específicos** (iconos, logos de producto…):

## 5. Restricciones
- **Plataforma de envío** (SFMC, AJO…), módulos disponibles, tipografías permitidas, peso, dark mode:
- **Requisitos legales o de marca específicos de este envío:**
- **Fecha límite / revisión:**

## 6. Revisión
- **Quién revisa y aprueba:**
- **Uso:** propuesta interna para revisión (no envío) <!-- cambia solo si se acuerda otra cosa -->
