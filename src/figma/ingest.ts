// Ingesta de la respuesta de lectura.
// Orden: (1) la respuesta ORIGINAL ya está guardada byte a byte por el llamante; (2) se localiza el sobre;
// (3) se verifica el digest calculado dentro de Figma (fidelidad del transporte); (4) se valida la estructura;
// (5) se comprueba la coherencia del árbol; (6) se calculan las huellas.
// La validación de esquema NO prueba fidelidad: eso lo aporta el digest (detecta alteraciones accidentales
// del reenvío, no manipulaciones deliberadas de quien retransmite).
import { parse } from '../contracts/schema.ts';
import {
  ReadEnvelopeSchema,
  ReadPayloadSchema,
  READ_ENVELOPE_SCHEMA_ID,
  SNAPSHOT_SCHEMA_ID,
  type MasterSnapshot,
  type ReadEnvelope,
} from '../contracts/snapshot.ts';
import { sha256Hex } from '../hash/canonical.ts';
import { computeFingerprints } from '../hash/fingerprint.ts';
import { normalizeNodeId } from './read-script.ts';

export interface IngestInput {
  rawText: string;
  fileKey: string;
  expectedRootNodeId: string;
  source: 'FIGMA_MCP_USE_FIGMA' | 'MOCK';
  rawResponsePath: string | null;
  now?: () => string;
}

export interface IngestError {
  code: string;
  message: string;
}

export type IngestResult =
  | { ok: true; snapshot: MasterSnapshot; warnings: string[] }
  | { ok: false; errors: IngestError[] };

function isEnvelopeLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && (v as Record<string, unknown>).schema === READ_ENVELOPE_SCHEMA_ID;
}

/**
 * El formato exacto con el que use_figma envuelve el valor devuelto NO está verificado.
 * Se acepta: el sobre directamente, o un único sobre anidado en la estructura JSON
 * (p. ej. bloques de contenido con un campo de texto que contiene el JSON del sobre).
 * Más de un sobre, o ninguno, es un error.
 */
function extractEnvelope(raw: string): { value: unknown; extraction: 'direct' | 'embedded_json_block' } | IngestError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { code: 'RAW_NOT_JSON', message: `La respuesta no es JSON: ${(e as Error).message}` };
  }
  if (isEnvelopeLike(parsed)) return { value: parsed, extraction: 'direct' };
  const found: unknown[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8) return;
    if (isEnvelopeLike(v)) return void found.push(v);
    if (typeof v === 'string' && v.includes(READ_ENVELOPE_SCHEMA_ID)) {
      try {
        walk(JSON.parse(v), depth + 1);
      } catch {
        /* texto no JSON: se ignora */
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(parsed, 0);
  if (found.length === 1) return { value: found[0], extraction: 'embedded_json_block' };
  if (found.length > 1) return { code: 'ENVELOPE_AMBIGUOUS', message: `Se encontraron ${found.length} sobres.` };
  return { code: 'ENVELOPE_NOT_FOUND', message: 'No se encontró un sobre pcb.read.envelope.v1.' };
}

export function ingestReadResponse(input: IngestInput): IngestResult {
  const errors: IngestError[] = [];
  const warnings: string[] = [];
  const rawSha = `sha256:${sha256Hex(input.rawText)}`;

  const ext = extractEnvelope(input.rawText);
  if ('code' in ext) return { ok: false, errors: [ext] };

  const env = parse(ReadEnvelopeSchema, ext.value, '$envelope');
  if (!env.ok) {
    return { ok: false, errors: env.issues.map((i) => ({ code: 'ENVELOPE_SCHEMA', message: `${i.path}: ${i.message}` })) };
  }
  const envelope: ReadEnvelope = env.value;

  // (3) Fidelidad del transporte.
  const recomputed = `sha256:${sha256Hex(envelope.payload)}`;
  if (recomputed !== envelope.digest) {
    return {
      ok: false,
      errors: [{ code: 'TRANSPORT_DIGEST_MISMATCH', message: `digest declarado ${envelope.digest} ≠ recalculado ${recomputed}` }],
    };
  }
  if (envelope.payload.length !== envelope.payloadLength) {
    return { ok: false, errors: [{ code: 'TRANSPORT_LENGTH_MISMATCH', message: 'payloadLength no coincide.' }] };
  }

  let payloadValue: unknown;
  try {
    payloadValue = JSON.parse(envelope.payload);
  } catch (e) {
    return { ok: false, errors: [{ code: 'PAYLOAD_NOT_JSON', message: (e as Error).message }] };
  }

  // (4) Estructura.
  const pl = parse(ReadPayloadSchema, payloadValue, '$payload');
  if (!pl.ok) {
    return { ok: false, errors: pl.issues.map((i) => ({ code: 'PAYLOAD_SCHEMA', message: `${i.path}: ${i.message}` })) };
  }
  const payload = pl.value;

  // (5) Identidad y coherencia del árbol.
  let expectedRoot: string;
  try {
    expectedRoot = normalizeNodeId(input.expectedRootNodeId);
  } catch (e) {
    return { ok: false, errors: [{ code: 'BAD_ROOT_ID', message: (e as Error).message }] };
  }
  if (payload.rootNodeId !== expectedRoot) {
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
  if (payload.runtime.skipInvisibleInstanceChildrenBefore === true) {
    warnings.push('skipInvisibleInstanceChildren estaba activo; el script lo desactivó para leer hijos ocultos de instancias.');
  }
  if (errors.length > 0) return { ok: false, errors };

  const nodes = payload.nodes;
  const snapshot: MasterSnapshot = {
    schema: SNAPSHOT_SCHEMA_ID,
    source: input.source,
    fileKey: input.fileKey,
    rootNodeId: payload.rootNodeId,
    page: payload.page,
    editorType: payload.editorType,
    scriptVersion: payload.scriptVersion,
    ingestedAt: (input.now ?? (() => new Date().toISOString()))(),
    transport: {
      rawResponseSha256: rawSha,
      rawResponsePath: input.rawResponsePath,
      payloadDigest: envelope.digest,
      envelopeExtraction: ext.extraction,
    },
    environment: {
      nodesWithMissingFont: nodes.filter((n) => n.text?.hasMissingFont === true).map((n) => n.id),
    },
    nodes,
    fingerprints: computeFingerprints(nodes, payload.rootNodeId),
  };
  return { ok: true, snapshot, warnings };
}
