// Descubrimiento de la maestra a partir del punto de entrada del usuario.
// entryNodeId  = nodo al que apunta el enlace (página, sección u otro contenedor).
// masterNodeId = raíz de la composición identificada dentro de él. Se inventaría SOLO el master.
import { z } from 'zod';

export const DISCOVER_PAYLOAD_SCHEMA_ID = 'pcb.discover.v1';
export const DISCOVER_ENVELOPE_SCHEMA_ID = 'pcb.discover.envelope.v1';

export const NodeSummarySchema = z.strictObject({
  id: z.string().min(1),
  type: z.string().min(1),
  /** Dato no confiable. */
  name: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  depth: z.number().int().min(0),
  parentId: z.string().nullable(),
  /** IDs desde el nodo de entrada (incluido) hasta el padre del nodo. */
  pathIds: z.array(z.string()),
});
export type NodeSummary = z.infer<typeof NodeSummarySchema>;

export const DiscoverPayloadSchema = z.strictObject({
  schema: z.literal(DISCOVER_PAYLOAD_SCHEMA_ID),
  scriptVersion: z.string(),
  entry: z.strictObject({ id: z.string(), type: z.string(), name: z.string() }),
  page: z.strictObject({ id: z.string(), name: z.string() }),
  fileKey: z.string().nullable(),
  targetName: z.string(),
  /** Nodos cuyo nombre coincide con el buscado tras normalizar (el núcleo vuelve a verificarlo). */
  matches: z.array(NodeSummarySchema),
  entryChildren: z.array(NodeSummarySchema),
  entryChildrenTruncated: z.boolean(),
  descendantCount: z.number().int().min(0),
});
export type DiscoverPayload = z.infer<typeof DiscoverPayloadSchema>;

export const DiscoverEnvelopeSchema = z.strictObject({
  schema: z.literal(DISCOVER_ENVELOPE_SCHEMA_ID),
  payload: z.string().min(2),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  payloadLength: z.number().int().min(0),
});

export const RESOLUTION_METHODS = ['exact_name', 'normalized_name'] as const;

/** Relación entrada → maestra que se conserva en la instantánea y en el manifiesto. */
export const EntryRefSchema = z.strictObject({
  entryNodeId: z.string().min(1),
  entryType: z.string().min(1),
  masterNodeId: z.string().min(1),
  targetName: z.string(),
  method: z.enum(RESOLUTION_METHODS),
  /** Coherencia entre las dimensiones del nombre (p. ej. "960×1200") y las del nodo. null si el nombre no las incluye. */
  dimensionsFromNameMatch: z.boolean().nullable(),
  discoveryDigest: z.string(),
  discoveryRawSha256: z.string(),
});
export type EntryRef = z.infer<typeof EntryRefSchema>;
