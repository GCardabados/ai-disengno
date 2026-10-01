// Comprobaciones deterministas de la adaptación DEMO sobre la RELECTURA del clon (no sobre lo que el script dice
// haber hecho). Cada comprobación declara qué demuestra y qué no. La revisión visual solo puede empeorar el estado.
import type { MasterSnapshot, NodeSnapshot } from '../contracts/snapshot.ts';
import { safeAreaLabel, safeExclusionsOf, safeRectOf, type DemoComposition } from '../contracts/demo.ts';
import type { Rect } from '../contracts/geometry.ts';
import { aggregate, type Aggregate, type CheckStatus, type Finding, type ValidationResult } from '../contracts/validation.ts';
import { canonicalize } from '../hash/canonical.ts';
import { contentProjection } from '../hash/fingerprint.ts';
import { relRect, type DemoPlan } from './plan.ts';

export const DEMO_CHECK_VERSION = '1';

export interface DemoCheckInput {
  master: MasterSnapshot;
  clone: MasterSnapshot;
  idMap: Array<[string, string]>;
  plan: DemoPlan;
  composition: DemoComposition;
  /** Tolerancia en px para comparar posiciones (config.tolerances.px). Solo absorbe ruido de coma flotante. */
  tolerancePx: number;
  /** Resultado de la comprobación de la maestra por hashes por nodo (null = no se ejecutó). */
  masterDigestsEqual: boolean | null;
  /** Sondas de geometría vectorial (coordenadas del frame destino) antes y después de las ediciones. */
  vectorProbe?: { before: VectorProbe; after: VectorProbe } | null;
  /** Revisión visual del agente sobre la captura del clon (null = no se hizo). */
  visual: { status: CheckStatus; findings: Finding[] } | null;
}

/** Por id de nodo del CLON: vértices y tiradores en coordenadas del frame destino (ver src/figma/vector-probe.ts). */
export type VectorProbe = Record<string, { vertices: Array<[number, number]>; segments: Array<{ start: number; end: number; tangentStart: [number, number]; tangentEnd: [number, number] }> }>;

export interface DemoCheckReport {
  results: ValidationResult[];
  aggregate: Aggregate;
}

const r = (validatorId: string, status: CheckStatus, coverage: string, findings: Finding[] = [], kind: 'deterministic' | 'visual' = 'deterministic'): ValidationResult => ({
  validatorId, validatorVersion: DEMO_CHECK_VERSION, destinationId: 'demo_1080x1080', kind, status, findings, coverage,
});
const statusOf = (f: Finding[]): CheckStatus => (f.some((x) => x.severity === 'blocking') ? 'fail' : f.length > 0 ? 'needs_review' : 'pass');

function within(inner: Rect, outer: Rect, tol: number): boolean {
  return inner.x >= outer.x - tol && inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol && inner.y + inner.height <= outer.y + outer.height + tol;
}

export function checkDemo(inp: DemoCheckInput): DemoCheckReport {
  const { master, clone, plan, composition: c, tolerancePx: tol } = inp;
  const mById = new Map(master.nodes.map((n) => [n.id, n]));
  const cById = new Map(clone.nodes.map((n) => [n.id, n]));
  const toClone = new Map(inp.idMap);
  const mRoot = mById.get(master.rootNodeId)!;
  const cRoot = cById.get(clone.rootNodeId);
  const results: ValidationResult[] = [];
  const pair = (mid: string): NodeSnapshot | undefined => {
    const cid = toClone.get(mid);
    return cid ? cById.get(cid) : undefined;
  };

  // 1. Dimensiones del destino.
  {
    const f: Finding[] = [];
    if (!cRoot || cRoot.width !== c.target.width || cRoot.height !== c.target.height) {
      f.push({ code: 'TARGET_SIZE', severity: 'blocking', nodeIds: [clone.rootNodeId], measured: cRoot ? [cRoot.width, cRoot.height] : null, expected: [c.target.width, c.target.height], message: 'Tamaño del frame destino' });
    }
    if (cRoot && cRoot.clipsContent !== true) f.push({ code: 'ROOT_NOT_CLIPPING', severity: 'blocking', nodeIds: [cRoot.id], message: 'El frame destino no recorta su contenido' });
    results.push(r('target_dimensions', statusOf(f), 'Ancho/alto exactos del frame destino y recorte activo.', f));
  }

  // 2. Conservación de nodos (ninguno eliminado, añadido o sustituido) y de su jerarquía.
  {
    const f: Finding[] = [];
    if (clone.nodes.length !== master.nodes.length) {
      f.push({ code: 'NODE_COUNT', severity: 'blocking', nodeIds: [], measured: clone.nodes.length, expected: master.nodes.length, message: 'Número de nodos distinto' });
    }
    const mapped = new Set<string>();
    for (const m of master.nodes) {
      const cn = pair(m.id);
      if (!cn) { f.push({ code: 'NODE_MISSING', severity: 'blocking', nodeIds: [m.id], message: 'Nodo sin correspondencia en el clon' }); continue; }
      mapped.add(cn.id);
      if (cn.type !== m.type) f.push({ code: 'NODE_TYPE_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], message: `${m.type} → ${cn.type}` });
      if (m.id !== mRoot.id && cn.name !== m.name) f.push({ code: 'NODE_RENAMED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'Nombre de capa cambiado' });
      const mp = m.parentId && m.id !== mRoot.id ? toClone.get(m.parentId) : null;
      if (m.id !== mRoot.id && cn.parentId !== mp) f.push({ code: 'NODE_REPARENTED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'Padre distinto' });
      if (m.id !== mRoot.id && cn.indexInParent !== m.indexInParent) f.push({ code: 'NODE_REORDERED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'Orden de apilado distinto' });
    }
    for (const n of clone.nodes) if (!mapped.has(n.id)) f.push({ code: 'NODE_ADDED', severity: 'blocking', nodeIds: [n.id], message: 'Nodo nuevo en el clon' });
    results.push(r('nodes_preserved', statusOf(f), 'Mismo conjunto de nodos, tipos, nombres, padres y orden de apilado (por correspondencia de la relectura).', f));
  }

  // 3. Contenido: textos, pinturas, efectos, visibilidad, máscaras y geometría vectorial idénticos.
  {
    const f: Finding[] = [];
    const resized = new Set([mRoot.id, ...plan.effectResizes.map((e) => e.nodeId), ...plan.vectorEdits.map((v) => v.nodeId), ...(plan.imageScales ?? []).map((e) => e.nodeId)]);
    // El grosor de trazo declarado en una edición de decoración se verifica en vector_edits (aquí se neutraliza).
    const strokeEdited = new Set(plan.vectorEdits.filter((v) => v.strokeWeight).map((v) => v.nodeId));
    for (const m of master.nodes) {
      const cn = pair(m.id);
      if (!cn) continue;
      const a = contentProjection(m);
      const b = contentProjection(cn);
      // La geometría de un nodo redimensionado cambia por definición; se compara todo lo demás.
      if (resized.has(m.id)) { a.vectorGeometryDigest = null; b.vectorGeometryDigest = null; }
      if (strokeEdited.has(m.id)) { a.strokeWeight = null; b.strokeWeight = null; }
      // Propiedades de contenedor que no están en contentProjection (recorte, maquetación automática).
      if (m.clipsContent !== cn.clipsContent || m.layout.mode !== cn.layout.mode) {
        f.push({ code: 'CONTAINER_PROPS_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'Recorte o modo de maquetación distinto' });
      }
      if (m.text && cn.text && m.text.characters !== cn.text.characters) {
        f.push({ code: 'TEXT_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'El texto no es idéntico' });
      } else if (canonicalize(a) !== canonicalize(b)) {
        const keys = Object.keys(a).filter((k) => canonicalize(a[k]) !== canonicalize(b[k]));
        f.push({ code: 'CONTENT_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], measured: keys, message: `Cambian: ${keys.join(', ')}` });
      }
    }
    results.push(r('content_preserved', statusOf(f), 'Igualdad exacta de caracteres, segmentos de estilo (fuente, cuerpo, interlineado, color), pinturas, efectos, visibilidad, opacidad, máscaras y geometría vectorial. No evalúa el render.', f));
  }

  // 4. Operaciones: cada nodo está donde dice el plan, sin escalado ni rotación; solo los efectos listados cambian de tamaño.
  {
    const f: Finding[] = [];
    for (const m of master.nodes) {
      if (m.id === mRoot.id) continue;
      const cn = pair(m.id);
      const exp = plan.expected[m.id];
      if (!cn || !exp || !cRoot) continue;
      const lm = m.relativeTransform, lc = cn.relativeTransform;
      if (lm && lc && (lm[0][0] !== lc[0][0] || lm[0][1] !== lc[0][1] || lm[1][0] !== lc[1][0] || lm[1][1] !== lc[1][1])) {
        f.push({ code: 'LINEAR_TRANSFORM_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'Rotación, escala o sesgo cambiados' });
      }
      // GROUP: solo su CAJA es derivada de los hijos (que se comprueban uno a uno); rotación, opacidad, máscara,
      // efectos y recorte se siguen comprobando aquí y en content_preserved. Vector editado: lo cubre vector_edits.
      if (exp.derived || exp.edited) continue;
      const got = relRect(cn, cRoot);
      if (!got || !exp.rect) { f.push({ code: 'NO_BOUNDS', severity: 'warning', nodeIds: [m.id], message: 'Sin caja para comparar' }); continue; }
      const d = Math.max(Math.abs(got.x - exp.rect.x), Math.abs(got.y - exp.rect.y), Math.abs(got.width - exp.rect.width), Math.abs(got.height - exp.rect.height));
      if (d > tol) f.push({ code: 'UNEXPECTED_GEOMETRY', severity: 'blocking', nodeIds: [m.id, cn.id], measured: got, expected: exp.rect, message: `Desviación ${d} px` });
      if (!exp.resized && (cn.width !== m.width || cn.height !== m.height)) f.push({ code: 'SIZE_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'Tamaño cambiado en un nodo que solo podía trasladarse' });
      // Escala de imagen: el MISMO factor en ancho y alto (sin deformar), exactamente el declarado.
      if (exp.scale !== undefined && m.width && m.height && cn.width && cn.height) {
        const sx = cn.width / m.width, sy = cn.height / m.height;
        if (Math.abs(sx - sy) > 1e-4) f.push({ code: 'IMAGE_DEFORMED', severity: 'blocking', nodeIds: [m.id, cn.id], measured: [sx, sy], message: 'Escala distinta en ancho y alto' });
        if (Math.abs(sx - exp.scale) > 1e-4) f.push({ code: 'IMAGE_SCALE_MISMATCH', severity: 'blocking', nodeIds: [m.id, cn.id], measured: sx, expected: exp.scale, message: 'Factor de escala distinto del declarado' });
      }
    }
    results.push(r('allowed_operations', statusOf(f), `Posición de cada caja respecto al plan (±${tol} px), tamaño exacto de todo lo que solo se traslada, factor único en ancho y alto de las imágenes escaladas y parte lineal exacta de cada transformación.`, f));
  }

  // 5. Logo: tamaño y disposición interna idénticos (exacto, sin tolerancia).
  {
    const f: Finding[] = [];
    const lockedRoots = c.sizeLockedNodeIds;
    const inLocked = (id: string, rootId: string): boolean => {
      let p: string | null = id;
      while (p) { if (p === rootId) return true; p = mById.get(p)?.parentId ?? null; }
      return false;
    };
    for (const lr of lockedRoots) {
      const mA = mById.get(lr), cA = pair(lr);
      if (!mA || !cA) { f.push({ code: 'LOCKED_MISSING', severity: 'blocking', nodeIds: [lr], message: 'Bloque bloqueado ausente' }); continue; }
      for (const m of master.nodes.filter((n) => inLocked(n.id, lr))) {
        const cn = pair(m.id);
        if (!cn || !m.absoluteTransform || !cn.absoluteTransform || !mA.absoluteTransform || !cA.absoluteTransform) continue;
        const offM = [m.absoluteTransform[0][2] - mA.absoluteTransform[0][2], m.absoluteTransform[1][2] - mA.absoluteTransform[1][2]];
        const offC = [cn.absoluteTransform[0][2] - cA.absoluteTransform[0][2], cn.absoluteTransform[1][2] - cA.absoluteTransform[1][2]];
        if (cn.width !== m.width || cn.height !== m.height) f.push({ code: 'LOGO_SIZE_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'Tamaño distinto' });
        if (canonicalize(m.relativeTransform?.map((row) => row.slice(0, 2))) !== canonicalize(cn.relativeTransform?.map((row) => row.slice(0, 2)))) f.push({ code: 'LOGO_TRANSFORM_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'Rotación/escala distinta' });
        const dOff = Math.max(Math.abs(offM[0]! - offC[0]!), Math.abs(offM[1]! - offC[1]!));
        if (dOff > tol) f.push({ code: 'LOGO_INTERNAL_LAYOUT_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], measured: offC, expected: offM, message: `Desplazamiento interno ${dOff} px` });
        if (m.clipsContent !== cn.clipsContent) f.push({ code: 'LOGO_CLIP_CHANGED', severity: 'blocking', nodeIds: [m.id, cn.id], message: 'Recorte distinto' });
      }
    }
    results.push(r('logo_locked', statusOf(f), 'Ancho/alto exactos, transformaciones lineales exactas, recorte y posición de cada nodo respecto al bloque del logo. El render del logo lo confirma la captura.', f));
  }

  // 6. Zona interna de prueba (regla de DEMO, no especificación oficial) y recortes por el borde del frame.
  {
    const f: Finding[] = [];
    const safe: Rect = safeRectOf(c);
    const frame: Rect = { x: 0, y: 0, width: c.target.width, height: c.target.height };
    for (const id of c.importantNodeIds) {
      const cn = pair(id);
      const got = cn && cRoot ? relRect(cn, cRoot) : null;
      if (!got) { f.push({ code: 'NO_BOUNDS', severity: 'blocking', nodeIds: [id], message: 'Sin caja' }); continue; }
      if (!within(got, frame, tol)) f.push({ code: 'CLIPPED_BY_FRAME', severity: 'blocking', nodeIds: [id], measured: got, message: 'Sale del frame' });
      else if (!within(got, safe, tol)) f.push({ code: 'OUTSIDE_DEMO_SAFE_AREA', severity: 'blocking', nodeIds: [id], measured: got, expected: safe, message: `Fuera de la zona segura (${safeAreaLabel(c)})` });
      for (const ex of safeExclusionsOf(c)) {
        const ix = Math.min(got.x + got.width, ex.rect.x + ex.rect.width) - Math.max(got.x, ex.rect.x);
        const iy = Math.min(got.y + got.height, ex.rect.y + ex.rect.height) - Math.max(got.y, ex.rect.y);
        if (ix > tol && iy > tol) f.push({ code: 'IN_SAFE_ZONE_EXCLUSION', severity: 'blocking', nodeIds: [id], measured: got, expected: ex.rect, message: `Toca la exclusión «${ex.name}» de la zona segura` });
      }
      if (cn && cn.text && cn.absoluteRenderBounds === null) f.push({ code: 'TEXT_NOT_RENDERED', severity: 'blocking', nodeIds: [id], message: 'El texto no tiene render bounds' });
    }
    results.push(r('demo_safe_area', statusOf(f), `Cajas completas de los elementos importantes dentro del frame y de la zona segura, sin tocar sus exclusiones: ${safeAreaLabel(c)}. Las cajas de texto no prueban ausencia de truncamiento visual.`, f));
  }

  // 7. Cobertura de fondo: foto y degradado cubren todo el ancho; regiones protegidas de la foto visibles y sin textos encima.
  {
    const f: Finding[] = [];
    for (const id of c.mustCoverWidthNodeIds) {
      const cn = pair(id);
      const got = cn && cRoot ? relRect(cn, cRoot) : null;
      if (!got) { f.push({ code: 'NO_BOUNDS', severity: 'blocking', nodeIds: [id], message: 'Sin caja' }); continue; }
      if (got.x > tol || got.x + got.width < c.target.width - tol) f.push({ code: 'BACKGROUND_STRIP_UNCOVERED', severity: 'blocking', nodeIds: [id], measured: got, message: 'Queda una franja lateral sin cubrir' });
      if (got.y + got.height < c.target.height - tol) f.push({ code: 'BACKGROUND_BOTTOM_UNCOVERED', severity: 'blocking', nodeIds: [id], measured: got, message: 'No llega al borde inferior' });
    }
    for (const ce of c.mustCoverEdges) {
      const cn = pair(ce.nodeId);
      const got = cn && cRoot ? relRect(cn, cRoot) : null;
      if (!got) { f.push({ code: 'NO_BOUNDS', severity: 'blocking', nodeIds: [ce.nodeId], message: 'Sin caja' }); continue; }
      const miss = ce.edges.filter((e) =>
        (e === 'left' && got.x > tol) || (e === 'top' && got.y > tol) ||
        (e === 'right' && got.x + got.width < c.target.width - tol) || (e === 'bottom' && got.y + got.height < c.target.height - tol));
      if (miss.length > 0) f.push({ code: 'EDGE_UNCOVERED', severity: 'blocking', nodeIds: [ce.nodeId], measured: got, message: `No llega al borde: ${miss.join(', ')}` });
    }
    const textRects = master.nodes.filter((n) => n.text).map((n) => ({ id: n.id, rect: pair(n.id) && cRoot ? relRect(pair(n.id)!, cRoot) : null }));
    for (const pr of c.protectedRegions) {
      const cn = pair(pr.nodeId);
      const got = cn && cRoot ? relRect(cn, cRoot) : null;
      if (!got) { f.push({ code: 'NO_BOUNDS', severity: 'blocking', nodeIds: [pr.nodeId], message: 'Sin caja' }); continue; }
      // La región se declara en coordenadas locales de la MAESTRA; si la imagen se escaló, escala con ella.
      const k = mById.get(pr.nodeId)?.width ? got.width / mById.get(pr.nodeId)!.width! : 1;
      const region: Rect = { x: got.x + pr.rect.x * k, y: got.y + pr.rect.y * k, width: pr.rect.width * k, height: pr.rect.height * k };
      if (!within(region, { x: 0, y: 0, width: c.target.width, height: c.target.height }, tol)) f.push({ code: 'PROTECTED_REGION_CROPPED', severity: 'blocking', nodeIds: [pr.nodeId], measured: region, message: `${pr.purpose}: recortada` });
      for (const t of textRects) {
        if (!t.rect) continue;
        const ix = Math.min(region.x + region.width, t.rect.x + t.rect.width) - Math.max(region.x, t.rect.x);
        const iy = Math.min(region.y + region.height, t.rect.y + t.rect.height) - Math.max(region.y, t.rect.y);
        if (ix > tol && iy > tol) f.push({ code: 'TEXT_OVER_PROTECTED_REGION', severity: 'blocking', nodeIds: [pr.nodeId, t.id], message: `${pr.purpose}: texto encima` });
      }
    }
    results.push(r('background_coverage', statusOf(f), 'Cobertura por cajas del ancho y del borde inferior; regiones protegidas (declaradas por el agente) completas y sin cajas de texto encima. No mide píxeles.', f));
  }

  // 7b. Ediciones vectoriales de decoración: lo editado está donde dice el plan y NADA más de ese vector se movió.
  if (plan.vectorEdits.length > 0) {
    const f: Finding[] = [];
    const vp = inp.vectorProbe;
    if (!vp) {
      results.push(r('vector_edits', 'not_evaluable', 'Sin sondas de geometría antes/después.'));
    } else {
      const near = (a: [number, number] | undefined, b: { x: number; y: number } | [number, number], t: number) => {
        const [bx, by] = Array.isArray(b) ? b : [b.x, b.y];
        return !!a && Math.abs(a[0] - bx) <= t && Math.abs(a[1] - by) <= t;
      };
      for (const e of plan.vectorEdits) {
        const cid = toClone.get(e.nodeId);
        const before = cid ? vp.before[cid] : undefined, after = cid ? vp.after[cid] : undefined;
        if (!before || !after) { f.push({ code: 'NO_PROBE', severity: 'blocking', nodeIds: [e.nodeId], message: 'Falta la sonda' }); continue; }
        if (before.vertices.length !== after.vertices.length || before.segments.length !== after.segments.length) {
          f.push({ code: 'VECTOR_TOPOLOGY_CHANGED', severity: 'blocking', nodeIds: [e.nodeId], message: 'Cambió el número de vértices o segmentos' });
          continue;
        }
        if (e.strokeWeight) {
          const sw = cid ? cById.get(cid)?.strokeWeight : undefined;
          if (sw !== e.strokeWeight.to) f.push({ code: 'STROKE_NOT_AT_TARGET', severity: 'blocking', nodeIds: [e.nodeId], measured: sw ?? null, expected: e.strokeWeight.to, message: 'Grosor de trazo' });
        }
        const edited = new Map(e.vertices.map((v) => [v.index, v]));
        before.vertices.forEach((bv, i) => {
          const ed = edited.get(i);
          if (ed) {
            if (!near(bv, ed.from, 0.5)) f.push({ code: 'VERTEX_FROM_MISMATCH', severity: 'blocking', nodeIds: [e.nodeId], message: `vértice ${i} no estaba donde se esperaba` });
            if (!near(after.vertices[i], ed.to, 0.5)) f.push({ code: 'VERTEX_NOT_AT_TARGET', severity: 'blocking', nodeIds: [e.nodeId], measured: after.vertices[i], expected: ed.to, message: `vértice ${i}` });
          } else if (!near(after.vertices[i], bv, 0.05)) {
            f.push({ code: 'UNEDITED_VERTEX_MOVED', severity: 'blocking', nodeIds: [e.nodeId], measured: after.vertices[i], expected: bv, message: `vértice ${i} no debía moverse` });
          }
        });
        before.segments.forEach((bs, i) => {
          const as = after.segments[i]!;
          if (as.start !== bs.start || as.end !== bs.end) f.push({ code: 'SEGMENT_REWIRED', severity: 'blocking', nodeIds: [e.nodeId], message: `segmento ${i}` });
          for (const field of ['tangentStart', 'tangentEnd'] as const) {
            const ed = e.tangents.find((t) => t.segment === i && t.field === field);
            if (ed) { if (!near(as[field], ed.to, 0.5)) f.push({ code: 'TANGENT_NOT_AT_TARGET', severity: 'blocking', nodeIds: [e.nodeId], message: `segmento ${i} ${field}` }); }
            else if (!near(as[field], bs[field], 0.05)) f.push({ code: 'UNEDITED_TANGENT_CHANGED', severity: 'blocking', nodeIds: [e.nodeId], message: `segmento ${i} ${field}` });
          }
        });
      }
      results.push(r('vector_edits', statusOf(f), 'Vértices y tiradores editados en su destino (±0,5 px), todos los demás de ese vector sin cambios (±0,05 px), en coordenadas del frame; misma topología; grosor de trazo declarado.', f));
    }
  }

  // 7c. Maquetación (GEOMÉTRICA, por cajas de render): orden de lectura, CTA respecto a su copy, aporte de máscaras y
  // visibilidad efectiva del contenido importante. No juzga la calidad visual: eso queda para la captura.
  const rb = (id: string): Rect | null => {
    const cn = pair(id);
    const b = cn?.absoluteRenderBounds, o = cRoot?.absoluteBoundingBox;
    return b && o ? { x: b.x - o.x, y: b.y - o.y, width: b.width, height: b.height } : null;
  };
  const lc = c.layoutChecks;
  if (lc.readingOrder.length > 1 || lc.cta) {
    const f: Finding[] = [];
    // Las cajas de render de glifos dependen de la rasterización (diferencias de centésimas de px entre textos
    // alineados a la misma línea): estas comparaciones usan ±1 px, no la tolerancia de posición del plan.
    const rtol = Math.max(tol, 1);
    for (let i = 1; i < lc.readingOrder.length; i++) {
      const A = rb(lc.readingOrder[i - 1]!), B = rb(lc.readingOrder[i]!);
      if (!A || !B) { f.push({ code: 'NO_RENDER_BOUNDS', severity: 'blocking', nodeIds: [lc.readingOrder[i - 1]!, lc.readingOrder[i]!], message: 'Sin caja de render' }); continue; }
      // B va después de A si empieza debajo de A, o a su derecha sin empezar por encima de A.
      const below = B.y >= A.y + A.height - rtol;
      const right = B.x >= A.x + A.width - rtol && B.y >= A.y - rtol;
      if (!below && !right) f.push({ code: 'READING_ORDER', severity: 'blocking', nodeIds: [lc.readingOrder[i - 1]!, lc.readingOrder[i]!], measured: { a: A, b: B }, message: 'El segundo no queda ni debajo ni a la derecha del primero' });
    }
    if (lc.cta) {
      const C = rb(lc.cta.nodeId), P = rb(lc.cta.copyNodeId);
      if (!C || !P) f.push({ code: 'NO_RENDER_BOUNDS', severity: 'blocking', nodeIds: [lc.cta.nodeId, lc.cta.copyNodeId], message: 'Sin caja de render' });
      else {
        const off = Math.abs((C.x + C.width / 2) - (P.x + P.width / 2));
        const gap = C.y - (P.y + P.height);
        if (off > lc.cta.maxCenterOffsetPx) f.push({ code: 'CTA_NOT_CENTERED_ON_COPY', severity: 'blocking', nodeIds: [lc.cta.nodeId, lc.cta.copyNodeId], measured: off, expected: lc.cta.maxCenterOffsetPx, message: `Centro del CTA a ${off.toFixed(1)} px del centro de su copy` });
        if (gap < lc.cta.minGapPx) f.push({ code: 'CTA_GAP', severity: 'blocking', nodeIds: [lc.cta.nodeId, lc.cta.copyNodeId], measured: gap, expected: lc.cta.minGapPx, message: `Separación vertical ${gap.toFixed(1)} px (comparte franja si es ≤ 0)` });
      }
    }
    results.push(r('layout_order_and_cta', statusOf(f), 'Por cajas de render (±1 px): cada elemento del orden de lectura queda debajo o a la derecha del anterior sin empezar por encima; el CTA centrado bajo su bloque de copy y separado de él sin compartir franja. No evalúa jerarquía visual.', f));
  }
  if (lc.decorationMasks.length > 0) {
    const f: Finding[] = [];
    const frameR: Rect = { x: 0, y: 0, width: c.target.width, height: c.target.height };
    const inter = (p: Rect, q: Rect) => Math.max(0, Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y));
    for (const dm of lc.decorationMasks) {
      const deco = rb(dm.decoratedNodeId);
      const shapes = (mById.get(dm.maskGroupId)?.childIds ?? []);
      if (!deco) { f.push({ code: 'NO_RENDER_BOUNDS', severity: 'blocking', nodeIds: [dm.decoratedNodeId], message: 'La decoración no se renderiza' }); continue; }
      for (const sid of shapes) {
        const cn = pair(sid);
        const box = cn && cRoot ? relRect(cn, cRoot) : null;
        const visArea = box ? inter(box, frameR) : 0;
        const onDeco = box ? inter(box, deco) : 0;
        if (visArea < dm.minShapeAreaPx || onDeco < dm.minShapeAreaPx) {
          f.push({ code: 'MASK_SHAPE_WITHOUT_CONTRIBUTION', severity: 'blocking', nodeIds: [sid], measured: { visArea, onDeco }, expected: dm.minShapeAreaPx, message: 'Forma de máscara degenerada, fuera del frame o lejos de la decoración' });
        }
      }
    }
    results.push(r('decoration_masks', statusOf(f), 'Cada forma de la máscara de decoración tiene superficie dentro del frame y solapa la caja de render de la decoración (por cajas, no por píxeles: la continuidad visual de la cinta la juzga la captura).', f));
  }
  {
    const f: Finding[] = [];
    const frameR: Rect = { x: 0, y: 0, width: c.target.width, height: c.target.height };
    const chain = (id: string): NodeSnapshot[] => { const out: NodeSnapshot[] = []; let p = pair(id); while (p) { out.push(p); p = p.parentId ? cById.get(p.parentId) : undefined; } return out; };
    const opaque = (n: NodeSnapshot) => n.visible && n.opacity === 1 && n.fills !== 'MIXED' && n.fills.some((p) => p.visible && p.type === 'SOLID' && p.opacity === 1 && (p.blendMode === null || p.blendMode === 'NORMAL'));
    for (const id of c.importantNodeIds) {
      const ch = chain(id);
      const cn = ch[0];
      if (!cn) continue;
      const alpha = ch.reduce((acc, n) => acc * (n.visible ? n.opacity : 0), 1);
      if (alpha < 0.99) f.push({ code: 'NOT_FULLY_VISIBLE', severity: 'blocking', nodeIds: [id], measured: alpha, message: 'Oculto o con opacidad acumulada < 1' });
      const own = rb(id);
      if (!own) { f.push({ code: 'NO_RENDER_BOUNDS', severity: 'blocking', nodeIds: [id], message: 'No se renderiza' }); continue; }
      if (!within(own, frameR, tol)) f.push({ code: 'RENDER_CLIPPED', severity: 'blocking', nodeIds: [id], measured: own, message: 'Su render sale del frame' });
      const ancIds = new Set(ch.map((n) => n.id));
      for (const o of clone.nodes) {
        if (o.paintOrder <= cn.paintOrder || ancIds.has(o.id) || !opaque(o)) continue;
        let up: NodeSnapshot | undefined = o; let inside = false;
        while (up) { if (up.id === cn.id) { inside = true; break; } up = up.parentId ? cById.get(up.parentId) : undefined; }
        if (inside) continue;
        const ob = o.absoluteRenderBounds && cRoot?.absoluteBoundingBox ? { x: o.absoluteRenderBounds.x - cRoot.absoluteBoundingBox.x, y: o.absoluteRenderBounds.y - cRoot.absoluteBoundingBox.y, width: o.absoluteRenderBounds.width, height: o.absoluteRenderBounds.height } : null;
        if (ob && Math.min(own.x + own.width, ob.x + ob.width) - Math.max(own.x, ob.x) > tol && Math.min(own.y + own.height, ob.y + ob.height) - Math.max(own.y, ob.y) > tol) {
          f.push({ code: 'COVERED_BY_OPAQUE_NODE', severity: 'blocking', nodeIds: [id, o.id], message: 'Una forma opaca pintada encima solapa su render' });
        }
      }
    }
    results.push(r('effective_visibility', statusOf(f), 'Contenido importante visible (sin ocultar, opacidad acumulada 1), con render dentro del frame y sin formas opacas pintadas encima (por cajas). El contraste y la legibilidad los juzga la captura.', f));
  }

  // 8. Maestra intacta (hash por nodo de la relectura frente a la instantánea del inventario).
  results.push(
    inp.masterDigestsEqual === null
      ? r('master_unchanged', 'not_evaluable', 'No se releyó la maestra.')
      : r('master_unchanged', inp.masterDigestsEqual ? 'pass' : 'fail', 'Hash exacto de cada registro de la maestra releída tras escribir frente al payload del inventario.',
          inp.masterDigestsEqual ? [] : [{ code: 'MASTER_CHANGED', severity: 'blocking', nodeIds: [master.rootNodeId], message: 'La maestra ha cambiado' }]),
  );

  // 9. Revisión visual (captura). Solo puede mantener o empeorar el estado; siempre queda revisión humana.
  results.push(
    inp.visual
      ? r('visual_agent_review', inp.visual.status, 'Inspección visual del agente sobre una captura del clon. No sustituye la revisión de la diseñadora.', inp.visual.findings, 'visual')
      : r('visual_agent_review', 'not_evaluable', 'Sin captura revisada.', [], 'visual'),
  );

  return { results, aggregate: aggregate(results) };
}
