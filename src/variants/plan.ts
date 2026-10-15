// Plan exacto por variante: qué nodos se escriben y con qué. Solo entran las variantes listas (encargo confirmado)
// cuyos activos se comprobaron en Figma; el resto queda bloqueado con su motivo y no impide las demás.
import type { MasterSnapshot } from '../contracts/snapshot.ts';
import type { Rect } from '../contracts/geometry.ts';
import type { AssetRef, FontName, VariantAssetsRead, VariantImagePolicy, VariantJob, VariantTextPolicy } from '../contracts/variants.ts';
import { checkVariantJob, resolveTextValue, type JobCheck } from './job.ts';
import { quote } from './discover.ts';

export const VARIANT_PLAN_SCHEMA_ID = 'pcb.variant-plan.v1';

export interface TextOp {
  kind: 'text';
  fieldId: string;
  nodeId: string;
  masterCharacters: string;
  /** Tramos de estilo de la maestra; parts[i] sustituye al tramo i heredando su estilo. */
  segments: Array<{ start: number; end: number }>;
  parts: string[];
  characters: string;
  policy: VariantTextPolicy;
  isLegal: boolean;
  /** Solo traducciones: sustitutas autorizadas para fuentes de este texto (se aplican solo si la original no carga). */
  fontFallbacks?: Array<{ from: FontName; to: FontName }>;
}
export interface ImageOp {
  kind: 'image';
  fieldId: string;
  nodeId: string;
  paintIndex: number;
  masterHash: string;
  asset: AssetRef;
  /** Hash de la imagen comprobado en Figma (variant-assets-request). */
  targetHash: string;
  policy: VariantImagePolicy;
  /** Solo frame_window: parte visible del contenedor dentro del frame, en unidades del contenedor (0..1) y en px. */
  window: { u0: number; v0: number; uw: number; vh: number; width: number; height: number } | null;
}
export type VariantOp = TextOp | ImageOp;

export interface VariantPlanEntry {
  variantId: string;
  label: string;
  cloneName: string;
  params: Record<string, string>;
  status: 'ready' | 'blocked';
  blockers: string[];
  warnings: string[];
  ops: VariantOp[];
}

export interface VariantPlan {
  schema: typeof VARIANT_PLAN_SCHEMA_ID;
  source: MasterSnapshot['source'];
  master: { fileKey: string; nodeId: string; name: string; width: number; height: number; fingerprint: string };
  sectionName: string;
  logoNodeIds: string[];
  safeArea: Rect | null;
  /** Textos vinculados y sus valores ajenos (otras variantes / maestra): para detectar mezclas en la relectura. */
  foreignValues: Record<string, string[]>;
  variants: VariantPlanEntry[];
}

export const cloneNameOf = (j: VariantJob, variantId: string): string =>
  j.output.cloneNamePattern.replace('{master}', j.master.name).replace('{variant}', variantId).replace('{VARIANT}', variantId.toUpperCase());

const aspect = (w: number, h: number) => w / h;

export function buildVariantPlan(j: VariantJob, s: MasterSnapshot, assets: VariantAssetsRead | null): { plan: VariantPlan; check: JobCheck } {
  const chk = checkVariantJob(j, s);
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const assetNode = new Map((assets?.nodes ?? []).map((n) => [n.nodeId, n]));
  const assetHash = new Map((assets?.hashes ?? []).map((h) => [h.hash, h]));
  const usedAssets = new Map<string, string[]>();
  const variants: VariantPlanEntry[] = [];
  const foreignValues: Record<string, string[]> = {};

  for (const v of j.variants) {
    const blockers: string[] = [], warnings: string[] = [], ops: VariantOp[] = [];
    const own = chk.issues.filter((i) => (i.variantId === v.variantId || !i.variantId));
    for (const i of own) (i.severity === 'warning' ? warnings : blockers).push(`${i.code}: ${i.message}`);
    const ready = chk.readyVariantIds.includes(v.variantId);
    foreignValues[v.variantId] = [...new Set(j.params.flatMap((p) => [j.master.params[p.paramId], ...j.variants.filter((o) => o !== v).map((o) => o.params[p.paramId])]
      .filter((x): x is string => !!x && x !== v.params[p.paramId])))];
    if (ready) {
      for (const f of j.fields) {
        const n = byId.get(f.nodeId)!;
        const val = v.values[f.fieldId]!;
        if (f.kind === 'text' && val.kind === 'text') {
          const r = resolveTextValue(f, v, n);
          if ('error' in r) { blockers.push(`${r.code}: ${f.label}: ${r.error}`); continue; }
          const fonts = new Set(n.text!.segments.flatMap((g) => (g.fontName ? [`${g.fontName.family}|${g.fontName.style}`] : [])));
          const fb = (j.translation?.fontFallbacks[v.variantId] ?? []).filter((x) => fonts.has(`${x.from.family}|${x.from.style}`)).map((x) => ({ from: x.from, to: x.to }));
          ops.push({ kind: 'text', fieldId: f.fieldId, nodeId: f.nodeId, masterCharacters: n.text!.characters, segments: n.text!.segments.map((g) => ({ start: g.start, end: g.end })), parts: r.parts, characters: r.characters, policy: f.textPolicy!, isLegal: f.isLegal, ...(fb.length ? { fontFallbacks: fb } : {}) });
        } else if (f.kind === 'image' && val.kind === 'image' && val.asset) {
          const a = val.asset;
          if (!assets) { blockers.push(`ASSETS_NOT_VERIFIED: ${f.label}: falta comprobar en Figma el acceso y las dimensiones de ${quote(a.label)} (variant-assets-request)`); continue; }
          let target: { hash: string | null; width: number | null; height: number | null } | null = null;
          if (a.kind === 'figma_node') {
            const an = assetNode.get(a.nodeId);
            const img = an?.images.find((im) => im.visible && im.hash);
            if (!an?.found) { blockers.push(`ASSET_UNAVAILABLE: ${f.label}: ${quote(a.label)} no se encuentra en el archivo`); continue; }
            if (!img) { blockers.push(`ASSET_NOT_IMAGE: ${f.label}: ${quote(a.label)} no contiene una imagen`); continue; }
            target = img;
          } else {
            const h = assetHash.get(a.hash);
            if (!h?.found) { blockers.push(`ASSET_UNAVAILABLE: ${f.label}: la imagen ${quote(a.label)} no está en el archivo`); continue; }
            target = { hash: a.hash, width: h.width, height: h.height };
          }
          if (!target.width || !target.height) { blockers.push(`ASSET_SIZE_UNKNOWN: ${f.label}: no se pudieron leer las dimensiones de ${quote(a.label)}`); continue; }
          const masterImg = assetNode.get(f.nodeId)?.images.find((im) => im.paintIndex === f.paintIndex);
          const nw = n.width ?? 0, nh = n.height ?? 0;
          if (f.imagePolicy!.mode === 'keep_crop') {
            if (!masterImg?.width || !masterImg.height) { blockers.push(`MASTER_IMAGE_SIZE_UNKNOWN: ${f.label}: para mantener el recorte hace falta la proporción de la imagen de la maestra`); continue; }
            const d = Math.abs(aspect(target.width, target.height) / aspect(masterImg.width, masterImg.height) - 1);
            if (d > 0.01) { blockers.push(`ASSET_ASPECT_MISMATCH: ${f.label}: ${quote(a.label)} tiene otra proporción (${target.width}×${target.height} frente a ${masterImg.width}×${masterImg.height}); mantener el recorte la deformaría o la cortaría distinto. Propuesta: «cubrir» o «punto focal»`); continue; }
          }
          let window: ImageOp['window'] = null;
          if (f.imagePolicy!.mode === 'frame_window') {
            const nb = n.absoluteBoundingBox, fb = byId.get(j.master.nodeId)?.absoluteBoundingBox;
            if (!nb || !fb || (n.rotation ?? 0) !== 0 || !nw || !nh) { blockers.push(`FRAME_WINDOW_UNAVAILABLE: ${f.label}: no se puede calcular la parte visible (caja desconocida o capa girada)`); continue; }
            const x0 = Math.max(nb.x, fb.x), y0 = Math.max(nb.y, fb.y), x1 = Math.min(nb.x + nb.width, fb.x + fb.width), y1 = Math.min(nb.y + nb.height, fb.y + fb.height);
            if (x1 - x0 < 1 || y1 - y0 < 1) { blockers.push(`FRAME_WINDOW_EMPTY: ${f.label}: la capa no se ve dentro del frame`); continue; }
            window = { u0: (x0 - nb.x) / nb.width, v0: (y0 - nb.y) / nb.height, uw: (x1 - x0) / nb.width, vh: (y1 - y0) / nb.height, width: x1 - x0, height: y1 - y0 };
          }
          // Resolución: la imagen debe cubrir el contenedor (o su ventana visible) sin ampliarse (aviso, no bloqueo).
          const cw = window ? window.width : nw, chh = window ? window.height : nh;
          const k = Math.max(cw / target.width, chh / target.height);
          if (k > 1.001) warnings.push(`ASSET_LOW_RESOLUTION: ${f.label}: ${quote(a.label)} (${target.width}×${target.height}) se amplía ×${k.toFixed(2)} para cubrir ${Math.round(cw)}×${Math.round(chh)}`);
          const key = target.hash!;
          usedAssets.set(key, [...(usedAssets.get(key) ?? []), v.variantId]);
          ops.push({ kind: 'image', fieldId: f.fieldId, nodeId: f.nodeId, paintIndex: f.paintIndex!, masterHash: f.masterValue, asset: a, targetHash: key, policy: f.imagePolicy!, window });
        }
      }
    }
    variants.push({ variantId: v.variantId, label: v.label, cloneName: cloneNameOf(j, v.variantId), params: v.params, status: ready && blockers.length === 0 ? 'ready' : 'blocked', blockers, warnings, ops: ready && blockers.length === 0 ? ops : [] });
  }
  for (const [hash, vs] of usedAssets) if (vs.length > 1) for (const e of variants) if (vs.includes(e.variantId)) e.warnings.push(`SAME_ASSET_IN_VARIANTS: la misma imagen (${hash.slice(0, 10)}…) se usa en ${vs.join(', ')}`);

  return {
    check: chk,
    plan: {
      schema: VARIANT_PLAN_SCHEMA_ID, source: s.source,
      master: { fileKey: j.master.fileKey, nodeId: j.master.nodeId, name: j.master.name, width: j.master.width, height: j.master.height, fingerprint: s.fingerprints.master },
      sectionName: j.output.sectionName, logoNodeIds: j.protected.logoNodeIds, safeArea: j.protected.safeArea, foreignValues, variants,
    },
  };
}

/** Recorte (imageTransform de Figma, modo CROP) que cubre el contenedor centrando el punto focal, sin deformar. */
export function focalCropTransform(node: { width: number; height: number }, image: { width: number; height: number }, fx: number, fy: number): [[number, number, number], [number, number, number]] {
  const na = node.width / node.height, ia = image.width / image.height;
  const cw = Math.min(1, na / ia), ch = Math.min(1, ia / na);
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return [[cw, 0, clamp(fx - cw / 2, 1 - cw)], [0, ch, clamp(fy - ch / 2, 1 - ch)]];
}
