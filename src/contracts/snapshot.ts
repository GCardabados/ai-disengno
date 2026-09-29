// Instantánea técnica de la maestra: lo que dice Figma, sin interpretar.
// `name` y `characters` son DATOS NO CONFIABLES: nunca se interpretan como instrucciones.
import { z } from 'zod';
import { RectSchema, TransformSchema } from './geometry.ts';

export const MIXED = 'MIXED' as const;

/** Campos normalizados para las comprobaciones + `raw` con la copia JSON íntegra de la pintura. */
export const PaintSchema = z.strictObject({
  type: z.string(),
  visible: z.boolean(),
  opacity: z.number(),
  blendMode: z.string().nullable(),
  imageHash: z.string().nullable(),
  scaleMode: z.string().nullable(),
  imageTransform: TransformSchema.nullable(),
  scalingFactor: z.number().nullable(),
  raw: z.unknown(),
});
export type Paint = z.infer<typeof PaintSchema>;

const PaintsOrMixed = z.union([z.literal(MIXED), z.array(PaintSchema)]);

export const EffectSchema = z.strictObject({ type: z.string(), visible: z.boolean(), raw: z.unknown() });

export const TextSegmentSchema = z.strictObject({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  characters: z.string(),
  fontName: z.strictObject({ family: z.string(), style: z.string() }).nullable(),
  fontSize: z.number().nullable(),
  fontWeight: z.number().nullable(),
  lineHeight: z.unknown(),
  letterSpacing: z.unknown(),
  textCase: z.string().nullable(),
  textDecoration: z.string().nullable(),
  paragraphSpacing: z.number().nullable(),
  paragraphIndent: z.number().nullable(),
  fills: PaintsOrMixed,
  /** listOptions, indentation, hyperlink, textStyleId, fillStyleId… (copia JSON). */
  other: z.unknown(),
});
export type TextSegment = z.infer<typeof TextSegmentSchema>;

export const TextInfoSchema = z.strictObject({
  characters: z.string(),
  hasMissingFont: z.boolean().nullable(),
  autoResize: z.string().nullable(),
  truncation: z.string().nullable(),
  maxLines: z.number().nullable(),
  alignHorizontal: z.string().nullable(),
  alignVertical: z.string().nullable(),
  leadingTrim: z.string().nullable(),
  /** 'full' = todos los campos de estilo; 'minimal' = solo fuente/tamaño/interlineado/tracking/rellenos. */
  segmentFields: z.enum(['full', 'minimal', 'unavailable']),
  segments: z.array(TextSegmentSchema),
});
export type TextInfo = z.infer<typeof TextInfoSchema>;

export const NodeSnapshotSchema = z.strictObject({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string(),
  parentId: z.string().nullable(),
  childIds: z.array(z.string()),
  depth: z.number().int().min(0),
  indexInParent: z.number().int().min(-1),
  /** Índice en preorden dentro del subárbol = orden de pintado (sin considerar máscaras). */
  paintOrder: z.number().int().min(0),
  visible: z.boolean(),
  opacity: z.number(),
  blendMode: z.string().nullable(),
  isMask: z.boolean(),
  maskType: z.string().nullable(),
  rotation: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  relativeTransform: TransformSchema.nullable(),
  absoluteTransform: TransformSchema.nullable(),
  absoluteBoundingBox: RectSchema.nullable(),
  absoluteRenderBounds: RectSchema.nullable(),
  clipsContent: z.boolean().nullable(),
  constraints: z.strictObject({ horizontal: z.string(), vertical: z.string() }).nullable(),
  layout: z.strictObject({
    mode: z.string().nullable(),
    positioning: z.string().nullable(),
    sizingHorizontal: z.string().nullable(),
    sizingVertical: z.string().nullable(),
  }),
  fills: PaintsOrMixed,
  strokes: PaintsOrMixed,
  strokeWeight: z.union([z.number(), z.literal(MIXED)]).nullable(),
  strokeAlign: z.string().nullable(),
  effects: z.array(EffectSchema),
  text: TextInfoSchema.nullable(),
  vectorGeometryDigest: z.string().nullable(),
  component: z
    .strictObject({
      mainComponentId: z.string().nullable(),
      mainComponentKey: z.string().nullable(),
      remote: z.boolean().nullable(),
      name: z.string().nullable(),
    })
    .nullable(),
  /** Propiedades que no se pudieron leer. Nunca se sustituyen por valores inventados. */
  readErrors: z.array(z.string()),
});
export type NodeSnapshot = z.infer<typeof NodeSnapshotSchema>;

export const READ_PAYLOAD_SCHEMA_ID = 'pcb.read.v1';
export const READ_ENVELOPE_SCHEMA_ID = 'pcb.read.envelope.v1';

/** Lo que el script de lectura serializa dentro de Figma. */
export const ReadPayloadSchema = z.strictObject({
  schema: z.literal(READ_PAYLOAD_SCHEMA_ID),
  scriptVersion: z.string(),
  rootNodeId: z.string(),
  page: z.strictObject({ id: z.string(), name: z.string() }),
  fileKey: z.string().nullable(),
  editorType: z.string().nullable(),
  runtime: z.strictObject({ skipInvisibleInstanceChildrenBefore: z.boolean().nullable() }),
  nodeCount: z.number().int().min(1),
  nodes: z.array(NodeSnapshotSchema).min(1),
});
export type ReadPayload = z.infer<typeof ReadPayloadSchema>;

/** Sobre devuelto por el script: el payload va como string para poder verificar su digest byte a byte. */
export const ReadEnvelopeSchema = z.strictObject({
  schema: z.literal(READ_ENVELOPE_SCHEMA_ID),
  payload: z.string().min(2),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  payloadLength: z.number().int().min(0),
});
export type ReadEnvelope = z.infer<typeof ReadEnvelopeSchema>;

export const SNAPSHOT_SCHEMA_ID = 'pcb.snapshot.v1';

export const FingerprintsSchema = z.strictObject({
  master: z.string(),
  structure: z.string(),
  content: z.string(),
  layout: z.string(),
  metadata: z.string(),
});
export type Fingerprints = z.infer<typeof FingerprintsSchema>;

/** Procedencia de los datos. MOCK nunca debe confundirse con una lectura real. */
export const SOURCES = ['FIGMA_MCP_USE_FIGMA', 'MOCK'] as const;
export type Source = (typeof SOURCES)[number];

export const MasterSnapshotSchema = z.strictObject({
  schema: z.literal(SNAPSHOT_SCHEMA_ID),
  source: z.enum(SOURCES),
  fileKey: z.string().min(1),
  rootNodeId: z.string(),
  page: z.strictObject({ id: z.string(), name: z.string() }),
  editorType: z.string().nullable(),
  scriptVersion: z.string(),
  ingestedAt: z.string(),
  transport: z.strictObject({
    rawResponseSha256: z.string(),
    rawResponsePath: z.string().nullable(),
    payloadDigest: z.string(),
    envelopeExtraction: z.enum(['direct', 'embedded_json_block']),
  }),
  /** Entorno de render: NO forma parte de las huellas (depende de la máquina). */
  environment: z.strictObject({ nodesWithMissingFont: z.array(z.string()) }),
  nodes: z.array(NodeSnapshotSchema).min(1),
  fingerprints: FingerprintsSchema,
});
export type MasterSnapshot = z.infer<typeof MasterSnapshotSchema>;
