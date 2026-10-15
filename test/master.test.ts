// MOCK: brand kits (brands/uax, brands/mutualidad) y skill create-master-creative — brief, plan, script de
// construcción (simulación escribible mínima) y validación sobre relecturas sintéticas. Nada es una lectura real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrThrow } from '../src/contracts/schema.ts';
import { BrandSchema, type Brand } from '../src/contracts/brand.ts';
import { MASTER_RESULT_SCHEMA_ID, type MasterBrief, type MasterPlan, type MasterResult } from '../src/contracts/master.ts';
import type { VariantAssetsRead } from '../src/contracts/variants.ts';
import { checkBrand } from '../src/brand/check.ts';
import { contrast, rgbToHex, svgAspect, svgColors } from '../src/brand/color.ts';
import { checkBrief, confirmBrief } from '../src/master/brief.ts';
import { buildMasterPlan } from '../src/master/plan.ts';
import { buildMasterScript, staticMasterViolations } from '../src/figma/master-script.ts';
import { checkMaster } from '../src/master/check.ts';
import { buildTemplateJob } from '../src/master/template.ts';
import { checkVariantJob } from '../src/variants/job.ts';
import { universityMasterSpec, MOCK_FILE_KEY } from '../src/figma/mock/fixtures.ts';
import type { MockNodeSpec } from '../src/figma/mock/fake-figma.ts';
import { snap } from './helpers.ts';

const ROOT = new URL('../', import.meta.url).pathname;
const brand = (slug: string): Brand => parseOrThrow(BrandSchema, JSON.parse(readFileSync(`${ROOT}brands/${slug}/brand.json`, 'utf8')), slug);
const UAX = brand('uax'), MUT = brand('mutualidad');
const svgs = (b: Brand) => Object.fromEntries(b.logos.flatMap((l) => (l.file?.endsWith('.svg') ? [[l.id, readFileSync(`${ROOT}brands/${b.slug}/${l.file}`, 'utf8')]] : [])));
const ASSETS: VariantAssetsRead = { schema: 'pcb.variant-assets.v1', hashes: [], nodes: [{ nodeId: '80:2', found: true, type: 'RECTANGLE', width: 400, height: 400, images: [{ paintIndex: 0, hash: 'img_campus', visible: true, width: 2400, height: 1600, error: null }] }] };

function briefUax(over: Partial<MasterBrief> = {}): MasterBrief {
  return {
    schema: 'pcb.master-brief.v1', slug: 'grado-ingenieria', request: 'MOCK: captación grado de Ingeniería', brand: 'uax',
    objective: 'leads', audience: 'bachillerato', placement: 'Meta feed',
    format: { name: 'Feed 1:1', width: 1080, height: 1080 },
    figma: { fileKey: MOCK_FILE_KEY, pageId: '1:1', sectionName: 'PCB · Maestras' },
    mode: 'scratch', templateId: null, archetype: 'photo-top',
    copy: {
      headline: { text: 'Diseña el futuro con Ingeniería', source: 'brief' },
      subheadline: null,
      body: { text: 'Matrícula abierta. Grado oficial con prácticas desde primer curso.', source: 'brief' },
      cta: { text: 'Infórmate', source: 'brief' },
      legal: null, claim: null,
    },
    image: { source: 'figma_node', nodeId: '80:2', path: null, prompt: null, aiAuthorization: null, label: 'campus' },
    palette: { background: 'blanco-uax', text: 'negro-uax', accent: 'azul-uax' },
    logoId: null, safeArea: null,
    decisions: { fonts: { cta: { family: 'Manrope', style: 'Bold', by: 'user', note: 'MOCK' } }, cta: { fill: 'azul-uax', text: 'blanco-uax', radiusPx: null, by: 'user', note: 'MOCK' }, clearSpaceRatio: null, marginRatio: null, logoWidthRatio: null },
    templateTextPolicy: null, confirmation: null,
    ...over,
  };
}
const confirmed = (b: MasterBrief, br = UAX) => confirmBrief(b, br, 'Revisora MOCK', 'MOCK: sí');
const planOf = (b: MasterBrief, br = UAX) => buildMasterPlan({ brief: b, brand: br, logoSvgs: svgs(br), assets: ASSETS });

// ---------- Brand kits ----------

test('MOCK: los kits de UAX y Mutualidad son válidos; las erratas del manual quedan como pendientes, no como datos', async () => {
  const u = await checkBrand(UAX, `${ROOT}brands/uax`);
  assert.equal(u.ready, true, JSON.stringify(u.issues.filter((i) => i.severity === 'blocking')));
  assert.ok(u.issues.some((i) => i.code === 'COLOR_HEX_RGB_MISMATCH' && /F700FF/.test(i.message) && i.severity === 'pending'));
  assert.ok(Math.abs(u.logoAspects['principal-color']! - 483 / 95) < 1e-9);
  const m = await checkBrand(MUT, `${ROOT}brands/mutualidad`);
  assert.equal(m.ready, true);
  assert.ok(m.issues.some((i) => i.code === 'NO_EXTERNAL_LOGO'), 'faltan los logos de Mutualidad');
  assert.ok(m.issues.some((i) => i.code === 'FONT_NEEDS_INSTALL' && /Mutualidad/.test(i.message)));
});

test('MOCK: color — HEX↔RGB, contraste WCAG y colores de un SVG (sin las definiciones)', () => {
  assert.equal(rgbToHex([247, 0, 255]), '#F700FF');
  assert.ok(Math.abs(contrast('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.deepEqual(svgColors('<svg><defs><clipPath><rect fill="white"/></clipPath></defs><path fill="#0060ab"/><path style="fill:#222"/></svg>'), ['#0060AB', '#222222']);
  assert.equal(svgAspect('<svg width="483" height="95" viewBox="0 0 483 95">'), 483 / 95);
});

// ---------- Brief ----------

test('MOCK: el brief pide decidir lo que la marca no especifica (CTA, tipografía) y no se confirma sin decidirlo', () => {
  const raw = briefUax({ decisions: { fonts: {}, cta: null, clearSpaceRatio: null, marginRatio: null, logoWidthRatio: null } });
  const chk = checkBrief(raw, UAX);
  const codes = chk.issues.map((i) => i.code);
  assert.ok(codes.includes('CTA_STYLE_UNDECIDED') && codes.includes('FONT_ROLE_UNDECIDED') && codes.includes('BRIEF_NOT_CONFIRMED'));
  assert.match(chk.issues.find((i) => i.code === 'FONT_ROLE_UNDECIDED')!.proposal!, /Manrope Bold/);
  assert.throws(() => confirmed(raw), /no se puede confirmar/);
  const ok = confirmed(briefUax());
  assert.equal(checkBrief(ok, UAX).ready, true, JSON.stringify(checkBrief(ok, UAX).issues));
  assert.ok(!checkBrief({ ...ok, slug: 'otro' }, UAX).ready, 'cambiar el brief invalida la confirmación');
});

test('MOCK: el agente no inventa datos comerciales, ni colores sin confirmar, ni logos no aptos para paid', () => {
  const draft = briefUax({ copy: { ...briefUax().copy, body: { text: 'Matrícula desde 99 € al mes', source: 'agent_draft' } } });
  assert.ok(checkBrief(draft, UAX).issues.some((i) => i.code === 'COMMERCIAL_CLAIM_UNSOURCED'));
  const fluor = briefUax({ palette: { background: 'acento-complementario-2', text: 'negro-uax', accent: null } });
  assert.ok(checkBrief(fluor, UAX).issues.some((i) => i.code === 'COLOR_UNCONFIRMED'));
  assert.ok(checkBrief(briefUax({ logoId: 'monograma-color' }), UAX).issues.some((i) => i.code === 'LOGO_NOT_FOR_EXTERNAL'));
  assert.ok(checkBrief(briefUax({ image: { ...briefUax().image, source: 'ai_generated' } }), UAX).issues.some((i) => i.code === 'AI_IMAGE_NOT_AUTHORIZED'));
});

// ---------- Plan ----------

test('MOCK: plan UAX 1080 «photo-top» — logo ≥ mínimo de la marca, reserva 0,5× su altura, logo monocromo sobre foto', () => {
  const p = planOf(confirmed(briefUax()));
  assert.deepEqual(p.blockers, []);
  assert.equal(p.logo.logoId, 'principal-blanco', 'sobre foto, versión monocroma');
  assert.equal(p.logo.rect.width, 240, '1/5 de 1080 = 216 < mínimo 240');
  assert.ok(p.warnings.some((w) => w.startsWith('LOGO_RAISED_TO_MIN')));
  assert.ok(Math.abs(p.logo.clearSpacePx - (240 / (483 / 95)) * 0.5) < 0.02);
  assert.equal(p.image!.imageHash, 'img_campus');
  assert.deepEqual(p.stack.texts.map((t) => [t.name, t.font.style, t.sizePx]), [['Titular', 'Bold', 81], ['Cuerpo', 'Regular', 32]]);
  assert.equal(p.cta!.fill.hex, '#0060AB');
  assert.ok(p.internalRules.some((r) => /Escala tipográfica interna/.test(r)));
  assert.equal(p.frameName, 'uax_grado-ingenieria_1080x1080');
});

test('MOCK: sobre color, el plan elige el logo con contraste suficiente (2 tintas en claro, blanco sobre Azul UAX)', () => {
  const solid = (bg: string, tx: string) => planOf(confirmed(briefUax({ archetype: 'solid', image: { ...briefUax().image, source: 'none', nodeId: null }, palette: { background: bg, text: tx, accent: 'azul-uax' }, decisions: { ...briefUax().decisions, cta: { fill: 'negro-uax', text: 'blanco-uax', radiusPx: 8, by: 'user', note: null } } })));
  assert.equal(solid('blanco-uax', 'negro-uax').logo.logoId, 'principal-color');
  assert.equal(solid('azul-uax', 'blanco-uax').logo.logoId, 'principal-blanco');
});

test('MOCK: Mutualidad no se puede construir hasta tener los logos (bloqueo explícito, no un logo inventado)', () => {
  const b = briefUax({ brand: 'mutualidad', palette: { background: 'rosa-palo', text: 'verde-bosque', accent: 'verde-lima' }, decisions: { fonts: { cta: { family: 'Mutualidad', style: 'Bold', by: 'user', note: null } }, cta: { fill: 'verde-bosque', text: 'blanco-hueso', radiusPx: null, by: 'user', note: null }, clearSpaceRatio: { value: 1, by: 'user', note: null }, marginRatio: null, logoWidthRatio: null } });
  const chk = checkBrief(b, MUT);
  assert.ok(chk.issues.some((i) => i.code === 'NO_USABLE_LOGO' && i.severity === 'blocking'));
  assert.ok(chk.issues.some((i) => i.code === 'FONT_MAY_NOT_LOAD'));
});

// ---------- Script (simulación escribible mínima; medida de texto aproximada) ----------

function simFigma(opts: { missingFont?: string } = {}) {
  let next = 3000;
  const all = new Map<string, any>();
  const writes: string[] = [];
  const mk = (type: string, extra: Record<string, unknown> = {}): any => {
    const n: any = { id: `${next++}:1`, type, name: '', x: 0, y: 0, _w: 100, _h: 100, children: [], fills: [], parent: null, visible: true, ...extra };
    Object.defineProperty(n, 'width', { get: () => (n.type === 'TEXT' ? n._tw() : n.layoutMode && n.layoutMode !== 'NONE' && n.primaryAxisSizingMode === 'AUTO' && n.layoutMode === 'HORIZONTAL' ? n.children.reduce((s: number, c: any) => s + c.width, 0) + (n.paddingLeft ?? 0) + (n.paddingRight ?? 0) : n._w) });
    Object.defineProperty(n, 'height', { get: () => (n.type === 'TEXT' ? n._th() : n.layoutMode === 'VERTICAL' && n.primaryAxisSizingMode === 'AUTO' ? n.children.reduce((s: number, c: any) => s + c.height, 0) + (n.itemSpacing ?? 0) * Math.max(0, n.children.length - 1) : n.layoutMode === 'HORIZONTAL' && n.counterAxisSizingMode === 'AUTO' ? Math.max(0, ...n.children.map((c: any) => c.height)) + (n.paddingTop ?? 0) + (n.paddingBottom ?? 0) : n._h) });
    n.resize = (w: number, h: number) => { n._w = w; n._h = h; };
    n.resizeWithoutConstraints = n.resize;
    n.appendChild = (c: any) => { if (c.parent) c.parent.children = c.parent.children.filter((x: any) => x !== c); n.children.push(c); c.parent = n; };
    n.remove = () => { writes.push(`remove ${n.id}`); n.parent.children = n.parent.children.filter((x: any) => x !== n); };
    n.rescale = (k: number) => { n._w *= k; n._h *= k; };
    if (type === 'TEXT') {
      n._tw = () => (n.textAutoResize === 'WIDTH_AND_HEIGHT' ? n.characters.length * n.fontSize * 0.55 : n.layoutSizingHorizontal === 'FILL' ? n.parent._w : n._w);
      n._th = () => { const per = Math.max(1, Math.floor(n._tw() / (n.fontSize * 0.55))); return Math.ceil(n.characters.length / per) * n.fontSize * (n.lineHeight?.value ?? 120) / 100; };
    }
    all.set(n.id, n);
    return n;
  };
  const page = mk('PAGE', { id: '1:1', name: 'MOCK página' });
  all.set('1:1', page);
  page.loadAsync = async () => {};
  const photo = mk('RECTANGLE', { id: '80:2', name: 'campus', fills: [{ type: 'IMAGE', imageHash: 'img_campus' }] });
  all.set('80:2', photo);
  page.appendChild(photo);
  const figma = {
    getNodeByIdAsync: async (id: string) => all.get(id) ?? null,
    loadFontAsync: async (f: { family: string; style: string }) => { if (opts.missingFont === `${f.family}|${f.style}`) throw new Error('MOCK: font not available'); },
    createSection: () => mk('SECTION'), createFrame: () => mk('FRAME'), createRectangle: () => mk('RECTANGLE'), createText: () => mk('TEXT', { fontSize: 12 }),
    createNodeFromSvg: (svg: string) => { const a = svgAspect(svg) ?? 1; const n = mk('FRAME'); n._w = 100 * a; n._h = 100; return n; },
  };
  const run = async (code: string): Promise<MasterResult> => {
    const AF = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (f: unknown) => Promise<unknown>;
    return (await new AF('figma', code)(figma)) as MasterResult;
  };
  return { run, page, all, writes, photo };
}

test('MOCK [simulación]: el script crea la pieza en una sección nueva sin tocar nada existente; la reejecución no duplica', async () => {
  const p = planOf(confirmed(briefUax()));
  const code = buildMasterScript(p);
  assert.deepEqual(staticMasterViolations(code), []);
  const f = simFigma();
  const res = await f.run(code);
  assert.equal(res.schema, MASTER_RESULT_SCHEMA_ID);
  assert.equal(res.status, 'created', res.error ?? '');
  const frame = f.all.get(res.frameId!);
  assert.deepEqual(frame.children.map((c: any) => c.name), ['Panel', 'Foto', 'Logo', 'Textos']);
  assert.deepEqual(frame.children[3].children.map((c: any) => c.name), ['Titular', 'Cuerpo', 'CTA']);
  assert.equal(frame.children[2].width, 240);
  assert.deepEqual(f.photo.fills, [{ type: 'IMAGE', imageHash: 'img_campus' }], 'la imagen de origen solo se lee');
  assert.equal((await f.run(code)).status, 'exists');
});

test('MOCK [simulación]: una fuente que no carga detiene todo antes de crear; si los textos no caben, descarta su frame', async () => {
  const p = planOf(confirmed(briefUax()));
  const f = simFigma({ missingFont: 'Manrope|Bold' });
  await assert.rejects(f.run(buildMasterScript(p)), /PCB_FONT_UNAVAILABLE/);
  assert.equal(f.page.children.length, 1, 'ni sección ni frame');
  const long = planOf(confirmed(briefUax({ copy: { ...briefUax().copy, body: { text: 'Texto muy largo '.repeat(60), source: 'brief' } } })));
  const g = simFigma();
  const res = await g.run(buildMasterScript(long));
  assert.equal(res.status, 'failed');
  assert.match(res.error!, /PCB_TEXT_DOES_NOT_FIT.*frame descartado/);
  assert.ok(g.writes.some((w) => w.startsWith('remove')));
  assert.throws(() => buildMasterScript({ ...p, blockers: ['X'] }), /bloqueos/);
});

// ---------- Validación sobre la relectura ----------

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }; };
/** Relectura MOCK de lo que crearía el script para el plan (con las alteraciones indicadas). */
function readback(p: MasterPlan, alter: { logoW?: number; headline?: string; intruder?: boolean } = {}): MockNodeSpec {
  const Z = p.stack.zone;
  const txt = (id: string, t: MasterPlan['stack']['texts'][number], x: number, y: number, w: number, h: number): MockNodeSpec => ({ id, type: 'TEXT', name: t.name, x, y, width: w, height: h, fills: [{ type: 'SOLID', color: rgb(t.color.hex) }], text: { characters: t.text, fontFamily: t.font.family, fontStyle: t.font.style, fontSize: t.sizePx } });
  const [h, b] = p.stack.texts;
  const lw = alter.logoW ?? p.logo.rect.width;
  return {
    id: '500:1', type: 'FRAME', name: p.frameName, x: 0, y: 0, width: p.width, height: p.height, fills: [{ type: 'SOLID', color: rgb(p.background.hex) }], clipsContent: true,
    children: [
      { id: '500:2', type: 'RECTANGLE', name: 'Panel', x: p.panel!.rect.x, y: p.panel!.rect.y, width: p.panel!.rect.width, height: p.panel!.rect.height, fills: [{ type: 'SOLID', color: rgb(p.panel!.color.hex) }] },
      { id: '500:3', type: 'RECTANGLE', name: 'Foto', x: 0, y: 0, width: p.image!.rect.width, height: p.image!.rect.height, fills: [{ type: 'IMAGE', imageHash: p.image!.imageHash }] },
      { id: '500:4', type: 'FRAME', name: 'Logo', x: p.logo.rect.x, y: p.logo.rect.y, width: lw, height: p.logo.rect.height, children: [{ id: '500:5', type: 'VECTOR', name: 'path', x: 0, y: 0, width: lw, height: p.logo.rect.height, fills: [{ type: 'SOLID', color: rgb('#FFFFFF') }] }] },
      ...(alter.intruder ? [{ id: '500:6', type: 'RECTANGLE', name: 'Sello', x: p.logo.rect.x + lw + 2, y: p.logo.rect.y, width: 20, height: 20, fills: [{ type: 'SOLID', color: rgb('#0060AB') }] } as MockNodeSpec] : []),
      {
        id: '500:7', type: 'FRAME', name: 'Textos', x: Z.x, y: Z.y, width: Z.width, height: 300, layoutMode: 'VERTICAL', fills: [],
        children: [
          txt('500:8', alter.headline ? { ...h!, text: alter.headline } : h!, 0, 0, Z.width, 100),
          txt('500:9', b!, 0, 130, Z.width, 90),
          { id: '500:10', type: 'FRAME', name: 'CTA', x: 0, y: 240, width: 220, height: 60, fills: [{ type: 'SOLID', color: rgb(p.cta!.fill.hex) }], layoutMode: 'HORIZONTAL', children: [txt('500:11', p.cta!.text, 38, 14, 150, 34)] },
        ],
      },
    ],
  };
}

test('MOCK: master-check — la relectura conforme supera las comprobaciones; deformar el logo, cambiar el copy o invadir la reserva falla', async () => {
  const p = planOf(confirmed(briefUax()));
  const aspect = 483 / 95;
  const run = async (alter = {}) => checkMaster({ plan: p, snapshot: await snap(readback(p, alter)), logoAspect: aspect, minLogoContrast: 4.5, visual: null });
  const ok = await run();
  const st = Object.fromEntries(ok.results.map((r) => [r.validatorId, r.status]));
  assert.equal(st.master_frame, 'pass');
  assert.equal(st.master_copy_and_type, 'pass', JSON.stringify(ok.results.find((r) => r.validatorId === 'master_copy_and_type')!.findings));
  assert.equal(st.master_logo, 'needs_review', 'logo sobre foto: a revisar en la captura');
  assert.equal(st.master_text_contrast, 'pass');
  assert.equal(st.master_layout, 'pass', JSON.stringify(ok.results.find((r) => r.validatorId === 'master_layout')!.findings));
  assert.notEqual(ok.aggregate.status, 'fail');
  const codes = async (alter: object) => (await run(alter)).results.flatMap((r) => r.findings.map((f) => f.code));
  assert.ok((await codes({ logoW: 300 })).includes('LOGO_DEFORMED'));
  assert.ok((await codes({ logoW: 200 })).includes('LOGO_BELOW_MIN') || (await codes({ logoW: 200 })).includes('LOGO_DEFORMED'));
  assert.ok((await codes({ headline: 'Otro titular' })).includes('TEXT_NOT_CONFIRMED_COPY'));
  assert.ok((await codes({ intruder: true })).includes('LOGO_CLEAR_SPACE'));
});

// ---------- Modo plantilla ----------

test('MOCK: modo plantilla — el brief confirmado rellena los huecos de la plantilla como un encargo de variantes listo', async () => {
  const s = await snap(universityMasterSpec());
  const withTpl: Brand = { ...UAX, templates: [{ id: 'feed-1080', label: 'Feed 1080 (MOCK)', fileKey: s.fileKey, nodeId: '70:1', width: 1080, height: 1080, slots: { headline: { kind: 'text', nodeId: '70:8' }, cta: { kind: 'text', nodeId: '70:10' }, image: { kind: 'image', nodeId: '70:2' } }, logoNodeIds: ['70:4'], notes: null, source: 'MOCK' }] };
  const b = confirmed(briefUax({ mode: 'template', templateId: 'feed-1080', archetype: null, copy: { ...briefUax().copy, body: null } }), withTpl);
  const job = buildTemplateJob(b, withTpl, s);
  assert.deepEqual(job.fields.map((f) => [f.fieldId, f.nodeId]), [['headline', '70:8'], ['cta', '70:10'], ['image', '70:2']]);
  assert.equal(job.output.cloneNamePattern, 'uax_{variant}_1080x1080');
  assert.deepEqual(job.protected.logoNodeIds, ['70:4']);
  const chk = checkVariantJob(job, s);
  assert.equal(chk.ready, true, JSON.stringify(chk.issues));
});
