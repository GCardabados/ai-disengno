// Los paquetes portables de las skills deben funcionar solos: sin el repositorio, sin npm install y con la carpeta de
// trabajo en otro sitio. Se generan en un directorio temporal y se ejecutan desde allí.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'pcb-bundle-'));
const work = join(tmp, 'work');
const skills = ['adapt-master-creative', 'creative-content-variants'];

const run = (script: string, args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });

before(() => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-skills.ts'), '--out', join(tmp, 'skills')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  spawnSync('mkdir', ['-p', work]);
});
after(() => rmSync(tmp, { recursive: true, force: true }));

for (const name of skills) {
  test(`paquete ${name}: autosuficiente (doctor, CLI y mock sin el repositorio)`, () => {
    const dir = join(tmp, 'skills', name);
    for (const f of ['SKILL.md', 'references/instalacion.md', 'cli/src/cli.ts', 'cli/package.json', 'cli/config/example.project.json', 'cli/node_modules/zod/package.json']) {
      assert.ok(existsSync(join(dir, f)), `falta ${f}`);
    }
    const cli = join(dir, 'cli', 'src', 'cli.ts');
    const doctor = run(cli, ['doctor']);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
    assert.match(doctor.stdout, /✓ config/);
    const mock = run(cli, ['mock-read', '--fixture', 'base', '--out', join(work, name, 'read')]);
    assert.equal(mock.status, 0, mock.stdout + mock.stderr);
    assert.ok(existsSync(join(work, name, 'read', 'raw-response-0.MOCK.txt')));
    assert.ok(!existsSync(join(dir, 'runs')), 'la skill no debe escribir dentro de su carpeta');
  });

  test(`paquete ${name}: el SKILL.md solo cita archivos que existen en el paquete`, () => {
    const dir = join(tmp, 'skills', name);
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    for (const m of text.matchAll(/\]\((references\/[^)]+)\)/g)) assert.ok(existsSync(join(dir, m[1]!)), `enlace roto: ${m[1]}`);
    for (const m of text.matchAll(/<PCB>\/((?:src|scripts|config)\/[\w./-]+\.(?:ts|py|json))/g)) assert.ok(existsSync(join(dir, 'cli', m[1]!)), `no existe <PCB>/${m[1]}`);
    assert.doesNotMatch(text, /`(?:docs|plantillas)\//, 'referencia a carpetas que solo existen en el repositorio');
  });
}

test('paquete adapt-master-creative: el ejemplo sin Figma corre desde otra carpeta de trabajo', () => {
  const r = run(join(tmp, 'skills', 'adapt-master-creative', 'cli', 'scripts', 'ejemplo-offline.ts'), []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(work, 'runs', 'ejemplo-offline', 'plan.json')));
});
