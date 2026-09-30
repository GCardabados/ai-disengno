var ENTRY_ID = "1:536";
var TARGET_NAME = "960x1200_Taxdown_SVA2";
var SCRIPT_VERSION = "pcb.discover-script.v1";
var MAX_LISTED = 500;

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


var TIMES = String.fromCharCode(0xd7);
function norm(s) {
  var t = String(s);
  if (typeof t.normalize === 'function') t = t.normalize('NFKC');
  return t.split(TIMES).join('x').replace(/\s+/g, ' ').trim().toLowerCase();
}
function numOrNull(v) { return typeof v === 'number' ? v : null; }

var entry = await figma.getNodeByIdAsync(ENTRY_ID);
if (!entry) throw new Error('PCB_ENTRY_NOT_FOUND ' + ENTRY_ID);
if (entry.type === 'DOCUMENT') throw new Error('PCB_ENTRY_IS_DOCUMENT');
var page = entry;
while (page && page.type !== 'PAGE') page = page.parent;
if (!page) throw new Error('PCB_ENTRY_NOT_ON_PAGE');
// Carga la página sin cambiar la vista del usuario (no se usa setCurrentPageAsync).
if (typeof page.loadAsync === 'function') await page.loadAsync();

var target = norm(TARGET_NAME);
var matches = [];
var entryChildren = [];
var truncated = false;
var total = 0;
function summary(n, depth, path) {
  return {
    id: n.id, type: n.type, name: String(n.name),
    width: 'width' in n ? numOrNull(n.width) : null,
    height: 'height' in n ? numOrNull(n.height) : null,
    depth: depth, parentId: n.parent ? n.parent.id : null, pathIds: path.slice()
  };
}
function walk(n, depth, path) {
  total++;
  if (depth === 1) {
    if (entryChildren.length < MAX_LISTED) entryChildren.push(summary(n, depth, path));
    else truncated = true;
  }
  if (norm(n.name) === target) matches.push(summary(n, depth, path));
  if ('children' in n && n.children) {
    path.push(n.id);
    for (var i = 0; i < n.children.length; i++) walk(n.children[i], depth + 1, path);
    path.pop();
  }
}
walk(entry, 0, []);

var payload = JSON.stringify({
  schema: 'pcb.discover.v1', scriptVersion: SCRIPT_VERSION,
  entry: { id: entry.id, type: entry.type, name: String(entry.name) },
  page: { id: page.id, name: String(page.name) },
  fileKey: typeof figma.fileKey === 'string' ? figma.fileKey : null,
  targetName: TARGET_NAME,
  matches: matches, entryChildren: entryChildren, entryChildrenTruncated: truncated,
  descendantCount: total - 1
});
return { schema: 'pcb.discover.envelope.v1', payload: payload, digest: 'sha256:' + __pcbSha256(payload), payloadLength: payload.length };
