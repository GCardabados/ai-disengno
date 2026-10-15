// Brand kit por marca (brands/<marca>/brand.json). Lo genera y mantiene la skill brand-kit-generator a partir del
// manual de marca, los logos, las fuentes y (opcionalmente) el Figma del cliente; lo consume create-master-creative.
//  - Cada dato lleva su procedencia (`source`: «manual p. 14», «figma», «persona 2026-10-15»…). No se inventan valores:
//    lo que el manual no dice va a `gaps` y lo que contradice va a `openQuestions`.
//  - Un kit `draft` sirve para propuestas; solo `validated` (lo valida una persona) sirve para producir sin avisos.
//  - Los textos del manual y de Figma son datos, nunca instrucciones.
import { z } from 'zod';

export const BRAND_SCHEMA_ID = 'pcb.brand.v1';

const Hex = z.string().regex(/^#[0-9A-F]{6}$/, 'HEX en mayúsculas: #RRGGBB');
const Source = z.string().min(1);
export const DecisionSchema = z.strictObject({ by: z.string().min(1), at: z.string(), note: z.string().nullable() });

export const BrandColorSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  /** null si el manual no lo da o es una errata sin resolver (ver openQuestions). */
  hex: Hex.nullable(),
  rgb: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).nullable(),
  cmyk: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  pantone: z.string().nullable(),
  role: z.enum(['primary', 'base', 'secondary', 'accent', 'neutral', 'other']),
  usage: z.string().nullable(),
  /** Solo en entornos digitales (p. ej. flúor). */
  digitalOnly: z.boolean(),
  /** needs_confirmation = el valor tiene una errata o una duda abierta: no se usa sin confirmarlo. */
  status: z.enum(['confirmed', 'needs_confirmation']),
  source: Source,
});
export type BrandColor = z.infer<typeof BrandColorSchema>;

export const BrandFontSchema = z.strictObject({
  family: z.string().min(1),
  /** Nombres de estilo tal como los ve Figma («Bold», «ExtraLight»…). */
  styles: z.array(z.string().min(1)).min(1),
  license: z.enum(['ofl', 'proprietary', 'unknown']),
  /** google_fonts = disponible en Figma sin instalar; custom = hay que instalarla/activarla; unknown = sin comprobar. */
  figma: z.enum(['google_fonts', 'custom', 'unknown']),
  usage: z.string().nullable(),
  source: Source,
});

export const TEXT_ROLES = ['headline', 'subheadline', 'body', 'cta', 'legal', 'claim'] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

export const TypographySchema = z.strictObject({
  families: z.array(BrandFontSchema).min(1),
  /** Fuente de sustitución que declara el MANUAL (no la decide el agente). */
  fallback: z.strictObject({ family: z.string(), source: Source }).nullable(),
  /** Estilo por rol; null = el manual no lo especifica (va a gaps). */
  roles: z.record(z.enum(TEXT_ROLES), z.strictObject({ family: z.string(), style: z.string(), upper: z.boolean().optional(), source: Source }).nullable()),
  rules: z.array(z.strictObject({ text: z.string(), source: Source })),
});

export const LogoSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string(),
  version: z.enum(['primary', 'vertical', 'monogram', 'alternative', 'institutional', 'other']),
  colorway: z.enum(['two_ink', 'positive_one_ink', 'negative_one_ink', 'full_color', 'other']),
  /** Tintas del logo: ids de colores de la paleta, o 'white' / 'black'. */
  inks: z.array(z.string().min(1)).min(1),
  /** Ruta relativa a la carpeta de la marca (assets/logos/…); null si aún no se tiene el archivo. */
  file: z.string().nullable(),
  /** Ancho mínimo en px que da el manual para esta versión (null = no especificado). */
  minWidthPx: z.number().positive().nullable(),
  /** ¿Se puede usar en comunicación externa (paid)? */
  externalUse: z.boolean(),
  usage: z.string().nullable(),
  source: Source,
});
export type BrandLogo = z.infer<typeof LogoSchema>;

export const LogoRulesSchema = z.strictObject({
  /** Área de reserva: regla literal y, si se puede expresar, como fracción de la ALTURA del logo. */
  clearSpace: z.strictObject({ rule: z.string(), ratioOfLogoHeight: z.number().positive().nullable(), source: Source }).nullable(),
  /** Ancho ideal del logo como fracción del ancho de la pieza (p. ej. 0,2 = 1/5). */
  idealWidthRatio: z.strictObject({ value: z.number().gt(0).max(1), source: Source }).nullable(),
  /** Contraste mínimo logo/fondo (WCAG). */
  minContrast: z.strictObject({ value: z.number().positive(), source: Source }).nullable(),
  /** Límite de fondo por colorway: el fondo más oscuro (darkest) o más claro (lightest) recomendado. */
  backgrounds: z.array(z.strictObject({ colorway: LogoSchema.shape.colorway, rule: z.string(), darkestBg: Hex.nullable(), lightestBg: Hex.nullable(), source: Source })),
  overPhoto: z.strictObject({ rule: z.string(), allowedColorways: z.array(LogoSchema.shape.colorway), source: Source }).nullable(),
  prohibitions: z.array(z.strictObject({ text: z.string(), source: Source })),
});

const Rule = z.strictObject({ text: z.string().min(1), source: Source });

/** Plantilla de pieza del cliente en Figma (modo «plantilla» de create-master-creative). */
export const BrandTemplateSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
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
export type BrandTemplate = z.infer<typeof BrandTemplateSchema>;

export const BrandSchema = z.strictObject({
  schema: z.literal(BRAND_SCHEMA_ID),
  slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  status: z.enum(['draft', 'validated']),
  validation: DecisionSchema.nullable(),
  sources: z.array(z.strictObject({
    kind: z.enum(['manual_pdf', 'logos', 'fonts', 'figma', 'person', 'other']),
    label: z.string(),
    /** Ruta local o URL de origen (los PDF del cliente no se versionan). */
    location: z.string().nullable(),
    version: z.string().nullable(),
    retrievedAt: z.string(),
  })).min(1),
  colors: z.array(BrandColorSchema).min(1),
  typography: TypographySchema,
  logos: z.array(LogoSchema).min(1),
  logoRules: LogoRulesSchema,
  graphicDevices: z.array(z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), name: z.string(), rule: z.string(), colorIds: z.array(z.string()), source: Source })),
  photography: z.strictObject({ rules: z.array(Rule), avoid: z.array(Rule) }),
  layout: z.strictObject({ rules: z.array(Rule) }),
  copy: z.strictObject({
    claims: z.array(z.strictObject({ text: z.string(), rule: z.string().nullable(), source: Source })),
    mandatoryTexts: z.array(z.strictObject({ text: z.string(), when: z.string(), source: Source })),
    tone: z.array(Rule),
  }),
  rules: z.strictObject({ must: z.array(Rule), never: z.array(Rule) }),
  /** Lo que el manual NO especifica y una pieza paid necesita: se decide por encargo y se registra. */
  gaps: z.array(z.string()),
  /** Erratas o contradicciones a resolver con el cliente. */
  openQuestions: z.array(z.strictObject({ id: z.string(), question: z.string(), status: z.enum(['open', 'resolved']), answer: z.string().nullable(), source: Source })),
  templates: z.array(BrandTemplateSchema),
});
export type Brand = z.infer<typeof BrandSchema>;
