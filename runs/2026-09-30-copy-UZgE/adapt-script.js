var PLAN = {"masterNodeId":"1:537","masterName":"960x1200_Taxdown_SVA2","masterSize":{"width":960,"height":1200},"target":{"width":1080,"height":1080},"moves":[{"unitId":"logo","nodeIds":["1:553"],"dx":0,"dy":-26},{"unitId":"message","nodeIds":["1:571","1:572"],"dx":60,"dy":-55},{"unitId":"photo","nodeIds":["1:539","1:542"],"dx":4.992645263671875,"dy":-55},{"unitId":"bottom","nodeIds":["1:549","1:550","1:552","1:540"],"dx":60,"dy":-144}],"effectResizes":[{"nodeId":"1:541","x":-15,"y":631,"width":1110,"height":449}]};
var OUT = {"sectionName":"PCB · Salida DEMO (no producción)","cloneName":"DEMO_1080x1080 · 960x1200_Taxdown_SVA2 · pendiente de revisión humana","gapFromContentPx":400};
var SCRIPT_VERSION = "pcb.adapt-script.v1";

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
if (section) {
  for (var j = 0; j < section.children.length; j++) {
    if (section.children[j].name === OUT.cloneName) throw new Error('PCB_DEMO_ALREADY_EXISTS ' + section.children[j].id);
  }
}

// Fuentes: se cargan las existentes. Si alguna falla, se detiene ANTES de clonar (no se sustituye ninguna).
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
  try { await figma.loadFontAsync(fn); fonts.push({ family: fn.family, style: fn.style, loaded: true, error: null }); }
  catch (e) { fontFailed = true; fonts.push({ family: fn.family, style: fn.style, loaded: false, error: String(e && e.message ? e.message : e) }); }
}
if (fontFailed) throw new Error('PCB_FONT_LOAD_FAILED ' + JSON.stringify(fonts));

var sectionCreated = false;
if (!section) {
  var maxRight = -Infinity;
  for (var p = 0; p < page.children.length; p++) {
    var bb = page.children[p].absoluteBoundingBox;
    if (bb && bb.x + bb.width > maxRight) maxRight = bb.x + bb.width;
  }
  section = figma.createSection();
  section.name = OUT.sectionName;
  section.x = Math.round(maxRight + OUT.gapFromContentPx);
  section.y = Math.round(master.absoluteBoundingBox.y - 100);
  section.resizeWithoutConstraints(PLAN.target.width + 200, PLAN.target.height + 200);
  sectionCreated = true;
}

var masterIds = {};
master.findAll(function () { return true; }).forEach(function (n) { masterIds[n.id] = true; });
masterIds[master.id] = true;

var clone = master.clone();
section.appendChild(clone);
clone.x = 100;
clone.y = 100;
clone.name = OUT.cloneName;

// Correspondencia maestra → clon por recorrido paralelo (misma estructura, tipos y nombres).
var idMap = [];
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

var applied = [];
var root = onClone(PLAN.masterNodeId);
root.resizeWithoutConstraints(PLAN.target.width, PLAN.target.height);
applied.push({ op: 'resize_root', cloneNodeId: root.id, masterNodeId: PLAN.masterNodeId, detail: { width: root.width, height: root.height } });

for (var mi = 0; mi < PLAN.moves.length; mi++) {
  var mv = PLAN.moves[mi];
  for (var ni = 0; ni < mv.nodeIds.length; ni++) {
    var node = onClone(mv.nodeIds[ni]);
    var before = { x: node.x, y: node.y };
    node.x = before.x + mv.dx;
    node.y = before.y + mv.dy;
    applied.push({ op: 'translate', cloneNodeId: node.id, masterNodeId: mv.nodeIds[ni], detail: { unitId: mv.unitId, dx: mv.dx, dy: mv.dy, before: before, after: { x: node.x, y: node.y } } });
  }
}
for (var ri = 0; ri < PLAN.effectResizes.length; ri++) {
  var er = PLAN.effectResizes[ri];
  var en = onClone(er.nodeId);
  var eb = { x: en.x, y: en.y, width: en.width, height: en.height };
  en.resize(er.width, er.height);
  en.x = er.x;
  en.y = er.y;
  applied.push({ op: 'resize_effect', cloneNodeId: en.id, masterNodeId: er.nodeId, detail: { before: eb, after: { x: en.x, y: en.y, width: en.width, height: en.height } } });
}

return {
  schema: 'pcb.adapt.result.v1', scriptVersion: SCRIPT_VERSION, masterNodeId: master.id,
  sectionId: section.id, sectionCreated: sectionCreated, cloneId: clone.id, cloneName: clone.name,
  idMap: idMap, fonts: fonts, applied: applied,
  master: { width: master.width, height: master.height, childCount: master.children.length, name: master.name }
};
