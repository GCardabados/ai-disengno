var ROOT_ID = "2009:122";
var REQUIRED_ROOT_TYPE = "FRAME";
var CHUNK_INDEX = 1;
var BYTE_BUDGET = 12000;
var MAX_RESPONSE_BYTES = 16384;
var MODE = "chunk";
var FULL_IDS = [];
var SCRIPT_VERSION = "pcb.read-script.v4";

function __pcbUtf8(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      var d = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      else { c = 0xfffd; }
    } else if (c >= 0xdc00 && c <= 0xdfff) { c = 0xfffd; }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function __pcbSha256(str) {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  var bytes = __pcbUtf8(str);
  var len = bytes.length;
  var hi = Math.floor(len / 0x20000000);
  var lo = (len * 8) >>> 0;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
             (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  var w = new Array(64);
  for (var off = 0; off < bytes.length; off += 64) {
    for (var i = 0; i < 16; i++) {
      var j = off + 4 * i;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (var t = 16; t < 64; t++) {
      var x = w[t - 15], y = w[t - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (var r = 0; r < 64; r++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K[r] + w[r]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  var hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  var hex = '';
  for (var k = 0; k < 8; k++) hex += ('00000000' + (hs[k] >>> 0).toString(16)).slice(-8);
  return hex;
}


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
