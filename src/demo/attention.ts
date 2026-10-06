// Flujo de lectura y atención ESTIMADA (heurística del agente) sobre la relectura del clon. No hay herramienta de
// saliencia ni eye tracking integrada: nada de esto es atención medida de usuarios ni da porcentajes. Sirve para revisar
// si tamaño, posición y espacio sostienen el recorrido previsto en messagePlan; se entrega SEPARADO de la creatividad.
import type { Rect } from '../contracts/geometry.ts';
import type { MessagePlan } from '../contracts/demo.ts';
import type { MasterSnapshot } from '../contracts/snapshot.ts';

export const ATTENTION_FLOW_SCHEMA_ID = 'pcb.attention-flow.v1';
export const ATTENTION_DISCLAIMER = 'Estimación heurística del agente (tamaño, posición y orden declarado; el contraste lo añade la superposición a partir de la captura). No es atención medida de usuarios ni eye tracking; no expresa porcentajes.';

export type FlowRole = 'main' | 'secondary' | 'offer' | 'cta' | 'other';
export interface FlowElement { order: number; nodeId: string; cloneNodeId: string; role: FlowRole; rect: Rect; center: { x: number; y: number }; area: number }
export interface AttentionFlow {
  schema: typeof ATTENTION_FLOW_SCHEMA_ID;
  disclaimer: string;
  target: { width: number; height: number };
  subject: MessagePlan['subject'];
  elements: FlowElement[];
  arrows: Array<{ from: number; to: number }>;
  /** Observaciones heurísticas (sin porcentajes) para la revisión posterior al render. */
  notes: string[];
}

export function readingFlow(clone: MasterSnapshot, idMap: Array<[string, string]>, mp: MessagePlan): AttentionFlow {
  const toClone = new Map(idMap);
  const byId = new Map(clone.nodes.map((n) => [n.id, n]));
  const root = byId.get(clone.rootNodeId)!;
  const ro = root.absoluteBoundingBox!;
  const roleOf = (id: string): FlowRole =>
    mp.main.includes(id) ? 'main' : mp.offer.includes(id) ? 'offer' : mp.cta.includes(id) ? 'cta' : mp.secondary.includes(id) ? 'secondary' : 'other';
  const elements: FlowElement[] = [];
  const notes: string[] = [];
  mp.readingPath.forEach((id, i) => {
    const cn = toClone.has(id) ? byId.get(toClone.get(id)!) : undefined;
    const b = cn?.absoluteRenderBounds ?? cn?.absoluteBoundingBox ?? null;
    if (!cn || !b) { notes.push(`El paso ${i + 1} (${id}) no tiene render en el clon: el recorrido no puede comprobarse ahí.`); return; }
    const rect = { x: b.x - ro.x, y: b.y - ro.y, width: b.width, height: b.height };
    elements.push({ order: i + 1, nodeId: id, cloneNodeId: cn.id, role: roleOf(id), rect, center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, area: rect.width * rect.height });
  });
  const arrows = elements.slice(1).map((e, i) => ({ from: elements[i]!.order, to: e.order }));

  // Heurísticas (orientativas): competencia por tamaño con el mensaje principal y saltos hacia atrás largos.
  const main = elements.filter((e) => e.role === 'main');
  const mainArea = main.reduce((s, e) => s + e.area, 0);
  for (const e of elements) {
    if (e.role !== 'main' && mainArea > 0 && e.area > mainArea) notes.push(`Paso ${e.order} (${e.nodeId}, ${e.role}) ocupa más superficie que el mensaje principal: puede competir con él antes de tiempo.`);
  }
  const diag = Math.hypot(root.width ?? 0, root.height ?? 0) || 1;
  for (const a of arrows) {
    const p = elements.find((e) => e.order === a.from)!, q = elements.find((e) => e.order === a.to)!;
    const back = q.center.y < p.rect.y && q.center.x < p.rect.x;
    if (back && Math.hypot(q.center.x - p.center.x, q.center.y - p.center.y) > diag / 3) notes.push(`Del paso ${a.from} al ${a.to} el recorrido vuelve arriba y a la izquierda con un salto largo: comprobar que el tamaño o el contraste lo justifican.`);
  }
  const cta = elements.find((e) => e.role === 'cta');
  if (cta && cta.order !== elements.length && elements.some((e) => e.order > cta.order && e.role !== 'other')) notes.push('El CTA no cierra el recorrido de mensajes: revisar si es intencionado.');
  return { schema: ATTENTION_FLOW_SCHEMA_ID, disclaimer: ATTENTION_DISCLAIMER, target: { width: root.width ?? 0, height: root.height ?? 0 }, subject: mp.subject, elements, arrows, notes };
}
