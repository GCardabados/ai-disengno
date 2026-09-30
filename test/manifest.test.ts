// MOCK: revisión, aprobación y verificación de la maestra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/inventory/classify.ts';
import { applyReview, approveManifest, buildDraftManifest, verifyManifestHash, verifyMasterUnchanged } from '../src/inventory/manifest.ts';
import { baseMasterSpec, mapSpec, missingFontMasterSpec } from '../src/figma/mock/fixtures.ts';
import type { Manifest } from '../src/contracts/manifest.ts';
import { entityOf, exampleConfig, fullReviewForBase, snap } from './helpers.ts';

const cfg = exampleConfig();
const AT = '2026-09-29T00:00:00.000Z';

async function reviewedBase() {
  const s = await snap(baseMasterSpec());
  const draft = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const r = applyReview(draft, fullReviewForBase(draft), cfg, AT);
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.issues));
  return { s, draft, reviewed: (r as { ok: true; manifest: Manifest }).manifest };
}

test('MOCK: el borrador no se puede aprobar (pendientes, roles sin asignar, naturalezas indeterminadas, composiciones)', async () => {
  const s = await snap(baseMasterSpec());
  const draft = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const r = approveManifest(draft, s, cfg, 'Revisora MOCK', AT);
  assert.equal(r.ok, false);
  if (r.ok) return;
  const codes = new Set(r.issues.map((i) => i.code));
  for (const c of ['PENDING_NODE', 'ENTITY_NOT_APPROVED', 'ROLE_INVALID', 'NATURE_UNDETERMINED', 'COMPOSITION_UNRESOLVED', 'ROLE_MULTIPLICITY']) {
    assert.ok(codes.has(c), `falta ${c}`);
  }
});

test('MOCK: revisión completa → aprobación; la declaración humana queda como evidencia', async () => {
  const { s, reviewed } = await reviewedBase();
  const banner = entityOf(reviewed, '10:13');
  assert.equal(banner.contentNature, 'image_embedded_text');
  assert.ok(banner.evidence.some((e) => e.kind === 'human_statement' && e.producedBy === 'Revisora MOCK'));
  const r = approveManifest(reviewed, s, cfg, 'Revisora MOCK', AT);
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.issues));
  if (!r.ok) return;
  assert.equal(r.manifest.approval.status, 'approved');
  assert.ok(verifyManifestHash(r.manifest));
  // Restricciones heredadas del rol: el logo solo traslación.
  assert.deepEqual(entityOf(r.manifest, '10:4').constraints.allowOps, ['translate']);
});

test('MOCK: cambiar la naturaleza sin statement se rechaza', async () => {
  const s = await snap(baseMasterSpec());
  const draft = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const review = fullReviewForBase(draft);
  delete review.entities[entityOf(draft, '10:13').entityId]!.statement;
  const r = applyReview(draft, review, cfg, AT);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.code === 'NATURE_CHANGE_WITHOUT_STATEMENT'));
});

test('MOCK: una revisión hecha para otro manifiesto se rechaza', async () => {
  const s = await snap(baseMasterSpec());
  const draft = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const review = { ...fullReviewForBase(draft), manifestHash: 'sha256:otro' };
  const r = applyReview(draft, review, cfg, AT);
  assert.equal(r.ok, false);
});

test('MOCK: las restricciones de entidad no pueden relajar las invariantes del logo', async () => {
  const s = await snap(baseMasterSpec());
  const draft = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const review = fullReviewForBase(draft);
  const logoId = entityOf(draft, '10:4').entityId;
  review.entities[logoId] = { ...review.entities[logoId]!, constraints: { allowOps: ['translate', 'recrop_background'] } };
  const applied = applyReview(draft, review, cfg, AT);
  assert.ok(applied.ok);
  if (!applied.ok) return;
  const r = approveManifest(applied.manifest, s, cfg, 'Revisora MOCK', AT);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.code === 'ENTITY_CONSTRAINT_LOOSENS_INVARIANT'));
});

test('MOCK: sin nombre de persona no hay aprobación; con lista de aprobadores, solo ellos', async () => {
  const { s, reviewed } = await reviewedBase();
  assert.equal(approveManifest(reviewed, s, cfg, '  ', AT).ok, false);
  const restricted = { ...cfg, approvers: ['Persona Autorizada'] };
  const r = approveManifest(reviewed, s, restricted, 'Revisora MOCK', AT);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.code === 'APPROVER_NOT_AUTHORIZED'));
});

test('MOCK [caso mínimo] fuente no disponible: bloquea la aprobación del inventario', async () => {
  // Esta maestra sintética no tiene logo: la taxonomía de la prueba lo hace opcional para aislar el motivo de bloqueo.
  const noLogoCfg = {
    ...cfg,
    taxonomy: { ...cfg.taxonomy, roles: cfg.taxonomy.roles.map((r) => (r.id === 'logo' ? { ...r, multiplicity: { min: 0, max: 1 } } : r)) },
  };
  const s = await snap(missingFontMasterSpec());
  const draft = buildDraftManifest(s, classify(s, noLogoCfg), noLogoCfg, AT);
  const review = {
    schema: 'pcb.review.v1' as const, manifestHash: draft.manifestHash, reviewer: 'Revisora MOCK',
    entities: Object.fromEntries(draft.entities.map((x) => [x.entityId, { status: 'approved' as const, role: x.nodeIds.includes('20:1') ? 'background' : 'headline' }])),
    pending: {}, compositions: {}, relations: [],
  };
  const applied = applyReview(draft, review, noLogoCfg, AT);
  assert.ok(applied.ok);
  if (!applied.ok) return;
  const r = approveManifest(applied.manifest, s, noLogoCfg, 'Revisora MOCK', AT);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.issues.map((i) => i.code), ['FONT_MISSING_BLOCKS_APPROVAL']);
});

test('MOCK [caso mínimo] cambio de la maestra tras aprobar el inventario: se detecta con diff por categoría', async () => {
  const { s, reviewed } = await reviewedBase();
  const approved = approveManifest(reviewed, s, cfg, 'Revisora MOCK', AT);
  assert.ok(approved.ok);
  if (!approved.ok) return;
  const m = approved.manifest;

  // 1) Texto modificado → contenido.
  const edited = await snap(mapSpec(baseMasterSpec(), '10:6', (n) => ({ ...n, text: { characters: 'Nueva colección de invierno' } })));
  const v1 = verifyMasterUnchanged(m, s, edited);
  assert.equal(v1.unchanged, false);
  assert.equal(v1.fingerprintsEqual.content, false);
  assert.deepEqual(v1.changes, [{ nodeId: '10:6', change: 'modified', category: 'content', fields: ['text'] }]);

  // 2) Logo movido dentro de la maestra → maquetación del grupo y de sus descendientes.
  const moved = await snap(mapSpec(baseMasterSpec(), '10:3', (n) => ({ ...n, x: 70 })));
  const v2 = verifyMasterUnchanged(m, s, moved);
  assert.equal(v2.unchanged, false);
  assert.deepEqual(v2.changes.map((c) => `${c.nodeId}:${c.category}`).sort(), ['10:3:layout', '10:4:layout', '10:5:layout']);

  // 3) Renombrado → metadatos (también invalida la aprobación).
  const renamed = await snap(mapSpec(baseMasterSpec(), '10:10', (n) => ({ ...n, name: 'Legal v2' })));
  const v3 = verifyMasterUnchanged(m, s, renamed);
  assert.equal(v3.unchanged, false);
  assert.deepEqual(v3.changes.map((c) => c.category), ['metadata']);

  // 4) Aprobar un manifiesto contra una maestra cambiada se rechaza.
  const again = approveManifest(reviewed, edited, cfg, 'Revisora MOCK', AT);
  assert.equal(again.ok, false);
  if (!again.ok) assert.ok(again.issues.some((i) => i.code === 'MASTER_CHANGED_SINCE_INVENTORY'));
});

test('MOCK: mover la maestra entera en el lienzo no es un cambio (comparación relativa al frame)', async () => {
  const { s, reviewed } = await reviewedBase();
  const approved = approveManifest(reviewed, s, cfg, 'Revisora MOCK', AT);
  assert.ok(approved.ok);
  if (!approved.ok) return;
  const shifted = await snap({ ...baseMasterSpec(), x: 5000, y: -300 });
  const v = verifyMasterUnchanged(approved.manifest, s, shifted);
  assert.equal(v.unchanged, true);
  assert.deepEqual(v.changes, []);
});

test('MOCK: un manifiesto alterado a mano se detecta por su hash', async () => {
  const { reviewed } = await reviewedBase();
  const tampered = structuredClone(reviewed);
  tampered.entities[0]!.role = 'logo';
  assert.equal(verifyManifestHash(tampered), false);
});

test('MOCK [T2]: un desplazamiento de 1e-5 px en la maestra invalida la aprobación; la tolerancia solo lo describe', async () => {
  const { s, reviewed } = await reviewedBase();
  const approved = approveManifest(reviewed, s, cfg, 'Revisora MOCK', AT);
  assert.ok(approved.ok);
  if (!approved.ok) return;
  const nudged = await snap(mapSpec(baseMasterSpec(), '10:10', (n) => ({ ...n, x: (n.x ?? 0) + 1e-5 })));
  const v = verifyMasterUnchanged(approved.manifest, s, nudged);
  assert.equal(v.unchanged, false, 'la huella exacta detecta el cambio');
  const legal = v.changes.find((c) => c.nodeId === '10:10' && c.category === 'layout');
  assert.ok(legal);
  assert.ok(legal.maxNumericDelta !== null && legal.maxNumericDelta !== undefined && legal.maxNumericDelta < 1e-4, 'magnitud informativa');
});

test('MOCK: huellas de versiones distintas no se comparan', async () => {
  const { s, reviewed } = await reviewedBase();
  const approved = approveManifest(reviewed, s, cfg, 'Revisora MOCK', AT);
  assert.ok(approved.ok);
  if (!approved.ok) return;
  const old = structuredClone(approved.manifest);
  (old.master.fingerprints as { version: string }).version = 'pcb.fingerprint.v1';
  assert.throws(() => verifyMasterUnchanged(old, s, s), /no son comparables/);
});
