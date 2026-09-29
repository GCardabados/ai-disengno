// Huellas de la maestra y diff por categoría.
//
// Dos usos distintos, deliberadamente separados:
//  1. Detección de cambios en la MAESTRA (aquí): incluye IDs y estructura. Cualquier diferencia invalida la aprobación.
//  2. Comparación MAESTRA→CLON (H3): usa contentProjection(), que NO contiene IDs. Los IDs nuevos del clon
//     y el nombre/tamaño/posición del frame raíz son diferencias esperadas, nunca cambios de contenido.
//
// Posición y renderBounds absolutos quedan fuera de las huellas: mover la maestra en el lienzo
// no es un cambio, y renderBounds depende de las fuentes instaladas en la máquina.
import type { NodeSnapshot, Fingerprints } from '../contracts/snapshot.ts';
import { relativeTo, type Transform } from '../contracts/geometry.ts';
import { canonicalize, hashOf } from './canonical.ts';

export const FINGERPRINT_CATEGORIES = ['structure', 'content', 'layout', 'metadata'] as const;
export type FingerprintCategory = (typeof FINGERPRINT_CATEGORIES)[number];

export function structureProjection(n: NodeSnapshot, isRoot: boolean): Record<string, unknown> {
  return {
    id: n.id,
    type: n.type,
    parentId: isRoot ? null : n.parentId,
    childIds: n.childIds,
    indexInParent: isRoot ? null : n.indexInParent,
  };
}

/** Proyección de contenido SIN IDs: reutilizable para comparar maestra y clon. */
export function contentProjection(n: NodeSnapshot): Record<string, unknown> {
  return {
    type: n.type,
    visible: n.visible,
    opacity: n.opacity,
    blendMode: n.blendMode,
    isMask: n.isMask,
    maskType: n.maskType,
    fills: n.fills,
    strokes: n.strokes,
    strokeWeight: n.strokeWeight,
    strokeAlign: n.strokeAlign,
    effects: n.effects,
    text: n.text ? { characters: n.text.characters, segments: n.text.segments } : null,
    vectorGeometryDigest: n.vectorGeometryDigest,
    component: n.component
      ? { mainComponentKey: n.component.mainComponentKey, remote: n.component.remote, mainComponentId: n.component.mainComponentId }
      : null,
  };
}

function linearPart(t: Transform | null): [number, number, number, number] | null {
  return t ? [t[0][0], t[0][1], t[1][0], t[1][1]] : null;
}

export function layoutProjection(n: NodeSnapshot, rootAbs: Transform | null, isRoot: boolean): Record<string, unknown> {
  let inRoot: Transform | null = null;
  if (!isRoot && rootAbs && n.absoluteTransform) inRoot = relativeTo(rootAbs, n.absoluteTransform);
  return {
    transformInRoot: inRoot,
    rootLinear: isRoot ? linearPart(n.absoluteTransform) : null,
    width: n.width,
    height: n.height,
    clipsContent: n.clipsContent,
    constraints: n.constraints,
    layout: n.layout,
    textLayout: n.text
      ? {
          autoResize: n.text.autoResize,
          truncation: n.text.truncation,
          maxLines: n.text.maxLines,
          alignHorizontal: n.text.alignHorizontal,
          alignVertical: n.text.alignVertical,
          leadingTrim: n.text.leadingTrim,
        }
      : null,
  };
}

export function metadataProjection(n: NodeSnapshot): Record<string, unknown> {
  return { name: n.name };
}

function projections(nodes: NodeSnapshot[], rootId: string) {
  const root = nodes.find((n) => n.id === rootId);
  const rootAbs = root?.absoluteTransform ?? null;
  return nodes.map((n) => {
    const isRoot = n.id === rootId;
    return {
      id: n.id,
      structure: structureProjection(n, isRoot),
      content: contentProjection(n),
      layout: layoutProjection(n, rootAbs, isRoot),
      metadata: metadataProjection(n),
    };
  });
}

export function computeFingerprints(nodes: NodeSnapshot[], rootId: string): Fingerprints {
  const p = projections(nodes, rootId);
  const structure = hashOf('structure', p.map((x) => x.structure));
  const content = hashOf('content', p.map((x) => ({ id: x.id, c: x.content })));
  const layout = hashOf('layout', p.map((x) => ({ id: x.id, l: x.layout })));
  const metadata = hashOf('metadata', p.map((x) => ({ id: x.id, m: x.metadata })));
  const master = hashOf('master', { structure, content, layout, metadata });
  return { master, structure, content, layout, metadata };
}

export interface NodeChange {
  nodeId: string;
  change: 'added' | 'removed' | 'modified';
  category: FingerprintCategory | 'presence';
  fields: string[];
}

/** Diff legible por categoría. Solo informa; la decisión (cualquier cambio invalida) la toma el llamante. */
export function diffNodes(before: NodeSnapshot[], after: NodeSnapshot[], rootId: string): NodeChange[] {
  const a = new Map(projections(before, rootId).map((x) => [x.id, x]));
  const b = new Map(projections(after, rootId).map((x) => [x.id, x]));
  const changes: NodeChange[] = [];
  for (const id of a.keys()) if (!b.has(id)) changes.push({ nodeId: id, change: 'removed', category: 'presence', fields: [] });
  for (const id of b.keys()) if (!a.has(id)) changes.push({ nodeId: id, change: 'added', category: 'presence', fields: [] });
  for (const [id, pa] of a) {
    const pb = b.get(id);
    if (!pb) continue;
    for (const cat of FINGERPRINT_CATEGORIES) {
      const ra = pa[cat];
      const rb = pb[cat];
      const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
      const fields = [...keys].filter((k) => canonicalize(ra[k] ?? null) !== canonicalize(rb[k] ?? null)).sort();
      if (fields.length > 0) changes.push({ nodeId: id, change: 'modified', category: cat, fields });
    }
  }
  return changes;
}
