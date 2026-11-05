// Comandos knowledge-* : consulta y mantenimiento del conocimiento compartido de clientes (client-knowledge/).
// Ninguno modifica el conocimiento salvo knowledge-validate (a petición explícita de una persona) y knowledge-propose
// (que solo escribe en la cuarentena proposals/ del cliente).
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseOrThrow } from '../contracts/schema.ts';
import { KnowledgeProposalSchema } from '../contracts/knowledge.ts';
import { checkClient, identifyClient, listClients, loadContext, resolveKnowledgeRoot, validateFile, writeProposal, type KnowledgeIssue } from './store.ts';

export const KNOWLEDGE_USAGE = `
  CONOCIMIENTO DE CLIENTES (client-knowledge/, compartido por todas las skills; raíz: --root o CLIENT_KNOWLEDGE_ROOT):
  knowledge-list [--root DIR] [--find TEXTO]             Clientes dados de alta (o los que encajan con un texto del brief)
  knowledge-check --client SLUG [--root DIR]             Índice, esquemas, aislamiento, marca ↔ canal, pendientes
                 (0 = listo, 4 = pendientes, 2 = inválido)
  knowledge-context --client SLUG --channel email|paid [--root DIR] --out F
                 Carga SOLO lo de ese cliente y canal (+ versiones y SHA-256) y anuncia la documentación bajo demanda
  knowledge-propose --proposal F [--root DIR]            Guarda una propuesta de cambio en clients/<slug>/proposals/ (no la aplica)
  knowledge-validate --client SLUG --file ID --by NOMBRE --note TEXTO [--root DIR]
                 Marca un archivo como validado (SOLO tras el sí explícito de la persona; sin pendientes)`;

const opts = {
  root: { type: 'string' }, client: { type: 'string' }, channel: { type: 'string' }, out: { type: 'string' },
  find: { type: 'string' }, proposal: { type: 'string' }, file: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' },
} as const;

const need = (v: string | undefined, name: string): string => { if (!v) throw new Error(`Falta --${name}\n${KNOWLEDGE_USAGE}`); return v; };
const icon = (s: KnowledgeIssue['severity']) => (s === 'blocking' ? '⛔' : s === 'pending' ? '❓' : 'ℹ');
const exitFor = (issues: KnowledgeIssue[]) => (issues.some((i) => i.severity === 'blocking') ? 2 : issues.some((i) => i.severity === 'pending') ? 4 : 0);

export async function runKnowledgeCommand(cmd: string, argv: string[]): Promise<number> {
  const { values: a } = parseArgs({ args: argv, options: opts, strict: true });
  const root = resolveKnowledgeRoot(a.root);
  switch (cmd) {
    case 'knowledge-list': {
      const all = await listClients(root);
      const list = a.find ? identifyClient(all, a.find) : all;
      console.log(`Conocimiento: ${root}`);
      for (const c of list) console.log(`- ${c.slug} (${c.name}) · ${c.status} · ${c.files.length} archivos · canales: ${[...new Set(c.files.flatMap((f) => f.channels))].join(', ')}`);
      if (a.find && list.length !== 1) console.log(list.length ? '⚠ Varios clientes encajan: preguntar cuál.' : '⚠ Ningún cliente encaja: preguntar o dar de alta.');
      return a.find && list.length !== 1 ? 4 : 0;
    }
    case 'knowledge-check': {
      const slug = need(a.client, 'client');
      const { issues, index } = await checkClient(root, slug);
      console.log(`${index.name} (${slug}) · ${index.status} · ${index.files.length} archivos`);
      for (const f of index.files) console.log(`  ${f.id.padEnd(16)} ${f.status.padEnd(10)} v${f.version} ${f.updatedAt}  ${f.path}`);
      for (const i of issues) console.log(`${icon(i.severity)} ${i.code}: ${i.message}`);
      if (!issues.length) console.log('✓ Sin incidencias');
      return exitFor(issues);
    }
    case 'knowledge-context': {
      const ctx = await loadContext(root, need(a.client, 'client'), need(a.channel, 'channel'));
      await writeFile(need(a.out, 'out'), `${JSON.stringify(ctx, null, 2)}\n`, 'utf8');
      console.log(`✓ ${a.out}: ${ctx.loaded.map((f) => `${f.id}@${f.version}(${f.status})`).join(', ')}`);
      if (ctx.onDemand.length) console.log(`  Bajo demanda (no cargado): ${ctx.onDemand.map((f) => `${f.path} [${f.topics.join(', ')}] ${Math.round(f.bytes / 1024)} KB`).join('; ')}`);
      if (ctx.emailBlocks) {
        const eb = ctx.emailBlocks;
        console.log(`  Bloques y plantillas de email en Figma (${eb.path}, ${eb.status} v${eb.version}): ${eb.blocks.variable} variables + ${eb.blocks.fixed} fijos · ${eb.figma.pageUrl}`);
        for (const t of eb.templates) console.log(`    - ${t.key}: ${t.name} → ${t.url}`);
      }
      for (const i of ctx.issues) console.log(`${icon(i.severity)} ${i.code}: ${i.message}`);
      return ctx.issues.some((i) => i.severity === 'blocking') ? 2 : 0;
    }
    case 'knowledge-propose': {
      const p = parseOrThrow(KnowledgeProposalSchema, JSON.parse(await readFile(need(a.proposal, 'proposal'), 'utf8')), 'proposal');
      const rel = await writeProposal(root, p);
      console.log(`✓ Propuesta registrada en clients/${p.client}/${rel} (pendiente de revisión; no cambia el conocimiento)`);
      return 0;
    }
    case 'knowledge-validate': {
      const idx = await validateFile(root, need(a.client, 'client'), need(a.file, 'file'), need(a.by, 'by'), need(a.note, 'note'));
      console.log(`✓ ${a.file} validado por ${a.by} (${idx.name}). Registra el cambio en CHANGELOG.md del cliente.`);
      return 0;
    }
    default:
      console.error(KNOWLEDGE_USAGE);
      return 2;
  }
}
