// Huella canónica de las reglas con las que se clasifica y se aprueba un manifiesto.
// Se calcula sobre el CONTENIDO de las reglas, no sobre sus identificadores: un cambio en un rol,
// una pista o una multiplicidad se detecta aunque taxonomy.id y taxonomy.version no cambien.
import { GLOBAL_INVARIANTS, NUMERIC_TOLERANCE_MAX, type ProjectConfig } from '../contracts/config.ts';
import { hashOf } from '../hash/canonical.ts';
import { CLASSIFIER } from './classify.ts';

/**
 * Campos cubiertos (el orden de los arrays es significativo; p. ej. el orden de los roles
 * determina qué pista de rol aparece primero en la plantilla de revisión).
 */
export const RULES_FINGERPRINT_COVERS = [
  'config.projectId',
  'config.taxonomy.id',
  'config.taxonomy.version',
  'config.taxonomy.roles[*] (id, label, multiplicity, protection, mustBeInSafeZone, defaultAllowOps, nameHints)',
  'config.tolerances',
  'config.approvers',
  'config.ocr (enabled, engine, langs)',
  'config.heuristics',
  'code:GLOBAL_INVARIANTS',
  'code:NUMERIC_TOLERANCE_MAX',
  'code:CLASSIFIER (id, version)',
] as const;

/**
 * Excluidos a propósito, porque no intervienen en clasificar ni aprobar:
 * - config.schema (identificador del formato),
 * - config.status (proposal/approved: estado administrativo del archivo, no una regla),
 * - config.visualReview (afecta a la inspección visual de H6, no al inventario).
 */
export const RULES_FINGERPRINT_EXCLUDES = ['config.schema', 'config.status', 'config.visualReview'] as const;

/**
 * Los números se hashean con su valor exacto (pcb.hash.v2 no redondea), así que tolerancias como 1e-6 y 1e-7
 * producen huellas distintas.
 */
export function rulesFingerprint(cfg: ProjectConfig): string {
  return hashOf('rules', {
    projectId: cfg.projectId,
    taxonomy: cfg.taxonomy,
    tolerances: cfg.tolerances,
    approvers: cfg.approvers,
    ocr: cfg.ocr,
    heuristics: cfg.heuristics,
    globalInvariants: GLOBAL_INVARIANTS,
    numericToleranceMax: NUMERIC_TOLERANCE_MAX,
    classifier: CLASSIFIER,
  });
}
