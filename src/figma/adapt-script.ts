// Script use_figma de ESCRITURA para la adaptación DEMO. Solo escribe sobre un clon dentro de una sección de salida.
//
// Garantías que impone el propio script (además de las comprobaciones posteriores sobre la relectura):
//  - Verifica tipo, nombre y tamaño de la maestra antes de nada; si no coinciden, no escribe.
//  - Nunca modifica la maestra: todas las mutaciones pasan por `onClone(masterId)`, que resuelve el nodo del clon por
//    recorrido paralelo del árbol y rechaza cualquier id que pertenezca a la maestra o que no descienda del clon.
//  - No sustituye fuentes: nunca asigna fontName. Intenta cargar las fuentes existentes y registra el resultado.
//    Solo exige que carguen si el plan toca la maquetación de algún texto (FONT_REQUIRED); trasladar un texto o su
//    contenedor no necesita la fuente cargada (v2: observado en real que una copia del archivo no tiene "Mutualidad"
//    disponible para el plugin, aunque el render del servidor la muestra).
//  - Todo o nada: si algo falla después de clonar, descarta SU PROPIO clon (única llamada a remove permitida) y relanza.
//  - Operaciones: resizeWithoutConstraints del frame raíz (sin escalar hijos), traslación de bloques y
//    redimensionado de efectos listados en el plan. Ninguna otra.
//  - No duplica: en 'create', si ya existe un clon con ese nombre se detiene; 'patch' actualiza ese clon.
//  - v5: traslaciones ABSOLUTAS (posición de la maestra + desplazamiento), idempotentes; varios clones por sección.
//  - v6: un GROUP se traslada midiendo sobre un descendiente de referencia no modificado (su caja es derivada:
//    en v5, reaplicar tras redimensionar un hijo desplazaba todo el grupo).
//  - Ediciones vectoriales de decoración con guarda 'from' (idempotentes; detectan cambios ajenos).
//  - v7: modo 'copy' (duplica un clon existente TAL CUAL, con sus cambios manuales, y adapta solo la copia), escala
//    PROPORCIONAL de imágenes (nunca logo ni texto) y grosor de trazo de decoraciones con guarda 'from'.
import type { DemoPlan } from '../demo/plan.ts';

export const ADAPT_SCRIPT_VERSION = 'pcb.adapt-script.v7';

/** Única eliminación permitida: el clon creado por este mismo script, si falla algo después de crearlo. */
export const ALLOWED_DISCARD_LINE = '  clone.remove(); // PCB_DISCARD_OWN_CLONE';

export const FORBIDDEN_IN_ADAPT_SCRIPT = [
  '.remove(', 'setPluginData', 'setSharedPluginData', 'createImage', 'exportAsync', 'loadAllPagesAsync',
  'setCurrentPageAsync', 'detachInstance', 'flatten(', 'insertCharacters', 'deleteCharacters', '.characters =',
  'fontName =', 'rescale(', 'figma.currentPage =',
];

export function staticAdaptViolations(code: string): string[] {
  const scanned = code.split('\n').filter((l) => l !== ALLOWED_DISCARD_LINE).join('\n');
  return FORBIDDEN_IN_ADAPT_SCRIPT.filter((f) => scanned.includes(f));
}

export interface AdaptOptions {
  sectionName: string;
  cloneName: string;
  gapFromContentPx: number;
  /**
   * 'create' (por defecto): clona y aplica todo el plan. 'patch': reaplica el plan COMPLETO sobre el clon EXISTENTE
   * (sin duplicar la salida). Todas las operaciones son absolutas respecto a la maestra, así que reaplicarlas es
   * idempotente. Usar 'patch' solo tras comprobar que el clon no cambió desde la última lectura.
   * 'copy': duplica el clon `sourceCloneId` (sin tocarlo) dentro de la misma sección y aplica el plan a la copia.
   */
  mode?: 'create' | 'patch' | 'copy';
  existingCloneId?: string;
  sourceCloneId?: string;
}

const BODY = String.raw`
var master = await figma.getNodeByIdAsync(PLAN.masterNodeId);
if (!master) throw new Error('PCB_MASTER_NOT_FOUND');
if (master.type !== 'FRAME') throw new Error('PCB_MASTER_TYPE ' + master.type);
if (master.name !== PLAN.masterName) throw new Error('PCB_MASTER_NAME_MISMATCH');
if (master.width !== PLAN.masterSize.width || master.height !== PLAN.masterSize.height) throw new Error('PCB_MASTER_SIZE_MISMATCH ' + master.width + 'x' + master.height);
var page = master.parent;
while (page && page.type !== 'PAGE') page = page.parent;
if (!page) throw new Error('PCB_MASTER_NOT_ON_PAGE');
await page.loadAsync();

// Sección de salida (se crea una vez; se reutiliza si ya existe).
var section = null;
for (var i = 0; i < page.children.length; i++) {
  var c0 = page.children[i];
  if (c0.type === 'SECTION' && c0.name === OUT.sectionName) section = c0;
}
var existing = null;
var source = null;
if (section) {
  for (var j = 0; j < section.children.length; j++) {
    if (section.children[j].name === OUT.cloneName) existing = section.children[j];
    if (section.children[j].id === OUT.sourceCloneId) source = section.children[j];
  }
}
if (MODE !== 'patch' && existing) throw new Error('PCB_DEMO_ALREADY_EXISTS ' + existing.id);
if (MODE === 'copy' && (!source || source.type !== 'FRAME' || source.id === master.id)) throw new Error('PCB_COPY_SOURCE_NOT_FOUND ' + OUT.sourceCloneId);
if (MODE === 'patch' && (!existing || existing.id !== OUT.existingCloneId)) throw new Error('PCB_PATCH_TARGET_NOT_FOUND ' + OUT.existingCloneId);

// Fuentes: se intenta cargar las existentes; nunca se sustituye ninguna. Solo se exige la carga si el plan toca la
// maquetación de un texto (FONT_REQUIRED); si hace falta y falla, se detiene ANTES de escribir.
var fontKeys = {};
var texts = master.findAllWithCriteria({ types: ['TEXT'] });
for (var t = 0; t < texts.length; t++) {
  var segs = texts[t].getStyledTextSegments(['fontName']);
  for (var s = 0; s < segs.length; s++) fontKeys[segs[s].fontName.family + '\u0000' + segs[s].fontName.style] = segs[s].fontName;
}
var fonts = [];
var fontFailed = false;
var keys = Object.keys(fontKeys).sort();
for (var k = 0; k < keys.length; k++) {
  var fn = fontKeys[keys[k]];
  try { await figma.loadFontAsync(fn); fonts.push({ family: fn.family, style: fn.style, loaded: true, requiredForOps: FONT_REQUIRED, error: null }); }
  catch (e) { fontFailed = true; fonts.push({ family: fn.family, style: fn.style, loaded: false, requiredForOps: FONT_REQUIRED, error: String(e && e.message ? e.message : e).split('\n')[0] }); }
}
if (fontFailed && FONT_REQUIRED) throw new Error('PCB_FONT_LOAD_FAILED ' + JSON.stringify(fonts));

var sectionCreated = false;
if (!section) {
  var maxRight = -Infinity;
  for (var p = 0; p < page.children.length; p++) {
    var bb = page.children[p].absoluteBoundingBox;
    if (bb && bb.x + bb.width > maxRight) maxRight = bb.x + bb.width;
  }
  section = figma.createSection();
  // createSection() crea en la página ACTUAL del plugin (la primera en cada llamada), no en la de la maestra.
  page.appendChild(section);
  section.name = OUT.sectionName;
  section.x = Math.round(maxRight + OUT.gapFromContentPx);
  section.y = Math.round(master.absoluteBoundingBox.y - 100);
  section.resizeWithoutConstraints(PLAN.target.width + 200, PLAN.target.height + 200);
  sectionCreated = true;
}

var masterIds = {};
master.findAll(function () { return true; }).forEach(function (n) { masterIds[n.id] = true; });
masterIds[master.id] = true;

// 'copy' duplica el clon de origen tal cual (conserva cualquier cambio manual suyo); el origen no se modifica.
var clone = MODE === 'create' ? master.clone() : MODE === 'copy' ? source.clone() : existing;
var idMap = [];
var applied = [];

function near(p, q, tol) { return Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol; }

try {
if (MODE !== 'patch') {
  // Varios destinos comparten la sección de salida: el nuevo clon va a la derecha de los existentes.
  var nextX = 100;
  for (var sc = 0; sc < section.children.length; sc++) {
    var sib = section.children[sc];
    if (sib.x + sib.width + 100 > nextX) nextX = sib.x + sib.width + 100;
  }
  section.appendChild(clone);
  clone.x = nextX;
  clone.y = 100;
  clone.name = OUT.cloneName;
  var needW = clone.x + PLAN.target.width + 100, needH = clone.y + PLAN.target.height + 100;
  if (section.width < needW || section.height < needH) section.resizeWithoutConstraints(Math.max(section.width, needW), Math.max(section.height, needH));
}

// Correspondencia maestra → clon por recorrido paralelo (misma estructura, tipos y nombres). En 'patch' esto también
// detecta cambios estructurales manuales en el clon: si la estructura no coincide, no se toca nada.
var toClone = {};
function walk(a, b) {
  if (a.type !== b.type || (a !== master && a.name !== b.name)) throw new Error('PCB_CLONE_STRUCTURE_MISMATCH ' + a.id);
  var ac = 'children' in a ? a.children : [];
  var bc = 'children' in b ? b.children : [];
  if (ac.length !== bc.length) throw new Error('PCB_CLONE_STRUCTURE_MISMATCH ' + a.id);
  idMap.push([a.id, b.id]);
  toClone[a.id] = b;
  for (var q = 0; q < ac.length; q++) walk(ac[q], bc[q]);
}
walk(master, clone);

function onClone(masterId) {
  var n = toClone[masterId];
  if (!n) throw new Error('PCB_NO_CLONE_NODE ' + masterId);
  if (masterIds[n.id]) throw new Error('PCB_REFUSED_MASTER_NODE ' + n.id);
  var up = n;
  while (up && up.id !== clone.id) up = up.parent;
  if (!up) throw new Error('PCB_NOT_IN_CLONE ' + n.id);
  return n;
}

var root = onClone(PLAN.masterNodeId);
if (root.width !== PLAN.target.width || root.height !== PLAN.target.height) {
  root.resizeWithoutConstraints(PLAN.target.width, PLAN.target.height);
  applied.push({ op: 'resize_root', cloneNodeId: root.id, masterNodeId: PLAN.masterNodeId, detail: { width: root.width, height: root.height } });
}
// Traslaciones ABSOLUTAS: posición en la maestra + desplazamiento del bloque (idempotente al reaplicar).
var CHANGED = {};
PLAN.effectResizes.forEach(function (e) { CHANGED[e.nodeId] = true; });
PLAN.vectorEdits.forEach(function (e) { CHANGED[e.nodeId] = true; });
for (var mi = 0; mi < PLAN.moves.length; mi++) {
  var mv = PLAN.moves[mi];
  for (var ni = 0; ni < mv.nodeIds.length; ni++) {
    var mNode = await figma.getNodeByIdAsync(mv.nodeIds[ni]);
    var node = onClone(mv.nodeIds[ni]);
    var before = { x: node.x, y: node.y };
    if (mNode.type === 'GROUP') {
      // La caja de un GROUP se deriva de sus hijos (cambia si se redimensiona o edita uno): se mide el desplazamiento
      // sobre un descendiente de REFERENCIA que no se redimensiona ni se edita, y se traslada el grupo por la diferencia.
      var ref = null;
      var cands = mNode.findAll(function (d) { return d.type !== 'GROUP'; });
      for (var ci = 0; ci < cands.length && !ref; ci++) if (!CHANGED[cands[ci].id]) ref = cands[ci];
      if (!ref) throw new Error('PCB_GROUP_WITHOUT_REFERENCE ' + mNode.id);
      var cRef = onClone(ref.id);
      var ex = ref.absoluteTransform[0][2] - master.absoluteTransform[0][2] + mv.dx;
      var ey = ref.absoluteTransform[1][2] - master.absoluteTransform[1][2] + mv.dy;
      var gx = ex - (cRef.absoluteTransform[0][2] - root.absoluteTransform[0][2]);
      var gy = ey - (cRef.absoluteTransform[1][2] - root.absoluteTransform[1][2]);
      if (gx !== 0) node.x = node.x + gx;
      if (gy !== 0) node.y = node.y + gy;
    } else {
      var tx0 = mNode.x + mv.dx, ty0 = mNode.y + mv.dy;
      if (node.x !== tx0) node.x = tx0;
      if (node.y !== ty0) node.y = ty0;
    }
    applied.push({ op: 'translate', cloneNodeId: node.id, masterNodeId: mv.nodeIds[ni], detail: { unitId: mv.unitId, dx: mv.dx, dy: mv.dy, before: before, after: { x: node.x, y: node.y } } });
  }
}
for (var ri = 0; ri < PLAN.effectResizes.length; ri++) {
  var er = PLAN.effectResizes[ri];
  var en = onClone(er.nodeId);
  var eb = { x: en.x, y: en.y, width: en.width, height: en.height };
  if (en.width !== er.width || en.height !== er.height) en.resize(er.width, er.height);
  en.x = er.x;
  en.y = er.y;
  applied.push({ op: 'resize_effect', cloneNodeId: en.id, masterNodeId: er.nodeId, detail: { before: eb, after: { x: en.x, y: en.y, width: en.width, height: en.height } } });
}
// Escala PROPORCIONAL de imágenes: tamaño final = tamaño en la maestra × factor (absoluto, idempotente); las pinturas
// no se tocan (el recorte de la imagen es relativo al nodo, así que la imagen escala sin deformarse).
for (var si = 0; si < PLAN.imageScales.length; si++) {
  var isc = PLAN.imageScales[si];
  var mIs = await figma.getNodeByIdAsync(isc.nodeId);
  var inode = onClone(isc.nodeId);
  var ib = { x: inode.x, y: inode.y, width: inode.width, height: inode.height };
  var tw = mIs.width * isc.scale, th = mIs.height * isc.scale;
  if (Math.abs(inode.width - tw) > 1e-6 || Math.abs(inode.height - th) > 1e-6) inode.resize(tw, th);
  inode.x = isc.x;
  inode.y = isc.y;
  applied.push({ op: 'scale_image', cloneNodeId: inode.id, masterNodeId: isc.nodeId, detail: { scale: isc.scale, before: ib, after: { x: inode.x, y: inode.y, width: inode.width, height: inode.height } } });
}

// Ediciones vectoriales de decoración (coordenadas del frame destino). Idempotentes: un vértice ya en su destino se
// deja; uno que no está ni en 'from' ni en 'to' indica un cambio ajeno (p. ej. manual) y detiene sin escribir ese nodo.
var FX = root.absoluteTransform[0][2], FY = root.absoluteTransform[1][2];
for (var vi = 0; vi < PLAN.vectorEdits.length; vi++) {
  var ve = PLAN.vectorEdits[vi];
  var vn = onClone(ve.nodeId);
  if (vn.type !== 'VECTOR') throw new Error('PCB_VECTOR_EDIT_TYPE ' + vn.type);
  var T = vn.absoluteTransform;
  var a = T[0][0], b = T[0][1], c = T[1][0], d = T[1][1], tx = T[0][2], ty = T[1][2], det = a * d - b * c;
  var toFrame = function (v) { return { x: a * v.x + b * v.y + tx - FX, y: c * v.x + d * v.y + ty - FY }; };
  var vecFrame = function (v) { return { x: a * v.x + b * v.y, y: c * v.x + d * v.y }; };
  var toLocal = function (p) { var X = p.x + FX - tx, Y = p.y + FY - ty; return { x: (d * X - b * Y) / det, y: (-c * X + a * Y) / det }; };
  var vecLocal = function (v) { return { x: (d * v.x - b * v.y) / det, y: (-c * v.x + a * v.y) / det }; };
  var net = JSON.parse(JSON.stringify(vn.vectorNetwork));
  var changes = [];
  if (ve.strokeWeight) {
    var sw = vn.strokeWeight;
    if (Math.abs(sw - ve.strokeWeight.to) > 1e-6) {
      if (Math.abs(sw - ve.strokeWeight.from) > 1e-6) throw new Error('PCB_STROKE_UNEXPECTED ' + ve.nodeId + ' ' + sw);
      vn.strokeWeight = ve.strokeWeight.to;
      changes.push({ strokeWeight: { from: sw, to: ve.strokeWeight.to } });
    }
  }
  for (var vv = 0; vv < ve.vertices.length; vv++) {
    var ev = ve.vertices[vv];
    var vert = net.vertices[ev.index];
    if (!vert) throw new Error('PCB_VERTEX_INDEX ' + ve.nodeId + '#' + ev.index);
    var cur = toFrame(vert);
    if (near(cur, ev.to, 0.5)) continue;
    if (!near(cur, ev.from, 0.5)) throw new Error('PCB_VERTEX_UNEXPECTED ' + ve.nodeId + '#' + ev.index + ' at ' + JSON.stringify(cur));
    var lp = toLocal(ev.to);
    vert.x = lp.x; vert.y = lp.y;
    changes.push({ vertex: ev.index, from: cur, to: ev.to });
  }
  for (var tt = 0; tt < ve.tangents.length; tt++) {
    var et = ve.tangents[tt];
    var sg = net.segments[et.segment];
    if (!sg || sg.start !== et.start || sg.end !== et.end) throw new Error('PCB_SEGMENT_MISMATCH ' + ve.nodeId + '#' + et.segment);
    var curT = vecFrame(sg[et.field]);
    if (near(curT, et.to, 0.5)) continue;
    sg[et.field] = vecLocal(et.to);
    changes.push({ segment: et.segment, field: et.field, from: curT, to: et.to });
  }
  if (changes.some(function (ch) { return !ch.strokeWeight; })) {
    if (typeof vn.setVectorNetworkAsync === 'function') await vn.setVectorNetworkAsync(net);
    else vn.vectorNetwork = net;
  }
  applied.push({ op: 'vector_edit', cloneNodeId: vn.id, masterNodeId: ve.nodeId, detail: { purpose: ve.purpose, changes: changes } });
}
} catch (e) {
  if (MODE !== 'patch') {
  clone.remove(); // PCB_DISCARD_OWN_CLONE
    throw new Error('PCB_ADAPT_FAILED_CLONE_DISCARDED ' + String(e && e.message ? e.message : e));
  }
  throw new Error('PCB_PATCH_FAILED ' + String(e && e.message ? e.message : e));
}

if (clone.parent !== section || section.parent !== page) throw new Error('PCB_OUTPUT_NOT_ON_MASTER_PAGE');
return {
  schema: 'pcb.adapt.result.v1', scriptVersion: SCRIPT_VERSION, mode: MODE, masterNodeId: master.id,
  sectionId: section.id, sectionCreated: sectionCreated, cloneId: clone.id, cloneName: clone.name,
  sourceCloneId: MODE === 'copy' ? source.id : null,
  idMap: idMap, fonts: fonts, applied: applied,
  master: { width: master.width, height: master.height, childCount: master.children.length, name: master.name }
};
`;

export function buildAdaptScript(plan: DemoPlan, out: AdaptOptions): string {
  const planData = {
    masterNodeId: plan.masterNodeId,
    masterName: plan.masterName,
    masterSize: plan.masterSize,
    target: { width: plan.target.width, height: plan.target.height },
    moves: plan.moves.map((m) => ({ unitId: m.unitId, nodeIds: m.nodeIds, dx: m.dx, dy: m.dy })),
    effectResizes: plan.effectResizes,
    vectorEdits: plan.vectorEdits ?? [],
    imageScales: plan.imageScales ?? [],
  };
  const mode = out.mode ?? 'create';
  if (mode === 'patch' && !out.existingCloneId) throw new Error('patch requiere existingCloneId');
  if (mode === 'copy' && !out.sourceCloneId) throw new Error('copy requiere sourceCloneId');
  const code = [
    `var PLAN = ${JSON.stringify(planData)};`,
    `var OUT = ${JSON.stringify({ sectionName: out.sectionName, cloneName: out.cloneName, gapFromContentPx: out.gapFromContentPx, existingCloneId: out.existingCloneId ?? null, sourceCloneId: out.sourceCloneId ?? null })};`,
    `var MODE = ${JSON.stringify(mode)};`,
    `var SCRIPT_VERSION = ${JSON.stringify(ADAPT_SCRIPT_VERSION)};`,
    // El plan solo traslada textos (el plan rechaza redimensionar texto): no hace falta cargar sus fuentes.
    `var FONT_REQUIRED = false;`,
    BODY,
  ].join('\n');
  const v = staticAdaptViolations(code);
  if (v.length > 0) throw new Error(`El script de adaptación contiene operaciones prohibidas: ${v.join(', ')}`);
  return code;
}
