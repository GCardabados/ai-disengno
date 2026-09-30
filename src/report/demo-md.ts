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
  L.push(`# DEMO pendiente de revisión humana — ${c.target.width}×${c.target.height}`);
  L.push('');
  L.push('> No es una aprobación de producción. La maestra no se modifica; el resultado es un clon en una sección de salida.');
  L.push('');
  L.push(`- Frame creado: ${code(meta.cloneName)} (${code(meta.cloneId)}) → ${link}`);
  L.push(`- Sección de salida: ${code(meta.sectionId)}`);
  L.push(`- Maestra: ${code(c.masterNodeId)} (${c.masterSize.width}×${c.masterSize.height})`);
  L.push(`- Zona segura: ${safeAreaLabel(c)}`);
  if (meta.screenshotPath) L.push(`- Captura: ${code(meta.screenshotPath)}`);
  L.push(`- Fuentes (nunca se sustituyen; ✗ = no cargable por el plugin en este entorno): ${meta.fonts.map((f) => `${f.family} ${f.style} ${f.loaded ? '✓' : '✗'}`).join(' · ')}. Carga exigida por las operaciones: ${meta.fonts.some((f) => f.requiredForOps) ? 'sí' : 'no (solo traslaciones de texto)'}.`);
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
  for (const v of c.vectorEdits) L.push(`- Edición vectorial (${v.purpose === 'decoration_mask' ? 'máscara de decoración' : 'decoración'}) ${code(v.nodeId)}: ${v.vertices.length} vértice(s), ${v.tangents.length} tirador(es). ${v.why}`);
  L.push(`- Frame raíz: ${c.masterSize.width}×${c.masterSize.height} → ${c.target.width}×${c.target.height} con resizeWithoutConstraints (sin escalar hijos).`);
  L.push('');
  L.push('## Decisiones para la diseñadora');
  L.push('');
  for (const d of meta.designerDecisions) L.push(`- ${d}`);
  L.push('');
  return L.join('\n');
}
