// Encargo de variantes: validación contra la maestra, expansión de plantillas autorizadas, confirmaciones y resumen
// previo a producir. Nada se genera si falta una confirmación o un dato necesario.
//  - blocking: el encargo es inválido tal cual (hay que corregirlo).
//  - pending : falta una decisión o un dato de la persona.
//  - warning : se puede producir; se informa.
// Una incidencia con variantId solo bloquea esa variante; sin variantId, bloquea todo el encargo.
import type { MasterSnapshot, NodeSnapshot } from '../contracts/snapshot.ts';
import type { Decision, VariantField, VariantJob, VariantRow } from '../contracts/variants.ts';
import { hashOf } from '../hash/canonical.ts';
import { commercialSignals, imagePaintIndexes, mentionsTerm, quote, roleLabel } from './discover.ts';

export interface JobIssue {
  code: string;
  severity: 'blocking' | 'pending' | 'warning';
  variantId?: string;
  fieldId?: string;
  message: string;
}

export interface JobCheck {
  issues: JobIssue[];
  /** Variantes que se pueden producir ya (sin incidencias globales ni propias que bloqueen). */
  readyVariantIds: string[];
  ready: boolean;
}

export const fieldsHash = (j: VariantJob): string =>
  hashOf('pcb.variant-fields', { master: j.master, fields: j.fields, kept: j.kept, protected: j.protected, params: j.params, ...(j.translation ? { translation: j.translation } : {}) });
export const variantHash = (v: VariantRow): string => hashOf('pcb.variant-content', v);

/** Registra una confirmación de la persona (campos o contenido de las variantes indicadas). */
export function confirm(j: VariantJob, what: 'fields' | 'content', decision: Decision, variantIds?: string[]): VariantJob {
  if (decision.by !== 'user' && decision.by !== 'project_config') throw new Error('Solo la persona (o la configuración del proyecto) confirma');
  if (what === 'fields') return { ...j, confirmations: { ...j.confirmations, fields: { decision, hash: fieldsHash(j) } } };
  const ids = variantIds?.length ? variantIds : j.variants.map((v) => v.variantId);
  const unknown = ids.filter((id) => !j.variants.some((v) => v.variantId === id));
  if (unknown.length) throw new Error(`Variantes desconocidas: ${unknown.join(', ')}`);
  const prev = j.confirmations.content?.variantHashes ?? {};
  const variantHashes = { ...prev, ...Object.fromEntries(j.variants.filter((v) => ids.includes(v.variantId)).map((v) => [v.variantId, variantHash(v)])) };
  return { ...j, confirmations: { ...j.confirmations, content: { decision, variantHashes } } };
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;
export function expandTemplate(tpl: string, params: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = tpl.replace(PLACEHOLDER, (_m, k: string) => {
    if (params[k] === undefined) { missing.push(k); return `{{${k}}}`; }
    return params[k]!;
  });
  return { text, missing };
}

const BREAKS = new Set([' ', '\n', ' ', ' ']);
/** ¿b es a con otra distribución de saltos de línea? (mismas posiciones; solo espacio ↔ salto). */
export function sameExceptLineBreaks(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(BREAKS.has(a[i]!) && BREAKS.has(b[i]!))) return false;
  return true;
}
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/u;

/** Texto final (caracteres a escribir) y su reparto por tramos de estilo de la maestra. */
export function resolveTextValue(field: VariantField, v: VariantRow, master: NodeSnapshot | undefined): { characters: string; parts: string[] } | { error: string; code: string } {
  const val = v.values[field.fieldId];
  if (!val || val.kind !== 'text') return { code: 'VALUE_MISSING', error: 'sin valor' };
  const segCount = master?.text?.segments.length ?? 1;
  const exp = (s: string) => (val.source === 'template' ? expandTemplate(s, v.params) : { text: s, missing: [] });
  let parts: string[];
  if (field.styleMapping === 'segments') {
    if (!val.parts) return { code: 'VALUE_MISSING', error: `faltan las ${segCount} partes (una por tramo de estilo)` };
    const ex = val.parts.map(exp);
    const miss = ex.flatMap((e) => e.missing);
    if (miss.length) return { code: 'TEMPLATE_UNRESOLVED', error: `plantilla con datos que no tiene la variante: ${[...new Set(miss)].join(', ')}` };
    parts = ex.map((e) => e.text);
    if (parts.length !== segCount) return { code: 'PARTS_MISMATCH', error: `${parts.length} parte(s) para ${segCount} tramo(s) de estilo de la maestra` };
    if (parts.some((p) => p.length === 0)) return { code: 'PART_EMPTY', error: 'una parte vacía eliminaría un tramo de estilo' };
  } else {
    if (val.text === null) return { code: 'VALUE_MISSING', error: 'sin copy' };
    const e = exp(val.text);
    if (e.missing.length) return { code: 'TEMPLATE_UNRESOLVED', error: `plantilla con datos que no tiene la variante: ${[...new Set(e.missing)].join(', ')}` };
    parts = [val.display ?? e.text];
    if (val.display !== null && !sameExceptLineBreaks(e.text, val.display)) return { code: 'DISPLAY_NOT_LINEBREAK_ONLY', error: 'la versión con saltos cambia la redacción, no solo los saltos de línea' };
  }
  const characters = parts.join('');
  if (characters.trim().length === 0) return { code: 'TEXT_EMPTY', error: 'copy vacío' };
  if (CONTROL.test(characters)) return { code: 'TEXT_CONTROL_CHARS', error: 'contiene caracteres de control o invisibles' };
  return { characters, parts };
}

function isMaskedBySilhouette(n: NodeSnapshot, byId: Map<string, NodeSnapshot>): boolean {
  const parent = n.parentId ? byId.get(n.parentId) : undefined;
  const mask = parent?.childIds.map((id) => byId.get(id)!).find((s) => s.isMask && s.paintOrder < n.paintOrder);
  return !!mask && mask.type !== 'RECTANGLE';
}

export function checkVariantJob(j: VariantJob, s: MasterSnapshot): JobCheck {
  const issues: JobIssue[] = [];
  const add = (i: JobIssue) => issues.push(i);
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const root = byId.get(s.rootNodeId);
  const ancestorsOf = (n: NodeSnapshot) => { const out: string[] = []; for (let c = n.parentId; c; c = byId.get(c)?.parentId ?? null) out.push(c); return out; };

  // Maestra y vigencia de la vinculación.
  if (j.master.nodeId !== s.rootNodeId || j.master.fileKey !== s.fileKey) add({ code: 'MASTER_MISMATCH', severity: 'blocking', message: 'El encargo es de otra maestra o de otro archivo' });
  if (root && (root.width !== j.master.width || root.height !== j.master.height)) add({ code: 'MASTER_SIZE_CHANGED', severity: 'blocking', message: `La maestra mide ${root.width}×${root.height}, no ${j.master.width}×${j.master.height}` });
  const masterChanged = j.master.fingerprint !== s.fingerprints.master;

  // Campos.
  const logo = new Set(j.protected.logoNodeIds);
  const seenField = new Set<string>(), seenNode = new Set<string>();
  for (const f of j.fields) {
    const fi = { fieldId: f.fieldId };
    if (seenField.has(f.fieldId)) add({ ...fi, code: 'FIELD_DUPLICATE', severity: 'blocking', message: `Campo repetido: ${f.fieldId}` });
    if (seenNode.has(f.nodeId)) add({ ...fi, code: 'FIELD_NODE_SHARED', severity: 'blocking', message: `Dos campos sobre el mismo elemento (${f.label})` });
    seenField.add(f.fieldId); seenNode.add(f.nodeId);
    const n = byId.get(f.nodeId);
    if (!n) { add({ ...fi, code: 'FIELD_NODE_NOT_FOUND', severity: 'blocking', message: `${f.label}: el elemento vinculado no está en la maestra` }); continue; }
    if (n.id === s.rootNodeId) add({ ...fi, code: 'FIELD_ON_ROOT', severity: 'blocking', message: `${f.label}: no se puede vincular el frame completo` });
    if (logo.has(n.id) || ancestorsOf(n).some((a) => logo.has(a)) || j.protected.logoNodeIds.some((l) => byId.get(l) && ancestorsOf(byId.get(l)!).includes(n.id))) {
      add({ ...fi, code: 'FIELD_ON_LOGO', severity: 'blocking', message: `${f.label}: toca el logo, que no forma parte de esta skill` });
    }
    if (f.kind === 'text') {
      if (!n.text) { add({ ...fi, code: 'FIELD_KIND_MISMATCH', severity: 'blocking', message: `${f.label}: no es un texto editable (¿vectorizado o incrustado en imagen? hace falta un activo editable)` }); continue; }
      if (n.text.characters !== f.masterValue) add({ ...fi, code: 'BINDING_STALE', severity: 'blocking', message: `${f.label}: la maestra ya no dice ${quote(f.masterValue, 50)}; hay que revincular` });
      if (s.environment.nodesWithMissingFont.includes(n.id)) {
        if (!j.translation) add({ ...fi, code: 'FONT_UNAVAILABLE', severity: 'blocking', message: `${f.label}: su fuente no está disponible en este entorno; no se sustituye (comprobar con text-capabilities)` });
        else {
          // Traducción: solo con una fuente sustituta autorizada por la persona para esa variante (copia _PENDIENTE-FUENTE).
          const fonts = n.text.segments.flatMap((g) => (g.fontName ? [`${g.fontName.family}|${g.fontName.style}`] : []));
          for (const v of j.variants) {
            const fb = (j.translation.fontFallbacks[v.variantId] ?? []).filter((x) => fonts.includes(`${x.from.family}|${x.from.style}`));
            add(fb.length
              ? { ...fi, variantId: v.variantId, code: 'FONT_FALLBACK_AUTHORIZED', severity: 'warning', message: `${v.label} · ${f.label}: si la fuente original no carga se usa ${fb.map((x) => `${x.to.family} ${x.to.style} en lugar de ${x.from.family} ${x.from.style}`).join(', ')} (autorizado); la copia queda marcada _PENDIENTE-FUENTE` }
              : { ...fi, variantId: v.variantId, code: 'FONT_UNAVAILABLE', severity: 'blocking', message: `${v.label} · ${f.label}: su fuente no está disponible y no hay una sustituta autorizada (no se sustituye sin autorización)` });
          }
        }
      }
      if (n.text.truncation && n.text.truncation !== 'DISABLED') add({ ...fi, code: 'TRUNCATION_IN_MASTER', severity: 'blocking', message: `${f.label}: la caja trunca el texto; un copy más largo quedaría cortado (decisión de diseño)` });
      if (n.text.segmentFields !== 'full') add({ ...fi, code: 'TEXT_SEGMENTS_INCOMPLETE', severity: 'blocking', message: `${f.label}: no se leyeron todos los estilos del texto; no se puede garantizar conservarlos` });
      const segs = n.text.segments;
      if (f.styleMapping === null) add({ ...fi, code: 'STYLE_MAPPING_MISSING', severity: 'pending', message: `${f.label}: falta decidir cómo se aplica el estilo` });
      else if (f.styleMapping === 'whole' && segs.length > 1) {
        add({ ...fi, code: 'SEGMENTS_AMBIGUOUS', severity: 'blocking', message: `${f.label}: tiene ${segs.length} tramos con estilos distintos (${segs.map((g) => `${quote(g.characters, 24)} ${g.fontName?.style ?? ''} ${g.fontSize ?? ''}`.trim()).join(' + ')}). Propuesta: dar el copy en ${segs.length} partes, una por tramo, para conservar cada estilo` });
      }
      if (!f.textPolicy) add({ ...fi, code: 'TEXT_POLICY_MISSING', severity: 'pending', message: `${f.label}: falta la política si el copy no cabe (strict / reflow / fit_text con mínimo)` });
      else if (f.textPolicy.mode === 'fit_text' && f.isLegal && !f.textPolicy.authorization) add({ ...fi, code: 'LEGAL_FIT_NOT_AUTHORIZED', severity: 'blocking', message: `${f.label}: un legal no se reduce sin autorización explícita` });
      const parent = n.parentId ? byId.get(n.parentId) : undefined;
      if (parent?.layout.mode && parent.layout.mode !== 'NONE') add({ ...fi, code: 'AUTO_LAYOUT_DEPENDENCY', severity: 'warning', message: `${f.label}: está en auto layout; si cambia de tamaño y desplaza otros elementos, la variante se detiene («requiere adaptación de diseño»)` });
    } else {
      const idx = imagePaintIndexes(n);
      const p = Array.isArray(n.fills) && f.paintIndex !== null ? n.fills[f.paintIndex] : undefined;
      if (!p || p.type !== 'IMAGE' || !idx.includes(f.paintIndex!)) { add({ ...fi, code: 'FIELD_KIND_MISMATCH', severity: 'blocking', message: `${f.label}: no tiene una imagen visible en esa capa de relleno` }); continue; }
      if (p.imageHash !== f.masterValue) add({ ...fi, code: 'BINDING_STALE', severity: 'blocking', message: `${f.label}: la imagen de la maestra cambió; hay que revincular` });
      if (!f.imagePolicy) add({ ...fi, code: 'IMAGE_POLICY_MISSING', severity: 'pending', message: `${f.label}: falta el encuadre (mantener recorte / cubrir / punto focal)` });
      if (isMaskedBySilhouette(n, byId) && !f.maskDecision) add({ ...fi, code: 'MASK_REQUIRES_DECISION', severity: 'pending', message: `${f.label}: la imagen está recortada por una máscara con forma; puede no servir para otra foto («requiere adaptación de diseño» o confirmar que es válida)` });
    }
  }
  if (masterChanged && !issues.some((i) => i.code === 'BINDING_STALE')) add({ code: 'MASTER_CHANGED_BINDING_VALID', severity: 'pending', message: 'La maestra cambió desde la vinculación, pero los elementos vinculados siguen iguales: confirma que se puede seguir con la misma vinculación' });
  if (!j.confirmations.fields) add({ code: 'FIELDS_NOT_CONFIRMED', severity: 'pending', message: 'Falta tu confirmación de qué elementos cambian' });
  else if (j.confirmations.fields.hash !== fieldsHash(j)) add({ code: 'FIELDS_CHANGED_AFTER_CONFIRMATION', severity: 'pending', message: 'Los campos cambiaron después de tu confirmación: hay que volver a confirmarlos' });

  // Variantes: una fila = una variante pedida.
  if (j.variants.length === 0) add({ code: 'NO_VARIANTS', severity: 'pending', message: 'Faltan las variantes (combinaciones concretas)' });
  const ids = new Set<string>(), combos = new Map<string, string>();
  for (const v of j.variants) {
    if (ids.has(v.variantId)) add({ variantId: v.variantId, code: 'VARIANT_DUPLICATE_ID', severity: 'blocking', message: `variant_id repetido: ${v.variantId}` });
    ids.add(v.variantId);
    const combo = JSON.stringify(j.params.map((p) => v.params[p.paramId] ?? null));
    if (j.params.length && combos.has(combo)) add({ variantId: v.variantId, code: 'VARIANT_DUPLICATE', severity: 'blocking', message: `Misma combinación que ${combos.get(combo)}` });
    combos.set(combo, v.variantId);
  }
  const textFields = j.fields.filter((f) => f.kind === 'text');
  for (const v of j.variants) {
    const vi = { variantId: v.variantId };
    for (const p of j.params) if (!v.params[p.paramId]?.trim()) add({ ...vi, code: 'PARAM_MISSING', severity: 'pending', message: `${v.label}: falta ${p.label}` });
    for (const k of Object.keys(v.values)) if (!j.fields.some((f) => f.fieldId === k)) add({ ...vi, code: 'VALUE_FOR_UNBOUND_FIELD', severity: 'blocking', message: `${v.label}: hay contenido para ${k}, que no es un campo confirmado` });
    // Valores ajenos: los de otras variantes y los de la maestra que no son de esta variante.
    const foreign: Array<[string, string]> = [];
    for (const p of j.params) {
      const own = v.params[p.paramId] ?? '';
      const others = [j.master.params[p.paramId], ...j.variants.filter((o) => o !== v).map((o) => o.params[p.paramId])];
      for (const val of others) if (val && val !== own && !mentionsTerm(own, val) && !foreign.some(([, x]) => x === val)) foreign.push([p.label, val]);
    }
    for (const f of j.fields) {
      const fi = { ...vi, fieldId: f.fieldId };
      const val = v.values[f.fieldId];
      if (!val) { add({ ...fi, code: 'VALUE_MISSING', severity: 'pending', message: `${v.label} · ${f.label}: falta el contenido` }); continue; }
      if (val.kind !== f.kind) { add({ ...fi, code: 'VALUE_KIND_MISMATCH', severity: 'blocking', message: `${v.label} · ${f.label}: tipo de contenido distinto del campo` }); continue; }
      if (val.kind === 'image') {
        if (!val.asset) add({ ...fi, code: 'ASSET_MISSING', severity: 'pending', message: `${v.label} · ${f.label}: falta la imagen (o su ubicación en Figma)` });
        continue;
      }
      if (val.display !== null && f.textPolicy?.mode !== 'reflow') add({ ...fi, code: 'DISPLAY_REQUIRES_REFLOW', severity: 'blocking', message: `${v.label} · ${f.label}: cambiar los saltos de línea requiere la política reflow` });
      const r = resolveTextValue(f, v, byId.get(f.nodeId));
      if ('error' in r) { add({ ...fi, code: r.code, severity: r.code === 'VALUE_MISSING' ? 'pending' : 'blocking', message: `${v.label} · ${f.label}: ${r.error}` }); continue; }
      for (const [label, val2] of foreign) if (mentionsTerm(r.characters, val2)) add({ ...fi, code: 'VARIANT_DATA_MIXED', severity: 'blocking', message: `${v.label} · ${f.label}: menciona ${quote(val2)} (${label} de otra variante o de la maestra)` });
      if (val.source === 'agent_draft') {
        const own = Object.values(v.params).join(' \u0000 ');
        const unsourced = commercialSignals(r.characters).filter((kind) => !commercialSignals(own).includes(kind));
        if (unsourced.length) add({ ...fi, code: 'COMMERCIAL_CLAIM_UNSOURCED', severity: 'blocking', message: `${v.label} · ${f.label}: el borrador del agente incluye ${unsourced.join(', ')} sin fuente de la persona (no se inventan precios, fechas, URLs…)` });
      }
    }
    // Textos que NO cambian y mencionan un valor de la maestra que no es de esta variante.
    for (const n of s.nodes) {
      if (!n.text || textFields.some((f) => f.nodeId === n.id)) continue;
      for (const [label, val2] of foreign) {
        if (!Object.values(j.master.params).includes(val2) || !mentionsTerm(n.text.characters, val2)) continue;
        const kept = j.kept.some((k) => k.nodeIds.includes(n.id));
        add({ ...vi, code: 'FIXED_TEXT_MENTIONS_MASTER_VALUE', severity: kept ? 'warning' : 'pending', message: `${v.label}: el texto fijo ${quote(n.text.characters, 50)} menciona ${quote(val2)} (${label} de la maestra)${kept ? '; confirmado que se mantiene' : ': ¿debe variar?'}` });
      }
    }
    const h = j.confirmations.content?.variantHashes[v.variantId];
    if (!h) add({ ...vi, code: 'CONTENT_NOT_CONFIRMED', severity: 'pending', message: `${v.label}: falta tu confirmación del contenido` });
    else if (h !== variantHash(v)) add({ ...vi, code: 'CONTENT_CHANGED_AFTER_CONFIRMATION', severity: 'pending', message: `${v.label}: el contenido cambió después de tu confirmación` });
  }

  const stops = (i: JobIssue) => i.severity !== 'warning';
  const globalStop = issues.some((i) => !i.variantId && stops(i));
  const readyVariantIds = globalStop ? [] : j.variants.filter((v) => !issues.some((i) => i.variantId === v.variantId && stops(i))).map((v) => v.variantId);
  return { issues, readyVariantIds, ready: readyVariantIds.length === j.variants.length && j.variants.length > 0 };
}

const POLICY_LABEL = (f: VariantField): string => {
  if (f.kind === 'image') {
    const p = f.imagePolicy;
    return !p ? 'sin definir' : p.mode === 'keep_crop' ? 'mantener recorte' : p.mode === 'fill' ? 'cubrir el contenedor (centrado)' : p.mode === 'frame_window' ? `cubrir la parte visible del frame (punto focal ${p.x}, ${p.y})` : `cubrir con punto focal (${p.x}, ${p.y})`;
  }
  const p = f.textPolicy;
  return !p ? 'sin definir' : p.mode === 'strict' ? 'strict (misma caja; si no cabe, se avisa)' : p.mode === 'reflow' ? `reflow (mismas líneas de ancho${p.maxHeightPx ? `, alto máx. ${p.maxHeightPx}px` : ''})` : `fit_text (cuerpo hasta ×${p.minScale})`;
};

/** Resumen para confirmar antes de producir: variante, copies finales, imagen, qué se mantiene y qué falta. */
export function renderJobSummary(j: VariantJob, s: MasterSnapshot, chk: JobCheck): string {
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const cell = (x: string) => x.replace(/\|/g, '\\|');
  const out = [
    `# Resumen antes de producir — ${quote(j.master.name)} (${j.master.width}×${j.master.height})`, '',
    `Encargo: ${quote(j.request, 200)}`, '',
    `Se genera **una pieza por fila** (${j.variants.length}), cada una desde la maestra, del mismo tamaño y con la misma organización.`, '',
    `| Variante | ${j.fields.map((f) => cell(f.label)).join(' | ')} | Estado |`,
    `|---|${j.fields.map(() => '---').join('|')}|---|`,
  ];
  for (const v of j.variants) {
    const cells = j.fields.map((f) => {
      const val = v.values[f.fieldId];
      if (!val) return '⚠ falta';
      if (val.kind === 'image') return val.asset ? cell(`${val.asset.label}${val.source === 'agent_suggested' ? ' (propuesta)' : ''}`) : '⚠ falta';
      const r = resolveTextValue(f, v, byId.get(f.nodeId));
      return 'error' in r ? `⚠ ${cell(r.error)}` : cell(`${quote(r.characters, 70)}${val.source === 'agent_draft' ? ' (borrador)' : ''}`);
    });
    const own = chk.issues.filter((i) => i.variantId === v.variantId && i.severity !== 'warning');
    out.push(`| ${cell(v.label)} | ${cells.join(' | ')} | ${chk.readyVariantIds.includes(v.variantId) ? 'lista' : own.length ? `pendiente (${own.length})` : 'pendiente (global)'} |`);
  }
  out.push('', '**Se mantiene:** ' + (j.kept.length ? j.kept.map((k) => k.label).join(', ') : '—') + '; logo intacto; resto de la pieza sin cambios.', '');
  out.push('**Cómo se trata cada campo:**', '', ...j.fields.map((f) => `- ${f.label} (${roleLabel(f.role ?? f.kind)}): ${POLICY_LABEL(f)}`), '');
  const glob = chk.issues.filter((i) => !i.variantId);
  const per = chk.issues.filter((i) => i.variantId);
  if (chk.issues.length) {
    out.push('## Pendiente o a revisar', '');
    for (const i of [...glob, ...per]) out.push(`- ${i.severity === 'blocking' ? '⛔' : i.severity === 'pending' ? '❓' : 'ℹ'} ${i.message}`);
    out.push('');
  }
  out.push(chk.ready ? '¿Confirmas estas variantes tal cual? Con tu confirmación genero todas.' : 'Resuelve lo pendiente y lo vuelvo a presentar (no repetiré lo ya confirmado).', '');
  return out.join('\n');
}
