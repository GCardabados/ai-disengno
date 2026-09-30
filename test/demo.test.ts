// MOCK: propuestas del agente, plan de la demo, script de escritura sobre el clon y comprobaciones del resultado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/inventory/classify.ts';
import { buildDraftManifest } from '../src/inventory/manifest.ts';
import { validateProposals } from '../src/inventory/proposals.ts';
import { buildDemoPlan, type DemoPlan } from '../src/demo/plan.ts';
import { checkDemo } from '../src/demo/check.ts';
import { buildAdaptScript, staticAdaptViolations } from '../src/figma/adapt-script.ts';
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
    importantNodeIds: ['10:3', '10:6', '10:7', '10:8', '10:9', '10:10', '10:12'],
    sizeLockedNodeIds: ['10:3'],
    protectedRegions: [{ nodeId: '10:11', rect: { x: 0, y: 0, width: 460, height: 200 }, purpose: 'MOCK producto' }],
    mustCoverWidthNodeIds: ['10:2'],
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

// ---------- Script de escritura ----------

test('MOCK [script]: solo escribe en el clon, no sustituye fuentes y no contiene operaciones prohibidas', async () => {
  const { plan } = await scenario();
  const code = buildAdaptScript(plan, { sectionName: 'PCB · Salida DEMO', cloneName: 'DEMO clon', gapFromContentPx: 400 });
  assert.deepEqual(staticAdaptViolations(code), []);
  assert.ok(code.includes('PCB_REFUSED_MASTER_NODE') && code.includes('PCB_NOT_IN_CLONE'), 'guardas contra escribir en la maestra');
  assert.ok(code.includes('PCB_FONT_LOAD_FAILED') && !code.includes('fontName ='), 'nunca asigna otra fuente');
  assert.ok(code.includes('var FONT_REQUIRED = false;'), 'solo traslada textos: no exige cargar su fuente');
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
