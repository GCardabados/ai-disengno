// Destinos y safe zones. Procedencia (de dónde sale la regla) ≠ aprobación (decisión del proyecto de usarla).
import { s, type Infer } from './schema.ts';
import { RegionSchema } from './geometry.ts';

export const AppliesToSchema = s.object({
  platform: s.string({ min: 1 }),
  placement: s.string({ min: 1 }),
  surface: s.nullable(s.string()),
  width: s.number({ int: true, min: 1 }),
  height: s.number({ int: true, min: 1 }),
});

export const ProvenanceSchema = s.discriminated('kind', {
  platform_official: s.object({
    kind: s.literal('platform_official'),
    sourceUrl: s.string({ pattern: /^https:\/\// }),
    retrievedAt: s.string(),
    retrievedBy: s.string({ min: 1 }),
    evidencePath: s.string({ min: 1 }),
    evidenceSha256: s.string({ pattern: /^[0-9a-f]{64}$/ }),
  }),
  client: s.object({
    kind: s.literal('client'),
    document: s.string({ min: 1 }),
    providedBy: s.string({ min: 1 }),
    receivedAt: s.string(),
    evidencePath: s.nullable(s.string()),
  }),
  internal: s.object({
    kind: s.literal('internal'),
    authoredBy: s.string({ min: 1 }),
    authoredAt: s.string(),
    rationale: s.string({ min: 3 }),
    derivedFrom: s.nullable(s.string()),
  }),
});
export type Provenance = Infer<typeof ProvenanceSchema>;

export const SafeZoneRuleSchema = s.object({
  ruleId: s.string({ min: 1 }),
  version: s.string({ min: 1 }),
  appliesTo: AppliesToSchema,
  geometry: s.object({
    allowed: RegionSchema,
    exclusions: s.array(RegionSchema),
    gridCrops: s.array(RegionSchema),
  }),
  provenance: ProvenanceSchema,
});
export type SafeZoneRule = Infer<typeof SafeZoneRuleSchema>;

export const SafeZoneApprovalSchema = s.object({
  ruleId: s.string(),
  version: s.string(),
  projectId: s.string(),
  approvedBy: s.string({ min: 1 }),
  approvedAt: s.string(),
  placements: s.array(s.string(), { min: 1 }),
});
export type SafeZoneApproval = Infer<typeof SafeZoneApprovalSchema>;

/** Declaración de no aplicabilidad: exige haber investigado fuentes de plataforma, no solo nuestras referencias. */
export const SafeZoneNotApplicableSchema = s.object({
  placement: s.string(),
  projectId: s.string(),
  statedBy: s.string({ min: 1 }),
  statedAt: s.string(),
  rationale: s.string({ min: 10 }),
  investigatedSources: s.array(s.string({ min: 1 }), { min: 1 }),
});
export type SafeZoneNotApplicable = Infer<typeof SafeZoneNotApplicableSchema>;

export const DestinationSchema = s.object({
  id: s.string({ min: 1 }),
  platform: s.string(),
  placement: s.string(),
  surface: s.nullable(s.string()),
  width: s.number({ int: true, min: 1 }),
  height: s.number({ int: true, min: 1 }),
  specSource: s.nullable(s.object({ url: s.string(), retrievedAt: s.string(), retrievedBy: s.string() })),
  /** Referencias explícitas; no hay herencia por proporción. */
  safeZoneRuleIds: s.array(s.string()),
});
export type Destination = Infer<typeof DestinationSchema>;

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
