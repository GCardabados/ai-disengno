// Adaptador fino sobre Zod: conserva la API parse/parseOrThrow que usan los demás módulos.
// Valida ESTRUCTURA. No prueba fidelidad del transporte (ver src/figma/ingest.ts).
// Convención: todos los objetos de contrato son z.strictObject (una clave desconocida es un error:
// detecta deriva del contrato).
import type { z } from 'zod';

export interface Issue {
  path: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

function formatPath(root: string, path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : `${acc}.${String(seg)}`), root);
}

export function parse<S extends z.ZodType>(schema: S, value: unknown, root = '$'): ParseResult<z.output<S>> {
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, issues: r.error.issues.map((i) => ({ path: formatPath(root, i.path), message: i.message })) };
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, label: string): z.output<S> {
  const r = parse(schema, value);
  if (!r.ok) {
    const head = r.issues.slice(0, 20).map((x) => `  ${x.path}: ${x.message}`).join('\n');
    throw new Error(`${label}: ${r.issues.length} schema issue(s)\n${head}`);
  }
  return r.value;
}
