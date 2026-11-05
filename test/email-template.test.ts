// Emails desde bloques y plantillas del cliente (email-template-*). Usa el catálogo REAL de AXA en client-knowledge/
// y los briefs/resultados de la prueba en Figma del 2026-11-05 (email «nuevo buscador médico», canales axa y directo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkClient, clientPath, figmaNodeUrl, loadContext } from '../src/knowledge/store.ts';
import { parseOrThrow } from '../src/contracts/schema.ts';
import { extractEnvelope } from '../src/figma/ingest-envelope.ts';
import { EMAIL_TEMPLATE_RESULT_SCHEMA_ID, EmailBlocksCatalogSchema, EmailTemplateBriefSchema, EmailTemplateResultSchema, type EmailTemplateBrief, type EmailTemplateResult } from '../src/contracts/email-template.ts';
import { BLOCK_PLACEHOLDERS, TEMPLATE_FORBIDDEN, buildTemplateFillScript, checkTemplateBrief, parseBold, templateBriefHash, verifyTemplateResult } from '../src/email/template.ts';

const ROOT = resolve(import.meta.dirname, '..', 'client-knowledge');
const FIX = join(import.meta.dirname, 'fixtures', 'email');
const CAT = parseOrThrow(EmailBlocksCatalogSchema, JSON.parse(readFileSync(clientPath(ROOT, 'axa', 'channels/email-blocks.json'), 'utf8')), 'catalog');
const brief = (f: string): EmailTemplateBrief => parseOrThrow(EmailTemplateBriefSchema, JSON.parse(readFileSync(join(FIX, f), 'utf8')), f) as EmailTemplateBrief;
const result = (f: string): EmailTemplateResult => {
  const ext = extractEnvelope(readFileSync(join(FIX, f), 'utf8'), EMAIL_TEMPLATE_RESULT_SCHEMA_ID);
  if ('code' in ext) throw new Error(ext.message);
  return parseOrThrow(EmailTemplateResultSchema, ext.value, f);
};
const AXA = brief('axa-buscador.brief.json');
const DIRECTO = brief('axa-buscador-directo.brief.json');
const codes = (b: EmailTemplateBrief) => checkTemplateBrief(b, CAT).issues.map((i) => `${i.severity}:${i.code}`);
/** Copia sin confirmación (para probar reglas sin que salte BRIEF_CHANGED). */
const draft = (b: EmailTemplateBrief): EmailTemplateBrief => ({ ...structuredClone(b), confirmation: null });

test('catálogo AXA: válido, registrado en el índice y comprobado por knowledge-check (sin brand.json todavía)', async () => {
  assert.equal(CAT.client, 'axa');
  assert.equal(CAT.status, 'draft');
  assert.ok(CAT.blocks.length >= 30 && CAT.templates.length === 6);
  for (const t of CAT.templates) for (const s of t.blocks) assert.ok(CAT.blocks.some((b) => b.name === s.block), `${t.key}: ${s.block}`);
  const { issues, index } = await checkClient(ROOT, 'axa');
  assert.ok(index.files.some((f) => f.path === 'channels/email-blocks.json'));
  assert.ok(!issues.some((i) => i.code.startsWith('EMAIL_BLOCKS_')), JSON.stringify(issues));
  assert.ok(issues.some((i) => i.code === 'NO_BRAND'), 'AXA no tiene brand kit: debe constar');
});

test('brief confirmado (canal axa): listo, mediador AXA visible y variantes según idioma y legal', () => {
  const chk = checkTemplateBrief(AXA, CAT);
  assert.equal(chk.ready, true, JSON.stringify(chk.issues));
  const med = chk.blocks.find((b) => b.name === 'AXA/Fijo/Mediador')!;
  assert.equal(med.visible, true);
  assert.equal(med.variant, 'Canal=AXA, Idioma=CAST');
  assert.equal(chk.blocks.find((b) => b.name === 'AXA/Legal')!.variant, `Entidad=${AXA.legal}`);
});

test('canal directo oculta el mediador; RACC solo existe en castellano', () => {
  const chk = checkTemplateBrief(DIRECTO, CAT);
  assert.equal(chk.ready, true, JSON.stringify(chk.issues));
  assert.equal(chk.blocks.find((b) => b.name === 'AXA/Fijo/Mediador')!.visible, false);
  const racc = { ...draft(AXA), canal: 'racc', idioma: 'CAT' as const };
  assert.ok(codes(racc).includes('blocking:CANAL_IDIOMA'));
  assert.equal(checkTemplateBrief({ ...draft(AXA), canal: 'racc' }, CAT).blocks.find((b) => b.name === 'AXA/Fijo/Mediador')!.variant, 'Canal=RACC, Idioma=CAST');
});

test('composición y contenido: plantilla, bloque, hueco o posición inexistentes bloquean', () => {
  assert.ok(codes({ ...draft(AXA), composition: { template: 'no-existe' } }).includes('blocking:TEMPLATE_UNKNOWN'));
  const b = draft(AXA);
  b.content[0]!.slots['inventado_9'] = 'x';
  assert.ok(codes(b).includes('blocking:SLOT_UNKNOWN'));
  const c = draft(AXA);
  c.content[0]!.at = 2;
  assert.ok(codes(c).includes('blocking:CONTENT_BLOCK_MISMATCH'));
  const d = draft(AXA);
  d.content.push({ ...structuredClone(d.content[0]!), at: 40 });
  assert.ok(codes(d).includes('blocking:CONTENT_AT_UNKNOWN'));
  assert.ok(codes({ ...draft(AXA), legal: 'Otra entidad' }).includes('blocking:LEGAL_UNKNOWN'));
});

test('copys: el texto de ejemplo del bloque bloquea; los placeholders deben ir marcados y se listan', () => {
  const b = draft(AXA);
  b.content[0]!.slots.titulo_1 = BLOCK_PLACEHOLDERS[0]!;
  assert.ok(codes(b).includes('blocking:COPY_IS_BLOCK_PLACEHOLDER'));
  const c = draft(AXA);
  c.content[0]!.slots.titulo_1 = { text: 'Un título', source: 'placeholder', note: null };
  assert.ok(codes(c).includes('blocking:PLACEHOLDER_NOT_MARKED'));
  const d = draft(AXA);
  d.content[0]!.slots.titulo_1 = { text: '[PENDIENTE: título]', source: 'placeholder', note: null };
  const chk = checkTemplateBrief(d, CAT);
  const ph = chk.issues.find((i) => i.code === 'PLACEHOLDERS');
  assert.equal(ph?.severity, 'warning');
  assert.match(ph!.message, /titulo_1@0/);
});

test('huecos sin copy, cambios tras confirmar y cierre personalizado', () => {
  const b = draft(AXA);
  delete b.content[2]!.slots.cta_1;
  const cs = codes(b);
  assert.ok(cs.includes('pending:SLOT_EMPTY') && cs.includes('pending:BRIEF_NOT_CONFIRMED'));
  const changed = structuredClone(AXA);
  changed.subject = { ...changed.subject, text: `${changed.subject.text} (cambiado)` };
  assert.ok(codes(changed).includes('pending:BRIEF_CHANGED'));
  assert.notEqual(templateBriefHash(changed), AXA.confirmation!.hash);
  // Cierre con texto propio → variante «Personalizado» (por contenido o elegida en la composición).
  const tpl = CAT.templates.find((t) => t.key === 'informativo-servicio')!;
  const atCierre = tpl.blocks.findIndex((x) => x.block === 'AXA/Fijo/Cierre');
  const own = draft(AXA);
  own.composition = { blocks: tpl.blocks.map((x, i) => (i === atCierre ? { block: x.block, variant: 'Idioma=Personalizado' } : x)) };
  const chk = checkTemplateBrief(own, CAT);
  assert.equal(chk.blocks[atCierre]!.variant, 'Idioma=Personalizado');
  assert.ok(chk.issues.some((i) => i.code === 'SLOT_EMPTY' && i.message.includes('texto_1')));
});

test('parseBold: quita los ** y devuelve los rangos en negrita', () => {
  assert.deepEqual(parseBold('Hola **mundo** y **más**'), { text: 'Hola mundo y más', bold: [[5, 10], [13, 16]] });
  assert.deepEqual(parseBold('sin marcas'), { text: 'sin marcas', bold: [] });
});

test('script de relleno: sintaxis válida, sin APIs prohibidas, cabe en use_figma y lleva los textos del brief', () => {
  const chk = checkTemplateBrief(AXA, CAT);
  const code = buildTemplateFillScript(AXA, CAT, chk.blocks);
  assert.ok(code.length < 50_000, `${code.length} caracteres`);
  for (const f of TEMPLATE_FORBIDDEN) assert.ok(!code.includes(f), f);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => unknown;
  assert.doesNotThrow(() => new AsyncFunction('figma', code));
  assert.ok(code.includes(JSON.stringify(parseBold((AXA.content[0]!.slots.titulo_1 as { text: string }).text ?? AXA.content[0]!.slots.titulo_1).text).slice(1, -1)));
});

test('verificación con las auditorías reales de Figma: pasan; texto alterado o visibilidad errónea fallan', () => {
  for (const [b, f] of [[AXA, 'axa-buscador.result.txt'], [DIRECTO, 'axa-buscador-directo.result.txt']] as const) {
    const chk = checkTemplateBrief(b, CAT);
    assert.equal(verifyTemplateResult(b, chk.blocks, result(f)).status, 'pass', f);
  }
  const chk = checkTemplateBrief(AXA, CAT);
  const r = result('axa-buscador.result.txt');
  const altered = structuredClone(r);
  altered.slots[0]!.sha = 'x';
  assert.ok(verifyTemplateResult(AXA, chk.blocks, altered).findings.some((x) => x.code === 'SLOT_TEXT_ALTERED'));
  const hidden = structuredClone(r);
  hidden.blocks.find((x) => x.name === 'AXA/Fijo/Mediador')!.visible = false;
  assert.ok(verifyTemplateResult(AXA, chk.blocks, hidden).findings.some((x) => x.code === 'VISIBILITY'));
  const left = structuredClone(r);
  left.placeholdersLeft.push({ at: 2, slot: 'texto_1', text: BLOCK_PLACEHOLDERS[1]! });
  assert.equal(verifyTemplateResult(AXA, chk.blocks, left).status, 'fail');
});

test('knowledge-context: AXA expone sus plantillas con el frame de Figma (modo plantillas); otro cliente no', async () => {
  const ctx = await loadContext(ROOT, 'axa', 'email');
  const eb = ctx.emailBlocks!;
  assert.ok(eb, 'emailBlocks');
  assert.equal(eb.figma.fileKey, CAT.figma.fileKey);
  assert.deepEqual(eb.templates.map((t) => [t.key, t.nodeId]), CAT.templates.map((t) => [t.key, t.figmaId]));
  assert.equal(eb.templates[0]!.url, figmaNodeUrl(CAT.figma.fileKey, CAT.templates[0]!.figmaId));
  assert.match(eb.templates[0]!.url, /node-id=\d+-\d+$/);
  assert.equal(eb.blocks.fixed + eb.blocks.variable, CAT.blocks.length);
  assert.match(ctx.issues.find((i) => i.code === 'NO_BRAND')!.message, /modo plantillas/);
  assert.equal((await loadContext(ROOT, 'mutualidad', 'email')).emailBlocks, null);
});

test('miniaturas en el conocimiento del cliente y compositor generado desde el catálogo', () => {
  const dir = clientPath(ROOT, 'axa', CAT.thumbsDir!);
  const missing = CAT.blocks.flatMap((b) => b.variants.map((v) => v.componentId)).filter((id) => !existsSync(join(dir, `${id.replace(':', '_')}.jpg`)));
  assert.deepEqual(missing, []);
  const py = spawnSync('python3', ['--version']);
  if (py.status !== 0) return; // sin Python no se prueba el generador
  const out = mkdtempSync(join(tmpdir(), 'pcb-composer-'));
  try {
    const r = spawnSync('python3', [join(import.meta.dirname, '..', 'scripts', 'email-composer.py'), '--catalog', clientPath(ROOT, 'axa', 'channels/email-blocks.json'), '--out', join(out, 'c.html')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(out, 'c.html'), 'utf8');
    assert.ok(!html.includes('/*__CATALOG__*/null') && !html.includes('/*__THUMBS__*/null'));
    assert.equal((html.match(/data:image\/jpeg;base64,/g) ?? []).length, CAT.blocks.reduce((n, b) => n + b.variants.length, 0));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
