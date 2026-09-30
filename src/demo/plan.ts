// Plan de la adaptación DEMO a partir de una composición específica de la pieza (no es un planificador universal).
// Convierte "ancla → posición destino" en desplazamientos exactos por bloque y comprueba ANTES de tocar Figma que la
// composición solo usa operaciones permitidas: traslación rígida de bloques y redimensionado de efectos no-contenido.
import type { Rect } from '../contracts/geometry.ts';
import type { MasterSnapshot, NodeSnapshot } from '../contracts/snapshot.ts';
import type { DemoComposition } from '../contracts/demo.ts';

export const DEMO_PLAN_SCHEMA_ID = 'pcb.demo-plan.v1';

export interface DemoPlan {
  schema: typeof DEMO_PLAN_SCHEMA_ID;
  masterNodeId: string;
  masterName: string;
  masterSize: { width: number; height: number };
  target: DemoComposition['target'];
  moves: Array<{ unitId: string; anchorNodeId: string; nodeIds: string[]; dx: number; dy: number }>;
  /** x/y en coordenadas del frame raíz (los antecesores intermedios son GROUP, que no definen coordenadas). */
  effectResizes: Array<{ nodeId: string; x: number; y: number; width: number; height: number }>;
  /** Caja esperada de cada nodo en coordenadas del frame destino (para validar el clon). */
  expected: Record<string, { rect: Rect | null; dx: number; dy: number; resized: boolean; derived?: boolean }>;
}

export type PlanResult = { ok: true; plan: DemoPlan } | { ok: false; issues: string[] };

export function relRect(n: NodeSnapshot, root: NodeSnapshot): Rect | null {
  const b = n.absoluteBoundingBox;
  const r = root.absoluteBoundingBox;
  if (!b || !r) return null;
  return { x: b.x - r.x, y: b.y - r.y, width: b.width, height: b.height };
}

export function buildDemoPlan(s: MasterSnapshot, c: DemoComposition): PlanResult {
  const issues: string[] = [];
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const root = byId.get(s.rootNodeId);
  if (!root || root.id !== c.masterNodeId) return { ok: false, issues: [`La composición es para ${c.masterNodeId} y la instantánea para ${s.rootNodeId}`] };
  if (root.type !== 'FRAME') issues.push('La raíz no es un FRAME');
  if (root.width !== c.masterSize.width || root.height !== c.masterSize.height) {
    issues.push(`Tamaño de la maestra ${root.width}×${root.height} ≠ ${c.masterSize.width}×${c.masterSize.height} declarado en la composición`);
  }
  if (root.rotation !== 0) issues.push('La raíz está rotada');

  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    let p = byId.get(id)?.parentId ?? null;
    while (p && p !== root.id) {
      out.push(p);
      p = byId.get(p)?.parentId ?? null;
    }
    return out;
  };
  // x/y de un nodo solo es relativo al frame raíz si todos sus antecesores intermedios son GROUP.
  const coordsRelativeToRoot = (id: string) => ancestors(id).every((a) => byId.get(a)?.type === 'GROUP');

  const moved = new Map<string, string>();
  const moves: DemoPlan['moves'] = [];
  for (const u of c.units) {
    if (!u.nodeIds.includes(u.anchorNodeId)) issues.push(`${u.unitId}: el ancla no forma parte del bloque`);
    for (const id of u.nodeIds) {
      const n = byId.get(id);
      if (!n) { issues.push(`${u.unitId}: nodo desconocido ${id}`); continue; }
      if (id === root.id) issues.push(`${u.unitId}: la raíz no se traslada`);
      if (moved.has(id)) issues.push(`${id} está en dos bloques (${moved.get(id)} y ${u.unitId})`);
      moved.set(id, u.unitId);
      if (!coordsRelativeToRoot(id)) issues.push(`${u.unitId}: ${id} está dentro de un frame intermedio; trasladar su contenedor`);
    }
    const a = byId.get(u.anchorNodeId);
    const ar = a ? relRect(a, root) : null;
    if (!ar) { issues.push(`${u.unitId}: el ancla no tiene caja`); continue; }
    moves.push({ unitId: u.unitId, anchorNodeId: u.anchorNodeId, nodeIds: [...u.nodeIds], dx: u.to.x - ar.x, dy: u.to.y - ar.y });
  }
  // Un nodo trasladado no puede tener un antecesor también trasladado (se movería dos veces).
  for (const id of moved.keys()) {
    const dup = ancestors(id).find((a) => moved.has(a));
    if (dup) issues.push(`${id} y su antecesor ${dup} se trasladan a la vez`);
  }

  const locked = new Set(c.sizeLockedNodeIds);
  const important = new Set(c.importantNodeIds);
  const effectResizes: DemoPlan['effectResizes'] = [];
  for (const e of c.effectResizes) {
    const n = byId.get(e.nodeId);
    if (!n) { issues.push(`efecto desconocido ${e.nodeId}`); continue; }
    if (!['RECTANGLE', 'ELLIPSE'].includes(n.type) || n.childIds.length > 0) issues.push(`${e.nodeId}: solo se redimensionan formas simples`);
    if (n.fills === 'MIXED' || n.fills.some((f) => f.type === 'IMAGE' || f.type === 'VIDEO')) issues.push(`${e.nodeId}: tiene imagen; no es un efecto`);
    if (n.text) issues.push(`${e.nodeId}: es texto`);
    if (n.rotation !== 0) issues.push(`${e.nodeId}: rotado`);
    if (locked.has(e.nodeId) || important.has(e.nodeId)) issues.push(`${e.nodeId}: bloqueado o importante; no se redimensiona`);
    if (moved.has(e.nodeId) || ancestors(e.nodeId).some((a) => moved.has(a))) issues.push(`${e.nodeId}: no puede trasladarse y redimensionarse a la vez`);
    if (!coordsRelativeToRoot(e.nodeId)) issues.push(`${e.nodeId}: dentro de un frame intermedio`);
    effectResizes.push({ nodeId: e.nodeId, ...e.to });
  }
  for (const id of [...locked, ...important, ...c.mustCoverWidthNodeIds, ...c.protectedRegions.map((p) => p.nodeId)]) {
    if (!byId.has(id)) issues.push(`nodo desconocido en la composición: ${id}`);
  }
  // El tamaño bloqueado incluye a los descendientes (disposición interna del logo).
  for (const id of locked) {
    for (const r of c.effectResizes) if (r.nodeId === id || ancestors(r.nodeId).includes(id)) issues.push(`${r.nodeId}: dentro de un bloque de tamaño bloqueado`);
  }
  if (issues.length > 0) return { ok: false, issues };

  const deltaOf = (id: string) => {
    for (const cand of [id, ...ancestors(id)]) {
      const u = moved.get(cand);
      if (u) {
        const m = moves.find((x) => x.unitId === u)!;
        return { dx: m.dx, dy: m.dy };
      }
    }
    return { dx: 0, dy: 0 };
  };
  const expected: DemoPlan['expected'] = {};
  for (const n of s.nodes) {
    if (n.id === root.id) {
      expected[n.id] = { rect: { x: 0, y: 0, width: c.target.width, height: c.target.height }, dx: 0, dy: 0, resized: true };
      continue;
    }
    const r = effectResizes.find((e) => e.nodeId === n.id);
    if (r) {
      expected[n.id] = { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, dx: 0, dy: 0, resized: true };
      continue;
    }
    const d = deltaOf(n.id);
    // Un GROUP no tiene geometría propia: su caja se deriva de sus hijos (que se validan uno a uno).
    if (n.type === 'GROUP' && !moved.has(n.id)) {
      expected[n.id] = { rect: null, ...d, resized: false, derived: true };
      continue;
    }
    const rr = relRect(n, root);
    expected[n.id] = { rect: rr ? { x: rr.x + d.dx, y: rr.y + d.dy, width: rr.width, height: rr.height } : null, ...d, resized: false };
  }
  return {
    ok: true,
    plan: {
      schema: DEMO_PLAN_SCHEMA_ID,
      masterNodeId: root.id,
      masterName: root.name,
      masterSize: c.masterSize,
      target: c.target,
      moves,
      effectResizes,
      expected,
    },
  };
}
