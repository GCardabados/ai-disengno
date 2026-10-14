// Validación de una variante sobre la RELECTURA de su clon (no sobre lo que dice el script). Cada comprobación declara
// qué demuestra y qué no. La revisión visual solo puede empeorar el estado; la del agente no es aprobación humana.
import type { MasterSnapshot, NodeSnapshot, Paint, TextSegment } from '../contracts/snapshot.ts';
import type { Rect } from '../contracts/geometry.ts';
import { aggregate, type Aggregate, type CheckStatus, type Finding, type ValidationResult } from '../contracts/validation.ts';
import { canonicalize } from '../hash/canonical.ts';
import { contentProjection } from '../hash/fingerprint.ts';
import { relRect } from '../demo/plan.ts';
import { textStyleMismatch } from '../demo/check.ts';
import { mentionsTerm } from './discover.ts';
import type { ImageOp, TextOp, VariantPlan, VariantPlanEntry } from './plan.ts';

export const VARIANT_CHECK_VERSION = '1';

/** Correspondencia maestra → clon por recorrido paralelo (mismos tipos, nombres y número de hijos). */
export function pairTrees(master: MasterSnapshot, clone: MasterSnapshot): { idMap: Array<[string, string]> } | { error: string } {
  const m = new Map(master.nodes.map((n) => [n.id, n]));
  const c = new Map(clone.nodes.map((n) => [n.id, n]));
  const idMap: Array<[string, string]> = [];
  const walk = (a: NodeSnapshot, b: NodeSnapshot, isRoot: boolean): string | null => {
    if (a.type !== b.type || (!isRoot && a.name !== b.name)) return `distinto tipo o nombre en ${a.id} / ${b.id}`;
    if (a.childIds.length !== b.childIds.length) return `distinto número de hijos en ${a.id} / ${b.id}`;
    idMap.push([a.id, b.id]);
    for (let i = 0; i < a.childIds.length; i++) {
      const e = walk(m.get(a.childIds[i]!)!, c.get(b.childIds[i]!)!, false);
      if (e) return e;
    }
    return null;
  };
  const e = walk(m.get(master.rootNodeId)!, c.get(clone.rootNodeId)!, true);
  return e ? { error: e } : { idMap };
}

/** Segmentos esperados: el tramo i de la maestra con el texto de la parte i y su cuerpo × k. */
export function expectedVariantSegments(master: TextSegment[], parts: string[], k: number): TextSegment[] {
  let pos = 0;
  return master.map((g, i) => {
    const t = parts[i]!;
    const lh = g.lineHeight as { unit?: string; value?: number } | null;
    const ls = g.letterSpacing as { unit?: string; value?: number } | null;
    const seg: TextSegment = {
      ...g, start: pos, end: pos + t.length, characters: t,
      fontSize: typeof g.fontSize === 'number' ? g.fontSize * k : g.fontSize,
      lineHeight: lh && lh.unit === 'PIXELS' && typeof lh.value === 'number' ? { ...lh, value: lh.value * k } : g.lineHeight,
      letterSpacing: ls && ls.unit === 'PIXELS' && typeof ls.value === 'number' ? { ...ls, value: ls.value * k } : g.letterSpacing,
    };
    pos += t.length;
    return seg;
  });
}

function paintWithout(p: Paint, keys: string[]): unknown {
  const raw = { ...(p.raw as Record<string, unknown>) };
  for (const k of keys) delete raw[k];
  const { raw: _r, ...rest } = p;
  const norm: Record<string, unknown> = { ...rest };
  for (const k of keys) delete norm[k];
  return { ...norm, raw };
}

export interface VariantCheckInput {
  master: MasterSnapshot;
  clone: MasterSnapshot;
  plan: VariantPlan;
  entry: VariantPlanEntry;
  tolerancePx: number;
  masterDigestsEqual: boolean | null;
  visual: { status: CheckStatus; findings: Finding[] } | null;
}

export interface VariantCheckReport {
  variantId: string;
  cloneId: string;
  results: ValidationResult[];
  aggregate: Aggregate;
}

export function checkVariant(inp: VariantCheckInput): VariantCheckReport {
  const { master, clone, entry, plan, tolerancePx: tol } = inp;
  const results: ValidationResult[] = [];
  const r = (id: string, status: CheckStatus, coverage: string, findings: Finding[] = [], kind: 'deterministic' | 'visual' = 'deterministic'): ValidationResult =>
    ({ validatorId: id, validatorVersion: VARIANT_CHECK_VERSION, destinationId: `variant:${entry.variantId}`, kind, status, findings, coverage });
  const statusOf = (f: Finding[]): CheckStatus => (f.some((x) => x.severity === 'blocking') ? 'fail' : f.length ? 'needs_review' : 'pass');
  const mById = new Map(master.nodes.map((n) => [n.id, n]));
  const cById = new Map(clone.nodes.map((n) => [n.id, n]));
  const mRoot = mById.get(master.rootNodeId)!, cRoot = cById.get(clone.rootNodeId)!;

  // 1. Tamaño del frame.
  {
    const f: Finding[] = [];
    if (cRoot.width !== mRoot.width || cRoot.height !== mRoot.height) f.push({ code: 'SIZE_CHANGED', severity: 'blocking', nodeIds: [cRoot.id], measured: [cRoot.width, cRoot.height], expected: [mRoot.width, mRoot.height], message: 'El frame no mide lo mismo que la maestra' });
    if (cRoot.clipsContent !== mRoot.clipsContent) f.push({ code: 'CLIP_CHANGED', severity: 'blocking', nodeIds: [cRoot.id], message: 'Cambió el recorte del frame' });
    results.push(r('variant_dimensions', statusOf(f), 'Ancho, alto y recorte del frame iguales a los de la maestra.', f));
  }

  // 2. Estructura.
  const paired = pairTrees(master, clone);
  if ('error' in paired) {
    results.push(r('variant_structure', 'fail', 'Mismo árbol que la maestra (tipos, nombres, hijos).', [{ code: 'STRUCTURE_CHANGED', severity: 'blocking', nodeIds: [], message: paired.error }]));
    return { variantId: entry.variantId, cloneId: clone.rootNodeId, results, aggregate: aggregate(results) };
  }
  results.push(r('variant_structure', 'pass', 'Mismo árbol que la maestra (tipos, nombres, número y orden de hijos): nada añadido, eliminado ni sustituido.'));
  const toClone = new Map(paired.idMap);
  const pair = (id: string) => cById.get(toClone.get(id)!)!;
  const textOps = new Map(entry.ops.filter((o): o is TextOp => o.kind === 'text').map((o) => [o.nodeId, o]));
  const imageOps = new Map(entry.ops.filter((o): o is ImageOp => o.kind === 'image').map((o) => [o.nodeId, o]));
  const descendantsOf = (ids: string[]) => {
    const out = new Set(ids);
    for (const n of master.nodes) for (let p = n.parentId; p; p = mById.get(p)?.parentId ?? null) if (ids.includes(p)) out.add(n.id);
    return out;
  };
  const logo = descendantsOf(plan.logoNodeIds);
  const derivedGroups = new Set<string>();
  for (const id of textOps.keys()) for (let p = mById.get(id)!.parentId; p && p !== mRoot.id && mById.get(p)!.type === 'GROUP'; p = mById.get(p)!.parentId) derivedGroups.add(p);
  const scaleOf = new Map<string, number>();

  // 3. Solo cambiaron los elementos autorizados, y con el contenido confirmado.
  {
    const f: Finding[] = [];
    for (const [mid] of paired.idMap) {
      const m = mById.get(mid)!, c = pair(mid);
      const t = textOps.get(mid), im = imageOps.get(mid);
      if (t) {
        if (c.text?.characters !== t.characters) { f.push({ code: 'TEXT_NOT_CONFIRMED_COPY', severity: 'blocking', nodeIds: [mid, c.id], measured: c.text?.characters, expected: t.characters, message: 'El texto no es el copy confirmado' }); continue; }
        const m0 = m.text!.segments[0]?.fontSize, c0 = c.text.segments[0]?.fontSize;
        const k = typeof m0 === 'number' && typeof c0 === 'number' && m0 > 0 ? c0 / m0 : 1;
        scaleOf.set(mid, k);
        if (t.policy.mode !== 'fit_text' && Math.abs(k - 1) > 1e-3) f.push({ code: 'FONT_SIZE_CHANGED', severity: 'blocking', nodeIds: [mid, c.id], measured: k, message: 'El cuerpo cambió sin política fit_text' });
        if (t.policy.mode === 'fit_text' && k < t.policy.minScale - 1e-3) f.push({ code: 'BELOW_AUTHORIZED_MIN', severity: 'blocking', nodeIds: [mid, c.id], measured: k, expected: t.policy.minScale, message: 'Cuerpo por debajo del mínimo autorizado' });
        const bad = textStyleMismatch(expectedVariantSegments(m.text!.segments, t.parts, k), c.text.segments);
        if (bad !== null) f.push({ code: 'TEXT_STYLE_CHANGED', severity: 'blocking', nodeIds: [mid, c.id], measured: bad, message: `El estilo no se conservó por tramos (primer carácter distinto: ${bad})` });
        const strip = (n: NodeSnapshot) => canonicalize({ ...contentProjection(n), text: null });
        if (strip(m) !== strip(c)) f.push({ code: 'UNAUTHORIZED_CHANGE', severity: 'blocking', nodeIds: [mid, c.id], message: 'Cambió algo del texto además del copy (relleno, efectos, opacidad…)' });
        continue;
      }
      if (im) {
        const mf = Array.isArray(m.fills) ? m.fills : [], cf = Array.isArray(c.fills) ? c.fills : [];
        const tp = cf[im.paintIndex];
        if (mf.length !== cf.length || !tp || tp.imageHash !== im.targetHash) { f.push({ code: 'IMAGE_NOT_CONFIRMED_ASSET', severity: 'blocking', nodeIds: [mid, c.id], measured: tp?.imageHash ?? null, expected: im.targetHash, message: 'La imagen no es el activo confirmado' }); continue; }
        const keys = im.policy.mode === 'keep_crop' ? ['imageHash'] : ['imageHash', 'scaleMode', 'imageTransform', 'scalingFactor'];
        for (let i = 0; i < mf.length; i++) {
          const same = i === im.paintIndex ? canonicalize(paintWithout(mf[i]!, keys)) === canonicalize(paintWithout(cf[i]!, keys)) : canonicalize(mf[i]) === canonicalize(cf[i]);
          if (!same) f.push({ code: 'IMAGE_PAINT_CHANGED', severity: 'blocking', nodeIds: [mid, c.id], measured: i, message: i === im.paintIndex ? 'Cambió algo de la pintura además de la imagen y su encaje' : 'Cambió otra capa de relleno' });
        }
        const want = im.policy.mode === 'fill' ? 'FILL' : im.policy.mode === 'focal_point' ? 'CROP' : mf[im.paintIndex]!.scaleMode;
        if (tp.scaleMode !== want) f.push({ code: 'IMAGE_SCALEMODE', severity: 'blocking', nodeIds: [mid, c.id], measured: tp.scaleMode, expected: want, message: 'Encaje distinto de la política confirmada' });
        const strip = (n: NodeSnapshot) => canonicalize({ ...contentProjection(n), fills: null });
        if (strip(m) !== strip(c)) f.push({ code: 'UNAUTHORIZED_CHANGE', severity: 'blocking', nodeIds: [mid, c.id], message: 'Cambió algo de la imagen además del relleno (efectos, opacidad, máscara…)' });
        continue;
      }
      if (canonicalize(contentProjection(m)) !== canonicalize(contentProjection(c))) f.push({ code: 'UNAUTHORIZED_CHANGE', severity: 'blocking', nodeIds: [mid, c.id], message: `Cambió un elemento no autorizado${logo.has(mid) ? ' (logo)' : ''}` });
    }
    results.push(r('authorized_changes_only', statusOf(f), 'Contenido de cada nodo (sin ids) igual al de la maestra salvo los vinculados; textos vinculados = copy confirmado con el estilo de cada tramo; imágenes = activo confirmado con el encaje de la política y el resto de pinturas, efectos y superposiciones intactos.', f));
  }

  // 4. Organización: posiciones y tamaños conservados.
  {
    const f: Finding[] = [];
    for (const [mid] of paired.idMap) {
      if (mid === mRoot.id || derivedGroups.has(mid)) continue;
      const m = mById.get(mid)!, c = pair(mid);
      const a = relRect(m, mRoot), b = relRect(c, cRoot);
      if (!a || !b) continue;
      const t = textOps.get(mid);
      const lin = (n: NodeSnapshot) => (n.relativeTransform ? [n.relativeTransform[0][0], n.relativeTransform[0][1], n.relativeTransform[1][0], n.relativeTransform[1][1]] : null);
      if (JSON.stringify(lin(m)) !== JSON.stringify(lin(c))) f.push({ code: 'TRANSFORM_CHANGED', severity: 'blocking', nodeIds: [mid, c.id], message: 'Cambió la rotación/escala del elemento' });
      if (!t) {
        if ([a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].some((d) => Math.abs(d) > tol)) f.push({ code: logo.has(mid) ? 'LOGO_MOVED_OR_RESIZED' : 'LAYOUT_SHIFT', severity: 'blocking', nodeIds: [mid, c.id], measured: b, expected: a, message: logo.has(mid) ? 'El logo cambió de posición o tamaño' : 'Un elemento se desplazó o cambió de tamaño (¿auto layout/constraints?): requiere adaptación de diseño' });
        continue;
      }
      const limitH = t.policy.mode === 'reflow' && t.policy.maxHeightPx ? t.policy.maxHeightPx : a.height;
      const auto = m.text?.autoResize;
      const reflowed = t.policy.mode === 'reflow' && auto === 'WIDTH_AND_HEIGHT' && c.text?.autoResize === 'HEIGHT';
      if (Math.abs(a.y - b.y) > tol) f.push({ code: 'TEXT_MOVED', severity: 'blocking', nodeIds: [mid, c.id], measured: b, expected: a, message: 'El texto cambió de posición vertical' });
      if (auto === 'WIDTH_AND_HEIGHT' && !reflowed) {
        const al = m.text?.alignHorizontal;
        const anchor = (q: Rect) => (al === 'CENTER' ? q.x + q.width / 2 : al === 'RIGHT' ? q.x + q.width : q.x);
        if (Math.abs(anchor(a) - anchor(b)) > tol + 0.01) f.push({ code: 'TEXT_ANCHOR_MOVED', severity: 'blocking', nodeIds: [mid, c.id], measured: anchor(b), expected: anchor(a), message: 'El texto de ancho automático perdió su anclaje (alineación)' });
        if (b.width > a.width + 0.5) f.push({ code: 'TEXT_WIDER_THAN_MASTER', severity: 'blocking', nodeIds: [mid, c.id], measured: b.width, expected: a.width, message: 'El texto ocupa más ancho que en la maestra' });
      } else {
        if (Math.abs(a.x - b.x) > tol || Math.abs(a.width - b.width) > tol) f.push({ code: 'TEXT_BOX_CHANGED', severity: 'blocking', nodeIds: [mid, c.id], measured: b, expected: a, message: 'Cambió la posición horizontal o el ancho de la caja' });
      }
      if (b.height > limitH + 0.5) f.push({ code: 'TEXT_TALLER_THAN_ALLOWED', severity: 'blocking', nodeIds: [mid, c.id], measured: b.height, expected: limitH, message: 'El texto es más alto de lo permitido' });
    }
    results.push(r('layout_preserved', statusOf(f), `Posición y tamaño de cada elemento igual a la maestra (±${tol} px), transformaciones idénticas; los textos vinculados conservan su caja o su anclaje y no superan el alto permitido.`, f));
  }

  // 5. Logo intacto (contenido y geometría de todo su bloque).
  {
    const f: Finding[] = [];
    if (plan.logoNodeIds.length === 0) results.push(r('logo_intact', 'not_evaluable', 'No se declaró el logo en el encargo.'));
    else {
      for (const id of logo) {
        const m = mById.get(id), c = toClone.get(id) ? pair(id) : undefined;
        if (!m || !c) { f.push({ code: 'LOGO_NODE_MISSING', severity: 'blocking', nodeIds: [id], message: 'Falta un nodo del logo' }); continue; }
        const a = relRect(m, mRoot), b = relRect(c, cRoot);
        if (canonicalize(contentProjection(m)) !== canonicalize(contentProjection(c)) || !a || !b || [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].some((d) => Math.abs(d) > tol)) {
          f.push({ code: 'LOGO_CHANGED', severity: 'blocking', nodeIds: [id, c.id], message: 'El logo cambió (contenido, tamaño, proporción o posición)' });
        }
      }
      results.push(r('logo_intact', statusOf(f), 'Todos los nodos del logo con el mismo contenido, tamaño y posición que en la maestra.', f));
    }
  }

  // 6. Texto: desbordamiento, truncado, mínimo autorizado y solapes nuevos.
  {
    const f: Finding[] = [];
    const over = (n: NodeSnapshot) => {
      const b = n.absoluteBoundingBox, q = n.absoluteRenderBounds;
      return b && q ? Math.max(b.x - q.x, b.y - q.y, q.x + q.width - (b.x + b.width), q.y + q.height - (b.y + b.height)) : null;
    };
    const rb = (n: NodeSnapshot, root: NodeSnapshot): Rect | null => (n.absoluteRenderBounds && root.absoluteBoundingBox ? { x: n.absoluteRenderBounds.x - root.absoluteBoundingBox.x, y: n.absoluteRenderBounds.y - root.absoluteBoundingBox.y, width: n.absoluteRenderBounds.width, height: n.absoluteRenderBounds.height } : null);
    const hit = (p: Rect | null, q: Rect | null) => !!p && !!q && Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x) > 1 && Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y) > 1;
    for (const [mid, t] of textOps) {
      const m = mById.get(mid)!, c = pair(mid);
      const om = over(m), oc = over(c), k = scaleOf.get(mid) ?? 1;
      if (oc === null) f.push({ code: 'TEXT_NOT_RENDERED', severity: 'blocking', nodeIds: [mid, c.id], message: 'Sin render: no se puede comprobar el desbordamiento' });
      else if (oc - Math.max(0, om ?? 0) * k > 1) f.push({ code: 'TEXT_OVERFLOW', severity: 'blocking', nodeIds: [mid, c.id], measured: oc, message: `El texto se sale ${oc.toFixed(1)} px de su caja` });
      if (c.text?.truncation && c.text.truncation !== 'DISABLED') f.push({ code: 'TEXT_TRUNCATION', severity: 'blocking', nodeIds: [mid, c.id], message: 'El texto puede quedar truncado' });
      if (/…|\.\.\.$/.test(c.text?.characters ?? '') && !/…|\.\.\.$/.test(t.characters)) f.push({ code: 'TEXT_ELLIPSIS', severity: 'blocking', nodeIds: [mid, c.id], message: 'Aparece una elipsis que no está en el copy confirmado' });
      if (t.policy.mode === 'fit_text' && k < 1) f.push({ code: 'TEXT_REDUCED', severity: 'warning', nodeIds: [mid, c.id], measured: k, expected: `≥ ${t.policy.minScale}`, message: `Cuerpo reducido ×${k.toFixed(3)} (dentro del mínimo autorizado): revisar legibilidad` });
      for (const n of master.nodes) {
        if (!n.text || n.id === mid) continue;
        if (hit(rb(c, cRoot), rb(pair(n.id), cRoot)) && !hit(rb(m, mRoot), rb(n, mRoot))) f.push({ code: 'TEXT_RENDER_OVERLAP', severity: 'blocking', nodeIds: [mid, n.id], message: 'El texto se solapa con otro (no ocurría en la maestra)' });
      }
    }
    results.push(r('text_fit', statusOf(f), 'Render de cada texto vinculado dentro de su caja (descontando lo que ya sobresalía en la maestra, ±1 px), sin truncado ni elipsis, cuerpo ≥ mínimo autorizado y sin solapes nuevos entre textos. Legibilidad y contraste: captura y revisión humana.', f));
  }

  // 7. Zona segura (solo si el encargo la declara).
  if (plan.safeArea) {
    const f: Finding[] = [];
    const sa = plan.safeArea;
    const inside = (q: Rect) => q.x >= sa.x - tol && q.y >= sa.y - tol && q.x + q.width <= sa.x + sa.width + tol && q.y + q.height <= sa.y + sa.height + tol;
    for (const mid of textOps.keys()) {
      const c = pair(mid), m = mById.get(mid)!;
      const b = c.absoluteRenderBounds && cRoot.absoluteBoundingBox ? { x: c.absoluteRenderBounds.x - cRoot.absoluteBoundingBox.x, y: c.absoluteRenderBounds.y - cRoot.absoluteBoundingBox.y, width: c.absoluteRenderBounds.width, height: c.absoluteRenderBounds.height } : relRect(c, cRoot);
      const a = relRect(m, mRoot);
      if (b && !inside(b)) f.push({ code: a && !inside(a) ? 'OUTSIDE_SAFE_ZONE_IN_MASTER' : 'OUTSIDE_SAFE_ZONE', severity: a && !inside(a) ? 'warning' : 'blocking', nodeIds: [mid, c.id], message: a && !inside(a) ? 'Fuera de la zona segura (ya lo estaba en la maestra)' : 'El texto sale de la zona segura' });
    }
    results.push(r('safe_zone', statusOf(f), 'Render de los textos vinculados dentro de la zona segura declarada en el encargo.', f));
  }

  // 8. Sin mezcla de datos entre variantes.
  {
    const f: Finding[] = [];
    const foreign = plan.foreignValues[entry.variantId] ?? [];
    for (const n of clone.nodes) {
      if (!n.text) continue;
      const mid = paired.idMap.find(([, cid]) => cid === n.id)?.[0];
      for (const val of foreign) {
        if (!mentionsTerm(n.text.characters, val)) continue;
        const bound = !!mid && textOps.has(mid);
        f.push({ code: bound ? 'VARIANT_DATA_MIXED' : 'FOREIGN_VALUE_IN_FIXED_TEXT', severity: bound ? 'blocking' : 'warning', nodeIds: [n.id], measured: val, message: bound ? `Un texto de la variante menciona «${val}», que es de otra variante o de la maestra` : `Un texto fijo menciona «${val}» (no es de esta variante): confirmar que debe mantenerse` });
      }
    }
    results.push(r('variant_data_isolation', statusOf(f), 'Ningún texto de la pieza menciona datos clave (parámetros) de otra variante o de la maestra que no sean de esta variante.', f));
  }

  // 9. Maestra intacta.
  results.push(inp.masterDigestsEqual === null
    ? r('master_unchanged', 'not_evaluable', 'No se releyó la maestra.')
    : r('master_unchanged', inp.masterDigestsEqual ? 'pass' : 'fail', 'Hash exacto de cada registro de la maestra releída tras escribir frente al inventario.', inp.masterDigestsEqual ? [] : [{ code: 'MASTER_CHANGED', severity: 'blocking', nodeIds: [master.rootNodeId], message: 'La maestra ha cambiado' }]));

  // 10. Revisión visual del agente (encuadre, sujeto, rostros, contraste, máscara). Nunca es aprobación humana.
  results.push(inp.visual
    ? r('visual_agent_review', inp.visual.status, 'Inspección visual del agente sobre la captura: encuadre, sujeto no cortado, rostros, contraste con el copy, máscaras y consistencia entre variantes. No sustituye la revisión humana.', inp.visual.findings, 'visual')
    : r('visual_agent_review', 'not_evaluable', 'Sin captura revisada.', [], 'visual'));

  return { variantId: entry.variantId, cloneId: clone.rootNodeId, results, aggregate: aggregate(results) };
}
