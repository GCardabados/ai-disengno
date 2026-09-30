// Contratos de la primera adaptación DEMO: propuestas del agente sobre el inventario, composición específica de una
// pieza y resultado del script de escritura. Nada de esto es una aprobación humana ni una especificación de producción.
import { z } from 'zod';
import { RectSchema } from './geometry.ts';

// ---------- Propuestas del agente sobre el inventario ----------

export const AGENT_EVIDENCE_KINDS = [
  'structure', // tipo, jerarquía, geometría y pinturas de la instantánea
  'screenshot_visual_inspection', // inspección visual del agente sobre una captura (no es OCR ni detector)
  'layer_name_hint', // pista débil: el nombre de capa es un dato no confiable
  'master_constraint', // constraints/alineación fijadas por la diseñadora en la maestra
] as const;

export const AgentEvidenceSchema = z.strictObject({
  kind: z.enum(AGENT_EVIDENCE_KINDS),
  detail: z.string().min(3),
  nodeIds: z.array(z.string()),
  /** Ruta de la captura usada (solo para screenshot_visual_inspection). */
  artifact: z.string().nullable(),
});

export const ProposalGroupSchema = z.strictObject({
  groupId: z.string().regex(/^grp_[a-z0-9_]+$/),
  kind: z.enum(['logo_unit', 'cta_unit', 'message_block']),
  label: z.string(),
  /** Entidades del manifiesto que forman la unidad semántica. La maestra NO se reorganiza. */
  entityIds: z.array(z.string()).min(1),
  /** Nodos estructurales o inciertos que acompañan a la unidad (p. ej. su contenedor de recorte). */
  attachedNodeIds: z.array(z.string()),
  /** Nodo de la maestra que ya contiene la unidad y se mueve como bloque rígido (null si no hay uno). */
  rigidAncestorNodeId: z.string().nullable(),
  evidence: z.array(AgentEvidenceSchema).min(1),
});
export type ProposalGroup = z.infer<typeof ProposalGroupSchema>;

export const RoleProposalSchema = z.strictObject({
  entityId: z.string(),
  nodeIds: z.array(z.string()).min(1),
  roleId: z.string(),
  groupId: z.string().nullable(),
  /** Naturaleza que propone el agente tras la inspección visual. No sustituye a la del manifiesto. */
  proposedNature: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
  evidence: z.array(AgentEvidenceSchema).min(1),
});

export const UncertainNodeSchema = z.strictObject({
  nodeIds: z.array(z.string()).min(1),
  decision: z.literal('preserve'),
  observation: z.string(),
  hypotheses: z.array(z.string()),
  evidence: z.array(AgentEvidenceSchema).min(1),
});

export const AGENT_PROPOSALS_SCHEMA_ID = 'pcb.agent-proposals.v1';

export const AgentProposalsSchema = z.strictObject({
  schema: z.literal(AGENT_PROPOSALS_SCHEMA_ID),
  /** Siempre 'agent_proposal': nunca se interpreta como decisión humana. */
  status: z.literal('agent_proposal'),
  proposedBy: z.string(),
  createdAt: z.string(),
  manifestId: z.string(),
  manifestHash: z.string(),
  groups: z.array(ProposalGroupSchema),
  roles: z.array(RoleProposalSchema),
  uncertain: z.array(UncertainNodeSchema),
});
export type AgentProposals = z.infer<typeof AgentProposalsSchema>;

// ---------- Composición específica de una pieza (sin planificador universal) ----------

export const DEMO_COMPOSITION_SCHEMA_ID = 'pcb.demo-composition.v1';

/** Un bloque que se TRASLADA rígidamente: todos sus nodos reciben el mismo desplazamiento que su ancla. */
export const MoveUnitSchema = z.strictObject({
  unitId: z.string(),
  nodeIds: z.array(z.string()).min(1),
  anchorNodeId: z.string(),
  /** Esquina superior izquierda de la caja del ancla en coordenadas del frame destino. */
  to: z.strictObject({ x: z.number(), y: z.number() }),
  why: z.string(),
});

/** Único cambio de tamaño permitido en la demo: efectos no-contenido (degradados de legibilidad). */
export const EffectResizeSchema = z.strictObject({
  nodeId: z.string(),
  to: RectSchema,
  why: z.string(),
});

const Pt = z.strictObject({ x: z.number(), y: z.number() });

/**
 * Edición mínima de la geometría de una DECORACIÓN o de su MÁSCARA (nunca de contenido importante ni del logo).
 * Coordenadas en el frame DESTINO. `from` es la posición esperada antes de editar (guarda contra editar otro vértice).
 */
export const VectorEditSchema = z.strictObject({
  nodeId: z.string(),
  purpose: z.enum(['decoration', 'decoration_mask']),
  vertices: z.array(z.strictObject({ index: z.number().int().min(0), from: Pt, to: Pt })),
  tangents: z.array(z.strictObject({
    segment: z.number().int().min(0), start: z.number().int().min(0), end: z.number().int().min(0),
    field: z.enum(['tangentStart', 'tangentEnd']), to: Pt,
  })),
  why: z.string(),
});
export type VectorEdit = z.infer<typeof VectorEditSchema>;

export const DemoCompositionSchema = z.strictObject({
  schema: z.literal(DEMO_COMPOSITION_SCHEMA_ID),
  label: z.string(),
  masterNodeId: z.string(),
  masterSize: z.strictObject({ width: z.number(), height: z.number() }),
  target: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive(), name: z.string() }),
  /**
   * Zona segura del destino, SIEMPRE con su procedencia. 'internal_demo_rule' = margen de prueba declarado para una
   * ejecución concreta (no es una especificación); 'safe_zone_rule' = rectángulo de una regla resuelta con
   * resolveSafeZone (src/contracts/destination.ts), con su procedencia y aprobación.
   */
  safeArea: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('internal_demo_rule'), marginPx: z.number().min(0), note: z.string() }),
    z.strictObject({
      kind: z.literal('safe_zone_rule'), ruleId: z.string(), version: z.string(),
      provenance: z.enum(['platform_official', 'client', 'internal']), allowed: RectSchema, note: z.string(),
    }),
  ]),
  output: z.strictObject({ sectionName: z.string(), gapFromContentPx: z.number().min(0) }),
  units: z.array(MoveUnitSchema),
  effectResizes: z.array(EffectResizeSchema),
  vectorEdits: z.array(VectorEditSchema).default([]),
  /** Nodos cuya caja debe quedar completa dentro de la zona interna de prueba. */
  importantNodeIds: z.array(z.string()),
  /** Nodos cuyo tamaño y disposición interna deben ser idénticos a la maestra (el logo). */
  sizeLockedNodeIds: z.array(z.string()),
  /** Regiones protegidas de imágenes, en coordenadas locales del nodo. */
  protectedRegions: z.array(z.strictObject({ nodeId: z.string(), rect: RectSchema, purpose: z.string() })),
  /** Nodos que deben cubrir el ancho completo del destino (fotografía y degradado de fondo). */
  mustCoverWidthNodeIds: z.array(z.string()),
  /** Cobertura por bordes concretos (p. ej. una foto a sangre solo por la derecha y abajo en un formato horizontal). */
  mustCoverEdges: z.array(z.strictObject({ nodeId: z.string(), edges: z.array(z.enum(['left', 'right', 'top', 'bottom'])).min(1) })).default([]),
});
export type DemoComposition = z.infer<typeof DemoCompositionSchema>;

/** Rectángulo de la zona segura en coordenadas del destino, según su procedencia. */
export function safeRectOf(c: Pick<DemoComposition, 'safeArea' | 'target'>): { x: number; y: number; width: number; height: number } {
  const a = c.safeArea;
  if (a.kind === 'safe_zone_rule') return a.allowed;
  return { x: a.marginPx, y: a.marginPx, width: c.target.width - 2 * a.marginPx, height: c.target.height - 2 * a.marginPx };
}
export function safeAreaLabel(c: Pick<DemoComposition, 'safeArea'>): string {
  const a = c.safeArea;
  return a.kind === 'safe_zone_rule'
    ? `regla ${a.ruleId}@${a.version} (${a.provenance}) — ${a.note}`
    : `margen de prueba de ${a.marginPx} px por lado (regla interna de esta ejecución, no especificación) — ${a.note}`;
}

// ---------- Trabajo de adaptación: maestra y destinos (configuración, no código) ----------

export const ADAPT_JOB_SCHEMA_ID = 'pcb.adapt-job.v1';
export const AdaptJobSchema = z.strictObject({
  schema: z.literal(ADAPT_JOB_SCHEMA_ID),
  fileKey: z.string().regex(/^[0-9a-zA-Z]{22,128}$/),
  entryNodeId: z.string(),
  targetName: z.string(),
  /** Configuración del proyecto (taxonomía, restricciones por rol, tolerancias). */
  configPath: z.string(),
  destinations: z.array(z.strictObject({
    id: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** Composición específica de la pieza para este destino (dato revisable). */
    compositionPath: z.string(),
    cloneName: z.string(),
    status: z.enum(['draft', 'created', 'human_accepted']),
  })).min(1),
});
export type AdaptJob = z.infer<typeof AdaptJobSchema>;

// ---------- Aceptación humana de UN resultado concreto ----------

export const DEMO_ACCEPTANCE_SCHEMA_ID = 'pcb.demo-acceptance.v1';
export const DemoAcceptanceSchema = z.strictObject({
  schema: z.literal(DEMO_ACCEPTANCE_SCHEMA_ID),
  /** Nombre DECLARADO; no autentica a la persona. */
  acceptedBy: z.string().min(1),
  acceptedAt: z.string(),
  scope: z.string().min(10),
  fileKey: z.string(),
  cloneId: z.string(),
  target: z.strictObject({ width: z.number(), height: z.number() }),
  /** La aceptación caduca si cambia cualquiera de estas huellas. */
  cloneSnapshotSha256: z.string(),
  cloneFingerprint: z.string(),
  compositionSha256: z.string(),
  planSha256: z.string(),
  checksSha256: z.string(),
  checksAggregate: z.string(),
  notes: z.string().nullable(),
});
export type DemoAcceptance = z.infer<typeof DemoAcceptanceSchema>;

// ---------- Resultado del script de escritura ----------

export const ADAPT_RESULT_SCHEMA_ID = 'pcb.adapt.result.v1';

export const AdaptResultSchema = z.strictObject({
  schema: z.literal(ADAPT_RESULT_SCHEMA_ID),
  scriptVersion: z.string(),
  masterNodeId: z.string(),
  sectionId: z.string(),
  sectionCreated: z.boolean(),
  cloneId: z.string(),
  cloneName: z.string(),
  /** Pares [id en la maestra, id en el clon] obtenidos por recorrido paralelo del árbol. */
  idMap: z.array(z.tuple([z.string(), z.string()])),
  fonts: z.array(z.strictObject({ family: z.string(), style: z.string(), loaded: z.boolean(), requiredForOps: z.boolean(), error: z.string().nullable() })),
  mode: z.enum(['create', 'patch']).default('create'),
  applied: z.array(z.strictObject({ op: z.enum(['resize_root', 'translate', 'resize_effect', 'vector_edit']), cloneNodeId: z.string(), masterNodeId: z.string(), detail: z.unknown() })),
  master: z.strictObject({ width: z.number(), height: z.number(), childCount: z.number(), name: z.string() }),
});
export type AdaptResult = z.infer<typeof AdaptResultSchema>;
