// Comandos variant-* (skill .claude/skills/creative-content-variants). Ninguno escribe en Figma: variant-request solo
// GENERA el script de escritura, que ejecuta use_figma.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseOrThrow } from '../contracts/schema.ts';
import { MasterSnapshotSchema, type MasterSnapshot } from '../contracts/snapshot.ts';
import { ProjectConfigSchema, checkConfigSemantics } from '../contracts/config.ts';
import { VARIANT_ASSETS_SCHEMA_ID, VARIANT_RESULT_SCHEMA_ID, VariantJobSchema, VariantResultSchema, type VariantAssetsRead, type VariantJob, type VariantResult } from '../contracts/variants.ts';
import type { CheckStatus, Finding } from '../contracts/validation.ts';
import { extractEnvelope } from '../figma/ingest-envelope.ts';
import { assembleChunks } from '../figma/chunks.ts';
import { compareNodeDigests } from '../figma/digests.ts';
import { buildVariantAssetsScript, buildVariantScript, VARIANT_SCRIPT_VERSION } from '../figma/variant-script.ts';
import { discoverVariantFields, renderDiscovery } from './discover.ts';
import { checkVariantJob, confirm, renderJobSummary } from './job.ts';
import { buildVariantPlan, type VariantPlan } from './plan.ts';
import { checkVariant, type VariantCheckReport } from './check.ts';
import { renderVariantBatchReport } from '../report/variants-md.ts';
import { TranslationSchema } from '../contracts/translation.ts';
import { renderTranslationReport } from './translation.ts';

export const VARIANT_USAGE = `
  VARIANTES DE CONTENIDO (skill .claude/skills/creative-content-variants; mismo tamaño que la maestra):
  variant-discover --snapshot F --config F [--term param=valor ...] --out DIR   Propuesta: qué variar, mantener, preguntar
  variant-job-check --job F --snapshot F [--out F]        Valida el encargo y escribe el resumen para confirmar
                 (0 = listo, 4 = faltan confirmaciones o datos, 2 = encargo inválido)
  variant-confirm --job F --what fields|content --note TEXTO [--variant ID ...] [--by user|project_config]
                 Registra la confirmación de la PERSONA (solo tras su sí explícito), ligada por hash a lo confirmado
  variant-assets-request --job F --out F                  Lectura (solo lectura) de imágenes y dimensiones de los activos
  variant-plan   --job F --snapshot F [--assets-raw F] --out F   Plan exacto por variante (bloqueadas con su motivo)
  variant-request --plan F [--variant ID ...] [--mode patch --existing ID=CLONE ...] --out F   Script de ESCRITURA
  variant-check  --snapshot F --clone-snapshot F --plan F --variant ID --config F [--result F]
                 [--master-raw F ... --digests F] [--visual F] --out DIR   Validación sobre la relectura del clon
  variant-report --plan F [--result F] [--check F ...] [--screenshot ID=RUTA ...] [--translation F] --out F
                 Entrega de la tanda (con --translation: normas del idioma, legales y piezas pendientes de fuente)`;

const opts = {
  snapshot: { type: 'string' }, config: { type: 'string' }, term: { type: 'string', multiple: true }, out: { type: 'string' },
  job: { type: 'string' }, what: { type: 'string' }, note: { type: 'string' }, variant: { type: 'string', multiple: true },
  by: { type: 'string' }, 'assets-raw': { type: 'string' }, plan: { type: 'string' }, mode: { type: 'string' },
  existing: { type: 'string', multiple: true }, 'clone-snapshot': { type: 'string' }, result: { type: 'string' },
  'master-raw': { type: 'string', multiple: true }, digests: { type: 'string' }, visual: { type: 'string' },
  check: { type: 'string', multiple: true }, screenshot: { type: 'string', multiple: true }, translation: { type: 'string' },
} as const;

const readJson = async (p: string): Promise<unknown> => JSON.parse(await readFile(p, 'utf8'));
const writeJson = async (p: string, v: unknown) => writeFile(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
const need = (v: string | undefined, name: string): string => { if (!v) throw new Error(`Falta --${name}\n${VARIANT_USAGE}`); return v; };
const loadSnapshot = async (p: string): Promise<MasterSnapshot> => parseOrThrow(MasterSnapshotSchema, await readJson(p), 'snapshot');
const loadJob = async (p: string): Promise<VariantJob> => parseOrThrow(VariantJobSchema, await readJson(p), 'job');
const pairs = (xs: string[] | undefined): Record<string, string> => Object.fromEntries((xs ?? []).map((x) => {
  const i = x.indexOf('=');
  if (i <= 0) throw new Error(`Formato esperado clave=valor: ${x}`);
  return [x.slice(0, i), x.slice(i + 1)];
}));
async function loadResult(p: string): Promise<VariantResult> {
  const ext = extractEnvelope(await readFile(p, 'utf8'), VARIANT_RESULT_SCHEMA_ID);
  if ('code' in ext) throw new Error(`${p}: ${ext.message}`);
  return parseOrThrow(VariantResultSchema, ext.value, 'result');
}

export async function runVariantCommand(cmd: string, rest: string[]): Promise<number> {
  const { values: a } = parseArgs({ args: rest, options: opts, strict: true });
  switch (cmd) {
    case 'variant-discover': {
      const snap = await loadSnapshot(need(a.snapshot, 'snapshot'));
      const cfg = parseOrThrow(ProjectConfigSchema, await readJson(need(a.config, 'config')), 'config');
      const ci = checkConfigSemantics(cfg);
      if (ci.length) throw new Error(`config: ${ci.map((i) => i.message).join('; ')}`);
      const d = discoverVariantFields(snap, cfg, { terms: pairs(a.term) });
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      await writeJson(join(out, 'variant-discovery.json'), d);
      await writeFile(join(out, 'propuesta.md'), renderDiscovery(d), 'utf8');
      const n = (p: string) => d.candidates.filter((c) => c.proposal === p).length;
      console.log(`${snap.source === 'MOCK' ? '[MOCK] ' : ''}${d.candidates.length} elementos: ${n('vary')} variar, ${n('keep')} mantener, ${n('ask')} preguntar → ${out}/propuesta.md (propuesta del agente, no autoriza cambios)`);
      return 0;
    }
    case 'variant-job-check': {
      const job = await loadJob(need(a.job, 'job'));
      const snap = await loadSnapshot(need(a.snapshot, 'snapshot'));
      const chk = checkVariantJob(job, snap);
      if (a.out) await writeFile(a.out, renderJobSummary(job, snap, chk), 'utf8');
      for (const i of chk.issues) console.log(`${i.severity.padEnd(8)} ${i.code.padEnd(34)} ${i.variantId ?? '(global)'}  ${i.message}`);
      console.log(chk.ready ? `Listo: ${chk.readyVariantIds.length} variante(s).` : `No listo: ${chk.readyVariantIds.length}/${job.variants.length} variante(s) se podrían producir.`);
      return chk.issues.some((i) => i.severity === 'blocking') ? 2 : chk.ready ? 0 : 4;
    }
    case 'variant-confirm': {
      const path = need(a.job, 'job');
      const what = need(a.what, 'what');
      if (what !== 'fields' && what !== 'content') throw new Error('--what debe ser fields o content');
      const by = (a.by ?? 'user') as 'user' | 'project_config';
      if (by !== 'user' && by !== 'project_config') throw new Error('--by debe ser user o project_config (el agente no confirma)');
      const job = confirm(await loadJob(path), what, { by, at: new Date().toISOString(), note: need(a.note, 'note') }, a.variant);
      await writeJson(a.out ?? path, job);
      console.log(`Confirmación de ${what === 'fields' ? 'campos' : `contenido (${a.variant?.join(', ') ?? 'todas las variantes'})`} registrada (${by}).`);
      return 0;
    }
    case 'variant-assets-request': {
      const job = await loadJob(need(a.job, 'job'));
      const imageFields = job.fields.filter((f) => f.kind === 'image');
      const nodeIds = new Set(imageFields.map((f) => f.nodeId));
      const hashes = new Set<string>();
      for (const v of job.variants) for (const f of imageFields) {
        const val = v.values[f.fieldId];
        if (val?.kind === 'image' && val.asset?.kind === 'figma_node') nodeIds.add(val.asset.nodeId);
        if (val?.kind === 'image' && val.asset?.kind === 'image_hash') hashes.add(val.asset.hash);
      }
      await writeJson(need(a.out, 'out'), {
        tool: 'use_figma', fileKey: job.master.fileKey, readOnly: true,
        description: `Solo lectura: imágenes y dimensiones de ${nodeIds.size} nodo(s) y ${hashes.size} imagen(es) para las variantes (no modifica el documento).`,
        code: buildVariantAssetsScript([...nodeIds], [...hashes]),
      });
      return 0;
    }
    case 'variant-plan': {
      const job = await loadJob(need(a.job, 'job'));
      const snap = await loadSnapshot(need(a.snapshot, 'snapshot'));
      let assets: VariantAssetsRead | null = null;
      if (a['assets-raw']) {
        const ext = extractEnvelope(await readFile(a['assets-raw'], 'utf8'), VARIANT_ASSETS_SCHEMA_ID);
        if ('code' in ext) throw new Error(`${a['assets-raw']}: ${ext.message}`);
        assets = ext.value as VariantAssetsRead;
      }
      const { plan } = buildVariantPlan(job, snap, assets);
      await writeJson(need(a.out, 'out'), plan);
      for (const v of plan.variants) {
        console.log(`${v.status.padEnd(8)} ${v.variantId}  ${v.ops.length} cambio(s)`);
        for (const b of v.blockers) console.log(`         ⛔ ${b}`);
        for (const w of v.warnings) console.log(`         ℹ ${w}`);
      }
      return plan.variants.some((v) => v.status === 'ready') ? 0 : 4;
    }
    case 'variant-request': {
      const plan = (await readJson(need(a.plan, 'plan'))) as VariantPlan;
      const mode = a.mode === 'patch' ? 'patch' : 'create';
      const code = buildVariantScript(plan, { variantIds: a.variant, mode, existingCloneIds: mode === 'patch' ? pairs(a.existing) : undefined });
      const ids = plan.variants.filter((v) => v.status === 'ready' && (!a.variant || a.variant.includes(v.variantId))).map((v) => v.variantId);
      await writeJson(need(a.out, 'out'), {
        tool: 'use_figma', fileKey: plan.master.fileKey, scriptVersion: VARIANT_SCRIPT_VERSION, writesOnlyClones: true, mode,
        description: mode === 'patch'
          ? `VARIANTES (actualización): reaplica el contenido confirmado de ${ids.join(', ')} SOLO sobre sus clones existentes. La maestra no se modifica.`
          : `VARIANTES: clona ${plan.master.nodeId} una vez por variante (${ids.join(', ')}) en la sección «${plan.sectionName}» y cambia SOLO los elementos vinculados de cada clon. La maestra no se modifica.`,
        code,
      });
      return 0;
    }
    case 'variant-check': {
      const master = await loadSnapshot(need(a.snapshot, 'snapshot'));
      const clone = await loadSnapshot(need(a['clone-snapshot'], 'clone-snapshot'));
      const plan = (await readJson(need(a.plan, 'plan'))) as VariantPlan;
      const vid = need(a.variant?.[0], 'variant');
      const entry = plan.variants.find((v) => v.variantId === vid);
      if (!entry || entry.status !== 'ready') throw new Error(`La variante ${vid} no está lista en el plan`);
      if (a.result) {
        const res = (await loadResult(a.result)).variants.find((v) => v.variantId === vid);
        if (!res?.cloneId || res.cloneId !== clone.rootNodeId) throw new Error(`La relectura (${clone.rootNodeId}) no es el clon de ${vid} (${res?.cloneId ?? 'sin clon'})`);
      }
      const cfg = parseOrThrow(ProjectConfigSchema, await readJson(need(a.config, 'config')), 'config');
      let digestsEqual: boolean | null = null;
      if (a.digests) {
        const r = assembleChunks(await Promise.all((a['master-raw'] ?? []).map(async (p) => ({ rawText: await readFile(p, 'utf8'), rawResponsePath: p }))));
        if (!r.ok) throw new Error(r.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
        digestsEqual = compareNodeDigests(r.value.payload, await readFile(a.digests, 'utf8')).equal;
      }
      const visual = a.visual ? ((await readJson(a.visual)) as { status: CheckStatus; findings: Finding[] }) : null;
      const rep = checkVariant({ master, clone, plan, entry, tolerancePx: cfg.tolerances.px, masterDigestsEqual: digestsEqual, visual });
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      await writeJson(join(out, `check-${vid}.json`), rep);
      console.log(`${vid}: ${rep.aggregate.status}`);
      for (const r of rep.results) console.log(`  ${r.status.padEnd(13)} ${r.validatorId}${r.findings.length ? ` — ${r.findings.map((f) => f.code).join(', ')}` : ''}`);
      return rep.aggregate.status === 'fail' ? 3 : 0;
    }
    case 'variant-report': {
      const plan = (await readJson(need(a.plan, 'plan'))) as VariantPlan;
      const result = a.result ? await loadResult(a.result) : null;
      const checks = await Promise.all((a.check ?? []).map(async (p) => (await readJson(p)) as VariantCheckReport));
      let md = renderVariantBatchReport(plan, result, checks, pairs(a.screenshot));
      if (a.translation) md += `\n${renderTranslationReport(parseOrThrow(TranslationSchema, await readJson(a.translation), 'translation'), plan.variants.map((v) => v.variantId))}`;
      await writeFile(need(a.out, 'out'), md, 'utf8');
      const st = (s: string) => result?.variants.filter((v) => v.status === s).length ?? 0;
      console.log(`${st('created') + st('patched')} creada(s)/actualizada(s), ${st('exists')} ya existente(s), ${st('failed')} fallida(s), ${plan.variants.filter((v) => v.status === 'blocked').length} bloqueada(s) → ${a.out}`);
      return 0;
    }
    default:
      console.log(VARIANT_USAGE);
      return 1;
  }
}
