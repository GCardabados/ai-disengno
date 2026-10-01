// Comprobación inicial de entorno y capacidades (solo lectura: no instala ni escribe nada).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type DoctorLevel = 'ok' | 'warn' | 'error' | 'info';
export interface DoctorItem { id: string; level: DoctorLevel; message: string }

/** Compara versiones x.y.z (sin prefijo 'v'). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number), pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return Math.sign(d); }
  return 0;
}

/** ¿Cumple un rango sencillo del estilo ">=24.21.0 <25"? (solo comparadores >=, >, <=, <, =). */
export function satisfiesRange(version: string, range: string): boolean {
  return range.trim().split(/\s+/).every((part) => {
    const m = /^(>=|<=|>|<|=)?v?(\d+(?:\.\d+){0,2})$/.exec(part);
    if (!m) return false;
    const c = compareVersions(version, m[2]!);
    switch (m[1] ?? '=') {
      case '>=': return c >= 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '<': return c < 0;
      default: return c === 0;
    }
  });
}

const readText = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

export function runDoctor(root: string, nodeVersion = process.version): DoctorItem[] {
  const out: DoctorItem[] = [];
  const pkg = JSON.parse(readText(join(root, 'package.json')) ?? '{}') as { engines?: { node?: string }; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const pinned = readText(join(root, '.nvmrc'))?.trim() ?? null;
  const range = pkg.engines?.node ?? null;
  const v = nodeVersion.replace(/^v/, '');
  if (pinned && v === pinned) out.push({ id: 'node', level: 'ok', message: `Node ${v} (versión fijada en .nvmrc)` });
  else if (range && satisfiesRange(v, range)) out.push({ id: 'node', level: 'ok', message: `Node ${v} dentro de engines «${range}» (fijada: ${pinned ?? '—'})` });
  else out.push({ id: 'node', level: 'warn', message: `Node ${v} fuera de engines «${range ?? '—'}»; la versión validada es ${pinned ?? '—'}. Puede funcionar, pero instala la fijada (p. ej. con nvm/fnm) si algo falla.` });

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const missing: string[] = [], mismatched: string[] = [];
  for (const [name, want] of Object.entries(deps)) {
    const installed = readText(join(root, 'node_modules', name, 'package.json'));
    if (!installed) { missing.push(name); continue; }
    const got = (JSON.parse(installed) as { version?: string }).version;
    if (/^\d/.test(want) && got !== want) mismatched.push(`${name} ${got} ≠ ${want}`);
  }
  if (missing.length) out.push({ id: 'deps', level: 'error', message: `Faltan dependencias: ${missing.join(', ')}. Ejecuta «npm ci».` });
  else if (mismatched.length) out.push({ id: 'deps', level: 'warn', message: `Versiones distintas al lockfile: ${mismatched.join('; ')}. Ejecuta «npm ci».` });
  else out.push({ id: 'deps', level: 'ok', message: `Dependencias instaladas y exactas (${Object.keys(deps).length})` });

  const py = spawnSync('python3', ['-c', 'import numpy, PIL; print(numpy.__version__, PIL.__version__)'], { encoding: 'utf8' });
  if (py.error) out.push({ id: 'python', level: 'warn', message: 'python3 no disponible: no se podrán extraer evidencias del registro de sesión (scripts/extract-tool-calls.py) ni hacer mediciones/superposiciones.' });
  else if (py.status !== 0) {
    const base = spawnSync('python3', ['--version'], { encoding: 'utf8' });
    out.push({ id: 'python', level: 'warn', message: `${(base.stdout || base.stderr).trim()} sin numpy/Pillow: extract-tool-calls funciona; measure-layout y las superposiciones no (pip install numpy pillow).` });
  } else out.push({ id: 'python', level: 'ok', message: `python3 con numpy/Pillow (${py.stdout.trim()})` });

  const gi = readText(join(root, '.gitignore')) ?? '';
  out.push(/^\/?runs\/?\s*$/m.test(gi)
    ? { id: 'git', level: 'ok', message: 'runs/ está ignorado: resultados y capturas nuevos quedan fuera de Git (versiónalos con «git add -f» solo si se decide).' }
    : { id: 'git', level: 'warn', message: 'runs/ no está en .gitignore: los resultados y capturas se versionarían por defecto.' });

  out.push({ id: 'figma', level: 'info', message: 'Figma no se comprueba desde aquí: en Claude Code el agente verifica el conector (whoami) y hace una lectura de solo lectura. Escribir clones exige asiento Full en el archivo (con View/Dev el MCP rechaza la escritura).' });
  return out;
}
