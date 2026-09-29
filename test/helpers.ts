import { readFileSync } from 'node:fs';
import { parseOrThrow } from '../src/contracts/schema.ts';
import { ProjectConfigSchema, type ProjectConfig } from '../src/contracts/config.ts';
import type { MasterSnapshot } from '../src/contracts/snapshot.ts';
import type { Manifest, ReviewDecisions } from '../src/contracts/manifest.ts';
import type { MockNodeSpec } from '../src/figma/mock/fake-figma.ts';
import { mockSnapshot } from '../src/figma/mock/mock-relay.ts';

export function exampleConfig(): ProjectConfig {
  const raw = JSON.parse(readFileSync(new URL('../config/example.project.json', import.meta.url), 'utf8'));
  return parseOrThrow(ProjectConfigSchema, raw, 'config');
}

/** Instantánea MOCK ingerida por el mismo camino que una lectura real. */
export async function snap(spec: MockNodeSpec): Promise<MasterSnapshot> {
  const r = await mockSnapshot(spec);
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
  return r.snapshot;
}

export function entityOf(m: Manifest, nodeId: string) {
  const e = m.entities.find((x) => x.nodeIds.includes(nodeId));
  if (!e) throw new Error(`no entity for ${nodeId}`);
  return e;
}

/** Revisión completa de la maestra base (MOCK) tal como la haría una persona. */
export function fullReviewForBase(m: Manifest): ReviewDecisions {
  const e = (nodeId: string) => entityOf(m, nodeId).entityId;
  const approve = (role: string, extra: Record<string, unknown> = {}) => ({ status: 'approved' as const, role, ...extra });
  return {
    schema: 'pcb.review.v1',
    manifestHash: m.manifestHash,
    reviewer: 'Revisora MOCK',
    entities: {
      [e('10:1')]: approve('background'),
      [e('10:2')]: approve('background', { contentNature: 'image_no_text_detected', statement: 'Revisado a ojo: el fondo no contiene texto.' }),
      [e('10:4')]: approve('logo', { contentNature: 'vector_graphic', statement: 'Es el logotipo vectorial de la marca.' }),
      [e('10:6')]: approve('headline'),
      [e('10:7')]: approve('body'),
      [e('10:8')]: approve('cta'),
      [e('10:9')]: approve('cta_label'),
      [e('10:10')]: approve('legal'),
      [e('10:11')]: approve('product_image', { contentNature: 'image_no_text_detected', statement: 'Revisado a ojo: packshot sin texto.' }),
      [e('10:12')]: approve('price'),
      [e('10:13')]: approve('decorative', { contentNature: 'image_embedded_text', statement: 'El banner lleva el texto "SALE" incrustado en la imagen.' }),
      [e('10:16')]: approve('body', { contentNature: 'vectorized_text', statement: 'El claim está vectorizado; no es texto editable.' }),
    },
    pending: {
      '10:14': { resolution: 'structural', justification: 'hidden_non_content', statement: 'Texto antiguo oculto; no forma parte de la pieza.' },
    },
    compositions: Object.fromEntries(m.compositions.map((c) => [c.compositionId, { status: 'accepted' as const }])),
    relations: [],
  };
}
