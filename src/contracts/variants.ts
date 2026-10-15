// Contratos de la skill creative-content-variants: variantes de CONTENIDO del mismo tamaño que la maestra.
// Una fila = una variante pedida (nunca un producto cartesiano). Cada cambio se dirige a nodos vinculados
// explícitamente a un campo; no hay sustituciones globales. Las propuestas del agente NO son autorizaciones: hay dos
// confirmaciones distintas, qué campos pueden cambiar (`confirmations.fields`) y qué contenido se usa
// (`confirmations.content`), ligadas por hash a lo que se confirmó.
import { z } from 'zod';
import { RectSchema } from './geometry.ts';

/** Quién decidió algo y cuándo. `agent` nunca equivale a una autorización humana. */
export const DecisionSchema = z.strictObject({
  by: z.enum(['user', 'project_config']),
  at: z.string(),
  /** Lo que dijo o confirmó la persona, en sus palabras o resumido. */
  note: z.string().nullable(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const FontNameSchema = z.strictObject({ family: z.string().min(1), style: z.string().min(1) });
export type FontName = z.infer<typeof FontNameSchema>;

// ---------- Descubrimiento (propuesta del agente, nunca autorización) ----------

export const VARIANT_DISCOVERY_SCHEMA_ID = 'pcb.variant-discovery.v1';

export const CANDIDATE_KINDS = ['text', 'image', 'logo', 'vectorized_text', 'overlay'] as const;
export const PROPOSALS = ['vary', 'keep', 'ask'] as const;

export const FieldCandidateSchema = z.strictObject({
  candidateId: z.string().regex(/^c\d+$/),
  kind: z.enum(CANDIDATE_KINDS),
  nodeIds: z.array(z.string()).min(1),
  /** Función estimada (headline, body, cta_label, url, legal, price, date, background_image…). Heurística. */
  roleGuess: z.string(),
  /** Texto visible (dato no confiable) o descripción de la imagen por estructura. */
  excerpt: z.string(),
  /** Términos de la intención presentes en el texto ({param: valor}). */
  mentions: z.record(z.string(), z.string()),
  signals: z.array(z.string()),
  proposal: z.enum(PROPOSALS),
  reasons: z.array(z.string()),
  /** Limitaciones o riesgos (texto incrustado, máscara de silueta, auto layout, estilos mixtos, fuente ausente…). */
  risks: z.array(z.string()),
});
export type FieldCandidate = z.infer<typeof FieldCandidateSchema>;

export const VariantDiscoverySchema = z.strictObject({
  schema: z.literal(VARIANT_DISCOVERY_SCHEMA_ID),
  status: z.literal('agent_proposal'),
  source: z.enum(['FIGMA_MCP_USE_FIGMA', 'MOCK']),
  master: z.strictObject({ fileKey: z.string(), nodeId: z.string(), name: z.string(), width: z.number(), height: z.number(), fingerprint: z.string() }),
  terms: z.record(z.string(), z.string()),
  candidates: z.array(FieldCandidateSchema),
});
export type VariantDiscovery = z.infer<typeof VariantDiscoverySchema>;

// ---------- Encargo confirmado (configuración interna) ----------

export const VARIANT_JOB_SCHEMA_ID = 'pcb.variant-job.v1';

/**
 * strict: misma caja y estilos; si no cabe, se informa (la variante falla).
 * reflow: misma caja/anchura; se permite otra distribución de líneas del copy confirmado (solo saltos) y, si la maestra
 *   es de ancho automático, que el texto pase a varias líneas dentro de su ancho; el alto máximo debe declararse si crece.
 * fit_text: reduce el cuerpo (todos los segmentos con el mismo factor) hasta `minScale` EXPLÍCITO, sin mover otros
 *   bloques ni cambiar la tipografía. Un legal solo con `authorization`.
 */
export const TextPolicySchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('strict') }),
  z.strictObject({ mode: z.literal('reflow'), maxHeightPx: z.number().positive().nullable() }),
  z.strictObject({ mode: z.literal('fit_text'), minScale: z.number().gt(0).max(1), authorization: z.string().min(3).nullable() }),
]);
export type VariantTextPolicy = z.infer<typeof TextPolicySchema>;

/**
 * keep_crop: conserva modo y recorte (solo si la proporción coincide). fill: cubre el contenedor centrado. focal_point: cubre
 * centrando el punto (0..1). frame_window: cubre solo la parte del contenedor visible dentro del frame (punto focal 0..1
 * dentro de esa ventana), sin mover ni redimensionar la capa; útil cuando la foto de la maestra desborda el frame.
 */
export const ImagePolicySchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('keep_crop') }),
  z.strictObject({ mode: z.literal('fill') }),
  z.strictObject({ mode: z.literal('focal_point'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.strictObject({ mode: z.literal('frame_window'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
]);
export type VariantImagePolicy = z.infer<typeof ImagePolicySchema>;

export const VariantFieldSchema = z.strictObject({
  fieldId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  kind: z.enum(['text', 'image']),
  /** Vinculación explícita: UN nodo por campo. */
  nodeId: z.string().min(1),
  role: z.string().nullable(),
  isLegal: z.boolean(),
  /** Contenido de la maestra cuando se vinculó: la vinculación sigue siendo válida mientras coincida. */
  masterValue: z.string(),
  /** Solo texto: 'whole' (un único estilo) o 'segments' (una parte por segmento de estilo de la maestra). */
  styleMapping: z.enum(['whole', 'segments']).nullable(),
  textPolicy: TextPolicySchema.nullable(),
  imagePolicy: ImagePolicySchema.nullable(),
  /** Índice de la pintura IMAGE que se sustituye (solo imagen). */
  paintIndex: z.number().int().min(0).nullable(),
  /** Imagen bajo una máscara que no es rectangular: requiere decisión explícita (puede necesitar adaptación). */
  maskDecision: DecisionSchema.nullable(),
});
export type VariantField = z.infer<typeof VariantFieldSchema>;

export const ValueSourceSchema = z.enum(['user_provided', 'template', 'agent_draft']);

export const TextValueSchema = z.strictObject({
  kind: z.literal('text'),
  /** Copy confirmado (styleMapping 'whole'). Puede contener {{param}} si source = 'template'. */
  text: z.string().nullable(),
  /** Una parte por segmento de estilo (styleMapping 'segments'). */
  parts: z.array(z.string()).nullable(),
  /** Solo con política reflow: el mismo copy con otra distribución de saltos de línea (no es reescritura). */
  display: z.string().nullable(),
  source: ValueSourceSchema,
});

export const AssetRefSchema = z.discriminatedUnion('kind', [
  /** Imagen ya presente en el archivo de Figma (p. ej. una página o frame de fotos aportado por la persona). */
  z.strictObject({ kind: z.literal('figma_node'), nodeId: z.string().min(1), label: z.string() }),
  z.strictObject({ kind: z.literal('image_hash'), hash: z.string().min(8), label: z.string() }),
]);
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const ImageValueSchema = z.strictObject({
  kind: z.literal('image'),
  asset: AssetRefSchema.nullable(),
  source: z.enum(['user_provided', 'agent_suggested']),
});

export const VariantValueSchema = z.discriminatedUnion('kind', [TextValueSchema, ImageValueSchema]);
export type VariantValue = z.infer<typeof VariantValueSchema>;

export const VariantRowSchema = z.strictObject({
  variantId: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  label: z.string().min(1),
  /** Datos clave de la variante (grado, ciudad…). Sirven para plantillas y para detectar mezclas entre variantes. */
  params: z.record(z.string(), z.string()),
  values: z.record(z.string(), VariantValueSchema),
  notes: z.string().nullable(),
});
export type VariantRow = z.infer<typeof VariantRowSchema>;

export const VariantJobSchema = z.strictObject({
  schema: z.literal(VARIANT_JOB_SCHEMA_ID),
  /** Intención de la persona, resumida. */
  request: z.string(),
  master: z.strictObject({
    fileKey: z.string().min(1), nodeId: z.string().min(1), name: z.string(), width: z.number(), height: z.number(),
    /** Huella de la instantánea con la que se hizo la vinculación. */
    fingerprint: z.string(),
    /** Valores de los parámetros que ya muestra la maestra (p. ej. {grado: 'Derecho', ciudad: 'Madrid'}). */
    params: z.record(z.string(), z.string()),
  }),
  params: z.array(z.strictObject({ paramId: z.string().regex(/^[a-z][a-z0-9_]*$/), label: z.string() })),
  fields: z.array(VariantFieldSchema),
  /** Elementos que se mantienen (explícitos para el resumen; todo lo no vinculado se mantiene igualmente). */
  kept: z.array(z.strictObject({ label: z.string(), nodeIds: z.array(z.string()), why: z.string() })),
  protected: z.strictObject({
    logoNodeIds: z.array(z.string()),
    /** Zona segura en coordenadas del frame (solo si aplica a esta pieza; nunca inventada). */
    safeArea: RectSchema.nullable(),
    safeAreaNote: z.string().nullable(),
  }),
  variants: z.array(VariantRowSchema),
  output: z.strictObject({
    sectionName: z.string().min(1),
    /** {master} y {variant} ({VARIANT} en mayúsculas) se sustituyen; el nombre identifica la variante en reejecuciones. */
    cloneNamePattern: z.string().refine((p) => p.includes('{variant}') || p.includes('{VARIANT}'), 'debe incluir {variant} o {VARIANT}'),
  }),
  /**
   * Solo encargos de traducción (translation-job): procedencia de la tabla confirmada y fuentes sustitutas AUTORIZADAS
   * por la persona para cada variante (idioma). Un fallback solo se aplica en la copia traducida si la fuente original
   * no carga, y la copia se marca _PENDIENTE-FUENTE.
   */
  translation: z.strictObject({
    sourceLang: z.string(),
    /** variantId → hash de la tabla de traducción confirmada. */
    tableHashes: z.record(z.string(), z.string()),
    fontFallbacks: z.record(z.string(), z.array(z.strictObject({ from: FontNameSchema, to: FontNameSchema, decision: DecisionSchema }))),
  }).optional(),
  confirmations: z.strictObject({
    fields: z.strictObject({ decision: DecisionSchema, hash: z.string() }).nullable(),
    /** Hash de cada variante confirmada: cambiar su contenido después exige confirmarla de nuevo. */
    content: z.strictObject({ decision: DecisionSchema, variantHashes: z.record(z.string(), z.string()) }).nullable(),
  }),
});
export type VariantJob = z.infer<typeof VariantJobSchema>;

// ---------- Lectura de activos (solo lectura) ----------

export const VARIANT_ASSETS_SCHEMA_ID = 'pcb.variant-assets.v1';
export interface VariantAssetsRead {
  schema: typeof VARIANT_ASSETS_SCHEMA_ID;
  nodes: Array<{ nodeId: string; found: boolean; type: string | null; width: number | null; height: number | null; images: Array<{ paintIndex: number; hash: string | null; visible: boolean; width: number | null; height: number | null; error: string | null }> }>;
  hashes: Array<{ hash: string; found: boolean; width: number | null; height: number | null; error: string | null }>;
}

// ---------- Resultado del script de escritura ----------

export const VARIANT_RESULT_SCHEMA_ID = 'pcb.variant.result.v1';
export const VariantResultSchema = z.strictObject({
  schema: z.literal(VARIANT_RESULT_SCHEMA_ID),
  scriptVersion: z.string(),
  mode: z.enum(['create', 'patch']),
  masterNodeId: z.string(),
  sectionId: z.string(),
  sectionCreated: z.boolean(),
  fonts: z.array(z.strictObject({ family: z.string(), style: z.string(), loaded: z.boolean(), error: z.string().nullable() })),
  variants: z.array(z.strictObject({
    variantId: z.string(),
    /** exists = ya había un clon con ese nombre: no se duplica ni se toca. */
    status: z.enum(['created', 'patched', 'exists', 'failed']),
    cloneId: z.string().nullable(),
    cloneName: z.string(),
    applied: z.array(z.strictObject({ op: z.enum(['replace_text', 'fit_text', 'reflow_text', 'replace_image']), cloneNodeId: z.string(), masterNodeId: z.string(), detail: z.unknown() })),
    error: z.string().nullable(),
    /** Solo traducciones: fuentes sustitutas autorizadas que se aplicaron porque la original no cargó. */
    fontFallbacks: z.array(z.strictObject({ from: FontNameSchema, to: FontNameSchema })).optional(),
  })),
});
export type VariantResult = z.infer<typeof VariantResultSchema>;
