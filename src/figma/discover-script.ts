// Script de SOLO LECTURA para `use_figma`: a partir del nodo de entrada del usuario (página, sección u otro
// contenedor) localiza los nodos cuyo nombre coincide con el de la composición buscada.
// No lee contenido de la maestra: solo id, tipo, nombre, tamaño y ruta. El inventario se hace después
// con el script de lectura sobre el masterNodeId resuelto por el núcleo.
import { SHA256_JS_SOURCE } from './sha256-js.ts';

export const DISCOVER_SCRIPT_VERSION = 'pcb.discover-script.v1';
export const MAX_LISTED_CHILDREN = 500;

const ENTRY_ID_PATTERN = /^\d+[:-]\d+$/;

export function normalizeEntryId(id: string): string {
  if (!ENTRY_ID_PATTERN.test(id)) throw new Error(`Invalid entry node id: ${JSON.stringify(id)}`);
  return id.replace('-', ':');
}

/** El nombre buscado lo aporta el usuario; aun así se limita y se inyecta como literal JSON. */
export function validateTargetName(name: string): string {
  if (name.length < 1 || name.length > 200) throw new Error('Target name must be 1..200 characters');
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) throw new Error('Target name contains control characters');
  }
  return name;
}

const BODY = String.raw`
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
`;

export function buildDiscoverScript(entryNodeId: string, targetName: string): string {
  return [
    `var ENTRY_ID = ${JSON.stringify(normalizeEntryId(entryNodeId))};`,
    `var TARGET_NAME = ${JSON.stringify(validateTargetName(targetName))};`,
    `var SCRIPT_VERSION = ${JSON.stringify(DISCOVER_SCRIPT_VERSION)};`,
    `var MAX_LISTED = ${MAX_LISTED_CHILDREN};`,
    SHA256_JS_SOURCE,
    BODY,
  ].join('\n');
}

export interface DiscoverRequest {
  tool: 'use_figma';
  fileKey: string;
  description: string;
  code: string;
  expects: 'pcb.discover.envelope.v1';
  readOnly: true;
  scriptVersion: string;
}

export function buildDiscoverRequest(fileKey: string, entryNodeId: string, targetName: string): DiscoverRequest {
  if (!/^[0-9a-zA-Z]{22,128}$/.test(fileKey)) throw new Error(`Invalid file key: ${JSON.stringify(fileKey)}`);
  const code = buildDiscoverScript(entryNodeId, targetName);
  if (code.length > 50_000) throw new Error('Discover script exceeds use_figma limit');
  return {
    tool: 'use_figma',
    fileKey,
    description: `PCB read-only discovery of composition by name under entry node ${normalizeEntryId(entryNodeId)} (no mutations)`,
    code,
    expects: 'pcb.discover.envelope.v1',
    readOnly: true,
    scriptVersion: DISCOVER_SCRIPT_VERSION,
  };
}
