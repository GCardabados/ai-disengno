// Ingesta de la lectura.
// Orden: (1) las respuestas ORIGINALES ya están guardadas byte a byte por el llamante; (2) se ensamblan los
// fragmentos mediante código (src/figma/chunks.ts), verificando hashes por fragmento y del conjunto;
// (3) se valida la estructura; (4) se comprueba identidad y coherencia del árbol; (5) se calculan las huellas.
// La validación de esquema NO prueba fidelidad: eso lo aportan los hashes, que detectan alteraciones del contenido
// transportado pero NO autentican que proceda de Figma.
import { parse } from '../contracts/schema.ts';
import { MasterSnapshotSchema, ReadPayloadSchema, SNAPSHOT_SCHEMA_ID, type MasterSnapshot } from '../contracts/snapshot.ts';
import type { EntryRef } from '../contracts/discovery.ts';
import { computeFingerprints } from '../hash/fingerprint.ts';
import { normalizeNodeId } from './read-script.ts';
import { assembleChunks, type ChunkResponse } from './chunks.ts';
import type { IngestError } from './ingest-envelope.ts';

export { extractEnvelope, type IngestError } from './ingest-envelope.ts';
export type { ChunkResponse } from './chunks.ts';

export interface IngestInput {
  /** Una respuesta original por llamada (fragmento), en cualquier orden. */
  responses: ChunkResponse[];
  fileKey: string;
  expectedRootNodeId: string;
  /** Tipo exigido para la raíz (por defecto FRAME). Se comprueba también aquí, no solo en el script. */
  expectedRootType?: string;
  /** Relación con el punto de entrada del usuario, si la maestra se resolvió por descubrimiento. */
  entry?: EntryRef | null;
  source: 'FIGMA_MCP_USE_FIGMA' | 'MOCK';
  now?: () => string;
}

export type IngestResult =
  | { ok: true; snapshot: MasterSnapshot; warnings: string[] }
  | { ok: false; errors: IngestError[] };

export function ingestReadResponses(input: IngestInput): IngestResult {
  const errors: IngestError[] = [];
  const warnings: string[] = [];

  const assembled = assembleChunks(input.responses);
  if (!assembled.ok) return { ok: false, errors: assembled.errors };
  const a = assembled.value;
  if (a.duplicatesDiscarded > 0) warnings.push(`Se descartaron ${a.duplicatesDiscarded} fragmento(s) duplicado(s) idéntico(s).`);

  let payloadValue: unknown;
  try {
    payloadValue = JSON.parse(a.payload);
  } catch (e) {
    return { ok: false, errors: [{ code: 'PAYLOAD_NOT_JSON', message: (e as Error).message }] };
  }

  const pl = parse(ReadPayloadSchema, payloadValue, '$payload');
  if (!pl.ok) {
    return { ok: false, errors: pl.issues.map((i) => ({ code: 'PAYLOAD_SCHEMA', message: `${i.path}: ${i.message}` })) };
  }
  const payload = pl.value;

  let expectedRoot: string;
  try {
    expectedRoot = normalizeNodeId(input.expectedRootNodeId);
  } catch (e) {
    return { ok: false, errors: [{ code: 'BAD_ROOT_ID', message: (e as Error).message }] };
  }
  const expectedType = input.expectedRootType ?? 'FRAME';
  if (payload.nodes[0] && payload.nodes[0].type !== expectedType) {
    errors.push({ code: 'ROOT_TYPE_MISMATCH', message: `Se esperaba ${expectedType}, llegó ${payload.nodes[0].type}.` });
  }
  if (input.entry && input.entry.masterNodeId !== payload.rootNodeId) {
    errors.push({ code: 'ENTRY_MASTER_MISMATCH', message: `El descubrimiento resolvió ${input.entry.masterNodeId}, se leyó ${payload.rootNodeId}.` });
  }
  if (payload.rootNodeId !== expectedRoot || a.rootNodeId !== expectedRoot) {
    errors.push({ code: 'ROOT_MISMATCH', message: `Se esperaba ${expectedRoot}, llegó ${payload.rootNodeId}.` });
  }
  if (payload.fileKey !== null && payload.fileKey !== input.fileKey) {
    errors.push({ code: 'FILE_KEY_MISMATCH', message: 'fileKey del payload distinto del solicitado.' });
  }
  if (payload.fileKey === null) warnings.push('El entorno no expuso figma.fileKey; la identidad del archivo depende del fileKey indicado en la petición.');
  if (payload.nodeCount !== payload.nodes.length) {
    errors.push({ code: 'NODE_COUNT_MISMATCH', message: `nodeCount ${payload.nodeCount} ≠ ${payload.nodes.length}` });
  }
  const byId = new Map<string, (typeof payload.nodes)[number]>();
  payload.nodes.forEach((n, i) => {
    if (byId.has(n.id)) errors.push({ code: 'DUPLICATE_NODE_ID', message: n.id });
    byId.set(n.id, n);
    if (n.paintOrder !== i) errors.push({ code: 'PAINT_ORDER_GAP', message: `${n.id}: paintOrder ${n.paintOrder} ≠ ${i}` });
  });
  const first = payload.nodes[0]!;
  if (first.id !== payload.rootNodeId || first.depth !== 0) {
    errors.push({ code: 'ROOT_NOT_FIRST', message: 'El primer nodo debe ser la raíz con depth 0.' });
  }
  for (const n of payload.nodes) {
    n.childIds.forEach((cid, idx) => {
      const c = byId.get(cid);
      if (!c) errors.push({ code: 'MISSING_CHILD', message: `${n.id} → ${cid}` });
      else if (c.parentId !== n.id || c.indexInParent !== idx || c.depth !== n.depth + 1) {
        errors.push({ code: 'TREE_INCONSISTENT', message: `${cid} no encaja bajo ${n.id}` });
      }
    });
    if (n.id !== payload.rootNodeId && (!n.parentId || !byId.has(n.parentId))) {
      errors.push({ code: 'ORPHAN_NODE', message: n.id });
    }
  }
  if (a.calls.some((c) => c.skipInvisibleInstanceChildrenBefore === true)) {
    warnings.push('skipInvisibleInstanceChildren estaba activo; el script lo desactivó para leer hijos ocultos de instancias.');
  }
  if (errors.length > 0) return { ok: false, errors };

  const nodes = payload.nodes;
  const byCall = a.calls.map((c) => ({ chunkIndex: c.chunkIndex, nodeIds: c.missingFontNodeIds }));
  const missingUnion = [...new Set(byCall.flatMap((c) => c.nodeIds))].sort();
  const missingStable = byCall.every((c) => JSON.stringify(c.nodeIds) === JSON.stringify(byCall[0]!.nodeIds));
  if (!missingStable) {
    warnings.push(`La disponibilidad de fuentes varió entre llamadas (${missingUnion.length} texto(s) afectados): se registra la unión.`);
  }
  const snapshot: MasterSnapshot = {
    schema: SNAPSHOT_SCHEMA_ID,
    source: input.source,
    fileKey: input.fileKey,
    rootNodeId: payload.rootNodeId,
    page: payload.page,
    editorType: payload.editorType,
    scriptVersion: payload.scriptVersion,
    // Metadatos variables (fuera de las huellas): momento de ingesta y detalles de transporte de cada llamada.
    ingestedAt: (input.now ?? (() => new Date().toISOString()))(),
    transport: {
      mode: 'chunked',
      setId: a.setId,
      payloadSha256: a.payloadSha256,
      payloadBytes: a.payloadBytes,
      byteBudget: a.byteBudget,
      chunkCount: a.chunkCount,
      calls: a.calls,
      duplicatesDiscarded: a.duplicatesDiscarded,
    },
    entry: input.entry ?? null,
    environment: {
      nodesWithMissingFont: missingUnion,
      missingFontByCall: byCall,
      missingFontStable: missingStable,
    },
    nodes,
    fingerprints: computeFingerprints(nodes, payload.rootNodeId),
  };
  // La instantánea producida debe cumplir su propio contrato (TypeScript no detecta claves de más).
  const self = parse(MasterSnapshotSchema, snapshot, '$snapshot');
  if (!self.ok) {
    return { ok: false, errors: self.issues.map((i) => ({ code: 'SNAPSHOT_SELF_CHECK', message: `${i.path}: ${i.message}` })) };
  }
  return { ok: true, snapshot, warnings };
}
