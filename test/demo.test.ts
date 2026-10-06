// MOCK: propuestas del agente, plan de la demo, script de escritura sobre el clon y comprobaciones del resultado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/inventory/classify.ts';
import { buildDraftManifest } from '../src/inventory/manifest.ts';
import { validateProposals } from '../src/inventory/proposals.ts';
import { buildDemoPlan, type DemoPlan } from '../src/demo/plan.ts';
import { checkDemo } from '../src/demo/check.ts';
import { precheckPlan } from '../src/demo/tools.ts';
import { buildAdaptScript, staticAdaptViolations, fontRequiredNodeIds } from '../src/figma/adapt-script.ts';
import { summarizeTextCapabilities } from '../src/figma/text-capabilities.ts';
import { readingFlow } from '../src/demo/attention.ts';
import { renderDemoReport } from '../src/report/demo-md.ts';
import { compareNodeDigests } from '../src/figma/digests.ts';
import { mockReadRaw } from '../src/figma/mock/mock-relay.ts';
import { assembleChunks } from '../src/figma/chunks.ts';
import { baseMasterSpec, fakeOptions } from '../src/figma/mock/fixtures.ts';
import { createFakeFigma, runScriptInMock } from '../src/figma/mock/fake-figma.ts';
import { buildReadScript } from '../src/figma/read-script.ts';
import type { MockNodeSpec } from '../src/figma/mock/fake-figma.ts';
import type { AgentProposals, DemoComposition } from '../src/contracts/demo.ts';
import { parse } from '../src/contracts/schema.ts';
import { AgentProposalsSchema, DemoCompositionSchema } from '../src/contracts/demo.ts';
import { entityOf, exampleConfig, snap } from './helpers.ts';

const cfg = exampleConfig();
const AT = '2026-09-30T00:00:00.000Z';
const ev = [{ kind: 'structure' as const, detail: 'MOCK', nodeIds: [], artifact: null }];

function composition(over: Partial<DemoComposition> = {}): DemoComposition {
  return {
    schema: 'pcb.demo-composition.v1', label: 'MOCK 1080×1080', masterNodeId: '10:1',
    masterSize: { width: 1080, height: 1350 },
    target: { width: 1080, height: 1080, name: 'demo_1080x1080' },
    safeArea: { kind: 'internal_demo_rule', marginPx: 54, note: 'MOCK' },
    output: { sectionName: 'PCB · Salida DEMO', gapFromContentPx: 400 },
    units: [
      { unitId: 'product', nodeIds: ['10:11', '10:12'], anchorNodeId: '10:11', to: { x: 560, y: 540 }, why: 'MOCK' },
      { unitId: 'cta', nodeIds: ['10:8'], anchorNodeId: '10:8', to: { x: 60, y: 890 }, why: 'MOCK' },
      { unitId: 'legal', nodeIds: ['10:10'], anchorNodeId: '10:10', to: { x: 60, y: 980 }, why: 'MOCK' },
    ],
    effectResizes: [],
    vectorEdits: [],
    imageScales: [],
    logoPolicy: { mode: 'standard' },
    textEdits: [],
    legalNodeIds: [],
    messagePlan: null,
    layoutChecks: { readingOrder: [], cta: null, decorationMasks: [] },
    importantNodeIds: ['10:3', '10:6', '10:7', '10:8', '10:9', '10:10', '10:12'],
    sizeLockedNodeIds: ['10:3'],
    protectedRegions: [{ nodeId: '10:11', rect: { x: 0, y: 0, width: 460, height: 200 }, purpose: 'MOCK producto' }],
    mustCoverWidthNodeIds: ['10:2'],
    mustCoverEdges: [],
    ...over,
  };
}

/** Simula lo que haría el script en Figma: clon con ids nuevos, raíz redimensionada sin escalar hijos y traslaciones. */
function cloneSpec(spec: MockNodeSpec, plan: DemoPlan, mutate?: (s: MockNodeSpec) => void): { spec: MockNodeSpec; idMap: Array<[string, string]> } {
  const idMap: Array<[string, string]> = [];
  const copy = (n: MockNodeSpec): MockNodeSpec => {
    const id = n.id.replace(/^10:/, '90:');
    idMap.push([n.id, id]);
    const m = plan.moves.find((x) => x.nodeIds.includes(n.id));
    return { ...n, id, x: (n.x ?? 0) + (m?.dx ?? 0), y: (n.y ?? 0) + (m?.dy ?? 0), children: n.children?.map(copy) };
  };
  const out = { ...copy(spec), x: 5000, y: 0, width: plan.target.width, height: plan.target.height, name: 'DEMO clon' };
  mutate?.(out);
  return { spec: out, idMap };
}

const find = (s: MockNodeSpec, id: string): MockNodeSpec | undefined => (s.id === id ? s : s.children?.map((c) => find(c, id)).find(Boolean));

async function scenario(mutate?: (s: MockNodeSpec) => void, comp = composition()) {
  const spec = baseMasterSpec();
  const master = await snap(spec);
  const r = buildDemoPlan(master, comp);
  assert.ok(r.ok, r.ok ? '' : r.issues.join('\n'));
  const plan = (r as { ok: true; plan: DemoPlan }).plan;
  const c = cloneSpec(spec, plan, mutate);
  const clone = await snap(c.spec);
  return { master, clone, plan, idMap: c.idMap, comp };
}

const run = (s: Awaited<ReturnType<typeof scenario>>, extra: Partial<Parameters<typeof checkDemo>[0]> = {}) =>
  checkDemo({ master: s.master, clone: s.clone, idMap: s.idMap, plan: s.plan, composition: s.comp, tolerancePx: 0.01, masterDigestsEqual: true, visual: { status: 'needs_review', findings: [] }, ...extra });
const statusOf = (rep: ReturnType<typeof checkDemo>, id: string) => rep.results.find((x) => x.validatorId === id)?.status;

// ---------- Propuestas ----------

async function baseProposals() {
  const s = await snap(baseMasterSpec());
  const m = buildDraftManifest(s, classify(s, cfg), cfg, AT);
  const roleFor: Record<string, string> = {
    '10:1': 'background', '10:2': 'background', '10:4': 'logo', '10:6': 'headline', '10:7': 'body', '10:8': 'cta', '10:9': 'cta_label',
    '10:10': 'legal', '10:11': 'product_image', '10:12': 'price', '10:13': 'decorative', '10:16': 'decorative',
  };
  const p: AgentProposals = {
    schema: 'pcb.agent-proposals.v1', status: 'agent_proposal', proposedBy: 'agente MOCK', createdAt: AT,
    manifestId: m.manifestId, manifestHash: m.manifestHash,
    groups: [{ groupId: 'grp_cta', kind: 'cta_unit', label: 'CTA', entityIds: [entityOf(m, '10:8').entityId, entityOf(m, '10:9').entityId], attachedNodeIds: [], rigidAncestorNodeId: '10:8', evidence: ev }],
    roles: m.entities.map((e) => ({
      entityId: e.entityId, nodeIds: e.nodeIds, roleId: roleFor[e.nodeIds.find((n) => roleFor[n])!]!,
      groupId: e.nodeIds.includes('10:8') || e.nodeIds.includes('10:9') ? 'grp_cta' : null, proposedNature: null, confidence: 'medium' as const, evidence: ev,
    })),
    uncertain: [],
  };
  return { m, p };
}

test('MOCK [propuestas]: un conjunto completo de propuestas es coherente y sigue siendo agent_proposal', async () => {
  const { m, p } = await baseProposals();
  assert.ok(parse(AgentProposalsSchema, p).ok);
  assert.deepEqual(validateProposals(m, p, cfg), []);
  assert.equal(m.approval.status, 'draft', 'proponer no aprueba');
  assert.ok(m.entities.every((e) => e.role === null), 'las propuestas no se escriben en el manifiesto');
});

test('MOCK [propuestas]: detecta roles ausentes, duplicados, fuera de taxonomía y para otro manifiesto', async () => {
  const { m, p } = await baseProposals();
  const codes = (q: AgentProposals) => validateProposals(m, q, cfg).map((i) => i.code);
  assert.ok(codes({ ...p, roles: p.roles.slice(1) }).includes('ROLE_MISSING'));
  assert.ok(codes({ ...p, roles: [...p.roles, p.roles[0]!] }).includes('ROLE_DUPLICATED'));
  assert.ok(codes({ ...p, roles: p.roles.map((r, i) => (i === 0 ? { ...r, roleId: 'hero' } : r)) }).includes('ROLE_NOT_IN_TAXONOMY'));
  assert.ok(codes({ ...p, manifestHash: 'sha256:otro' }).includes('PROPOSALS_FOR_OTHER_MANIFEST'));
});

test('MOCK [propuestas]: un logo repartido en dos entidades cuenta como UNA unidad solo si se agrupa', async () => {
  const { m, p } = await baseProposals();
  const bannerId = entityOf(m, '10:13').entityId;
  const logoId = entityOf(m, '10:4').entityId;
  const twoLogos = p.roles.map((r) => (r.entityId === bannerId ? { ...r, roleId: 'logo' } : r));
  assert.ok(validateProposals(m, { ...p, roles: twoLogos }, cfg).some((i) => i.code === 'ROLE_MULTIPLICITY'));
  const grouped: AgentProposals = {
    ...p,
    groups: [...p.groups, { groupId: 'grp_logo', kind: 'logo_unit', label: 'Logo', entityIds: [logoId, bannerId], attachedNodeIds: ['10:3'], rigidAncestorNodeId: '10:3', evidence: ev }],
    roles: twoLogos.map((r) => (r.entityId === bannerId || r.entityId === logoId ? { ...r, groupId: 'grp_logo' } : r)),
  };
  assert.deepEqual(validateProposals(m, grouped, cfg), []);
});

// ---------- Plan ----------

test('MOCK [plan]: desplazamientos exactos por bloque a partir del ancla', async () => {
  const s = await snap(baseMasterSpec());
  assert.ok(parse(DemoCompositionSchema, composition()).ok);
  const r = buildDemoPlan(s, composition());
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.plan.moves.map((m) => [m.unitId, m.dx, m.dy]), [['product', 0, -20], ['cta', 0, -210], ['legal', 0, -270]]);
  assert.deepEqual(r.plan.expected['10:12']!.rect, { x: 600, y: 880, width: 200, height: 60 }, 'el precio se mueve con su producto');
  assert.deepEqual(r.plan.expected['10:9']!.rect, { x: 80, y: 910, width: 260, height: 40 }, 'el texto del CTA se mueve con su botón');
  assert.equal(r.plan.expected['10:3']!.dx, 0);
});

test('MOCK [plan]: rechaza composiciones que harían algo no permitido', async () => {
  const s = await snap(baseMasterSpec());
  const bad = (over: Partial<DemoComposition>) => {
    const r = buildDemoPlan(s, composition(over));
    return r.ok ? [] : r.issues.join('\n');
  };
  const u = composition().units;
  assert.match(String(bad({ units: [...u, { unitId: 'dup', nodeIds: ['10:8'], anchorNodeId: '10:8', to: { x: 0, y: 0 }, why: '' }] })), /dos bloques/);
  assert.match(String(bad({ units: [{ unitId: 'label', nodeIds: ['10:9'], anchorNodeId: '10:9', to: { x: 0, y: 0 }, why: '' }] })), /frame intermedio/);
  assert.match(String(bad({ units: [{ unitId: 'g', nodeIds: ['10:3', '10:4'], anchorNodeId: '10:3', to: { x: 0, y: 0 }, why: '' }] })), /antecesor/);
  assert.match(String(bad({ effectResizes: [{ nodeId: '10:2', to: { x: 0, y: 0, width: 1080, height: 1080 }, why: '' }] })), /tiene imagen/);
  assert.match(String(bad({ effectResizes: [{ nodeId: '10:4', to: { x: 0, y: 0, width: 10, height: 10 }, why: '' }] })), /bloque de tamaño bloqueado|solo se redimensionan/);
  assert.match(String(bad({ masterSize: { width: 960, height: 1200 } })), /Tamaño de la maestra/);
});

test('MOCK [plan/checks]: un GROUP cuyos hijos se mueven por separado no es un desplazamiento inesperado', async () => {
  // Mueve un solo vector del grupo "Claim": la caja del grupo cambia, pero es derivada.
  const comp = composition({ units: [...composition().units, { unitId: 'claim1', nodeIds: ['10:16'], anchorNodeId: '10:16', to: { x: 60, y: 780 }, why: 'MOCK' }] });
  const s = await scenario(undefined, comp);
  assert.equal(s.plan.expected['10:15']!.derived, true);
  assert.equal(statusOf(run(s), 'allowed_operations'), 'pass');
  // Pero el hijo sí se comprueba: si no está donde dice el plan, falla.
  const bad = await scenario((c) => { find(c, '90:16')!.y = 0; }, comp);
  assert.equal(statusOf(run(bad), 'allowed_operations'), 'fail');
});

test('MOCK [checks]: en un GROUP derivado se siguen comprobando opacidad, rotación y demás propiedades del contenedor', async () => {
  const s = await scenario();
  assert.equal(s.plan.expected['10:3']!.derived, true);
  const opacity = run(await scenario((c) => { find(c, '90:3')!.opacity = 0.5; }));
  assert.equal(statusOf(opacity, 'content_preserved'), 'fail');
  const rotated = run(await scenario((c) => { find(c, '90:15')!.rotation = 5; }));
  assert.ok(rotated.results.find((r) => r.validatorId === 'allowed_operations')!.findings.some((f) => f.code === 'LINEAR_TRANSFORM_CHANGED'));
  const clip = run(await scenario((c) => { find(c, '90:8')!.clipsContent = !find(baseMasterSpec(), '10:8')!.clipsContent; }));
  assert.ok(clip.results.find((r) => r.validatorId === 'content_preserved')!.findings.some((f) => f.code === 'CONTAINER_PROPS_CHANGED'));
});

// ---------- Script de escritura ----------

test('MOCK [script]: solo escribe en el clon, no sustituye fuentes y no contiene operaciones prohibidas', async () => {
  const { plan } = await scenario();
  const code = buildAdaptScript(plan, { sectionName: 'PCB · Salida DEMO', cloneName: 'DEMO clon', gapFromContentPx: 400 });
  assert.deepEqual(staticAdaptViolations(code), []);
  assert.ok(code.includes('PCB_REFUSED_MASTER_NODE') && code.includes('PCB_NOT_IN_CLONE'), 'guardas contra escribir en la maestra');
  assert.ok(code.includes('PCB_FONT_UNAVAILABLE') && !code.includes('fontName ='), 'nunca asigna otra fuente');
  assert.ok(code.includes('var FONT_REQUIRED_NODE_IDS = [];'), 'sin ediciones de texto no exige cargar fuentes');
  assert.ok(!code.includes('insertCharacters') && !code.includes('setRangeFontSize'), 'sin ediciones declaradas no toca textos');
  assert.ok(code.includes('PCB_ADAPT_FAILED_CLONE_DISCARDED'), 'todo o nada: descarta su propio clon si algo falla');
  assert.equal(code.split('.remove(').length - 1, 1, 'única eliminación: el clon propio');
  assert.ok(code.includes('resizeWithoutConstraints(PLAN.target.width'), 'la raíz se redimensiona sin escalar hijos');
  assert.ok(!code.includes('rescale('), 'sin escalado global');
  assert.ok(code.includes('PCB_DEMO_ALREADY_EXISTS'), 'no duplica clones');
  assert.ok(code.indexOf('page.appendChild(section)') > code.indexOf('figma.createSection()'), 'la sección de salida va a la página de la maestra');
  assert.ok(code.includes('PCB_OUTPUT_NOT_ON_MASTER_PAGE'));
  const planLine = code.split('\n')[0]!;
  assert.deepEqual(JSON.parse(planLine.slice('var PLAN = '.length, -1)).moves.map((m: { dx: number }) => m.dx), plan.moves.map((m) => m.dx));
  assert.deepEqual(staticAdaptViolations(`${code}\nnode.remove();`), ['.remove(']);
});

// ---------- Comprobaciones ----------

test('MOCK [checks]: clon correcto → deterministas superadas; queda revisión humana', async () => {
  const rep = run(await scenario());
  for (const id of ['target_dimensions', 'nodes_preserved', 'content_preserved', 'allowed_operations', 'logo_locked', 'demo_safe_area', 'background_coverage', 'master_unchanged']) {
    assert.equal(statusOf(rep, id), 'pass', `${id}: ${JSON.stringify(rep.results.find((r) => r.validatorId === id)?.findings)}`);
  }
  assert.equal(rep.aggregate.status, 'needs_review');
  assert.equal(rep.aggregate.autoApprovable, false);
});

test('MOCK [checks]: sin captura revisada ni relectura de la maestra el resultado no es evaluable', async () => {
  const rep = run(await scenario(), { visual: null, masterDigestsEqual: null });
  assert.equal(rep.aggregate.status, 'not_evaluable');
});

test('MOCK [checks]: logo redimensionado o con disposición interna cambiada → fallo', async () => {
  const resized = run(await scenario((s) => { const v = find(s, '90:4')!; v.width = 81; }));
  assert.equal(statusOf(resized, 'logo_locked'), 'fail');
  const shifted = run(await scenario((s) => { find(s, '90:5')!.x = 91; }));
  assert.equal(statusOf(shifted, 'logo_locked'), 'fail');
  assert.equal(shifted.aggregate.status, 'fail', 'la revisión visual no compensa un fallo determinista');
});

test('MOCK [checks]: texto alterado, nodo eliminado o fuera de la zona de prueba → fallo', async () => {
  const text = run(await scenario((s) => { find(s, '90:6')!.text = { characters: 'Otro titular' }; }));
  assert.ok(text.results.find((r) => r.validatorId === 'content_preserved')!.findings.some((f) => f.code === 'TEXT_CHANGED'));
  const removed = run(await scenario((s) => { s.children = s.children!.filter((c) => c.id !== '90:10'); }));
  assert.equal(statusOf(removed, 'nodes_preserved'), 'fail');
  const out = run(await scenario((s) => { find(s, '90:10')!.y = 1040; }));
  assert.equal(statusOf(out, 'demo_safe_area'), 'fail');
  assert.equal(statusOf(out, 'allowed_operations'), 'fail', 'además no está donde dice el plan');
});

test('MOCK [checks]: franja de fondo sin cubrir, texto sobre la región protegida y maestra cambiada → fallo', async () => {
  const strip = run(await scenario((s) => { find(s, '90:2')!.width = 1000; }));
  assert.ok(strip.results.find((r) => r.validatorId === 'background_coverage')!.findings.some((f) => f.code === 'BACKGROUND_STRIP_UNCOVERED'));
  const over = run(await scenario((s) => { find(s, '90:12')!.y = 560; }));
  assert.ok(over.results.find((r) => r.validatorId === 'background_coverage')!.findings.some((f) => f.code === 'TEXT_OVER_PROTECTED_REGION'));
  assert.equal(statusOf(run(await scenario(), { masterDigestsEqual: false }), 'master_unchanged'), 'fail');
});

// ---------- Maestra intacta por hashes por nodo ----------

test('MOCK [digests]: la relectura por hashes por nodo detecta exactamente qué nodo cambió', async () => {
  const spec = baseMasterSpec();
  const { rawTexts } = await mockReadRaw(spec);
  const a = assembleChunks(rawTexts.map((rawText) => ({ rawText, rawResponsePath: null })));
  assert.ok(a.ok);
  if (!a.ok) return;
  const digestsOf = async (s: MockNodeSpec) => (await runScriptInMock(buildReadScript(s.id, { mode: 'node-digests' }), createFakeFigma(fakeOptions(s)))).rawText;
  assert.equal(compareNodeDigests(a.value.payload, await digestsOf(spec)).equal, true);
  const moved = baseMasterSpec();
  find(moved, '10:10')!.x = 61;
  const cmp = compareNodeDigests(a.value.payload, await digestsOf(moved));
  assert.equal(cmp.equal, false);
  assert.deepEqual(cmp.changedNodeIds, ['10:10']);
});

// ---------- Ediciones vectoriales de decoración y modo patch ----------

const claimEdit = {
  nodeId: '10:16', purpose: 'decoration' as const,
  vertices: [{ index: 1, from: { x: 120, y: 800 }, to: { x: 140, y: 790 } }],
  tangents: [], why: 'MOCK',
};

test('MOCK [plan]: las ediciones vectoriales solo se admiten sobre decoración, nunca sobre el logo ni texto', async () => {
  const s = await snap(baseMasterSpec());
  const ok = buildDemoPlan(s, composition({ vectorEdits: [claimEdit] }));
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.plan.expected['10:16']!.edited, true);
  const logo = buildDemoPlan(s, composition({ vectorEdits: [{ ...claimEdit, nodeId: '10:4' }] }));
  assert.ok(!logo.ok && logo.issues.some((i) => /logo/.test(i)));
  const text = buildDemoPlan(s, composition({ vectorEdits: [{ ...claimEdit, nodeId: '10:6' }] }));
  assert.ok(!text.ok && text.issues.some((i) => /VECTOR/.test(i)));
  const mask = buildDemoPlan(s, composition({ vectorEdits: [{ ...claimEdit, purpose: 'decoration_mask' }] }));
  assert.ok(!mask.ok && mask.issues.some((i) => /máscara/.test(i)));
});

test('MOCK [checks]: vector_edits exige el destino exacto y que nada más del vector se mueva', async () => {
  const comp = composition({ vectorEdits: [claimEdit] });
  const s = await scenario(undefined, comp);
  const seg = { start: 0, end: 1, tangentStart: [0, 0] as [number, number], tangentEnd: [0, 0] as [number, number] };
  const before = { '90:16': { vertices: [[100, 800], [120, 800]] as Array<[number, number]>, segments: [seg] } };
  const good = { '90:16': { vertices: [[100, 800], [140, 790]] as Array<[number, number]>, segments: [seg] } };
  const drift = { '90:16': { vertices: [[101, 800], [140, 790]] as Array<[number, number]>, segments: [seg] } };
  const miss = { '90:16': { vertices: [[100, 800], [150, 790]] as Array<[number, number]>, segments: [seg] } };
  assert.equal(statusOf(run(s, { vectorProbe: { before, after: good } }), 'vector_edits'), 'pass');
  assert.ok(run(s, { vectorProbe: { before, after: drift } }).results.find((r) => r.validatorId === 'vector_edits')!.findings.some((f) => f.code === 'UNEDITED_VERTEX_MOVED'));
  assert.ok(run(s, { vectorProbe: { before, after: miss } }).results.find((r) => r.validatorId === 'vector_edits')!.findings.some((f) => f.code === 'VERTEX_NOT_AT_TARGET'));
  assert.equal(statusOf(run(s, { vectorProbe: null }), 'vector_edits'), 'not_evaluable');
});

test('MOCK [script]: el modo patch actualiza el clon existente sin clonar ni borrar, con guarda de vértice inesperado', async () => {
  const { plan } = await scenario(undefined, composition({ vectorEdits: [claimEdit] }));
  const code = buildAdaptScript(plan, { sectionName: 'PCB · Salida DEMO', cloneName: 'DEMO clon', gapFromContentPx: 400, mode: 'patch', existingCloneId: '90:1' });
  assert.ok(code.includes('var MODE = "patch";'));
  assert.ok(code.includes('PCB_PATCH_TARGET_NOT_FOUND') && code.includes('PCB_VERTEX_UNEXPECTED'), 'no pisa cambios ajenos');
  assert.ok(code.includes("if (MODE !== 'patch') {\n  clone.remove();"), 'solo se descarta el clon (o la copia) que crea el propio script');
  assert.deepEqual(staticAdaptViolations(code), []);
  assert.throws(() => buildAdaptScript(plan, { sectionName: 'x', cloneName: 'y', gapFromContentPx: 0, mode: 'patch' }), /existingCloneId/);
});

test('MOCK [plan]: un efecto dentro de un bloque trasladado se puede redimensionar (coordenadas finales); el propio nodo trasladado no', async () => {
  const s = await snap(baseMasterSpec());
  const inMoved = composition({ units: [{ unitId: 'claim', nodeIds: ['10:15'], anchorNodeId: '10:15', to: { x: 60, y: 780 }, why: '' }],
    effectResizes: [{ nodeId: '10:16', to: { x: 60, y: 780, width: 10, height: 60 }, why: '' }] });
  // 10:16 es VECTOR: se rechaza por tipo, no por estar dentro de un bloque trasladado.
  const r = buildDemoPlan(s, inMoved);
  assert.ok(!r.ok && r.issues.every((i) => !/trasladarse y redimensionarse/.test(i)));
  const self = buildDemoPlan(s, composition({ effectResizes: [{ nodeId: '10:11', to: { x: 0, y: 0, width: 10, height: 10 }, why: '' }] }));
  assert.ok(!self.ok && self.issues.some((i) => /trasladarse y redimensionarse|tiene imagen/.test(i)));
});

test('[script v6]: la traslación de un GROUP se mide sobre un descendiente de referencia no modificado', async () => {
  const { plan } = await scenario();
  const code = buildAdaptScript(plan, { sectionName: 'S', cloneName: 'C', gapFromContentPx: 0 });
  assert.ok(code.includes("if (mNode.type === 'GROUP')") && code.includes('PCB_GROUP_WITHOUT_REFERENCE'));
  assert.ok(code.includes('if (!CHANGED[cands[ci].id]) ref = cands[ci];'), 'la referencia excluye nodos redimensionados o editados');
});

// ---------- v7: escala proporcional de imágenes, copia de un clon y maquetación ----------

test('MOCK [plan]: escala proporcional de una imagen; nunca del logo ni de un texto', async () => {
  const s = await snap(baseMasterSpec());
  const ok = buildDemoPlan(s, composition({ mustCoverWidthNodeIds: [], imageScales: [{ nodeId: '10:2', scale: 0.5, to: { x: 540, y: 405 }, why: 'MOCK' }] }));
  assert.ok(ok.ok, ok.ok ? '' : ok.issues.join('\n'));
  if (!ok.ok) return;
  assert.deepEqual(ok.plan.expected['10:2']!.rect, { x: 540, y: 405, width: 540, height: 675 });
  assert.equal(ok.plan.expected['10:2']!.scale, 0.5);
  const bad = (id: string) => { const r = buildDemoPlan(s, composition({ imageScales: [{ nodeId: id, scale: 0.5, to: { x: 0, y: 0 }, why: '' }] })); return r.ok ? '' : r.issues.join('\n'); };
  assert.match(bad('10:4'), /bloque de tamaño bloqueado|no tiene una imagen/);
  assert.match(bad('10:6'), /es texto|no tiene una imagen/);
  assert.match(bad('10:11'), /trasladarse en un bloque y escalarse/);
});

test('MOCK [checks]: una imagen escalada con el mismo factor pasa; deformada o con otro factor falla', async () => {
  const comp = composition({ mustCoverWidthNodeIds: [], imageScales: [{ nodeId: '10:2', scale: 0.5, to: { x: 540, y: 405 }, why: 'MOCK' }] });
  const scaled = (w: number, h: number) => (c: MockNodeSpec) => { const n = find(c, '90:2')!; n.x = 540; n.y = 405; n.width = w; n.height = h; };
  assert.equal(statusOf(run(await scenario(scaled(540, 675), comp)), 'allowed_operations'), 'pass');
  assert.equal(statusOf(run(await scenario(scaled(540, 675), comp)), 'content_preserved'), 'pass', 'las pinturas no cambian');
  const deformed = run(await scenario(scaled(540, 700), comp));
  assert.ok(deformed.results.find((r) => r.validatorId === 'allowed_operations')!.findings.some((f) => f.code === 'IMAGE_DEFORMED'));
});

test('MOCK [checks]: orden de lectura y CTA centrado bajo su copy, separado de él', async () => {
  const lc = (cta: { x: number; y: number }) => composition({
    units: [...composition().units.filter((u) => u.unitId !== 'cta'), { unitId: 'cta', nodeIds: ['10:8'], anchorNodeId: '10:8', to: cta, why: '' }],
    layoutChecks: { readingOrder: ['10:6', '10:7', '10:8'], cta: { nodeId: '10:8', copyNodeId: '10:7', minGapPx: 16, maxCenterOffsetPx: 2 }, decorationMasks: [] },
  });
  // 10:7 ocupa x 60..1020 (centro 540) e y 440..520.
  const good = await scenario(undefined, lc({ x: 390, y: 560 }));
  assert.equal(statusOf(run(good), 'layout_order_and_cta'), 'pass');
  const codes = async (to: { x: number; y: number }) => run(await scenario(undefined, lc(to))).results.find((r) => r.validatorId === 'layout_order_and_cta')!.findings.map((f) => f.code);
  assert.ok((await codes({ x: 60, y: 560 })).includes('CTA_NOT_CENTERED_ON_COPY'));
  assert.ok((await codes({ x: 390, y: 500 })).includes('CTA_GAP'), 'comparte franja con su copy');
  assert.ok((await codes({ x: 390, y: 200 })).includes('READING_ORDER'), 'el CTA no puede leerse antes que el mensaje');
  // A la derecha y en la MISMA línea superior (diferencias de rasterización < 1 px) sigue siendo "después".
  const sameLine = composition({ units: [...composition().units.filter((u) => u.unitId !== 'cta'), { unitId: 'cta', nodeIds: ['10:8'], anchorNodeId: '10:8', to: { x: 1030, y: 439.5 }, why: '' }],
    layoutChecks: { readingOrder: ['10:7', '10:8'], cta: null, decorationMasks: [] } });
  assert.equal(statusOf(run(await scenario(undefined, sameLine)), 'layout_order_and_cta'), 'pass');
});

test('MOCK [checks]: visibilidad efectiva — un texto importante tapado por una forma opaca o con opacidad 0 no pasa', async () => {
  const base = await scenario();
  assert.equal(statusOf(run(base), 'effective_visibility'), 'pass');
  const hidden = await scenario((c) => { find(c, '90:7')!.opacity = 0; });
  assert.ok(run(hidden).results.find((r) => r.validatorId === 'effective_visibility')!.findings.some((f) => f.code === 'NOT_FULLY_VISIBLE'));
  const covered = await scenario((c) => { const b = find(c, '90:8')!; b.y = 440; });
  assert.ok(run(covered).results.find((r) => r.validatorId === 'effective_visibility')!.findings.some((f) => f.code === 'COVERED_BY_OPAQUE_NODE'));
});

test('[script v7]: modo copy duplica el clon de origen sin tocarlo y escala imágenes de forma proporcional', async () => {
  const comp = composition({ mustCoverWidthNodeIds: [], imageScales: [{ nodeId: '10:2', scale: 0.5, to: { x: 540, y: 405 }, why: 'MOCK' }] });
  const { plan } = await scenario(undefined, comp);
  const code = buildAdaptScript(plan, { sectionName: 'S', cloneName: 'C v2', gapFromContentPx: 0, mode: 'copy', sourceCloneId: '90:1' });
  assert.ok(code.includes('var MODE = "copy";') && code.includes('"sourceCloneId":"90:1"'));
  assert.ok(code.includes("MODE === 'copy' ? source.clone()") && code.includes('PCB_COPY_SOURCE_NOT_FOUND'));
  assert.ok(code.includes('inode.resize(tw, th)') && code.includes('var tw = mIs.width * isc.scale, th = mIs.height * isc.scale;'), 'mismo factor en ancho y alto');
  assert.deepEqual(staticAdaptViolations(code), []);
  assert.throws(() => buildAdaptScript(plan, { sectionName: 'x', cloneName: 'y', gapFromContentPx: 0, mode: 'copy' }), /sourceCloneId/);
});

// ---------- Exclusiones de la zona segura (plantillas de Figma) ----------

test('zona segura: tocar una exclusión es bloqueante en precheck y en demo-check; no tocarla pasa', async () => {
  const safeArea = (ex: Array<{ name: string; rect: { x: number; y: number; width: number; height: number } }>) => ({
    kind: 'safe_zone_rule' as const, ruleId: 'figma:MOCK', version: 'MOCK', provenance: 'internal' as const,
    allowed: { x: 54, y: 54, width: 972, height: 972 }, note: 'MOCK', exclusions: ex, source: null,
  });
  // El CTA (10:8) queda en 60,890 300×80: una exclusión en la esquina inferior izquierda lo toca.
  const hit = await scenario(undefined, composition({ safeArea: safeArea([{ name: 'Iconos', rect: { x: 54, y: 900, width: 100, height: 126 } }]) }));
  const pre = precheckPlan(hit.plan, hit.comp, []);
  assert.ok(pre.some((f) => f.code === 'IN_SAFE_ZONE_EXCLUSION' && f.nodeId === '10:8'), JSON.stringify(pre));
  const rep = run(hit);
  assert.equal(statusOf(rep, 'demo_safe_area'), 'fail');
  assert.ok(rep.results.find((r) => r.validatorId === 'demo_safe_area')!.findings.some((f) => f.code === 'IN_SAFE_ZONE_EXCLUSION'));
  const clear = await scenario(undefined, composition({ safeArea: safeArea([{ name: 'Iconos', rect: { x: 900, y: 54, width: 126, height: 100 } }]) }));
  assert.ok(!precheckPlan(clear.plan, clear.comp, []).some((f) => f.code === 'IN_SAFE_ZONE_EXCLUSION'));
  assert.equal(statusOf(run(clear), 'demo_safe_area'), 'pass');
});

test('zona segura: las composiciones sin exclusiones siguen siendo válidas (valor por defecto)', () => {
  const c = parse(DemoCompositionSchema, { ...composition(), safeArea: { kind: 'safe_zone_rule', ruleId: 'r', version: 'v', provenance: 'client', allowed: { x: 0, y: 0, width: 10, height: 10 }, note: '' } });
  assert.ok(c.ok);
  assert.deepEqual(c.ok && c.value.safeArea.kind === 'safe_zone_rule' ? c.value.safeArea.exclusions : null, []);
});


// ============================================================================
// Criterios 2026-10: logo estándar/experimental, texto flexible, fuentes y flujo de lectura
// ============================================================================

const logoUnit = { unitId: 'logo', nodeIds: ['10:3'], anchorNodeId: '10:3', to: { x: 60, y: 60 }, why: 'MOCK' };
const experimental = (scale = 1.25) => composition({
  units: [...composition().units, logoUnit],
  logoPolicy: { mode: 'experimental', logoNodeId: '10:3', scale, authorization: 'MOCK encargo E-1 (persona declarada)', why: 'MOCK' },
});
/** Simula rescale(): el bloque y TODOS sus nodos escalan desde la esquina del grupo. */
const scaleLogo = (k: number, kx = k, ky = k) => (c: MockNodeSpec) => {
  const g = find(c, '90:3')!;
  g.width *= kx; g.height *= ky;
  for (const ch of g.children ?? []) { ch.x = (ch.x ?? 0) * kx; ch.y = (ch.y ?? 0) * ky; ch.width *= kx; ch.height *= ky; }
};
const findings = (rep: ReturnType<typeof checkDemo>, id: string) => rep.results.find((r) => r.validatorId === id)?.findings.map((f) => f.code) ?? [];

test('logo ESTÁNDAR: el escalado se rechaza en el plan, no entra en el script y la validación lo detecta', async () => {
  const s = await snap(baseMasterSpec());
  const r = buildDemoPlan(s, composition({ imageScales: [{ nodeId: '10:4', scale: 1.2, to: { x: 60, y: 60 }, why: '' }] }));
  assert.ok(!r.ok && r.issues.some((i) => /logo/.test(i)), 'no se escala un nodo del logo como imagen');
  const std = await scenario();
  assert.equal(std.plan.logo.mode, 'standard');
  assert.ok(!buildAdaptScript(std.plan, { sectionName: 'S', cloneName: 'C', gapFromContentPx: 0 }).includes('rescale('));
  // Un clon con el logo escalado en modo estándar falla, aunque la escala sea proporcional.
  const scaled = run(await scenario(scaleLogo(1.25)));
  assert.equal(statusOf(scaled, 'logo_locked'), 'fail');
  assert.ok(findings(scaled, 'logo_locked').includes('LOGO_SIZE_CHANGED'));
});

test('logo EXPERIMENTAL: escala proporcional de extremo a extremo (plan, script, validación e informe)', async () => {
  const s = await snap(baseMasterSpec());
  const r = buildDemoPlan(s, experimental());
  assert.ok(r.ok, r.ok ? '' : r.issues.join('\n'));
  const plan = (r as { ok: true; plan: DemoPlan }).plan;
  assert.deepEqual(plan.logo, { mode: 'experimental', nodeId: '10:3', scale: 1.25, x: 60, y: 60, authorization: 'MOCK encargo E-1 (persona declarada)' });
  assert.deepEqual(plan.expected['10:5']!.rect, { x: 60 + 90 * 1.25, y: 60 + 20 * 1.25, width: 250, height: 50 }, 'disposición interna escalada');
  const code = buildAdaptScript(plan, { sectionName: 'S', cloneName: 'C', gapFromContentPx: 0 });
  assert.deepEqual(staticAdaptViolations(code), [], 'la escala solo aparece en la línea permitida');
  assert.equal(code.split('rescale(').length - 1, 1);
  assert.ok(code.includes('PCB_LOGO_UNEXPECTED_SIZE') && code.includes("op: 'scale_logo'"));
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => unknown;
  assert.doesNotThrow(() => new AsyncFn('figma', code), 'el script generado es JavaScript válido');
  const both = buildDemoPlan(s, experimental(), {});
  assert.ok(both.ok);
  const sc = await scenario(scaleLogo(1.25), experimental());
  const rep = run(sc);
  assert.equal(statusOf(rep, 'logo_locked'), 'needs_review', 'experimental: correcto pero siempre a revisión');
  assert.deepEqual(findings(rep, 'logo_locked'), ['LOGO_EXPERIMENTAL_SCALE']);
  for (const id of ['content_preserved', 'allowed_operations', 'nodes_preserved', 'text_fit']) assert.equal(statusOf(rep, id), 'pass', id);
  const md = renderDemoReport(sc.comp, rep, { fileKey: 'K', cloneId: '90:1', cloneName: 'C', sectionId: 'S', screenshotPath: null, fonts: [], designerDecisions: [] });
  assert.match(md, /^# EXPERIMENTAL — DEMO/);
  assert.match(md, /Logo en modo EXPERIMENTAL/);
  // Factor distinto del declarado: falla.
  assert.ok(findings(run(await scenario(scaleLogo(1.1), experimental())), 'logo_locked').includes('LOGO_SIZE_CHANGED'));
  // Activación incompleta: el logo debe ser el ancla única de su bloque y estar declarado como bloque de logo.
  const noUnit = buildDemoPlan(s, composition({ logoPolicy: { mode: 'experimental', logoNodeId: '10:3', scale: 1.2, authorization: 'MOCK', why: '' } }));
  assert.ok(!noUnit.ok && noUnit.issues.some((i) => /ancla y único nodo/.test(i)));
  const notLogo = buildDemoPlan(s, composition({ units: [...composition().units, { ...logoUnit, nodeIds: ['10:13'], anchorNodeId: '10:13' }], logoPolicy: { mode: 'experimental', logoNodeId: '10:13', scale: 1.2, authorization: 'MOCK', why: '' } }));
  assert.ok(!notLogo.ok && notLogo.issues.some((i) => /no es un bloque de logo/.test(i)));
});

test('logo: deformación o alteración interna se rechaza en cualquier modo', async () => {
  const deformed = run(await scenario(scaleLogo(1.25, 1.25, 1.1), experimental()));
  assert.ok(findings(deformed, 'logo_locked').includes('LOGO_DEFORMED'));
  const moved = run(await scenario((c) => { find(c, '90:5')!.x = 120; }));
  assert.ok(findings(moved, 'logo_locked').includes('LOGO_INTERNAL_LAYOUT_CHANGED'));
  const movedExp = run(await scenario((c) => { scaleLogo(1.25)(c); find(c, '90:5')!.y = 0; }, experimental()));
  assert.ok(findings(movedExp, 'logo_locked').includes('LOGO_INTERNAL_LAYOUT_CHANGED'));
  const recolored = run(await scenario((c) => { scaleLogo(1.25)(c); find(c, '90:4')!.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]; }, experimental()));
  assert.equal(statusOf(recolored, 'content_preserved'), 'fail', 'cambio interno de pinturas');
  const rotated = run(await scenario((c) => { find(c, '90:4')!.rotation = 10; }));
  assert.ok(findings(rotated, 'logo_locked').includes('LOGO_TRANSFORM_CHANGED'));
});

// ---------- Texto flexible ----------

const titleEdit = { nodeId: '10:6', box: { width: 600, height: null }, align: 'CENTER' as const, lineBreaks: { characters: 'Nueva colección\nde otoño' }, fontScale: 1.25, lineHeight: null, authorization: null, why: 'MOCK' };
const editedTitle = (over: Partial<MockNodeSpec> = {}) => (c: MockNodeSpec) => {
  const t = find(c, '90:6')!;
  Object.assign(t, { width: 600, height: 130, text: { characters: 'Nueva colección\nde otoño', fontSize: 40, autoResize: 'HEIGHT', align: 'CENTER' } }, over);
};

test('texto: edición autorizada (caja, alineación, saltos, cuerpo) conservando el copy y la tipografía', async () => {
  const sc = await scenario(editedTitle(), composition({ textEdits: [titleEdit] }));
  assert.deepEqual(sc.plan.expected['10:6']!.free, { width: false, height: true });
  const rep = run(sc);
  for (const id of ['content_preserved', 'allowed_operations', 'text_fit']) assert.equal(statusOf(rep, id), 'pass', `${id}: ${findings(rep, id)}`);
  const code = buildAdaptScript(sc.plan, { sectionName: 'S', cloneName: 'C', gapFromContentPx: 0 });
  assert.deepEqual(staticAdaptViolations(code), []);
  assert.ok(code.includes('setRangeFontSize') && code.includes('PCB_TEXT_NOT_LINEBREAK_ONLY') && !code.includes('fontName ='));
  assert.deepEqual(fontRequiredNodeIds(sc.plan), ['10:6']);
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => unknown;
  assert.doesNotThrow(() => new AsyncFn('figma', code), 'el script generado es JavaScript válido');
  // Reescribir el mensaje con la excusa de un salto de línea: rechazado en el plan…
  const s = await snap(baseMasterSpec());
  const rew = buildDemoPlan(s, composition({ textEdits: [{ ...titleEdit, lineBreaks: { characters: 'Nueva colección\nde invierno' } }] }));
  assert.ok(!rew.ok && rew.issues.some((i) => /cambia el copy/.test(i)));
  // …y detectado en el clon.
  const changed = run(await scenario(editedTitle({ text: { characters: 'Nueva colecciónXde otoño', fontSize: 40, autoResize: 'HEIGHT', align: 'CENTER' } }), composition({ textEdits: [titleEdit] })));
  assert.ok(findings(changed, 'content_preserved').includes('TEXT_CHANGED'));
  // Cuerpo distinto del declarado o fuente cambiada: estilo distinto.
  const size = run(await scenario(editedTitle({ text: { characters: 'Nueva colección\nde otoño', fontSize: 36, autoResize: 'HEIGHT', align: 'CENTER' } }), composition({ textEdits: [titleEdit] })));
  assert.ok(findings(size, 'content_preserved').includes('TEXT_STYLE_CHANGED'));
  const font = run(await scenario(editedTitle({ text: { characters: 'Nueva colección\nde otoño', fontSize: 40, fontFamily: 'Otra', autoResize: 'HEIGHT', align: 'CENTER' } }), composition({ textEdits: [titleEdit] })));
  assert.ok(findings(font, 'content_preserved').includes('TEXT_STYLE_CHANGED'));
  // Alineación no aplicada.
  const align = run(await scenario(editedTitle({ text: { characters: 'Nueva colección\nde otoño', fontSize: 40, autoResize: 'HEIGHT', align: 'LEFT' } }), composition({ textEdits: [titleEdit] })));
  assert.ok(findings(align, 'text_fit').includes('TEXT_ALIGN_MISMATCH'));
});

test('texto: los límites los pone el proyecto (sin mínimos inventados) y un legal no se reduce sin autorización', async () => {
  const s = await snap(baseMasterSpec());
  const plan = (c: Partial<DemoComposition>, policy?: Parameters<typeof buildDemoPlan>[2]) => buildDemoPlan(s, composition(c), policy);
  // Sin política configurada no hay mínimo: una reducción fuerte de un titular es técnicamente válida.
  assert.ok(plan({ textEdits: [{ ...titleEdit, fontScale: 0.3 }] }).ok);
  const strict = { textPolicy: { editable: ['position', 'box', 'reflow', 'alignment', 'line_breaks'] as Array<'position' | 'box' | 'reflow' | 'alignment' | 'line_breaks'>, fontScale: { min: 0.8, max: 1.5 }, minFontSizePx: 24 } };
  const denied = plan({ textEdits: [titleEdit] }, strict);
  assert.ok(!denied.ok && denied.issues.some((i) => /no permite editar font_size/.test(i)));
  const minimum = plan({ textEdits: [{ ...titleEdit, fontScale: 0.7 }] }, { textPolicy: { ...strict.textPolicy, editable: [...strict.textPolicy.editable, 'font_size'] } });
  assert.ok(!minimum.ok && minimum.issues.some((i) => /fuera del rango/.test(i)) && minimum.issues.some((i) => /mínimo del proyecto/.test(i)));
  const legal = { nodeId: '10:10', box: null, align: null, lineBreaks: null, fontScale: 0.8, lineHeight: null, authorization: null, why: 'MOCK' };
  const noAuth = plan({ legalNodeIds: ['10:10'], textEdits: [legal] });
  assert.ok(!noAuth.ok && noAuth.issues.some((i) => /legal exige autorización/.test(i)));
  assert.ok(plan({ legalNodeIds: ['10:10'], textEdits: [{ ...legal, authorization: 'MOCK: legal aprobado por cliente' }] }).ok);
  const noPos = plan({}, { textPolicy: { editable: ['box'], fontScale: null, minFontSizePx: null } });
  assert.ok(!noPos.ok && noPos.issues.some((i) => /posición del texto/.test(i)));
});

test('texto: el desbordamiento de la caja tras editar se detecta en la relectura', async () => {
  // El render (glifos) se sale 100 px por la derecha de una caja de 600 px.
  const over = run(await scenario(editedTitle({ renderBounds: { x: 5000 + 60, y: 300, width: 700, height: 130 } }), composition({ textEdits: [titleEdit] })));
  assert.equal(statusOf(over, 'text_fit'), 'fail');
  assert.ok(findings(over, 'text_fit').includes('TEXT_OVERFLOW'));
  const trunc = run(await scenario(editedTitle({ text: { characters: 'Nueva colección\nde otoño', fontSize: 40, autoResize: 'HEIGHT', align: 'CENTER', truncation: 'ENDING' } }), composition({ textEdits: [titleEdit] })));
  assert.ok(findings(trunc, 'text_fit').includes('TEXT_TRUNCATION_ENABLED'));
});

test('fuentes: una fuente no disponible detiene la edición ANTES de escribir y se informa sin sustituirla', async () => {
  const { plan } = await scenario(undefined, composition({ textEdits: [titleEdit] }));
  const code = buildAdaptScript(plan, { sectionName: 'S', cloneName: 'C', gapFromContentPx: 0 });
  const stub = (available: boolean) => {
    const calls: string[] = [];
    const page: Record<string, unknown> = { type: 'PAGE', children: [], loadAsync: async () => {} };
    const title = { id: '10:6', type: 'TEXT', characters: 'Nueva colección de otoño', getStyledTextSegments: () => [{ start: 0, end: 24, fontName: { family: 'Marca', style: 'Bold' } }] };
    const master = { id: '10:1', type: 'FRAME', name: plan.masterName, width: 1080, height: 1350, parent: page, absoluteBoundingBox: { x: 0, y: 0, width: 1080, height: 1350 },
      findAllWithCriteria: () => [title], findAll: () => [], clone: () => { calls.push('clone'); throw new Error('STOP_CLONE'); } };
    const figma = {
      getNodeByIdAsync: async (id: string) => (id === '10:1' ? master : id === '10:6' ? title : null),
      loadFontAsync: async (f: { family: string; style: string }) => { calls.push(`load ${f.family}`); if (!available) throw new Error(`The font "${f.family} ${f.style}" could not be loaded.`); },
      createSection: () => { calls.push('createSection'); throw new Error('STOP_SECTION'); },
    };
    return { calls, run: () => new (Object.getPrototypeOf(async function () {}).constructor)('figma', code)(figma) as Promise<unknown> };
  };
  const missing = stub(false);
  await assert.rejects(missing.run(), (e: Error) => /PCB_FONT_UNAVAILABLE/.test(e.message) && /"family":"Marca"/.test(e.message) && /10:6/.test(e.message));
  assert.deepEqual(missing.calls, ['load Marca'], 'no crea sección ni clon: nada escrito');
  const ok = stub(true);
  await assert.rejects(ok.run(), /STOP_SECTION/, 'con la fuente disponible continúa hacia la escritura');
  // La comprobación previa lo informa como limitación técnica del entorno, no como regla.
  const sum = summarizeTextCapabilities({ schema: 'pcb.text-capabilities.v1', fonts: [{ family: 'Marca', style: 'Bold', loaded: false, error: 'not found', nodeIds: ['10:6'] }], nodes: [{ id: '10:6', type: 'TEXT', found: true, hasMissingFont: true, api: { setRangeFontSize: true } }] }, ['setRangeFontSize']);
  assert.equal(sum.ok, false);
  assert.match(sum.lines.join('\n'), /Marca Bold NO disponible.*Limitación técnica: no se sustituye/);
});

// ---------- Mensaje y flujo de lectura ----------

test('mensaje: persona sin región protegida o mirada sin dirección se rechazan; el flujo es una estimación declarada', async () => {
  const s = await snap(baseMasterSpec());
  const mp = { main: ['10:6'], secondary: ['10:7'], offer: ['10:12'], cta: ['10:8'], subject: { kind: 'person' as const, nodeId: '10:13', cue: 'gaze' as const, direction: 'left' as const, decision: 'MOCK' }, readingPath: ['10:6', '10:7', '10:12', '10:8'] };
  const noFace = buildDemoPlan(s, composition({ messagePlan: mp }));
  assert.ok(!noFace.ok && noFace.issues.some((i) => /región protegida/.test(i)));
  const unclear = buildDemoPlan(s, composition({ messagePlan: { ...mp, subject: { ...mp.subject, nodeId: '10:11', direction: 'unclear' } } }));
  assert.ok(!unclear.ok && unclear.issues.some((i) => /proximidad, alineación o espacio libre/.test(i)));
  // Persona = producto 10:11 (tiene región protegida en la composición de prueba) mirando a la izquierda: el titular
  // está a su izquierda → sin aviso; mirando a la derecha → aviso orientativo (no bloqueante).
  const left = await scenario(undefined, composition({ messagePlan: { ...mp, subject: { ...mp.subject, nodeId: '10:11' } } }));
  assert.equal(statusOf(run(left), 'message_relation'), 'pass');
  const right = run(await scenario(undefined, composition({ messagePlan: { ...mp, subject: { ...mp.subject, nodeId: '10:11', direction: 'right' } } })));
  assert.equal(statusOf(right, 'message_relation'), 'needs_review');
  const flow = readingFlow(left.clone, left.idMap, left.comp.messagePlan!);
  assert.deepEqual(flow.elements.map((e) => [e.order, e.nodeId, e.role]), [[1, '10:6', 'main'], [2, '10:7', 'secondary'], [3, '10:12', 'offer'], [4, '10:8', 'cta']]);
  assert.deepEqual(flow.arrows, [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }]);
  assert.match(flow.disclaimer, /heurística/);
  assert.ok(!JSON.stringify(flow).includes('%'), 'sin porcentajes');
});
