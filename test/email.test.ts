// Skill create-email-design y conocimiento compartido de clientes. Usa el conocimiento REAL de client-knowledge/
// (Mutualidad con reglas de email observadas; UAX sin reglas de email ni plantillas ni ejemplos) y una simulación
// MOCK mínima de la Plugin API para ejecutar el script generado: prueba el control de flujo, no el render real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkClient, clientPath, identifyClient, listClients, loadContext, withLogoSvg, writeProposal, type KnowledgeContext } from '../src/knowledge/store.ts';
import { checkEmailBrief, confirmEmailBrief } from '../src/email/brief.ts';
import { buildEmailPlan, columnWidths } from '../src/email/plan.ts';
import { checkEmailResult, djb2 } from '../src/email/check.ts';
import { buildEmailScript, splitEmailScript, staticEmailViolations, USE_FIGMA_MAX_CHARS } from '../src/figma/email-script.ts';
import { mergeResults } from '../src/email/cli.ts';
import { EmailBriefSchema, EmailPlanSchema, EmailResultSchema, type EmailBrief, type EmailPlan, type EmailResult, type PNode } from '../src/contracts/email.ts';
import { parseOrThrow } from '../src/contracts/schema.ts';

const ROOT = resolve(import.meta.dirname, '..', 'client-knowledge');
const BRIEF = parseOrThrow(EmailBriefSchema, JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'email', 'mutualidad-area-privada.brief.json'), 'utf8')), 'brief');
const clone = <T>(x: T): T => structuredClone(x);
const mutualidad = () => loadContext(ROOT, 'mutualidad', 'email');
const codes = (b: EmailBrief, ctx: KnowledgeContext) => checkEmailBrief(b, ctx).issues.map((i) => `${i.severity}:${i.code}`);

// ---------- Conocimiento compartido ----------

test('conocimiento: identifica el cliente por alias y carga solo su canal (bajo demanda anunciado, no cargado)', async () => {
  const all = await listClients(ROOT);
  assert.deepEqual(identifyClient(all, 'Email para Mutualidad de la Abogacía').map((c) => c.slug), ['mutualidad']);
  assert.deepEqual(identifyClient(all, 'Campaña de la Universidad Alfonso X').map((c) => c.slug), ['uax']);
  const ctx = await mutualidad();
  assert.deepEqual(ctx.loaded.map((f) => f.id).sort(), ['brand', 'email']);
  assert.ok(ctx.onDemand.some((f) => f.path === 'guidelines.md'), 'guidelines.md se anuncia');
  assert.ok(ctx.loaded.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.equal(ctx.brand?.slug, 'mutualidad');
  const paid = await loadContext(ROOT, 'mutualidad', 'paid');
  assert.equal(paid.email, null, 'el canal email no se carga para paid');
});

test('conocimiento: aislamiento — rutas fuera del cliente, enlaces y slugs ajenos se rechazan', async () => {
  assert.throws(() => clientPath(ROOT, 'mutualidad', '../uax/brand.json'), /fuera del cliente/);
  assert.throws(() => clientPath(ROOT, 'mutualidad', '/etc/passwd'), /fuera del cliente/);
  assert.throws(() => clientPath(ROOT, '../uax', 'brand.json'), /Slug/);
  const tmp = mkdtempSync(join(tmpdir(), 'ck-'));
  try {
    cpSync(ROOT, tmp, { recursive: true });
    symlinkSync(join(tmp, 'clients', 'uax', 'brand.json'), join(tmp, 'clients', 'mutualidad', 'otro.json'));
    assert.throws(() => clientPath(tmp, 'mutualidad', 'otro.json'), /Enlace que sale/);
    // Un canal email que dice ser de otro cliente bloquea.
    const p = join(tmp, 'clients', 'mutualidad', 'channels', 'email.json');
    const e = JSON.parse(readFileSync(p, 'utf8')); e.client = 'uax'; writeFileSync(p, JSON.stringify(e));
    const ctx = await loadContext(tmp, 'mutualidad', 'email');
    assert.ok(ctx.issues.some((i) => i.code === 'EMAIL_OTHER_CLIENT' && i.severity === 'blocking'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('conocimiento: contradicción marca ↔ email se informa (no se resuelve en silencio); módulo de otro archivo bloquea', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ck-'));
  try {
    cpSync(ROOT, tmp, { recursive: true });
    const p = join(tmp, 'clients', 'mutualidad', 'channels', 'email.json');
    const e = JSON.parse(readFileSync(p, 'utf8'));
    e.colors[0].hex = '#003828';
    e.modules[0].figma.fileKey = 'OtroArchivoDeOtroCliente00';
    writeFileSync(p, JSON.stringify(e));
    const { issues } = await checkClient(tmp, 'mutualidad');
    assert.ok(issues.some((i) => i.code === 'EMAIL_COLOR_CONFLICT' && i.severity === 'pending' && i.message.includes('#004136')));
    assert.ok(issues.some((i) => i.code === 'MODULE_FILE_NOT_DECLARED' && i.severity === 'blocking'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('conocimiento: una propuesta va a cuarentena y no cambia lo que se carga', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ck-'));
  try {
    cpSync(ROOT, tmp, { recursive: true });
    const before = await loadContext(tmp, 'mutualidad', 'email');
    const rel = await writeProposal(tmp, {
      schema: 'ck.proposal.v1', client: 'mutualidad', createdAt: '2026-10-22T10:00:00Z', fromJob: 'runs/2026-10-22-mutualidad-area-privada', proposedBy: 'Claude',
      items: [{ targetFile: 'email', change: 'cta.radius = "pill"', kind: 'gap_fill', rationale: 'Usado en este encargo', evidence: ['decisión del encargo, sin aprobación del cliente'] }],
      status: 'proposed', review: null,
    });
    assert.match(rel, /^proposals\/2026-10-22-[0-9a-f]{8}\.json$/);
    const after = await loadContext(tmp, 'mutualidad', 'email');
    assert.deepEqual(after.email, before.email, 'la propuesta no se aplica');
    assert.ok(after.issues.some((i) => i.code === 'OPEN_PROPOSALS'));
    await assert.rejects(writeProposal(tmp, { schema: 'ck.proposal.v1', client: 'mutualidad', createdAt: '2026-10-22', fromJob: 'x', proposedBy: 'x', items: [{ targetFile: 'no-existe', change: 'x', kind: 'new_rule', rationale: 'x', evidence: ['x'] }], status: 'proposed', review: null }), /no está en el índice/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('conocimiento: la plantilla mínima de cliente es válida (con pendientes, sin bloqueos)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ck-'));
  try {
    cpSync(join(ROOT, '_templates', 'client'), join(tmp, 'clients', 'cliente-ejemplo'), { recursive: true });
    const { issues } = await checkClient(tmp, 'cliente-ejemplo');
    assert.ok(!issues.some((i) => i.severity === 'blocking'), JSON.stringify(issues.filter((i) => i.severity === 'blocking')));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ---------- Brief ----------

test('brief Mutualidad: copys aprobados/propuestos/pendientes contados; solo falta la confirmación', async () => {
  const ctx = await mutualidad();
  const chk = checkEmailBrief(BRIEF, ctx);
  assert.deepEqual(chk.copy, { approved: 8, proposed: 6, placeholder: 1 });
  assert.deepEqual(chk.issues.filter((i) => i.severity !== 'warning').map((i) => i.code), ['BRIEF_NOT_CONFIRMED']);
  assert.ok(chk.issues.some((i) => i.code === 'URL_MISSING'));
  assert.ok(chk.issues.some((i) => i.code === 'COLOR_OBSERVED'), 'los colores observados se avisan');
  const conf = confirmEmailBrief(BRIEF, ctx, 'Tester', 'ok');
  assert.ok(checkEmailBrief(conf, ctx).ready);
  const changed = clone(conf); changed.modules[1]!.headline!.text = 'Otro titular';
  assert.ok(codes(changed, ctx).includes('pending:BRIEF_CHANGED_AFTER_CONFIRMATION'));
});

test('brief: un borrador del agente no puede inventar precios, plazos ni afirmaciones comerciales', async () => {
  const ctx = await mutualidad();
  for (const text of ['Ahorra 50 € al mes desde hoy', 'Rentabilidad del 4% garantizada', 'Solo hoy: regalo para ti', 'Válido hasta el 31/12']) {
    const b = clone(BRIEF); b.modules[2]!.items[2]!.body = { text, source: 'agent_draft', note: null };
    assert.ok(codes(b, ctx).includes('blocking:COMMERCIAL_CLAIM_UNSOURCED'), text);
  }
  // El mismo dato con fuente en el brief sí vale.
  const ok = clone(BRIEF); ok.modules[1]!.body = [{ text: 'Ahorra 50 € al mes', source: 'brief', note: null }]; ok.modules[2]!.items[2]!.body = { text: 'Con 50 € al mes', source: 'agent_draft', note: null };
  assert.ok(!codes(ok, ctx).includes('blocking:COMMERCIAL_CLAIM_UNSOURCED'));
});

test('brief: placeholders identificados, dominios ajenos, textos prohibidos, contraste y estructura', async () => {
  const ctx = await mutualidad();
  const p = clone(BRIEF); p.modules[3]!.body = [{ text: 'Textos legales aquí', source: 'placeholder', note: null }];
  assert.ok(codes(p, ctx).includes('blocking:PLACEHOLDER_NOT_MARKED'));
  const u = clone(BRIEF); u.modules[1]!.cta!.url = 'https://otra-marca.com/promo';
  assert.ok(codes(u, ctx).includes('pending:URL_FOREIGN_DOMAIN'));
  const u2 = clone(BRIEF); u2.modules[1]!.cta!.url = 'https://www.mutualidad.com/area-privada';
  assert.ok(!codes(u2, ctx).some((c) => c.includes('URL_')));
  const c = clone(BRIEF); c.modules[1]!.textColor = 'brand-cta';
  assert.ok(codes(c, ctx).includes('blocking:TEXT_CONTRAST_LOW'));
  const nc = clone(BRIEF); nc.modules[1]!.background = 'brand-darker';
  assert.ok(codes(nc, ctx).includes('blocking:COLOR_UNCONFIRMED'), 'un color pendiente de confirmar no se usa');
  const nf = clone(BRIEF); nf.modules = nf.modules.filter((m) => m.type !== 'footer');
  assert.ok(codes(nf, ctx).includes('pending:FOOTER_MISSING'));
  const ctx2 = clone(ctx); ctx2.email!.legal.forbiddenClaims.push({ text: 'siempre a mano', source: 'test' });
  assert.ok(codes(BRIEF, ctx2).includes('blocking:FORBIDDEN_CLAIM'));
});

test('brief UAX (sin reglas de email, sin plantillas ni ejemplos): pide decisiones con propuesta y luego avanza con valores por defecto', async () => {
  const ctx = await loadContext(ROOT, 'uax', 'email');
  assert.equal(ctx.email, null);
  assert.ok(ctx.issues.some((i) => i.code === 'NO_EMAIL_CHANNEL' && i.severity === 'warning'));
  const b: EmailBrief = {
    ...clone(BRIEF), slug: 'uax-jornada', name: 'JornadaDemo', client: 'uax', canvas: { background: 'blanco-uax', text: 'negro-uax' },
    decisions: { fonts: {}, cta: null, logo: null, other: [] },
    modules: clone(BRIEF.modules).map((m) => ({ ...m, background: m.type === 'header' ? 'blanco-uax' : m.type === 'legal' || m.type === 'footer' ? 'blanco-uax' : null, textColor: null, eyebrow: m.type === 'header' ? null : m.eyebrow })),
  };
  const chk = checkEmailBrief(b, ctx);
  const pend = chk.issues.filter((i) => i.severity === 'pending');
  assert.ok(pend.some((i) => i.code === 'FONT_UNDECIDED' && /Arimo/.test(i.proposal ?? '')));
  assert.ok(pend.some((i) => i.code === 'CTA_STYLE_UNDECIDED' && /azul-uax/.test(i.proposal ?? '')), JSON.stringify(pend));
  assert.ok(pend.some((i) => i.code === 'LOGO_UNDECIDED' && /principal-color/.test(i.proposal ?? '')));
  // La persona acepta las propuestas → decisiones del encargo.
  const font = (style: string) => ({ stack: 'Arial, Helvetica, sans-serif', figma: { family: 'Arimo', style }, by: 'agent_proposal' as const, note: null });
  b.decisions = { fonts: { h1: font('Bold'), body: font('Regular') }, cta: { fill: 'azul-uax', text: 'blanco-uax', radius: 4, by: 'agent_proposal', note: null }, logo: { logoId: 'principal-color', widthPx: 240, by: 'agent_proposal', note: null }, other: [] };
  const ctxL = await withLogoSvg(ctx, b.decisions.logo!.logoId);
  const conf = confirmEmailBrief(b, ctxL, 'Tester', 'ok');
  const plan = buildEmailPlan(conf, ctxL);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.widths.desktop, 600); assert.equal(plan.widths.mobile, 375);
  assert.ok(plan.internalRules.some((r) => r.startsWith('ancho desktop: 600px')));
  assert.ok(plan.internalRules.some((r) => /h2: Arimo Bold, misma familia que h1/.test(r)), 'roles derivados declarados');
  assert.ok(plan.provenance.some((p) => p.topic === 'logo' && p.from === 'brief_decision'));
  assert.ok(Object.keys(plan.svgs).includes('principal-color'), 'el SVG real del logo viaja al script');
});

test('el ejemplo de brief de la skill es válido y no contiene datos de un cliente real', () => {
  const ex = parseOrThrow(EmailBriefSchema, JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '.claude', 'skills', 'create-email-design', 'references', 'ejemplo-email-brief.json'), 'utf8')), 'ejemplo');
  assert.equal(ex.client, 'cliente-ejemplo');
  assert.ok(!JSON.stringify(ex).toLowerCase().includes('mutualidad'));
});

// ---------- Plan ----------

const walk = (ns: PNode[], f: (n: PNode, path: string) => void, path = '') => ns.forEach((n) => { f(n, `${path}/${n.name}`); if (n.k === 'frame') walk(n.children, f, `${path}/${n.name}`); });
const find = (ns: PNode[], name: string): PNode | undefined => { let hit: PNode | undefined; walk(ns, (n) => { if (!hit && n.name === name) hit = n; }); return hit; };

test('plan Mutualidad: desktop 600 / mobile 393 observados, mobile con reglas propias y procedencia declarada', async () => {
  const ctx = await mutualidad();
  const plan = buildEmailPlan(confirmEmailBrief(BRIEF, ctx, 'Tester', 'ok'), ctx);
  parseOrThrow(EmailPlanSchema, plan, 'plan');
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.widths, { desktop: 600, mobile: 393 });
  // Columnas: 3 en desktop que suman exactamente 536; 1 en mobile.
  const ventD = find(plan.desktop, 'ventajas') as Extract<PNode, { k: 'frame' }>;
  const fila = find(ventD.children, 'Fila_1') as Extract<PNode, { k: 'frame' }>;
  assert.equal(fila.dir, 'H');
  assert.equal(fila.children.reduce((s, c) => s + (c.k === 'frame' ? c.w : 0), 0) + fila.gap * 2, 536);
  assert.equal(find(plan.mobile, 'Fila_1'), undefined, 'en mobile no hay filas horizontales');
  // CTA: alto 56 observado; ancho completo en mobile (393 − 2×20).
  const ctaD = find(plan.desktop, 'CTA') as Extract<PNode, { k: 'button' }>, ctaM = find(plan.mobile, 'CTA') as Extract<PNode, { k: 'button' }>;
  assert.equal(ctaD.h, 56); assert.equal(ctaD.w, null); assert.equal(ctaM.w, 353);
  assert.equal(ctaD.border?.id, 'brand-primary', 'borde por WCAG 1.4.11: lima sobre blanco < 3:1');
  assert.equal(ctaD.radius, 28);
  // Titular: 40 desktop (observado) → 32 mobile (regla interna declarada).
  const h1D = find(plan.desktop, 'Titular') as Extract<PNode, { k: 'text' }>, h1M = find(plan.mobile, 'Titular') as Extract<PNode, { k: 'text' }>;
  assert.deepEqual([h1D.size, h1M.size], [40, 32]);
  assert.equal(h1D.font.family, 'Arimo');
  assert.ok(plan.internalRules.some((r) => /h1 mobile 32px/.test(r)));
  assert.ok(plan.internalRules.some((r) => /margen lateral mobile: 20px/.test(r)));
  assert.ok(plan.provenance.some((p) => p.topic === 'ancho mobile' && p.from === 'email_observed'));
  assert.ok(plan.notes.development.some((d) => /Arial, Helvetica, sans-serif/.test(d)), 'sustituto de fuente anotado para desarrollo');
  // Estados visibles: propuestas y pendientes en nombres de capa.
  assert.ok(find(plan.desktop, 'Titulo_3 [PROPUESTA]'));
  assert.ok(find(plan.desktop, 'Footer_baja [PENDIENTE]'));
  assert.ok(find(plan.desktop, 'Logotipo'));
  assert.equal(plan.notes.proposedCopy.length, 6 - 1, 'el alt va a desarrollo, no como texto en el diseño');
  assert.ok(plan.notes.pending.some((p) => /#FALTA-URL/.test(p)));
  // Mismo contenido en ambas versiones.
  const texts = (ns: PNode[]) => { const out: string[] = []; walk(ns, (n) => { if (n.k === 'text') out.push(n.text); if (n.k === 'button') out.push(n.text.text); }); return out.sort(); };
  assert.deepEqual(texts(plan.desktop), texts(plan.mobile));
});

test('plan: comprobaciones previas bloquean contraste, tamaños y columnas que no suman', async () => {
  assert.deepEqual(columnWidths(536, 3, 24), [162, 162, 164]);
  assert.equal(columnWidths(335, 2, 24).reduce((a, b) => a + b, 0) + 24, 335);
  const ctx = await mutualidad();
  const b = confirmEmailBrief(BRIEF, ctx, 'Tester', 'ok');
  const ctx2 = clone(ctx); ctx2.email!.typography.roles.legal!.desktop = { sizePx: 10, lineHeightPx: 14 };
  const plan = buildEmailPlan(b, ctx2);
  assert.ok(plan.blockers.some((x) => /TEXT_TOO_SMALL|10px/.test(x)), plan.blockers.join('\n'));
});

// ---------- Script y simulación ----------

interface SNode { id: string; type: string; name: string; children: SNode[]; parent: SNode | null; [k: string]: any }
function fakeFigma(opts: { missing?: string[]; pageId?: string } = {}) {
  let next = 5000;
  const nodes = new Map<string, SNode>();
  const page = mk('PAGE', { id: opts.pageId ?? '0:1', name: 'Claude' });
  function mk(type: string, props: Record<string, unknown> = {}): SNode {
    const n: SNode = { id: `${next++}:1`, type, name: '', x: 0, y: 0, width: 100, height: 20, children: [], parent: null, fills: [], annotations: [], description: '', ...props };
    n.appendChild = (c: SNode) => { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); n.children.push(c); c.parent = n; };
    n.remove = () => { if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n); const rm = (x: SNode) => { nodes.delete(x.id); x.children.forEach(rm); }; rm(n); };
    n.resize = (w: number, h: number) => { n.width = w; n.height = h; };
    n.resizeWithoutConstraints = n.resize;
    n.rescale = (k: number) => { n.width *= k; n.height *= k; };
    n.findAll = (f: (x: SNode) => boolean) => { const out: SNode[] = []; const w = (x: SNode) => x.children.forEach((c) => { if (f(c)) out.push(c); w(c); }); w(n); return out; };
    n.createInstance = () => copy(n, null, 'INSTANCE');
    Object.defineProperty(n, 'absoluteBoundingBox', { get: () => ({ x: n.x, y: n.y, width: n.width, height: n.height }) });
    nodes.set(n.id, n);
    return n;
  }
  function copy(src: SNode, parent: SNode | null, type?: string): SNode {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) if (typeof v !== 'function' && !['id', 'type', 'parent', 'children'].includes(k)) data[k] = structuredClone(v);
    const c = mk(type ?? src.type, data);
    c.parent = parent;
    c.children = src.children.map((ch) => copy(ch, c));
    return c;
  }
  const loads: string[] = [];
  const figma = {
    getNodeByIdAsync: async (id: string) => (id === page.id ? page : nodes.get(id) ?? null),
    setCurrentPageAsync: async () => {},
    loadFontAsync: async (f: { family: string; style: string }) => { if (opts.missing?.includes(f.family)) throw new Error(`The font "${f.family} ${f.style}" could not be loaded`); loads.push(`${f.family} ${f.style}`); },
    createSection: () => mk('SECTION'),
    createAutoLayout: (dir: string) => mk('FRAME', { layoutMode: dir }),
    createFrame: () => mk('FRAME'),
    createText: () => mk('TEXT', { characters: '' }),
    createNodeFromSvg: () => mk('FRAME', { width: 200, height: 40 }),
    createComponentFromNode: (n: SNode) => { n.type = 'COMPONENT'; return n; },
    combineAsVariants: (ns: SNode[], parent: SNode) => { const s = mk('COMPONENT_SET'); parent.appendChild(s); ns.forEach((x) => s.appendChild(x)); return s; },
  };
  return { figma, page, nodes, loads };
}
async function run(code: string, f: ReturnType<typeof fakeFigma>): Promise<EmailResult> {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...a: unknown[]) => Promise<unknown>;
  return parseOrThrow(EmailResultSchema, await new AsyncFunction('figma', code)(f.figma), 'result');
}

async function mutualidadPlan(): Promise<EmailPlan> {
  const ctx = await mutualidad();
  return buildEmailPlan(confirmEmailBrief(BRIEF, ctx, 'Tester', 'ok'), ctx);
}

test('script: cabe en una llamada, sin operaciones prohibidas; se divide por partes si no cabe', async () => {
  const plan = await mutualidadPlan();
  const calls = splitEmailScript(plan);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.code.length < USE_FIGMA_MAX_CHARS);
  assert.deepEqual(staticEmailViolations(calls[0]!.code), []);
  assert.deepEqual(staticEmailViolations('node.remove();'), ['.remove(']);
  // Plan artificialmente grande (muchos módulos de texto) → varias llamadas.
  const big = clone(plan);
  for (let i = 0; i < 4; i++) { big.desktop.push(...clone(plan.desktop)); big.mobile.push(...clone(plan.mobile)); }
  const parts = splitEmailScript(big);
  assert.ok(parts.length > 1 && parts.every((c) => c.code.length <= USE_FIGMA_MAX_CHARS));
  const blocked = clone(plan); blocked.blockers = ['X'];
  assert.throws(() => buildEmailScript(blocked), /bloqueos/);
});

test('simulación: crea desktop, mobile, asunto, notas y componentes con variantes; email-check pasa', async () => {
  const plan = await mutualidadPlan();
  const f = fakeFigma();
  const r = await run(buildEmailScript(plan), f);
  assert.equal(r.status, 'created', r.error ?? '');
  assert.deepEqual(Object.keys(r.frames).sort(), ['components', 'desktop', 'mobile', 'notes', 'subject']);
  const section = f.page.children.find((n) => n.type === 'SECTION')!;
  const byX = [...section.children].sort((a, b) => a.x - b.x);
  assert.deepEqual(byX.map((n) => n.name.replace('Email_AreaPrivadaDemo_', '')), ['Desktop', 'Mobile', 'Asunto', 'Notas', 'Componentes'], 'Componentes al final');
  for (let i = 1; i < byX.length; i++) assert.ok(byX[i]!.x >= byX[i - 1]!.x + byX[i - 1]!.width, 'sin solapes');
  const sets = r.components.map((c) => c.name).sort();
  assert.deepEqual(sets, ['Email/Botón primario', 'Email/Cabecera', 'Email/Pie']);
  const comps = byX[4]!.findAll((n: SNode) => n.type === 'COMPONENT_SET');
  for (const s of comps) assert.deepEqual(s.children.map((c: SNode) => c.name).sort(), ['Breakpoint=Desktop', 'Breakpoint=Mobile']);
  const desktop = byX[0]!;
  assert.deepEqual(desktop.children.map((n) => `${n.name}:${n.type}`), ['header:INSTANCE', 'hero:FRAME', 'ventajas:FRAME', 'legales:FRAME', 'footer:INSTANCE']);
  assert.ok(r.annotations.ok > 10);
  assert.deepEqual(r.images.map((i) => i.placed), [false, false], 'hero desktop y mobile con placeholder');
  assert.ok(f.loads.includes('Arimo Bold') && !f.loads.some((x) => x.startsWith('Arial')));
  const rep = checkEmailResult(plan, r);
  assert.notEqual(rep.status, 'fail', JSON.stringify(rep.findings, null, 1));
  assert.equal(rep.stats.propuestos, 3, 'propuestos en el cuerpo del email (asunto y preheader aparte)');
  assert.ok(rep.stats.pendientes >= 4);
  // Un texto alterado después se detecta por hash.
  const tampered = clone(r); const t = tampered.audit.find((a) => a.name === 'Titular')!; t.sha = djb2('Otro titular');
  assert.equal(checkEmailResult(plan, tampered).status, 'fail');
});

test('simulación: reejecutar no duplica; fuente que falta no escribe nada; por partes = mismo resultado', async () => {
  const plan = await mutualidadPlan();
  const f = fakeFigma();
  await run(buildEmailScript(plan), f);
  const again = await run(buildEmailScript(plan), f);
  assert.equal(again.status, 'exists');
  assert.equal(f.page.children.length, 1);

  const g = fakeFigma({ missing: ['Arimo'] });
  await assert.rejects(run(buildEmailScript(plan), g), /PCB_FONT_UNAVAILABLE/);
  assert.equal(g.page.children.length, 0, 'nada creado');

  const h = fakeFigma();
  const rs = [];
  for (const parts of [['desktop'], ['mobile'], ['extras']] as const) rs.push(await run(buildEmailScript(plan, parts), h));
  const merged = mergeResults(rs);
  assert.equal(merged.status, 'created');
  assert.notEqual(checkEmailResult(plan, merged).status, 'fail');
  const sets = h.page.children[0]!.children.find((n) => n.name.endsWith('_Componentes'))!.findAll((n: SNode) => n.type === 'COMPONENT_SET');
  assert.equal(sets.length, 3, 'las variantes mobile se añaden a los conjuntos creados en la primera llamada');
});

test('simulación: si falla a mitad, borra solo lo creado en esa llamada', async () => {
  const plan = await mutualidadPlan();
  const f = fakeFigma();
  const keep = f.figma.createAutoLayout('VERTICAL'); keep.name = 'Diseño existente'; f.page.appendChild(keep);
  const orig = f.figma.createText;
  let n = 0;
  f.figma.createText = () => { if (++n === 12) throw new Error('boom'); return orig(); };
  const r = await run(buildEmailScript(plan), f);
  assert.equal(r.status, 'failed');
  assert.match(r.error!, /boom/);
  assert.deepEqual(f.page.children.map((x) => x.name), ['Diseño existente']);
});
