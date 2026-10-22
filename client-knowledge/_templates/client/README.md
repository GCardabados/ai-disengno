# Plantilla mínima de cliente

1. Copia esta carpeta a `clients/<slug>/` y sustituye `cliente-ejemplo` por el slug (kebab-case) en `client.json`,
   `brand.json` y `channels/email.json`.
2. `brand.json`: genéralo con `brand-kit-generator` desde el manual (cada dato con su página). No inventes valores:
   lo que el manual no dice va a `gaps`; erratas y dudas a `openQuestions`.
3. `channels/email.json`: deja `null` lo que no sepas (la skill de email usará valores por defecto **declarados**).
   Lo visto en emails aprobados entra como `"status": "observed"`; solo lo escrito o validado por el cliente como
   `"confirmed"`. Ejemplos aprobados en `examples` (son referencia, no reglas).
4. Logos en `assets/logos/<version>-<tinta>.svg|png` y referenciados en `brand.json → logos[].file`.
5. Declara los archivos y librerías de Figma del cliente en `client.json → figma` (aíslan sus componentes).
6. `node <PCB>/src/cli.ts knowledge-check --client <slug>` y anota el alta en `CHANGELOG.md`.
