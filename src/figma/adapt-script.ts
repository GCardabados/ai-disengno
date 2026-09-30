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
//  - No duplica: si ya existe un clon con el mismo nombre en la sección de salida, se detiene.
import type { DemoPlan } from '../demo/plan.ts';

export const ADAPT_SCRIPT_VERSION = 'pcb.adapt-script.v3';

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
if (section) {
  for (var j = 0; j < section.children.length; j++) {
    if (section.children[j].name === OUT.cloneName) throw new Error('PCB_DEMO_ALREADY_EXISTS ' + section.children[j].id);
  }
}

// Fuentes: se intenta cargar las existentes; nunca se sustituye ninguna. Solo se exige la carga si el plan toca la
// maquetación de un texto (FONT_REQUIRED); si hace falta y falla, se detiene ANTES de clonar.
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

var clone = master.clone();
var idMap = [];
var applied = [];
try {
section.appendChild(clone);
clone.x = 100;
clone.y = 100;
clone.name = OUT.cloneName;

// Correspondencia maestra → clon por recorrido paralelo (misma estructura, tipos y nombres).
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
} catch (e) {
  clone.remove(); // PCB_DISCARD_OWN_CLONE
  throw new Error('PCB_ADAPT_FAILED_CLONE_DISCARDED ' + String(e && e.message ? e.message : e));
}

if (clone.parent !== section || section.parent !== page) throw new Error('PCB_OUTPUT_NOT_ON_MASTER_PAGE');
return {
  schema: 'pcb.adapt.result.v1', scriptVersion: SCRIPT_VERSION, masterNodeId: master.id,
  sectionId: section.id, sectionCreated: sectionCreated, cloneId: clone.id, cloneName: clone.name,
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
  };
  const code = [
    `var PLAN = ${JSON.stringify(planData)};`,
    `var OUT = ${JSON.stringify(out)};`,
    `var SCRIPT_VERSION = ${JSON.stringify(ADAPT_SCRIPT_VERSION)};`,
    // El plan solo traslada textos (el plan rechaza redimensionar texto): no hace falta cargar sus fuentes.
    `var FONT_REQUIRED = false;`,
    BODY,
  ].join('\n');
  const v = staticAdaptViolations(code);
  if (v.length > 0) throw new Error(`El script de adaptación contiene operaciones prohibidas: ${v.join(', ')}`);
  return code;
}
