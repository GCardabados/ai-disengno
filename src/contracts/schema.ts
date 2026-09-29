// Validador de esquemas mínimo, sin dependencias.
// Sustituible por zod cuando se autorice instalar paquetes.
// Valida ESTRUCTURA. No prueba fidelidad del transporte (ver src/figma/ingest.ts).

export interface Issue {
  path: string;
  message: string;
}

export interface Schema<T> {
  readonly optional: boolean;
  check(value: unknown, path: string, issues: Issue[]): void;
  /** Solo para inferencia de tipos; nunca tiene valor. */
  readonly __type?: T;
}

export interface OptionalSchema<T> extends Schema<T> {
  readonly optional: true;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends OptionalSchema<unknown> ? K : never;
}[keyof S];
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>;
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type ObjectOf<S extends Shape> = Simplify<
  { [K in RequiredKeys<S>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Infer<S[K]> }
>;

function make<T>(check: Schema<T>['check']): Schema<T> {
  return { optional: false, check };
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const s = {
  unknown(): Schema<unknown> {
    return make<unknown>(() => {});
  },

  string(opts: { min?: number; pattern?: RegExp } = {}): Schema<string> {
    return make<string>((v, p, i) => {
      if (typeof v !== 'string') return void i.push({ path: p, message: `expected string, got ${describe(v)}` });
      if (opts.min !== undefined && v.length < opts.min) i.push({ path: p, message: `string shorter than ${opts.min}` });
      if (opts.pattern && !opts.pattern.test(v)) i.push({ path: p, message: `string does not match ${opts.pattern}` });
    });
  },

  number(opts: { int?: boolean; min?: number; max?: number } = {}): Schema<number> {
    return make<number>((v, p, i) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return void i.push({ path: p, message: `expected finite number, got ${describe(v)}` });
      }
      if (opts.int && !Number.isInteger(v)) i.push({ path: p, message: 'expected integer' });
      if (opts.min !== undefined && v < opts.min) i.push({ path: p, message: `number < ${opts.min}` });
      if (opts.max !== undefined && v > opts.max) i.push({ path: p, message: `number > ${opts.max}` });
    });
  },

  boolean(): Schema<boolean> {
    return make<boolean>((v, p, i) => {
      if (typeof v !== 'boolean') i.push({ path: p, message: `expected boolean, got ${describe(v)}` });
    });
  },

  literal<const L extends string | number | boolean>(lit: L): Schema<L> {
    return make<L>((v, p, i) => {
      if (v !== lit) i.push({ path: p, message: `expected ${JSON.stringify(lit)}` });
    });
  },

  enumOf<const L extends readonly string[]>(values: L): Schema<L[number]> {
    return make<L[number]>((v, p, i) => {
      if (typeof v !== 'string' || !values.includes(v)) {
        i.push({ path: p, message: `expected one of ${values.join('|')}` });
      }
    });
  },

  array<T>(item: Schema<T>, opts: { min?: number } = {}): Schema<T[]> {
    return make<T[]>((v, p, i) => {
      if (!Array.isArray(v)) return void i.push({ path: p, message: `expected array, got ${describe(v)}` });
      if (opts.min !== undefined && v.length < opts.min) i.push({ path: p, message: `array shorter than ${opts.min}` });
      v.forEach((el, idx) => item.check(el, `${p}[${idx}]`, i));
    });
  },

  tuple<const T extends readonly Schema<unknown>[]>(items: T): Schema<{ [K in keyof T]: Infer<T[K]> }> {
    return make<{ [K in keyof T]: Infer<T[K]> }>((v, p, i) => {
      if (!Array.isArray(v) || v.length !== items.length) {
        return void i.push({ path: p, message: `expected tuple of length ${items.length}` });
      }
      items.forEach((sch, idx) => sch.check(v[idx], `${p}[${idx}]`, i));
    });
  },

  record<T>(value: Schema<T>): Schema<Record<string, T>> {
    return make<Record<string, T>>((v, p, i) => {
      if (!isPlainObject(v)) return void i.push({ path: p, message: `expected object, got ${describe(v)}` });
      for (const [k, el] of Object.entries(v)) value.check(el, `${p}.${k}`, i);
    });
  },

  nullable<T>(inner: Schema<T>): Schema<T | null> {
    return make<T | null>((v, p, i) => {
      if (v !== null) inner.check(v, p, i);
    });
  },

  optional<T>(inner: Schema<T>): OptionalSchema<T> {
    return {
      optional: true,
      check(v, p, i) {
        if (v !== undefined) inner.check(v, p, i);
      },
    };
  },

  /** Objeto estricto por defecto: las claves desconocidas son un error (detecta deriva del contrato). */
  object<S extends Shape>(shape: S, opts: { strict?: boolean } = {}): Schema<ObjectOf<S>> {
    const strict = opts.strict !== false;
    return make<ObjectOf<S>>((v, p, i) => {
      if (!isPlainObject(v)) return void i.push({ path: p, message: `expected object, got ${describe(v)}` });
      for (const [key, sch] of Object.entries(shape)) {
        if (!(key in v) || v[key] === undefined) {
          if (!sch.optional) i.push({ path: `${p}.${key}`, message: 'required' });
          continue;
        }
        sch.check(v[key], `${p}.${key}`, i);
      }
      if (strict) {
        for (const key of Object.keys(v)) {
          if (!(key in shape)) i.push({ path: `${p}.${key}`, message: 'unexpected key' });
        }
      }
    });
  },

  union<const T extends readonly Schema<unknown>[]>(options: T): Schema<Infer<T[number]>> {
    return make<Infer<T[number]>>((v, p, i) => {
      let best: Issue[] | null = null;
      for (const opt of options) {
        const local: Issue[] = [];
        opt.check(v, p, local);
        if (local.length === 0) return;
        if (best === null || local.length < best.length) best = local;
      }
      i.push({ path: p, message: 'no union branch matched' }, ...(best ?? []));
    });
  },

  /** Unión discriminada por una clave literal; mejores mensajes que union(). */
  discriminated<K extends string, const M extends Record<string, Schema<unknown>>>(
    key: K,
    branches: M,
  ): Schema<Infer<M[keyof M]>> {
    return make<Infer<M[keyof M]>>((v, p, i) => {
      if (!isPlainObject(v)) return void i.push({ path: p, message: `expected object, got ${describe(v)}` });
      const tag = v[key];
      const branch = typeof tag === 'string' ? branches[tag] : undefined;
      if (!branch) {
        return void i.push({ path: `${p}.${key}`, message: `expected one of ${Object.keys(branches).join('|')}` });
      }
      branch.check(v, p, i);
    });
  },

  refine<T>(inner: Schema<T>, pred: (v: T) => boolean, message: string): Schema<T> {
    return make<T>((v, p, i) => {
      const local: Issue[] = [];
      inner.check(v, p, local);
      if (local.length > 0) return void i.push(...local);
      if (!pred(v as T)) i.push({ path: p, message });
    });
  },
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export function parse<T>(schema: Schema<T>, value: unknown, root = '$'): ParseResult<T> {
  const issues: Issue[] = [];
  schema.check(value, root, issues);
  return issues.length === 0 ? { ok: true, value: value as T } : { ok: false, issues };
}

export function parseOrThrow<T>(schema: Schema<T>, value: unknown, label: string): T {
  const r = parse(schema, value);
  if (!r.ok) {
    const head = r.issues.slice(0, 20).map((x) => `  ${x.path}: ${x.message}`).join('\n');
    throw new Error(`${label}: ${r.issues.length} schema issue(s)\n${head}`);
  }
  return r.value;
}
