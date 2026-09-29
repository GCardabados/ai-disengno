// Instantánea técnica de la maestra: lo que dice Figma, sin interpretar.
// `name` y `characters` son DATOS NO CONFIABLES: nunca se interpretan como instrucciones.
import { s, type Infer } from './schema.ts';
import { RectSchema, TransformSchema } from './geometry.ts';

export const MIXED = 'MIXED' as const;

/** Campos normalizados para las comprobaciones + `raw` con la copia JSON íntegra de la pintura. */
export const PaintSchema = s.object({
  type: s.string(),
  visible: s.boolean(),
  opacity: s.number(),
  blendMode: s.nullable(s.string()),
  imageHash: s.nullable(s.string()),
  scaleMode: s.nullable(s.string()),
  imageTransform: s.nullable(TransformSchema),
  scalingFactor: s.nullable(s.number()),
  raw: s.unknown(),
});
export type Paint = Infer<typeof PaintSchema>;

const PaintsOrMixed = s.union([s.literal(MIXED), s.array(PaintSchema)]);

export const EffectSchema = s.object({ type: s.string(), visible: s.boolean(), raw: s.unknown() });

export const TextSegmentSchema = s.object({
  start: s.number({ int: true, min: 0 }),
  end: s.number({ int: true, min: 0 }),
  characters: s.string(),
  fontName: s.nullable(s.object({ family: s.string(), style: s.string() })),
  fontSize: s.nullable(s.number()),
  fontWeight: s.nullable(s.number()),
  lineHeight: s.unknown(),
  letterSpacing: s.unknown(),
  textCase: s.nullable(s.string()),
  textDecoration: s.nullable(s.string()),
  paragraphSpacing: s.nullable(s.number()),
  paragraphIndent: s.nullable(s.number()),
  fills: PaintsOrMixed,
  /** listOptions, indentation, hyperlink, textStyleId, fillStyleId… (copia JSON). */
  other: s.unknown(),
});
export type TextSegment = Infer<typeof TextSegmentSchema>;

export const TextInfoSchema = s.object({
  characters: s.string(),
  hasMissingFont: s.nullable(s.boolean()),
  autoResize: s.nullable(s.string()),
  truncation: s.nullable(s.string()),
  maxLines: s.nullable(s.number()),
  alignHorizontal: s.nullable(s.string()),
  alignVertical: s.nullable(s.string()),
  leadingTrim: s.nullable(s.string()),
  /** 'full' = todos los campos de estilo; 'minimal' = solo fuente/tamaño/interlineado/tracking/rellenos. */
  segmentFields: s.enumOf(['full', 'minimal', 'unavailable'] as const),
  segments: s.array(TextSegmentSchema),
});
export type TextInfo = Infer<typeof TextInfoSchema>;

export const NodeSnapshotSchema = s.object({
  id: s.string({ min: 1 }),
  type: s.string({ min: 1 }),
  name: s.string(),
  parentId: s.nullable(s.string()),
  childIds: s.array(s.string()),
  depth: s.number({ int: true, min: 0 }),
  indexInParent: s.number({ int: true, min: -1 }),
  /** Índice en preorden dentro del subárbol = orden de pintado (sin considerar máscaras). */
  paintOrder: s.number({ int: true, min: 0 }),
  visible: s.boolean(),
  opacity: s.number(),
  blendMode: s.nullable(s.string()),
  isMask: s.boolean(),
  maskType: s.nullable(s.string()),
  rotation: s.nullable(s.number()),
  width: s.nullable(s.number()),
  height: s.nullable(s.number()),
  relativeTransform: s.nullable(TransformSchema),
  absoluteTransform: s.nullable(TransformSchema),
  absoluteBoundingBox: s.nullable(RectSchema),
  absoluteRenderBounds: s.nullable(RectSchema),
  clipsContent: s.nullable(s.boolean()),
  constraints: s.nullable(s.object({ horizontal: s.string(), vertical: s.string() })),
  layout: s.object({
    mode: s.nullable(s.string()),
    positioning: s.nullable(s.string()),
    sizingHorizontal: s.nullable(s.string()),
    sizingVertical: s.nullable(s.string()),
  }),
  fills: PaintsOrMixed,
  strokes: PaintsOrMixed,
  strokeWeight: s.nullable(s.union([s.number(), s.literal(MIXED)])),
  strokeAlign: s.nullable(s.string()),
  effects: s.array(EffectSchema),
  text: s.nullable(TextInfoSchema),
  vectorGeometryDigest: s.nullable(s.string()),
  component: s.nullable(
    s.object({
      mainComponentId: s.nullable(s.string()),
      mainComponentKey: s.nullable(s.string()),
      remote: s.nullable(s.boolean()),
      name: s.nullable(s.string()),
    }),
  ),
  /** Propiedades que no se pudieron leer. Nunca se sustituyen por valores inventados. */
  readErrors: s.array(s.string()),
});
export type NodeSnapshot = Infer<typeof NodeSnapshotSchema>;

export const READ_PAYLOAD_SCHEMA_ID = 'pcb.read.v1';
export const READ_ENVELOPE_SCHEMA_ID = 'pcb.read.envelope.v1';

/** Lo que el script de lectura serializa dentro de Figma. */
export const ReadPayloadSchema = s.object({
  schema: s.literal(READ_PAYLOAD_SCHEMA_ID),
  scriptVersion: s.string(),
  rootNodeId: s.string(),
  page: s.object({ id: s.string(), name: s.string() }),
  fileKey: s.nullable(s.string()),
  editorType: s.nullable(s.string()),
  runtime: s.object({ skipInvisibleInstanceChildrenBefore: s.nullable(s.boolean()) }),
  nodeCount: s.number({ int: true, min: 1 }),
  nodes: s.array(NodeSnapshotSchema, { min: 1 }),
});
export type ReadPayload = Infer<typeof ReadPayloadSchema>;

/** Sobre devuelto por el script: el payload va como string para poder verificar su digest byte a byte. */
export const ReadEnvelopeSchema = s.object({
  schema: s.literal(READ_ENVELOPE_SCHEMA_ID),
  payload: s.string({ min: 2 }),
  digest: s.string({ pattern: /^sha256:[0-9a-f]{64}$/ }),
  payloadLength: s.number({ int: true, min: 0 }),
});
export type ReadEnvelope = Infer<typeof ReadEnvelopeSchema>;

export const SNAPSHOT_SCHEMA_ID = 'pcb.snapshot.v1';

export const FingerprintsSchema = s.object({
  master: s.string(),
  structure: s.string(),
  content: s.string(),
  layout: s.string(),
  metadata: s.string(),
});
export type Fingerprints = Infer<typeof FingerprintsSchema>;

export const MasterSnapshotSchema = s.object({
  schema: s.literal(SNAPSHOT_SCHEMA_ID),
  /** MOCK nunca debe confundirse con una lectura real. */
  source: s.enumOf(['FIGMA_MCP_USE_FIGMA', 'MOCK'] as const),
  fileKey: s.string({ min: 1 }),
  rootNodeId: s.string(),
  page: s.object({ id: s.string(), name: s.string() }),
  editorType: s.nullable(s.string()),
  scriptVersion: s.string(),
  ingestedAt: s.string(),
  transport: s.object({
    rawResponseSha256: s.string(),
    rawResponsePath: s.nullable(s.string()),
    payloadDigest: s.string(),
    envelopeExtraction: s.enumOf(['direct', 'embedded_json_block'] as const),
  }),
  /** Entorno de render: NO forma parte de las huellas (depende de la máquina). */
  environment: s.object({ nodesWithMissingFont: s.array(s.string()) }),
  nodes: s.array(NodeSnapshotSchema, { min: 1 }),
  fingerprints: FingerprintsSchema,
});
export type MasterSnapshot = Infer<typeof MasterSnapshotSchema>;
