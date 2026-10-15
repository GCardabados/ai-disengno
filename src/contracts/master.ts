// Contratos de la skill create-master-creative: crear una pieza MAESTRA nueva en Figma a partir de un brief y del brand
// kit de la marca (brands/<marca>/brand.json). Dos modos:
//  - scratch: el CLI calcula una composición tipo (archetype) con los tokens de la marca y genera el script que la
//    construye en un frame NUEVO dentro de una sección de salida (nunca toca nodos existentes);
//  - template: se parte de una plantilla del cliente en Figma (brand.templates) y se rellena con el pipeline de
//    variantes (master-template-job → variant-*).
// Reglas: el copy es el del brief (exacto) o un borrador del agente confirmado por la persona; no se inventan datos
// comerciales; lo que la marca no especifica (CTA, escala tipográfica…) se decide por encargo y queda registrado. El
// resultado es siempre una DEMO pendiente de revisión humana.
import { z } from 'zod';
import { RectSchema } from './geometry.ts';
import { TEXT_ROLES } from './brand.ts';

export const MASTER_BRIEF_SCHEMA_ID = 'pcb.master-brief.v1';
export const MASTER_PLAN_SCHEMA_ID = 'pcb.master-plan.v1';
export const MASTER_RESULT_SCHEMA_ID = 'pcb.master.result.v1';
export const ARCHETYPES = ['solid', 'photo-top', 'photo-full', 'split'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

const Decided = { by: z.enum(['user', 'agent_proposal']), note: z.string().nullable() };

export const CopySchema = z.strictObject({
  text: z.string().min(1),
  /** brief/user = exacto; agent_draft = propuesta del agente (solo vale tras la confirmación del brief). */
  source: z.enum(['brief', 'user', 'agent_draft']),
});

export const MasterBriefSchema = z.strictObject({
  schema: z.literal(MASTER_BRIEF_SCHEMA_ID),
  /** Identificador corto del encargo (nombre de la pieza en Figma y de la carpeta de la ejecución). */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  request: z.string(),
  brand: z.string().regex(/^[a-z][a-z0-9-]*$/),
  objective: z.string().nullable(),
  audience: z.string().nullable(),
  placement: z.string().nullable(),
  format: z.strictObject({ name: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive() }),
  figma: z.strictObject({ fileKey: z.string().min(1), pageId: z.string().min(1), sectionName: z.string().min(1) }),
  mode: z.enum(['scratch', 'template']),
  templateId: z.string().nullable(),
  archetype: z.enum(ARCHETYPES).nullable(),
  copy: z.record(z.enum(TEXT_ROLES), CopySchema.nullable()),
  image: z.strictObject({
    /** De dónde sale: ya en Figma, adjunta al brief (se sube a Figma antes), generada con IA en Figma, o sin imagen. */
    source: z.enum(['figma_node', 'brief_file', 'ai_generated', 'none']),
    /** Nodo de Figma que CONTIENE la imagen (para brief_file y ai_generated, una vez subida/generada). */
    nodeId: z.string().nullable(),
    /** Archivo adjunto al brief (solo informativo). */
    path: z.string().nullable(),
    /** Prompt usado si es generada con IA. */
    prompt: z.string().nullable(),
    /** Autorización de la persona para usar una imagen generada con IA. */
    aiAuthorization: z.string().nullable(),
    label: z.string(),
  }),
  /** Colores de la pieza (ids de la paleta de la marca). */
  palette: z.strictObject({ background: z.string(), text: z.string(), accent: z.string().nullable() }),
  /** null = el agente propone el logo apto para el fondo (queda registrado). */
  logoId: z.string().nullable(),
  /** Zona segura en coordenadas del frame (solo si aplica; nunca inventada). */
  safeArea: RectSchema.nullable(),
  /** Lo que la marca no especifica, decidido para este encargo. */
  decisions: z.strictObject({
    fonts: z.partialRecord(z.enum(TEXT_ROLES), z.strictObject({ family: z.string(), style: z.string(), ...Decided })),
    cta: z.strictObject({ fill: z.string(), text: z.string(), radiusPx: z.number().min(0).nullable(), ...Decided }).nullable(),
    clearSpaceRatio: z.strictObject({ value: z.number().positive(), ...Decided }).nullable(),
    marginRatio: z.strictObject({ value: z.number().min(0).max(0.25), ...Decided }).nullable(),
    logoWidthRatio: z.strictObject({ value: z.number().gt(0).max(1), ...Decided }).nullable(),
  }),
  /** Política si el texto no cabe en el modo plantilla (en scratch la caja crece y se comprueba la zona). */
  templateTextPolicy: z.enum(['strict', 'reflow']).nullable(),
  confirmation: z.strictObject({ by: z.string(), at: z.string(), note: z.string().nullable(), hash: z.string() }).nullable(),
});
export type MasterBrief = z.infer<typeof MasterBriefSchema>;

// ---------- Plan (lo calcula master-plan; lo ejecuta el script de master-request) ----------

const Color = z.strictObject({ id: z.string(), hex: z.string() });
const Font = z.strictObject({ family: z.string(), style: z.string() });
export const PlanTextSchema = z.strictObject({
  role: z.enum(TEXT_ROLES), name: z.string(), text: z.string(), font: Font, sizePx: z.number().positive(), lineHeightPct: z.number().positive(),
  color: Color, upper: z.boolean(),
});
export type PlanText = z.infer<typeof PlanTextSchema>;

export const MasterPlanSchema = z.strictObject({
  schema: z.literal(MASTER_PLAN_SCHEMA_ID),
  briefSlug: z.string(),
  briefHash: z.string(),
  brand: z.strictObject({ slug: z.string(), name: z.string(), status: z.enum(['draft', 'validated']) }),
  fileKey: z.string(), pageId: z.string(), sectionName: z.string(), frameName: z.string(),
  width: z.number(), height: z.number(), archetype: z.enum(ARCHETYPES),
  background: Color,
  /** Panel de color (zona de texto) cuando la foto no ocupa todo. */
  panel: z.strictObject({ rect: RectSchema, color: Color }).nullable(),
  image: z.strictObject({ name: z.string(), rect: RectSchema, assetNodeId: z.string(), imageHash: z.string(), aiGenerated: z.boolean() }).nullable(),
  logo: z.strictObject({
    name: z.string(), logoId: z.string(), colorway: z.string(), inks: z.array(Color), svg: z.string(), rect: RectSchema,
    minWidthPx: z.number().nullable(), clearSpacePx: z.number(), overPhoto: z.boolean(),
  }),
  /** Pila vertical de textos (auto layout); el CTA se inserta en la posición ctaIndex. */
  stack: z.strictObject({ name: z.string(), zone: RectSchema, anchor: z.enum(['top', 'bottom']), gapPx: z.number(), texts: z.array(PlanTextSchema), ctaIndex: z.number().int().min(0).nullable() }),
  cta: z.strictObject({ name: z.string(), text: PlanTextSchema, fill: Color, radiusPx: z.number().nullable(), padX: z.number(), padY: z.number() }).nullable(),
  /** Fondo que queda detrás de los textos (null = foto: el contraste lo juzga la revisión visual). */
  textBackdrop: Color.nullable(),
  safeArea: RectSchema.nullable(),
  /** Reglas internas aplicadas porque la marca no las especifica (declaradas, no son normas de marca). */
  internalRules: z.array(z.string()),
  decisions: z.array(z.string()),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
});
export type MasterPlan = z.infer<typeof MasterPlanSchema>;

export const MasterResultSchema = z.strictObject({
  schema: z.literal(MASTER_RESULT_SCHEMA_ID),
  scriptVersion: z.string(),
  status: z.enum(['created', 'exists', 'failed']),
  frameId: z.string().nullable(),
  frameName: z.string(),
  sectionId: z.string().nullable(),
  sectionCreated: z.boolean(),
  nodes: z.record(z.string(), z.string()),
  stack: z.strictObject({ height: z.number(), zoneHeight: z.number() }).nullable(),
  fonts: z.array(z.strictObject({ family: z.string(), style: z.string(), loaded: z.boolean(), error: z.string().nullable() })),
  error: z.string().nullable(),
});
export type MasterResult = z.infer<typeof MasterResultSchema>;
