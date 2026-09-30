// Ensamblado de fragmentos de lectura (una respuesta de use_figma por fragmento).
//
// Detecta: fragmentos ausentes, duplicados (idénticos → se descartan; incompatibles → error), desorden (se
// reordena por índice), truncamiento, alteraciones (hash por fragmento y del conjunto) y mezclas de conjuntos
// o cambios de contenido entre llamadas (todos los fragmentos deben declarar el mismo hash del payload completo).
//
// LÍMITE: cada llamada relee la maestra por separado (use_figma no conserva estado). Exigir el mismo hash del
// contenido completo en todos los fragmentos DETECTA inconsistencias entre llamadas, pero NO garantiza una captura
// transaccional atómica de Figma: un cambio que se deshaga entre llamadas, o que ocurra y revierta durante una
// lectura, no es observable desde aquí.
import { parse } from '../contracts/schema.ts';
import { READ_CHUNK_ENVELOPE_SCHEMA_ID, ReadChunkEnvelopeSchema, type ReadChunkEnvelope } from '../contracts/snapshot.ts';
import { sha256Hex } from '../hash/canonical.ts';
import { extractEnvelope, type IngestError } from './ingest-envelope.ts';

export interface ChunkResponse {
  rawText: string;
  rawResponsePath: string | null;
}

export interface AssembledPayload {
  payload: string;
  payloadSha256: string;
  payloadBytes: number;
  setId: string;
  rootNodeId: string;
  byteBudget: number;
  chunkCount: number;
  duplicatesDiscarded: number;
  calls: Array<{
    chunkIndex: number;
    rawResponseSha256: string;
    rawResponsePath: string | null;
    envelopeExtraction: 'direct' | 'embedded_json_block';
    skipInvisibleInstanceChildrenBefore: boolean | null;
    missingFontNodeIds: string[];
    responseBytes: number;
  }>;
}

export type AssembleResult = { ok: true; value: AssembledPayload } | { ok: false; errors: IngestError[] };

const TRUNCATION_MARKER = /truncated to \d+\s*kb/i;

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export function assembleChunks(responses: ChunkResponse[]): AssembleResult {
  if (responses.length === 0) return { ok: false, errors: [{ code: 'NO_RESPONSES', message: 'No hay respuestas que ensamblar.' }] };
  const errors: IngestError[] = [];
  const parsed: Array<{ env: ReadChunkEnvelope; resp: ChunkResponse; rawSha: string; extraction: 'direct' | 'embedded_json_block' }> = [];

  responses.forEach((resp, i) => {
    const rawSha = `sha256:${sha256Hex(resp.rawText)}`;
    const ext = extractEnvelope(resp.rawText, READ_CHUNK_ENVELOPE_SCHEMA_ID);
    if ('code' in ext) {
      const truncated = TRUNCATION_MARKER.test(resp.rawText);
      errors.push({
        code: truncated ? 'RESPONSE_TRUNCATED' : ext.code,
        message: `respuesta #${i}: ${truncated ? 'el transporte truncó la respuesta; reducir el presupuesto de bytes' : ext.message}`,
      });
      return;
    }
    const env = parse(ReadChunkEnvelopeSchema, ext.value, `$response[${i}]`);
    if (!env.ok) {
      errors.push(...env.issues.map((x) => ({ code: 'CHUNK_SCHEMA', message: `${x.path}: ${x.message}` })));
      return;
    }
    const e = env.value;
    if (`sha256:${sha256Hex(e.chunk)}` !== e.chunkSha256) {
      errors.push({ code: 'CHUNK_DIGEST_MISMATCH', message: `respuesta #${i} (fragmento ${e.chunkIndex}): el hash del fragmento no coincide` });
      return;
    }
    if (e.chunk.length !== e.chunkChars || utf8Bytes(e.chunk) !== e.chunkBytes) {
      errors.push({ code: 'CHUNK_LENGTH_MISMATCH', message: `respuesta #${i} (fragmento ${e.chunkIndex})` });
      return;
    }
    if (e.chunkIndex >= e.chunkCount) {
      errors.push({ code: 'CHUNK_INDEX_OUT_OF_RANGE', message: `respuesta #${i}: ${e.chunkIndex} ≥ ${e.chunkCount}` });
      return;
    }
    const expectedSetId = `set_${e.payloadSha256.slice('sha256:'.length, 'sha256:'.length + 16)}_b${e.byteBudget}`;
    if (e.setId !== expectedSetId) {
      errors.push({ code: 'SET_ID_INCONSISTENT', message: `respuesta #${i}: setId no deriva del hash del payload` });
      return;
    }
    parsed.push({ env: e, resp, rawSha, extraction: ext.extraction });
  });
  if (errors.length > 0) return { ok: false, errors };

  // Un único conjunto: mismo contenido completo, mismo presupuesto y misma raíz en TODAS las llamadas.
  const signature = (e: ReadChunkEnvelope) =>
    JSON.stringify([e.setId, e.payloadSha256, e.payloadBytes, e.payloadChars, e.chunkCount, e.byteBudget, e.rootNodeId, e.payloadSchema]);
  const groups = new Map<string, number[]>();
  parsed.forEach((p) => {
    const k = signature(p.env);
    groups.set(k, [...(groups.get(k) ?? []), p.env.chunkIndex]);
  });
  if (groups.size > 1) {
    const detail = [...groups.entries()].map(([k, idx]) => `${JSON.parse(k)[0]} (hash ${String(JSON.parse(k)[1]).slice(7, 19)}…) → fragmentos ${idx.join(',')}`);
    return {
      ok: false,
      errors: [
        {
          code: 'SET_MISMATCH',
          message: `Fragmentos de conjuntos distintos (cambio de contenido entre llamadas o mezcla): ${detail.join(' | ')}. Descartar el conjunto y volver a leer.`,
        },
      ],
    };
  }

  const first = parsed[0]!.env;
  const byIndex = new Map<number, (typeof parsed)[number]>();
  let duplicatesDiscarded = 0;
  for (const p of parsed) {
    const prev = byIndex.get(p.env.chunkIndex);
    if (!prev) {
      byIndex.set(p.env.chunkIndex, p);
      continue;
    }
    if (prev.env.chunkSha256 === p.env.chunkSha256 && prev.env.chunk === p.env.chunk) {
      duplicatesDiscarded++;
    } else {
      errors.push({ code: 'DUPLICATE_CONFLICT', message: `fragmento ${p.env.chunkIndex} recibido con contenidos distintos` });
    }
  }
  const missing: number[] = [];
  for (let i = 0; i < first.chunkCount; i++) if (!byIndex.has(i)) missing.push(i);
  if (missing.length > 0) errors.push({ code: 'CHUNK_MISSING', message: `faltan fragmentos: ${missing.join(', ')} de ${first.chunkCount}` });
  if (errors.length > 0) return { ok: false, errors };

  const ordered = [...byIndex.values()].sort((a, b) => a.env.chunkIndex - b.env.chunkIndex);
  const payload = ordered.map((p) => p.env.chunk).join('');
  if (payload.length !== first.payloadChars || utf8Bytes(payload) !== first.payloadBytes) {
    return { ok: false, errors: [{ code: 'ASSEMBLED_LENGTH_MISMATCH', message: 'La longitud del payload ensamblado no coincide.' }] };
  }
  if (`sha256:${sha256Hex(payload)}` !== first.payloadSha256) {
    return { ok: false, errors: [{ code: 'ASSEMBLED_DIGEST_MISMATCH', message: 'El hash del payload ensamblado no coincide.' }] };
  }
  return {
    ok: true,
    value: {
      payload,
      payloadSha256: first.payloadSha256,
      payloadBytes: first.payloadBytes,
      setId: first.setId,
      rootNodeId: first.rootNodeId,
      byteBudget: first.byteBudget,
      chunkCount: first.chunkCount,
      duplicatesDiscarded,
      calls: ordered.map((p) => ({
        chunkIndex: p.env.chunkIndex,
        rawResponseSha256: p.rawSha,
        rawResponsePath: p.resp.rawResponsePath,
        envelopeExtraction: p.extraction,
        skipInvisibleInstanceChildrenBefore: p.env.call.skipInvisibleInstanceChildrenBefore,
        missingFontNodeIds: [...p.env.call.missingFontNodeIds].sort(),
        responseBytes: p.env.call.responseBytes,
      })),
    },
  };
}
