// Utilidades recurrentes del flujo de adaptación (antes eran scripts sueltos en runs/). No contienen datos de ninguna
// pieza: todo lo específico llega por la composición, las propuestas y la configuración.
import type { MasterSnapshot } from '../contracts/snapshot.ts';
import type { Rect } from '../contracts/geometry.ts';
import type { AgentProposals, DemoAcceptance, DemoComposition } from '../contracts/demo.ts';
import { DEMO_ACCEPTANCE_SCHEMA_ID, safeAreaLabel, safeRectOf } from '../contracts/demo.ts';
import type { Manifest } from '../contracts/manifest.ts';
import { canonicalize, sha256Hex } from '../hash/canonical.ts';
import { contentProjection } from '../hash/fingerprint.ts';
import { relRect, type DemoPlan } from './plan.ts';

// ---------- Comparación de dos maestras (p. ej. original y copia en otro archivo) ----------

export interface MasterComparison {
  identical: boolean;
  idMap: Array<[string, string]>;
  diffs: Array<{ a: string; b: string; name: string; keys: string[] }>;
}

/** Compara en preorden, SIN IDs: contenido, nombre, estructura y geometría relativa al frame (±tolPx). */
export function compareMasters(a: MasterSnapshot, b: MasterSnapshot, tolPx = 1e-3): MasterComparison {
  if (a.nodes.length !== b.nodes.length) {
    return { identical: false, idMap: [], diffs: [{ a: a.rootNodeId, b: b.rootNodeId, name: '(raíz)', keys: ['nodeCount'] }] };
  }
  const ra = a.nodes[0]!, rb = b.nodes[0]!;
  const idMap: Array<[string, string]> = [];
  const diffs: MasterComparison['diffs'] = [];
  a.nodes.forEach((n, i) => {
    const m = b.nodes[i]!;
    idMap.push([n.id, m.id]);
    const ca = contentProjection(n) as Record<string, unknown>, cb = contentProjection(m) as Record<string, unknown>;
    const keys = Object.keys(ca).filter((k) => canonicalize(ca[k]) !== canonicalize(cb[k]));
    if (n.name !== m.name) keys.push('name');
    if (n.depth !== m.depth || n.childIds.length !== m.childIds.length) keys.push('structure');
    const la = relRect(n, ra), lb = relRect(m, rb);
    const d = la && lb ? Math.max(Math.abs(la.x - lb.x), Math.abs(la.y - lb.y), Math.abs(la.width - lb.width), Math.abs(la.height - lb.height)) : 0;
    if (d > tolPx) keys.push(`layout(Δ${d})`);
    if (keys.length) diffs.push({ a: n.id, b: m.id, name: n.name, keys });
  });
  return { identical: diffs.length === 0, idMap, diffs };
}

/** Traduce todos los ids de nodo de un objeto (composición, propuestas…) con una correspondencia. */
export function remapNodeIds<T>(value: T, idMap: Array<[string, string]>): T {
  const m = new Map(idMap);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return m.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Reasigna las propuestas a un manifiesto nuevo: ids de nodo por la correspondencia y entidades por sus nodos. */
export function remapProposals(p: AgentProposals, idMap: Array<[string, string]>, manifest: Manifest): AgentProposals {
  const q = remapNodeIds(p, idMap);
  const byNodes = new Map(manifest.entities.map((e) => [[...e.nodeIds].sort().join(','), e.entityId]));
  const ent = new Map<string, string>();
  for (const r of q.roles) {
    const id = byNodes.get([...r.nodeIds].sort().join(','));
    if (!id) throw new Error(`Sin entidad para los nodos ${r.nodeIds.join(',')} en ${manifest.manifestId}`);
    ent.set(r.entityId, id);
  }
  return {
    ...q,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    roles: q.roles.map((r) => ({ ...r, entityId: ent.get(r.entityId)! })),
    groups: q.groups.map((g) => ({ ...g, entityIds: g.entityIds.map((e) => ent.get(e) ?? e) })),
  };
}

// ---------- Ayuda para componer un destino ----------

export interface LayoutRow { id: string; type: string; depth: number; name: string; rect: Rect | null; text: boolean; image: boolean; mask: boolean }

/** Cajas relativas al frame de los nodos hasta `maxDepth` (para decidir bloques y destinos de una composición). */
export function layoutSummary(s: MasterSnapshot, maxDepth = 2): LayoutRow[] {
  const root = s.nodes.find((n) => n.id === s.rootNodeId)!;
  return s.nodes.filter((n) => n.depth <= maxDepth || n.text).map((n) => ({
    id: n.id, type: n.type, depth: n.depth, name: n.name.slice(0, 40), rect: relRect(n, root), text: !!n.text,
    image: n.fills !== 'MIXED' && n.fills.some((f) => f.type === 'IMAGE' && f.visible), mask: n.isMask,
  }));
}

export interface PrecheckFinding { code: string; nodeId: string; detail: string }

/**
 * Predicción SOBRE EL PLAN (antes de escribir): zona segura, salida del frame, cobertura y regiones protegidas frente a
 * cajas de texto. No sustituye a demo-check sobre la relectura del clon; sirve para iterar la composición sin tocar Figma.
 */
export function precheckPlan(plan: DemoPlan, c: DemoComposition, textNodeIds: string[]): PrecheckFinding[] {
  const out: PrecheckFinding[] = [];
  const W = c.target.width, H = c.target.height, safe = safeRectOf(c);
  const inside = (r: Rect, o: Rect) => r.x >= o.x && r.y >= o.y && r.x + r.width <= o.x + o.width && r.y + r.height <= o.y + o.height;
  const rect = (id: string) => plan.expected[id]?.rect ?? null;
  for (const id of c.importantNodeIds) {
    const r = rect(id);
    if (!r) { out.push({ code: 'NO_PREDICTION', nodeId: id, detail: 'sin caja prevista' }); continue; }
    if (!inside(r, { x: 0, y: 0, width: W, height: H })) out.push({ code: 'CLIPPED_BY_FRAME', nodeId: id, detail: JSON.stringify(r) });
    else if (!inside(r, safe)) out.push({ code: 'OUTSIDE_SAFE_AREA', nodeId: id, detail: `${JSON.stringify(r)} · ${safeAreaLabel(c)}` });
  }
  for (const id of c.mustCoverWidthNodeIds) {
    const r = rect(id);
    if (r && (r.x > 0 || r.x + r.width < W || r.y + r.height < H)) out.push({ code: 'COVERAGE', nodeId: id, detail: JSON.stringify(r) });
  }
  for (const ce of c.mustCoverEdges) {
    const r = rect(ce.nodeId);
    if (!r) continue;
    const miss = ce.edges.filter((e) => (e === 'left' && r.x > 0) || (e === 'top' && r.y > 0) || (e === 'right' && r.x + r.width < W) || (e === 'bottom' && r.y + r.height < H));
    if (miss.length) out.push({ code: 'EDGE_UNCOVERED', nodeId: ce.nodeId, detail: miss.join(',') });
  }
  for (const pr of c.protectedRegions) {
    const b = rect(pr.nodeId);
    if (!b) continue;
    const reg = { x: b.x + pr.rect.x, y: b.y + pr.rect.y, width: pr.rect.width, height: pr.rect.height };
    if (!inside(reg, { x: 0, y: 0, width: W, height: H })) out.push({ code: 'PROTECTED_REGION_CROPPED', nodeId: pr.nodeId, detail: pr.purpose });
    for (const t of textNodeIds) {
      const r = rect(t);
      if (r && Math.min(reg.x + reg.width, r.x + r.width) > Math.max(reg.x, r.x) && Math.min(reg.y + reg.height, r.y + r.height) > Math.max(reg.y, r.y)) {
        out.push({ code: 'TEXT_OVER_PROTECTED_REGION', nodeId: t, detail: pr.purpose });
      }
    }
  }
  // Solapes entre textos importantes (cajas): un solape de cajas no prueba solape de glifos, pero conviene revisarlo.
  const texts = textNodeIds.filter((t) => c.importantNodeIds.includes(t));
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = rect(texts[i]!), b = rect(texts[j]!);
    if (a && b && Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)) {
      out.push({ code: 'TEXT_BOXES_OVERLAP', nodeId: `${texts[i]}+${texts[j]}`, detail: 'cajas de texto solapadas' });
    }
  }
  return out;
}

// ---------- Aceptación humana de un resultado concreto ----------

export function buildAcceptance(input: {
  acceptedBy: string; acceptedAt: string; scope: string; notes: string | null; fileKey: string;
  clone: MasterSnapshot; compositionText: string; planText: string; checksText: string; checksAggregate: string;
}): DemoAcceptance {
  const root = input.clone.nodes.find((n) => n.id === input.clone.rootNodeId)!;
  return {
    schema: DEMO_ACCEPTANCE_SCHEMA_ID,
    acceptedBy: input.acceptedBy,
    acceptedAt: input.acceptedAt,
    scope: input.scope,
    fileKey: input.fileKey,
    cloneId: input.clone.rootNodeId,
    target: { width: root.width ?? 0, height: root.height ?? 0 },
    cloneSnapshotSha256: `sha256:${sha256Hex(canonicalize(input.clone.nodes))}`,
    cloneFingerprint: input.clone.fingerprints.master,
    compositionSha256: `sha256:${sha256Hex(input.compositionText)}`,
    planSha256: `sha256:${sha256Hex(input.planText)}`,
    checksSha256: `sha256:${sha256Hex(input.checksText)}`,
    checksAggregate: input.checksAggregate,
    notes: input.notes,
  };
}
