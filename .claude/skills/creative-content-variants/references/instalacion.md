# Instalación de la skill `creative-content-variants`

Esta carpeta es **autosuficiente**: incluye el `SKILL.md`, sus `references/` y, en `cli/`, el código que usa (CLI, scripts de
Python, configuración de ejemplo y la librería `zod`). No necesitas el repositorio `paid-creative-builder` ni `npm install`.

## 1. Instalar la skill

Copia **la carpeta entera** `creative-content-variants/` (con `SKILL.md`, `references/` y `cli/`) a una de estas ubicaciones y reinicia
Claude Code:

- `~/.claude/skills/creative-content-variants/` → disponible en todos tus proyectos.
- `<tu-carpeta-de-trabajo>/.claude/skills/creative-content-variants/` → solo en ese proyecto.

Los datos de cada ejecución se guardan en `runs/` de **tu carpeta de trabajo** (la carpeta desde la que abres Claude Code), no
dentro de la skill.

## 2. Requisitos

| Requisito | Para qué | Cómo comprobarlo |
|---|---|---|
| **Node ≥ 24.21** (fijada: 24.21.0, en `cli/.nvmrc`) | Ejecuta el CLI (TypeScript sin compilar) | `node --version` |
| **Python 3** | Extraer evidencias del registro de la sesión | `python3 --version` |
| **numpy y Pillow** (`pip install numpy pillow`) | Hoja de contacto con las variantes (`contact-sheet.py`) | lo avisa `doctor` |
| **MCP de Figma conectado** y skill **`figma-use`** | Leer y escribir en Figma con `use_figma` | `whoami` desde Claude Code |
| **Asiento Full** en el archivo de Figma | Crear clones. Con View/Dev solo se lee: trabaja en una copia del archivo | — |

La skill `figma-use` viene con el plugin oficial de Figma para Claude Code; instálalo y autoriza tu cuenta.

## 3. Comprobar que todo está bien

```bash
node ~/.claude/skills/creative-content-variants/cli/src/cli.ts doctor
```

(ajusta la ruta si la instalaste en un proyecto). `doctor` revisa Node, la librería incluida, Python y la configuración, y
explica qué falta; no instala ni escribe nada. Para probar sin Figma: `node ~/.claude/skills/creative-content-variants/cli/src/cli.ts mock-read --fixture base --out runs/prueba-mock`.

## 4. Usarla

En Claude Code, con tu carpeta de trabajo abierta: «Quiero variantes de esta pieza para distintos grados y ciudades: <enlace>» o «Traduce estas piezas al inglés: <enlace>».
La skill analiza la maestra, propone qué variar y qué mantener, te pregunta en una ronda y **no escribe en Figma hasta que confirmes los campos y el contenido**.

## 5. Notas

- `<PCB>` en el `SKILL.md` es esa carpeta `cli/`. Claude la resuelve solo; no tienes que escribirla.
- Los resultados y capturas de `runs/` contienen datos de la pieza: no los subas a Git sin decidirlo.
- Para adaptar la pieza a otros tamaños usa `adapt-master-creative` (instalación independiente). Si piden ambas cosas: primero adaptar y validar, después traducir.
- Para actualizar: sustituye la carpeta completa por la versión nueva (no mezcles versiones de `SKILL.md` y `cli/`).
