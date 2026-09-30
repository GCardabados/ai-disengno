// Instantánea técnica de la maestra: lo que dice Figma, sin interpretar.
// `name` y `characters` son DATOS NO CONFIABLES: nunca se interpretan como instrucciones.
import { z } from 'zod';
import { RectSchema, TransformSchema } from './geometry.ts';
import { EntryRefSchema } from './discovery.ts';

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

export const READ_PAYLOAD_SCHEMA_ID = 'pcb.read.v3';
export const READ_CHUNK_ENVELOPE_SCHEMA_ID = 'pcb.read.chunk.envelope.v2';

/**
 * Contenido ESTABLE que el script serializa dentro de Figma. No contiene marcas de tiempo ni metadatos de la
 * llamada: dos lecturas del mismo documento sin cambios producen el mismo texto y, por tanto, el mismo hash.
 * (v1 incluía `runtime`, que podía variar entre llamadas; ahora va en el sobre de cada fragmento.)
 * v3: `text.hasMissingFont` es SIEMPRE null en el payload. En real se observó que alterna entre llamadas (depende
 * de la disponibilidad de fuentes en el entorno de ejecución): se informa por llamada en `call.missingFontNodeIds`.
 */
export const ReadPayloadSchema = z.strictObject({
  schema: z.literal(READ_PAYLOAD_SCHEMA_ID),
  scriptVersion: z.string(),
  rootNodeId: z.string(),
  page: z.strictObject({ id: z.string(), name: z.string() }),
  fileKey: z.string().nullable(),
  editorType: z.string().nullable(),
  nodeCount: z.number().int().min(1),
  nodes: z.array(NodeSnapshotSchema).min(1),
});
export type ReadPayload = z.infer<typeof ReadPayloadSchema>;

const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/**
 * Sobre de UNA llamada: un fragmento del payload estable más metadatos de esa llamada.
 * Cada llamada relee la maestra completa (use_figma no conserva estado) y devuelve el fragmento pedido.
 */
export const ReadChunkEnvelopeSchema = z.strictObject({
  schema: z.literal(READ_CHUNK_ENVELOPE_SCHEMA_ID),
  /** Identificador del conjunto: deriva del hash del payload completo y del presupuesto de bytes. */
  setId: z.string().regex(/^set_[0-9a-f]{16}_b\d+$/),
  rootNodeId: z.string(),
  payloadSchema: z.literal(READ_PAYLOAD_SCHEMA_ID),
  payloadSha256: Sha256,
  payloadBytes: z.number().int().min(1),
  payloadChars: z.number().int().min(1),
  byteBudget: z.number().int().min(256),
  chunkIndex: z.number().int().min(0),
  chunkCount: z.number().int().min(1),
  chunk: z.string().min(1),
  chunkSha256: Sha256,
  chunkBytes: z.number().int().min(1),
  chunkChars: z.number().int().min(1),
  /** Metadatos de la llamada: pueden variar entre llamadas y NO forman parte del payload ni de su hash. */
  call: z.strictObject({
    scriptVersion: z.string(),
    skipInvisibleInstanceChildrenBefore: z.boolean().nullable(),
    /** Textos con fuente ausente EN ESTA LLAMADA (propiedad del entorno de ejecución). */
    missingFontNodeIds: z.array(z.string()),
    responseBytes: z.number().int().min(1),
  }),
});
export type ReadChunkEnvelope = z.infer<typeof ReadChunkEnvelopeSchema>;

export const SNAPSHOT_SCHEMA_ID = 'pcb.snapshot.v2';

export const FingerprintsSchema = z.strictObject({
  /** Versión del significado de las huellas (ver src/hash/fingerprint.ts). */
  version: z.literal('pcb.fingerprint.v2'),
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
  /** Metadatos de transporte (variables por llamada). No forman parte de las huellas. */
  transport: z.strictObject({
    mode: z.literal('chunked'),
    setId: z.string(),
    payloadSha256: z.string(),
    payloadBytes: z.number().int().min(1),
    byteBudget: z.number().int(),
    chunkCount: z.number().int().min(1),
    calls: z
      .array(
        z.strictObject({
          chunkIndex: z.number().int().min(0),
          rawResponseSha256: z.string(),
          rawResponsePath: z.string().nullable(),
          envelopeExtraction: z.enum(['direct', 'embedded_json_block']),
          skipInvisibleInstanceChildrenBefore: z.boolean().nullable(),
          missingFontNodeIds: z.array(z.string()),
          responseBytes: z.number().int(),
        }),
      )
      .min(1),
    duplicatesDiscarded: z.number().int().min(0),
  }),
  /** entryNodeId → masterNodeId. No forma parte de las huellas: no es contenido de la maestra. */
  entry: EntryRefSchema.nullable(),
  /** Entorno de render: NO forma parte de las huellas (depende de la máquina y puede variar entre llamadas). */
  environment: z.strictObject({
    /** Unión de todas las llamadas: basta con que una llamada observe la fuente ausente. */
    nodesWithMissingFont: z.array(z.string()),
    missingFontByCall: z.array(z.strictObject({ chunkIndex: z.number().int(), nodeIds: z.array(z.string()) })),
    /** false si las llamadas no coinciden entre sí (disponibilidad de fuentes intermitente). */
    missingFontStable: z.boolean(),
  }),
  nodes: z.array(NodeSnapshotSchema).min(1),
  fingerprints: FingerprintsSchema,
});
export type MasterSnapshot = z.infer<typeof MasterSnapshotSchema>;
