// Comandos master-* (skill .claude/skills/create-master-creative). Ninguno escribe en Figma: master-request solo GENERA
// el script que ejecuta use_figma, y el modo plantilla se produce con el pipeline variant-*.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseOrThrow } from '../contracts/schema.ts';
import { MasterSnapshotSchema } from '../contracts/snapshot.ts';
import { MASTER_RESULT_SCHEMA_ID, MasterBriefSchema, MasterPlanSchema, MasterResultSchema, type MasterBrief } from '../contracts/master.ts';
import { VARIANT_ASSETS_SCHEMA_ID, type VariantAssetsRead } from '../contracts/variants.ts';
import type { CheckStatus, Finding } from '../contracts/validation.ts';
import { extractEnvelope } from '../figma/ingest-envelope.ts';
import { buildVariantAssetsScript } from '../figma/variant-script.ts';
import { buildMasterScript, MASTER_SCRIPT_VERSION } from '../figma/master-script.ts';
import { svgAspect } from '../brand/color.ts';
import { loadContext, resolveKnowledgeRoot, withLogoSvg, type KnowledgeContext } from '../knowledge/store.ts';
import { checkBrief, confirmBrief, renderBriefSummary } from './brief.ts';
import { buildMasterPlan } from './plan.ts';
import { checkMaster, renderMasterReport } from './check.ts';
import { buildTemplateJob } from './template.ts';

export const MASTER_USAGE = `
  PIEZAS MAESTRAS (skill .claude/skills/create-master-creative; brief + conocimiento del cliente → maestra nueva en Figma).
  La marca y las plantillas paid salen de client-knowledge/clients/<slug>/ (canal paid). --client SLUG es por defecto
  el del brief (o el del plan); raíz: --root DIR o CLIENT_KNOWLEDGE_ROOT.
  master-brief-check --brief F [--client SLUG] [--out F]   Brief contra la marca: falta, propuestas y lagunas a decidir
                 (0 = confirmado y listo, 4 = pendientes, 2 = incumple la marca)
  master-confirm --brief F [--client SLUG] --by NOMBRE --note TEXTO   Confirmación de la PERSONA (ligada por hash)
  master-assets-request --brief F --out F             Lectura (solo lectura) de la imagen del brief en Figma
  master-plan    --brief F [--client SLUG] [--assets-raw F] --out F   Composición con los tokens (modo scratch)
  master-request --plan F --out F                     Script de ESCRITURA: crea la pieza en un frame nuevo
  master-check   --plan F --snapshot F [--client SLUG] [--result F] [--visual F] [--screenshot RUTA] --out DIR
                 Validación sobre la relectura del frame creado (+ informe)
  master-template-job --brief F [--client SLUG] --snapshot F --out F   Modo plantilla (channels/paid.json): encargo de
                 variantes ya confirmado`;

const opts = {
  brief: { type: 'string' }, client: { type: 'string' }, root: { type: 'string' }, out: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' },
  'assets-raw': { type: 'string' }, plan: { type: 'string' }, snapshot: { type: 'string' }, result: { type: 'string' },
  visual: { type: 'string' }, screenshot: { type: 'string' },
} as const;
const readJson = async (p: string): Promise<unknown> => JSON.parse(await readFile(p, 'utf8'));
const writeJson = async (p: string, v: unknown) => writeFile(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
const need = (v: string | undefined, name: string): string => { if (!v) throw new Error(`Falta --${name}\n${MASTER_USAGE}`); return v; };
const loadBrief = async (p: string): Promise<MasterBrief> => parseOrThrow(MasterBriefSchema, await readJson(p), 'brief');

/** Conocimiento del cliente para el canal paid (marca + plantillas). Solo de clients/<slug>/; se detiene si hay bloqueos. */
async function paidContext(root: string | undefined, slug: string): Promise<KnowledgeContext & { brand: NonNullable<KnowledgeContext['brand']> }> {
  const ctx = await loadContext(resolveKnowledgeRoot(root), slug, 'paid');
  const stop = ctx.issues.filter((i) => i.severity === 'blocking');
  if (stop.length || !ctx.brand) throw new Error(`El conocimiento de ${slug} no se puede usar:\n${stop.map((i) => `- ${i.message}`).join('\n')}`);
  for (const i of ctx.issues) console.log(`${i.severity === 'pending' ? '❓' : 'ℹ'} conocimiento ${i.code}: ${i.message}`);
  return { ...ctx, brand: ctx.brand };
}
const templatesOf = (ctx: KnowledgeContext) => ctx.paid?.templates ?? [];

export async function runMasterCommand(cmd: string, rest: string[]): Promise<number> {
  const { values: a } = parseArgs({ args: rest, options: opts, strict: true });
  switch (cmd) {
    case 'master-brief-check': {
      const b = await loadBrief(need(a.brief, 'brief'));
      const ctx = await paidContext(a.root, a.client ?? b.brand);
      const brand = ctx.brand;
      const chk = checkBrief(b, brand, templatesOf(ctx));
      if (a.out) await writeFile(a.out, renderBriefSummary(b, brand, chk), 'utf8');
      for (const i of chk.issues) console.log(`${i.severity.padEnd(8)} ${i.code.padEnd(32)} ${i.message}${i.proposal ? ` — propuesta: ${i.proposal}` : ''}`);
      return chk.issues.some((i) => i.severity === 'blocking') ? 2 : chk.ready ? 0 : 4;
    }
    case 'master-confirm': {
      const path = need(a.brief, 'brief');
      const brief = await loadBrief(path);
      const ctx = await paidContext(a.root, a.client ?? brief.brand);
      const b = confirmBrief(brief, ctx.brand, need(a.by, 'by'), need(a.note, 'note'), templatesOf(ctx));
      await writeJson(path, b);
      console.log(`Brief ${b.slug} confirmado por ${a.by}.`);
      return 0;
    }
    case 'master-assets-request': {
      const b = await loadBrief(need(a.brief, 'brief'));
      if (!b.image.nodeId) throw new Error('El brief no tiene todavía el nodo de Figma con la imagen');
      await writeJson(need(a.out, 'out'), { tool: 'use_figma', fileKey: b.figma.fileKey, readOnly: true, description: `Solo lectura: imagen y dimensiones de ${b.image.nodeId} para la pieza maestra (no modifica el documento).`, code: buildVariantAssetsScript([b.image.nodeId], []) });
      return 0;
    }
    case 'master-plan': {
      const b = await loadBrief(need(a.brief, 'brief'));
      let ctx: KnowledgeContext = await paidContext(a.root, a.client ?? b.brand);
      const brand = ctx.brand!;
      for (const l of brand.logos) ctx = await withLogoSvg(ctx, l.id);
      const logoSvgs = ctx.logoSvgs;
      let assets: VariantAssetsRead | null = null;
      if (a['assets-raw']) {
        const ext = extractEnvelope(await readFile(a['assets-raw'], 'utf8'), VARIANT_ASSETS_SCHEMA_ID);
        if ('code' in ext) throw new Error(`${a['assets-raw']}: ${ext.message}`);
        assets = ext.value as VariantAssetsRead;
      }
      const plan = buildMasterPlan({ brief: b, brand, logoSvgs, assets });
      await writeJson(need(a.out, 'out'), plan);
      for (const x of plan.blockers) console.log(`⛔ ${x}`);
      for (const x of plan.warnings) console.log(`ℹ ${x}`);
      for (const x of plan.internalRules) console.log(`· regla interna: ${x}`);
      console.log(plan.blockers.length ? 'Plan con bloqueos: no se puede construir.' : `Plan listo: ${plan.frameName} (${plan.archetype}).`);
      return plan.blockers.length ? 4 : 0;
    }
    case 'master-request': {
      const plan = parseOrThrow(MasterPlanSchema, await readJson(need(a.plan, 'plan')), 'plan');
      await writeJson(need(a.out, 'out'), {
        tool: 'use_figma', fileKey: plan.fileKey, scriptVersion: MASTER_SCRIPT_VERSION, createsOnlyNewNodes: true,
        description: `MAESTRA NUEVA: crea el frame «${plan.frameName}» (${plan.width}×${plan.height}) en la sección «${plan.sectionName}» de la página ${plan.pageId}. Solo crea nodos nuevos; no modifica nada existente.`,
        code: buildMasterScript(plan),
      });
      return 0;
    }
    case 'master-check': {
      const plan = parseOrThrow(MasterPlanSchema, await readJson(need(a.plan, 'plan')), 'plan');
      const snap = parseOrThrow(MasterSnapshotSchema, await readJson(need(a.snapshot, 'snapshot')), 'snapshot');
      const ctx = await paidContext(a.root, a.client ?? plan.brand.slug);
      const brand = ctx.brand;
      if (a.result) {
        const ext = extractEnvelope(await readFile(a.result, 'utf8'), MASTER_RESULT_SCHEMA_ID);
        if ('code' in ext) throw new Error(`${a.result}: ${ext.message}`);
        const res = parseOrThrow(MasterResultSchema, ext.value, 'result');
        if (res.frameId !== snap.rootNodeId) throw new Error(`La relectura (${snap.rootNodeId}) no es el frame creado (${res.frameId ?? 'ninguno'})`);
      }
      const logo = brand.logos.find((l) => l.id === plan.logo.logoId);
      const svg = logo ? (await withLogoSvg(ctx, logo.id)).logoSvgs[logo.id] : undefined;
      const aspect = svg ? svgAspect(svg) : null;
      const visual = a.visual ? ((await readJson(a.visual)) as { status: CheckStatus; findings: Finding[] }) : null;
      const rep = checkMaster({ plan, snapshot: snap, logoAspect: aspect, minLogoContrast: brand.logoRules.minContrast?.value ?? null, visual });
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      await writeJson(join(out, 'master-check.json'), rep);
      await writeFile(join(out, 'informe.md'), renderMasterReport(plan, rep, `https://www.figma.com/design/${plan.fileKey}/?node-id=${snap.rootNodeId.replace(':', '-')}`, a.screenshot ?? null), 'utf8');
      console.log(`${snap.source === 'MOCK' ? '[MOCK] ' : ''}${plan.frameName}: ${rep.aggregate.status}`);
      for (const r of rep.results) console.log(`  ${r.status.padEnd(13)} ${r.validatorId}${r.findings.length ? ` — ${r.findings.map((f) => f.code).join(', ')}` : ''}`);
      return rep.aggregate.status === 'fail' ? 3 : 0;
    }
    case 'master-template-job': {
      const b = await loadBrief(need(a.brief, 'brief'));
      const ctx = await paidContext(a.root, a.client ?? b.brand);
      const snap = parseOrThrow(MasterSnapshotSchema, await readJson(need(a.snapshot, 'snapshot')), 'snapshot');
      const job = buildTemplateJob(b, ctx.brand, templatesOf(ctx), snap);
      await writeJson(need(a.out, 'out'), job);
      console.log(`Encargo de variantes de la plantilla listo (${job.fields.length} hueco(s)) → sigue con variant-job-check / variant-plan / variant-request.`);
      return 0;
    }
    default:
      console.log(MASTER_USAGE);
      return 1;
  }
}
