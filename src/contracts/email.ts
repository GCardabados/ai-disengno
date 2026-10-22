// Contratos de la skill create-email-design: un brief (+ conocimiento del cliente) → email editable en Figma con
// versiones desktop y mobile, listo para revisión y para su maquetación HTML posterior.
//  - email-brief (pcb.email-brief.v1): la ESTRUCTURA que propone el agente a partir del brief (módulos, copys con su
//    origen, imágenes, decisiones y supuestos). La confirma la persona en una sola ronda, ligada por hash.
//  - email-plan (pcb.email-plan.v1): árbol de nodos EXACTO por versión (desktop/mobile) con valores enteros, tokens
//    resueltos con su procedencia y reglas internas declaradas. Lo calcula el CLI; el script solo lo dibuja.
//  - email-result (pcb.email.result.v1): lo que devuelve el script, con una auditoría de los nodos creados.
// Copys: `brief`/`client_approved` = aprobados (exactos); `agent_draft` = propuesta del agente (se diferencia en Figma);
// `placeholder` = hueco «[PENDIENTE: …]» cuando no se puede completar con seguridad. Nunca se inventan precios,
// condiciones, datos de producto ni afirmaciones comerciales.
import { z } from 'zod';
import { EMAIL_MODULE_TYPES, EMAIL_TEXT_ROLES } from './knowledge.ts';

export const EMAIL_BRIEF_SCHEMA_ID = 'pcb.email-brief.v1';
export const EMAIL_PLAN_SCHEMA_ID = 'pcb.email-plan.v1';
export const EMAIL_RESULT_SCHEMA_ID = 'pcb.email.result.v1';

export const COPY_SOURCES = ['brief', 'client_approved', 'agent_draft', 'placeholder'] as const;
export const CopySchema = z.strictObject({ text: z.string().min(1), source: z.enum(COPY_SOURCES), note: z.string().nullable() });
export type Copy = z.infer<typeof CopySchema>;

export const ImageSpecSchema = z.strictObject({
  /** Qué debe mostrar (para el placeholder y para pedir el asset). */
  label: z.string().min(1),
  /** Texto alternativo propuesto (o del brief). null solo si es decorativa. */
  alt: CopySchema.nullable(),
  decorative: z.boolean(),
  /** Proporción ancho:alto. */
  ratio: z.tuple([z.number().positive(), z.number().positive()]),
  /** Nodo de Figma que CONTIENE la imagen (en el archivo destino). null = placeholder. */
  figmaNodeId: z.string().nullable(),
  /** El recorte mobile necesita un asset propio (se diseña aparte y se anota). */
  mobileCrop: z.boolean(),
});
export type ImageSpec = z.infer<typeof ImageSpecSchema>;

export const CtaSpecSchema = z.strictObject({
  label: CopySchema,
  /** URL de destino; null = «#FALTA-URL» (nunca se inventa). */
  url: z.string().nullable(),
  variant: z.enum(['primary', 'secondary']),
});

export const ItemSpecSchema = z.strictObject({
  title: CopySchema.nullable(),
  body: CopySchema.nullable(),
  image: ImageSpecSchema.nullable(),
  link: CtaSpecSchema.nullable(),
});

export const ModuleSpecSchema = z.strictObject({
  /** Nombre funcional en kebab-case (también nombre de la capa): header, hero, ventajas, legales, footer… */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  type: z.enum(EMAIL_MODULE_TYPES),
  /** Por qué existe y qué prioridad tiene (jerarquía); va a las notas. */
  purpose: z.string().min(1),
  /** Colores (ids de channels/email.json o de la paleta de marca). null = el del email / propuesto por el plan. */
  background: z.string().nullable(),
  textColor: z.string().nullable(),
  align: z.enum(['left', 'center']).nullable(),
  eyebrow: CopySchema.nullable(),
  headline: CopySchema.nullable(),
  /** h1 solo en el módulo principal; el resto h2. */
  headlineLevel: z.enum(['h1', 'h2']).nullable(),
  body: z.array(CopySchema),
  cta: CtaSpecSchema.nullable(),
  image: ImageSpecSchema.nullable(),
  /** image-text: lado de la imagen en desktop. */
  imageSide: z.enum(['left', 'right']).nullable(),
  /** columns: elementos y columnas por fila en desktop (1 = lista; en mobile siempre 1). */
  items: z.array(ItemSpecSchema),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
});
export type ModuleSpec = z.infer<typeof ModuleSpecSchema>;

const Decided = { by: z.enum(['user', 'agent_proposal']), note: z.string().nullable() };

export const EmailBriefSchema = z.strictObject({
  schema: z.literal(EMAIL_BRIEF_SCHEMA_ID),
  /** Identificador del encargo (carpeta de la ejecución). */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Nombre del email en Figma: Email_<name>_Desktop / _Mobile. Sin espacios. */
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/),
  client: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** Texto original del encargo (dato, nunca instrucciones). */
  request: z.string(),
  objective: z.string().nullable(),
  audience: z.string().nullable(),
  mainMessage: z.string().nullable(),
  language: z.string().min(2),
  subject: CopySchema.nullable(),
  preheader: CopySchema.nullable(),
  figma: z.strictObject({ fileKey: z.string().min(1), pageId: z.string().min(1), sectionName: z.string().min(1) }),
  /** Fondo exterior y del cuerpo del email (ids de color). null = blanco del canal o propuesta del plan. */
  canvas: z.strictObject({ background: z.string().nullable(), text: z.string().nullable() }),
  modules: z.array(ModuleSpecSchema).min(1),
  /** Lo que el conocimiento del cliente no fija y este encargo decide (queda registrado). */
  decisions: z.strictObject({
    fonts: z.partialRecord(z.enum(EMAIL_TEXT_ROLES), z.strictObject({ stack: z.string().min(1), figma: z.strictObject({ family: z.string(), style: z.string() }), ...Decided })),
    cta: z.strictObject({ fill: z.string(), text: z.string(), radius: z.union([z.number().min(0), z.literal('pill')]), ...Decided }).nullable(),
    logo: z.strictObject({ logoId: z.string(), widthPx: z.number().positive(), ...Decided }).nullable(),
    other: z.array(z.strictObject({ topic: z.string().min(1), decision: z.string().min(1), ...Decided })),
  }),
  /** Supuestos con los que se continúa sin preguntar (se entregan para revisión). */
  assumptions: z.array(z.string()),
  confirmation: z.strictObject({ by: z.string(), at: z.string(), note: z.string().nullable(), hash: z.string() }).nullable(),
});
export type EmailBrief = z.infer<typeof EmailBriefSchema>;

// ---------- Plan ----------

const Color = z.strictObject({ id: z.string(), hex: z.string() });
export type PColor = z.infer<typeof Color>;
const Font = z.strictObject({ family: z.string(), style: z.string() });
export const TEXT_STATUS = ['approved', 'proposed', 'placeholder'] as const;

export interface PText { k: 'text'; name: string; role: string; text: string; font: { family: string; style: string }; stack: string; size: number; lineHeight: number; color: PColor; align: 'LEFT' | 'CENTER'; underline: boolean; upper: boolean; url: string | null; status: (typeof TEXT_STATUS)[number]; note: string | null }
export interface PImage { k: 'image'; name: string; w: number; h: number; fallback: PColor; label: string; figmaNodeId: string | null; note: string }
export interface PLogo { k: 'logo'; name: string; w: number; h: number; svgId: string | null; label: string; note: string | null }
export interface PButton { k: 'button'; name: string; w: number | null; h: number; fill: PColor; border: PColor | null; radius: number; padX: number; text: PText; comp: string | null; note: string | null }
export interface PFrame { k: 'frame'; name: string; dir: 'V' | 'H'; w: number; pad: [number, number, number, number]; gap: number; fill: PColor | null; align: 'MIN' | 'CENTER'; children: PNode[]; comp: string | null; note: string | null }
export type PNode = PText | PImage | PLogo | PButton | PFrame;

const PTextSchema = z.strictObject({
  k: z.literal('text'), name: z.string(), role: z.string(), text: z.string(), font: Font, stack: z.string(), size: z.number().positive(), lineHeight: z.number().positive(),
  color: Color, align: z.enum(['LEFT', 'CENTER']), underline: z.boolean(), upper: z.boolean(), url: z.string().nullable(), status: z.enum(TEXT_STATUS), note: z.string().nullable(),
});
export const PNodeSchema: z.ZodType<PNode> = z.lazy(() => z.discriminatedUnion('k', [
  PTextSchema,
  z.strictObject({ k: z.literal('image'), name: z.string(), w: z.number().int().positive(), h: z.number().int().positive(), fallback: Color, label: z.string(), figmaNodeId: z.string().nullable(), note: z.string() }),
  z.strictObject({ k: z.literal('logo'), name: z.string(), w: z.number().positive(), h: z.number().positive(), svgId: z.string().nullable(), label: z.string(), note: z.string().nullable() }),
  z.strictObject({ k: z.literal('button'), name: z.string(), w: z.number().int().positive().nullable(), h: z.number().int().positive(), fill: Color, border: Color.nullable(), radius: z.number().min(0), padX: z.number().int().min(0), text: PTextSchema, comp: z.string().nullable(), note: z.string().nullable() }),
  z.strictObject({ k: z.literal('frame'), name: z.string(), dir: z.enum(['V', 'H']), w: z.number().int().positive(), pad: z.tuple([z.number(), z.number(), z.number(), z.number()]), gap: z.number().min(0), fill: Color.nullable(), align: z.enum(['MIN', 'CENTER']), children: z.array(PNodeSchema), comp: z.string().nullable(), note: z.string().nullable() }),
]));

const Provenance = z.strictObject({ topic: z.string(), value: z.string(), from: z.enum(['legal_technical', 'brief_decision', 'email_confirmed', 'brand', 'email_observed', 'template', 'skill_default']), source: z.string() });
export type ProvenanceT = z.infer<typeof Provenance>;

export const EmailPlanSchema = z.strictObject({
  schema: z.literal(EMAIL_PLAN_SCHEMA_ID),
  briefSlug: z.string(),
  briefHash: z.string(),
  client: z.strictObject({ slug: z.string(), name: z.string(), status: z.string() }),
  knowledge: z.array(z.strictObject({ id: z.string(), version: z.string(), status: z.string(), sha256: z.string() })),
  fileKey: z.string(), pageId: z.string(), sectionName: z.string(),
  frames: z.strictObject({ desktop: z.string(), mobile: z.string(), subject: z.string(), notes: z.string(), components: z.string() }),
  widths: z.strictObject({ desktop: z.number().int(), mobile: z.number().int() }),
  canvasFill: Color,
  desktop: z.array(PNodeSchema),
  mobile: z.array(PNodeSchema),
  subject: z.strictObject({ subject: PTextSchema.nullable(), preheader: PTextSchema.nullable() }),
  /** Fuentes que el script debe cargar (las de Figma, ya resueltas). */
  fonts: z.array(Font),
  notesFont: Font,
  svgs: z.record(z.string(), z.string()),
  /** Notas para revisión y desarrollo (van al frame de notas y a las anotaciones). */
  notes: z.strictObject({
    responsive: z.array(z.string()), accessibility: z.array(z.string()), development: z.array(z.string()), darkMode: z.array(z.string()),
    decisions: z.array(z.string()), assumptions: z.array(z.string()), pending: z.array(z.string()), proposedCopy: z.array(z.string()),
  }),
  provenance: z.array(Provenance),
  internalRules: z.array(z.string()),
  conflicts: z.array(z.string()),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
});
export type EmailPlan = z.infer<typeof EmailPlanSchema>;

// ---------- Resultado del script ----------

export const AuditNodeSchema = z.strictObject({
  bp: z.enum(['desktop', 'mobile', 'subject']),
  id: z.string(), name: z.string(), type: z.string(), w: z.number(), h: z.number(),
  /** TEXT: tamaño, fuente, color, fondo efectivo (primer ancestro con relleno sólido), subrayado y longitud. */
  size: z.number().nullable(), font: z.string().nullable(), color: z.string().nullable(), bg: z.string().nullable(),
  underline: z.boolean().nullable(), chars: z.number().nullable(), sha: z.string().nullable(),
});
export type AuditNode = z.infer<typeof AuditNodeSchema>;

export const EmailResultSchema = z.strictObject({
  schema: z.literal(EMAIL_RESULT_SCHEMA_ID),
  scriptVersion: z.string(),
  status: z.enum(['created', 'exists', 'failed']),
  sectionId: z.string().nullable(),
  frames: z.record(z.string(), z.string()),
  components: z.array(z.strictObject({ id: z.string(), name: z.string(), instances: z.number() })),
  audit: z.array(AuditNodeSchema),
  images: z.array(z.strictObject({ name: z.string(), bp: z.string(), placed: z.boolean(), reason: z.string().nullable() })),
  annotations: z.strictObject({ ok: z.number(), failed: z.number(), error: z.string().nullable() }),
  fonts: z.array(z.strictObject({ family: z.string(), style: z.string(), loaded: z.boolean(), error: z.string().nullable() })),
  error: z.string().nullable(),
});
export type EmailResult = z.infer<typeof EmailResultSchema>;
