import { z } from 'zod';

/** Única lista de operaciones por entidad (compartida por allowOps y por el contrato de Operation). */
export const ENTITY_OPS = ['translate', 'resize_text_box', 'recrop_background'] as const;
export type EntityOp = (typeof ENTITY_OPS)[number];

/**
 * Invariantes globales. Están en código, no en configuración: ningún proyecto,
 * rol ni entidad puede relajarlas.
 */
export const GLOBAL_INVARIANTS = {
  masterImmutable: true,
  noContentAddRemoveReplaceRewrite: true,
  /** Operaciones máximas que puede tener una entidad de protección 'logo'. */
  logoAllowedOps: ['translate'] as readonly EntityOp[],
  logoAllowReflow: false,
  protectedMustBeFullyInsideAllowedZone: true,
} as const;

/**
 * Tolerancias de REPRESENTACIÓN NUMÉRICA (coma flotante / serialización).
 * No autorizan ningún cambio. Un proyecto puede reducirlas, nunca ampliarlas.
 */
export const NUMERIC_TOLERANCE_MAX = { linear: 1e-6, px: 0.01 } as const;

export const PROTECTION_LEVELS = ['logo', 'protected', 'flexible', 'decorative'] as const;

export const RoleDefinitionSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  multiplicity: z.strictObject({ min: z.number().int().min(0), max: z.number().int().min(0).nullable() }),
  protection: z.enum(PROTECTION_LEVELS),
  mustBeInSafeZone: z.boolean(),
  defaultAllowOps: z.array(z.enum(ENTITY_OPS)),
  /** Pistas débiles: comparación de subcadenas contra el nombre de capa. Nunca determinan la naturaleza del contenido. */
  nameHints: z.array(z.string().min(2)),
});
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;

export const ProjectConfigSchema = z.strictObject({
  schema: z.literal('pcb.project.v1'),
  status: z.enum(['proposal', 'approved']),
  projectId: z.string().min(1),
  taxonomy: z.strictObject({
    id: z.string().min(1),
    version: z.string().min(1),
    roles: z.array(RoleDefinitionSchema).min(1),
  }),
  tolerances: z.strictObject({ linear: z.number().min(0), px: z.number().min(0) }),
  /** Personas autorizadas a aprobar manifiestos. Vacío = cualquiera con nombre (pendiente de decisión). */
  approvers: z.array(z.string().min(1)),
  ocr: z.strictObject({
    enabled: z.boolean(),
    engine: z.literal('tesseract-local'),
    langs: z.array(z.string()),
  }),
  visualReview: z.strictObject({ modelMayInspectScreenshots: z.boolean() }),
  heuristics: z.strictObject({
    /** Mínimo de vectores hermanos alineados para marcar "posible texto vectorizado". */
    vectorGlyphMinCount: z.number().int().min(2),
  }),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export interface ConfigIssue {
  code: string;
  message: string;
}

/** Comprobaciones semánticas que el esquema no expresa. */
export function checkConfigSemantics(cfg: ProjectConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (cfg.tolerances.linear > NUMERIC_TOLERANCE_MAX.linear || cfg.tolerances.px > NUMERIC_TOLERANCE_MAX.px) {
    issues.push({ code: 'TOLERANCE_LOOSENS_INVARIANT', message: 'Las tolerancias solo pueden reducirse.' });
  }
  const ids = new Set<string>();
  for (const r of cfg.taxonomy.roles) {
    if (ids.has(r.id)) issues.push({ code: 'DUPLICATE_ROLE', message: `Rol duplicado: ${r.id}` });
    ids.add(r.id);
    if (r.multiplicity.max !== null && r.multiplicity.max < r.multiplicity.min) {
      issues.push({ code: 'BAD_MULTIPLICITY', message: `max < min en ${r.id}` });
    }
    if (r.protection === 'logo') {
      const extra = r.defaultAllowOps.filter((op) => !GLOBAL_INVARIANTS.logoAllowedOps.includes(op));
      if (extra.length > 0) {
        issues.push({ code: 'ROLE_LOOSENS_LOGO_INVARIANT', message: `${r.id} permite ${extra.join(',')}` });
      }
    }
  }
  if (cfg.ocr.enabled && cfg.ocr.langs.length === 0) {
    issues.push({ code: 'OCR_WITHOUT_LANGS', message: 'OCR activado sin idiomas.' });
  }
  return issues;
}
