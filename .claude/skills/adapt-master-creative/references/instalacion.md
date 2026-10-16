# Instalación de la skill `adapt-master-creative`

Esta carpeta es **autosuficiente**: incluye el `SKILL.md`, sus `references/` y, en `cli/`, el código que usa (CLI, scripts de
Python, configuración de ejemplo y la librería `zod`). No necesitas el repositorio `paid-creative-builder` ni `npm install`.

## 1. Instalar la skill

Copia **la carpeta entera** `adapt-master-creative/` (con `SKILL.md`, `references/` y `cli/`) a una de estas ubicaciones y reinicia
Claude Code:

- `~/.claude/skills/adapt-master-creative/` → disponible en todos tus proyectos.
- `<tu-carpeta-de-trabajo>/.claude/skills/adapt-master-creative/` → solo en ese proyecto.

Los datos de cada ejecución se guardan en `runs/` de **tu carpeta de trabajo** (la carpeta desde la que abres Claude Code), no
dentro de la skill.

## 2. Requisitos

| Requisito | Para qué | Cómo comprobarlo |
|---|---|---|
| **Node ≥ 24.21** (fijada: 24.21.0, en `cli/.nvmrc`) | Ejecuta el CLI (TypeScript sin compilar) | `node --version` |
| **Python 3** | Extraer evidencias del registro de la sesión, y hacer mediciones y superposiciones | `python3 --version` |
| **numpy y Pillow** (`pip install numpy pillow`) | Mediciones de maquetación y superposición de safe zone/atención | lo avisa `doctor` |
| **MCP de Figma conectado** y skill **`figma-use`** | Leer y escribir en Figma con `use_figma` | `whoami` desde Claude Code |
| **Asiento Full** en el archivo de Figma | Crear clones. Con View/Dev solo se lee: trabaja en una copia del archivo | — |

La skill `figma-use` viene con el plugin oficial de Figma para Claude Code; instálalo y autoriza tu cuenta.

## 3. Comprobar que todo está bien

```bash
node ~/.claude/skills/adapt-master-creative/cli/src/cli.ts doctor
```

(ajusta la ruta si la instalaste en un proyecto). `doctor` revisa Node, la librería incluida, Python y la configuración, y
explica qué falta; no instala ni escribe nada. Para probar el flujo sin Figma: `node ~/.claude/skills/adapt-master-creative/cli/scripts/ejemplo-offline.ts`.

## 4. Usarla

En Claude Code, con tu carpeta de trabajo abierta: «Adapta esta pieza de Figma a 1200×628: <enlace>», o rellena `references/encargo.md`
(cópialo a `runs/<fecha>-<nombre>/encargo.md`) y escribe `/adapt-master-creative runs/<fecha>-<nombre>/encargo.md`. Guía completa: [guia-inicio.md](guia-inicio.md).

## 5. Notas

- `<PCB>` en el `SKILL.md` es esa carpeta `cli/`. Claude la resuelve solo; no tienes que escribirla.
- Los resultados y capturas de `runs/` contienen datos de la pieza: no los subas a Git sin decidirlo.
- Si además quieres variantes de contenido o traducciones, instala también `creative-content-variants` (cada skill lleva su propia copia del CLI; no se pisan).
- Para actualizar: sustituye la carpeta completa por la versión nueva (no mezcles versiones de `SKILL.md` y `cli/`).
