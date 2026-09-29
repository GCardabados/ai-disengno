// MOCK: ingesta y fidelidad del transporte sobre respuestas generadas por el `figma` falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestReadResponse } from '../src/figma/ingest.ts';
import { mockReadRaw } from '../src/figma/mock/mock-relay.ts';
import { baseMasterSpec, MOCK_FILE_KEY, readErrorMasterSpec } from '../src/figma/mock/fixtures.ts';

const ingest = (rawText: string, extra: Partial<Parameters<typeof ingestReadResponse>[0]> = {}) =>
  ingestReadResponse({ rawText, fileKey: MOCK_FILE_KEY, expectedRootNodeId: '10:1', source: 'MOCK', rawResponsePath: null, ...extra });

test('MOCK: ingesta correcta con huellas y hash de la respuesta original', async () => {
  const { rawText } = await mockReadRaw(baseMasterSpec());
  const r = ingest(rawText);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.snapshot.source, 'MOCK');
  assert.equal(r.snapshot.nodes.length, 20);
  assert.match(r.snapshot.transport.rawResponseSha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(r.snapshot.transport.envelopeExtraction, 'direct');
  assert.match(r.snapshot.fingerprints.master, /^sha256:/);
});

test('MOCK: payload alterado en el reenvío → TRANSPORT_DIGEST_MISMATCH', async () => {
  const { rawText } = await mockReadRaw(baseMasterSpec());
  const env = JSON.parse(rawText);
  env.payload = env.payload.replace('Nueva colección de otoño', 'Nueva colección de invierno');
  const r = ingest(JSON.stringify(env));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors[0]!.code, 'TRANSPORT_DIGEST_MISMATCH');
});

test('MOCK: respuesta truncada → rechazada', async () => {
  const { rawText } = await mockReadRaw(baseMasterSpec());
  const r = ingest(rawText.slice(0, rawText.length - 40));
  assert.equal(r.ok, false);
});

test('MOCK: sobre anidado en bloques de contenido (formato de envoltura supuesto) → embedded_json_block', async () => {
  const { rawText } = await mockReadRaw(baseMasterSpec());
  const wrapped = JSON.stringify([{ type: 'text', text: rawText }]);
  const r = ingest(wrapped);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.snapshot.transport.envelopeExtraction, 'embedded_json_block');
});

test('MOCK: raíz o fileKey distintos de lo solicitado → rechazado', async () => {
  const { rawText } = await mockReadRaw(baseMasterSpec());
  const r1 = ingest(rawText, { expectedRootNodeId: '10:2' });
  assert.equal(r1.ok, false);
  const r2 = ingest(rawText, { fileKey: 'OTHERfileKey000000000000' });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.ok(r2.errors.some((e) => e.code === 'FILE_KEY_MISMATCH'));
});

test('MOCK: deriva de contrato (campo desconocido) → PAYLOAD_SCHEMA, aunque el digest sea válido', async () => {
  const { rawText } = await mockReadRaw(baseMasterSpec());
  const env = JSON.parse(rawText);
  const payload = JSON.parse(env.payload);
  payload.nodes[0].unexpected = true;
  env.payload = JSON.stringify(payload);
  const { createHash } = await import('node:crypto');
  env.digest = `sha256:${createHash('sha256').update(env.payload, 'utf8').digest('hex')}`;
  env.payloadLength = env.payload.length;
  const r = ingest(JSON.stringify(env));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.every((e) => e.code === 'PAYLOAD_SCHEMA'));
});

test('MOCK: propiedades ilegibles quedan en readErrors, sin valores inventados', async () => {
  const spec = readErrorMasterSpec();
  const { rawText } = await mockReadRaw(spec);
  const r = ingestReadResponse({ rawText, fileKey: MOCK_FILE_KEY, expectedRootNodeId: '30:1', source: 'MOCK', rawResponsePath: null });
  assert.ok(r.ok);
  if (!r.ok) return;
  const rect = r.snapshot.nodes.find((n) => n.id === '30:2')!;
  assert.equal(rect.absoluteRenderBounds, null);
  assert.ok(rect.readErrors.some((e) => e.startsWith('absoluteRenderBounds')));
  const txt = r.snapshot.nodes.find((n) => n.id === '30:3')!;
  assert.equal(txt.text!.segmentFields, 'minimal');
});
