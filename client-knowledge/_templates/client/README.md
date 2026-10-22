# Plantilla mínima de cliente

1. Copia esta carpeta a `clients/<slug>/` y sustituye `cliente-ejemplo` por el slug (kebab-case) en `client.json`,
   `brand.json`, `channels/email.json` y `channels/paid.json`. Quita del índice y de la carpeta el canal que el cliente
   no tenga.
2. `brand.json` y `guidelines.md`: los genera `brand-kit-generator` desde el manual (cada dato con su página) y los
   registra con `brand-register` (índice + CHANGELOG). No inventes valores: lo que el manual no dice va a `gaps`;
   erratas y dudas a `openQuestions`.
3. `channels/email.json`: deja `null` lo que no sepas (la skill de email usará valores por defecto **declarados**).
   Lo visto en emails aprobados entra como `"status": "observed"`; solo lo escrito o validado por el cliente como
   `"confirmed"`. Ejemplos aprobados en `examples` (son referencia, no reglas).
4. `channels/paid.json`: plantillas de pieza del cliente en Figma para el modo plantilla de `create-master-creative`
   (`templates[]`: id, tamaño, nodo, huecos rol → nodo y nodos del logo). Su archivo de Figma debe estar declarado en
   `client.json → figma.files`. Vacío = solo se crean maestras desde cero.
5. Logos en `assets/logos/<version>-<tinta>.svg|png` y referenciados en `brand.json → logos[].file`.
6. Declara los archivos y librerías de Figma del cliente en `client.json → figma` (aíslan sus componentes).
7. `node <PCB>/src/cli.ts knowledge-check --client <slug>` y anota el alta en `CHANGELOG.md`.
