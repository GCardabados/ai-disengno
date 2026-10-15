// Scripts use_figma de la skill creative-content-variants.
//
// 1) Lectura de activos (SOLO LECTURA): imágenes de los nodos indicados y dimensiones de cada imagen por hash.
// 2) Escritura de variantes. Garantías que impone el propio script (además de la validación sobre la relectura):
//  - Verifica tipo, nombre y tamaño de la maestra; si no coinciden, no escribe.
//  - Cada variante se genera desde la MAESTRA (nunca desde otra variante) en un clon dentro de una sección de salida.
//    Todas las mutaciones pasan por onClone(id de la maestra), que rechaza nodos de la maestra o fuera del clon.
//  - Solo escribe en los nodos vinculados del plan: texto (por tramos, heredando el estilo de cada tramo; nunca asigna
//    fontName) e imagen (solo el imageHash y, según la política, el encaje). Ninguna otra operación.
//  - Fuentes: carga las de los textos que edita ANTES de clonar; si falta alguna, se detiene sin escribir. Única
//    excepción (traducciones): una sustituta AUTORIZADA en el plan para esa variante, aplicada solo en su copia, que se
//    nombra con el sufijo _PENDIENTE-FUENTE.
//  - No cabe ⇒ la variante falla (strict/reflow), o fit_text reduce el cuerpo de todos los tramos con el mismo factor
//    hasta el mínimo AUTORIZADO; nunca trunca ni usa elipsis.
//  - Si algo distinto de los nodos editados cambia de caja (auto layout, constraints), la variante falla
//    («requiere adaptación de diseño»).
//  - Fallo aislado: si una variante falla, se descarta SU clon (única eliminación permitida) y se sigue con las demás.
//  - Reejecución: si ya existe un clon con el nombre de la variante, no se duplica ni se toca ('exists').
//    'patch' reaplica sobre el clon indicado; antes comprueba que cada nodo vinculado está en el estado de la maestra o
//    en el destino (si no, hay un cambio manual y no se escribe nada de esa variante).
import type { VariantPlan } from '../variants/plan.ts';
import { VARIANT_ASSETS_SCHEMA_ID, VARIANT_RESULT_SCHEMA_ID } from '../contracts/variants.ts';
import { PENDING_FONT_SUFFIX } from '../contracts/translation.ts';

export const VARIANT_SCRIPT_VERSION = 'pcb.variant-script.v1';

export const VARIANT_DISCARD_LINE = '      clone.remove(); // PCB_DISCARD_OWN_CLONE';
export const VARIANT_ALLOWED_LINES = [
  VARIANT_DISCARD_LINE,
  "    tn.insertCharacters(sg.end, op.parts[i], 'BEFORE'); // PCB_VARIANT_TEXT (hereda el estilo del tramo)",
  '    tn.deleteCharacters(sg.start, sg.end); // PCB_VARIANT_TEXT',
  "    tn.textAutoResize = 'HEIGHT'; var mh = tn.height; tn.textAutoResize = 'NONE'; tn.resize(mT.width, mT.height); // PCB_TEXT_MEASURE",
  "    tn.resize(mT.width, tn.height); tn.textAutoResize = 'HEIGHT'; // PCB_TEXT_REFLOW",
  '    tn.setRangeFontSize(r.s, r.e, st.size * k); // PCB_TEXT_FIT',
  "    if (st.lh && st.lh.unit === 'PIXELS') tn.setRangeLineHeight(r.s, r.e, { unit: 'PIXELS', value: st.lh.value * k }); // PCB_TEXT_FIT",
  "    if (st.ls && st.ls.unit === 'PIXELS') tn.setRangeLetterSpacing(r.s, r.e, { unit: 'PIXELS', value: st.ls.value * k }); // PCB_TEXT_FIT",
  '  cn.fills = fills; // PCB_VARIANT_IMAGE',
  '      tn.setRangeFontName(fs[q].start, fs[q].end, fb); // PCB_FONT_FALLBACK (solo en la copia traducida, autorizado)',
];

export const FORBIDDEN_IN_VARIANT_SCRIPT = [
  '.remove(', 'setPluginData', 'setSharedPluginData', 'createImage', 'exportAsync', 'loadAllPagesAsync', 'setCurrentPageAsync',
  'detachInstance', 'flatten(', 'rescale(', 'insertCharacters', 'deleteCharacters', 'setRangeFontSize', 'setRangeLineHeight',
  'setRangeLetterSpacing', 'setRangeFontName', '.resize(', 'createText', 'createRectangle', 'createFrame', 'createComponent', 'swapComponent', 'setProperties',
];
/** Asignaciones prohibidas fuera de las líneas permitidas (una comparación `===` no cuenta). */
const FORBIDDEN_ASSIGNMENTS: Array<[string, RegExp]> = [
  ['fontName =', /fontName\s*=(?!=)/], ['.characters =', /\.characters\s*=(?!=)/], ['.fills =', /\.fills\s*=(?!=)/],
  ['textAutoResize =', /textAutoResize\s*=(?!=)/], ['figma.currentPage =', /figma\.currentPage\s*=(?!=)/],
];

export function staticVariantViolations(code: string): string[] {
  const allowed = new Set(VARIANT_ALLOWED_LINES);
  const scanned = code.split('\n').filter((l) => !allowed.has(l)).join('\n');
  return [...FORBIDDEN_IN_VARIANT_SCRIPT.filter((f) => scanned.includes(f)), ...FORBIDDEN_ASSIGNMENTS.filter(([, re]) => re.test(scanned)).map(([k]) => k)];
}

export function buildVariantAssetsScript(nodeIds: string[], hashes: string[]): string {
  return `var IDS = ${JSON.stringify(nodeIds)};
var HASHES = ${JSON.stringify(hashes)};
async function sizeOf(h) {
  try { var img = figma.getImageByHash(h); if (!img) return { found: false, width: null, height: null, error: 'no existe' };
    var sz = await img.getSizeAsync(); return { found: true, width: sz.width, height: sz.height, error: null }; }
  catch (e) { return { found: false, width: null, height: null, error: String(e && e.message ? e.message : e).split('\\n')[0] }; }
}
var nodes = [];
for (var i = 0; i < IDS.length; i++) {
  var n = await figma.getNodeByIdAsync(IDS[i]);
  if (!n) { nodes.push({ nodeId: IDS[i], found: false, type: null, width: null, height: null, images: [] }); continue; }
  var images = [];
  var fills = ('fills' in n && Array.isArray(n.fills)) ? n.fills : [];
  for (var p = 0; p < fills.length; p++) {
    if (fills[p].type !== 'IMAGE') continue;
    var s = fills[p].imageHash ? await sizeOf(fills[p].imageHash) : { width: null, height: null, error: 'sin imageHash' };
    images.push({ paintIndex: p, hash: fills[p].imageHash || null, visible: fills[p].visible !== false, width: s.width, height: s.height, error: s.error });
  }
  nodes.push({ nodeId: n.id, found: true, type: n.type, width: 'width' in n ? n.width : null, height: 'height' in n ? n.height : null, images: images });
}
var hs = [];
for (var h = 0; h < HASHES.length; h++) { var r = await sizeOf(HASHES[h]); hs.push({ hash: HASHES[h], found: r.found, width: r.width, height: r.height, error: r.error }); }
return { schema: ${JSON.stringify(VARIANT_ASSETS_SCHEMA_ID)}, nodes: nodes, hashes: hs };
`;
}

export interface VariantScriptOptions {
  /** Subconjunto de variantes (por defecto, todas las 'ready'). */
  variantIds?: string[];
  mode?: 'create' | 'patch';
  /** Solo 'patch': variantId → id del clon existente. */
  existingCloneIds?: Record<string, string>;
  gapFromContentPx?: number;
}

const BODY = String.raw`
var master = await figma.getNodeByIdAsync(PLAN.masterNodeId);
if (!master) throw new Error('PCB_MASTER_NOT_FOUND');
if (master.type !== 'FRAME') throw new Error('PCB_MASTER_TYPE ' + master.type);
if (master.name !== PLAN.masterName) throw new Error('PCB_MASTER_NAME_MISMATCH');
if (master.width !== PLAN.width || master.height !== PLAN.height) throw new Error('PCB_MASTER_SIZE_MISMATCH ' + master.width + 'x' + master.height);
var page = master.parent;
while (page && page.type !== 'PAGE') page = page.parent;
if (!page) throw new Error('PCB_MASTER_NOT_ON_PAGE');
await page.loadAsync();

// Comprobaciones previas de la maestra: los nodos vinculados siguen diciendo lo que dice el plan.
for (var v0 = 0; v0 < VARIANTS.length; v0++) for (var o0 = 0; o0 < VARIANTS[v0].ops.length; o0++) {
  var op0 = VARIANTS[v0].ops[o0];
  var mn0 = await figma.getNodeByIdAsync(op0.nodeId);
  if (!mn0) throw new Error('PCB_FIELD_NODE_NOT_FOUND ' + op0.nodeId);
  if (op0.kind === 'text' && (mn0.type !== 'TEXT' || mn0.characters !== op0.masterCharacters)) throw new Error('PCB_MASTER_TEXT_CHANGED ' + op0.nodeId);
  if (op0.kind === 'image' && (!mn0.fills[op0.paintIndex] || mn0.fills[op0.paintIndex].imageHash !== op0.masterHash)) throw new Error('PCB_MASTER_IMAGE_CHANGED ' + op0.nodeId);
}

// Fuentes de los textos que se editan: se cargan ANTES de clonar; nunca se sustituye ninguna salvo una sustituta
// autorizada en el plan para esa variante (traducciones), que solo se usa si la original no carga.
var usersOf = {};
for (var u0 = 0; u0 < VARIANTS.length; u0++) for (var u1 = 0; u1 < VARIANTS[u0].ops.length; u1++) {
  var uo = VARIANTS[u0].ops[u1];
  if (uo.kind === 'text') (usersOf[uo.nodeId] = usersOf[uo.nodeId] || []).push(VARIANTS[u0].variantId);
}
var fonts = [], fontState = {}, missing = [], FAILED = {};
for (var f0 = 0; f0 < FONT_NODE_IDS.length; f0++) {
  var ft = await figma.getNodeByIdAsync(FONT_NODE_IDS[f0]);
  var fsg = ft.getStyledTextSegments(['fontName']);
  for (var f1 = 0; f1 < fsg.length; f1++) {
    var fnm = fsg[f1].fontName, key = fnm.family + '\u0000' + fnm.style;
    if (!(key in fontState)) {
      try { await figma.loadFontAsync(fnm); fontState[key] = true; fonts.push({ family: fnm.family, style: fnm.style, loaded: true, error: null }); }
      catch (e) { fontState[key] = String(e && e.message ? e.message : e).split('\n')[0]; fonts.push({ family: fnm.family, style: fnm.style, loaded: false, error: fontState[key] }); }
    }
    if (fontState[key] === true) continue;
    var us = usersOf[ft.id] || [];
    for (var f2 = 0; f2 < us.length; f2++) {
      var fbk = FALLBACKS[us[f2]] && FALLBACKS[us[f2]][key];
      if (!fbk) { missing.push({ nodeId: ft.id, variantId: us[f2], family: fnm.family, style: fnm.style, error: fontState[key] }); continue; }
      try { await figma.loadFontAsync(fbk); }
      catch (e2) { missing.push({ nodeId: ft.id, variantId: us[f2], family: fnm.family, style: fnm.style, error: 'la sustituta autorizada ' + fbk.family + ' ' + fbk.style + ' tampoco carga: ' + String(e2 && e2.message ? e2.message : e2).split('\n')[0] }); continue; }
      (FAILED[us[f2]] = FAILED[us[f2]] || {})[key] = fbk;
    }
  }
}
if (missing.length > 0) throw new Error('PCB_FONT_UNAVAILABLE ' + JSON.stringify(missing));

// Sección de salida (se crea una vez; se reutiliza si ya existe).
var section = null;
for (var i = 0; i < page.children.length; i++) if (page.children[i].type === 'SECTION' && page.children[i].name === OUT.sectionName) section = page.children[i];
var sectionCreated = false;
if (!section) {
  var maxRight = -Infinity;
  for (var p = 0; p < page.children.length; p++) { var bb = page.children[p].absoluteBoundingBox; if (bb && bb.x + bb.width > maxRight) maxRight = bb.x + bb.width; }
  section = figma.createSection();
  page.appendChild(section);
  section.name = OUT.sectionName;
  section.x = Math.round(maxRight + OUT.gapFromContentPx);
  section.y = Math.round(master.absoluteBoundingBox.y - 100);
  section.resizeWithoutConstraints(PLAN.width + 200, PLAN.height + 200);
  sectionCreated = true;
}

var masterIds = {};
master.findAll(function () { return true; }).forEach(function (n) { masterIds[n.id] = true; });
masterIds[master.id] = true;
function relBox(n, root) { var r = root.absoluteBoundingBox, b = n.absoluteBoundingBox; return b ? { x: b.x - r.x, y: b.y - r.y, w: b.width, h: b.height } : null; }
var masterBox = {};
master.findAll(function () { return true; }).forEach(function (n) { masterBox[n.id] = relBox(n, master); });
var masterNode = {};
master.findAll(function () { return true; }).forEach(function (n) { masterNode[n.id] = n; });

function focal(nw, nh, iw, ih, fx, fy) {
  var na = nw / nh, ia = iw / ih, cw = Math.min(1, na / ia), ch = Math.min(1, ia / na);
  return [[cw, 0, Math.min(Math.max(fx - cw / 2, 0), 1 - cw)], [0, ch, Math.min(Math.max(fy - ch / 2, 0), 1 - ch)]];
}

var results = [];
for (var vi = 0; vi < VARIANTS.length; vi++) {
  var V = VARIANTS[vi];
  var pendingName = V.cloneName + PENDING_SUFFIX, usesFallback = !!FAILED[V.variantId];
  var existing = null;
  for (var j = 0; j < section.children.length; j++) if (section.children[j].name === V.cloneName || section.children[j].name === pendingName) existing = section.children[j];
  if (MODE === 'create' && existing) { results.push({ variantId: V.variantId, status: 'exists', cloneId: existing.id, cloneName: V.cloneName, applied: [], error: null }); continue; }
  var clone = null;
  if (MODE === 'patch') {
    if (!existing || existing.id !== EXISTING[V.variantId]) { results.push({ variantId: V.variantId, status: 'failed', cloneId: null, cloneName: V.cloneName, applied: [], error: 'PCB_PATCH_TARGET_NOT_FOUND ' + EXISTING[V.variantId] }); continue; }
    clone = existing;
  }
  var applied = [];
  var wrote = false;
  try {
    if (MODE === 'create') {
      clone = master.clone();
      var nextX = 100;
      for (var sc = 0; sc < section.children.length; sc++) { var sib = section.children[sc]; if (sib !== clone && sib.x + sib.width + 100 > nextX) nextX = sib.x + sib.width + 100; }
      section.appendChild(clone);
      clone.x = nextX; clone.y = 100; clone.name = usesFallback ? pendingName : V.cloneName;
      var needW = clone.x + PLAN.width + 100, needH = clone.y + PLAN.height + 100;
      if (section.width < needW || section.height < needH) section.resizeWithoutConstraints(Math.max(section.width, needW), Math.max(section.height, needH));
    }
    // Correspondencia maestra → clon por recorrido paralelo (misma estructura, tipos y nombres).
    var toClone = {};
    var walk = function (a, b) {
      if (a.type !== b.type || (a !== master && a.name !== b.name)) throw new Error('PCB_CLONE_STRUCTURE_MISMATCH ' + a.id);
      var ac = 'children' in a ? a.children : [], bc = 'children' in b ? b.children : [];
      if (ac.length !== bc.length) throw new Error('PCB_CLONE_STRUCTURE_MISMATCH ' + a.id);
      toClone[a.id] = b;
      for (var q = 0; q < ac.length; q++) walk(ac[q], bc[q]);
    };
    walk(master, clone);
    var onClone = function (id) {
      var n = toClone[id];
      if (!n) throw new Error('PCB_NO_CLONE_NODE ' + id);
      if (masterIds[n.id]) throw new Error('PCB_REFUSED_MASTER_NODE ' + n.id);
      var up = n; while (up && up.id !== clone.id) up = up.parent;
      if (!up) throw new Error('PCB_NOT_IN_CLONE ' + n.id);
      return n;
    };
    // Estado previo de cada nodo vinculado: el de la maestra o el destino (si no, es un cambio manual: no se escribe).
    for (var g = 0; g < V.ops.length; g++) {
      var og = V.ops[g], ng = onClone(og.nodeId);
      if (og.kind === 'text' && ng.characters !== og.masterCharacters && ng.characters !== og.characters) throw new Error('PCB_TEXT_UNEXPECTED ' + og.nodeId);
      if (og.kind === 'image') { var hg = ng.fills[og.paintIndex] && ng.fills[og.paintIndex].imageHash; if (hg !== og.masterHash && hg !== og.targetHash) throw new Error('PCB_IMAGE_UNEXPECTED ' + og.nodeId); }
    }
    wrote = true;
    if (usesFallback && clone.name !== pendingName) clone.name = pendingName;
    for (var oi = 0; oi < V.ops.length; oi++) {
      var op = V.ops[oi];
      if (op.kind === 'text') applied.push(await applyText(op, onClone(op.nodeId), masterNode[op.nodeId], clone, FAILED[V.variantId]));
      else applied.push(await applyImage(op, onClone(op.nodeId)));
    }
    // Nada más puede haber cambiado de caja (auto layout, constraints): si no, requiere adaptación de diseño.
    // Los GROUP que contienen un texto editado derivan su caja de él: no desplazan nada más.
    var edited = {};
    V.ops.forEach(function (o) {
      if (o.kind !== 'text') return;
      edited[o.nodeId] = true;
      for (var up = masterNode[o.nodeId].parent; up && up !== master && up.type === 'GROUP'; up = up.parent) edited[up.id] = true;
    });
    var shifted = [];
    for (var id in masterBox) {
      if (edited[id] || !masterBox[id]) continue;
      var cb = relBox(toClone[id], clone), mb = masterBox[id];
      if (!cb || Math.abs(cb.x - mb.x) > 0.01 || Math.abs(cb.y - mb.y) > 0.01 || Math.abs(cb.w - mb.w) > 0.01 || Math.abs(cb.h - mb.h) > 0.01) shifted.push(id);
    }
    if (shifted.length) throw new Error('PCB_LAYOUT_SHIFT requiere adaptación de diseño: ' + shifted.slice(0, 12).join(','));
    var vfb = [], vfk = {};
    applied.forEach(function (a) { (a.detail.fontFallbacks || []).forEach(function (x) { var k = x.from.family + '\u0000' + x.from.style; if (!vfk[k]) { vfk[k] = true; vfb.push(x); } }); });
    var okRes = { variantId: V.variantId, status: MODE === 'patch' ? 'patched' : 'created', cloneId: clone.id, cloneName: clone.name, applied: applied, error: null };
    if (vfb.length) okRes.fontFallbacks = vfb;
    results.push(okRes);
  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    if (MODE === 'create' && clone) {
      clone.remove(); // PCB_DISCARD_OWN_CLONE
      results.push({ variantId: V.variantId, status: 'failed', cloneId: null, cloneName: V.cloneName, applied: [], error: msg + ' (clon descartado)' });
    } else {
      results.push({ variantId: V.variantId, status: 'failed', cloneId: clone ? clone.id : null, cloneName: V.cloneName, applied: applied, error: msg + (wrote ? ' (PATCH PARCIAL: el clon puede estar a medias; no es una salida válida)' : ' (no se escribió nada)') });
    }
  }
}

async function applyText(op, tn, mT, clone, failed) {
  // Sustituta autorizada (solo traducciones y solo si la original no cargó): antes de escribir, porque un texto con
  // una fuente sin cargar no admite cambios de caracteres. Solo en la copia; nunca en la maestra.
  var used = [];
  if (failed) {
    var fs = tn.getStyledTextSegments(['fontName']);
    for (var q = 0; q < fs.length; q++) {
      var fb = failed[fs[q].fontName.family + '\u0000' + fs[q].fontName.style];
      if (!fb) continue;
      tn.setRangeFontName(fs[q].start, fs[q].end, fb); // PCB_FONT_FALLBACK (solo en la copia traducida, autorizado)
      used.push({ from: { family: fs[q].fontName.family, style: fs[q].fontName.style }, to: { family: fb.family, style: fb.style } });
    }
  }
  if (tn.characters !== op.characters) {
    for (var i = op.segments.length - 1; i >= 0; i--) {
    var sg = op.segments[i];
    tn.insertCharacters(sg.end, op.parts[i], 'BEFORE'); // PCB_VARIANT_TEXT (hereda el estilo del tramo)
    tn.deleteCharacters(sg.start, sg.end); // PCB_VARIANT_TEXT
    }
  }
  if (tn.characters !== op.characters) throw new Error('PCB_TEXT_WRITE_MISMATCH ' + op.nodeId);
  // Rangos nuevos de cada tramo y estilo de origen (de la maestra) para fit_text.
  var ranges = [], pos = 0;
  for (var r0 = 0; r0 < op.parts.length; r0++) { ranges.push({ s: pos, e: pos + op.parts[r0].length, ms: op.segments[r0].start, me: op.segments[r0].end }); pos += op.parts[r0].length; }
  var limitH = op.policy.mode === 'reflow' && op.policy.maxHeightPx ? op.policy.maxHeightPx : mT.height;
  if (op.policy.mode === 'reflow' && mT.textAutoResize === 'WIDTH_AND_HEIGHT' && tn.width > mT.width + 0.5) {
    tn.resize(mT.width, tn.height); tn.textAutoResize = 'HEIGHT'; // PCB_TEXT_REFLOW
  }
  function measure() {
    if (tn.textAutoResize === 'NONE' || tn.textAutoResize === 'TRUNCATE') {
    tn.textAutoResize = 'HEIGHT'; var mh = tn.height; tn.textAutoResize = 'NONE'; tn.resize(mT.width, mT.height); // PCB_TEXT_MEASURE
      return { fits: mh <= limitH + 0.5, width: mT.width, height: mh };
    }
    var wOk = tn.textAutoResize !== 'WIDTH_AND_HEIGHT' || tn.width <= mT.width + 0.5;
    return { fits: wOk && tn.height <= limitH + 0.5, width: tn.width, height: tn.height };
  }
  function setScale(k) {
    for (var q = 0; q < ranges.length; q++) {
      var r = ranges[q];
      if (r.e <= r.s) continue;
      var st = { size: mT.getRangeFontSize(r.ms, r.me), lh: mT.getRangeLineHeight(r.ms, r.me), ls: mT.getRangeLetterSpacing(r.ms, r.me) };
    tn.setRangeFontSize(r.s, r.e, st.size * k); // PCB_TEXT_FIT
    if (st.lh && st.lh.unit === 'PIXELS') tn.setRangeLineHeight(r.s, r.e, { unit: 'PIXELS', value: st.lh.value * k }); // PCB_TEXT_FIT
    if (st.ls && st.ls.unit === 'PIXELS') tn.setRangeLetterSpacing(r.s, r.e, { unit: 'PIXELS', value: st.ls.value * k }); // PCB_TEXT_FIT
    }
  }
  var k = 1, m;
  if (op.policy.mode === 'fit_text') {
    setScale(1);
    m = measure();
    while (!m.fits) {
      var nk = Math.round((k - 0.02) * 1000) / 1000;
      if (nk < op.policy.minScale - 1e-9) break;
      k = nk; setScale(k); m = measure();
    }
  } else m = measure();
  if (!m.fits) throw new Error('PCB_TEXT_DOES_NOT_FIT ' + op.nodeId + ' ' + JSON.stringify({ policy: op.policy.mode, scale: k, width: m.width, height: m.height, boxWidth: mT.width, maxHeight: limitH }));
  // Ancho automático fuera de auto layout: se conserva el anclaje según la alineación de la maestra.
  var par = tn.parent;
  if (tn.textAutoResize === 'WIDTH_AND_HEIGHT' && !(par && 'layoutMode' in par && par.layoutMode !== 'NONE')) {
    var mb = masterBox[op.nodeId], cb = relBox(tn, clone);
    var want = mT.textAlignHorizontal === 'CENTER' ? mb.x + mb.w / 2 - cb.w / 2 : mT.textAlignHorizontal === 'RIGHT' ? mb.x + mb.w - cb.w : mb.x;
    if (Math.abs(want - cb.x) > 0.001) tn.x = tn.x + (want - cb.x);
  }
  return { op: op.policy.mode === 'fit_text' && k < 1 ? 'fit_text' : op.policy.mode === 'reflow' ? 'reflow_text' : 'replace_text', cloneNodeId: tn.id, masterNodeId: op.nodeId, detail: { fieldId: op.fieldId, scale: k, width: tn.width, height: tn.height, autoResize: tn.textAutoResize, fontFallbacks: used } };
}

async function applyImage(op, cn) {
  var fills = JSON.parse(JSON.stringify(cn.fills));
  var pt = fills[op.paintIndex];
  if (!pt || pt.type !== 'IMAGE') throw new Error('PCB_IMAGE_PAINT_MISSING ' + op.nodeId);
  var img = figma.getImageByHash(op.targetHash);
  if (!img) throw new Error('PCB_ASSET_UNAVAILABLE ' + op.targetHash);
  var size = await img.getSizeAsync();
  var before = { imageHash: pt.imageHash, scaleMode: pt.scaleMode };
  pt.imageHash = op.targetHash;
  if (op.policy.mode === 'fill') { pt.scaleMode = 'FILL'; delete pt.imageTransform; delete pt.scalingFactor; }
  if (op.policy.mode === 'focal_point') { pt.scaleMode = 'CROP'; delete pt.scalingFactor; pt.imageTransform = focal(cn.width, cn.height, size.width, size.height, op.policy.x, op.policy.y); }
  if (op.policy.mode === 'frame_window') {
    // Recorte que cubre la ventana visible y, fuera de ella, queda recortado por el frame (la capa no se mueve).
    var w = op.window, c = focal(w.width, w.height, size.width, size.height, op.policy.x, op.policy.y);
    pt.scaleMode = 'CROP'; delete pt.scalingFactor;
    pt.imageTransform = [[c[0][0] / w.uw, 0, c[0][2] - c[0][0] * w.u0 / w.uw], [0, c[1][1] / w.vh, c[1][2] - c[1][1] * w.v0 / w.vh]];
  }
  cn.fills = fills; // PCB_VARIANT_IMAGE
  return { op: 'replace_image', cloneNodeId: cn.id, masterNodeId: op.nodeId, detail: { fieldId: op.fieldId, before: before, after: { imageHash: pt.imageHash, scaleMode: pt.scaleMode }, imageSize: size, policy: op.policy.mode } };
}

if (section.parent !== page) throw new Error('PCB_OUTPUT_NOT_ON_MASTER_PAGE');
return { schema: SCHEMA, scriptVersion: SCRIPT_VERSION, mode: MODE, masterNodeId: master.id, sectionId: section.id, sectionCreated: sectionCreated, fonts: fonts, variants: results };
`;

export function buildVariantScript(plan: VariantPlan, o: VariantScriptOptions = {}): string {
  const mode = o.mode ?? 'create';
  const chosen = plan.variants.filter((v) => v.status === 'ready' && (!o.variantIds || o.variantIds.includes(v.variantId)));
  const notReady = (o.variantIds ?? []).filter((id) => !chosen.some((v) => v.variantId === id));
  if (notReady.length) throw new Error(`Variantes no listas o desconocidas: ${notReady.join(', ')} (ver bloqueos del plan)`);
  if (chosen.length === 0) throw new Error('No hay variantes listas para generar');
  if (mode === 'patch') {
    const miss = chosen.filter((v) => !o.existingCloneIds?.[v.variantId]).map((v) => v.variantId);
    if (miss.length) throw new Error(`patch requiere el clon existente de: ${miss.join(', ')}`);
  }
  const fontNodeIds = [...new Set(chosen.flatMap((v) => v.ops.filter((x) => x.kind === 'text').map((x) => x.nodeId)))].sort();
  const fallbacks = Object.fromEntries(chosen.flatMap((v) => {
    const m = Object.fromEntries(v.ops.flatMap((x) => (x.kind === 'text' ? x.fontFallbacks ?? [] : [])).map((x) => [`${x.from.family}\u0000${x.from.style}`, x.to]));
    return Object.keys(m).length ? [[v.variantId, m]] : [];
  }));
  const code = [
    `var PLAN = ${JSON.stringify({ masterNodeId: plan.master.nodeId, masterName: plan.master.name, width: plan.master.width, height: plan.master.height })};`,
    `var VARIANTS = ${JSON.stringify(chosen.map((v) => ({ variantId: v.variantId, cloneName: v.cloneName, ops: v.ops })))};`,
    `var OUT = ${JSON.stringify({ sectionName: plan.sectionName, gapFromContentPx: o.gapFromContentPx ?? 400 })};`,
    `var MODE = ${JSON.stringify(mode)};`,
    `var EXISTING = ${JSON.stringify(o.existingCloneIds ?? {})};`,
    `var FONT_NODE_IDS = ${JSON.stringify(fontNodeIds)};`,
    `var FALLBACKS = ${JSON.stringify(fallbacks)};`,
    `var PENDING_SUFFIX = ${JSON.stringify(PENDING_FONT_SUFFIX)};`,
    `var SCRIPT_VERSION = ${JSON.stringify(VARIANT_SCRIPT_VERSION)};`,
    `var SCHEMA = ${JSON.stringify(VARIANT_RESULT_SCHEMA_ID)};`,
    BODY,
  ].join('\n');
  const v = staticVariantViolations(code);
  if (v.length) throw new Error(`El script de variantes contiene operaciones no permitidas: ${v.join(', ')}`);
  return code;
}
