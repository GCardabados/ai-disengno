// Validación de las propuestas del agente contra el manifiesto borrador.
// Las propuestas completan roles y agrupaciones semánticas (logo, CTA) SIN reorganizar la maestra y SIN aprobar nada:
// el manifiesto sigue en borrador y la revisión humana sigue siendo obligatoria.
import type { ProjectConfig } from '../contracts/config.ts';
import type { Manifest } from '../contracts/manifest.ts';
import type { AgentProposals } from '../contracts/demo.ts';

export interface ProposalIssue {
  code: string;
  message: string;
}

export function validateProposals(m: Manifest, p: AgentProposals, cfg: ProjectConfig): ProposalIssue[] {
  const issues: ProposalIssue[] = [];
  if (p.manifestHash !== m.manifestHash || p.manifestId !== m.manifestId) {
    issues.push({ code: 'PROPOSALS_FOR_OTHER_MANIFEST', message: 'Las propuestas se hicieron para otro manifiesto.' });
  }
  const entities = new Map(m.entities.map((e) => [e.entityId, e]));
  const allNodes = new Set(m.dispositions.map((d) => d.nodeId));
  const roleIds = new Set(cfg.taxonomy.roles.map((r) => r.id));
  const groups = new Map(p.groups.map((g) => [g.groupId, g]));

  const seen = new Map<string, number>();
  for (const r of p.roles) {
    seen.set(r.entityId, (seen.get(r.entityId) ?? 0) + 1);
    const e = entities.get(r.entityId);
    if (!e) {
      issues.push({ code: 'UNKNOWN_ENTITY', message: `rol propuesto para ${r.entityId}, que no existe` });
      continue;
    }
    if ([...r.nodeIds].sort().join() !== [...e.nodeIds].sort().join()) {
      issues.push({ code: 'ENTITY_NODES_MISMATCH', message: `${r.entityId}: los nodos citados no coinciden con la entidad` });
    }
    if (!roleIds.has(r.roleId)) issues.push({ code: 'ROLE_NOT_IN_TAXONOMY', message: `${r.entityId}: rol ${r.roleId}` });
    if (r.groupId !== null && !groups.get(r.groupId)?.entityIds.includes(r.entityId)) {
      issues.push({ code: 'GROUP_MEMBERSHIP_INCONSISTENT', message: `${r.entityId} cita ${r.groupId} pero no es miembro` });
    }
  }
  for (const e of m.entities) {
    const n = seen.get(e.entityId) ?? 0;
    if (n !== 1) issues.push({ code: n === 0 ? 'ROLE_MISSING' : 'ROLE_DUPLICATED', message: `${e.entityId} (${e.nodeIds.join(',')})` });
  }

  const inGroup = new Map<string, string>();
  for (const g of p.groups) {
    for (const id of g.entityIds) {
      if (!entities.has(id)) issues.push({ code: 'UNKNOWN_ENTITY', message: `${g.groupId}: ${id}` });
      const prev = inGroup.get(id);
      if (prev) issues.push({ code: 'ENTITY_IN_TWO_GROUPS', message: `${id} en ${prev} y ${g.groupId}` });
      inGroup.set(id, g.groupId);
    }
    for (const n of [...g.attachedNodeIds, ...(g.rigidAncestorNodeId ? [g.rigidAncestorNodeId] : [])]) {
      if (!allNodes.has(n)) issues.push({ code: 'UNKNOWN_NODE', message: `${g.groupId}: ${n}` });
    }
  }
  for (const u of p.uncertain) {
    for (const n of u.nodeIds) if (!allNodes.has(n)) issues.push({ code: 'UNKNOWN_NODE', message: `incierto: ${n}` });
  }

  // Multiplicidad de la taxonomía contando la UNIDAD semántica (un logo en dos entidades cuenta como uno).
  for (const role of cfg.taxonomy.roles) {
    const units = new Set(p.roles.filter((r) => r.roleId === role.id).map((r) => r.groupId ?? r.entityId));
    const max = role.multiplicity.max;
    if (units.size < role.multiplicity.min || (max !== null && units.size > max)) {
      issues.push({ code: 'ROLE_MULTIPLICITY', message: `${role.id}: ${units.size} unidad(es), admitido ${role.multiplicity.min}..${max ?? '∞'}` });
    }
  }
  return issues;
}
