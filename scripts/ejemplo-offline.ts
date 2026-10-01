// Ejemplo SIN Figma: recorre el flujo con la maestra sintética del repositorio y el encargo de ejemplos/mock-4x5-a-1x1.
// Escribe solo en runs/ejemplo-offline/ (ignorado por Git). No contacta con Figma ni con ningún servicio externo.
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'runs', 'ejemplo-offline');
const ex = join(root, 'ejemplos', 'mock-4x5-a-1x1');
rmSync(out, { recursive: true, force: true });

function pcb(label: string, args: string[], okCodes = [0]): void {
  console.log(`\n▶ ${label}\n  node src/cli.ts ${args.join(' ').replaceAll(root + '/', '')}`);
  const r = spawnSync(process.execPath, [join(root, 'src', 'cli.ts'), ...args], { encoding: 'utf8' });
  const text = `${r.stdout}${r.stderr}`.trim();
  if (text) console.log(text.split('\n').map((l) => `  ${l}`).join('\n'));
  if (!okCodes.includes(r.status ?? -1)) { console.error(`\n✗ «${label}» terminó con código ${r.status}`); process.exit(1); }
}

pcb('1. Lectura simulada de la maestra (MOCK)', ['mock-read', '--fixture', 'base', '--out', join(out, 'read')]);
const raws = readdirSync(join(out, 'read')).filter((f) => f.startsWith('raw-response-')).flatMap((f) => ['--raw', join(out, 'read', f)]);
pcb('2. Ensamblado y verificación de la instantánea', ['ingest', ...raws, '--file-key', 'MOCKfileKey0000000000000', '--node-id', '10:1', '--source', 'mock', '--out', join(out, 'ingest')]);
pcb('3. Inventario (manifiesto borrador)', ['inventory', '--snapshot', join(out, 'ingest', 'snapshot.json'), '--config', join(root, 'config', 'example.project.json'), '--out', join(out, 'inventory')]);
pcb('4. Validación del encargo (job.json + composición)', ['job-check', '--job', join(ex, 'job.json')]);
pcb('5. Plan exacto del destino', ['demo-plan', '--snapshot', join(out, 'ingest', 'snapshot.json'), '--composition', join(ex, 'composition.json'), '--out', join(out, 'plan.json')]);
// precheck devuelve 3 si hay hallazgos: en el ejemplo se muestran y se sigue.
pcb('6. Predicción sin tocar Figma (precheck)', ['precheck', '--plan', join(out, 'plan.json'), '--composition', join(ex, 'composition.json'), '--snapshot', join(out, 'ingest', 'snapshot.json')], [0, 3]);
pcb('7. Script de escritura generado (NO se envía)', ['adapt-request', '--plan', join(out, 'plan.json'), '--composition', join(ex, 'composition.json'), '--file-key', 'MOCKfileKey0000000000000', '--clone-name', 'EJEMPLO_1080x1080 · Maestra 4:5 · pendiente de revisión humana', '--out', join(out, 'adapt-request.json')]);
console.log(`\n✓ Ejemplo completado en ${out.replace(root + '/', '')}. No se ha escrito nada en Figma.`);
console.log('  Observa en inventory/review.md cómo un texto de la maestra que da «instrucciones» se trata como dato.');
