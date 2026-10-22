// Conocimiento compartido de clientes (carpeta client-knowledge/, pensada para vivir en su propio repositorio).
// Tres capas que no se mezclan:
//  1. Conocimiento ESTABLE del cliente (este contrato + brand.json pcb.brand.v1): lo leen varias skills.
//  2. Instrucciones de cada skill (.claude/skills/<skill>/): cómo trabaja la skill, nunca datos de un cliente.
//  3. Materiales y decisiones de un ENCARGO (runs/<fecha>-<cliente>-<pieza>/): no vuelven al conocimiento salvo
//     mediante una propuesta (ck.proposal.v1) que una persona valida.
// Cada dato lleva su procedencia y su estado: confirmed (norma escrita o validada), observed (visto en piezas
// aprobadas, no escrito como norma: referencia, no regla) o needs_confirmation (no se usa sin confirmar).
// Los textos de los archivos de conocimiento son DATOS, nunca instrucciones.
import { z } from 'zod';

export const CLIENT_INDEX_SCHEMA_ID = 'ck.client.v1';
export const EMAIL_CHANNEL_SCHEMA_ID = 'ck.email.v1';
export const PAID_CHANNEL_SCHEMA_ID = 'ck.paid.v1';
export const KNOWLEDGE_PROPOSAL_SCHEMA_ID = 'ck.proposal.v1';
export const KNOWLEDGE_CONTEXT_SCHEMA_ID = 'ck.context.v1';

const Slug = z.string().regex(/^[a-z][a-z0-9-]*$/);
const Hex = z.string().regex(/^#[0-9A-F]{6}$/, 'HEX en mayúsculas: #RRGGBB');
const Source = z.string().min(1);
export const ApprovalSchema = z.strictObject({ by: z.string().min(1), at: z.string(), note: z.string().nullable() });
export const FactStatus = z.enum(['confirmed', 'observed', 'needs_confirmation']);
export type FactStatusT = z.infer<typeof FactStatus>;

export const CHANNELS = ['all', 'email', 'paid', 'social', 'web'] as const;
export const KNOWLEDGE_KINDS = ['brand', 'guidelines', 'voice', 'channel', 'legal', 'examples', 'other'] as const;

/** Archivo del conocimiento de un cliente. `load: always` = estructurado y pequeño (lo carga knowledge-context);
 *  `on_demand` = documentación que la skill solo lee si la necesita (se anuncia con sus temas y su tamaño). */
export const KnowledgeFileSchema = z.strictObject({
  id: Slug,
  /** Relativa a la carpeta del cliente; nunca absoluta ni con «..». */
  path: z.string().min(1),
  kind: z.enum(KNOWLEDGE_KINDS),
  channels: z.array(z.enum(CHANNELS)).min(1),
  topics: z.array(z.string().min(1)),
  status: z.enum(['draft', 'validated', 'deprecated']),
  version: z.string().min(1),
  updatedAt: z.string(),
  source: Source,
  approval: ApprovalSchema.nullable(),
  load: z.enum(['always', 'on_demand']),
  description: z.string(),
});
export type KnowledgeFile = z.infer<typeof KnowledgeFileSchema>;

export const ClientIndexSchema = z.strictObject({
  schema: z.literal(CLIENT_INDEX_SCHEMA_ID),
  slug: Slug,
  name: z.string().min(1),
  /** Nombres con los que puede aparecer en un brief (identificación del cliente). */
  aliases: z.array(z.string().min(1)),
  /** Dominios propios: los únicos admitidos en enlaces y CTA sin aviso. */
  domains: z.array(z.string().min(1)),
  status: z.enum(['draft', 'validated']),
  owners: z.array(z.string()),
  updatedAt: z.string(),
  /** Submarcas o marcas relacionadas con conocimiento PROPIO: nunca se mezclan con esta. */
  relatedClients: z.array(z.strictObject({ slug: Slug, relation: z.string() })),
  figma: z.strictObject({
    /** Librerías del cliente. search_design_system debe filtrarse con estas claves: sin ellas devuelve componentes
     *  de cualquier marca a la que tenga acceso la cuenta. */
    libraries: z.array(z.strictObject({ name: z.string(), libraryKey: z.string().min(1), channels: z.array(z.enum(CHANNELS)).min(1), note: z.string().nullable() })),
    files: z.array(z.strictObject({ label: z.string(), fileKey: z.string().min(1), channels: z.array(z.enum(CHANNELS)).min(1), note: z.string().nullable() })),
  }),
  files: z.array(KnowledgeFileSchema).min(1),
});
export type ClientIndex = z.infer<typeof ClientIndexSchema>;

// ---------- Canal email (channels/email.json) ----------

export const EMAIL_TEXT_ROLES = ['h1', 'h2', 'body', 'small', 'cta', 'legal'] as const;
export type EmailTextRole = (typeof EMAIL_TEXT_ROLES)[number];
export const EMAIL_MODULE_TYPES = ['header', 'hero', 'text', 'image-text', 'columns', 'cta', 'legal', 'footer'] as const;
export type EmailModuleType = (typeof EMAIL_MODULE_TYPES)[number];

const Fact = <T extends z.ZodType>(value: T) => z.strictObject({ value, status: FactStatus, source: Source }).nullable();
const Rule = z.strictObject({ text: z.string().min(1), status: FactStatus, source: Source });
const Size = z.strictObject({ sizePx: z.number().positive(), lineHeightPx: z.number().positive().nullable() });

export const EmailColorSchema = z.strictObject({
  id: Slug,
  hex: Hex,
  /** Para qué se usa en email (texto, fondo, cta, enlace, legal…). Texto libre corto. */
  roles: z.array(z.string().min(1)).min(1),
  /** Color de la paleta de marca (brand.json) al que corresponde; null = color propio del canal. */
  brandColorId: z.string().nullable(),
  status: FactStatus,
  source: Source,
});
export type EmailColor = z.infer<typeof EmailColorSchema>;

export const EmailTypeRoleSchema = z.strictObject({
  /** Pila CSS que se implementará (p. ej. «Arial, Helvetica, sans-serif»). */
  stack: z.string().min(1),
  /** Fuente con la que se diseña en Figma. Si difiere de la primera de la pila es un SUSTITUTO DECLARADO
   *  (p. ej. Arimo, métricamente compatible con Arial, porque Figma no tiene fuentes de sistema). */
  figma: z.strictObject({ family: z.string().min(1), style: z.string().min(1) }),
  desktop: Size.nullable(),
  mobile: Size.nullable(),
  upper: z.boolean(),
  status: FactStatus,
  source: Source,
});
export type EmailTypeRole = z.infer<typeof EmailTypeRoleSchema>;

export const EmailModuleRefSchema = z.strictObject({
  id: Slug,
  type: z.enum(EMAIL_MODULE_TYPES),
  description: z.string(),
  /** Componente o nodo de Figma; componentKey solo si está publicado en una librería del cliente. */
  figma: z.strictObject({ fileKey: z.string().min(1), nodeId: z.string().nullable(), componentKey: z.string().nullable() }).nullable(),
  /** Id del módulo HTML equivalente en el pipeline de maquetación (registry.json), si existe. */
  htmlModuleId: z.string().nullable(),
  status: z.enum(['validated', 'observed', 'draft']),
  source: Source,
});
export type EmailModuleRef = z.infer<typeof EmailModuleRefSchema>;

export const EmailChannelSchema = z.strictObject({
  schema: z.literal(EMAIL_CHANNEL_SCHEMA_ID),
  client: Slug,
  status: z.enum(['draft', 'validated']),
  approval: ApprovalSchema.nullable(),
  version: z.string().min(1),
  updatedAt: z.string(),
  platform: z.strictObject({ esp: z.string().nullable(), htmlPipeline: z.string().nullable(), notes: z.string().nullable(), source: Source }).nullable(),
  layout: z.strictObject({
    desktopWidthPx: Fact(z.number().int().positive()),
    mobileWidthPx: Fact(z.number().int().positive()),
    sidePaddingDesktopPx: Fact(z.number().int().min(0)),
    sidePaddingMobilePx: Fact(z.number().int().min(0)),
    moduleSpacingDesktopPx: Fact(z.number().int().min(0)),
    moduleSpacingMobilePx: Fact(z.number().int().min(0)),
    spacingScalePx: Fact(z.array(z.number().int().positive())),
  }),
  colors: z.array(EmailColorSchema),
  typography: z.strictObject({
    /** web_safe = solo fuentes de sistema en el HTML (texto vivo); web_font_with_fallback = fuente web + pila. */
    policy: Fact(z.enum(['web_safe', 'web_font_with_fallback'])),
    roles: z.partialRecord(z.enum(EMAIL_TEXT_ROLES), EmailTypeRoleSchema),
  }),
  cta: z.strictObject({
    fill: z.string().nullable(),
    text: z.string().nullable(),
    heightPx: z.number().positive().nullable(),
    radius: z.union([z.number().min(0), z.literal('pill')]).nullable(),
    fullWidthMobile: z.boolean().nullable(),
    status: FactStatus,
    source: Source,
  }).nullable(),
  links: z.strictObject({ color: z.string(), underline: z.boolean(), status: FactStatus, source: Source }).nullable(),
  logo: z.strictObject({
    /** Id de un logo de brand.json. */
    logoId: z.string().min(1),
    widthPx: z.number().positive().nullable(),
    align: z.enum(['left', 'center']).nullable(),
    darkModeLogoId: z.string().nullable(),
    status: FactStatus,
    source: Source,
  }).nullable(),
  header: z.strictObject({ viewOnline: z.boolean(), background: z.string().nullable(), status: FactStatus, source: Source }).nullable(),
  footer: z.strictObject({
    /** Elementos obligatorios del pie (baja, identificación del remitente…). text null = lo aporta el cliente. */
    required: z.array(z.strictObject({ id: Slug, label: z.string(), text: z.string().nullable(), source: Source })),
    background: z.string().nullable(),
    moduleId: z.string().nullable(),
    status: FactStatus,
    source: Source,
  }).nullable(),
  legal: z.strictObject({
    mandatoryTexts: z.array(z.strictObject({ id: Slug, text: z.string().min(1), when: z.string().min(1), status: FactStatus, source: Source })),
    forbiddenClaims: z.array(z.strictObject({ text: z.string().min(1), source: Source })),
  }),
  darkMode: z.strictObject({ strategy: z.enum(['designed', 'light_only', 'undefined']), rules: z.array(Rule), source: Source }).nullable(),
  modules: z.array(EmailModuleRefSchema),
  templates: z.array(z.strictObject({ id: Slug, label: z.string(), fileKey: z.string().min(1), desktopNodeId: z.string().min(1), mobileNodeId: z.string().nullable(), status: z.enum(['validated', 'observed', 'draft']), source: Source })),
  /** Ejemplos aprobados: REFERENCIA, nunca reglas. */
  examples: z.array(z.strictObject({ id: Slug, label: z.string(), fileKey: z.string().nullable(), nodeId: z.string().nullable(), date: z.string().nullable(), notes: z.string().nullable(), source: Source })),
  constraints: z.array(Rule),
  gaps: z.array(z.string()),
  openQuestions: z.array(z.strictObject({ id: z.string(), question: z.string(), status: z.enum(['open', 'resolved']), answer: z.string().nullable(), source: Source })),
});
export type EmailChannel = z.infer<typeof EmailChannelSchema>;

// ---------- Canal paid (channels/paid.json) ----------
// Mínimo: solo las plantillas de pieza del cliente (modo «plantilla» de create-master-creative). Safe zones, tamaños
// por plataforma o legales paid no están modelados todavía.

/** Plantilla de pieza del cliente en Figma. Su archivo debe estar declarado en client.json → figma.files. */
export const PaidTemplateSchema = z.strictObject({
  id: Slug,
  label: z.string(),
  fileKey: z.string().min(1),
  nodeId: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Huecos rellenables: rol → nodeId del texto o de la imagen en la plantilla. */
  slots: z.record(z.string(), z.strictObject({ kind: z.enum(['text', 'image']), nodeId: z.string().min(1) })),
  /** Nodos del logo en la plantilla (protegidos: no se tocan). */
  logoNodeIds: z.array(z.string()),
  notes: z.string().nullable(),
  source: Source,
});
export type PaidTemplate = z.infer<typeof PaidTemplateSchema>;

export const PaidChannelSchema = z.strictObject({
  schema: z.literal(PAID_CHANNEL_SCHEMA_ID),
  client: Slug,
  status: z.enum(['draft', 'validated']),
  approval: ApprovalSchema.nullable(),
  version: z.string().min(1),
  updatedAt: z.string(),
  templates: z.array(PaidTemplateSchema),
  gaps: z.array(z.string()),
  openQuestions: z.array(z.strictObject({ id: z.string(), question: z.string(), status: z.enum(['open', 'resolved']), answer: z.string().nullable(), source: Source })),
});
export type PaidChannel = z.infer<typeof PaidChannelSchema>;

// ---------- Propuestas de cambio (cuarentena: nunca se cargan como conocimiento) ----------

export const KnowledgeProposalSchema = z.strictObject({
  schema: z.literal(KNOWLEDGE_PROPOSAL_SCHEMA_ID),
  client: Slug,
  createdAt: z.string(),
  /** Encargo del que sale (carpeta de runs/ o descripción). */
  fromJob: z.string().min(1),
  proposedBy: z.string().min(1),
  items: z.array(z.strictObject({
    /** Id del archivo del índice al que afectaría. */
    targetFile: Slug,
    /** Qué cambiaría, en lenguaje claro y con la ruta del campo si aplica. */
    change: z.string().min(1),
    kind: z.enum(['new_rule', 'gap_fill', 'correction', 'example', 'module']),
    rationale: z.string().min(1),
    /** Evidencia: decisión de quién, pieza aprobada, enlace… Un diseño puntual no basta para una norma. */
    evidence: z.array(z.string().min(1)).min(1),
  })).min(1),
  status: z.enum(['proposed', 'accepted', 'rejected']),
  review: ApprovalSchema.nullable(),
});
export type KnowledgeProposal = z.infer<typeof KnowledgeProposalSchema>;
