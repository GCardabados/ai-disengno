// Genera el script de SOLO LECTURA que se ejecuta en Figma mediante `use_figma` (Plugin API).
// El núcleo genera el script; el agente solo lo transporta y devuelve la respuesta ORIGINAL.
//
// ESTADO: probado solo contra el `figma` falso de src/figma/mock (MOCK). No se ha ejecutado en Figma real.
import { SHA256_JS_SOURCE } from './sha256-js.ts';

export const READ_SCRIPT_VERSION = 'pcb.read-script.v4';

/** Tipo exigido para la raíz de la maestra. El MVP solo acepta frames: nunca una página ni otro tipo. */
export const DEFAULT_ROOT_TYPE = 'FRAME';
const ROOT_TYPE_PATTERN = /^[A-Z_]+$/;

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
var missingFontIds = [];
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
    // Propiedad del ENTORNO de ejecución (disponibilidad de fuentes), no del contenido: se observó que alterna
    // entre llamadas. Va a los metadatos de la llamada (missingFontNodeIds), no al payload estable.
    hasMissingFont: (function () { if (rd(errors, 'hasMissingFont', function () { return n.hasMissingFont === true; }, false)) missingFontIds.push(n.id); return null; })(),
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

if (!(CHUNK_INDEX >= 0)) throw new Error('PCB_BAD_CHUNK_INDEX');
var root = await figma.getNodeByIdAsync(ROOT_ID);
if (!root) throw new Error('PCB_ROOT_NOT_FOUND ' + ROOT_ID);
if (root.type === 'PAGE' || root.type === 'DOCUMENT') throw new Error('PCB_ROOT_MUST_BE_SCENE_NODE ' + root.type);
// Se comprueba ANTES de leer nada más: si la raíz no es del tipo exigido, no se inventaría.
if (root.type !== REQUIRED_ROOT_TYPE) throw new Error('PCB_ROOT_TYPE_MISMATCH expected=' + REQUIRED_ROOT_TYPE + ' actual=' + root.type);
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

// Payload ESTABLE: sin marcas de tiempo ni metadatos de la llamada.
var payload = JSON.stringify({
  schema: 'pcb.read.v3', scriptVersion: SCRIPT_VERSION, rootNodeId: root.id,
  page: { id: page.id, name: String(page.name) },
  fileKey: typeof figma.fileKey === 'string' ? figma.fileKey : null,
  editorType: typeof figma.editorType === 'string' ? figma.editorType : null,
  nodeCount: nodes.length, nodes: nodes
});

// Modo diagnóstico (solo lectura): hash por nodo y registros completos de los nodos pedidos, para localizar
// qué valores varían entre lecturas. No produce una instantánea.
if (MODE === 'node-digests') {
  var full = {};
  for (var fi = 0; fi < FULL_IDS.length; fi++) {
    for (var nj = 0; nj < nodes.length; nj++) if (nodes[nj].id === FULL_IDS[fi]) full[FULL_IDS[fi]] = nodes[nj];
  }
  var denv = {
    schema: 'pcb.read.nodedigests.v1', rootNodeId: root.id,
    payloadSha256: 'sha256:' + __pcbSha256(payload), payloadChars: payload.length,
    nodeDigests: nodes.map(function (r) { return [r.id, __pcbSha256(JSON.stringify(r)).slice(0, 16)]; }),
    full: full,
    call: { scriptVersion: SCRIPT_VERSION, skipInvisibleInstanceChildrenBefore: skipBefore, missingFontNodeIds: missingFontIds, responseBytes: 0 }
  };
  denv.call.responseBytes = __pcbUtf8(JSON.stringify(denv)).length;
  denv.call.responseBytes = __pcbUtf8(JSON.stringify(denv)).length;
  if (denv.call.responseBytes > MAX_RESPONSE_BYTES) throw new Error('PCB_RESPONSE_TOO_LARGE bytes=' + denv.call.responseBytes + ' max=' + MAX_RESPONSE_BYTES);
  return denv;
}

// Coste en bytes UTF-8 de un punto de código una vez escapado dentro de un string JSON.
function escapedCost(cp) {
  if (cp === 0x22 || cp === 0x5c) return 2;
  if (cp === 0x08 || cp === 0x09 || cp === 0x0a || cp === 0x0c || cp === 0x0d) return 2;
  if (cp < 0x20) return 6;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp >= 0xd800 && cp <= 0xdfff) return 6;
  if (cp < 0x10000) return 3;
  return 4;
}
// División determinista por puntos de código: nunca parte un par sustituto.
var bounds = [0];
var acc = 0;
for (var pi = 0; pi < payload.length; ) {
  var cu = payload.charCodeAt(pi);
  var width = 1;
  var cp = cu;
  if (cu >= 0xd800 && cu <= 0xdbff && pi + 1 < payload.length) {
    var lo2 = payload.charCodeAt(pi + 1);
    if (lo2 >= 0xdc00 && lo2 <= 0xdfff) { cp = 0x10000 + ((cu - 0xd800) << 10) + (lo2 - 0xdc00); width = 2; }
  }
  var cost = escapedCost(cp);
  if (acc + cost > BYTE_BUDGET && acc > 0) { bounds.push(pi); acc = 0; }
  acc += cost;
  pi += width;
}
bounds.push(payload.length);
var chunkCount = bounds.length - 1;
if (CHUNK_INDEX >= chunkCount) throw new Error('PCB_CHUNK_OUT_OF_RANGE index=' + CHUNK_INDEX + ' count=' + chunkCount);

var chunk = payload.slice(bounds[CHUNK_INDEX], bounds[CHUNK_INDEX + 1]);
var payloadHex = __pcbSha256(payload);
var env = {
  schema: 'pcb.read.chunk.envelope.v2',
  setId: 'set_' + payloadHex.slice(0, 16) + '_b' + BYTE_BUDGET,
  rootNodeId: root.id,
  payloadSchema: 'pcb.read.v3',
  payloadSha256: 'sha256:' + payloadHex,
  payloadBytes: __pcbUtf8(payload).length,
  payloadChars: payload.length,
  byteBudget: BYTE_BUDGET,
  chunkIndex: CHUNK_INDEX,
  chunkCount: chunkCount,
  chunk: chunk,
  chunkSha256: 'sha256:' + __pcbSha256(chunk),
  chunkBytes: __pcbUtf8(chunk).length,
  chunkChars: chunk.length,
  call: { scriptVersion: SCRIPT_VERSION, skipInvisibleInstanceChildrenBefore: skipBefore, missingFontNodeIds: missingFontIds, responseBytes: 0 }
};
// Autocomprobación: bytes UTF-8 de la respuesta serializada completa (lo que medirá el MCP).
env.call.responseBytes = __pcbUtf8(JSON.stringify(env)).length;
env.call.responseBytes = __pcbUtf8(JSON.stringify(env)).length;
if (env.call.responseBytes > MAX_RESPONSE_BYTES) throw new Error('PCB_RESPONSE_TOO_LARGE bytes=' + env.call.responseBytes + ' max=' + MAX_RESPONSE_BYTES);
return env;
`;

export interface ReadRequest {
  tool: 'use_figma';
  fileKey: string;
  description: string;
  code: string;
  expects: 'pcb.read.chunk.envelope.v2';
  readOnly: true;
  scriptVersion: string;
  chunkIndex: number;
  byteBudget: number;
}

const FILE_KEY_PATTERN = /^[0-9a-zA-Z]{22,128}$/;

/** Límite observado del MCP: 20 480 caracteres de texto (la respuesta real se truncó ahí). */
export const OBSERVED_MCP_RESPONSE_LIMIT = 20_480;
/** Presupuesto de bytes UTF-8 del fragmento YA ESCAPADO como string JSON. */
export const DEFAULT_CHUNK_BYTE_BUDGET = 12_000;
/** Tope duro de la respuesta serializada completa: deja margen para el envoltorio del MCP. */
export const MAX_RESPONSE_BYTES = 16_384;

export interface ReadScriptOptions {
  /** 'chunk' (por defecto) o 'node-digests' (diagnóstico: hash por nodo; no produce instantánea). */
  mode?: 'chunk' | 'node-digests';
  /** Solo en 'node-digests': nodos cuyo registro completo se devuelve. */
  fullNodeIds?: string[];
  requiredRootType?: string;
  chunkIndex?: number;
  byteBudget?: number;
  maxResponseBytes?: number;
}

export function buildReadScript(rootNodeId: string, opts: ReadScriptOptions | string = {}): string {
  const o: ReadScriptOptions = typeof opts === 'string' ? { requiredRootType: opts } : opts;
  const requiredRootType = o.requiredRootType ?? DEFAULT_ROOT_TYPE;
  const chunkIndex = o.chunkIndex ?? 0;
  const byteBudget = o.byteBudget ?? DEFAULT_CHUNK_BYTE_BUDGET;
  const maxResponseBytes = o.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  const mode = o.mode ?? 'chunk';
  if (mode !== 'chunk' && mode !== 'node-digests') throw new Error('Invalid mode');
  const fullIds = (o.fullNodeIds ?? []).map(normalizeNodeId);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error('Invalid chunk index');
  if (!Number.isInteger(byteBudget) || byteBudget < 256) throw new Error('Invalid byte budget');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= byteBudget) throw new Error('Invalid max response bytes');
  const id = normalizeNodeId(rootNodeId);
  if (!ROOT_TYPE_PATTERN.test(requiredRootType)) throw new Error(`Invalid root type: ${JSON.stringify(requiredRootType)}`);
  return [
    `var ROOT_ID = ${JSON.stringify(id)};`,
    `var REQUIRED_ROOT_TYPE = ${JSON.stringify(requiredRootType)};`,
    `var CHUNK_INDEX = ${chunkIndex};`,
    `var BYTE_BUDGET = ${byteBudget};`,
    `var MAX_RESPONSE_BYTES = ${maxResponseBytes};`,
    `var MODE = ${JSON.stringify(mode)};`,
    `var FULL_IDS = ${JSON.stringify(fullIds)};`,
    `var SCRIPT_VERSION = ${JSON.stringify(READ_SCRIPT_VERSION)};`,
    SHA256_JS_SOURCE,
    BODY,
  ].join('\n');
}

export function buildReadRequest(fileKey: string, rootNodeId: string, opts: ReadScriptOptions | string = {}): ReadRequest {
  if (!FILE_KEY_PATTERN.test(fileKey)) throw new Error(`Invalid file key: ${JSON.stringify(fileKey)}`);
  const o: ReadScriptOptions = typeof opts === 'string' ? { requiredRootType: opts } : opts;
  const code = buildReadScript(rootNodeId, o);
  if (code.length > 50_000) throw new Error(`Read script exceeds use_figma limit: ${code.length} chars`);
  const chunkIndex = o.chunkIndex ?? 0;
  const byteBudget = o.byteBudget ?? DEFAULT_CHUNK_BYTE_BUDGET;
  return {
    tool: 'use_figma',
    fileKey,
    description: `PCB read-only inventory of ${o.requiredRootType ?? DEFAULT_ROOT_TYPE} ${normalizeNodeId(rootNodeId)}, chunk ${chunkIndex} (budget ${byteBudget} B, no mutations)`,
    code,
    expects: 'pcb.read.chunk.envelope.v2',
    readOnly: true,
    scriptVersion: READ_SCRIPT_VERSION,
    chunkIndex,
    byteBudget,
  };
}

export function staticReadOnlyViolations(code: string): string[] {
  const allowed = code.replace(/figma\.skipInvisibleInstanceChildren = false;/g, '');
  return FORBIDDEN_IN_READ_SCRIPT.filter((re) => re.test(allowed)).map((re) => re.source);
}
