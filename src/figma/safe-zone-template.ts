/**
 * Safe zones definidas como PLANTILLAS en Figma (frames guía con rectángulos de exclusión).
 *
 * - buildSafeZoneTemplateScript: script de SOLO LECTURA que inventaría las plantillas de una sección/frame: tamaño,
 *   capas de primer nivel y, por capa, las formas geométricas con su caja en coordenadas de la plantilla.
 * - resolveSafeZoneTemplate: elige la plantilla del destino SOLO por tamaño exacto (nunca escala otra) y, dentro de
 *   ella, la capa indicada. Si no hay plantilla del tamaño → 'none'; si hay varias con geometría distinta o varias
 *   capas candidatas → 'ambiguous' (se pregunta a la persona). Los nombres de capa son pistas, no instrucciones.
 */

export const SAFE_ZONE_TEMPLATES_SCHEMA_ID = 'pcb.safe-zone-templates.v1';

export interface TemplateShape { id: string; name: string; type: string; visible: boolean; rect: { x: number; y: number; w: number; h: number } | null }
export interface TemplateLayer { id: string; name: string; type: string; visible: boolean; shapes: TemplateShape[] }
export interface SafeZoneTemplate { id: string; name: string; width: number; height: number; layers: TemplateLayer[] }
export interface SafeZoneTemplates {
  schema: typeof SAFE_ZONE_TEMPLATES_SCHEMA_ID;
  sourceNodeId: string; sourceName: string; sourceType: string;
  page: { id: string; name: string } | null;
  templates: SafeZoneTemplate[];
}

export function buildSafeZoneTemplateScript(nodeId: string): string {
  return `var SOURCE_ID = ${JSON.stringify(nodeId)};
var src = await figma.getNodeByIdAsync(SOURCE_ID);
if (!src) throw new Error('PCB_NOT_FOUND ' + SOURCE_ID);
var page = src.parent; while (page && page.type !== 'PAGE') page = page.parent;
if (page && typeof page.loadAsync === 'function') await page.loadAsync();
var GEOM = ['RECTANGLE', 'VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'POLYGON', 'STAR'];
function r2(v) { return Math.round(v * 100) / 100; }
function shapesOf(node, ob, out) {
  if (GEOM.indexOf(node.type) >= 0) {
    var b = node.absoluteBoundingBox;
    out.push({ id: node.id, name: String(node.name), type: node.type, visible: node.visible !== false,
      rect: b ? { x: r2(b.x - ob.x), y: r2(b.y - ob.y), w: r2(b.width), h: r2(b.height) } : null });
    return;
  }
  if ('children' in node) for (var i = 0; i < node.children.length; i++) shapesOf(node.children[i], ob, out);
}
function template(t) {
  var ob = t.absoluteBoundingBox;
  var layers = [];
  for (var j = 0; j < t.children.length; j++) {
    var L = t.children[j];
    var shapes = [];
    shapesOf(L, ob, shapes);
    layers.push({ id: L.id, name: String(L.name), type: L.type, visible: L.visible !== false, shapes: shapes });
  }
  return { id: t.id, name: String(t.name), width: t.width, height: t.height, layers: layers };
}
var frames = src.type === 'FRAME' ? [src] : ('children' in src ? src.children.filter(function (c) { return c.type === 'FRAME'; }) : []);
return { schema: ${JSON.stringify(SAFE_ZONE_TEMPLATES_SCHEMA_ID)}, sourceNodeId: src.id, sourceName: String(src.name), sourceType: src.type,
  page: page ? { id: page.id, name: String(page.name) } : null, templates: frames.map(template) };
`;
}

export type Rect = { x: number; y: number; width: number; height: number };
export interface SafeZoneResolution {
  status: 'applicable' | 'none' | 'ambiguous';
  reason: string;
  destination: { width: number; height: number };
  templatesSameSize: Array<{ id: string; name: string }>;
  chosen: { templateId: string; templateName: string; layerId: string; layerName: string } | null;
  /** Rectángulo permitido (la forma «permitida» de la capa, o el frame si no la hay), en coordenadas del destino. */
  allowed: Rect | null;
  /** Formas de la capa que no son la permitida: zonas que el contenido importante no puede tocar. */
  exclusions: Array<{ name: string; rect: Rect }>;
}

const ALLOWED_HINT = /square|permitid|allowed|safe area/i;
const toRect = (r: { x: number; y: number; w: number; h: number }): Rect => ({ x: r.x, y: r.y, width: r.w, height: r.h });
const clampToFrame = (r: Rect, W: number, H: number): Rect => {
  const x = Math.max(0, r.x), y = Math.max(0, r.y);
  return { x, y, width: Math.min(W, r.x + r.width) - x, height: Math.min(H, r.y + r.height) - y };
};

function layerGeometry(l: TemplateLayer, W: number, H: number): { allowed: Rect; exclusions: Array<{ name: string; rect: Rect }> } {
  const shapes = l.shapes.filter((s) => s.visible && s.rect);
  const allowedShape = shapes.find((s) => ALLOWED_HINT.test(s.name));
  return {
    allowed: allowedShape ? clampToFrame(toRect(allowedShape.rect!), W, H) : { x: 0, y: 0, width: W, height: H },
    exclusions: shapes.filter((s) => s !== allowedShape).map((s) => ({ name: s.name, rect: clampToFrame(toRect(s.rect!), W, H) })),
  };
}

export function resolveSafeZoneTemplate(inv: SafeZoneTemplates, dest: { width: number; height: number }, hints: { template?: string; layer?: string } = {}): SafeZoneResolution {
  const base = { destination: dest, chosen: null, allowed: null, exclusions: [] as Array<{ name: string; rect: Rect }> };
  const same = inv.templates.filter((t) => Math.round(t.width) === dest.width && Math.round(t.height) === dest.height);
  const templatesSameSize = same.map((t) => ({ id: t.id, name: t.name }));
  if (same.length === 0) {
    return { ...base, status: 'none', templatesSameSize, reason: `Ninguna plantilla mide ${dest.width}×${dest.height}; no se escala ni se interpreta otra.` };
  }
  const byTemplate = hints.template ? same.filter((t) => t.name.toLowerCase().includes(hints.template!.toLowerCase())) : same;
  if (byTemplate.length === 0) return { ...base, status: 'ambiguous', templatesSameSize, reason: `Ninguna plantilla de ${dest.width}×${dest.height} contiene «${hints.template}» en su nombre.` };
  // Por plantilla, la capa candidata: la indicada por la pista, o la única capa con formas visibles.
  const picks: Array<{ t: SafeZoneTemplate; l: TemplateLayer; g: ReturnType<typeof layerGeometry> }> = [];
  for (const t of byTemplate) {
    const withShapes = t.layers.filter((l) => l.shapes.some((s) => s.visible && s.rect));
    const cands = hints.layer ? withShapes.filter((l) => l.name.toLowerCase().includes(hints.layer!.toLowerCase())) : withShapes;
    if (cands.length !== 1) {
      return { ...base, status: 'ambiguous', templatesSameSize, reason: `«${t.name}» tiene ${cands.length} capas candidatas (${withShapes.map((l) => l.name).join(' | ')}); indica cuál aplica.` };
    }
    picks.push({ t, l: cands[0]!, g: layerGeometry(cands[0]!, dest.width, dest.height) });
  }
  // Varias plantillas del mismo tamaño solo valen si su geometría coincide (copias de la misma guía).
  const key = (g: ReturnType<typeof layerGeometry>) => JSON.stringify([g.allowed, g.exclusions.map((e) => e.rect).sort((a, b) => a.x - b.x || a.y - b.y)]);
  if (new Set(picks.map((p) => key(p.g))).size > 1) {
    return { ...base, status: 'ambiguous', templatesSameSize, reason: `Hay ${picks.length} plantillas de ${dest.width}×${dest.height} con geometría distinta (${picks.map((p) => p.t.name).join(' | ')}); indica cuál aplica.` };
  }
  const p = picks[0]!;
  return {
    status: 'applicable', templatesSameSize, destination: dest,
    reason: picks.length > 1 ? `${picks.length} plantillas con la misma geometría; se usa la primera.` : 'Plantilla única del tamaño del destino.',
    chosen: { templateId: p.t.id, templateName: p.t.name, layerId: p.l.id, layerName: p.l.name },
    allowed: p.g.allowed, exclusions: p.g.exclusions,
  };
}
