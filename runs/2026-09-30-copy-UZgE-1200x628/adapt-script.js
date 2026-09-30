var PLAN = {"masterNodeId":"1:537","masterName":"960x1200_Taxdown_SVA2","masterSize":{"width":960,"height":1200},"target":{"width":1200,"height":628},"moves":[{"unitId":"logo","nodeIds":["1:553"],"dx":-36,"dy":-36},{"unitId":"message","nodeIds":["1:571","1:572"],"dx":-56,"dy":-79},{"unitId":"photo","nodeIds":["1:539","1:542"],"dx":605.9926452636719,"dy":-490},{"unitId":"offer","nodeIds":["1:549","1:540"],"dx":355,"dy":-431},{"unitId":"cta","nodeIds":["1:550"],"dx":-89,"dy":-580},{"unitId":"info","nodeIds":["1:552"],"dx":-2,"dy":-594}],"effectResizes":[{"nodeId":"1:541","x":-15,"y":250,"width":1230,"height":378}],"vectorEdits":[]};
var OUT = {"sectionName":"PCB · Salida DEMO (no producción)","cloneName":"DEMO_1200x628 · 960x1200_Taxdown_SVA2 · pendiente de revisión humana","gapFromContentPx":400,"existingCloneId":null};
var MODE = "create";
var SCRIPT_VERSION = "pcb.adapt-script.v5";
var FONT_REQUIRED = false;

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
if (section) {
  for (var j = 0; j < section.children.length; j++) {
    if (section.children[j].name === OUT.cloneName) existing = section.children[j];
  }
}
if (MODE === 'create' && existing) throw new Error('PCB_DEMO_ALREADY_EXISTS ' + existing.id);
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

var clone = MODE === 'create' ? master.clone() : existing;
var idMap = [];
var applied = [];

function near(p, q, tol) { return Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol; }

try {
if (MODE === 'create') {
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
for (var mi = 0; mi < PLAN.moves.length; mi++) {
  var mv = PLAN.moves[mi];
  for (var ni = 0; ni < mv.nodeIds.length; ni++) {
    var mNode = await figma.getNodeByIdAsync(mv.nodeIds[ni]);
    var node = onClone(mv.nodeIds[ni]);
    var before = { x: node.x, y: node.y };
    var tx0 = mNode.x + mv.dx, ty0 = mNode.y + mv.dy;
    if (node.x !== tx0) node.x = tx0;
    if (node.y !== ty0) node.y = ty0;
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
  if (changes.length > 0) {
    if (typeof vn.setVectorNetworkAsync === 'function') await vn.setVectorNetworkAsync(net);
    else vn.vectorNetwork = net;
  }
  applied.push({ op: 'vector_edit', cloneNodeId: vn.id, masterNodeId: ve.nodeId, detail: { purpose: ve.purpose, changes: changes } });
}
} catch (e) {
  if (MODE === 'create') {
  clone.remove(); // PCB_DISCARD_OWN_CLONE
    throw new Error('PCB_ADAPT_FAILED_CLONE_DISCARDED ' + String(e && e.message ? e.message : e));
  }
  throw new Error('PCB_PATCH_FAILED ' + String(e && e.message ? e.message : e));
}

if (clone.parent !== section || section.parent !== page) throw new Error('PCB_OUTPUT_NOT_ON_MASTER_PAGE');
return {
  schema: 'pcb.adapt.result.v1', scriptVersion: SCRIPT_VERSION, mode: MODE, masterNodeId: master.id,
  sectionId: section.id, sectionCreated: sectionCreated, cloneId: clone.id, cloneName: clone.name,
  idMap: idMap, fonts: fonts, applied: applied,
  master: { width: master.width, height: master.height, childCount: master.children.length, name: master.name }
};
