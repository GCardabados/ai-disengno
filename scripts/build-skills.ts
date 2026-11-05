// Empaqueta cada skill como carpeta AUTOSUFICIENTE para pasarla a otra persona (sin el resto del proyecto):
//   dist/skills/<skill>/  SKILL.md + references/  +  cli/ {src, scripts, config, [ejemplos], package.json, .nvmrc, zod}
// `<PCB>` en el SKILL.md = esa carpeta cli/ (en el repositorio completo = la raíz). Fuente única: el código de src/ y
// .claude/skills/<skill>/; dist/ es salida generada (ignorada por Git) y se puede regenerar siempre.
// Uso: node scripts/build-skills.ts [--out DIR] [--zip]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: { out: { type: 'string' }, zip: { type: 'boolean' } } });
const outRoot = resolve(values.out ?? join(root, 'dist', 'skills'));

interface SkillPlan { name: string; scripts: string[]; extras: string[] }
const SKILLS: SkillPlan[] = [
  {
    name: 'adapt-master-creative',
    scripts: ['attention-overlay.py', 'contact-sheet.py', 'extract-tool-calls.py', 'measure-layout.py', 'overlay-safe-zone.py', 'ejemplo-offline.ts'],
    extras: ['ejemplos'],
  },
  { name: 'creative-content-variants', scripts: ['extract-tool-calls.py', 'contact-sheet.py'], extras: [] },
  { name: 'create-email-design', scripts: ['extract-tool-calls.py', 'email-composer.py', 'email-composer.template.html'], extras: [] },
];

/** zod sin tipos, CJS ni mapas: el CLI solo lo importa como ESM (`import { z } from 'zod'`). */
function copyZod(dest: string): void {
  const src = join(root, 'node_modules', 'zod');
  if (!existsSync(src)) throw new Error('Falta node_modules/zod: ejecuta «npm ci» antes de empaquetar.');
  cpSync(src, dest, {
    recursive: true,
    filter: (p) => !/\.(d\.ts|d\.cts|cjs|map|md)$/.test(p) && !/[\\/]zod[\\/](src|v3|mini|v4-mini)([\\/]|$)/.test(p),
  });
}

function dirSizeKb(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    n += e.isDirectory() ? dirSizeKb(p) : statSync(p).size / 1024;
  }
  return n;
}

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; engines: unknown; dependencies: Record<string, string> };

mkdirSync(outRoot, { recursive: true });
for (const skill of SKILLS) {
  const dest = join(outRoot, skill.name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(root, '.claude', 'skills', skill.name), dest, { recursive: true });

  const cli = join(dest, 'cli');
  cpSync(join(root, 'src'), join(cli, 'src'), { recursive: true });
  cpSync(join(root, 'config'), join(cli, 'config'), { recursive: true });
  mkdirSync(join(cli, 'scripts'), { recursive: true });
  for (const s of skill.scripts) cpSync(join(root, 'scripts', s), join(cli, 'scripts', s));
  for (const e of skill.extras) cpSync(join(root, e), join(cli, e), { recursive: true });
  cpSync(join(root, '.nvmrc'), join(cli, '.nvmrc'));
  writeFileSync(join(cli, 'package.json'), JSON.stringify({
    name: `pcb-${skill.name}`, version: rootPkg.version, private: true, type: 'module',
    description: `Código de la skill ${skill.name} (paquete portable generado por scripts/build-skills.ts; no editar aquí).`,
    engines: rootPkg.engines, dependencies: { zod: rootPkg.dependencies.zod },
  }, null, 2) + '\n');
  copyZod(join(cli, 'node_modules', 'zod'));

  console.log(`✓ ${skill.name}: ${dest} (${Math.round(dirSizeKb(dest))} KB)`);
  if (values.zip) {
    const zipPath = join(outRoot, `${skill.name}.zip`);
    rmSync(zipPath, { force: true });
    const r = spawnSync('zip', ['-rq', zipPath, skill.name], { cwd: outRoot, encoding: 'utf8' });
    if (r.status !== 0) console.error(`  ! no se pudo crear ${zipPath}: ${(r.stderr || String(r.error)).trim()}`);
    else console.log(`  ↳ ${zipPath}`);
  }
}
