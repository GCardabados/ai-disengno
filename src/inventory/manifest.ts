// Construcción, revisión humana, aprobación y verificación del manifiesto.
import type { MasterSnapshot } from '../contracts/snapshot.ts';
import { GLOBAL_INVARIANTS, type ProjectConfig } from '../contracts/config.ts';
import {
  MANIFEST_SCHEMA_ID,
  UNDETERMINED_NATURES,
  type Evidence,
  type Manifest,
  type ReviewDecisions,
  type SemanticEntity,
} from '../contracts/manifest.ts';
import { hashOf, shortId } from '../hash/canonical.ts';
import { diffNodes, type NodeChange } from '../hash/fingerprint.ts';
import { CLASSIFIER, DEFAULT_CONSTRAINTS, type Classification } from './classify.ts';

export function snapshotHash(s: MasterSnapshot): string {
  return hashOf('snapshot', { rootNodeId: s.rootNodeId, fileKey: s.fileKey, nodes: s.nodes });
}

function withHash(m: Omit<Manifest, 'manifestHash'>): Manifest {
  return { ...m, manifestHash: hashOf('manifest', m) };
}

function stripHash(m: Manifest): Omit<Manifest, 'manifestHash'> {
  const { manifestHash: _h, ...rest } = m;
  return rest;
}

export function verifyManifestHash(m: Manifest): boolean {
  return hashOf('manifest', stripHash(m)) === m.manifestHash;
}

export function buildDraftManifest(
  snapshot: MasterSnapshot,
  cls: Classification,
  config: ProjectConfig,
  createdAt: string,
): Manifest {
  return withHash({
    schema: MANIFEST_SCHEMA_ID,
    manifestId: shortId('man', { fp: snapshot.fingerprints.master, createdAt }),
    createdAt,
    source: snapshot.source,
    master: {
      fileKey: snapshot.fileKey,
      rootNodeId: snapshot.rootNodeId,
      pageId: snapshot.page.id,
      fingerprints: snapshot.fingerprints,
      snapshotHash: snapshotHash(snapshot),
    },
    taxonomy: { id: config.taxonomy.id, version: config.taxonomy.version },
    classifier: { id: CLASSIFIER.id, version: CLASSIFIER.version },
    detectors: { ocr: 'not_run' },
    entities: cls.entities,
    dispositions: cls.dispositions,
    compositions: cls.compositions,
    relations: [],
    approval: { status: 'draft', approvedBy: null, approvedAt: null },
  });
}

/** Plantilla que edita la persona revisora. No contiene decisiones: todo debe rellenarse explícitamente. */
export function buildReviewTemplate(m: Manifest): Record<string, unknown> {
  return {
    schema: 'pcb.review.v1',
    manifestHash: m.manifestHash,
    reviewer: '',
    _instructions:
      'Rellene cada entidad con status (approved|rejected), role y, si cambia la naturaleza del contenido, statement. ' +
      'Resuelva cada nodo pendiente y cada composición. Elimine este campo _instructions antes de aplicar.',
    entities: Object.fromEntries(
      m.entities.map((e) => [e.entityId, { status: null, role: e.roleHints[0]?.roleId ?? null, _currentNature: e.contentNature, _reasons: e.review.reasons }]),
    ),
    pending: Object.fromEntries(
      m.dispositions.filter((d) => d.kind === 'pending').map((d) => [d.nodeId, { resolution: null, _reasons: d.kind === 'pending' ? d.reasons : [] }]),
    ),
    compositions: Object.fromEntries(m.compositions.map((c) => [c.compositionId, { status: null }])),
    relations: [],
  };
}

export interface ReviewIssue {
  code: string;
  message: string;
}

/** Aplica decisiones humanas. Devuelve un manifiesto todavía en borrador (la aprobación es un paso aparte). */
export function applyReview(
  m: Manifest,
  review: ReviewDecisions,
  config: ProjectConfig,
  at: string,
): { ok: true; manifest: Manifest } | { ok: false; issues: ReviewIssue[] } {
  const issues: ReviewIssue[] = [];
  if (m.approval.status !== 'draft') issues.push({ code: 'NOT_DRAFT', message: 'Solo se revisan manifiestos en borrador.' });
  if (review.manifestHash !== m.manifestHash) {
    issues.push({ code: 'REVIEW_FOR_OTHER_MANIFEST', message: 'La revisión corresponde a otro manifiesto (hash distinto).' });
  }
  if (!verifyManifestHash(m)) issues.push({ code: 'MANIFEST_HASH_INVALID', message: 'El manifiesto ha sido alterado.' });
  if (issues.length > 0) return { ok: false, issues };

  const roles = new Map(config.taxonomy.roles.map((r) => [r.id, r]));
  const human = (detail: string, nodeIds: string[]): Evidence => ({
    kind: 'human_statement',
    detail,
    producedBy: review.reviewer,
    version: at,
    trust: 'high',
    nodeIds,
  });

  const entities: SemanticEntity[] = structuredClone(m.entities);
  const known = new Set(entities.map((e) => e.entityId));
  for (const id of Object.keys(review.entities)) {
    if (!known.has(id)) issues.push({ code: 'UNKNOWN_ENTITY', message: id });
  }
  for (const e of entities) {
    const d = review.entities[e.entityId];
    if (!d) continue;
    if (d.role !== undefined) {
      if (!roles.has(d.role)) issues.push({ code: 'UNKNOWN_ROLE', message: `${e.entityId}: ${d.role}` });
      e.role = d.role;
    }
    if (d.contentNature !== undefined && d.contentNature !== e.contentNature) {
      if (!d.statement) {
        issues.push({ code: 'NATURE_CHANGE_WITHOUT_STATEMENT', message: `${e.entityId}: cambiar la naturaleza exige statement` });
      } else {
        e.evidence.push(human(`Naturaleza ${e.contentNature} → ${d.contentNature}: ${d.statement}`, e.nodeIds));
        e.contentNature = d.contentNature;
      }
    }
    const roleDef = e.role ? roles.get(e.role) : undefined;
    const base = roleDef
      ? { ...DEFAULT_CONSTRAINTS, allowOps: [...roleDef.defaultAllowOps], mustBeInSafeZone: roleDef.mustBeInSafeZone }
      : structuredClone(DEFAULT_CONSTRAINTS);
    e.constraints = { ...base, ...(d.constraints ?? {}) } as SemanticEntity['constraints'];
    e.review = {
      status: d.status,
      reasons: e.review.reasons,
      reviewedBy: review.reviewer,
      reviewedAt: at,
      notes: d.notes ?? null,
    };
  }

  const dispositions = structuredClone(m.dispositions);
  for (const [nodeId, pd] of Object.entries(review.pending)) {
    const idx = dispositions.findIndex((d) => d.nodeId === nodeId);
    const cur = dispositions[idx];
    if (!cur || cur.kind !== 'pending') {
      issues.push({ code: 'NOT_PENDING', message: nodeId });
      continue;
    }
    if (pd.resolution === 'structural') {
      if (pd.justification === 'hidden_non_content' && !cur.reasons.includes('HIDDEN_OR_IN_HIDDEN_ANCESTOR')) {
        issues.push({ code: 'HIDDEN_JUSTIFICATION_ON_VISIBLE_NODE', message: nodeId });
        continue;
      }
      dispositions[idx] = {
        kind: 'structural',
        nodeId,
        justification: pd.justification,
        evidence: [human(pd.statement, [nodeId])],
        decidedBy: 'human',
        statement: pd.statement,
      };
    } else {
      if (!roles.has(pd.role)) issues.push({ code: 'UNKNOWN_ROLE', message: `${nodeId}: ${pd.role}` });
      const entityId = shortId('ent', [nodeId]);
      const roleDef = roles.get(pd.role);
      entities.push({
        entityId,
        role: pd.role,
        roleHints: [],
        nodeIds: [nodeId],
        contentNature: pd.contentNature,
        evidence: [human(pd.statement, [nodeId])],
        review: { status: 'approved', reasons: [], reviewedBy: review.reviewer, reviewedAt: at, notes: null },
        constraints: roleDef
          ? { ...DEFAULT_CONSTRAINTS, allowOps: [...roleDef.defaultAllowOps], mustBeInSafeZone: roleDef.mustBeInSafeZone }
          : structuredClone(DEFAULT_CONSTRAINTS),
      });
      dispositions[idx] = { kind: 'content', nodeId, entityId };
    }
  }

  const compositions = structuredClone(m.compositions);
  for (const [cid, cd] of Object.entries(review.compositions)) {
    const c = compositions.find((x) => x.compositionId === cid);
    if (!c) {
      issues.push({ code: 'UNKNOWN_COMPOSITION', message: cid });
      continue;
    }
    c.status = cd.status;
    c.decidedBy = review.reviewer;
    c.statement = cd.statement ?? null;
  }

  const entityIds = new Set(entities.map((e) => e.entityId));
  for (const r of review.relations) {
    if (!entityIds.has(r.subject) || !entityIds.has(r.object)) {
      issues.push({ code: 'RELATION_UNKNOWN_ENTITY', message: r.relationId });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    manifest: withHash({ ...stripHash(m), entities, dispositions, compositions, relations: [...m.relations, ...review.relations] }),
  };
}

/** Comprueba que las restricciones de una entidad no relajan invariantes globales. */
export function constraintIssues(e: SemanticEntity, config: ProjectConfig): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const role = e.role ? config.taxonomy.roles.find((r) => r.id === e.role) : undefined;
  if (role?.protection === 'logo') {
    const extra = e.constraints.allowOps.filter((op) => !GLOBAL_INVARIANTS.logoAllowedOps.includes(op));
    if (extra.length > 0 || e.constraints.allowReflow !== GLOBAL_INVARIANTS.logoAllowReflow) {
      issues.push({
        code: 'ENTITY_CONSTRAINT_LOOSENS_INVARIANT',
        message: `${e.entityId} (logo): allowOps=${e.constraints.allowOps.join(',') || '∅'} allowReflow=${e.constraints.allowReflow}`,
      });
    }
    if (e.constraints.mustBeInSafeZone === false) {
      issues.push({ code: 'ENTITY_CONSTRAINT_LOOSENS_INVARIANT', message: `${e.entityId} (logo): mustBeInSafeZone=false` });
    }
  }
  if (role && role.protection !== 'decorative' && role.mustBeInSafeZone && e.constraints.mustBeInSafeZone === false) {
    issues.push({ code: 'ENTITY_CONSTRAINT_LOOSENS_ROLE', message: `${e.entityId}: el rol exige safe zone` });
  }
  if (e.constraints.allowOps.includes('resize_text_box') && e.contentNature !== 'editable_text') {
    issues.push({ code: 'OP_NOT_APPLICABLE', message: `${e.entityId}: resize_text_box solo para texto editable` });
  }
  if (e.constraints.allowReflow && !e.constraints.allowOps.includes('resize_text_box')) {
    issues.push({ code: 'REFLOW_WITHOUT_OP', message: `${e.entityId}: allowReflow sin resize_text_box` });
  }
  if (e.constraints.allowOps.includes('recrop_background') && !e.contentNature.startsWith('image_')) {
    issues.push({ code: 'OP_NOT_APPLICABLE', message: `${e.entityId}: recrop_background solo para imágenes` });
  }
  return issues;
}

export function approvalIssues(m: Manifest, current: MasterSnapshot, config: ProjectConfig, by: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (!verifyManifestHash(m)) issues.push({ code: 'MANIFEST_HASH_INVALID', message: 'Manifiesto alterado.' });
  if (m.approval.status !== 'draft') issues.push({ code: 'NOT_DRAFT', message: 'Ya aprobado.' });
  if (!by.trim()) issues.push({ code: 'APPROVER_MISSING', message: 'Falta la persona que aprueba.' });
  if (config.approvers.length > 0 && !config.approvers.includes(by)) {
    issues.push({ code: 'APPROVER_NOT_AUTHORIZED', message: 'La persona no figura en config.approvers.' });
  }
  if (m.source !== current.source) issues.push({ code: 'SOURCE_MISMATCH', message: `${m.source} ≠ ${current.source}` });
  if (current.fingerprints.master !== m.master.fingerprints.master) {
    issues.push({ code: 'MASTER_CHANGED_SINCE_INVENTORY', message: 'La maestra ha cambiado desde que se inventarió.' });
  }
  for (const d of m.dispositions) {
    if (d.kind === 'pending') issues.push({ code: 'PENDING_NODE', message: `${d.nodeId}: ${d.reasons.join(',')}` });
  }
  const roles = new Map(config.taxonomy.roles.map((r) => [r.id, r]));
  const count = new Map<string, number>();
  for (const e of m.entities) {
    if (e.review.status !== 'approved') issues.push({ code: 'ENTITY_NOT_APPROVED', message: `${e.entityId}: ${e.review.status}` });
    if (!e.role || !roles.has(e.role)) issues.push({ code: 'ROLE_INVALID', message: `${e.entityId}: ${e.role ?? 'null'}` });
    else count.set(e.role, (count.get(e.role) ?? 0) + 1);
    if (UNDETERMINED_NATURES.includes(e.contentNature)) {
      issues.push({ code: 'NATURE_UNDETERMINED', message: `${e.entityId}: ${e.contentNature}` });
    }
    issues.push(...constraintIssues(e, config));
  }
  for (const r of config.taxonomy.roles) {
    const n = count.get(r.id) ?? 0;
    if (n < r.multiplicity.min || (r.multiplicity.max !== null && n > r.multiplicity.max)) {
      issues.push({ code: 'ROLE_MULTIPLICITY', message: `${r.id}: ${n} (min ${r.multiplicity.min}, max ${r.multiplicity.max ?? '∞'})` });
    }
  }
  for (const c of m.compositions) {
    if (c.status === 'proposed') issues.push({ code: 'COMPOSITION_UNRESOLVED', message: c.compositionId });
  }
  for (const nid of current.environment.nodesWithMissingFont) {
    issues.push({ code: 'FONT_MISSING_BLOCKS_APPROVAL', message: `${nid}: la maestra se está leyendo con una fuente de sustitución` });
  }
  return issues;
}

export function approveManifest(
  m: Manifest,
  current: MasterSnapshot,
  config: ProjectConfig,
  by: string,
  at: string,
): { ok: true; manifest: Manifest } | { ok: false; issues: ReviewIssue[] } {
  const issues = approvalIssues(m, current, config, by);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest: withHash({ ...stripHash(m), approval: { status: 'approved', approvedBy: by, approvedAt: at } }) };
}

export interface MasterVerification {
  unchanged: boolean;
  fingerprintsEqual: Record<'master' | 'structure' | 'content' | 'layout' | 'metadata', boolean>;
  changes: NodeChange[];
}

/**
 * Comprueba que la maestra no ha cambiado desde el manifiesto. CUALQUIER diferencia invalida la aprobación;
 * el diff por categoría solo sirve para que la persona entienda qué cambió.
 */
export function verifyMasterUnchanged(m: Manifest, approvedSnapshot: MasterSnapshot, current: MasterSnapshot): MasterVerification {
  if (snapshotHash(approvedSnapshot) !== m.master.snapshotHash) {
    throw new Error('La instantánea aprobada no corresponde al manifiesto (snapshotHash distinto).');
  }
  const a = m.master.fingerprints;
  const b = current.fingerprints;
  const fingerprintsEqual = {
    master: a.master === b.master,
    structure: a.structure === b.structure,
    content: a.content === b.content,
    layout: a.layout === b.layout,
    metadata: a.metadata === b.metadata,
  };
  const changes = fingerprintsEqual.master ? [] : diffNodes(approvedSnapshot.nodes, current.nodes, m.master.rootNodeId);
  return { unchanged: fingerprintsEqual.master && current.rootNodeId === m.master.rootNodeId && current.fileKey === m.master.fileKey, fingerprintsEqual, changes };
}
