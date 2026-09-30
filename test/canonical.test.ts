// Funciones puras (no MOCK ni real): serialización canónica y hashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, hashOf, CanonicalizationError } from '../src/hash/canonical.ts';
import { contentProjection } from '../src/hash/fingerprint.ts';
import { snap } from './helpers.ts';
import { baseMasterSpec } from '../src/figma/mock/fixtures.ts';

test('el orden de claves no afecta al hash', () => {
  assert.equal(canonicalize({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(hashOf('k', { a: 1, b: 2 }), hashOf('k', { b: 2, a: 1 }));
});

test('números EXACTOS (pcb.hash.v2): sin redondeo; solo -0 → 0', () => {
  assert.equal(canonicalize([0.1 + 0.2, -0, 1e-9, 12.00004999]), '[0.30000000000000004,0,1e-9,12.00004999]');
});

test('T2: un cambio minúsculo cambia el hash de integridad (antes quedaba oculto por el redondeo)', () => {
  assert.notEqual(hashOf('t', { x: 100 }), hashOf('t', { x: 100.00001 }));
  assert.notEqual(hashOf('t', { m: 0.9999999710603369 }), hashOf('t', { m: 1 }));
});

test('NaN, Infinity y undefined se rechazan', () => {
  assert.throws(() => canonicalize({ a: NaN }), CanonicalizationError);
  assert.throws(() => canonicalize([Infinity]), CanonicalizationError);
  assert.throws(() => canonicalize({ a: undefined }), CanonicalizationError);
  assert.throws(() => canonicalize([undefined]), CanonicalizationError);
});

test('las cadenas no se normalizan: é compuesta ≠ é descompuesta', () => {
  assert.notEqual(hashOf('t', 'café'), hashOf('t', 'café'));
});

test('el orden de los arrays es significativo', () => {
  assert.notEqual(hashOf('t', [1, 2]), hashOf('t', [2, 1]));
});

test('MOCK: contentProjection no depende de IDs (un clon con IDs nuevos no cuenta como cambio de contenido)', async () => {
  const s = await snap(baseMasterSpec());
  const node = s.nodes.find((n) => n.id === '10:6')!;
  const cloneLike = { ...node, id: '999:1', parentId: '999:0', name: node.name };
  assert.equal(canonicalize(contentProjection(node)), canonicalize(contentProjection(cloneLike)));
});
