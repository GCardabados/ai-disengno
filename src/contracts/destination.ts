// Destinos y safe zones. Procedencia (de dónde sale la regla) ≠ aprobación (decisión del proyecto de usarla).
import { z } from 'zod';
import { RegionSchema } from './geometry.ts';

export const AppliesToSchema = z.strictObject({
  platform: z.string().min(1),
  placement: z.string().min(1),
  surface: z.string().nullable(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});

export const ProvenanceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('platform_official'),
    sourceUrl: z.string().regex(/^https:\/\//),
    retrievedAt: z.string(),
    retrievedBy: z.string().min(1),
    evidencePath: z.string().min(1),
    evidenceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.strictObject({
    kind: z.literal('client'),
    document: z.string().min(1),
    providedBy: z.string().min(1),
    receivedAt: z.string(),
    evidencePath: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal('internal'),
    authoredBy: z.string().min(1),
    authoredAt: z.string(),
    rationale: z.string().min(3),
    derivedFrom: z.string().nullable(),
  }),
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const SafeZoneRuleSchema = z.strictObject({
  ruleId: z.string().min(1),
  version: z.string().min(1),
  appliesTo: AppliesToSchema,
  geometry: z.strictObject({
    allowed: RegionSchema,
    exclusions: z.array(RegionSchema),
    gridCrops: z.array(RegionSchema),
  }),
  provenance: ProvenanceSchema,
});
export type SafeZoneRule = z.infer<typeof SafeZoneRuleSchema>;

export const SafeZoneApprovalSchema = z.strictObject({
  ruleId: z.string(),
  version: z.string(),
  projectId: z.string(),
  approvedBy: z.string().min(1),
  approvedAt: z.string(),
  placements: z.array(z.string()).min(1),
});
export type SafeZoneApproval = z.infer<typeof SafeZoneApprovalSchema>;

/** Declaración de no aplicabilidad: exige haber investigado fuentes de plataforma, no solo nuestras referencias. */
export const SafeZoneNotApplicableSchema = z.strictObject({
  placement: z.string(),
  projectId: z.string(),
  statedBy: z.string().min(1),
  statedAt: z.string(),
  rationale: z.string().min(10),
  investigatedSources: z.array(z.string().min(1)).min(1),
});
export type SafeZoneNotApplicable = z.infer<typeof SafeZoneNotApplicableSchema>;

export const DestinationSchema = z.strictObject({
  id: z.string().min(1),
  platform: z.string(),
  placement: z.string(),
  surface: z.string().nullable(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  specSource: z.strictObject({ url: z.string(), retrievedAt: z.string(), retrievedBy: z.string() }).nullable(),
  /** Referencias explícitas; no hay herencia por proporción. */
  safeZoneRuleIds: z.array(z.string()),
});
export type Destination = z.infer<typeof DestinationSchema>;

export type SafeZoneResolution =
  | { status: 'approved'; rule: SafeZoneRule; approval: SafeZoneApproval }
  | { status: 'not_applicable'; statement: SafeZoneNotApplicable }
  | { status: 'blocked'; code: 'SAFE_ZONE_UNAPPROVED' | 'SAFE_ZONE_RULE_MISMATCH' | 'SAFE_ZONE_AMBIGUOUS'; detail: string };

/**
 * Resuelve la safe zone de un destino. Nunca hereda por proporción ni relaja:
 * la regla debe coincidir EXACTAMENTE en plataforma, ubicación, superficie y dimensiones,
 * y tener una aprobación del proyecto para esa ubicación.
 */
export function resolveSafeZone(
  dest: Destination,
  projectId: string,
  rules: SafeZoneRule[],
  approvals: SafeZoneApproval[],
  notApplicable: SafeZoneNotApplicable[] = [],
): SafeZoneResolution {
  const candidates: Array<{ rule: SafeZoneRule; approval: SafeZoneApproval }> = [];
  for (const ruleId of dest.safeZoneRuleIds) {
    for (const rule of rules.filter((r) => r.ruleId === ruleId)) {
      const a = rule.appliesTo;
      const matches =
        a.platform === dest.platform &&
        a.placement === dest.placement &&
        a.surface === dest.surface &&
        a.width === dest.width &&
        a.height === dest.height;
      if (!matches) {
        return {
          status: 'blocked',
          code: 'SAFE_ZONE_RULE_MISMATCH',
          detail: `La regla ${rule.ruleId}@${rule.version} es para ${a.platform}/${a.placement}/${a.surface ?? '-'} ${a.width}×${a.height}, no para el destino ${dest.id}.`,
        };
      }
      const approval = approvals.find(
        (ap) =>
          ap.ruleId === rule.ruleId &&
          ap.version === rule.version &&
          ap.projectId === projectId &&
          ap.placements.includes(dest.placement),
      );
      if (approval) candidates.push({ rule, approval });
    }
  }
  if (candidates.length > 1) {
    return { status: 'blocked', code: 'SAFE_ZONE_AMBIGUOUS', detail: `Hay ${candidates.length} reglas aprobadas para ${dest.id}.` };
  }
  if (candidates.length === 1) return { status: 'approved', ...candidates[0]! };
  const na = notApplicable.find((n) => n.placement === dest.placement && n.projectId === projectId);
  if (na) return { status: 'not_applicable', statement: na };
  return { status: 'blocked', code: 'SAFE_ZONE_UNAPPROVED', detail: `El destino ${dest.id} no tiene una safe zone aprobada.` };
}
