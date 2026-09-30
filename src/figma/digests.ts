// Comprobación barata de que la maestra no cambió: una llamada de lectura en modo 'node-digests' devuelve el hash de
// cada registro (JSON.stringify en Figma) y el del payload completo; aquí se recalculan sobre el payload ensamblado
// del inventario. Coincidencia exacta = mismos registros, byte a byte. Como el resto del transporte, detecta cambios
// entre lecturas; no es una captura atómica.
import { sha256Hex } from '../hash/canonical.ts';
import { extractEnvelope } from './ingest-envelope.ts';

export const NODE_DIGESTS_SCHEMA_ID = 'pcb.read.nodedigests.v1';

export interface DigestComparison {
  equal: boolean;
  payloadEqual: boolean;
  changedNodeIds: string[];
  missingNodeIds: string[];
  addedNodeIds: string[];
}

export function payloadNodeDigests(payloadText: string): Array<[string, string]> {
  const p = JSON.parse(payloadText) as { nodes: Array<{ id: string }> };
  return p.nodes.map((n) => [n.id, sha256Hex(JSON.stringify(n)).slice(0, 16)]);
}

export function compareNodeDigests(payloadText: string, digestsRaw: string): DigestComparison {
  const ext = extractEnvelope(digestsRaw, NODE_DIGESTS_SCHEMA_ID);
  if ('code' in ext) throw new Error(`${ext.code}: ${ext.message}`);
  const env = ext.value as { payloadSha256: string; nodeDigests: Array<[string, string]> };
  const expected = new Map(payloadNodeDigests(payloadText));
  const got = new Map(env.nodeDigests);
  const changedNodeIds = [...expected].filter(([id, d]) => got.has(id) && got.get(id) !== d).map(([id]) => id);
  const missingNodeIds = [...expected.keys()].filter((id) => !got.has(id));
  const addedNodeIds = [...got.keys()].filter((id) => !expected.has(id));
  const payloadEqual = env.payloadSha256 === `sha256:${sha256Hex(payloadText)}`;
  return {
    equal: payloadEqual && changedNodeIds.length === 0 && missingNodeIds.length === 0 && addedNodeIds.length === 0,
    payloadEqual,
    changedNodeIds,
    missingNodeIds,
    addedNodeIds,
  };
}
