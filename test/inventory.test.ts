// MOCK: clasificación e inventario sobre maestras sintéticas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/inventory/classify.ts';
import { buildDraftManifest, buildReviewTemplate } from '../src/inventory/manifest.ts';
import { renderManifestReview } from '../src/report/review-md.ts';
import { parse } from '../src/contracts/schema.ts';
import { ManifestSchema } from '../src/contracts/manifest.ts';
import { baseMasterSpec, INJECTION_LAYER_NAME, missingFontMasterSpec, mapSpec, readErrorMasterSpec } from '../src/figma/mock/fixtures.ts';
import { entityOf, exampleConfig, snap } from './helpers.ts';

const cfg = exampleConfig();
const AT = '2026-09-29T00:00:00.000Z';
/** U+202E RIGHT-TO-LEFT OVERRIDE, construido por código para no dejar caracteres invisibles en el fuente. */
const RLO = String.fromCharCode(0x202e);

async function draft(spec = baseMasterSpec()) {
  const s = await snap(spec);
  return { s, m: buildDraftManifest(s, classify(s, cfg), cfg, AT) };
}

test('MOCK: el manifiesto cumple su esquema y cada nodo tiene exactamente una disposición', async () => {
  const { s, m } = await draft();
  assert.ok(parse(ManifestSchema, m).ok);
  assert.equal(m.dispositions.length, s.nodes.length);
  assert.equal(new Set(m.dispositions.map((d) => d.nodeId)).size, s.nodes.length);
  assert.equal(m.source, 'MOCK');
  assert.ok(m.entities.every((e) => e.review.status === 'needs_review' && e.role === null));
});

test('MOCK [caso mínimo] imagen con texto incrustado: sin OCR queda indeterminada y requiere revisión', async () => {
  const { m } = await draft();
  const banner = entityOf(m, '10:13');
  assert.equal(banner.contentNature, 'image_text_undetermined');
  assert.ok(banner.review.reasons.includes('TEXT_DETECTION_NOT_RUN'));
  assert.equal(m.detectors.ocr, 'not_run');
  // Ninguna imagen se declara "sin texto detectado" sin detector.
  assert.ok(!m.entities.some((e) => e.contentNature === 'image_no_text_detected' || e.contentNature === 'image_embedded_text'));
});

test('MOCK [caso mínimo] imagen con texto editable superpuesto: se propone composición', async () => {
  const { m } = await draft();
  const product = entityOf(m, '10:11');
  const price = entityOf(m, '10:12');
  const comp = m.compositions.find((c) => c.entityIds[0] === product.entityId);
  assert.ok(comp, 'composición propuesta');
  assert.equal(comp.nature, 'image_with_editable_text_overlay');
  assert.equal(comp.status, 'proposed');
  assert.ok(comp.entityIds.includes(price.entityId));
  assert.ok(price.review.reasons.includes('EDITABLE_TEXT_OVERLAY_ON_IMAGE'));
  // El banner no tiene textos encima: sin composición.
  assert.ok(!m.compositions.some((c) => c.entityIds[0] === entityOf(m, '10:13').entityId));
});

test('MOCK [caso mínimo] fuente no disponible: se marca FONT_MISSING y se registra en el entorno', async () => {
  const { s, m } = await draft(missingFontMasterSpec());
  assert.deepEqual(s.environment.nodesWithMissingFont, ['20:2']);
  assert.ok(entityOf(m, '20:2').review.reasons.includes('FONT_MISSING'));
});

test('MOCK: texto oculto queda pendiente (no se decide automáticamente si es contenido)', async () => {
  const { m } = await draft();
  const d = m.dispositions.find((x) => x.nodeId === '10:14');
  assert.equal(d?.kind, 'pending');
  if (d?.kind === 'pending') assert.deepEqual(d.reasons, ['HIDDEN_OR_IN_HIDDEN_ANCESTOR']);
});

test('MOCK: nodos estructurales justificados (raíz con relleno es contenido; grupos sin pintura son contenedores)', async () => {
  const { m } = await draft();
  const disp = (id: string) => m.dispositions.find((d) => d.nodeId === id)!;
  assert.equal(disp('10:1').kind, 'content'); // la raíz pinta un fondo blanco
  const logoGroup = disp('10:3');
  assert.equal(logoGroup.kind, 'structural');
  if (logoGroup.kind === 'structural') assert.equal(logoGroup.justification, 'container');
  assert.equal(disp('10:8').kind, 'content'); // CTA: frame con relleno propio
  assert.ok(entityOf(m, '10:8').review.reasons.includes('MIXED_CONTAINER_PAINT'));
});

test('MOCK: una entidad puede tener varios nodos (logo = 2 vectores) y el claim es posible texto vectorizado', async () => {
  const { m } = await draft();
  const logo = entityOf(m, '10:4');
  assert.deepEqual([...logo.nodeIds].sort(), ['10:4', '10:5']);
  assert.equal(logo.contentNature, 'vector_undetermined');
  assert.ok(!logo.review.reasons.includes('POSSIBLE_VECTORIZED_TEXT'));
  const claim = entityOf(m, '10:16');
  assert.equal(claim.nodeIds.length, 5);
  assert.ok(claim.review.reasons.includes('POSSIBLE_VECTORIZED_TEXT'));
  assert.equal(claim.contentNature, 'vector_undetermined'); // heurística: nunca concluye por sí sola
});

test('MOCK: el nombre de capa solo genera pistas de rol, nunca la naturaleza del contenido', async () => {
  // Una imagen llamada "Titular texto" sigue siendo una imagen.
  const spec = mapSpec(baseMasterSpec(), '10:11', (n) => ({ ...n, name: 'Titular texto headline' }));
  const { m } = await draft(spec);
  const e = entityOf(m, '10:11');
  assert.equal(e.contentNature, 'image_text_undetermined');
  assert.equal(e.role, null);
  assert.ok(e.roleHints.some((h) => h.roleId === 'headline' && h.evidence.trust === 'low'));
  // El grupo "Logo" aporta la pista al cluster de vectores.
  assert.ok(entityOf(m, '10:4').roleHints.some((h) => h.roleId === 'logo'));
});

test('MOCK: errores de lectura dejan el nodo pendiente', async () => {
  const s = await snap(readErrorMasterSpec());
  const m = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const pend = m.dispositions.filter((d) => d.kind === 'pending').map((d) => d.nodeId).sort();
  assert.deepEqual(pend, ['30:2', '30:3']);
});

test('MOCK [seguridad]: un nombre de capa que imita una instrucción se muestra escapado y no altera nada', async () => {
  const { s, m } = await draft();
  const body = entityOf(m, '10:7');
  assert.equal(body.review.status, 'needs_review');
  assert.equal(m.approval.status, 'draft');
  const md = renderManifestReview(m, s);
  assert.ok(md.includes(`\` ${INJECTION_LAYER_NAME} \``), 'aparece solo como literal de código');
  assert.ok(md.includes('MOCK — datos sintéticos'));
});

test('MOCK [seguridad]: caracteres de control/bidi en nombres se escapan en la vista', async () => {
  const spec = mapSpec(baseMasterSpec(), '10:6', (n) => ({ ...n, name: `Titular${RLO}\`oculto\`\n# Encabezado` }));
  const { s, m } = await draft(spec);
  const md = renderManifestReview(m, s);
  assert.ok(!md.includes(RLO));
  assert.ok(md.includes('\\u202e'));
  assert.ok(!md.includes('\n# Encabezado'));
});

test('MOCK: la plantilla de revisión no contiene decisiones prerrellenadas', async () => {
  const { m } = await draft();
  const t = buildReviewTemplate(m) as { entities: Record<string, { status: unknown }>; reviewer: string };
  assert.equal(t.reviewer, '');
  assert.ok(Object.values(t.entities).every((e) => e.status === null));
});
