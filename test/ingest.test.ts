// MOCK: ingesta sobre respuestas generadas por el `figma` falso (una llamada por fragmento).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ingestReadResponses, type IngestInput } from '../src/figma/ingest.ts';
import { mockReadRaw } from '../src/figma/mock/mock-relay.ts';
import { baseMasterSpec, MOCK_FILE_KEY, readErrorMasterSpec } from '../src/figma/mock/fixtures.ts';

const ONE_CHUNK = { byteBudget: 5_000_000, maxResponseBytes: 6_000_000 };
const sha = (s: string) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;

const ingest = (rawTexts: string[], extra: Partial<IngestInput> = {}) =>
  ingestReadResponses({
    responses: rawTexts.map((rawText) => ({ rawText, rawResponsePath: null })),
    fileKey: MOCK_FILE_KEY,
    expectedRootNodeId: '10:1',
    source: 'MOCK',
    ...extra,
  });

/** Reescribe un fragmento manteniendo coherentes sus propios hashes (simula un emisor distinto). */
function reseal(rawText: string, mutate: (payload: string) => string): string {
  const env = JSON.parse(rawText);
  env.chunk = mutate(env.chunk);
  env.chunkSha256 = sha(env.chunk);
  env.chunkChars = env.chunk.length;
  env.chunkBytes = Buffer.byteLength(env.chunk, 'utf8');
  env.payloadSha256 = sha(env.chunk);
  env.payloadChars = env.chunk.length;
  env.payloadBytes = env.chunkBytes;
  env.setId = `set_${env.payloadSha256.slice(7, 23)}_b${env.byteBudget}`;
  return JSON.stringify(env);
}

test('MOCK: ingesta correcta con huellas versionadas y procedencia de cada llamada', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec());
  assert.ok(rawTexts.length > 1, 'la maestra base ocupa varios fragmentos con el presupuesto por defecto');
  const r = ingest(rawTexts);
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors));
  if (!r.ok) return;
  assert.equal(r.snapshot.source, 'MOCK');
  assert.equal(r.snapshot.nodes.length, 20);
  assert.equal(r.snapshot.fingerprints.version, 'pcb.fingerprint.v2');
  assert.equal(r.snapshot.transport.chunkCount, rawTexts.length);
  assert.deepEqual(r.snapshot.transport.calls.map((c) => c.chunkIndex), [...rawTexts.keys()]);
  assert.ok(r.snapshot.transport.calls.every((c) => /^sha256:[0-9a-f]{64}$/.test(c.rawResponseSha256)));
});

test('MOCK: fragmento alterado en el transporte → CHUNK_DIGEST_MISMATCH', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec(), ONE_CHUNK);
  const env = JSON.parse(rawTexts[0]!);
  env.chunk = env.chunk.replace('Nueva colección de otoño', 'Nueva colección de invierno');
  const r = ingest([JSON.stringify(env)]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors[0]!.code, 'CHUNK_DIGEST_MISMATCH');
});

test('MOCK: respuesta truncada por el transporte → RESPONSE_TRUNCATED', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec(), ONE_CHUNK);
  const truncated = `${rawTexts[0]!.slice(0, 20_480)}// truncated to 20kb`;
  const r = ingest([truncated]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors[0]!.code, 'RESPONSE_TRUNCATED');
});

test('MOCK: sobre anidado en bloques de contenido (formato observado en real) → embedded_json_block', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec());
  const r = ingest(rawTexts.map((t) => JSON.stringify([{ type: 'text', text: t }])));
  assert.ok(r.ok);
  if (r.ok) assert.ok(r.snapshot.transport.calls.every((c) => c.envelopeExtraction === 'embedded_json_block'));
});

test('MOCK: raíz o fileKey distintos de lo solicitado → rechazado', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec());
  assert.equal(ingest(rawTexts, { expectedRootNodeId: '10:2' }).ok, false);
  const r2 = ingest(rawTexts, { fileKey: 'OTHERfileKey000000000000' });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.ok(r2.errors.some((e) => e.code === 'FILE_KEY_MISMATCH'));
});

test('MOCK: deriva de contrato (campo desconocido) → PAYLOAD_SCHEMA, aunque todos los hashes sean válidos', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec(), ONE_CHUNK);
  const resealed = reseal(rawTexts[0]!, (p) => {
    const payload = JSON.parse(p);
    payload.nodes[0].unexpected = true;
    return JSON.stringify(payload);
  });
  const r = ingest([resealed]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.every((e) => e.code === 'PAYLOAD_SCHEMA'));
});

test('MOCK: propiedades ilegibles quedan en readErrors, sin valores inventados', async () => {
  const { rawTexts } = await mockReadRaw(readErrorMasterSpec());
  const r = ingest(rawTexts, { expectedRootNodeId: '30:1' });
  assert.ok(r.ok);
  if (!r.ok) return;
  const rect = r.snapshot.nodes.find((n) => n.id === '30:2')!;
  assert.equal(rect.absoluteRenderBounds, null);
  assert.ok(rect.readErrors.some((e) => e.startsWith('absoluteRenderBounds')));
  assert.equal(r.snapshot.nodes.find((n) => n.id === '30:3')!.text!.segmentFields, 'minimal');
});

test('MOCK: la ingesta también exige el tipo de raíz (defensa en profundidad)', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec());
  const r = ingest(rawTexts, { expectedRootType: 'COMPONENT' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.code === 'ROOT_TYPE_MISMATCH'));
});

test('MOCK: el contenido y las huellas no dependen del presupuesto de fragmentación', async () => {
  const a = ingest((await mockReadRaw(baseMasterSpec())).rawTexts);
  const b = ingest((await mockReadRaw(baseMasterSpec(), { byteBudget: 3_000 })).rawTexts);
  const c = ingest((await mockReadRaw(baseMasterSpec(), ONE_CHUNK)).rawTexts);
  assert.ok(a.ok && b.ok && c.ok);
  if (a.ok && b.ok && c.ok) {
    assert.equal(a.snapshot.transport.payloadSha256, b.snapshot.transport.payloadSha256);
    assert.equal(a.snapshot.fingerprints.master, c.snapshot.fingerprints.master);
    assert.notEqual(a.snapshot.transport.setId, b.snapshot.transport.setId, 'el setId incluye el presupuesto');
  }
});

test('MOCK: la instantánea producida por la ingesta cumple su propio esquema estricto', async () => {
  const { parse } = await import('../src/contracts/schema.ts');
  const { MasterSnapshotSchema } = await import('../src/contracts/snapshot.ts');
  const r = ingest((await mockReadRaw(baseMasterSpec())).rawTexts);
  assert.ok(r.ok);
  if (r.ok) assert.ok(parse(MasterSnapshotSchema, JSON.parse(JSON.stringify(r.snapshot))).ok);
});
