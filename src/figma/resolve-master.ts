// Resolución determinista de la maestra a partir del resultado del descubrimiento.
// Reglas:
//  1. Coincidencia EXACTA de nombre (mismos puntos de código) y única → resuelta ('exact_name').
//  2. Si no hay exacta: coincidencia normalizada (NFKC, "×"→"x", espacios, mayúsculas) y única → 'normalized_name'.
//  3. Varias coincidencias en el mismo nivel de regla → ambigua: se pregunta a la persona.
//  4. Ninguna → no encontrada.
//  5. El candidato resuelto debe ser del tipo exigido (FRAME); si no, se detiene sin inventariar.
// Las dimensiones que aparezcan en el nombre (p. ej. "960×1200") se comparan con las del nodo como
// evidencia informativa; no sustituyen la regla de nombre.
import { parse } from '../contracts/schema.ts';
import {
  DISCOVER_ENVELOPE_SCHEMA_ID,
  DiscoverEnvelopeSchema,
  DiscoverPayloadSchema,
  type DiscoverPayload,
  type EntryRef,
  type NodeSummary,
} from '../contracts/discovery.ts';
import { sha256Hex } from '../hash/canonical.ts';
import { extractEnvelope, type IngestError } from './ingest-envelope.ts';
import { normalizeEntryId } from './discover-script.ts';

export function normalizeName(s: string): string {
  return s.normalize('NFKC').split('×').join('x').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function dimensionsFromName(name: string): { width: number; height: number } | null {
  const m = /(\d+)\s*[x×X]\s*(\d+)/.exec(name);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

export type Resolution =
  | { status: 'resolved'; entry: EntryRef; candidate: NodeSummary }
  | { status: 'ambiguous'; candidates: NodeSummary[]; rule: 'exact_name' | 'normalized_name' }
  | { status: 'not_found'; entryChildren: NodeSummary[] }
  | { status: 'wrong_type'; candidate: NodeSummary; requiredType: string };

export type DiscoveryResult =
  | { ok: true; payload: DiscoverPayload; digest: string; rawSha256: string; resolution: Resolution }
  | { ok: false; errors: IngestError[] };

export function resolveFromDiscovery(input: {
  rawText: string;
  fileKey: string;
  entryNodeId: string;
  targetName: string;
  requiredRootType?: string;
}): DiscoveryResult {
  const rawSha256 = `sha256:${sha256Hex(input.rawText)}`;
  const ext = extractEnvelope(input.rawText, DISCOVER_ENVELOPE_SCHEMA_ID);
  if ('code' in ext) return { ok: false, errors: [ext] };
  const env = parse(DiscoverEnvelopeSchema, ext.value, '$envelope');
  if (!env.ok) return { ok: false, errors: env.issues.map((i) => ({ code: 'ENVELOPE_SCHEMA', message: `${i.path}: ${i.message}` })) };
  const recomputed = `sha256:${sha256Hex(env.value.payload)}`;
  if (recomputed !== env.value.digest || env.value.payload.length !== env.value.payloadLength) {
    return { ok: false, errors: [{ code: 'TRANSPORT_DIGEST_MISMATCH', message: `${env.value.digest} ≠ ${recomputed}` }] };
  }
  let value: unknown;
  try {
    value = JSON.parse(env.value.payload);
  } catch (e) {
    return { ok: false, errors: [{ code: 'PAYLOAD_NOT_JSON', message: (e as Error).message }] };
  }
  const pl = parse(DiscoverPayloadSchema, value, '$payload');
  if (!pl.ok) return { ok: false, errors: pl.issues.map((i) => ({ code: 'PAYLOAD_SCHEMA', message: `${i.path}: ${i.message}` })) };
  const payload = pl.value;

  const errors: IngestError[] = [];
  if (payload.entry.id !== normalizeEntryId(input.entryNodeId)) errors.push({ code: 'ENTRY_MISMATCH', message: payload.entry.id });
  if (payload.targetName !== input.targetName) errors.push({ code: 'TARGET_NAME_MISMATCH', message: 'El script buscó otro nombre.' });
  if (payload.fileKey !== null && payload.fileKey !== input.fileKey) errors.push({ code: 'FILE_KEY_MISMATCH', message: payload.fileKey });
  if (errors.length > 0) return { ok: false, errors };

  const required = input.requiredRootType ?? 'FRAME';
  const target = normalizeName(input.targetName);
  // El núcleo no confía en el filtro del script: vuelve a verificar cada coincidencia.
  const normalized = payload.matches.filter((m) => normalizeName(m.name) === target);
  const exact = normalized.filter((m) => m.name === input.targetName);

  let resolution: Resolution;
  const pick = (cands: NodeSummary[], rule: 'exact_name' | 'normalized_name'): Resolution | null => {
    if (cands.length > 1) return { status: 'ambiguous', candidates: cands, rule };
    if (cands.length === 0) return null;
    const c = cands[0]!;
    if (c.type !== required) return { status: 'wrong_type', candidate: c, requiredType: required };
    const dims = dimensionsFromName(input.targetName);
    return {
      status: 'resolved',
      candidate: c,
      entry: {
        entryNodeId: payload.entry.id,
        entryType: payload.entry.type,
        masterNodeId: c.id,
        targetName: input.targetName,
        method: rule,
        dimensionsFromNameMatch: dims ? c.width === dims.width && c.height === dims.height : null,
        discoveryDigest: env.value.digest,
        discoveryRawSha256: rawSha256,
      },
    };
  };
  resolution = pick(exact, 'exact_name') ?? pick(normalized, 'normalized_name') ?? { status: 'not_found', entryChildren: payload.entryChildren };
  return { ok: true, payload, digest: env.value.digest, rawSha256, resolution };
}
