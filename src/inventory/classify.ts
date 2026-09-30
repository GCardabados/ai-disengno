// Clasificador heurístico con evidencia. Produce PROPUESTAS: nunca aprueba nada.
// - El tipo técnico, el rol semántico y la naturaleza del contenido son ejes separados.
// - La naturaleza del contenido NUNCA se deduce del nombre de capa. El nombre solo genera pistas de rol de confianza baja.
// - Sin OCR ejecutado, ninguna imagen puede ser "sin texto detectado" ni "con texto incrustado".
import type { MasterSnapshot, NodeSnapshot, Paint } from '../contracts/snapshot.ts';
import type { ProjectConfig } from '../contracts/config.ts';
import {
  type Composition,
  type ContentNature,
  type EntityConstraints,
  type Evidence,
  type NodeDisposition,
  type SemanticEntity,
  type StructuralJustification,
  PENDING_REASONS,
  REVIEW_REASONS,
} from '../contracts/manifest.ts';
import { intersectionArea, type Rect } from '../contracts/geometry.ts';
import { shortId } from '../hash/canonical.ts';

// v2: los descendientes de una máscara son estructurales ('mask'); pistas de rol por palabras completas.
export const CLASSIFIER = { id: 'pcb.classifier.heuristic', version: '2' } as const;

/** Tokens de un nombre (dato no confiable) para comparar pistas por palabras completas, no subcadenas. */
export function nameTokens(s: string): string[] {
  return s.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
}

/** La pista coincide si sus tokens aparecen contiguos en el nombre ("cta/label" ↔ "CTA / Label"; "cta" ✗ "Rectangle"). */
export function hintMatches(name: string, hint: string): boolean {
  const n = nameTokens(name);
  const h = nameTokens(hint);
  if (h.length === 0) return false;
  for (let i = 0; i + h.length <= n.length; i++) if (h.every((t, j) => n[i + j] === t)) return true;
  return false;
}

type PendingReason = (typeof PENDING_REASONS)[number];
type ReviewReason = (typeof REVIEW_REASONS)[number];

const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']);
const VECTOR_LEAF_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE']);
const SHAPE_LEAF_TYPES = new Set(['RECTANGLE', 'ELLIPSE']);

export const DEFAULT_CONSTRAINTS: EntityConstraints = {
  allowOps: [],
  allowReflow: false,
  atomicGroup: null,
  protectedRegions: [],
  mustBeInSafeZone: null,
};

interface Draft {
  nodeIds: string[];
  nature: ContentNature;
  evidence: Evidence[];
  reasons: Set<ReviewReason>;
  clusterParent: string | null;
}

export interface Classification {
  entities: SemanticEntity[];
  dispositions: NodeDisposition[];
  compositions: Composition[];
}

function ev(kind: Evidence['kind'], detail: string, trust: Evidence['trust'], nodeIds: string[]): Evidence {
  return { kind, detail, producedBy: CLASSIFIER.id, version: CLASSIFIER.version, trust, nodeIds };
}

function visiblePaints(v: NodeSnapshot['fills']): Paint[] {
  return Array.isArray(v) ? v.filter((p) => p.visible && p.opacity > 0) : [];
}

function paintsSomething(n: NodeSnapshot): boolean {
  return (
    n.fills === 'MIXED' ||
    visiblePaints(n.fills).length > 0 ||
    (visiblePaints(n.strokes).length > 0 && n.strokeWeight !== 0) ||
    n.effects.some((e) => e.visible)
  );
}

function union(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.width));
  const y2 = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: x2 - x, height: y2 - y };
}

export function classify(snapshot: MasterSnapshot, config: ProjectConfig): Classification {
  const nodes = snapshot.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rootId = snapshot.rootNodeId;
  const missingFont = new Set(snapshot.environment.nodesWithMissingFont);

  const effectivelyVisible = (n: NodeSnapshot): boolean => {
    let cur: NodeSnapshot | undefined = n;
    while (cur) {
      if (!cur.visible) return false;
      if (cur.id === rootId) return true;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return true;
  };

  const drafts: Draft[] = [];
  const structural = new Map<string, { justification: StructuralJustification; evidence: Evidence[] }>();
  const pending = new Map<string, PendingReason[]>();

  const addDraft = (n: NodeSnapshot, nature: ContentNature, evidence: Evidence[], reasons: ReviewReason[], clusterParent: string | null = null) => {
    drafts.push({ nodeIds: [n.id], nature, evidence, reasons: new Set<ReviewReason>(['ROLE_UNASSIGNED', ...reasons]), clusterParent });
  };

  for (const n of nodes) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const isRoot = n.id === rootId;

    if (n.readErrors.length > 0) {
      pending.set(n.id, ['READ_ERRORS']);
      continue;
    }
    if (!effectivelyVisible(n)) {
      pending.set(n.id, ['HIDDEN_OR_IN_HIDDEN_ANCESTOR']);
      continue;
    }
    if (n.opacity === 0) {
      pending.set(n.id, ['ZERO_OPACITY']);
      continue;
    }
    if (!isRoot && parent?.type === 'BOOLEAN_OPERATION') {
      structural.set(n.id, {
        justification: 'boolean_operand',
        evidence: [ev('node_type', `Operando de BOOLEAN_OPERATION ${parent.id}`, 'high', [n.id, parent.id])],
      });
      continue;
    }
    const maskAncestor = (() => {
      let cur = parent;
      while (cur && cur.id !== rootId) {
        if (cur.isMask) return cur;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return undefined;
    })();
    if (maskAncestor) {
      structural.set(n.id, {
        justification: 'mask',
        evidence: [ev('mask_flag', `Forma parte de la geometría de la máscara ${maskAncestor.id}; no se pinta como contenido`, 'high', [n.id, maskAncestor.id])],
      });
      continue;
    }
    if (n.isMask) {
      structural.set(n.id, {
        justification: 'mask',
        evidence: [ev('mask_flag', `isMask=true, maskType=${n.maskType ?? 'null'}`, 'high', [n.id])],
      });
      continue;
    }
    const fills = visiblePaints(n.fills);
    if (fills.some((p) => p.type === 'VIDEO')) {
      pending.set(n.id, ['UNSUPPORTED_VIDEO_PAINT']);
      continue;
    }

    if (n.type === 'TEXT' && n.text) {
      const reasons: ReviewReason[] = [];
      if (missingFont.has(n.id)) reasons.push('FONT_MISSING');
      if (n.text.segmentFields !== 'full') reasons.push('TEXT_SEGMENTS_INCOMPLETE');
      addDraft(
        n,
        'editable_text',
        [
          ev('node_type', 'Nodo TEXT', 'high', [n.id]),
          ev('text_node', `${n.text.characters.length} caracteres, ${n.text.segments.length} segmento(s) de estilo`, 'high', [n.id]),
        ],
        reasons,
      );
      continue;
    }

    const imageFills = fills.filter((p) => p.type === 'IMAGE');
    if (imageFills.length > 0) {
      addDraft(
        n,
        'image_text_undetermined',
        [
          ev(
            'image_fill',
            `Relleno IMAGE en nodo ${n.type}: ${imageFills.map((p) => `hash=${p.imageHash ?? 'null'} scaleMode=${p.scaleMode ?? 'null'}`).join('; ')}`,
            'high',
            [n.id],
          ),
        ],
        ['TEXT_DETECTION_NOT_RUN'],
      );
      continue;
    }

    if (VECTOR_LEAF_TYPES.has(n.type)) {
      if (!paintsSomething(n)) {
        pending.set(n.id, ['NO_VISIBLE_PAINT']);
        continue;
      }
      const clusterParent = parent && !isRoot && parent.id !== rootId && CONTAINER_TYPES.has(parent.type) ? parent.id : null;
      addDraft(n, 'vector_undetermined', [ev('node_type', `Nodo ${n.type}`, 'high', [n.id])], ['VECTOR_NATURE_UNDETERMINED'], clusterParent);
      continue;
    }

    if (SHAPE_LEAF_TYPES.has(n.type)) {
      if (!paintsSomething(n)) {
        pending.set(n.id, ['NO_VISIBLE_PAINT']);
        continue;
      }
      addDraft(n, 'shape', [ev('paint_analysis', `Nodo ${n.type} con pintura visible sin imagen`, 'high', [n.id])], []);
      continue;
    }

    if (CONTAINER_TYPES.has(n.type)) {
      if (paintsSomething(n)) {
        addDraft(
          n,
          'shape',
          [ev('paint_analysis', `Contenedor ${n.type} con pintura propia visible (${n.childIds.length} hijos)`, 'high', [n.id])],
          n.childIds.length > 0 ? ['MIXED_CONTAINER_PAINT'] : [],
        );
        continue;
      }
      if (n.childIds.length === 0) {
        pending.set(n.id, ['EMPTY_CONTAINER']);
        continue;
      }
      let justification: StructuralJustification = 'container';
      if (isRoot) justification = 'root';
      else if (n.type === 'INSTANCE') justification = 'instance_root';
      else if (n.clipsContent) justification = 'clip_container';
      else if (n.layout.mode && n.layout.mode !== 'NONE') justification = 'layout_wrapper';
      const evidence = [ev('node_type', `Contenedor ${n.type} sin pintura propia visible`, 'high', [n.id])];
      if (n.type === 'INSTANCE' && n.component) {
        evidence.push(ev('component_ref', `mainComponentKey=${n.component.mainComponentKey ?? 'null'}`, 'high', [n.id]));
      }
      structural.set(n.id, { justification, evidence });
      continue;
    }

    pending.set(n.id, ['UNSUPPORTED_NODE_TYPE']);
  }

  // --- Agrupación de vectores hermanos (p. ej. un logo o un texto vectorizado) ---
  const clustered: Draft[] = [];
  const byParent = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (d.nature === 'vector_undetermined' && d.clusterParent) {
      const list = byParent.get(d.clusterParent) ?? [];
      list.push(d);
      byParent.set(d.clusterParent, list);
    } else {
      clustered.push(d);
    }
  }
  for (const [parentId, list] of byParent) {
    if (list.length === 1) {
      clustered.push(list[0]!);
      continue;
    }
    const nodeIds = list.flatMap((d) => d.nodeIds);
    const merged: Draft = {
      nodeIds,
      nature: 'vector_undetermined',
      evidence: [
        ...list.flatMap((d) => d.evidence),
        ev('vector_cluster', `${list.length} vectores hermanos bajo el contenedor ${parentId}`, 'medium', [...nodeIds, parentId]),
      ],
      reasons: new Set<ReviewReason>(['ROLE_UNASSIGNED', 'VECTOR_NATURE_UNDETERMINED']),
      clusterParent: parentId,
    };
    const boxes = nodeIds.map((id) => byId.get(id)!.absoluteBoundingBox).filter((b): b is Rect => b !== null);
    if (boxes.length >= config.heuristics.vectorGlyphMinCount && boxes.length === nodeIds.length) {
      const heights = boxes.map((b) => b.height);
      const centers = boxes.map((b) => b.y + b.height / 2);
      const medianH = [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)]!;
      const similarHeights = Math.min(...heights) > 0 && Math.max(...heights) / Math.min(...heights) <= 1.5;
      const aligned = Math.max(...centers) - Math.min(...centers) <= 0.5 * medianH;
      if (similarHeights && aligned) {
        merged.evidence.push(
          ev('vector_glyph_heuristic', `${boxes.length} vectores de altura similar alineados horizontalmente (heurística, no prueba)`, 'low', nodeIds),
        );
        merged.reasons.add('POSSIBLE_VECTORIZED_TEXT');
      }
    }
    clustered.push(merged);
  }

  // --- Identidad estable de entidades ---
  const entityIdOf = (d: Draft) => shortId('ent', [...d.nodeIds].sort());
  const orderOf = (d: Draft) => Math.min(...d.nodeIds.map((id) => byId.get(id)!.paintOrder));
  clustered.sort((a, b) => orderOf(a) - orderOf(b));

  // --- Composiciones: imagen + texto editable pintado encima con solape de renderBounds ---
  const compositions: Composition[] = [];
  const texts = clustered.filter((d) => d.nature === 'editable_text');
  for (const img of clustered.filter((d) => d.nature === 'image_text_undetermined')) {
    const imgBounds = union(img.nodeIds.map((id) => byId.get(id)!.absoluteRenderBounds).filter((b): b is Rect => b !== null));
    if (!imgBounds) {
      img.reasons.add('RENDER_BOUNDS_UNAVAILABLE');
      continue;
    }
    const imgTop = Math.max(...img.nodeIds.map((id) => byId.get(id)!.paintOrder));
    const over: Array<{ d: Draft; area: number }> = [];
    for (const t of texts) {
      const tn = byId.get(t.nodeIds[0]!)!;
      if (tn.paintOrder <= imgTop) continue;
      if (!tn.absoluteRenderBounds) {
        t.reasons.add('RENDER_BOUNDS_UNAVAILABLE');
        continue;
      }
      const area = intersectionArea(imgBounds, tn.absoluteRenderBounds);
      if (area > 0) over.push({ d: t, area });
    }
    if (over.length === 0) continue;
    const entityIds = [entityIdOf(img), ...over.map((o) => entityIdOf(o.d))];
    img.reasons.add('EDITABLE_TEXT_OVERLAY_ON_IMAGE');
    over.forEach((o) => o.d.reasons.add('EDITABLE_TEXT_OVERLAY_ON_IMAGE'));
    compositions.push({
      compositionId: shortId('cmp', entityIds),
      nature: 'image_with_editable_text_overlay',
      entityIds,
      evidence: [
        ev(
          'geometry_overlap',
          `${over.length} texto(s) editable(s) pintado(s) sobre la imagen; solape de renderBounds (px²): ${over.map((o) => Math.round(o.area)).join(', ')}. Los rectángulos no prueban solape de píxeles.`,
          'medium',
          [...img.nodeIds, ...over.flatMap((o) => o.d.nodeIds)],
        ),
      ],
      status: 'proposed',
      decidedBy: null,
      statement: null,
    });
  }

  // --- Pistas de rol por nombre (dato no confiable; solo comparación de subcadenas) ---
  const entities: SemanticEntity[] = clustered.map((d) => {
    const id = entityIdOf(d);
    const namesFrom = [...d.nodeIds, ...(d.clusterParent ? [d.clusterParent] : [])];
    const roleHints: SemanticEntity['roleHints'] = [];
    for (const role of config.taxonomy.roles) {
      for (const hint of role.nameHints) {
        const hitNode = namesFrom.find((nid) => hintMatches(byId.get(nid)!.name, hint));
        if (hitNode && !roleHints.some((h) => h.roleId === role.id)) {
          roleHints.push({
            roleId: role.id,
            evidence: ev('layer_name_hint', `El nombre del nodo ${hitNode} contiene la pista configurada "${hint}"`, 'low', [hitNode]),
          });
        }
      }
    }
    return {
      entityId: id,
      role: null,
      roleHints,
      nodeIds: d.nodeIds,
      contentNature: d.nature,
      evidence: d.evidence,
      review: { status: 'needs_review', reasons: [...d.reasons], reviewedBy: null, reviewedAt: null, notes: null },
      constraints: structuredClone(DEFAULT_CONSTRAINTS),
    };
  });

  // --- Disposiciones: exactamente una por nodo ---
  const entityOfNode = new Map<string, string>();
  for (const e of entities) for (const nid of e.nodeIds) entityOfNode.set(nid, e.entityId);
  const dispositions: NodeDisposition[] = nodes.map((n) => {
    const eid = entityOfNode.get(n.id);
    if (eid) return { kind: 'content', nodeId: n.id, entityId: eid };
    const st = structural.get(n.id);
    if (st) return { kind: 'structural', nodeId: n.id, justification: st.justification, evidence: st.evidence, decidedBy: 'classifier', statement: null };
    const reasons = pending.get(n.id);
    if (reasons) return { kind: 'pending', nodeId: n.id, reasons };
    throw new Error(`classifier bug: node ${n.id} has no disposition`);
  });

  return { entities, dispositions, compositions };
}
