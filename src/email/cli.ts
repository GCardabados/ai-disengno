// Comandos email-* (skill .claude/skills/create-email-design). Ninguno escribe en Figma: email-request solo GENERA los
// scripts, que se envían tal cual con use_figma.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseOrThrow } from '../contracts/schema.ts';
import { EMAIL_RESULT_SCHEMA_ID, EmailBriefSchema, EmailPlanSchema, EmailResultSchema, type EmailBrief, type EmailPlan, type EmailResult } from '../contracts/email.ts';
import { KNOWLEDGE_CONTEXT_SCHEMA_ID } from '../contracts/knowledge.ts';
import { withLogoSvg, type KnowledgeContext } from '../knowledge/store.ts';
import { extractEnvelope } from '../figma/ingest-envelope.ts';
import { EMAIL_PARTS, EMAIL_SCRIPT_VERSION, splitEmailScript, type EmailPart } from '../figma/email-script.ts';
import { checkEmailBrief, confirmEmailBrief, renderEmailBriefSummary } from './brief.ts';
import { buildEmailPlan } from './plan.ts';
import { checkEmailResult, renderEmailReport } from './check.ts';

export const EMAIL_USAGE = `
  EMAIL EN FIGMA (skill .claude/skills/create-email-design; contexto = salida de knowledge-context --channel email):
  email-brief-check --brief F --context F [--out F]       Estructura, copys, colores y lagunas; resumen para confirmar
                 (0 = listo, 4 = faltan decisiones o confirmación, 2 = inválido)
  email-confirm  --brief F --context F --by NOMBRE --note TEXTO   Registra la confirmación (SOLO tras el sí explícito)
  email-plan     --brief F --context F --out F [--report F]   Árbol exacto desktop/mobile, procedencia y comprobaciones previas
  email-request  --plan F --out-dir DIR                    Script(s) de ESCRITURA para use_figma (por partes si no cabe)
  email-check    --plan F --result F [--result F2 ...] --out DIR [--link URL] [--screenshot RUTA ...]
                 Valida la auditoría devuelta por el script y escribe el informe de entrega`;

const opts = {
  brief: { type: 'string' }, context: { type: 'string' }, out: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' },
  plan: { type: 'string' }, report: { type: 'string' }, 'out-dir': { type: 'string' }, result: { type: 'string', multiple: true },
  link: { type: 'string' }, screenshot: { type: 'string', multiple: true },
} as const;

const readJson = async (p: string): Promise<unknown> => JSON.parse(await readFile(p, 'utf8'));
const writeJson = async (p: string, v: unknown) => writeFile(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
const need = (v: string | undefined, name: string): string => { if (!v) throw new Error(`Falta --${name}\n${EMAIL_USAGE}`); return v; };
const loadBrief = async (p: string): Promise<EmailBrief> => parseOrThrow(EmailBriefSchema, await readJson(p), 'brief');
async function loadContext(p: string, b?: EmailBrief): Promise<KnowledgeContext> {
  const c = (await readJson(p)) as KnowledgeContext;
  if (c?.schema !== KNOWLEDGE_CONTEXT_SCHEMA_ID) throw new Error(`${p} no es un contexto de conocimiento (${KNOWLEDGE_CONTEXT_SCHEMA_ID}); genéralo con knowledge-context`);
  // El logo decidido en el encargo se lee del conocimiento del cliente (no se copia en el contexto).
  return b ? withLogoSvg(c, b.decisions.logo?.logoId) : c;
}

/** Une los resultados de varias llamadas (construcción por partes). */
export function mergeResults(rs: EmailResult[]): EmailResult {
  const failed = rs.find((r) => r.status !== 'created');
  return {
    schema: EMAIL_RESULT_SCHEMA_ID, scriptVersion: rs[0]!.scriptVersion, status: failed?.status ?? 'created', sectionId: rs.find((r) => r.sectionId)?.sectionId ?? null,
    frames: Object.assign({}, ...rs.map((r) => r.frames)), components: rs.flatMap((r) => r.components), audit: rs.flatMap((r) => r.audit), images: rs.flatMap((r) => r.images),
    annotations: { ok: rs.reduce((s, r) => s + r.annotations.ok, 0), failed: rs.reduce((s, r) => s + r.annotations.failed, 0), error: rs.find((r) => r.annotations.error)?.annotations.error ?? null },
    fonts: rs.flatMap((r) => r.fonts), error: rs.map((r) => r.error).filter(Boolean).join(' | ') || null,
  };
}

export async function runEmailCommand(cmd: string, argv: string[]): Promise<number> {
  const { values: a } = parseArgs({ args: argv, options: opts, strict: true });
  switch (cmd) {
    case 'email-brief-check': {
      const b = await loadBrief(need(a.brief, 'brief')), ctx = await loadContext(need(a.context, 'context'), b);
      const chk = checkEmailBrief(b, ctx);
      const md = renderEmailBriefSummary(b, ctx, chk);
      if (a.out) await writeFile(a.out, md, 'utf8');
      console.log(md);
      return chk.issues.some((i) => i.severity === 'blocking') ? 2 : chk.ready ? 0 : 4;
    }
    case 'email-confirm': {
      const p = need(a.brief, 'brief');
      const b0 = await loadBrief(p);
      const b = confirmEmailBrief(b0, await loadContext(need(a.context, 'context'), b0), need(a.by, 'by'), need(a.note, 'note'));
      await writeJson(p, b);
      console.log(`✓ Brief confirmado por ${a.by} (hash ${b.confirmation!.hash.slice(0, 12)}…)`);
      return 0;
    }
    case 'email-plan': {
      const b = await loadBrief(need(a.brief, 'brief')), ctx = await loadContext(need(a.context, 'context'), b);
      const plan = buildEmailPlan(b, ctx);
      parseOrThrow(EmailPlanSchema, plan, 'plan');
      await writeJson(need(a.out, 'out'), plan);
      if (a.report) await writeFile(a.report, renderEmailReport(plan, null), 'utf8');
      for (const x of plan.blockers) console.log(`⛔ ${x}`);
      for (const x of plan.warnings) console.log(`ℹ ${x}`);
      console.log(plan.blockers.length ? `✗ Plan con ${plan.blockers.length} bloqueo(s): no se construye` : `✓ Plan listo: ${a.out}`);
      return plan.blockers.length ? 4 : 0;
    }
    case 'email-request': {
      const plan = parseOrThrow(EmailPlanSchema, await readJson(need(a.plan, 'plan')), 'plan') as EmailPlan;
      const dir = need(a['out-dir'], 'out-dir');
      await mkdir(dir, { recursive: true });
      const calls = splitEmailScript(plan);
      for (const [i, c] of calls.entries()) {
        const f = join(dir, `email-request-${i + 1}.json`);
        await writeJson(f, {
          tool: 'use_figma', fileKey: plan.fileKey, scriptVersion: EMAIL_SCRIPT_VERSION, parts: c.parts, call: `${i + 1}/${calls.length}`,
          description: `create-email-design ${plan.frames.desktop.replace(/_Desktop$/, '')}: crea ${c.parts.join(' + ')} en la sección «${plan.sectionName}» (solo nodos nuevos)`,
          chars: c.code.length, code: c.code,
        });
        console.log(`✓ ${f} (${c.parts.join(' + ')}, ${c.code.length} caracteres)`);
      }
      return 0;
    }
    case 'email-check': {
      const plan = parseOrThrow(EmailPlanSchema, await readJson(need(a.plan, 'plan')), 'plan') as EmailPlan;
      const results: EmailResult[] = [];
      for (const p of a.result ?? []) {
        const ext = extractEnvelope(await readFile(p, 'utf8'), EMAIL_RESULT_SCHEMA_ID);
        if ('code' in ext) throw new Error(`${p}: ${ext.message}`);
        results.push(parseOrThrow(EmailResultSchema, ext.value, 'result'));
      }
      if (!results.length) throw new Error('Falta --result (respuesta original de cada llamada a use_figma)');
      const rep = checkEmailResult(plan, mergeResults(results));
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      await writeJson(join(out, 'email-check.json'), rep);
      await writeFile(join(out, 'informe.md'), renderEmailReport(plan, rep, { link: a.link, screenshots: a.screenshot }), 'utf8');
      for (const f of rep.findings) console.log(`${f.severity === 'blocking' ? '⛔' : 'ℹ'} ${f.code}: ${f.message}`);
      console.log(`${rep.status === 'fail' ? '✗' : '✓'} ${rep.status} · informe en ${join(out, 'informe.md')}`);
      return rep.status === 'fail' ? 2 : 0;
    }
    default:
      console.error(EMAIL_USAGE);
      return 2;
  }
}

export { EMAIL_PARTS, type EmailPart };
