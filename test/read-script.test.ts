// MOCK: el script de lectura se ejecuta contra un `figma` falso. No prueba el comportamiento de Figma real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReadRequest, buildReadScript, staticReadOnlyViolations, normalizeNodeId } from '../src/figma/read-script.ts';
import { createFakeFigma, runScriptInMock } from '../src/figma/mock/fake-figma.ts';
import { baseMasterSpec, fakeOptions, MOCK_FILE_KEY } from '../src/figma/mock/fixtures.ts';

test('el script no contiene llamadas de mutación (comprobación estática)', () => {
  assert.deepEqual(staticReadOnlyViolations(buildReadScript('10:1')), []);
});

test('la comprobación estática detecta una mutación inyectada', () => {
  const tampered = `${buildReadScript('10:1')}\nroot.resize(10, 10);`;
  assert.ok(staticReadOnlyViolations(tampered).length > 0);
});

test('la petición cabe en el límite de use_figma y valida fileKey e ID', () => {
  const req = buildReadRequest(MOCK_FILE_KEY, '10-1');
  assert.ok(req.code.length < 50_000);
  assert.equal(req.readOnly, true);
  assert.throws(() => buildReadRequest('bad key', '10:1'));
  assert.throws(() => normalizeNodeId('10:1"; figma.root.remove(); "'));
});

test('MOCK: el script se ejecuta sin ninguna escritura sobre el documento', async () => {
  const fake = createFakeFigma(fakeOptions(baseMasterSpec()));
  const { returned } = await runScriptInMock(buildReadScript('10:1'), fake);
  assert.deepEqual(fake.violations, []);
  const env = returned as { schema: string; payload: string };
  assert.equal(env.schema, 'pcb.read.envelope.v1');
  const payload = JSON.parse(env.payload);
  assert.equal(payload.nodeCount, 20);
  assert.equal(payload.runtime.skipInvisibleInstanceChildrenBefore, true);
});

test('MOCK: el `figma` falso rechaza escrituras (el guardián funciona)', async () => {
  const fake = createFakeFigma(fakeOptions(baseMasterSpec()));
  const code = `var n = await figma.getNodeByIdAsync('10:6'); n.characters = 'x'; return 1;`;
  await assert.rejects(runScriptInMock(code, fake), /MOCK_READONLY_VIOLATION/);
  assert.equal(fake.violations.length, 1);
});

test('MOCK: raíz inexistente produce error explícito', async () => {
  const fake = createFakeFigma(fakeOptions(baseMasterSpec()));
  await assert.rejects(runScriptInMock(buildReadScript('99:99'), fake), /PCB_ROOT_NOT_FOUND/);
});
