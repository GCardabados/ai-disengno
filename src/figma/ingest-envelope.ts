// Localización del sobre dentro de la respuesta original de una herramienta.
// El formato exacto con el que use_figma envuelve el valor devuelto se comprobó en real el 2026-09-29:
// una lista de bloques de contenido con un bloque de texto que contiene el JSON (→ 'embedded_json_block').
import { READ_CHUNK_ENVELOPE_SCHEMA_ID } from '../contracts/snapshot.ts';

export interface IngestError {
  code: string;
  message: string;
}

function isEnvelopeLike(v: unknown, schemaId: string): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && (v as Record<string, unknown>).schema === schemaId;
}

/**
 * Se acepta el sobre directamente o un único sobre anidado en la estructura JSON (bloques de contenido con un
 * campo de texto que contiene el JSON del sobre, que es lo observado en real). Más de uno, o ninguno, es un error.
 */
export function extractEnvelope(
  raw: string,
  schemaId: string = READ_CHUNK_ENVELOPE_SCHEMA_ID,
): { value: unknown; extraction: 'direct' | 'embedded_json_block' } | IngestError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { code: 'RAW_NOT_JSON', message: `La respuesta no es JSON: ${(e as Error).message}` };
  }
  if (isEnvelopeLike(parsed, schemaId)) return { value: parsed, extraction: 'direct' };
  const found: unknown[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8) return;
    if (isEnvelopeLike(v, schemaId)) return void found.push(v);
    if (typeof v === 'string' && v.includes(schemaId)) {
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
  return { code: 'ENVELOPE_NOT_FOUND', message: `No se encontró un sobre ${schemaId}.` };
}
