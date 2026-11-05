// Comandos email-template-* : email desde los bloques y plantillas del cliente + brief completo. Ninguno escribe en
// Figma: email-template-request genera el script que se envía tal cual con use_figma.
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseOrThrow } from '../contracts/schema.ts';
import { EMAIL_TEMPLATE_RESULT_SCHEMA_ID, EmailBlocksCatalogSchema, EmailTemplateBriefSchema, EmailTemplateResultSchema, type EmailBlocksCatalog, type EmailTemplateBrief } from '../contracts/email-template.ts';
import { clientPath, resolveKnowledgeRoot } from '../knowledge/store.ts';
import { extractEnvelope } from '../figma/ingest-envelope.ts';
import { buildTemplateFillScript, checkTemplateBrief, renderTemplateSummary, templateBriefHash, verifyTemplateResult } from './template.ts';

export const EMAIL_TEMPLATE_USAGE = `
  EMAIL DESDE BLOQUES Y PLANTILLAS DEL CLIENTE (catálogo: client-knowledge/clients/<slug>/channels/email-blocks.json):
  email-template-list --client SLUG [--root DIR]            Plantillas, bloques (fijos/variables) y opciones del cliente
  email-template-check --brief F [--root DIR] [--out F]     Composición, variantes, huecos sin copy, copys y enlaces
                 (0 = listo, 4 = faltan copys o confirmación, 2 = inválido)
  email-template-confirm --brief F --by NOMBRE --note TEXTO [--root DIR]   Registra la confirmación (tras el sí explícito)
  email-template-request --brief F [--root DIR] --out F    Script de ESCRITURA (instancias de los bloques + relleno)
  email-template-verify --brief F --result F [--root DIR] [--out F]   Comprueba la auditoría devuelta por el script`;

const opts = { brief: { type: 'string' }, client: { type: 'string' }, root: { type: 'string' }, out: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' }, result: { type: 'string' } } as const;
const need = (v: string | undefined, n: string) => { if (!v) throw new Error(`Falta --${n}\n${EMAIL_TEMPLATE_USAGE}`); return v; };
const readJson = async (p: string): Promise<unknown> => JSON.parse(await readFile(p, 'utf8'));

async function loadCatalog(slug: string, root?: string): Promise<EmailBlocksCatalog> {
  const r = resolveKnowledgeRoot(root);
  return parseOrThrow(EmailBlocksCatalogSchema, await readJson(clientPath(r, slug, 'channels/email-blocks.json')), `clients/${slug}/channels/email-blocks.json`);
}

export async function runEmailTemplateCommand(cmd: string, argv: string[]): Promise<number> {
  const { values: a } = parseArgs({ args: argv, options: opts, strict: true });
  if (cmd === 'email-template-list') {
    const cat = await loadCatalog(need(a.client, 'client'), a.root);
    console.log(`Plantillas de ${cat.client} (${cat.status}, v${cat.version}):`);
    for (const t of cat.templates) console.log(`- ${t.key}: ${t.blocks.map((b) => b.block.replace(/^[A-Z]+\//, '')).join(' → ')}`);
    console.log('\nBloques:');
    for (const b of cat.blocks) console.log(`- [${b.kind === 'fixed' ? 'FIJO' : 'VAR '}] ${b.name}${b.type === 'COMPONENT_SET' ? ` (${b.variants.map((v) => v.name).join(' | ')})` : ''}${b.variants[0]!.slots.length ? ` · huecos: ${b.variants[0]!.slots.map((s) => s.id).join(', ')}` : ''}`);
    console.log(`\nIdiomas: ${cat.options.idioma.join(', ')} · Canales: ${Object.keys(cat.options.canal).join(', ')} · Legal: ${cat.options.legal.join(' | ')}`);
    return 0;
  }
  const briefPath = need(a.brief, 'brief');
  const b = parseOrThrow(EmailTemplateBriefSchema, await readJson(briefPath), 'brief') as EmailTemplateBrief;
  const cat = await loadCatalog(b.client, a.root);
  const chk = checkTemplateBrief(b, cat);
  switch (cmd) {
    case 'email-template-check': {
      const md = renderTemplateSummary(b, cat, chk);
      if (a.out) await writeFile(a.out, md, 'utf8');
      console.log(md);
      return chk.issues.some((i) => i.severity === 'blocking') ? 2 : chk.ready ? 0 : 4;
    }
    case 'email-template-confirm': {
      const stop = chk.issues.filter((i) => i.severity === 'blocking' || (i.severity === 'pending' && !['BRIEF_NOT_CONFIRMED', 'BRIEF_CHANGED'].includes(i.code)));
      if (stop.length) throw new Error(`No se puede confirmar todavía:\n${stop.map((i) => `- ${i.message}`).join('\n')}`);
      const next = { ...b, confirmation: { by: need(a.by, 'by'), at: new Date().toISOString(), note: need(a.note, 'note'), hash: templateBriefHash(b) } };
      await writeFile(briefPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      console.log(`✓ Brief confirmado por ${a.by}`);
      return 0;
    }
    case 'email-template-request': {
      if (!chk.ready) { for (const i of chk.issues.filter((x) => x.severity !== 'warning')) console.error(`✗ ${i.message}`); return 4; }
      const code = buildTemplateFillScript(b, cat, chk.blocks);
      await writeFile(need(a.out, 'out'), `${JSON.stringify({ tool: 'use_figma', fileKey: b.figma.fileKey, description: `email-template ${b.name}: crea el email con instancias de los bloques de ${b.client} en «${b.figma.sectionName}» (solo nodos nuevos)`, chars: code.length, code }, null, 2)}\n`, 'utf8');
      console.log(`✓ ${a.out} (${code.length} caracteres)`);
      return 0;
    }
    case 'email-template-verify': {
      const ext = extractEnvelope(await readFile(need(a.result, 'result'), 'utf8'), EMAIL_TEMPLATE_RESULT_SCHEMA_ID);
      if ('code' in ext) throw new Error(ext.message);
      const r = parseOrThrow(EmailTemplateResultSchema, ext.value, 'result');
      const v = verifyTemplateResult(b, chk.blocks, r);
      const lines = [`# Verificación ${b.name}: ${v.status}`, '', ...(v.findings.length ? v.findings.map((f) => `- ${f.severity === 'blocking' ? '⛔' : 'ℹ'} ${f.code}: ${f.message}`) : ['- ✓ Todos los huecos del brief rellenos con su texto exacto; visibilidad según canal; sin textos de ejemplo.']), '', `Bloques: ${r.blocks.length} (ocultos: ${r.blocks.filter((x) => !x.visible).map((x) => x.name).join(', ') || 'ninguno'}) · huecos: ${r.slots.length} · anotaciones: ${r.annotations}`, ''];
      if (a.out) await writeFile(a.out, lines.join('\n'), 'utf8');
      console.log(lines.join('\n'));
      return v.status === 'fail' ? 2 : 0;
    }
    default: console.error(EMAIL_TEMPLATE_USAGE); return 2;
  }
}
