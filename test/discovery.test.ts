// MOCK: descubrimiento de la maestra desde un punto de entrada (sección, página) y enlace entrada → maestra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscoverScript, buildDiscoverRequest } from '../src/figma/discover-script.ts';
import { resolveFromDiscovery, normalizeName } from '../src/figma/resolve-master.ts';
import { staticReadOnlyViolations, buildReadScript } from '../src/figma/read-script.ts';
import { ingestReadResponses } from '../src/figma/ingest.ts';
import { mockReadRaw } from '../src/figma/mock/mock-relay.ts';
import { createFakeFigma, runScriptInMock, type MockNodeSpec } from '../src/figma/mock/fake-figma.ts';
import { fakeOptions, MOCK_FILE_KEY, SECTION_TARGET_NAME, sectionEntrySpec, mapSpec } from '../src/figma/mock/fixtures.ts';
import { classify } from '../src/inventory/classify.ts';
import { buildDraftManifest } from '../src/inventory/manifest.ts';
import { renderManifestReview } from '../src/report/review-md.ts';
import { exampleConfig } from './helpers.ts';

async function discover(spec: MockNodeSpec, entryId: string, target: string) {
  const fake = createFakeFigma(fakeOptions(spec));
  const { rawText } = await runScriptInMock(buildDiscoverScript(entryId, target), fake);
  assert.deepEqual(fake.violations, []);
  return { rawText, r: resolveFromDiscovery({ rawText, fileKey: MOCK_FILE_KEY, entryNodeId: entryId, targetName: target }) };
}

test('el script de descubrimiento no contiene mutaciones y valida sus entradas', () => {
  assert.deepEqual(staticReadOnlyViolations(buildDiscoverScript('4:141', SECTION_TARGET_NAME)), []);
  assert.deepEqual(staticReadOnlyViolations(buildReadScript('4:142', { chunkIndex: 3 })), []);
  assert.throws(() => buildDiscoverScript('4:141"; x', 'a'));
  assert.throws(() => buildDiscoverScript('4:141', 'bad\nname'));
  assert.ok(buildDiscoverRequest(MOCK_FILE_KEY, '4-141', SECTION_TARGET_NAME).code.length < 50_000);
});

test('MOCK: desde una SECTION se resuelve la composición por nombre exacto y único', async () => {
  const { r } = await discover(sectionEntrySpec(), '50:1', SECTION_TARGET_NAME);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.resolution.status, 'resolved');
  if (r.resolution.status !== 'resolved') return;
  assert.equal(r.resolution.entry.entryNodeId, '50:1');
  assert.equal(r.resolution.entry.entryType, 'SECTION');
  assert.equal(r.resolution.entry.masterNodeId, '50:10');
  assert.equal(r.resolution.entry.method, 'exact_name');
  assert.equal(r.resolution.entry.dimensionsFromNameMatch, true);
  assert.equal(r.payload.entryChildren.length, 3);
});

test('MOCK: una PÁGINA también sirve como punto de entrada', async () => {
  const { r } = await discover(sectionEntrySpec(), '1:1', SECTION_TARGET_NAME);
  assert.ok(r.ok && r.resolution.status === 'resolved');
  if (r.ok && r.resolution.status === 'resolved') assert.equal(r.resolution.entry.entryType, 'PAGE');
});

test('MOCK: dos composiciones con el mismo nombre exacto → ambigua (se pregunta)', async () => {
  const spec = mapSpec(sectionEntrySpec(), '50:20', (n) => ({ ...n, name: SECTION_TARGET_NAME }));
  const { r } = await discover(spec, '50:1', SECTION_TARGET_NAME);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.resolution.status, 'ambiguous');
    if (r.resolution.status === 'ambiguous') assert.deepEqual(r.resolution.candidates.map((c) => c.id).sort(), ['50:10', '50:20']);
  }
});

test('MOCK: sin coincidencia exacta, una única coincidencia normalizada ("x" por "×") se resuelve y se marca', async () => {
  const { r } = await discover(sectionEntrySpec(), '50:1', '960x1200_marca_SVA2');
  assert.ok(r.ok && r.resolution.status === 'resolved');
  if (r.ok && r.resolution.status === 'resolved') assert.equal(r.resolution.entry.method, 'normalized_name');
  assert.equal(normalizeName(' 960 × 1200 '), '960 x 1200');
});

test('MOCK: nombre inexistente → not_found con el listado de hijos de la entrada', async () => {
  const { r } = await discover(sectionEntrySpec(), '50:1', 'No existe');
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.resolution.status, 'not_found');
    if (r.resolution.status === 'not_found') assert.equal(r.resolution.entryChildren.length, 3);
  }
});

test('MOCK: la composición encontrada no es FRAME → wrong_type, sin inventario', async () => {
  const { r } = await discover(sectionEntrySpec(), '50:1', 'Botón CTA');
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.resolution.status, 'wrong_type');
});

test('MOCK: descubrimiento alterado en el transporte → rechazado', async () => {
  const { rawText } = await discover(sectionEntrySpec(), '50:1', SECTION_TARGET_NAME);
  const env = JSON.parse(rawText);
  env.payload = env.payload.replace('"50:10"', '"50:20"');
  const r = resolveFromDiscovery({ rawText: JSON.stringify(env), fileKey: MOCK_FILE_KEY, entryNodeId: '50:1', targetName: SECTION_TARGET_NAME });
  assert.equal(r.ok, false);
});

test('MOCK: cadena completa entrada → maestra → inventario conserva ambos IDs', async () => {
  const spec = sectionEntrySpec();
  const { r } = await discover(spec, '50:1', SECTION_TARGET_NAME);
  assert.ok(r.ok && r.resolution.status === 'resolved');
  if (!r.ok || r.resolution.status !== 'resolved') return;
  const entry = r.resolution.entry;
  const { responses, violations } = await mockReadRaw(spec, { rootId: entry.masterNodeId });
  assert.deepEqual(violations, []);
  const ing = ingestReadResponses({ responses, fileKey: MOCK_FILE_KEY, expectedRootNodeId: entry.masterNodeId, source: 'MOCK', entry });
  assert.ok(ing.ok);
  if (!ing.ok) return;
  assert.deepEqual(ing.snapshot.entry, entry);
  assert.equal(ing.snapshot.nodes[0]!.id, '50:10');
  assert.ok(!ing.snapshot.nodes.some((n) => n.id.startsWith('50:2') || n.id === '50:30'), 'solo se inventaría la maestra');
  const cfg = exampleConfig();
  const m = buildDraftManifest(ing.snapshot, classify(ing.snapshot, cfg), cfg, '2026-09-29T00:00:00.000Z');
  assert.deepEqual(m.master.entry, entry);
  assert.ok(renderManifestReview(m, ing.snapshot).includes('Punto de entrada del usuario: `50:1` (SECTION) → maestra resuelta `50:10`'));
  // El enlace entrada→maestra no altera la huella de la maestra.
  const plain = ingestReadResponses({ responses, fileKey: MOCK_FILE_KEY, expectedRootNodeId: '50:10', source: 'MOCK' });
  assert.ok(plain.ok);
  if (plain.ok) assert.equal(plain.snapshot.fingerprints.master, ing.snapshot.fingerprints.master);
  // Un enlace que apunta a otra maestra se rechaza.
  const wrong = ingestReadResponses({ responses, fileKey: MOCK_FILE_KEY, expectedRootNodeId: '50:10', source: 'MOCK', entry: { ...entry, masterNodeId: '50:20' } });
  assert.equal(wrong.ok, false);
});
