// Modo plantilla de create-master-creative: una plantilla del cliente en Figma (brand.templates) se rellena con el
// copy y la imagen del brief. Es una variante de contenido de la plantilla, así que se produce y valida con el
// pipeline variant-* (la plantilla nunca se modifica; la maestra nueva es un clon). La confirmación del brief es la
// autorización de campos y contenido.
import type { Brand } from '../contracts/brand.ts';
import type { MasterBrief } from '../contracts/master.ts';
import type { MasterSnapshot } from '../contracts/snapshot.ts';
import type { VariantField, VariantJob, VariantRow } from '../contracts/variants.ts';
import { confirm } from '../variants/job.ts';
import { briefHash, checkBrief } from './brief.ts';

export function buildTemplateJob(b: MasterBrief, brand: Brand, s: MasterSnapshot): VariantJob {
  if (b.mode !== 'template') throw new Error('El brief no está en modo plantilla');
  const t = brand.templates.find((x) => x.id === b.templateId);
  if (!t) throw new Error(`La marca no tiene la plantilla ${b.templateId}`);
  if (s.rootNodeId !== t.nodeId || s.fileKey !== t.fileKey) throw new Error(`La instantánea no es la de la plantilla ${t.id} (${t.fileKey} ${t.nodeId})`);
  const stop = checkBrief(b, brand).issues.filter((i) => i.severity !== 'warning');
  if (stop.length) throw new Error(`El brief no está listo:\n${stop.map((i) => `- ${i.message}`).join('\n')}`);
  if (!b.confirmation || b.confirmation.hash !== briefHash(b)) throw new Error('Falta la confirmación vigente del brief');
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const root = byId.get(s.rootNodeId)!;
  const fields: VariantField[] = [], values: VariantRow['values'] = {}, errors: string[] = [], kept: string[] = [];
  for (const [role, slot] of Object.entries(t.slots)) {
    const n = byId.get(slot.nodeId);
    if (!n) { errors.push(`hueco ${role}: el nodo ${slot.nodeId} no está en la plantilla`); continue; }
    const fieldId = role.replace(/[^a-z0-9_]/g, '_');
    if (slot.kind === 'text') {
      const c = b.copy[role as keyof MasterBrief['copy']];
      if (!c) { kept.push(n.id); continue; }
      if (!n.text) { errors.push(`hueco ${role}: no es un texto`); continue; }
      if (n.text.segments.length > 1) { errors.push(`hueco ${role}: el texto de la plantilla tiene ${n.text.segments.length} estilos; indica qué parte del copy lleva cada uno`); continue; }
      fields.push({ fieldId, label: role, kind: 'text', nodeId: n.id, role, isLegal: role === 'legal', masterValue: n.text.characters, styleMapping: 'whole', textPolicy: b.templateTextPolicy === 'reflow' ? { mode: 'reflow', maxHeightPx: null } : { mode: 'strict' }, imagePolicy: null, paintIndex: null, maskDecision: null });
      values[fieldId] = { kind: 'text', text: c.text, parts: null, display: null, source: c.source === 'agent_draft' ? 'agent_draft' : 'user_provided' };
    } else {
      if (b.image.source === 'none' || !b.image.nodeId) { kept.push(n.id); continue; }
      const idx = Array.isArray(n.fills) ? n.fills.findIndex((p) => p.type === 'IMAGE' && p.visible) : -1;
      if (idx < 0) { errors.push(`hueco ${role}: no tiene una imagen visible`); continue; }
      fields.push({ fieldId, label: role, kind: 'image', nodeId: n.id, role: 'image', isLegal: false, masterValue: (n.fills as Array<{ imageHash: string | null }>)[idx]!.imageHash ?? '', styleMapping: null, textPolicy: null, imagePolicy: { mode: 'fill' }, paintIndex: idx, maskDecision: null });
      values[fieldId] = { kind: 'image', asset: { kind: 'figma_node', nodeId: b.image.nodeId, label: b.image.label }, source: 'user_provided' };
    }
  }
  if (errors.length) throw new Error(`No se puede rellenar la plantilla ${t.id}:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  const job: VariantJob = {
    schema: 'pcb.variant-job.v1',
    request: `Maestra ${b.slug} (${brand.name}) desde la plantilla ${t.id}`,
    master: { fileKey: t.fileKey, nodeId: t.nodeId, name: root.name, width: t.width, height: t.height, fingerprint: s.fingerprints.master, params: {} },
    params: [], fields,
    kept: kept.length ? [{ label: 'Huecos de la plantilla sin contenido en el brief', nodeIds: kept, why: 'el brief no trae ese texto o imagen: se mantiene el de la plantilla (revisar)' }] : [],
    protected: { logoNodeIds: t.logoNodeIds, safeArea: b.safeArea, safeAreaNote: b.safeArea ? 'zona segura del brief' : null },
    variants: [{ variantId: b.slug, label: b.slug, params: {}, values, notes: null }],
    output: { sectionName: b.figma.sectionName, cloneNamePattern: `${brand.slug}_{variant}_${t.width}x${t.height}` },
    confirmations: { fields: null, content: null },
  };
  const d = { by: 'user' as const, at: b.confirmation.at, note: `Brief confirmado (${b.confirmation.by}): ${b.confirmation.note ?? ''}`.trim() };
  return confirm(confirm(job, 'fields', d), 'content', d);
}
