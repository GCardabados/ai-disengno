// MOCK: skill creative-content-variants — descubrimiento, confirmación conversacional, plan, script y validación.
// Todo procede de maestras sintéticas (src/figma/mock/fixtures.ts); nada es una lectura real de Figma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverVariantFields, renderDiscovery } from '../src/variants/discover.ts';
import { checkVariantJob, confirm, expandTemplate, renderJobSummary, sameExceptLineBreaks } from '../src/variants/job.ts';
import { buildVariantPlan, focalCropTransform, type VariantPlan } from '../src/variants/plan.ts';
import { checkVariant } from '../src/variants/check.ts';
import { buildVariantAssetsScript, buildVariantScript, staticVariantViolations } from '../src/figma/variant-script.ts';
import { renderVariantBatchReport } from '../src/report/variants-md.ts';
import { mapSpec, universityMasterSpec, MOCK_FILE_KEY } from '../src/figma/mock/fixtures.ts';
import type { MockNodeSpec } from '../src/figma/mock/fake-figma.ts';
import type { MasterSnapshot } from '../src/contracts/snapshot.ts';
import { VariantJobSchema, type VariantAssetsRead, type VariantJob, type VariantResult } from '../src/contracts/variants.ts';
import { parse } from '../src/contracts/schema.ts';
import { exampleConfig, snap } from './helpers.ts';

const cfg = exampleConfig();
const USER = { by: 'user' as const, at: '2026-10-14T10:00:00.000Z', note: 'MOCK: «sí, adelante»' };
const MASTER = universityMasterSpec();

/** Encargo tal como lo construiría la skill tras la conversación (MOCK). Sin confirmar. */
function baseJob(s: MasterSnapshot, over: Partial<VariantJob> = {}): VariantJob {
  const v = (variantId: string, grado: string, ciudad: string, slug: string, asset: string) => ({
    variantId, label: `${grado} · ${ciudad}`, params: { grado, ciudad }, notes: null,
    values: {
      titular: { kind: 'text' as const, text: null, parts: ['Estudia ', '{{grado}} en {{ciudad}}'], display: null, source: 'template' as const },
      url: { kind: 'text' as const, text: `universidad.example/${slug}`, parts: null, display: null, source: 'user_provided' as const },
      foto: { kind: 'image' as const, asset: { kind: 'figma_node' as const, nodeId: asset, label: `foto ${slug}` }, source: 'user_provided' as const },
    },
  });
  return {
    schema: 'pcb.variant-job.v1',
    request: 'MOCK: variantes por grado y ciudad',
    master: { fileKey: s.fileKey, nodeId: s.rootNodeId, name: 'UNI_Grados_1080x1080', width: 1080, height: 1080, fingerprint: s.fingerprints.master, params: { grado: 'Derecho', ciudad: 'Madrid' } },
    params: [{ paramId: 'grado', label: 'Grado' }, { paramId: 'ciudad', label: 'Ciudad' }],
    fields: [
      { fieldId: 'titular', label: 'Titular', kind: 'text', nodeId: '70:7', role: 'headline', isLegal: false, masterValue: 'Estudia Derecho en Madrid', styleMapping: 'segments', textPolicy: { mode: 'strict' }, imagePolicy: null, paintIndex: null, maskDecision: null },
      { fieldId: 'url', label: 'URL', kind: 'text', nodeId: '70:11', role: 'url', isLegal: false, masterValue: 'universidad.example/derecho', styleMapping: 'whole', textPolicy: { mode: 'strict' }, imagePolicy: null, paintIndex: null, maskDecision: null },
      { fieldId: 'foto', label: 'Fotografía', kind: 'image', nodeId: '70:2', role: 'background_image', isLegal: false, masterValue: 'img_derecho_madrid', styleMapping: null, textPolicy: null, imagePolicy: { mode: 'fill' }, paintIndex: 0, maskDecision: null },
    ],
    kept: [
      { label: 'Botón «Infórmate»', nodeIds: ['70:10'], why: 'confirmado por la persona' },
      { label: 'Legal', nodeIds: ['70:12'], why: 'la persona confirma que es común a todos los campus' },
    ],
    protected: { logoNodeIds: ['70:4'], safeArea: null, safeAreaNote: null },
    variants: [v('medicina-sevilla', 'Medicina', 'Sevilla', 'medicina', '80:2'), v('ade-valencia', 'ADE', 'Valencia', 'ade', '80:3'), v('derecho-bilbao', 'Derecho', 'Bilbao', 'derecho-bilbao', '80:2')],
    output: { sectionName: 'PCB · Variantes', cloneNamePattern: '{master} · VAR {variant}' },
    confirmations: { fields: null, content: null },
    ...over,
  };
}
const confirmed = (j: VariantJob): VariantJob => confirm(confirm(j, 'fields', USER), 'content', USER);

const ASSETS: VariantAssetsRead = {
  schema: 'pcb.variant-assets.v1',
  nodes: [
    { nodeId: '70:2', found: true, type: 'RECTANGLE', width: 1080, height: 1080, images: [{ paintIndex: 0, hash: 'img_derecho_madrid', visible: true, width: 2160, height: 2160, error: null }] },
    { nodeId: '80:2', found: true, type: 'RECTANGLE', width: 400, height: 400, images: [{ paintIndex: 0, hash: 'img_medicina_sevilla', visible: true, width: 2000, height: 2000, error: null }] },
    { nodeId: '80:3', found: true, type: 'RECTANGLE', width: 400, height: 400, images: [{ paintIndex: 0, hash: 'img_ade_valencia', visible: true, width: 3000, height: 2000, error: null }] },
  ],
  hashes: [],
};

/** Relectura MOCK de un clon: misma maestra con otros ids, otro nombre y las modificaciones indicadas. */
function cloneSpec(name: string, edits: Record<string, (n: MockNodeSpec) => MockNodeSpec>): MockNodeSpec {
  let s = structuredClone(MASTER);
  for (const [id, f] of Object.entries(edits)) s = mapSpec(s, id, f);
  const re = (n: MockNodeSpec): MockNodeSpec => ({ ...n, id: n.id.replace(/^70:/, '71:'), children: n.children?.map(re) });
  return { ...re(s), name, x: 1500 };
}
const sevillaText = (n: MockNodeSpec): MockNodeSpec => ({ ...n, text: { ...n.text!, characters: 'Estudia Medicina en Sevilla', segments: [{ end: 8, fontStyle: 'Regular' }, { end: 27, fontStyle: 'Bold' }] } });
const sevillaUrl = (n: MockNodeSpec): MockNodeSpec => ({ ...n, text: { ...n.text!, characters: 'universidad.example/medicina' } });
const sevillaFoto = (n: MockNodeSpec): MockNodeSpec => ({ ...n, fills: [{ type: 'IMAGE', imageHash: 'img_medicina_sevilla', scaleMode: 'FILL' }] });
const goodSevilla = { '70:7': sevillaText, '70:11': sevillaUrl, '70:2': sevillaFoto };

async function readyPlan(j?: VariantJob): Promise<{ s: MasterSnapshot; plan: VariantPlan }> {
  const s = await snap(MASTER);
  return { s, plan: buildVariantPlan(j ?? confirmed(baseJob(s)), s, ASSETS).plan };
}
const sevillaEntry = (p: VariantPlan) => p.variants.find((v) => v.variantId === 'medicina-sevilla')!;
const codes = (r: ReturnType<typeof checkVariant>) => r.results.flatMap((x) => x.findings.map((f) => f.code));
const statusOf = (r: ReturnType<typeof checkVariant>, id: string) => r.results.find((x) => x.validatorId === id)?.status;

// ---------- Descubrimiento ----------

test('MOCK [descubrimiento]: propone variar, mantener y preguntar a partir de la pieza y la intención, sin exigir IDs', async () => {
  const s = await snap(MASTER);
  const d = discoverVariantFields(s, cfg, { terms: { grado: 'Derecho', ciudad: 'Madrid' } });
  const by = (id: string) => d.candidates.find((c) => c.nodeIds.includes(id))!;
  assert.equal(d.status, 'agent_proposal');
  assert.deepEqual([by('70:7').roleGuess, by('70:7').proposal, by('70:7').mentions], ['headline', 'vary', { grado: 'Derecho', ciudad: 'Madrid' }]);
  assert.ok(by('70:7').risks.some((r) => /estilos mixtos/.test(r)), 'titular con dos tramos de estilo');
  assert.deepEqual([by('70:10').roleGuess, by('70:10').proposal], ['cta_label', 'keep']);
  assert.ok(by('70:10').risks.some((r) => /auto layout/.test(r)));
  assert.deepEqual([by('70:11').roleGuess, by('70:11').proposal], ['url', 'ask'], 'una URL que menciona el grado se pregunta: el dato exacto no se deduce');
  assert.deepEqual([by('70:12').roleGuess, by('70:12').proposal], ['legal', 'ask'], 'legal que menciona la ciudad: ambiguo');
  assert.deepEqual([by('70:2').roleGuess, by('70:2').proposal], ['background_image', 'vary']);
  assert.equal(by('70:4').kind, 'logo');
  assert.equal(by('70:14').kind, 'vectorized_text');
  assert.equal(by('70:3').kind, 'overlay');
  // La síntesis para la persona usa contenido reconocible; los ids solo aparecen en el anexo técnico.
  const md = renderDiscovery(d);
  const [body] = md.split('<details>');
  assert.ok(!/\b70:\d+/.test(body!), 'sin IDs técnicos en la síntesis');
  assert.match(body!, /«Estudia Derecho en Madrid»/);
  assert.match(body!, /combinaciones concretas/);
});

test('MOCK [descubrimiento]: los nombres de capa no deciden la función (capas genéricas «Text 1»…)', async () => {
  const s = await snap(mapSpec(MASTER, '70:8', (n) => ({ ...n, name: 'Titular' })));
  const d = discoverVariantFields(s, cfg);
  assert.equal(d.candidates.find((c) => c.nodeIds.includes('70:8'))!.roleGuess, 'body', 'un nombre «Titular» no convierte el cuerpo en titular');
});

// ---------- Confirmación conversacional ----------

test('MOCK [confirmación]: sin confirmar campos ni contenido no se genera nada', async () => {
  const s = await snap(MASTER);
  const chk = checkVariantJob(baseJob(s), s);
  assert.equal(chk.ready, false);
  assert.deepEqual(chk.readyVariantIds, []);
  assert.ok(chk.issues.some((i) => i.code === 'FIELDS_NOT_CONFIRMED' && i.severity === 'pending'));
  assert.equal(chk.issues.filter((i) => i.code === 'CONTENT_NOT_CONFIRMED').length, 3);
  const { plan } = buildVariantPlan(baseJob(s), s, ASSETS);
  assert.ok(plan.variants.every((v) => v.status === 'blocked' && v.ops.length === 0));
  assert.throws(() => buildVariantScript(plan), /No hay variantes listas/);
  // Confirmar los campos NO confirma el contenido (son dos autorizaciones distintas).
  const onlyFields = confirm(baseJob(s), 'fields', USER);
  assert.equal(checkVariantJob(onlyFields, s).ready, false);
  assert.equal(checkVariantJob(confirmed(baseJob(s)), s).ready, true);
});

test('MOCK [confirmación]: solo la persona confirma; un cambio posterior exige reconfirmar SOLO esa variante', async () => {
  const s = await snap(MASTER);
  assert.throws(() => confirm(baseJob(s), 'fields', { by: 'agent' as never, at: '', note: null }), /Solo la persona/);
  const j = confirmed(baseJob(s));
  j.variants[1]!.values.url = { kind: 'text', text: 'universidad.example/ade-nuevo', parts: null, display: null, source: 'user_provided' };
  const chk = checkVariantJob(j, s);
  assert.ok(chk.issues.some((i) => i.code === 'CONTENT_CHANGED_AFTER_CONFIRMATION' && i.variantId === 'ade-valencia'));
  assert.deepEqual(chk.readyVariantIds, ['medicina-sevilla', 'derecho-bilbao'], 'las demás siguen listas');
  const j2 = confirmed(baseJob(s));
  j2.fields[0]!.textPolicy = { mode: 'fit_text', minScale: 0.9, authorization: null };
  assert.ok(checkVariantJob(j2, s).issues.some((i) => i.code === 'FIELDS_CHANGED_AFTER_CONFIRMATION'));
});

test('MOCK [ambigüedad]: un texto fijo que menciona la ciudad de la maestra se pregunta; si la persona confirma mantenerlo, solo se avisa', async () => {
  const s = await snap(MASTER);
  const notKept = confirmed(baseJob(s, { kept: [] }));
  const chk = checkVariantJob(notKept, s);
  const legal = chk.issues.filter((i) => i.code === 'FIXED_TEXT_MENTIONS_MASTER_VALUE');
  assert.equal(legal.length, 3);
  assert.ok(legal.every((i) => i.severity === 'pending' && /Madrid/.test(i.message)));
  assert.equal(chk.ready, false);
  const kept = checkVariantJob(confirmed(baseJob(s)), s);
  assert.ok(kept.issues.filter((i) => i.code === 'FIXED_TEXT_MENTIONS_MASTER_VALUE').every((i) => i.severity === 'warning'));
  assert.equal(kept.ready, true);
});

test('MOCK [corrección]: la persona corrige un campo inferido (la URL no varía, el cuerpo sí)', async () => {
  const s = await snap(MASTER);
  const j = baseJob(s);
  j.fields = j.fields.filter((f) => f.fieldId !== 'url');
  j.fields.push({ fieldId: 'cuerpo', label: 'Cuerpo', kind: 'text', nodeId: '70:8', role: 'body', isLegal: false, masterValue: 'Grado oficial con prácticas desde primer curso.', styleMapping: 'whole', textPolicy: { mode: 'strict' }, imagePolicy: null, paintIndex: null, maskDecision: null });
  for (const v of j.variants) v.values.cuerpo = { kind: 'text', text: 'Grado oficial con prácticas en hospitales.', parts: null, display: null, source: 'user_provided' };
  // Quedó contenido para la URL, que ya no es un campo: no se aplica en silencio.
  const chk = checkVariantJob(confirmed(j), s);
  assert.ok(chk.issues.some((i) => i.code === 'VALUE_FOR_UNBOUND_FIELD' && i.severity === 'blocking'));
  for (const v of j.variants) delete v.values.url;
  // La URL fija menciona «derecho»: hasta que la persona confirme que se mantiene, se pregunta.
  assert.ok(checkVariantJob(confirmed(j), s).issues.some((i) => i.code === 'FIXED_TEXT_MENTIONS_MASTER_VALUE' && i.severity === 'pending'));
  j.kept.push({ label: 'URL', nodeIds: ['70:11'], why: 'la persona confirma que la URL es común' });
  assert.equal(checkVariantJob(confirmed(j), s).ready, true);
  // Si aun así la URL cambiara en el clon, la validación lo detecta como cambio no autorizado.
  const { plan } = buildVariantPlan(confirmed(j), s, ASSETS);
  const clone = await snap(cloneSpec('UNI · VAR medicina-sevilla', { '70:7': sevillaText, '70:2': sevillaFoto, '70:11': sevillaUrl, '70:8': (n) => ({ ...n, text: { ...n.text!, characters: 'Grado oficial con prácticas en hospitales.' } }) }));
  const rep = checkVariant({ master: s, clone, plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: true, visual: null });
  assert.equal(statusOf(rep, 'authorized_changes_only'), 'fail');
  assert.ok(codes(rep).includes('UNAUTHORIZED_CHANGE'));
});

// ---------- Contenido: plantillas, datos comerciales, mezcla ----------

test('MOCK [plantillas]: «Estudia {{grado}} en {{ciudad}}» se expande por variante; un dato que falta bloquea', async () => {
  assert.deepEqual(expandTemplate('Estudia {{grado}} en {{ciudad}}', { grado: 'Enfermería', ciudad: 'A Coruña' }), { text: 'Estudia Enfermería en A Coruña', missing: [] });
  const s = await snap(MASTER);
  const j = baseJob(s);
  j.variants[0]!.values.titular = { kind: 'text', text: null, parts: ['Estudia ', '{{grado}} en {{campus}}'], display: null, source: 'template' };
  const chk = checkVariantJob(confirmed(j), s);
  assert.ok(chk.issues.some((i) => i.code === 'TEMPLATE_UNRESOLVED' && i.variantId === 'medicina-sevilla'));
  const { plan } = buildVariantPlan(confirmed(baseJob(s)), s, ASSETS);
  assert.deepEqual(sevillaEntry(plan).ops.find((o) => o.kind === 'text' && o.fieldId === 'titular'), {
    kind: 'text', fieldId: 'titular', nodeId: '70:7', masterCharacters: 'Estudia Derecho en Madrid', segments: [{ start: 0, end: 8 }, { start: 8, end: 25 }],
    parts: ['Estudia ', 'Medicina en Sevilla'], characters: 'Estudia Medicina en Sevilla', policy: { mode: 'strict' }, isLegal: false,
  });
});

test('MOCK [contenido]: un borrador del agente con precio, fecha o URL sin fuente de la persona se bloquea', async () => {
  const s = await snap(MASTER);
  const j = baseJob(s);
  j.variants[0]!.values.url = { kind: 'text', text: 'Matrícula desde 450 €/mes', parts: null, display: null, source: 'agent_draft' };
  const chk = checkVariantJob(confirmed(j), s);
  assert.ok(chk.issues.some((i) => i.code === 'COMMERCIAL_CLAIM_UNSOURCED' && i.severity === 'blocking'));
  j.variants[0]!.values.url = { kind: 'text', text: 'Matrícula desde 450 €/mes', parts: null, display: null, source: 'user_provided' };
  assert.ok(!checkVariantJob(confirmed(j), s).issues.some((i) => i.code === 'COMMERCIAL_CLAIM_UNSOURCED'), 'si lo aporta la persona, se usa tal cual');
});

test('MOCK [mezcla]: el contenido de una variante no puede llevar datos de otra (antes de producir y en la relectura)', async () => {
  const s = await snap(MASTER);
  const j = baseJob(s);
  j.variants[0]!.values.titular = { kind: 'text', text: null, parts: ['Estudia ', 'Medicina en Valencia'], display: null, source: 'user_provided' };
  const chk = checkVariantJob(confirmed(j), s);
  assert.ok(chk.issues.some((i) => i.code === 'VARIANT_DATA_MIXED' && i.variantId === 'medicina-sevilla' && /Valencia/.test(i.message)));
  assert.ok(!chk.readyVariantIds.includes('medicina-sevilla'));
  assert.ok(chk.readyVariantIds.includes('ade-valencia'), 'las demás no se bloquean');
  // Relectura: el clon de Sevilla muestra «Valencia» en el titular → fallo; el legal fijo con «Madrid» → aviso.
  const { plan } = await readyPlan();
  const bad = await snap(cloneSpec('UNI · VAR medicina-sevilla', { ...goodSevilla, '70:7': (n) => ({ ...n, text: { ...n.text!, characters: 'Estudia Medicina en Valencia', segments: [{ end: 8, fontStyle: 'Regular' }, { end: 28, fontStyle: 'Bold' }] } }) }));
  const rep = checkVariant({ master: s, clone: bad, plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: true, visual: null });
  assert.ok(codes(rep).includes('VARIANT_DATA_MIXED'));
  assert.ok(codes(rep).includes('TEXT_NOT_CONFIRMED_COPY'));
  assert.ok(codes(rep).includes('FOREIGN_VALUE_IN_FIXED_TEXT'));
});

test('MOCK [matriz]: una fila = una variante; nunca se genera el producto cartesiano', async () => {
  const { plan } = await readyPlan();
  assert.deepEqual(plan.variants.map((v) => v.variantId), ['medicina-sevilla', 'ade-valencia', 'derecho-bilbao']);
  assert.equal(new Set(plan.variants.map((v) => v.cloneName)).size, 3);
  const s = await snap(MASTER);
  const dup = baseJob(s);
  dup.variants.push({ ...structuredClone(dup.variants[0]!), variantId: 'medicina-sevilla-2' });
  assert.ok(checkVariantJob(confirmed(dup), s).issues.some((i) => i.code === 'VARIANT_DUPLICATE'));
});

// ---------- Texto ----------

test('MOCK [texto]: estilos mixtos — con un único copy es ambiguo (se propone repartirlo por tramos); las partes deben cuadrar', async () => {
  const s = await snap(MASTER);
  const j = baseJob(s);
  j.fields[0]!.styleMapping = 'whole';
  for (const v of j.variants) v.values.titular = { kind: 'text', text: `Estudia ${v.params.grado} en ${v.params.ciudad}`, parts: null, display: null, source: 'user_provided' };
  const amb = checkVariantJob(confirmed(j), s).issues.find((i) => i.code === 'SEGMENTS_AMBIGUOUS')!;
  assert.equal(amb.severity, 'blocking');
  assert.match(amb.message, /2 partes, una por tramo/);
  const j2 = baseJob(s);
  j2.variants[0]!.values.titular = { kind: 'text', text: null, parts: ['Estudia ', 'Medicina', ' en Sevilla'], display: null, source: 'user_provided' };
  j2.variants[1]!.values.titular = { kind: 'text', text: null, parts: ['', 'ADE en Valencia'], display: null, source: 'user_provided' };
  const issues = checkVariantJob(confirmed(j2), s).issues;
  assert.ok(issues.some((i) => i.code === 'PARTS_MISMATCH' && i.variantId === 'medicina-sevilla'));
  assert.ok(issues.some((i) => i.code === 'PART_EMPTY' && i.variantId === 'ade-valencia'));
});

test('MOCK [texto]: copy confirmado con tildes y Unicode intacto; saltos de línea ≠ redacción', async () => {
  assert.equal(sameExceptLineBreaks('Estudia Enfermería en A Coruña', 'Estudia Enfermería\nen A Coruña'), true);
  assert.equal(sameExceptLineBreaks('Estudia Enfermería en A Coruña', 'Estudia Enfermería\nen Coruña'), false);
  const s = await snap(MASTER);
  const j = baseJob(s);
  j.fields[1]!.styleMapping = 'whole';
  j.variants[0]!.values.url = { kind: 'text', text: 'universidad.example/medicina-ñ', parts: null, display: 'universidad.example/\nmedicina-ñ', source: 'user_provided' };
  assert.ok(checkVariantJob(confirmed(j), s).issues.some((i) => i.code === 'DISPLAY_NOT_LINEBREAK_ONLY' || i.code === 'DISPLAY_REQUIRES_REFLOW'));
  const j2 = baseJob(s);
  j2.fields[1]!.textPolicy = { mode: 'reflow', maxHeightPx: null };
  j2.variants[0]!.values.url = { kind: 'text', text: 'Estudia en Sevilla ya', parts: null, display: 'Estudia en\nSevilla ya', source: 'user_provided' };
  const r = buildVariantPlan(confirmed(j2), s, ASSETS).plan;
  assert.equal(sevillaEntry(r).ops.find((o) => o.fieldId === 'url' && o.kind === 'text')!.kind === 'text' && (sevillaEntry(r).ops.find((o) => o.fieldId === 'url') as { characters: string }).characters, 'Estudia en\nSevilla ya');
  j2.variants[0]!.values.url = { kind: 'text', text: 'Estudia en Sevilla ya', parts: null, display: 'Estudia\nSevilla ya', source: 'user_provided' };
  assert.ok(checkVariantJob(confirmed(j2), s).issues.some((i) => i.code === 'DISPLAY_NOT_LINEBREAK_ONLY'));
  const ctrl = baseJob(s);
  ctrl.variants[0]!.values.url = { kind: 'text', text: 'universidad.example/‮medicina', parts: null, display: null, source: 'user_provided' };
  assert.ok(checkVariantJob(confirmed(ctrl), s).issues.some((i) => i.code === 'TEXT_CONTROL_CHARS'));
});

test('MOCK [texto]: política obligatoria, sin mínimos inventados; un legal no se reduce sin autorización', async () => {
  const s = await snap(MASTER);
  const j = baseJob(s);
  j.fields[0]!.textPolicy = null;
  assert.ok(checkVariantJob(confirmed(j), s).issues.some((i) => i.code === 'TEXT_POLICY_MISSING' && i.severity === 'pending'));
  assert.ok(!parse(VariantJobSchema, { ...baseJob(s), fields: [{ ...baseJob(s).fields[0]!, textPolicy: { mode: 'fit_text', authorization: null } }] }).ok, 'fit_text exige un mínimo explícito');
  const legal = baseJob(s);
  legal.fields.push({ fieldId: 'legal', label: 'Legal', kind: 'text', nodeId: '70:12', role: 'legal', isLegal: true, masterValue: 'Plazas limitadas en el campus de Madrid. Consulta condiciones.', styleMapping: 'whole', textPolicy: { mode: 'fit_text', minScale: 0.8, authorization: null }, imagePolicy: null, paintIndex: null, maskDecision: null });
  legal.kept = legal.kept.filter((k) => !k.nodeIds.includes('70:12'));
  for (const v of legal.variants) v.values.legal = { kind: 'text', text: `Plazas limitadas en el campus de ${v.params.ciudad}. Consulta condiciones.`, parts: null, display: null, source: 'user_provided' };
  assert.ok(checkVariantJob(confirmed(legal), s).issues.some((i) => i.code === 'LEGAL_FIT_NOT_AUTHORIZED' && i.severity === 'blocking'));
});

test('MOCK [texto]: copy largo — desbordamiento, reducción por debajo del mínimo y elipsis se detectan en la relectura', async () => {
  const { s, plan } = await readyPlan();
  const long = await snap(cloneSpec('UNI · VAR medicina-sevilla', { ...goodSevilla, '70:7': (n) => ({ ...sevillaText(n), renderBounds: { x: 1500 + 60, y: 620, width: 960, height: 260 } }) }));
  const rep = checkVariant({ master: s, clone: long, plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: true, visual: null });
  assert.equal(statusOf(rep, 'text_fit'), 'fail');
  assert.ok(codes(rep).includes('TEXT_OVERFLOW'));
  const small = await snap(cloneSpec('UNI · VAR medicina-sevilla', { ...goodSevilla, '70:7': (n) => ({ ...n, text: { ...n.text!, characters: 'Estudia Medicina en Sevilla', fontSize: 50, segments: [{ end: 8, fontStyle: 'Regular' }, { end: 27, fontStyle: 'Bold' }] } }) }));
  const rep2 = checkVariant({ master: s, clone: small, plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: true, visual: null });
  assert.ok(codes(rep2).includes('FONT_SIZE_CHANGED'), 'en strict el cuerpo no cambia');
});

test('MOCK [fuentes]: una fuente ausente bloquea el campo y el script se detiene ANTES de clonar, sin sustituirla', async () => {
  const s = await snap(mapSpec(MASTER, '70:7', (n) => ({ ...n, text: { ...n.text!, hasMissingFont: true, fontFamily: 'Marca Serif' } })));
  const chk = checkVariantJob(confirmed(baseJob(s)), s);
  assert.ok(chk.issues.some((i) => i.code === 'FONT_UNAVAILABLE' && i.severity === 'blocking'));
  const { plan } = await readyPlan();
  const code = buildVariantScript(plan);
  assert.ok(code.indexOf("throw new Error('PCB_FONT_UNAVAILABLE '") < code.indexOf('master.clone()'));
  assert.ok(!/fontName\s*=(?!=)/.test(code), 'nunca asigna una fuente');
});

// ---------- Imágenes ----------

test('MOCK [imágenes]: sin comprobar activos no se produce; activo ausente o de otra proporción bloquea SOLO esa variante', async () => {
  const s = await snap(MASTER);
  const noAssets = buildVariantPlan(confirmed(baseJob(s)), s, null).plan;
  assert.ok(noAssets.variants.every((v) => v.status === 'blocked' && v.blockers.some((b) => b.startsWith('ASSETS_NOT_VERIFIED'))));
  const missing: VariantAssetsRead = { ...ASSETS, nodes: ASSETS.nodes.filter((n) => n.nodeId !== '80:3').concat([{ nodeId: '80:3', found: false, type: null, width: null, height: null, images: [] }]) };
  const p = buildVariantPlan(confirmed(baseJob(s)), s, missing).plan;
  assert.deepEqual(p.variants.map((v) => v.status), ['ready', 'blocked', 'ready']);
  assert.ok(p.variants[1]!.blockers.some((b) => b.startsWith('ASSET_UNAVAILABLE')));
  const keep = baseJob(s);
  keep.fields[2]!.imagePolicy = { mode: 'keep_crop' };
  const p2 = buildVariantPlan(confirmed(keep), s, ASSETS).plan;
  assert.equal(p2.variants[0]!.status, 'ready', 'misma proporción (1:1): se puede mantener el recorte');
  assert.ok(p2.variants[1]!.blockers.some((b) => b.startsWith('ASSET_ASPECT_MISMATCH') && /punto focal/.test(b)), '3:2 en un hueco 1:1: no se mantiene el recorte a ciegas');
  assert.ok(p2.variants[0]!.warnings.some((w) => w.startsWith('SAME_ASSET_IN_VARIANTS')), 'la misma foto en dos variantes se avisa');
  const lowRes: VariantAssetsRead = { ...ASSETS, nodes: ASSETS.nodes.map((n) => (n.nodeId === '80:2' ? { ...n, images: [{ ...n.images[0]!, width: 600, height: 600 }] } : n)) };
  assert.ok(buildVariantPlan(confirmed(baseJob(s)), s, lowRes).plan.variants[0]!.warnings.some((w) => w.startsWith('ASSET_LOW_RESOLUTION')));
});

test('MOCK [imágenes]: punto focal sin deformar y máscara de silueta que exige decisión', async () => {
  const t = focalCropTransform({ width: 1080, height: 1080 }, { width: 3000, height: 2000 }, 0.8, 0.5);
  assert.deepEqual(t.map((r) => r.map((x) => Math.round(x * 1000) / 1000)), [[0.667, 0, 0.333], [0, 1, 0]], 'recorte cuadrado de una foto 3:2 pegado al borde derecho');
  const masked: MockNodeSpec = { ...MASTER, children: [{ id: '70:90', type: 'ELLIPSE', name: 'Ellipse', isMask: true, x: 0, y: 0, width: 1080, height: 1080, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] }, ...MASTER.children!] };
  const s = await snap(masked);
  const j = confirmed(baseJob(s));
  assert.ok(checkVariantJob(j, s).issues.some((i) => i.code === 'MASK_REQUIRES_DECISION' && i.severity === 'pending'));
  const ok = baseJob(s);
  ok.fields[2]!.maskDecision = USER;
  assert.ok(!checkVariantJob(confirmed(ok), s).issues.some((i) => i.code === 'MASK_REQUIRES_DECISION'));
});

// ---------- Conservación del diseño (relectura) ----------

test('MOCK [validación]: variante correcta → deterministas superadas; queda la revisión visual y humana', async () => {
  const { s, plan } = await readyPlan();
  const clone = await snap(cloneSpec('UNI · VAR medicina-sevilla', goodSevilla));
  const rep = checkVariant({ master: s, clone, plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: true, visual: null });
  for (const id of ['variant_dimensions', 'variant_structure', 'authorized_changes_only', 'layout_preserved', 'logo_intact', 'text_fit', 'master_unchanged']) assert.equal(statusOf(rep, id), 'pass', id);
  assert.equal(statusOf(rep, 'variant_data_isolation'), 'needs_review', 'el legal fijo menciona «Madrid»: se informa');
  assert.equal(rep.aggregate.status, 'not_evaluable', 'sin revisión de la captura no se da por buena');
  const withVisual = checkVariant({ master: s, clone, plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: true, visual: { status: 'needs_review', findings: [] } });
  assert.equal(withVisual.aggregate.humanApprovable, true);
  assert.equal(withVisual.aggregate.autoApprovable, false);
});

test('MOCK [validación]: logo movido, auto layout que desplaza, estilo perdido u otra pintura tocada → fallo', async () => {
  const { s, plan } = await readyPlan();
  const run = async (edits: Record<string, (n: MockNodeSpec) => MockNodeSpec>) => checkVariant({ master: s, clone: await snap(cloneSpec('UNI · VAR medicina-sevilla', { ...goodSevilla, ...edits })), plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: true, visual: null });
  const logo = await run({ '70:4': (n) => ({ ...n, x: 70 }) });
  assert.equal(statusOf(logo, 'logo_intact'), 'fail');
  assert.ok(codes(logo).includes('LOGO_MOVED_OR_RESIZED'));
  const shift = await run({ '70:9': (n) => ({ ...n, width: 300 }) });
  assert.ok(codes(shift).includes('LAYOUT_SHIFT'));
  const style = await run({ '70:7': (n) => ({ ...n, text: { ...n.text!, characters: 'Estudia Medicina en Sevilla', segments: [{ end: 27, fontStyle: 'Regular' }] } }) });
  assert.ok(codes(style).includes('TEXT_STYLE_CHANGED'));
  const paint = await run({ '70:2': (n) => ({ ...n, fills: [{ type: 'IMAGE', imageHash: 'img_medicina_sevilla', scaleMode: 'FILL', opacity: 0.5 }] }) });
  assert.ok(codes(paint).includes('IMAGE_PAINT_CHANGED'));
  const overlay = await run({ '70:3': (n) => ({ ...n, fills: [{ type: 'GRADIENT_LINEAR', opacity: 0.4 }] }) });
  assert.ok(codes(overlay).includes('UNAUTHORIZED_CHANGE'), 'el degradado sobre la foto se conserva');
  const wrongPhoto = await run({ '70:2': (n) => ({ ...n, fills: [{ type: 'IMAGE', imageHash: 'img_ade_valencia', scaleMode: 'FILL' }] }) });
  assert.ok(codes(wrongPhoto).includes('IMAGE_NOT_CONFIRMED_ASSET'));
  const master = checkVariant({ master: s, clone: await snap(cloneSpec('x', goodSevilla)), plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: false, visual: null });
  assert.equal(statusOf(master, 'master_unchanged'), 'fail');
});

// ---------- Script, reejecuciones y cambios manuales ----------

test('MOCK [script]: solo operaciones permitidas, cada variante desde la maestra, fallo aislado y sin duplicados', async () => {
  const { plan } = await readyPlan();
  const code = buildVariantScript(plan);
  assert.deepEqual(staticVariantViolations(code), []);
  assert.deepEqual(staticVariantViolations(`${code}\nnode.characters = 'x';`), ['.characters =']);
  assert.deepEqual(staticVariantViolations(`${code}\nnode.fills = [];`), ['.fills =']);
  assert.ok(code.includes('clone = master.clone();'), 'se clona la maestra, nunca otra variante');
  assert.ok(!/\b(?:existing|section\.children\[\w+\])\.clone\(\)/.test(code));
  assert.ok(code.includes("status: 'exists'"), 'reejecución: un clon con el mismo nombre no se duplica');
  assert.ok(code.includes('PCB_DISCARD_OWN_CLONE') && code.includes('results.push'), 'una variante fallida descarta su clon y se sigue con las demás');
  assert.ok(code.includes('PCB_LAYOUT_SHIFT'), 'si el auto layout desplaza algo, se detiene esa variante');
  assert.equal(buildVariantScript(plan), code, 'determinista entre ejecuciones');
  const one = buildVariantScript(plan, { variantIds: ['ade-valencia'] });
  assert.ok(one.includes('"ade-valencia"') && !one.includes('"medicina-sevilla"'));
  assert.throws(() => buildVariantScript(plan, { mode: 'patch' }), /clon existente/);
  const assets = buildVariantAssetsScript(['70:2', '80:2'], ['img_x']);
  assert.ok(!/\.fills\s*=(?!=)|createImage|\.remove\(/.test(assets), 'la lectura de activos no escribe');
});

test('MOCK [reejecución]: un cambio manual en el clon detiene el parche de esa variante y se detecta en la relectura', async () => {
  const { s, plan } = await readyPlan();
  const code = buildVariantScript(plan, { mode: 'patch', existingCloneIds: { 'medicina-sevilla': '71:1', 'ade-valencia': '72:1', 'derecho-bilbao': '73:1' } });
  assert.ok(code.indexOf("throw new Error('PCB_TEXT_UNEXPECTED '") < code.indexOf('wrote = true'), 'la guarda de cambios manuales va antes de escribir');
  assert.ok(code.indexOf("throw new Error('PCB_IMAGE_UNEXPECTED '") < code.indexOf('wrote = true'));
  assert.ok(code.includes('PATCH PARCIAL'), 'un parche a medias nunca se presenta como válido');
  const manual = await snap(cloneSpec('UNI · VAR medicina-sevilla', { ...goodSevilla, '70:8': (n) => ({ ...n, text: { ...n.text!, characters: 'Texto retocado a mano' } }) }));
  const rep = checkVariant({ master: s, clone: manual, plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: true, visual: null });
  assert.ok(codes(rep).includes('UNAUTHORIZED_CHANGE'));
});

test('MOCK [vinculación]: se conserva mientras los elementos vinculados no cambien; si cambian, hay que revincular', async () => {
  const moved = await snap(mapSpec(MASTER, '70:8', (n) => ({ ...n, text: { ...n.text!, characters: 'Otro cuerpo' } })));
  const j = confirmed(baseJob(await snap(MASTER)));
  const chk = checkVariantJob(j, moved);
  assert.ok(chk.issues.some((i) => i.code === 'MASTER_CHANGED_BINDING_VALID' && i.severity === 'pending'));
  const stale = await snap(mapSpec(MASTER, '70:11', (n) => ({ ...n, text: { ...n.text!, characters: 'universidad.example/grados' } })));
  assert.ok(checkVariantJob(j, stale).issues.some((i) => i.code === 'BINDING_STALE' && i.fieldId === 'url'));
  const logoField = baseJob(await snap(MASTER));
  logoField.fields.push({ fieldId: 'logo', label: 'Logo', kind: 'text', nodeId: '70:5', role: null, isLegal: false, masterValue: '', styleMapping: 'whole', textPolicy: { mode: 'strict' }, imagePolicy: null, paintIndex: null, maskDecision: null });
  assert.ok(checkVariantJob(logoField, await snap(MASTER)).issues.some((i) => i.code === 'FIELD_ON_LOGO'));
  const vec = baseJob(await snap(MASTER));
  vec.fields.push({ fieldId: 'sello', label: 'Sello', kind: 'text', nodeId: '70:14', role: null, isLegal: false, masterValue: '', styleMapping: 'whole', textPolicy: { mode: 'strict' }, imagePolicy: null, paintIndex: null, maskDecision: null });
  assert.ok(checkVariantJob(vec, await snap(MASTER)).issues.some((i) => i.code === 'FIELD_KIND_MISMATCH' && /activo editable/.test(i.message)));
});

// ---------- Resumen y entrega ----------

test('MOCK [entrega]: resumen previo con copies finales e imagen; informe que separa contenido confirmado de aceptación del diseño', async () => {
  const s = await snap(MASTER);
  const j = confirmed(baseJob(s));
  const md = renderJobSummary(j, s, checkVariantJob(j, s));
  assert.match(md, /«Estudia Medicina en Sevilla»/);
  assert.match(md, /foto medicina/);
  assert.match(md, /Se mantiene:\*\* Botón «Infórmate», Legal/);
  assert.match(md, /¿Confirmas estas variantes tal cual\?/);
  const missing: VariantAssetsRead = { ...ASSETS, nodes: ASSETS.nodes.filter((n) => n.nodeId !== '80:3') };
  const plan = buildVariantPlan(j, s, missing).plan;
  const result: VariantResult = {
    schema: 'pcb.variant.result.v1', scriptVersion: 'pcb.variant-script.v1', mode: 'create', masterNodeId: '70:1', sectionId: '90:1', sectionCreated: true, fonts: [],
    variants: [
      { variantId: 'medicina-sevilla', status: 'created', cloneId: '71:1', cloneName: 'UNI_Grados_1080x1080 · VAR medicina-sevilla', applied: [], error: null },
      { variantId: 'derecho-bilbao', status: 'failed', cloneId: null, cloneName: 'UNI_Grados_1080x1080 · VAR derecho-bilbao', applied: [], error: 'PCB_TEXT_DOES_NOT_FIT 70:7 (clon descartado)' },
    ],
  };
  const clone = await snap(cloneSpec('UNI_Grados_1080x1080 · VAR medicina-sevilla', goodSevilla));
  const chk = checkVariant({ master: s, clone, plan, entry: sevillaEntry(plan), tolerancePx: 0.01, masterDigestsEqual: true, visual: { status: 'needs_review', findings: [] } });
  const rep = renderVariantBatchReport(plan, result, [chk]);
  assert.match(rep, /\*\*\[MOCK\]\*\*/);
  assert.match(rep, /pendiente de revisión humana del diseño/);
  assert.match(rep, /node-id=71-1/);
  assert.match(rep, /bloqueada \(antes de escribir\)/);
  assert.match(rep, /\*\*Falló:\*\* PCB_TEXT_DOES_NOT_FIT/);
  assert.equal(MOCK_FILE_KEY, plan.master.fileKey);
});
