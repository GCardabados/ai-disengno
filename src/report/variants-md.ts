// Entrega de una tanda de variantes: creadas, bloqueadas, pendientes; enlaces; cambios aplicados; validaciones.
// Distingue la confirmación del CONTENIDO (ya dada) de la aceptación del DISEÑO final (pendiente de una persona).
import type { VariantResult } from '../contracts/variants.ts';
import type { VariantPlan } from '../variants/plan.ts';
import type { VariantCheckReport } from '../variants/check.ts';
import { quote } from '../variants/discover.ts';

const STATUS: Record<string, string> = { pass: 'superada', needs_review: 'a revisar', not_evaluable: 'no evaluable', fail: 'FALLA' };
const link = (fileKey: string, id: string) => `https://www.figma.com/design/${fileKey}/?node-id=${id.replace(':', '-')}`;

export function renderVariantBatchReport(plan: VariantPlan, result: VariantResult | null, checks: VariantCheckReport[], screenshots: Record<string, string> = {}): string {
  const mock = plan.source === 'MOCK' ? '**[MOCK]** ' : '';
  const out = [
    `# Variantes de ${quote(plan.master.name)} (${plan.master.width}×${plan.master.height})`, '',
    `${mock}Estado: **pendiente de revisión humana del diseño**. Solo se producen variantes cuyo contenido confirmó la persona; esa confirmación no es la aceptación del diseño, y la revisión del agente tampoco.`, '',
    '| Variante | Resultado | Pieza | Validación |', '|---|---|---|---|',
  ];
  for (const e of plan.variants) {
    const res = result?.variants.find((v) => v.variantId === e.variantId);
    const chk = checks.find((c) => c.variantId === e.variantId);
    const state = e.status === 'blocked' ? 'bloqueada (antes de escribir)' : !res ? 'pendiente (no ejecutada)' : res.status === 'failed' ? 'falló' : res.status === 'exists' ? 'ya existía (no duplicada)' : res.status === 'patched' ? 'actualizada' : 'creada';
    const piece = res?.cloneId ? `[${res.cloneName.replace(/[[\]|]/g, '')}](${link(plan.master.fileKey, res.cloneId)})` : '—';
    out.push(`| ${e.label.replace(/\|/g, '\\|')} | ${state} | ${piece} | ${chk ? STATUS[chk.aggregate.status] : res?.status === 'failed' ? 'no válida' : '—'} |`);
  }
  out.push('');
  for (const e of plan.variants) {
    const res = result?.variants.find((v) => v.variantId === e.variantId);
    const chk = checks.find((c) => c.variantId === e.variantId);
    out.push(`## ${e.label}`, '');
    if (e.status === 'blocked') { out.push('**Bloqueada** antes de escribir:', '', ...e.blockers.map((b) => `- ${b}`), ''); continue; }
    if (res?.status === 'failed') out.push(`**Falló:** ${res.error ?? 'sin detalle'}. No se presenta como correcta.`, '');
    if (screenshots[e.variantId]) out.push(`![${e.variantId}](${screenshots[e.variantId]})`, '');
    out.push('Cambios confirmados:', '');
    for (const op of e.ops) out.push(op.kind === 'text' ? `- ${op.fieldId}: ${quote(op.characters, 120)} (${op.policy.mode})` : `- ${op.fieldId}: imagen ${quote(op.asset.label)} (${op.policy.mode})`);
    if (res?.applied.length) out.push('', 'Aplicado en Figma:', '', ...res.applied.map((a) => `- ${a.op} → ${a.cloneNodeId}${(a.detail as { scale?: number }).scale !== undefined && (a.detail as { scale: number }).scale !== 1 ? ` (cuerpo ×${(a.detail as { scale: number }).scale})` : ''}`));
    if (e.warnings.length) out.push('', 'Avisos:', '', ...e.warnings.map((w) => `- ${w}`));
    if (chk) {
      out.push('', `Validación sobre la relectura: **${STATUS[chk.aggregate.status]}**`, '');
      for (const r of chk.results) out.push(`- ${r.validatorId}: ${STATUS[r.status]}${r.findings.length ? ` — ${r.findings.map((x) => `${x.code}: ${x.message}`).join('; ')}` : ''}`);
    } else if (res && res.status !== 'failed') out.push('', 'Validación: **pendiente** (falta la relectura del clon).');
    out.push('');
  }
  out.push('## Decisiones pendientes', '', '- Revisión humana del diseño de cada pieza (encuadre, legibilidad, contraste y consistencia).', ...plan.variants.filter((e) => e.status === 'blocked').map((e) => `- ${e.label}: resolver los bloqueos indicados.`), '');
  return out.join('\n');
}
