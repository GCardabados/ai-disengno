// Inventario semántico: entidades, disposición de cada nodo, composiciones y relaciones.
import { s, type Infer } from './schema.ts';
import { RectSchema } from './geometry.ts';
import { ENTITY_OPS, PROTECTION_LEVELS } from './config.ts';
import { FingerprintsSchema } from './snapshot.ts';

export const CONTENT_NATURES = [
  'editable_text',
  'image_no_text_detected', // SOLO si un detector se ejecutó y no encontró texto
  'image_text_undetermined', // no hay detector ejecutado o no es concluyente
  'image_embedded_text',
  'image_with_editable_text_overlay', // solo para composiciones aceptadas
  'vectorized_text',
  'vector_graphic',
  'vector_undetermined',
  'shape',
  'mixed_composition',
  'unknown',
] as const;
export type ContentNature = (typeof CONTENT_NATURES)[number];

/** Naturalezas que impiden aprobar hasta que una persona las resuelva. */
export const UNDETERMINED_NATURES: readonly ContentNature[] = ['image_text_undetermined', 'vector_undetermined', 'unknown'];

export const EVIDENCE_KINDS = [
  'node_type',
  'image_fill',
  'text_node',
  'geometry_overlap',
  'vector_cluster',
  'vector_glyph_heuristic',
  'layer_name_hint',
  'ocr_local',
  'human_statement',
  'component_ref',
  'paint_analysis',
  'mask_flag',
] as const;

export const EvidenceSchema = s.object({
  kind: s.enumOf(EVIDENCE_KINDS),
  detail: s.string(),
  producedBy: s.string(),
  version: s.string(),
  trust: s.enumOf(['low', 'medium', 'high'] as const),
  nodeIds: s.array(s.string()),
});
export type Evidence = Infer<typeof EvidenceSchema>;

export const STRUCTURAL_JUSTIFICATIONS = [
  'root',
  'container',
  'clip_container',
  'mask',
  'layout_wrapper',
  'instance_root',
  'boolean_operand',
  'hidden_non_content', // solo puede asignarlo una persona
] as const;
export type StructuralJustification = (typeof STRUCTURAL_JUSTIFICATIONS)[number];

export const PENDING_REASONS = [
  'HIDDEN_OR_IN_HIDDEN_ANCESTOR',
  'ZERO_OPACITY',
  'READ_ERRORS',
  'UNSUPPORTED_VIDEO_PAINT',
  'UNSUPPORTED_NODE_TYPE',
  'NO_VISIBLE_PAINT',
  'EMPTY_CONTAINER',
] as const;

export const NodeDispositionSchema = s.discriminated('kind', {
  content: s.object({ kind: s.literal('content'), nodeId: s.string(), entityId: s.string() }),
  structural: s.object({
    kind: s.literal('structural'),
    nodeId: s.string(),
    justification: s.enumOf(STRUCTURAL_JUSTIFICATIONS),
    evidence: s.array(EvidenceSchema),
    decidedBy: s.enumOf(['classifier', 'human'] as const),
    statement: s.nullable(s.string()),
  }),
  pending: s.object({
    kind: s.literal('pending'),
    nodeId: s.string(),
    reasons: s.array(s.enumOf(PENDING_REASONS), { min: 1 }),
  }),
});
export type NodeDisposition = Infer<typeof NodeDispositionSchema>;

export const ProtectedRegionSchema = s.object({
  regionId: s.string(),
  nodeId: s.string(),
  /** Rectángulo en coordenadas locales del nodo. */
  rect: RectSchema,
  purpose: s.string(),
});

export const EntityConstraintsSchema = s.object({
  allowOps: s.array(s.enumOf(ENTITY_OPS)),
  allowReflow: s.boolean(),
  atomicGroup: s.nullable(s.string()),
  protectedRegions: s.array(ProtectedRegionSchema),
  mustBeInSafeZone: s.nullable(s.boolean()),
});
export type EntityConstraints = Infer<typeof EntityConstraintsSchema>;

export const REVIEW_REASONS = [
  'ROLE_UNASSIGNED',
  'TEXT_DETECTION_NOT_RUN',
  'FONT_MISSING',
  'TEXT_SEGMENTS_INCOMPLETE',
  'VECTOR_NATURE_UNDETERMINED',
  'POSSIBLE_VECTORIZED_TEXT',
  'EDITABLE_TEXT_OVERLAY_ON_IMAGE',
  'RENDER_BOUNDS_UNAVAILABLE',
  'MIXED_CONTAINER_PAINT',
] as const;

export const SemanticEntitySchema = s.object({
  entityId: s.string({ pattern: /^ent_[0-9a-f]{12}$/ }),
  role: s.nullable(s.string()),
  roleHints: s.array(s.object({ roleId: s.string(), evidence: EvidenceSchema })),
  nodeIds: s.array(s.string(), { min: 1 }),
  contentNature: s.enumOf(CONTENT_NATURES),
  evidence: s.array(EvidenceSchema),
  review: s.object({
    status: s.enumOf(['proposed', 'needs_review', 'approved', 'rejected'] as const),
    reasons: s.array(s.enumOf(REVIEW_REASONS)),
    reviewedBy: s.nullable(s.string()),
    reviewedAt: s.nullable(s.string()),
    notes: s.nullable(s.string()),
  }),
  constraints: EntityConstraintsSchema,
});
export type SemanticEntity = Infer<typeof SemanticEntitySchema>;

/** Propuesta de composición (p. ej. imagen + texto editable superpuesto). La acepta o rechaza una persona. */
export const CompositionSchema = s.object({
  compositionId: s.string({ pattern: /^cmp_[0-9a-f]{12}$/ }),
  nature: s.enumOf(['image_with_editable_text_overlay', 'mixed_composition'] as const),
  entityIds: s.array(s.string(), { min: 2 }),
  evidence: s.array(EvidenceSchema),
  status: s.enumOf(['proposed', 'accepted', 'rejected'] as const),
  decidedBy: s.nullable(s.string()),
  statement: s.nullable(s.string()),
});
export type Composition = Infer<typeof CompositionSchema>;

export const RELATION_KINDS = ['rigid', 'contained_in', 'order', 'min_gap', 'z_above', 'aligned'] as const;
export const RelationSchema = s.object({
  relationId: s.string(),
  kind: s.enumOf(RELATION_KINDS),
  subject: s.string(),
  object: s.string(),
  params: s.object(
    {
      axis: s.optional(s.enumOf(['x', 'y'] as const)),
      direction: s.optional(s.enumOf(['before', 'after'] as const)),
      px: s.optional(s.number({ min: 0 })),
      edge: s.optional(s.enumOf(['left', 'right', 'top', 'bottom', 'center_x', 'center_y'] as const)),
    },
  ),
  declaredBy: s.string(),
});
export type Relation = Infer<typeof RelationSchema>;

export const MANIFEST_SCHEMA_ID = 'pcb.manifest.v1';

export const ManifestSchema = s.object({
  schema: s.literal(MANIFEST_SCHEMA_ID),
  manifestId: s.string(),
  createdAt: s.string(),
  source: s.enumOf(['FIGMA_MCP_USE_FIGMA', 'MOCK'] as const),
  master: s.object({
    fileKey: s.string(),
    rootNodeId: s.string(),
    pageId: s.string(),
    fingerprints: FingerprintsSchema,
    snapshotHash: s.string(),
  }),
  taxonomy: s.object({ id: s.string(), version: s.string() }),
  classifier: s.object({ id: s.string(), version: s.string() }),
  detectors: s.object({ ocr: s.enumOf(['not_run', 'run'] as const) }),
  entities: s.array(SemanticEntitySchema),
  dispositions: s.array(NodeDispositionSchema),
  compositions: s.array(CompositionSchema),
  relations: s.array(RelationSchema),
  approval: s.object({
    status: s.enumOf(['draft', 'approved'] as const),
    approvedBy: s.nullable(s.string()),
    approvedAt: s.nullable(s.string()),
  }),
  /** Hash canónico de todo el manifiesto excepto este campo. */
  manifestHash: s.string(),
});
export type Manifest = Infer<typeof ManifestSchema>;

// ---------- Revisión humana (archivo editable) ----------

export const EntityDecisionSchema = s.object({
  status: s.enumOf(['approved', 'rejected'] as const),
  role: s.optional(s.string()),
  contentNature: s.optional(s.enumOf(CONTENT_NATURES)),
  /** Obligatorio cuando se cambia la naturaleza del contenido. Queda como evidencia human_statement. */
  statement: s.optional(s.string({ min: 3 })),
  constraints: s.optional(
    s.object({
      allowOps: s.optional(s.array(s.enumOf(ENTITY_OPS))),
      allowReflow: s.optional(s.boolean()),
      atomicGroup: s.optional(s.nullable(s.string())),
      protectedRegions: s.optional(s.array(ProtectedRegionSchema)),
      mustBeInSafeZone: s.optional(s.nullable(s.boolean())),
    }),
  ),
  notes: s.optional(s.string()),
});

export const PendingDecisionSchema = s.discriminated('resolution', {
  structural: s.object({
    resolution: s.literal('structural'),
    justification: s.enumOf(STRUCTURAL_JUSTIFICATIONS),
    statement: s.string({ min: 3 }),
  }),
  entity: s.object({
    resolution: s.literal('entity'),
    role: s.string(),
    contentNature: s.enumOf(CONTENT_NATURES),
    statement: s.string({ min: 3 }),
  }),
});

export const ReviewDecisionsSchema = s.object({
  schema: s.literal('pcb.review.v1'),
  /** Hash del manifiesto borrador al que se aplica: evita aplicar una revisión a otro inventario. */
  manifestHash: s.string(),
  reviewer: s.string({ min: 1 }),
  entities: s.record(EntityDecisionSchema),
  pending: s.record(PendingDecisionSchema),
  compositions: s.record(
    s.object({ status: s.enumOf(['accepted', 'rejected'] as const), statement: s.optional(s.string()) }),
  ),
  relations: s.array(RelationSchema),
});
export type ReviewDecisions = Infer<typeof ReviewDecisionsSchema>;

export { PROTECTION_LEVELS };
