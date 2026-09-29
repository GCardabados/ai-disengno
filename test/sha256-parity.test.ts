// Paridad del SHA-256 que se ejecuta dentro de Figma con node:crypto (función pura, no MOCK ni real).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHA256_JS_SOURCE } from '../src/figma/sha256-js.ts';
import { sha256Hex } from '../src/hash/canonical.ts';

const jsSha = new Function(`${SHA256_JS_SOURCE}; return __pcbSha256;`)() as (s: string) => string;

const cases: Array<[string, string]> = [
  ['vacío', ''],
  ['ascii', 'abc'],
  ['bloque de 55 bytes', 'a'.repeat(55)],
  ['bloque de 56 bytes', 'a'.repeat(56)],
  ['bloque de 64 bytes', 'a'.repeat(64)],
  ['español', 'Oferta válida hasta el 31/10/2026 · 29,99 €'],
  ['emoji (par sustituto)', 'Rebajas 🎉🔥 ✓'],
  ['surrogate suelto', 'x\ud800y'],
  ['largo', JSON.stringify({ nodes: Array.from({ length: 500 }, (_, i) => ({ id: `1:${i}`, name: `Capa ñ ${i}` })) })],
];

for (const [label, input] of cases) {
  test(`sha256 JS == node:crypto — ${label}`, () => {
    assert.equal(jsSha(input), sha256Hex(input));
  });
}

test('vector conocido: sha256("abc")', () => {
  assert.equal(jsSha('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
