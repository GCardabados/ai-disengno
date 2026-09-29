// Serialización canónica para hashes.
// - Claves ordenadas por unidades de código UTF-16; sin espacios.
// - Números redondeados a DECIMALS decimales; -0 → 0; NaN/Infinity rechazados.
// - undefined rechazado en cualquier posición (los campos ausentes se omiten, no se ponen a undefined).
// - Arrays en su orden (el orden es significativo: hijos, rellenos, segmentos).
// - Cadenas SIN normalizar Unicode: una "é" compuesta y una descompuesta dan hashes distintos, a propósito.
import { createHash } from 'node:crypto';

export const HASH_VERSION = 'pcb.hash.v1';
export const DECIMALS = 4;
const FACTOR = 10 ** DECIMALS;

export class CanonicalizationError extends Error {}

function normNumber(n: number, path: string): string {
  if (!Number.isFinite(n)) throw new CanonicalizationError(`non-finite number at ${path}`);
  let r = Math.round(n * FACTOR) / FACTOR;
  if (Object.is(r, -0)) r = 0;
  return JSON.stringify(r);
}

function canon(v: unknown, path: string): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      return normNumber(v, path);
    case 'string':
      return JSON.stringify(v);
    case 'undefined':
      throw new CanonicalizationError(`undefined at ${path}`);
    case 'object': {
      if (Array.isArray(v)) return `[${v.map((el, i) => canon(el, `${path}[${i}]`)).join(',')}]`;
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError(`non-plain object at ${path}`);
      }
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(obj[k], `${path}.${k}`)}`).join(',')}}`;
    }
    default:
      throw new CanonicalizationError(`unsupported ${typeof v} at ${path}`);
  }
}

export function canonicalize(value: unknown): string {
  return canon(value, '$');
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** `sha256:<hex>` sobre {"v":HASH_VERSION,"kind":kind,"data":data} canónico. */
export function hashOf(kind: string, data: unknown): string {
  return `sha256:${sha256Hex(canonicalize({ v: HASH_VERSION, kind, data }))}`;
}

export function shortId(prefix: string, data: unknown): string {
  return `${prefix}_${sha256Hex(canonicalize(data)).slice(0, 12)}`;
}
