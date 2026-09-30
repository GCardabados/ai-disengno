// Funciones puras: los esquemas Zod rechazan datos inválidos (no MOCK ni real).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseOrThrow } from '../src/contracts/schema.ts';
import { RectSchema, TransformSchema } from '../src/contracts/geometry.ts';
import { ReadChunkEnvelopeSchema } from '../src/contracts/snapshot.ts';
import { ProjectConfigSchema } from '../src/contracts/config.ts';
import { NodeDispositionSchema, ReviewDecisionsSchema, SemanticEntitySchema } from '../src/contracts/manifest.ts';
import { exampleConfig } from './helpers.ts';

test('objetos estrictos: una clave desconocida es un error con ruta', () => {
  const r = parse(RectSchema, { x: 0, y: 0, width: 1, height: 1, extra: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.path.startsWith('$')));
});

test('números: NaN, Infinity y negativos donde no se permiten', () => {
  assert.equal(parse(RectSchema, { x: NaN, y: 0, width: 1, height: 1 }).ok, false);
  assert.equal(parse(RectSchema, { x: Infinity, y: 0, width: 1, height: 1 }).ok, false);
  assert.equal(parse(RectSchema, { x: 0, y: 0, width: -1, height: 1 }).ok, false);
  assert.equal(parse(TransformSchema, [[1, 0, 0], [0, 1]]).ok, false);
});

test('sobre de fragmento: hash mal formado, setId inválido o índice negativo', () => {
  const h = `sha256:${'0'.repeat(64)}`;
  const ok = {
    schema: 'pcb.read.chunk.envelope.v2', setId: 'set_0000000000000000_b12000', rootNodeId: '1:2', payloadSchema: 'pcb.read.v3',
    payloadSha256: h, payloadBytes: 2, payloadChars: 2, byteBudget: 12000, chunkIndex: 0, chunkCount: 1, chunk: '{}',
    chunkSha256: h, chunkBytes: 2, chunkChars: 2, call: { scriptVersion: 'x', skipInvisibleInstanceChildrenBefore: null, missingFontNodeIds: [], responseBytes: 10 },
  };
  assert.ok(parse(ReadChunkEnvelopeSchema, ok).ok);
  assert.equal(parse(ReadChunkEnvelopeSchema, { ...ok, chunkSha256: 'md5:abc' }).ok, false);
  assert.equal(parse(ReadChunkEnvelopeSchema, { ...ok, setId: 'otro' }).ok, false);
  assert.equal(parse(ReadChunkEnvelopeSchema, { ...ok, chunkIndex: -1 }).ok, false);
  assert.equal(parse(ReadChunkEnvelopeSchema, { ...ok, payloadSchema: 'pcb.read.v2' }).ok, false);
});

test('unión discriminada: etiqueta desconocida o campos del tipo equivocado', () => {
  assert.equal(parse(NodeDispositionSchema, { kind: 'maybe', nodeId: '1:1' }).ok, false);
  assert.equal(parse(NodeDispositionSchema, { kind: 'pending', nodeId: '1:1', reasons: [] }).ok, false);
  assert.equal(parse(NodeDispositionSchema, { kind: 'content', nodeId: '1:1', entityId: 'e', justification: 'root' }).ok, false);
});

test('entidad: ID con formato inválido y naturaleza fuera de la lista', () => {
  const base = {
    entityId: 'ent_000000000000', role: null, roleHints: [], nodeIds: ['1:1'], contentNature: 'editable_text', evidence: [],
    review: { status: 'needs_review', reasons: [], reviewedBy: null, reviewedAt: null, notes: null },
    constraints: { allowOps: [], allowReflow: false, atomicGroup: null, protectedRegions: [], mustBeInSafeZone: null },
  };
  assert.ok(parse(SemanticEntitySchema, base).ok);
  assert.equal(parse(SemanticEntitySchema, { ...base, entityId: 'ent_x' }).ok, false);
  assert.equal(parse(SemanticEntitySchema, { ...base, contentNature: 'png' }).ok, false);
  assert.equal(parse(SemanticEntitySchema, { ...base, constraints: { ...base.constraints, allowOps: ['scale_uniform'] } }).ok, false);
});

test('revisión: sin nombre declarado o con decisiones mal formadas', () => {
  const ok = { schema: 'pcb.review.v1', manifestHash: 'h', reviewer: 'R', entities: {}, pending: {}, compositions: {}, relations: [] };
  assert.ok(parse(ReviewDecisionsSchema, ok).ok);
  assert.equal(parse(ReviewDecisionsSchema, { ...ok, reviewer: '' }).ok, false);
  assert.equal(parse(ReviewDecisionsSchema, { ...ok, entities: { e: { status: 'maybe' } } }).ok, false);
  assert.equal(parse(ReviewDecisionsSchema, { ...ok, pending: { '1:1': { resolution: 'structural', justification: 'root' } } }).ok, false);
});

test('config: la configuración de ejemplo es válida y los errores se informan con etiqueta', () => {
  assert.ok(parse(ProjectConfigSchema, exampleConfig()).ok);
  assert.throws(() => parseOrThrow(ProjectConfigSchema, { ...exampleConfig(), ocr: { enabled: 'yes' } }, 'config'), /^Error: config: \d+ schema issue/);
});
