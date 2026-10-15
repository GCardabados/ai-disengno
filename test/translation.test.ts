// MOCK: modo traducción de creative-content-variants — extracción etiquetada, tabla, confirmación de la persona,
// fallback de fuente autorizado y conversión en encargo de variantes. Maestras sintéticas; nada es una lectura real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranslationExtractScript } from '../src/figma/translation-script.ts';
import { TranslationExtractSchema, TranslationSchema, type Translation, type TranslationExtract } from '../src/contracts/translation.ts';
import { authorizeFontFallback, buildTranslationJob, buildTranslationTable, checkTranslation, confirmTranslation, renderTranslationReport, renderTranslationTable } from '../src/variants/translation.ts';
import { parseTextPolicy } from '../src/variants/translation-cli.ts';
import { checkVariantJob } from '../src/variants/job.ts';
import { buildVariantPlan } from '../src/variants/plan.ts';
import { checkVariant } from '../src/variants/check.ts';
import { buildVariantScript } from '../src/figma/variant-script.ts';
import { mapSpec, universityMasterSpec, MOCK_FILE_KEY } from '../src/figma/mock/fixtures.ts';
import type { MockNodeSpec } from '../src/figma/mock/fake-figma.ts';
import { parseOrThrow } from '../src/contracts/schema.ts';
import { snap } from './helpers.ts';

const USER = { by: 'user' as const, at: '2026-10-15T10:00:00.000Z', note: 'MOCK: «sí, adelante»' };
const MASTER = universityMasterSpec();
/** Adaptación MOCK 1200×628 con los mismos textos (otros ids) y uno propio. */
function adaptationSpec(): MockNodeSpec {
  const re = (n: MockNodeSpec): MockNodeSpec => ({ ...n, id: n.id.replace(/^70:/, '75:'), children: n.children?.map(re) });
  const a = re(structuredClone(MASTER));
  return { ...a, name: 'UNI_Grados_1200x628', x: 1500, children: [...a.children!, { id: '75:99', type: 'TEXT', name: 'Text 9', x: 700, y: 60, width: 300, height: 40, fills: [], text: { characters: 'Solo online', fontSize: 24 } }] };
}

/** `figma` mínimo de SOLO LECTURA para el script de extracción; registra cualquier intento de escritura. */
function extractFake(roots: MockNodeSpec[], missing: string[] = []) {
  const writes: string[] = [];
  const all = new Map<string, Record<string, unknown>>();
  const build = (s: MockNodeSpec, parent: Record<string, unknown> | null, ox: number, oy: number): Record<string, unknown> => {
    const x = ox + (s.x ?? 0), y = oy + (s.y ?? 0);
    const n: Record<string, unknown> = { id: s.id, type: s.type, name: s.name, visible: s.visible ?? true, parent, width: s.width, height: s.height, absoluteTransform: [[1, 0, x], [0, 1, y]] };
    if (s.type === 'TEXT') {
      const tx = s.text!;
      n.characters = tx.characters;
      n.getStyledTextSegments = () => (tx.segments ?? [{ end: tx.characters.length }]).map((r, i, arr) => {
        const start = i ? arr[i - 1]!.end : 0;
        return { start, end: r.end, characters: tx.characters.slice(start, r.end), fontName: { family: tx.fontFamily ?? 'Inter', style: r.fontStyle ?? tx.fontStyle ?? 'Regular' } };
      });
    }
    n.children = (s.children ?? []).map((c) => build(c, n, x, y));
    n.findAll = () => { const out: unknown[] = []; const w = (m: Record<string, unknown>) => (m.children as Record<string, unknown>[]).forEach((c) => { out.push(c); w(c); }); w(n); return out; };
    n.findAllWithCriteria = (q: { types: string[] }) => (n.findAll as () => Record<string, unknown>[])().filter((c) => q.types.includes(c.type as string));
    all.set(s.id, n);
    return new Proxy(n, { set: (_t, p) => { writes.push(`set ${String(p)} ${s.id}`); return true; } });
  };
  const nodes = roots.map((r) => build(r, null, 0, 0));
  const section = { id: '90:1', type: 'SECTION', name: 'Adaptaciones', children: nodes.slice(1), findAll: () => [] };
  all.set('90:1', section);
  const figma = {
    getNodeByIdAsync: async (id: string) => all.get(id) ?? null,
    loadFontAsync: async (f: { family: string; style: string }) => { if (missing.includes(`${f.family}|${f.style}`)) throw new Error(`MOCK: ${f.style} not available`); },
  };
  const run = async (code: string): Promise<TranslationExtract> => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (f: unknown) => Promise<unknown>;
    return parseOrThrow(TranslationExtractSchema, await new AsyncFunction('figma', code)(figma), 'extract');
  };
  return { run, writes };
}

async function table(missing = ['Inter|Bold']): Promise<Translation> {
  const f = extractFake([MASTER, adaptationSpec()], missing);
  const x = await f.run(buildTranslationExtractScript('70:1', ['90:1']));
  assert.deepEqual(f.writes, [], 'la extracción no escribe nada');
  return buildTranslationTable(x, { fileKey: MOCK_FILE_KEY, sourceLang: 'ES', langs: ['en'] });
}

/** Traducciones tal como las rellenaría el agente tras la conversación (MOCK). */
function filled(tr: Translation): Translation {
  const t = tr.targets[0]!;
  const v = (text: string | null, o: Partial<{ parts: string[]; keep: boolean; note: string }> = {}) => ({ text, parts: o.parts ?? null, keep: o.keep ?? false, note: o.note ?? null });
  return {
    ...tr,
    entries: tr.entries.map((e) => (e.n === 5 ? { ...e, isLegal: true } : e)),
    targets: [{
      ...t,
      typography: ['Aplicadas las normas ortotipográficas de en sin cambios de ancho (comillas, apóstrofos).'],
      values: {
        t1: v(null, { parts: ['Study ', 'Law in Madrid'] }),
        t2: v('Official degree with internships from first year.'),
        t3: v('Learn more'),
        t4: v(null, { keep: true }),
        t5: v('Limited places at the Madrid campus. Terms apply.'),
        t6: v('Online only'),
      },
    }],
  };
}
const ready = (tr: Translation) => confirmTranslation(filled(tr), 'EN', USER);

test('MOCK: la extracción etiqueta cada texto único una vez, en orden de lectura, con sus apariciones y fuentes', async () => {
  const tr = await table();
  assert.deepEqual(tr.entries.map((e) => [e.id, e.text, e.occurrences.length, e.extra]), [
    ['t1', 'Estudia Derecho en Madrid', 2, false],
    ['t2', 'Grado oficial con prácticas desde primer curso.', 2, false],
    ['t3', 'Infórmate', 2, false],
    ['t4', 'universidad.example/derecho', 2, false],
    ['t5', 'Plazas limitadas en el campus de Madrid. Consulta condiciones.', 2, false],
    ['t6', 'Solo online', 1, true],
  ]);
  assert.deepEqual(tr.entries[0]!.segments, ['Estudia ', 'Derecho en Madrid'], 'estilos mixtos');
  assert.deepEqual(tr.frames.map((f) => f.nodeId), ['70:1', '75:1']);
  assert.deepEqual(tr.fonts.find((f) => f.style === 'Bold'), { family: 'Inter', style: 'Bold', loadable: false, usedIn: ['t1'] });
  parseOrThrow(TranslationSchema, tr, 'translation');
  const md = renderTranslationTable(tr, checkTranslation(tr));
  assert.match(md, /Texto 1 · Text 1: Estudia Derecho en Madrid {2}\[2 estilos/);
  assert.match(md, /Text 3 · Text 3: ⚠ /, 'el bloque destino usa la etiqueta del idioma');
});

test('MOCK: sin traducciones, reparto de estilos ni confirmación, la tabla no está lista y no se puede confirmar', async () => {
  const tr = await table();
  const chk = checkTranslation(tr);
  assert.deepEqual(chk.readyLangs, []);
  assert.ok(chk.issues.some((i) => i.code === 'VALUE_MISSING'));
  assert.ok(chk.issues.some((i) => i.code === 'FONT_UNAVAILABLE' && /Inter Bold/.test(i.message)));
  assert.throws(() => confirmTranslation(tr, 'EN', USER), /no está completa/);
  const whole = filled(tr);
  whole.targets[0]!.values.t1 = { text: 'Study Law in Madrid', parts: null, keep: false, note: null };
  assert.ok(checkTranslation(whole).issues.some((i) => i.code === 'MIXED_STYLES_UNMAPPED'), 'pregunta qué parte lleva cada estilo');
  assert.throws(() => confirmTranslation(filled(tr), 'EN', { ...USER, by: 'project_config' as never }), /solo la confirma la persona/);
});

test('MOCK: la confirmación queda ligada por hash; cambiar un texto después exige confirmar otra vez', async () => {
  const tr = ready(await table([]));
  assert.deepEqual(checkTranslation(tr).readyLangs, ['EN']);
  const changed = structuredClone(tr);
  changed.targets[0]!.values.t3!.text = 'Find out more';
  const chk = checkTranslation(changed);
  assert.deepEqual(chk.readyLangs, []);
  assert.ok(chk.issues.some((i) => i.code === 'COPY_CHANGED_AFTER_CONFIRMATION'));
  const warn = checkTranslation(tr).issues.filter((i) => i.severity === 'warning').map((i) => i.code);
  assert.ok(warn.includes('LEGAL_PENDING_VALIDATION'));
});

test('MOCK: una fuente que no carga exige autorización de la persona para la sustituta; nunca se sustituye una disponible', async () => {
  const tr = ready(await table());
  assert.ok(checkTranslation(tr).issues.some((i) => i.code === 'FONT_UNAVAILABLE'));
  assert.throws(() => authorizeFontFallback(tr, 'EN', { family: 'Inter', style: 'Regular' }, { family: 'Roboto', style: 'Regular' }, USER), /se puede cargar/);
  assert.throws(() => authorizeFontFallback(tr, 'EN', { family: 'Inter', style: 'Bold' }, { family: 'Roboto', style: 'Bold' }, { ...USER, by: 'project_config' }), /solo la autoriza la persona/);
  const ok = authorizeFontFallback(tr, 'EN', { family: 'Inter', style: 'Bold' }, { family: 'Inter', style: 'Black' }, USER);
  const chk = checkTranslation(ok);
  assert.deepEqual(chk.readyLangs, ['EN']);
  assert.ok(chk.issues.some((i) => i.code === 'FONT_FALLBACK_AUTHORIZED' && i.severity === 'warning'));
  assert.match(renderTranslationReport(ok), /Pendiente de fuente: Inter Black en lugar de Inter Bold/);
});

test('MOCK: la tabla confirmada se convierte en un encargo de variantes por pieza (vinculado por nodeId) listo para producir', async () => {
  const tr = ready(await table([]));
  const s = await snap(MASTER);
  const job = buildTranslationJob(tr, s, ['EN'], { textPolicy: { mode: 'strict' }, logoNodeIds: ['70:4'] });
  assert.deepEqual(job.fields.map((f) => [f.fieldId, f.nodeId, f.styleMapping]), [['t1', '70:7', 'segments'], ['t2', '70:8', 'whole'], ['t3', '70:10', 'whole'], ['t5', '70:12', 'whole']]);
  assert.equal(job.fields.find((f) => f.fieldId === 't5')!.isLegal, true);
  assert.deepEqual(job.kept[0]!.nodeIds, ['70:11'], 'la URL marcada como no traducible se mantiene');
  assert.deepEqual(job.variants[0]!.values.t1, { kind: 'text', text: null, parts: ['Study ', 'Law in Madrid'], display: null, source: 'user_provided' });
  const chk = checkVariantJob(job, s);
  assert.equal(chk.ready, true, JSON.stringify(chk.issues));
  const { plan } = buildVariantPlan(job, s, null);
  assert.equal(plan.variants[0]!.cloneName, 'UNI_Grados_1080x1080_EN');
  assert.equal(plan.sectionName, 'PCB · Traducciones');
  // La adaptación usa sus propios nodos e incluye su texto propio.
  const sa = await snap(adaptationSpec());
  const ja = buildTranslationJob(tr, sa, ['EN'], { textPolicy: parseTextPolicy('fit:0.9') });
  assert.deepEqual(ja.fields.map((f) => f.nodeId), ['75:7', '75:8', '75:10', '75:12', '75:99']);
  assert.equal(ja.fields[0]!.textPolicy!.mode, 'fit_text');
  assert.equal(checkVariantJob(ja, sa).ready, true, JSON.stringify(checkVariantJob(ja, sa).issues));
});

test('MOCK: sin tabla confirmada, con una pieza ajena o con la pieza cambiada, no se genera el encargo', async () => {
  const s = await snap(MASTER);
  const unconfirmed = filled(await table([]));
  assert.throws(() => buildTranslationJob(unconfirmed, s, ['EN'], { textPolicy: { mode: 'strict' } }), /sin confirmar/);
  const tr = ready(await table([]));
  const other = await snap({ ...MASTER, id: '99:1', children: [] });
  assert.throws(() => buildTranslationJob(tr, other, ['EN'], { textPolicy: { mode: 'strict' } }), /no es una de las piezas/);
  const edited = await snap(mapSpec(structuredClone(MASTER), '70:8', (n) => ({ ...n, text: { ...n.text!, characters: 'Otro cuerpo' } })));
  assert.throws(() => buildTranslationJob(tr, edited, ['EN'], { textPolicy: { mode: 'strict' } }), /ya no dice/);
});

test('MOCK: con la fuente ausente, el encargo solo sale adelante con la sustituta autorizada y la validación exige el sufijo', async () => {
  const tr0 = ready(await table());
  const s = await snap(mapSpec(structuredClone(MASTER), '70:7', (n) => ({ ...n, text: { ...n.text!, hasMissingFont: true } })));
  const blocked = buildTranslationJob(tr0, s, ['EN'], { textPolicy: { mode: 'strict' } });
  assert.ok(checkVariantJob(blocked, s).issues.some((i) => i.code === 'FONT_UNAVAILABLE' && i.severity === 'blocking'));
  const tr = authorizeFontFallback(tr0, 'EN', { family: 'Inter', style: 'Bold' }, { family: 'Inter', style: 'Black' }, USER);
  const job = buildTranslationJob(tr, s, ['EN'], { textPolicy: { mode: 'strict' } });
  const chk = checkVariantJob(job, s);
  assert.equal(chk.ready, true, JSON.stringify(chk.issues));
  const { plan } = buildVariantPlan(job, s, null);
  const op = plan.variants[0]!.ops.find((o) => o.nodeId === '70:7')!;
  assert.deepEqual(op.kind === 'text' && op.fontFallbacks, [{ from: { family: 'Inter', style: 'Bold' }, to: { family: 'Inter', style: 'Black' } }]);
  assert.match(buildVariantScript(plan), /setRangeFontName/, 'el script lleva la sustitución en su línea permitida');

  // Relectura MOCK del clon: titular con la sustituta en el tramo en negrita.
  const cloneOf = (name: string): MockNodeSpec => {
    let c = structuredClone(MASTER);
    const T: Record<string, string> = { '70:8': 'Official degree with internships from first year.', '70:10': 'Learn more', '70:12': 'Limited places at the Madrid campus. Terms apply.' };
    for (const [id, text] of Object.entries(T)) c = mapSpec(c, id, (n) => ({ ...n, text: { ...n.text!, characters: text } }));
    c = mapSpec(c, '70:7', (n) => ({ ...n, text: { ...n.text!, characters: 'Study Law in Madrid', segments: [{ end: 6, fontStyle: 'Regular' }, { end: 19, fontStyle: 'Black' }] } }));
    const re = (n: MockNodeSpec): MockNodeSpec => ({ ...n, id: n.id.replace(/^70:/, '71:'), children: n.children?.map(re) });
    return { ...re(c), name, x: 1500 };
  };
  const master = await snap(MASTER);
  const run = async (name: string) => checkVariant({ master, clone: await snap(cloneOf(name)), plan, entry: plan.variants[0]!, tolerancePx: 0.5, masterDigestsEqual: true, visual: null });
  const ok = await run('UNI_Grados_1080x1080_EN_PENDIENTE-FUENTE');
  const auth = ok.results.find((r) => r.validatorId === 'authorized_changes_only')!;
  assert.equal(auth.status, 'needs_review', JSON.stringify(auth.findings));
  assert.deepEqual(auth.findings.map((f) => f.code), ['FONT_FALLBACK_USED']);
  const bad = await run('UNI_Grados_1080x1080_EN');
  assert.ok(bad.results.find((r) => r.validatorId === 'authorized_changes_only')!.findings.some((f) => f.code === 'PENDING_FONT_NOT_MARKED'));
});

test('MOCK: --text-policy', () => {
  assert.deepEqual(parseTextPolicy(undefined), { mode: 'strict' });
  assert.deepEqual(parseTextPolicy('reflow:120px'), { mode: 'reflow', maxHeightPx: 120 });
  assert.deepEqual(parseTextPolicy('fit:0.85'), { mode: 'fit_text', minScale: 0.85, authorization: null });
  assert.throws(() => parseTextPolicy('shrink'), /desconocida/);
});
