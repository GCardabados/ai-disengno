# Skill create-email-design y conocimiento compartido de clientes (2026-10-22)

Rama `feature/skill/create-email-design` (sale de `main`). Sin commit.

## A. Diagnóstico

**Qué existía**

| Pieza | Dónde | Reutilizado |
|---|---|---|
| Patrón de skill «el CLI calcula y genera el script, `use_figma` lo ejecuta tal cual, el CLI valida» (brief → confirmación por hash → plan → script → relectura → informe) | `main` (adapt, variantes) y rama de maestras | Sí, el mismo patrón y convenciones (`<PCB>`, `runs/`, contratos zod, códigos de salida 0/4/2) |
| Brand kit `pcb.brand.v1` + `brand-check` (cada dato con su fuente, `gaps`, `openQuestions`, estados) | rama `feature/skill/create-master-creative` (`brands/<marca>/`, `src/contracts/brand.ts`, `src/brand/*`) | Sí: contrato y utilidades traídos **sin cambios** (fusión limpia); kits UAX y Mutualidad copiados al repositorio compartido |
| Cómo la skill de maestras aplica la marca: copy exacto, borradores del agente sin datos comerciales, lagunas decididas por encargo, reglas internas declaradas, logo desde SVG, nunca sustituir fuentes | rama de maestras (`src/master/brief.ts`, `plan.ts`) | Sí, mismas reglas trasladadas a email |
| Detección de datos comerciales (`commercialSignals`), citas seguras, `extract-tool-calls.py`, `verify-sent` | `main` | Sí |
| Pipeline de email Figma → HTML (`email-builder`, `email-validate`), conocimiento de email por cliente (`clients/<c>/brand/design-system.md`, módulos HTML, lecciones) | `~/Desktop/mkt-aut/ai-mkt-automation` (otro repo) | Como **contrato de salida** (frames `Email_<N>_Desktop/_Mobile`, bandas de primer nivel, vocabulario de capas, `#FALTA-URL`, solo fuentes web-safe) y como **fuente** de las reglas de email de Mutualidad |

**Limitaciones y dependencias detectadas**

- Figma: asiento **View** (equipo starter) y **Dev** (The Cocktail). `use_figma` está bloqueado incluso para leer en el
  archivo real de emails de Mutualidad; `get_metadata`, `get_screenshot` y `search_design_system` sí funcionan. La
  escritura solo es posible en archivos con asiento Full (prueba hecha en «IAs (Copy)»).
- El entorno de `use_figma` **no tiene fuentes de sistema** (Arial, Georgia, Verdana, Tahoma); sí Arimo y Tinos
  (métricamente compatibles). Como el HTML solo admite fuentes web-safe, se diseña con un sustituto **declarado**.
- `search_design_system` busca en todas las librerías de la cuenta: desde el archivo de Mutualidad devuelve
  componentes de «UAX UI 25». Sin filtrar por cliente hay riesgo real de mezclar marcas.
- Los componentes de email de Mutualidad (botón, footer) son locales de su archivo: no se pueden instanciar desde otro.
- Conocimiento **duplicado y divergente**: Mutualidad existe en `paid-creative-builder/brands/` (manual: Rufina +
  fuente propietaria, 5 colores) y en `ai-mkt-automation/clients/` (Arial, 9 colores, 4 que no están en el manual),
  sin estados de aprobación en el segundo.
- La rama de maestras es anterior a las skills portables: fusionarla es decisión de la persona.

**Preguntas bloqueantes**: ninguna para implementar. Quedan decisiones de la persona (ver «Pendiente»).

## B. Arquitectura del conocimiento

**Recomendación**: repositorio compartido propio (`client-knowledge`), fuera de las skills y de los proyectos que lo
consumen, leído por ruta (`CLIENT_KNOWLEDGE_ROOT` / `--root`). Mientras no exista el remoto, vive en
`client-knowledge/` de este repo, autocontenido y extraíble (`git subtree split --prefix client-knowledge`).
Contrato completo en [client-knowledge/README.md](../client-knowledge/README.md).

*Alternativas descartadas*: dentro de cada skill (`references/`) duplica la marca por skill y por proyecto — es
exactamente la divergencia que ya hay con Mutualidad; submódulo Git en cada consumidor es viable pero añade fricción
a quien recibe una skill portable (queda como opción para `ai-mkt-automation`).

```
client-knowledge/
├── README.md                     contrato: capas, estados, precedencia, aislamiento, cómo proponer cambios
├── _templates/client/            plantilla mínima (client.json, brand.json, channels/email.json, CHANGELOG, README)
└── clients/<slug>/
    ├── client.json               índice ck.client.v1: alias, dominios, Figma (archivos y librerías), y por archivo:
    │                             canal, temas, estado, versión, fecha, fuente, aprobación, carga always|on_demand
    ├── brand.json                pcb.brand.v1 (sin cambios respecto a la rama de maestras)
    ├── guidelines.md             manual legible (bajo demanda)
    ├── channels/email.json       ck.email.v1: anchos, colores de canal, política y roles tipográficos (con sustituto
    │                             de Figma), CTA, enlaces, logo, cabecera, pie, legales, dark mode, módulos,
    │                             plantillas, ejemplos (referencia), restricciones, lagunas, preguntas
    ├── assets/logos/             SVG/PNG
    ├── proposals/                cuarentena de propuestas (nunca se cargan)
    └── CHANGELOG.md
```

**Consulta desde las skills**: `knowledge-list --find` (identificar) → `knowledge-context --client --channel`
(carga solo ese cliente y canal, con versión y SHA-256, y anuncia lo bajo demanda) → el plan de cada skill declara la
procedencia de cada token. Precedencia: legal/técnico > decisión del encargo (dentro de la marca) > canal confirmado >
marca > observado/plantillas > valores por defecto declarados; los ejemplos nunca aportan tokens.

## C. Skill

[.claude/skills/create-email-design/SKILL.md](../.claude/skills/create-email-design/SKILL.md) + `references/`
(criterios de diseño con valores por defecto justificados, estructura en Figma, plantilla de brief, ejemplo de brief,
instalación). Código: `src/contracts/{knowledge,email}.ts`, `src/knowledge/{store,cli}.ts`,
`src/email/{tokens,brief,plan,check,cli}.ts`, `src/figma/email-script.ts`; comandos `knowledge-*` y `email-*`.

## E. Pruebas

**Ejecutadas**

| Prueba | Resultado |
|---|---|
| `npm run check` (typecheck + 217 pruebas; 18 nuevas en `test/email.test.ts`, incl. paquete portable) | ✓ |
| Conocimiento real: `knowledge-check` de UAX y Mutualidad; aislamiento (rutas, enlaces, slug ajeno), conflicto marca↔email, propuesta en cuarentena, plantilla mínima válida | ✓ |
| Brief Mutualidad (caso representativo, ficticio): 8 copys aprobados, 6 propuestos, 1 pendiente; solo pide confirmación | ✓ |
| Copys incompletos: borradores con precio, porcentaje, fecha o «regalo» sin fuente → bloqueo; placeholders sin `[PENDIENTE` → bloqueo | ✓ |
| Sin plantillas, sin ejemplos ni reglas de email (UAX): pide tipografía, botón y logo **con propuesta**; tras decidir, plan con valores por defecto declarados y SVG real del logo | ✓ |
| Simulación de la Plugin API (MOCK): construcción completa, componentes con variantes, reejecución sin duplicar, fuente ausente sin escribir, fallo a mitad con limpieza, construcción por partes | ✓ |
| **Figma real** (archivo «IAs (Copy)», sección `2595:121`): V1 y V2 creadas con desktop 600 / mobile 393, asunto, notas, 3 conjuntos de componentes (6 instancias), 41 anotaciones; `verify-sent` = script idéntico; `email-check` = pass sobre la relectura | ✓ |
| Revisión visual de capturas: V1 → 3 defectos (viuda en el titular, columnas de ~18 caracteres, hueco de logo ilegible) → reglas nuevas en la skill y V2; solape del frame de componentes → corregido en el script y recolocado | ✓ |

**Propuestas (no ejecutadas)**: escritura en el archivo real del cliente (requiere asiento Full); reutilizar sus
componentes (requiere publicarlos en una librería); lectura a 320 px; dark mode por cliente de correo; maquetación con
`email-builder` desde los frames generados y validación en Email on Acid; revisión humana del diseño.

**Defecto conocido**: el titular desktop de la prueba aún deja una viuda («siempre a / mano»); no es detectable sin medir
texto. Se resuelve en la revisión (caja del titular ≈ 400 px o salto de línea aprobado).

## Pendiente de decisión

1. Crear el repositorio remoto `client-knowledge` y apuntar a él `ai-mkt-automation` (migrar `design-system.md` de
   cada cliente a `channels/email.json`, conservando allí solo módulos HTML y artefactos de maquetación).
2. Fusionar la rama de maestras y apuntar `create-master-creative` / `brand-kit-generator` a `client-knowledge`
   (hoy leen `brands/`).
3. Respuestas de Mutualidad: logo de cabecera y archivos, titulares Arial vs Rufina, `#002A1E`, legales y pie.
