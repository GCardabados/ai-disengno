// Funciones puras de contrato (no MOCK ni real): estados, safe zones y configuración.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, type ValidationResult } from '../src/contracts/validation.ts';
import { resolveSafeZone, type Destination, type SafeZoneRule, type SafeZoneApproval } from '../src/contracts/destination.ts';
import { parse } from '../src/contracts/schema.ts';
import { SafeZoneRuleSchema } from '../src/contracts/destination.ts';
import { checkConfigSemantics } from '../src/contracts/config.ts';
import { exampleConfig } from './helpers.ts';

const r = (status: ValidationResult['status'], kind: ValidationResult['kind'] = 'deterministic', id: string = status): ValidationResult => ({
  validatorId: id, validatorVersion: '1', destinationId: 'd', kind, status, findings: [], coverage: 'test',
});

test('agregación: fail > not_evaluable > needs_review > pass, conservando las listas', () => {
  const a = aggregate([r('pass'), r('needs_review'), r('not_evaluable'), r('fail')]);
  assert.equal(a.status, 'fail');
  assert.equal(a.byStatus.needs_review.length, 1);
  assert.equal(a.byStatus.not_evaluable.length, 1);
  assert.equal(a.autoApprovable, false);
  assert.equal(a.humanApprovable, false);
  assert.equal(aggregate([r('pass'), r('not_evaluable')]).status, 'not_evaluable');
  assert.equal(aggregate([r('pass'), r('needs_review')]).humanApprovable, true);
  assert.equal(aggregate([r('pass'), r('needs_review')]).autoApprovable, false);
  assert.equal(aggregate([r('pass')]).autoApprovable, true);
});

test('agregación: una evaluación visual favorable no anula un fallo determinista', () => {
  const a = aggregate([r('fail', 'deterministic', 'logo'), r('pass', 'visual', 'vision')]);
  assert.equal(a.status, 'fail');
});

test('agregación: sin validadores deterministas no hay aprobación', () => {
  assert.equal(aggregate([r('pass', 'visual')]).status, 'not_evaluable');
  assert.equal(aggregate([]).status, 'not_evaluable');
});

const story: Destination = { id: 'meta-story', platform: 'meta', placement: 'stories', surface: 'instagram', width: 1080, height: 1920, specSource: null, safeZoneRuleIds: [] };
const reelsRule: SafeZoneRule = {
  ruleId: 'meta-reels-internal', version: '0.1', appliesTo: { platform: 'meta', placement: 'reels', surface: 'instagram', width: 1080, height: 1920 },
  geometry: { allowed: { rects: [{ x: 90, y: 220, width: 900, height: 631 }, { x: 90, y: 851, width: 820, height: 619 }] }, exclusions: [], gridCrops: [] },
  provenance: { kind: 'internal', authoredBy: 'Equipo', authoredAt: '2026-09-29', rationale: 'Medido de PNG de procedencia desconocida', derivedFrom: 'references/safe-zone-reel-916-icons.png' },
};
const reelsApproval: SafeZoneApproval = { ruleId: 'meta-reels-internal', version: '0.1', projectId: 'p', approvedBy: 'X', approvedAt: '2026-09-29', placements: ['reels'] };

test('[caso mínimo] destino sin safe zone verificada → bloqueado', () => {
  const res = resolveSafeZone(story, 'p', [], []);
  assert.equal(res.status, 'blocked');
  if (res.status === 'blocked') assert.equal(res.code, 'SAFE_ZONE_UNAPPROVED');
});

test('compartir 9:16 no implica compartir safe zone: una regla de Reels no sirve para Stories', () => {
  const res = resolveSafeZone({ ...story, safeZoneRuleIds: ['meta-reels-internal'] }, 'p', [reelsRule], [reelsApproval]);
  assert.equal(res.status, 'blocked');
  if (res.status === 'blocked') assert.equal(res.code, 'SAFE_ZONE_RULE_MISMATCH');
});

test('una regla existente sin aprobación del proyecto no desbloquea el destino', () => {
  const reels = { ...story, id: 'meta-reels', placement: 'reels', safeZoneRuleIds: ['meta-reels-internal'] };
  assert.equal(resolveSafeZone(reels, 'p', [reelsRule], []).status, 'blocked');
  assert.equal(resolveSafeZone(reels, 'otro-proyecto', [reelsRule], [reelsApproval]).status, 'blocked');
  assert.equal(resolveSafeZone(reels, 'p', [reelsRule], [reelsApproval]).status, 'approved');
});

test('una regla interna no puede declararse oficial sin URL y evidencia', () => {
  const fakeOfficial = { ...reelsRule, provenance: { kind: 'platform_official', retrievedBy: 'X' } };
  assert.equal(parse(SafeZoneRuleSchema, fakeOfficial).ok, false);
});

test('config: tolerancias solo pueden reducirse; el rol logo no puede ampliar operaciones', () => {
  const cfg = exampleConfig();
  assert.deepEqual(checkConfigSemantics(cfg), []);
  assert.ok(checkConfigSemantics({ ...cfg, tolerances: { linear: 1e-6, px: 0.5 } }).some((i) => i.code === 'TOLERANCE_LOOSENS_INVARIANT'));
  const loose = { ...cfg, taxonomy: { ...cfg.taxonomy, roles: cfg.taxonomy.roles.map((r) => (r.id === 'logo' ? { ...r, defaultAllowOps: ['translate', 'resize_text_box'] as const } : r)) } };
  assert.ok(checkConfigSemantics(loose as typeof cfg).some((i) => i.code === 'ROLE_LOOSENS_LOGO_INVARIANT'));
});
