// Genera el script de SOLO LECTURA que se ejecuta en Figma mediante `use_figma` (Plugin API).
// El núcleo genera el script; el agente solo lo transporta y devuelve la respuesta ORIGINAL.
//
// ESTADO: probado solo contra el `figma` falso de src/figma/mock (MOCK). No se ha ejecutado en Figma real.
import { SHA256_JS_SOURCE } from './sha256-js.ts';

export const READ_SCRIPT_VERSION = 'pcb.read-script.v1';

/** IDs de nodo de escena de nivel superior ("123:456" o "123-456"). Nada de IDs de instancia internos. */
const ROOT_ID_PATTERN = /^\d+[:-]\d+$/;

export function normalizeNodeId(id: string): string {
  if (!ROOT_ID_PATTERN.test(id)) throw new Error(`Invalid root node id: ${JSON.stringify(id)}`);
  return id.replace('-', ':');
}

/** Llamadas de mutación que el script NUNCA debe contener. Comprobación estática complementaria al MOCK de solo lectura. */
export const FORBIDDEN_IN_READ_SCRIPT: RegExp[] = [
  /\.(resize|resizeWithoutConstraints|rescale|remove|clone|appendChild|insertChild|setPluginData|setSharedPluginData|setRelaunchData|detachInstance|setCurrentPageAsync|loadFontAsync|setBoundVariable|setProperties|swapComponent|screenshot|exportAsync|set)\s*\(/,
  /figma\.(create|group|ungroup|flatten|union|subtract|intersect|exclude|combineAsVariants)/,
  /\b(n|root|page|node)\.[A-Za-z_$][\w$]*\s*=(?!=)/,
  /figma\.currentPage\s*=(?!=)/,
];

const BODY = String.raw`
var MIXED = figma.mixed;
function msg(e) { return String(e && e.message ? e.message : e); }
function nz(v) { return v === undefined ? null : v; }
function jsonSafe(v) {
  if (v === MIXED) return 'MIXED';
  if (v === undefined) return null;
  return JSON.parse(JSON.stringify(v, function (k, val) { return val === MIXED ? 'MIXED' : val; }));
}
function rd(errors, key, fn, fallback) {
  try { var v = fn(); return v === undefined ? fallback : v; }
  catch (e) { errors.push(key + ': ' + msg(e)); return fallback; }
}
function numOrNull(v) { return typeof v === 'number' ? v : null; }
function strOrNull(v) { return v === MIXED ? 'MIXED' : (typeof v === 'string' ? v : null); }
function paint(p) {
  var o = {
    type: String(p.type), visible: p.visible !== false,
    opacity: typeof p.opacity === 'number' ? p.opacity : 1,
    blendMode: p.blendMode ? String(p.blendMode) : null,
    imageHash: null, scaleMode: null, imageTransform: null, scalingFactor: null,
    raw: jsonSafe(p)
  };
  if (p.type === 'IMAGE') {
    o.imageHash = p.imageHash ? String(p.imageHash) : null;
    o.scaleMode = p.scaleMode ? String(p.scaleMode) : null;
    o.imageTransform = p.imageTransform ? jsonSafe(p.imageTransform) : null;
    o.scalingFactor = numOrNull(p.scalingFactor);
  }
  return o;
}
function paints(v) {
  if (v === MIXED) return 'MIXED';
  if (!v) return [];
  return Array.prototype.map.call(v, paint);
}
function effects(v) {
  if (!v || v === MIXED) return [];
  return Array.prototype.map.call(v, function (e) { return { type: String(e.type), visible: e.visible !== false, raw: jsonSafe(e) }; });
}
var SEG_FULL = ['fontName', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textCase', 'textDecoration',
  'paragraphSpacing', 'paragraphIndent', 'fills', 'listOptions', 'indentation', 'hyperlink', 'textStyleId', 'fillStyleId'];
var SEG_MIN = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'fills'];
function segs(n, errors) {
  var mode = 'full', raw;
  try { raw = n.getStyledTextSegments(SEG_FULL); }
  catch (e) {
    errors.push('getStyledTextSegments(full): ' + msg(e));
    mode = 'minimal';
    try { raw = n.getStyledTextSegments(SEG_MIN); }
    catch (e2) { errors.push('getStyledTextSegments(minimal): ' + msg(e2)); return { mode: 'unavailable', segments: [] }; }
  }
  return { mode: mode, segments: raw.map(function (sg) {
    return {
      start: sg.start, end: sg.end, characters: String(sg.characters),
      fontName: sg.fontName && sg.fontName !== MIXED ? { family: String(sg.fontName.family), style: String(sg.fontName.style) } : null,
      fontSize: numOrNull(sg.fontSize), fontWeight: numOrNull(sg.fontWeight),
      lineHeight: jsonSafe(sg.lineHeight), letterSpacing: jsonSafe(sg.letterSpacing),
      textCase: strOrNull(sg.textCase), textDecoration: strOrNull(sg.textDecoration),
      paragraphSpacing: numOrNull(sg.paragraphSpacing), paragraphIndent: numOrNull(sg.paragraphIndent),
      fills: sg.fills ? paints(sg.fills) : [],
      other: jsonSafe({ listOptions: sg.listOptions, indentation: sg.indentation, hyperlink: sg.hyperlink,
        textStyleId: sg.textStyleId, fillStyleId: sg.fillStyleId })
    };
  }) };
}
function textInfo(n, errors) {
  var sg = segs(n, errors);
  return {
    characters: rd(errors, 'characters', function () { return String(n.characters); }, ''),
    hasMissingFont: rd(errors, 'hasMissingFont', function () { return n.hasMissingFont === true; }, null),
    autoResize: rd(errors, 'textAutoResize', function () { return strOrNull(n.textAutoResize); }, null),
    truncation: rd(errors, 'textTruncation', function () { return strOrNull(n.textTruncation); }, null),
    maxLines: rd(errors, 'maxLines', function () { return numOrNull(n.maxLines); }, null),
    alignHorizontal: rd(errors, 'textAlignHorizontal', function () { return strOrNull(n.textAlignHorizontal); }, null),
    alignVertical: rd(errors, 'textAlignVertical', function () { return strOrNull(n.textAlignVertical); }, null),
    leadingTrim: rd(errors, 'leadingTrim', function () { return strOrNull(n.leadingTrim); }, null),
    segmentFields: sg.mode,
    segments: sg.segments
  };
}
var GEOM_TYPES = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'ELLIPSE', 'LINE', 'RECTANGLE'];
async function record(n, depth, index, order) {
  var errors = [];
  var has = function (k) { return k in n; };
  var rec = {
    id: n.id, type: n.type, name: String(n.name),
    parentId: n.parent ? n.parent.id : null,
    childIds: has('children') && n.children ? Array.prototype.map.call(n.children, function (c) { return c.id; }) : [],
    depth: depth, indexInParent: index, paintOrder: order,
    visible: rd(errors, 'visible', function () { return n.visible !== false; }, true),
    opacity: rd(errors, 'opacity', function () { return has('opacity') ? n.opacity : 1; }, 1),
    blendMode: rd(errors, 'blendMode', function () { return has('blendMode') ? strOrNull(n.blendMode) : null; }, null),
    isMask: rd(errors, 'isMask', function () { return has('isMask') ? n.isMask === true : false; }, false),
    maskType: rd(errors, 'maskType', function () { return has('maskType') ? strOrNull(n.maskType) : null; }, null),
    rotation: rd(errors, 'rotation', function () { return has('rotation') ? numOrNull(n.rotation) : null; }, null),
    width: rd(errors, 'width', function () { return has('width') ? numOrNull(n.width) : null; }, null),
    height: rd(errors, 'height', function () { return has('height') ? numOrNull(n.height) : null; }, null),
    relativeTransform: rd(errors, 'relativeTransform', function () { return has('relativeTransform') ? jsonSafe(n.relativeTransform) : null; }, null),
    absoluteTransform: rd(errors, 'absoluteTransform', function () { return has('absoluteTransform') ? jsonSafe(n.absoluteTransform) : null; }, null),
    absoluteBoundingBox: rd(errors, 'absoluteBoundingBox', function () { return has('absoluteBoundingBox') ? jsonSafe(n.absoluteBoundingBox) : null; }, null),
    absoluteRenderBounds: rd(errors, 'absoluteRenderBounds', function () { return has('absoluteRenderBounds') ? jsonSafe(n.absoluteRenderBounds) : null; }, null),
    clipsContent: rd(errors, 'clipsContent', function () { return has('clipsContent') ? n.clipsContent === true : null; }, null),
    constraints: rd(errors, 'constraints', function () { return has('constraints') && n.constraints ? { horizontal: String(n.constraints.horizontal), vertical: String(n.constraints.vertical) } : null; }, null),
    layout: {
      mode: rd(errors, 'layoutMode', function () { return has('layoutMode') ? strOrNull(n.layoutMode) : null; }, null),
      positioning: rd(errors, 'layoutPositioning', function () { return has('layoutPositioning') ? strOrNull(n.layoutPositioning) : null; }, null),
      sizingHorizontal: rd(errors, 'layoutSizingHorizontal', function () { return has('layoutSizingHorizontal') ? strOrNull(n.layoutSizingHorizontal) : null; }, null),
      sizingVertical: rd(errors, 'layoutSizingVertical', function () { return has('layoutSizingVertical') ? strOrNull(n.layoutSizingVertical) : null; }, null)
    },
    fills: rd(errors, 'fills', function () { return has('fills') ? paints(n.fills) : []; }, []),
    strokes: rd(errors, 'strokes', function () { return has('strokes') ? paints(n.strokes) : []; }, []),
    strokeWeight: rd(errors, 'strokeWeight', function () { return has('strokeWeight') ? (n.strokeWeight === MIXED ? 'MIXED' : numOrNull(n.strokeWeight)) : null; }, null),
    strokeAlign: rd(errors, 'strokeAlign', function () { return has('strokeAlign') ? strOrNull(n.strokeAlign) : null; }, null),
    effects: rd(errors, 'effects', function () { return has('effects') ? effects(n.effects) : []; }, []),
    text: null,
    vectorGeometryDigest: null,
    component: null,
    readErrors: errors
  };
  if (n.type === 'TEXT') rec.text = textInfo(n, errors);
  if (GEOM_TYPES.indexOf(n.type) >= 0) {
    rec.vectorGeometryDigest = rd(errors, 'geometry', function () {
      var g = JSON.stringify({
        f: has('fillGeometry') ? jsonSafe(n.fillGeometry) : null,
        s: has('strokeGeometry') ? jsonSafe(n.strokeGeometry) : null,
        v: has('vectorPaths') ? jsonSafe(n.vectorPaths) : null
      });
      return 'sha256:' + __pcbSha256(g);
    }, null);
  }
  if (n.type === 'INSTANCE') {
    try {
      var mc = await n.getMainComponentAsync();
      rec.component = mc ? { mainComponentId: nz(mc.id), mainComponentKey: nz(mc.key), remote: typeof mc.remote === 'boolean' ? mc.remote : null, name: mc.name ? String(mc.name) : null }
                         : { mainComponentId: null, mainComponentKey: null, remote: null, name: null };
    } catch (e) { errors.push('getMainComponentAsync: ' + msg(e)); }
  }
  return rec;
}

var skipBefore = typeof figma.skipInvisibleInstanceChildren === 'boolean' ? figma.skipInvisibleInstanceChildren : null;
// Ajuste de ejecución del plugin, no del documento: sin esto se omitirían hijos ocultos de instancias.
figma.skipInvisibleInstanceChildren = false;

var root = await figma.getNodeByIdAsync(ROOT_ID);
if (!root) throw new Error('PCB_ROOT_NOT_FOUND ' + ROOT_ID);
if (root.type === 'PAGE' || root.type === 'DOCUMENT') throw new Error('PCB_ROOT_MUST_BE_SCENE_NODE');
var page = root.parent;
while (page && page.type !== 'PAGE') page = page.parent;
if (!page) throw new Error('PCB_ROOT_NOT_ON_PAGE');
// Carga la página sin cambiar la vista del usuario (no se usa setCurrentPageAsync).
if (typeof page.loadAsync === 'function') await page.loadAsync();

var nodes = [];
var order = 0;
async function visit(n, depth, index) {
  var rec = await record(n, depth, index, order++);
  nodes.push(rec);
  if ('children' in n && n.children) {
    for (var i = 0; i < n.children.length; i++) await visit(n.children[i], depth + 1, i);
  }
}
var rootIndex = -1;
if (root.parent && 'children' in root.parent) {
  for (var ri = 0; ri < root.parent.children.length; ri++) if (root.parent.children[ri].id === root.id) rootIndex = ri;
}
await visit(root, 0, rootIndex);

var payload = JSON.stringify({
  schema: 'pcb.read.v1', scriptVersion: SCRIPT_VERSION, rootNodeId: root.id,
  page: { id: page.id, name: String(page.name) },
  fileKey: typeof figma.fileKey === 'string' ? figma.fileKey : null,
  editorType: typeof figma.editorType === 'string' ? figma.editorType : null,
  runtime: { skipInvisibleInstanceChildrenBefore: skipBefore },
  nodeCount: nodes.length, nodes: nodes
});
return { schema: 'pcb.read.envelope.v1', payload: payload, digest: 'sha256:' + __pcbSha256(payload), payloadLength: payload.length };
`;

export interface ReadRequest {
  tool: 'use_figma';
  fileKey: string;
  description: string;
  code: string;
  expects: 'pcb.read.envelope.v1';
  readOnly: true;
  scriptVersion: string;
}

const FILE_KEY_PATTERN = /^[0-9a-zA-Z]{22,128}$/;

export function buildReadScript(rootNodeId: string): string {
  const id = normalizeNodeId(rootNodeId);
  return [
    `var ROOT_ID = ${JSON.stringify(id)};`,
    `var SCRIPT_VERSION = ${JSON.stringify(READ_SCRIPT_VERSION)};`,
    SHA256_JS_SOURCE,
    BODY,
  ].join('\n');
}

export function buildReadRequest(fileKey: string, rootNodeId: string): ReadRequest {
  if (!FILE_KEY_PATTERN.test(fileKey)) throw new Error(`Invalid file key: ${JSON.stringify(fileKey)}`);
  const code = buildReadScript(rootNodeId);
  if (code.length > 50_000) throw new Error(`Read script exceeds use_figma limit: ${code.length} chars`);
  return {
    tool: 'use_figma',
    fileKey,
    description: `PCB read-only inventory of node ${normalizeNodeId(rootNodeId)} (no mutations)`,
    code,
    expects: 'pcb.read.envelope.v1',
    readOnly: true,
    scriptVersion: READ_SCRIPT_VERSION,
  };
}

export function staticReadOnlyViolations(code: string): string[] {
  const allowed = code.replace(/figma\.skipInvisibleInstanceChildren = false;/g, '');
  return FORBIDDEN_IN_READ_SCRIPT.filter((re) => re.test(allowed)).map((re) => re.source);
}
