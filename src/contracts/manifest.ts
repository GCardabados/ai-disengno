// Inventario semántico: entidades, disposición de cada nodo, composiciones y relaciones.
import { z } from 'zod';
import { RectSchema } from './geometry.ts';
import { ENTITY_OPS, PROTECTION_LEVELS } from './config.ts';
import { FingerprintsSchema, SOURCES } from './snapshot.ts';

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

export const EvidenceSchema = z.strictObject({
  kind: z.enum(EVIDENCE_KINDS),
  detail: z.string(),
  producedBy: z.string(),
  version: z.string(),
  trust: z.enum(['low', 'medium', 'high']),
  nodeIds: z.array(z.string()),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

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

export const NodeDispositionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('content'), nodeId: z.string(), entityId: z.string() }),
  z.strictObject({
    kind: z.literal('structural'),
    nodeId: z.string(),
    justification: z.enum(STRUCTURAL_JUSTIFICATIONS),
    evidence: z.array(EvidenceSchema),
    decidedBy: z.enum(['classifier', 'human']),
    statement: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal('pending'),
    nodeId: z.string(),
    reasons: z.array(z.enum(PENDING_REASONS)).min(1),
  }),
]);
export type NodeDisposition = z.infer<typeof NodeDispositionSchema>;

export const ProtectedRegionSchema = z.strictObject({
  regionId: z.string(),
  nodeId: z.string(),
  /** Rectángulo en coordenadas locales del nodo. */
  rect: RectSchema,
  purpose: z.string(),
});

export const EntityConstraintsSchema = z.strictObject({
  allowOps: z.array(z.enum(ENTITY_OPS)),
  allowReflow: z.boolean(),
  atomicGroup: z.string().nullable(),
  protectedRegions: z.array(ProtectedRegionSchema),
  mustBeInSafeZone: z.boolean().nullable(),
});
export type EntityConstraints = z.infer<typeof EntityConstraintsSchema>;

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

export const SemanticEntitySchema = z.strictObject({
  entityId: z.string().regex(/^ent_[0-9a-f]{12}$/),
  role: z.string().nullable(),
  roleHints: z.array(z.strictObject({ roleId: z.string(), evidence: EvidenceSchema })),
  nodeIds: z.array(z.string()).min(1),
  contentNature: z.enum(CONTENT_NATURES),
  evidence: z.array(EvidenceSchema),
  review: z.strictObject({
    status: z.enum(['proposed', 'needs_review', 'approved', 'rejected']),
    reasons: z.array(z.enum(REVIEW_REASONS)),
    reviewedBy: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  constraints: EntityConstraintsSchema,
});
export type SemanticEntity = z.infer<typeof SemanticEntitySchema>;

/** Propuesta de composición (p. ej. imagen + texto editable superpuesto). La acepta o rechaza una persona. */
export const CompositionSchema = z.strictObject({
  compositionId: z.string().regex(/^cmp_[0-9a-f]{12}$/),
  nature: z.enum(['image_with_editable_text_overlay', 'mixed_composition']),
  entityIds: z.array(z.string()).min(2),
  evidence: z.array(EvidenceSchema),
  status: z.enum(['proposed', 'accepted', 'rejected']),
  decidedBy: z.string().nullable(),
  statement: z.string().nullable(),
});
export type Composition = z.infer<typeof CompositionSchema>;

export const RELATION_KINDS = ['rigid', 'contained_in', 'order', 'min_gap', 'z_above', 'aligned'] as const;
export const RelationSchema = z.strictObject({
  relationId: z.string(),
  kind: z.enum(RELATION_KINDS),
  subject: z.string(),
  object: z.string(),
  params: z.strictObject({
    axis: z.enum(['x', 'y']).optional(),
    direction: z.enum(['before', 'after']).optional(),
    px: z.number().min(0).optional(),
    edge: z.enum(['left', 'right', 'top', 'bottom', 'center_x', 'center_y']).optional(),
  }),
  declaredBy: z.string(),
});
export type Relation = z.infer<typeof RelationSchema>;

export const MANIFEST_SCHEMA_ID = 'pcb.manifest.v1';

/** Huella de las reglas con las que se clasificó el inventario (ver src/inventory/rules.ts). */
export const RulesRefSchema = z.strictObject({
  fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  covers: z.array(z.string()).min(1),
});

export const ManifestSchema = z.strictObject({
  schema: z.literal(MANIFEST_SCHEMA_ID),
  manifestId: z.string(),
  createdAt: z.string(),
  /** Procedencia de la instantánea; se conserva tras la aprobación (un manifiesto MOCK sigue siendo MOCK). */
  source: z.enum(SOURCES),
  master: z.strictObject({
    fileKey: z.string(),
    rootNodeId: z.string(),
    pageId: z.string(),
    fingerprints: FingerprintsSchema,
    snapshotHash: z.string(),
  }),
  taxonomy: z.strictObject({ id: z.string(), version: z.string() }),
  classifier: z.strictObject({ id: z.string(), version: z.string() }),
  rules: RulesRefSchema,
  detectors: z.strictObject({ ocr: z.enum(['not_run', 'run']) }),
  entities: z.array(SemanticEntitySchema),
  dispositions: z.array(NodeDispositionSchema),
  compositions: z.array(CompositionSchema),
  relations: z.array(RelationSchema),
  approval: z.strictObject({
    status: z.enum(['draft', 'approved']),
    /** Nombre DECLARADO con --by. No autentica a ninguna persona. */
    approvedBy: z.string().nullable(),
    approvedAt: z.string().nullable(),
  }),
  /** Hash canónico de todo el manifiesto excepto este campo. */
  manifestHash: z.string(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// ---------- Revisión humana (archivo editable) ----------

export const EntityDecisionSchema = z.strictObject({
  status: z.enum(['approved', 'rejected']),
  role: z.string().optional(),
  contentNature: z.enum(CONTENT_NATURES).optional(),
  /** Obligatorio cuando se cambia la naturaleza del contenido. Queda como evidencia human_statement. */
  statement: z.string().min(3).optional(),
  constraints: z
    .strictObject({
      allowOps: z.array(z.enum(ENTITY_OPS)).optional(),
      allowReflow: z.boolean().optional(),
      atomicGroup: z.string().nullable().optional(),
      protectedRegions: z.array(ProtectedRegionSchema).optional(),
      mustBeInSafeZone: z.boolean().nullable().optional(),
    })
    .optional(),
  notes: z.string().optional(),
});

export const PendingDecisionSchema = z.discriminatedUnion('resolution', [
  z.strictObject({
    resolution: z.literal('structural'),
    justification: z.enum(STRUCTURAL_JUSTIFICATIONS),
    statement: z.string().min(3),
  }),
  z.strictObject({
    resolution: z.literal('entity'),
    role: z.string(),
    contentNature: z.enum(CONTENT_NATURES),
    statement: z.string().min(3),
  }),
]);

export const ReviewDecisionsSchema = z.strictObject({
  schema: z.literal('pcb.review.v1'),
  /** Hash del manifiesto borrador al que se aplica: evita aplicar una revisión a otro inventario. */
  manifestHash: z.string(),
  /** Nombre DECLARADO de quien revisa. No autentica a ninguna persona. */
  reviewer: z.string().min(1),
  entities: z.record(z.string(), EntityDecisionSchema),
  pending: z.record(z.string(), PendingDecisionSchema),
  compositions: z.record(z.string(), z.strictObject({ status: z.enum(['accepted', 'rejected']), statement: z.string().optional() })),
  relations: z.array(RelationSchema),
});
export type ReviewDecisions = z.infer<typeof ReviewDecisionsSchema>;

export { PROTECTION_LEVELS };
