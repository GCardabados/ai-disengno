// Emails a partir de BLOQUES y PLANTILLAS del cliente ya diseñados en Figma (p. ej. AXA): el catálogo vive en el
// conocimiento compartido (client-knowledge/clients/<slug>/channels/email-blocks.json, ck.email-blocks.v1) y cada encargo
// trae un brief completo (pcb.email-template-brief.v1) que elige una plantilla predefinida o una composición propia de
// bloques y aporta copys, imágenes, enlaces, variante legal, idioma, canal, objetivo, asunto y preheader.
// Los bloques FIJOS no se editan (solo se elige su variante). Los VARIABLES tienen huecos nombrados «slot:<rol>_<n>».
import { z } from 'zod';
import { CopySchema } from './email.ts';

export const EMAIL_BLOCKS_SCHEMA_ID = 'ck.email-blocks.v1';
export const EMAIL_TEMPLATE_BRIEF_SCHEMA_ID = 'pcb.email-template-brief.v1';
export const EMAIL_TEMPLATE_RESULT_SCHEMA_ID = 'pcb.email-template.result.v1';

const SlotSchema = z.strictObject({ id: z.string().regex(/^[a-z]+_\d+$/), role: z.string(), example: z.string().nullable().optional() });
const VariantSchema = z.strictObject({
  /** Nombre de la variante («Canal=AXA, Idioma=CAST»); null en bloques sin variantes. */
  name: z.string().nullable(),
  componentId: z.string().min(1),
  w: z.number(), h: z.number(),
  slots: z.array(SlotSchema),
  thumb: z.strictObject({ catId: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});
export const CatalogBlockSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  type: z.enum(['COMPONENT', 'COMPONENT_SET']),
  nodeId: z.string().min(1),
  category: z.string(),
  kind: z.enum(['fixed', 'variable']),
  source: z.string().nullable(),
  notes: z.array(z.string()),
  variants: z.array(VariantSchema).min(1),
});
export type CatalogBlock = z.infer<typeof CatalogBlockSchema>;

export const EmailBlocksCatalogSchema = z.strictObject({
  schema: z.literal(EMAIL_BLOCKS_SCHEMA_ID),
  client: z.string().regex(/^[a-z][a-z0-9-]*$/),
  status: z.enum(['draft', 'validated']),
  version: z.string(), updatedAt: z.string(), source: z.string(),
  figma: z.strictObject({ fileKey: z.string(), pageId: z.string(), blocksSection: z.string(), templatesSection: z.string() }),
  canvas: z.strictObject({ emailWidth: z.number(), contentWidth: z.number(), background: z.string(), paddingTop: z.number(), gutter: z.number(), gap: z.number() }),
  fonts: z.record(z.string(), z.strictObject({ implement: z.string(), status: z.string() })),
  options: z.strictObject({
    canal: z.record(z.string(), z.strictObject({ block: z.string(), set: z.record(z.string(), z.string()).optional(), hide: z.boolean().optional(), onlyIdioma: z.array(z.string()).optional() })),
    idioma: z.array(z.string()).min(1),
    legal: z.array(z.string()).min(1),
    footer: z.array(z.string()),
    tokens: z.record(z.string(), z.string()),
  }),
  blocks: z.array(CatalogBlockSchema).min(1),
  templates: z.array(z.strictObject({
    key: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), figmaId: z.string(), reference: z.string().nullable(),
    blocks: z.array(z.strictObject({ block: z.string(), variant: z.string().nullable() })).min(1),
  })),
  pending: z.array(z.string()),
});
export type EmailBlocksCatalog = z.infer<typeof EmailBlocksCatalogSchema>;

const SlotValue = z.union([z.string().min(1), CopySchema]);
export type SlotValue = z.infer<typeof SlotValue>;

export const EmailTemplateBriefSchema = z.strictObject({
  schema: z.literal(EMAIL_TEMPLATE_BRIEF_SCHEMA_ID),
  client: z.string().regex(/^[a-z][a-z0-9-]*$/),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Nombre del frame del email en Figma (p. ej. el slug de la campaña). */
  name: z.string().min(1),
  intent: z.strictObject({ objetivo: z.string().min(1), audiencia: z.string().nullable(), mensaje: z.string().nullable() }),
  subject: CopySchema,
  preheader: CopySchema,
  idioma: z.string(),
  canal: z.string(),
  legal: z.string(),
  /** Plantilla predefinida (clave del catálogo) o composición propia (lista ordenada de bloques). */
  composition: z.union([
    z.strictObject({ template: z.string() }),
    z.strictObject({ blocks: z.array(z.strictObject({ block: z.string(), variant: z.string().nullable() })).min(1) }),
  ]),
  /** Contenido por bloque, en el orden de la composición (índice de bloque). Fijos: nada que rellenar. */
  content: z.array(z.strictObject({
    at: z.number().int().min(0),
    block: z.string(),
    slots: z.record(z.string(), SlotValue).default({}),
    images: z.record(z.string(), z.string()).default({}),
    links: z.record(z.string(), z.string()).default({}),
    /** Huecos que no se usan en este email (se ocultan, no se borran). */
    hide: z.array(z.string()).default([]),
    /** Ocultar el bloque entero (opcional en la plantilla). */
    omit: z.boolean().default(false),
  })),
  figma: z.strictObject({ fileKey: z.string().min(1), pageId: z.string().min(1), sectionName: z.string().min(1) }),
  confirmation: z.strictObject({ by: z.string(), at: z.string(), note: z.string().nullable(), hash: z.string() }).nullable(),
});
export type EmailTemplateBrief = z.infer<typeof EmailTemplateBriefSchema>;

export const EmailTemplateResultSchema = z.strictObject({
  schema: z.literal(EMAIL_TEMPLATE_RESULT_SCHEMA_ID),
  status: z.enum(['created', 'exists', 'failed']),
  frameId: z.string().nullable(),
  subjectFrameId: z.string().nullable(),
  sectionId: z.string().nullable(),
  blocks: z.array(z.strictObject({ at: z.number(), id: z.string(), name: z.string(), variant: z.string().nullable(), visible: z.boolean() })),
  slots: z.array(z.strictObject({ at: z.number(), slot: z.string(), kind: z.enum(['text', 'image']), ok: z.boolean(), sha: z.string().nullable(), font: z.string().nullable(), error: z.string().nullable() })),
  placeholdersLeft: z.array(z.strictObject({ at: z.number(), slot: z.string(), text: z.string() })),
  annotations: z.number(),
  error: z.string().nullable(),
});
export type EmailTemplateResult = z.infer<typeof EmailTemplateResultSchema>;
