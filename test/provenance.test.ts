// MOCK: la procedencia MOCK sobrevive a la aprobación y se muestra en los informes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/inventory/classify.ts';
import { applyReview, approveManifest, buildDraftManifest } from '../src/inventory/manifest.ts';
import { renderManifestReview } from '../src/report/review-md.ts';
import { baseMasterSpec } from '../src/figma/mock/fixtures.ts';
import type { MasterSnapshot } from '../src/contracts/snapshot.ts';
import { exampleConfig, fullReviewForBase, snap } from './helpers.ts';

const cfg = exampleConfig();
const AT = '2026-09-29T00:00:00.000Z';

async function approvedMock() {
  const s = await snap(baseMasterSpec());
  const draft = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const reviewed = applyReview(draft, fullReviewForBase(draft), cfg, AT);
  assert.ok(reviewed.ok);
  if (!reviewed.ok) throw new Error('review');
  const approved = approveManifest(reviewed.manifest, s, cfg, 'Revisora MOCK', AT);
  assert.ok(approved.ok);
  if (!approved.ok) throw new Error('approve');
  return { s, draft, m: approved.manifest };
}

test('MOCK: el manifiesto aprobado conserva source MOCK', async () => {
  const { draft, m } = await approvedMock();
  assert.equal(draft.source, 'MOCK');
  assert.equal(m.source, 'MOCK');
  assert.equal(m.approval.status, 'approved');
});

test('MOCK: el informe marca MOCK en título, cabecera y cierre, también tras aprobar', async () => {
  const { s, m } = await approvedMock();
  const md = renderManifestReview(m, s);
  assert.ok(md.startsWith('# [MOCK] Revisión de inventario'));
  assert.ok(md.includes('MOCK — datos sintéticos'));
  assert.ok(md.includes('un manifiesto MOCK aprobado sigue siendo MOCK'));
  assert.ok(md.trimEnd().endsWith('no utilizar como inventario de una pieza real.**'));
  assert.ok(md.includes('nombre declarado; no autentica a ninguna persona'));
});

test('MOCK: un manifiesto MOCK no se aprueba contra una instantánea de otra procedencia', async () => {
  const s = await snap(baseMasterSpec());
  const draft = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const reviewed = applyReview(draft, fullReviewForBase(draft), cfg, AT);
  assert.ok(reviewed.ok);
  if (!reviewed.ok) return;
  const relabeled: MasterSnapshot = { ...s, source: 'FIGMA_MCP_USE_FIGMA' };
  const r = approveManifest(reviewed.manifest, relabeled, cfg, 'Revisora MOCK', AT);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.code === 'SOURCE_MISMATCH'));
});
