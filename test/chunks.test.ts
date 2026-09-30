// MOCK: transporte por fragmentos. Pérdidas, duplicados, desorden, truncamiento, Unicode y cambios entre llamadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestReadResponses } from '../src/figma/ingest.ts';
import { assembleChunks } from '../src/figma/chunks.ts';
import { mockReadRaw, mockReadChunk } from '../src/figma/mock/mock-relay.ts';
import { baseMasterSpec, MOCK_FILE_KEY, mapSpec } from '../src/figma/mock/fixtures.ts';
import { MAX_RESPONSE_BYTES, OBSERVED_MCP_RESPONSE_LIMIT, DEFAULT_CHUNK_BYTE_BUDGET } from '../src/figma/read-script.ts';

const asResponses = (texts: string[]) => texts.map((rawText) => ({ rawText, rawResponsePath: null }));
const codes = (r: ReturnType<typeof assembleChunks>) => (r.ok ? [] : r.errors.map((e) => e.code));
const SMALL = { byteBudget: 2_000 };

/** Texto con multibyte, pares sustitutos, comillas y barras invertidas: fuerza cortes en posiciones delicadas. */
const TRICKY = 'Oferta 960×1200 · ñandú “curvas” "rectas" \\barra\\ 🎉🔥 ✓ — 𝒜 fin';
const unicodeSpec = () =>
  mapSpec(baseMasterSpec(), '10:6', (n) => ({ ...n, name: TRICKY.repeat(3), text: { characters: TRICKY.repeat(6) } }));

test('MOCK: fragmentos completos en orden inverso → se reordenan y el payload verifica', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec(), SMALL);
  assert.ok(rawTexts.length >= 4);
  const r = assembleChunks(asResponses([...rawTexts].reverse()));
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value.calls.map((c) => c.chunkIndex), [...rawTexts.keys()]);
});

test('MOCK: fragmento ausente → CHUNK_MISSING con los índices', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec(), SMALL);
  const r = assembleChunks(asResponses(rawTexts.filter((_, i) => i !== 1)));
  assert.deepEqual(codes(r), ['CHUNK_MISSING']);
  if (!r.ok) assert.match(r.errors[0]!.message, /faltan fragmentos: 1 de/);
});

test('MOCK: duplicado idéntico → se descarta y se informa', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec(), SMALL);
  const r = assembleChunks(asResponses([...rawTexts, rawTexts[2]!]));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.duplicatesDiscarded, 1);
  const ing = ingestReadResponses({ responses: asResponses([...rawTexts, rawTexts[0]!]), fileKey: MOCK_FILE_KEY, expectedRootNodeId: '10:1', source: 'MOCK' });
  assert.ok(ing.ok);
  if (ing.ok) assert.ok(ing.warnings.some((w) => w.includes('duplicado')));
});

test('MOCK: duplicado incompatible (mismo índice, otro contenido) → DUPLICATE_CONFLICT o SET_MISMATCH', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec(), SMALL);
  // Mismo índice y mismo conjunto declarado, pero fragmento distinto con su hash recalculado.
  const env = JSON.parse(rawTexts[1]!);
  const { createHash } = await import('node:crypto');
  env.chunk = env.chunk.slice(0, -1) + (env.chunk.endsWith('a') ? 'b' : 'a');
  env.chunkSha256 = `sha256:${createHash('sha256').update(env.chunk, 'utf8').digest('hex')}`;
  const r = assembleChunks(asResponses([...rawTexts, JSON.stringify(env)]));
  assert.deepEqual(codes(r), ['DUPLICATE_CONFLICT']);
});

test('MOCK: truncamiento en cualquier fragmento → RESPONSE_TRUNCATED', async () => {
  const { rawTexts } = await mockReadRaw(baseMasterSpec(), SMALL);
  const cut = [...rawTexts];
  cut[2] = `${cut[2]!.slice(0, 500)}// truncated to 20kb`;
  assert.deepEqual(codes(assembleChunks(asResponses(cut))), ['RESPONSE_TRUNCATED']);
});

test('MOCK: cambio de contenido entre llamadas → SET_MISMATCH; releer todo el conjunto lo resuelve', async () => {
  const changed = mapSpec(baseMasterSpec(), '10:10', (n) => ({ ...n, text: { characters: 'Legal modificado entre llamadas' } }));
  const mixed = await mockReadRaw(baseMasterSpec(), { ...SMALL, specForCall: (i) => (i >= 2 ? changed : baseMasterSpec()) });
  const r = assembleChunks(mixed.responses);
  assert.deepEqual(codes(r), ['SET_MISMATCH']);
  if (!r.ok) assert.match(r.errors[0]!.message, /Descartar el conjunto/);
  // Reinicio acotado: una relectura completa y estable ensambla sin errores.
  const again = await mockReadRaw(changed, SMALL);
  assert.ok(assembleChunks(again.responses).ok);
});

test('MOCK: mezcla de conjuntos con distinto presupuesto → SET_MISMATCH', async () => {
  const a = await mockReadRaw(baseMasterSpec(), SMALL);
  const b = await mockReadRaw(baseMasterSpec(), { byteBudget: 3_000 });
  assert.deepEqual(codes(assembleChunks(asResponses([a.rawTexts[0]!, ...b.rawTexts.slice(1)]))), ['SET_MISMATCH']);
});

test('MOCK: Unicode — los cortes respetan pares sustitutos y el presupuesto en bytes del texto escapado', async () => {
  const { rawTexts } = await mockReadRaw(unicodeSpec(), { byteBudget: 300, maxResponseBytes: 2_000 });
  assert.ok(rawTexts.length > 10);
  for (const t of rawTexts) {
    const env = JSON.parse(t);
    const first = env.chunk.charCodeAt(0);
    const last = env.chunk.charCodeAt(env.chunk.length - 1);
    assert.ok(!(first >= 0xdc00 && first <= 0xdfff), 'no empieza por surrogate bajo');
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'no termina en surrogate alto');
    assert.ok(Buffer.byteLength(JSON.stringify(env.chunk), 'utf8') - 2 <= 300 + 6, 'presupuesto en bytes escapados');
    assert.equal(env.call.responseBytes, Buffer.byteLength(t, 'utf8'), 'responseBytes = bytes UTF-8 reales de la respuesta');
  }
  const ing = ingestReadResponses({ responses: asResponses(rawTexts), fileKey: MOCK_FILE_KEY, expectedRootNodeId: '10:1', source: 'MOCK' });
  assert.ok(ing.ok);
  if (ing.ok) assert.equal(ing.snapshot.nodes.find((n) => n.id === '10:6')!.text!.characters, TRICKY.repeat(6));
});

test('MOCK: con el presupuesto por defecto cada respuesta queda muy por debajo del límite observado del MCP', async () => {
  const { rawTexts } = await mockReadRaw(unicodeSpec());
  for (const t of rawTexts) {
    const bytes = Buffer.byteLength(t, 'utf8');
    assert.ok(bytes <= MAX_RESPONSE_BYTES && MAX_RESPONSE_BYTES < OBSERVED_MCP_RESPONSE_LIMIT, `${bytes} B`);
  }
  assert.ok(DEFAULT_CHUNK_BYTE_BUDGET < MAX_RESPONSE_BYTES);
});

test('MOCK: el script se niega a devolver una respuesta mayor que el tope y rechaza índices fuera de rango', async () => {
  await assert.rejects(mockReadChunk(baseMasterSpec(), 0, { byteBudget: 3_000, maxResponseBytes: 3_100 }), /PCB_RESPONSE_TOO_LARGE/);
  await assert.rejects(mockReadChunk(baseMasterSpec(), 999, SMALL), /PCB_CHUNK_OUT_OF_RANGE index=999/);
});

test('sin respuestas → NO_RESPONSES', () => {
  assert.deepEqual(codes(assembleChunks([])), ['NO_RESPONSES']);
});

test('MOCK [observado en real]: la disponibilidad de fuentes alterna entre llamadas → el conjunto sigue siendo coherente, el entorno lo registra y la aprobación queda bloqueada', async () => {
  const withMissing = mapSpec(baseMasterSpec(), '10:6', (n) => ({ ...n, text: { characters: n.text!.characters, hasMissingFont: true } }));
  const { responses } = await mockReadRaw(baseMasterSpec(), { ...SMALL, specForCall: (i) => (i % 2 === 0 ? withMissing : baseMasterSpec()) });
  const r = ingestReadResponses({ responses, fileKey: MOCK_FILE_KEY, expectedRootNodeId: '10:1', source: 'MOCK' });
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors));
  if (!r.ok) return;
  assert.deepEqual(r.snapshot.environment.nodesWithMissingFont, ['10:6']);
  assert.equal(r.snapshot.environment.missingFontStable, false);
  assert.ok(r.warnings.some((w) => w.includes('varió entre llamadas')));
  assert.ok(r.snapshot.nodes.every((n) => n.text === null || n.text.hasMissingFont === null), 'el payload estable no lleva hasMissingFont');
  const { approveManifest, buildDraftManifest } = await import('../src/inventory/manifest.ts');
  const { classify } = await import('../src/inventory/classify.ts');
  const { exampleConfig } = await import('./helpers.ts');
  const cfg = exampleConfig();
  const m = buildDraftManifest(r.snapshot, classify(r.snapshot, cfg), cfg, '2026-09-30T00:00:00.000Z');
  const e = m.entities.find((x) => x.nodeIds.includes('10:6'))!;
  assert.ok(e.review.reasons.includes('FONT_MISSING'));
  const a = approveManifest(m, r.snapshot, cfg, 'X', '2026-09-30T00:00:00.000Z');
  assert.equal(a.ok, false);
  if (!a.ok) assert.ok(a.issues.some((i) => i.code === 'FONT_MISSING_BLOCKS_APPROVAL'));
});
