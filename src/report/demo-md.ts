// Informe breve de la adaptación DEMO. Los textos y nombres de Figma son datos: se escapan siempre.
import { safeAreaLabel, type DemoComposition } from '../contracts/demo.ts';
import type { DemoCheckReport } from '../demo/check.ts';
import { untrustedInline as code } from './untrusted.ts';

const ICON: Record<string, string> = { pass: 'superada', needs_review: 'revisión humana', not_evaluable: 'no evaluable', fail: 'FALLIDA' };

export interface DemoReportMeta {
  fileKey: string;
  cloneId: string;
  cloneName: string;
  sectionId: string;
  screenshotPath: string | null;
  fonts: Array<{ family: string; style: string; loaded: boolean; requiredForOps: boolean }>;
  designerDecisions: string[];
}

export function renderDemoReport(c: DemoComposition, rep: DemoCheckReport, meta: DemoReportMeta): string {
  const link = `https://www.figma.com/design/${meta.fileKey}/?node-id=${meta.cloneId.replace(':', '-')}`;
  const L: string[] = [];
  const lp = c.logoPolicy ?? { mode: 'standard' };
  L.push(`# ${lp.mode === 'experimental' ? 'EXPERIMENTAL — ' : ''}DEMO pendiente de revisión humana — ${c.target.width}×${c.target.height}`);
  L.push('');
  L.push('> No es una aprobación de producción. La maestra no se modifica; el resultado es un clon en una sección de salida.');
  if (lp.mode === 'experimental') {
    L.push(`> **Logo en modo EXPERIMENTAL**: escala proporcional ×${lp.scale}, activada para este encargo por ${code(lp.authorization)}. ${lp.why}`);
  }
  L.push('');
  L.push(`- Frame creado: ${code(meta.cloneName)} (${code(meta.cloneId)}) → ${link}`);
  L.push(`- Sección de salida: ${code(meta.sectionId)}`);
  L.push(`- Maestra: ${code(c.masterNodeId)} (${c.masterSize.width}×${c.masterSize.height})`);
  L.push(`- Zona segura: ${safeAreaLabel(c)}`);
  if (meta.screenshotPath) L.push(`- Captura: ${code(meta.screenshotPath)}`);
  L.push(`- Fuentes (nunca se sustituyen; ✗ = no cargable por el plugin en este entorno): ${meta.fonts.map((f) => `${f.family} ${f.style} ${f.loaded ? '✓' : '✗'}`).join(' · ')}. Carga exigida por las operaciones: ${meta.fonts.some((f) => f.requiredForOps) ? `sí (${meta.fonts.filter((f) => f.requiredForOps).map((f) => `${f.family} ${f.style}`).join(', ')})` : 'no (sin ediciones de texto)'}.`);
  L.push('');
  L.push(`## Estado agregado: **${ICON[rep.aggregate.status]}**`);
  L.push('');
  L.push('| Comprobación | Tipo | Estado | Hallazgos | Qué cubre |');
  L.push('|---|---|---|---|---|');
  for (const r of rep.results) {
    const f = r.findings.map((x) => `${x.code} ${x.nodeIds.join(',')}`).join('; ') || '—';
    L.push(`| ${r.validatorId} | ${r.kind} | ${ICON[r.status]} | ${f.replaceAll('|', '/')} | ${r.coverage.replaceAll('|', '/')} |`);
  }
  L.push('');
  L.push('## Operaciones aplicadas al clon');
  L.push('');
  for (const u of c.units) L.push(`- Traslación rígida ${code(u.unitId)} (${u.nodeIds.map(code).join(', ')}): ${u.why}`);
  for (const e of c.effectResizes) L.push(`- Redimensionado de efecto ${code(e.nodeId)}: ${e.why}`);
  if (lp.mode === 'experimental') L.push(`- Logo EXPERIMENTAL ${code(lp.logoNodeId)}: escala proporcional ×${lp.scale} de todo el bloque (sin deformar, rotar, recortar ni cambiar su interior).`);
  for (const e of c.textEdits ?? []) {
    const parts = [e.box && `caja ${e.box.width}×${e.box.height ?? 'auto'}`, e.align && `alineación ${e.align}`, e.lineBreaks && 'saltos de línea (mismo copy)', e.fontScale !== null && `cuerpo ×${e.fontScale}`, e.lineHeight && `interlineado ${e.lineHeight.value}${e.lineHeight.unit === 'PIXELS' ? ' px' : ' %'}`, e.authorization && `autorización: ${code(e.authorization)}`].filter(Boolean);
    L.push(`- Edición de texto ${code(e.nodeId)}: ${parts.join(', ')}. ${e.why}`);
  }
  for (const v of c.vectorEdits) L.push(`- Edición vectorial (${v.purpose === 'decoration_mask' ? 'máscara de decoración' : 'decoración'}) ${code(v.nodeId)}: ${v.vertices.length} vértice(s), ${v.tangents.length} tirador(es). ${v.why}`);
  L.push(`- Frame raíz: ${c.masterSize.width}×${c.masterSize.height} → ${c.target.width}×${c.target.height} con resizeWithoutConstraints (sin escalar hijos).`);
  L.push('');
  if (c.messagePlan) {
    const mp = c.messagePlan;
    L.push('## Mensaje, persona y recorrido de lectura');
    L.push('');
    L.push(`- Mensaje principal: ${mp.main.map(code).join(', ')}${mp.secondary.length ? ` · secundarios: ${mp.secondary.map(code).join(', ')}` : ''}${mp.offer.length ? ` · oferta: ${mp.offer.map(code).join(', ')}` : ''}${mp.cta.length ? ` · CTA: ${mp.cta.map(code).join(', ')}` : ''}`);
    L.push(`- ${mp.subject.kind === 'person' ? 'Persona' : mp.subject.kind === 'product' ? 'Producto' : 'Sin persona ni producto'}${mp.subject.nodeId ? ` (${code(mp.subject.nodeId)})` : ''}: señal «${mp.subject.cue}»${mp.subject.direction ? ` hacia ${mp.subject.direction}` : ''}. Decisión: ${mp.subject.decision}`);
    L.push(`- Recorrido previsto: ${mp.readingPath.map(code).join(' → ')}`);
    L.push('- La superposición de atención y flujo (si se entrega) es una ESTIMACIÓN HEURÍSTICA del agente, no atención medida de usuarios.');
    L.push('');
  }
  L.push('## Decisiones para la diseñadora');
  L.push('');
  for (const d of meta.designerDecisions) L.push(`- ${d}`);
  L.push('');
  return L.join('\n');
}
