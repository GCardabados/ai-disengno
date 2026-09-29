// Resultados de validación y su agregación. Los cuatro estados conservan significados distintos.

export const CHECK_STATUSES = ['pass', 'needs_review', 'not_evaluable', 'fail'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/**
 * pass          — se ejecutó y no encontró infracción (por las comprobaciones declaradas).
 * needs_review  — se ejecutó; el resultado es ambiguo. Solo puede aprobarlo una persona.
 * not_evaluable — no se pudo ejecutar (faltan datos, fuente ausente, sin captura). Hay que resolver la causa.
 * fail          — infracción demostrada. No admite excepción.
 */
const SEVERITY: Record<CheckStatus, number> = { pass: 0, needs_review: 1, not_evaluable: 2, fail: 3 };

export interface Finding {
  code: string;
  severity: 'blocking' | 'warning';
  entityId?: string;
  nodeIds: string[];
  measured?: unknown;
  expected?: unknown;
  message: string;
}

export interface ValidationResult {
  validatorId: string;
  validatorVersion: string;
  destinationId: string;
  kind: 'deterministic' | 'visual';
  status: CheckStatus;
  findings: Finding[];
  /** Qué demuestra y qué no esta comprobación (p. ej. "no detectado por bounds", no "sin truncamiento"). */
  coverage: string;
}

export interface Aggregate {
  status: CheckStatus;
  byStatus: Record<CheckStatus, string[]>;
  autoApprovable: boolean;
  /** Una persona puede aprobar SOLO si todo lo no-pass es needs_review. */
  humanApprovable: boolean;
}

export function aggregate(results: ValidationResult[]): Aggregate {
  const byStatus: Record<CheckStatus, string[]> = { pass: [], needs_review: [], not_evaluable: [], fail: [] };
  let status: CheckStatus = 'pass';
  for (const r of results) {
    byStatus[r.status].push(`${r.kind}:${r.validatorId}@${r.validatorVersion}`);
    // Monótono: cualquier resultado (visual incluido) solo puede mantener o empeorar el estado.
    if (SEVERITY[r.status] > SEVERITY[status]) status = r.status;
  }
  if (results.length === 0) status = 'not_evaluable';
  const hasDeterministic = results.some((r) => r.kind === 'deterministic');
  if (!hasDeterministic) status = SEVERITY[status] >= SEVERITY.not_evaluable ? status : 'not_evaluable';
  return {
    status,
    byStatus,
    autoApprovable: status === 'pass',
    humanApprovable: status === 'pass' || status === 'needs_review',
  };
}

// ---------- Resultado del planificador (contrato; el planificador es H4) ----------

export interface Certificate {
  /** Hecho comprobable por un validador independiente. */
  claim: string;
  measured: Record<string, number>;
  required: Record<string, number>;
  entityIds: string[];
}

export type PlanOutcome =
  | { status: 'planned'; planId: string; destinationId: string; manifestHash: string; plannerVersion: string; ops: unknown[] }
  | { status: 'infeasible_proven'; destinationId: string; certificate: Certificate[] }
  | { status: 'no_solution_found'; destinationId: string; strategiesTried: string[]; bestAttemptFindings: Finding[] };
