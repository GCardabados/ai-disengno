// MOCK + funciones puras: la aprobación queda vinculada a la huella de las reglas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/inventory/classify.ts';
import { applyReview, approveManifest, buildDraftManifest } from '../src/inventory/manifest.ts';
import { rulesFingerprint, RULES_FINGERPRINT_COVERS } from '../src/inventory/rules.ts';
import { baseMasterSpec } from '../src/figma/mock/fixtures.ts';
import type { ProjectConfig } from '../src/contracts/config.ts';
import type { Manifest } from '../src/contracts/manifest.ts';
import { exampleConfig, fullReviewForBase, snap } from './helpers.ts';

const cfg = exampleConfig();
const AT = '2026-09-29T00:00:00.000Z';

function withRole(c: ProjectConfig, id: string, patch: Partial<ProjectConfig['taxonomy']['roles'][number]>): ProjectConfig {
  return { ...c, taxonomy: { ...c.taxonomy, roles: c.taxonomy.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) } };
}

async function reviewed(): Promise<{ s: Awaited<ReturnType<typeof snap>>; m: Manifest }> {
  const s = await snap(baseMasterSpec());
  const draft = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const r = applyReview(draft, fullReviewForBase(draft), cfg, AT);
  assert.ok(r.ok);
  return { s, m: (r as { ok: true; manifest: Manifest }).manifest };
}

test('la huella de reglas cambia con el contenido aunque taxonomy.id y version no cambien', () => {
  const base = rulesFingerprint(cfg);
  assert.equal(rulesFingerprint(structuredClone(cfg)), base, 'determinista');
  const changes: ProjectConfig[] = [
    withRole(cfg, 'logo', { nameHints: ['logo', 'brand', 'marca', 'isotipo'] }),
    withRole(cfg, 'headline', { multiplicity: { min: 1, max: 2 } }),
    withRole(cfg, 'legal', { mustBeInSafeZone: false }),
    { ...cfg, heuristics: { vectorGlyphMinCount: 4 } },
    { ...cfg, approvers: ['Alguien'] },
    { ...cfg, tolerances: { linear: 1e-7, px: 0.01 } },
    { ...cfg, taxonomy: { ...cfg.taxonomy, roles: [...cfg.taxonomy.roles].reverse() } },
  ];
  for (const c of changes) {
    assert.equal(c.taxonomy.id, cfg.taxonomy.id);
    assert.equal(c.taxonomy.version, cfg.taxonomy.version);
    assert.notEqual(rulesFingerprint(c), base);
  }
});

test('campos excluidos documentados (status, visualReview) no alteran la huella', () => {
  const base = rulesFingerprint(cfg);
  assert.equal(rulesFingerprint({ ...cfg, status: 'approved' }), base);
  assert.equal(rulesFingerprint({ ...cfg, visualReview: { modelMayInspectScreenshots: true } }), base);
});

test('MOCK: el manifiesto registra la huella de reglas y los campos que cubre', async () => {
  const { m } = await reviewed();
  assert.equal(m.rules.fingerprint, rulesFingerprint(cfg));
  assert.deepEqual(m.rules.covers, [...RULES_FINGERPRINT_COVERS]);
});

test('MOCK: cambiar una regla (misma versión de taxonomía) tras el inventario bloquea la aprobación', async () => {
  const { s, m } = await reviewed();
  const changed = withRole(cfg, 'body', { nameHints: ['body', 'cuerpo', 'copy', 'texto'] });
  const r = approveManifest(m, s, changed, 'Revisora MOCK', AT);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.issues.map((i) => i.code), ['RULES_CHANGED_SINCE_INVENTORY']);
  // Con las reglas originales sí se aprueba.
  assert.ok(approveManifest(m, s, cfg, 'Revisora MOCK', AT).ok);
});

test('MOCK: aplicar una revisión con reglas distintas de las del inventario se rechaza', async () => {
  const s = await snap(baseMasterSpec());
  const draft = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const r = applyReview(draft, fullReviewForBase(draft), { ...cfg, heuristics: { vectorGlyphMinCount: 5 } }, AT);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.code === 'RULES_CHANGED_SINCE_INVENTORY'));
});
