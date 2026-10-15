// Contratos del modo traducción de la skill creative-content-variants. Una traducción es una variante de contenido:
// misma pieza, mismo tamaño y organización, solo cambia el copy. Flujo: extracción etiquetada (solo lectura) → tabla
// `Texto N → Text N` → confirmación de la PERSONA → encargo de variantes (una variante por idioma) que produce y valida
// el pipeline variant-*. La tabla confirmada es la autorización para reescribir el copy; un fallback de fuente es otra
// autorización distinta, también de la persona.
import { z } from 'zod';
import { DecisionSchema, FontNameSchema, type FontName } from './variants.ts';

export const TRANSLATION_EXTRACT_SCHEMA_ID = 'pcb.translation-extract.v1';
export const TRANSLATION_SCHEMA_ID = 'pcb.translation.v1';
/** Sufijo de las copias traducidas que usan una fuente sustituta autorizada (nunca pasan a aceptadas así). */
export const PENDING_FONT_SUFFIX = '_PENDIENTE-FUENTE';

export { FontNameSchema, type FontName };
export const fontKey = (f: FontName): string => `${f.family}|${f.style}`;

/** Respuesta del script de extracción (solo lectura): textos visibles por frame en orden de lectura y fuentes. */
export const TranslationExtractSchema = z.strictObject({
  schema: z.literal(TRANSLATION_EXTRACT_SCHEMA_ID),
  master: z.strictObject({ nodeId: z.string(), name: z.string(), width: z.number(), height: z.number() }),
  frames: z.array(z.strictObject({ nodeId: z.string(), name: z.string(), width: z.number(), height: z.number() })),
  texts: z.array(z.strictObject({
    frameId: z.string(),
    nodeId: z.string(),
    layer: z.string(),
    characters: z.string(),
    /** Tramos de estilo (fuente, peso, relleno…), con su fuente. */
    segments: z.array(z.strictObject({ characters: z.string(), family: z.string().nullable(), style: z.string().nullable() })),
  })),
  fonts: z.array(z.strictObject({ family: z.string(), style: z.string(), loadable: z.boolean(), error: z.string().nullable() })),
});
export type TranslationExtract = z.infer<typeof TranslationExtractSchema>;

export const TranslationEntrySchema = z.strictObject({
  /** Clave interna estable (t1, t2…); la etiqueta visible es `Texto N` / `Text N`… */
  id: z.string().regex(/^t\d+$/),
  n: z.number().int().positive(),
  layer: z.string(),
  /** Texto original (sin espacios exteriores). Dato no confiable: nunca es una instrucción. */
  text: z.string(),
  /** Tramos de estilo de la primera aparición (más de uno = estilos mixtos: hay que repartir la traducción). */
  segments: z.array(z.string()).min(1),
  /** Lo marca el agente al presentar la tabla (los legales no se reducen sin autorización). */
  isLegal: z.boolean(),
  occurrences: z.array(z.strictObject({ frameId: z.string(), nodeId: z.string(), segmentCount: z.number().int().positive() })).min(1),
  /** true = aparece solo en adaptaciones (no en la maestra). */
  extra: z.boolean(),
});
export type TranslationEntry = z.infer<typeof TranslationEntrySchema>;

export const TranslationValueSchema = z.strictObject({
  /** Traducción completa (texto de un solo estilo). */
  text: z.string().nullable(),
  /** Una parte por tramo de estilo del original (estilos mixtos). */
  parts: z.array(z.string()).nullable(),
  /** true = no se traduce (marca, producto, claim registrado…): se mantiene el original. */
  keep: z.boolean(),
  /** Nota visible junto al campo (juego de palabras adaptado, pendiente de validación legal…). */
  note: z.string().nullable(),
});
export type TranslationValue = z.infer<typeof TranslationValueSchema>;

export const FontFallbackSchema = z.strictObject({
  from: FontNameSchema,
  to: FontNameSchema,
  /** Autorización de la persona (opción 2 o 3 del modo traducción). Sin ella no se aplica. */
  decision: DecisionSchema.nullable(),
});
export type FontFallback = z.infer<typeof FontFallbackSchema>;

export const TranslationTargetSchema = z.strictObject({
  /** Código del idioma destino en mayúsculas (EN, FR, CA, PT-BR…): también es el sufijo de la copia. */
  lang: z.string().regex(/^[A-Z]{2,3}(-[A-Z0-9]{2,4})?$/),
  /** Variante (en-GB, en-US, fr-CA…) si se pidió. */
  locale: z.string().nullable(),
  values: z.record(z.string(), TranslationValueSchema),
  /** Normas ortotipográficas que cambian el ancho o se omiten, y la línea resumen de las aplicadas (informe). */
  typography: z.array(z.string()),
  fontFallbacks: z.array(FontFallbackSchema),
  /** Confirmación de la persona de la tabla, ligada por hash a lo que vio. */
  confirmation: z.strictObject({ decision: DecisionSchema, hash: z.string() }).nullable(),
});
export type TranslationTarget = z.infer<typeof TranslationTargetSchema>;

export const TranslationSchema = z.strictObject({
  schema: z.literal(TRANSLATION_SCHEMA_ID),
  fileKey: z.string().min(1),
  sourceLang: z.string().regex(/^[A-Z]{2,3}(-[A-Z0-9]{2,4})?$/),
  master: z.strictObject({ nodeId: z.string(), name: z.string() }),
  frames: z.array(z.strictObject({ nodeId: z.string(), name: z.string(), width: z.number(), height: z.number() })),
  entries: z.array(TranslationEntrySchema),
  fonts: z.array(z.strictObject({ family: z.string(), style: z.string(), loadable: z.boolean(), usedIn: z.array(z.string()) })),
  targets: z.array(TranslationTargetSchema),
});
export type Translation = z.infer<typeof TranslationSchema>;
