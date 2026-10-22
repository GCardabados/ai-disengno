// Script use_figma de create-master-creative (modo scratch): construye una pieza maestra NUEVA según el plan.
// Garantías que impone el propio script (además de master-check sobre la relectura):
//  - Solo CREA nodos (sección de salida si falta, frame de la pieza y sus hijos). Nunca modifica nodos existentes: la
//    imagen de origen solo se lee (su imageHash) y la sección existente solo recibe el frame nuevo.
//  - Fuentes: carga todas ANTES de crear nada; si falta alguna, se detiene sin escribir. Nunca sustituye una fuente.
//  - El logo se crea desde el SVG del brand kit y solo se escala proporcionalmente (rescale); no se recolorea.
//  - El texto se escribe tal cual (las mayúsculas se aplican con textCase, sin reescribir los caracteres).
//  - Si los textos no caben en su zona, descarta el frame que acaba de crear (única eliminación permitida) y falla.
//  - Reejecución: si ya existe un frame con ese nombre en la sección, no lo duplica ni lo toca ('exists').
import type { MasterPlan } from '../contracts/master.ts';
import { MASTER_RESULT_SCHEMA_ID } from '../contracts/master.ts';

export const MASTER_SCRIPT_VERSION = 'pcb.master-script.v1';
export const MASTER_DISCARD_LINE = '    frame.remove(); // PCB_DISCARD_OWN_FRAME';
export const FORBIDDEN_IN_MASTER_SCRIPT = [
  '.remove(', 'setPluginData', 'setSharedPluginData', 'exportAsync', 'loadAllPagesAsync', 'setCurrentPageAsync', 'detachInstance',
  'flatten(', 'swapComponent', 'setProperties', 'createImage', 'insertCharacters', 'deleteCharacters', 'setRangeFontName',
];

export function staticMasterViolations(code: string): string[] {
  const scanned = code.split('\n').filter((l) => l !== MASTER_DISCARD_LINE).join('\n');
  const v = FORBIDDEN_IN_MASTER_SCRIPT.filter((f) => scanned.includes(f));
  // Las únicas escrituras sobre nodos que no crea el script: appendChild en página/sección y el tamaño de la sección.
  if (/\bsrc\.\w+\s*=(?!=)/.test(scanned)) v.push('escritura sobre el nodo de la imagen de origen');
  return v;
}

const BODY = String.raw`
var page = await figma.getNodeByIdAsync(PLAN.pageId);
if (!page || page.type !== 'PAGE') throw new Error('PCB_PAGE_NOT_FOUND ' + PLAN.pageId);
await page.loadAsync();

// Fuentes: todas antes de crear nada; nunca se sustituye ninguna.
var fonts = [], missing = [];
for (var f0 = 0; f0 < FONTS.length; f0++) {
  try { await figma.loadFontAsync(FONTS[f0]); fonts.push({ family: FONTS[f0].family, style: FONTS[f0].style, loaded: true, error: null }); }
  catch (e) { var em = String(e && e.message ? e.message : e).split('\n')[0]; fonts.push({ family: FONTS[f0].family, style: FONTS[f0].style, loaded: false, error: em }); missing.push(FONTS[f0].family + ' ' + FONTS[f0].style); }
}
if (missing.length) throw new Error('PCB_FONT_UNAVAILABLE ' + JSON.stringify(missing));

// Imagen de origen: solo lectura de su imageHash.
if (PLAN.image) {
  var src = await figma.getNodeByIdAsync(PLAN.image.assetNodeId);
  var ok = src && 'fills' in src && Array.isArray(src.fills) && src.fills.some(function (p) { return p.type === 'IMAGE' && p.imageHash === PLAN.image.imageHash; });
  if (!ok) throw new Error('PCB_ASSET_CHANGED ' + PLAN.image.assetNodeId);
}

// Sección de salida (se crea una vez; se reutiliza si ya existe).
var section = null;
for (var i = 0; i < page.children.length; i++) if (page.children[i].type === 'SECTION' && page.children[i].name === PLAN.sectionName) section = page.children[i];
var sectionCreated = false;
if (!section) {
  var maxRight = 0;
  for (var p = 0; p < page.children.length; p++) { var bb = page.children[p].absoluteBoundingBox; if (bb && bb.x + bb.width > maxRight) maxRight = bb.x + bb.width; }
  section = figma.createSection();
  page.appendChild(section);
  section.name = PLAN.sectionName;
  section.x = Math.round(maxRight + 400); section.y = 0;
  section.resizeWithoutConstraints(PLAN.width + 200, PLAN.height + 200);
  sectionCreated = true;
}
for (var s0 = 0; s0 < section.children.length; s0++) if (section.children[s0].name === PLAN.frameName) {
  return { schema: SCHEMA, scriptVersion: SCRIPT_VERSION, status: 'exists', frameId: section.children[s0].id, frameName: PLAN.frameName, sectionId: section.id, sectionCreated: sectionCreated, nodes: {}, stack: null, fonts: fonts, error: null };
}

function solid(hex) { var n = parseInt(hex.slice(1), 16); return { type: 'SOLID', color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 } }; }
function mkText(t) {
  var tn = figma.createText();
  tn.name = t.name;
  tn.fontName = t.font;
  tn.characters = t.text;
  tn.fontSize = t.sizePx;
  tn.lineHeight = { unit: 'PERCENT', value: t.lineHeightPct };
  if (t.upper) tn.textCase = 'UPPER';
  tn.fills = [solid(t.color.hex)];
  return tn;
}

var frame = figma.createFrame();
section.appendChild(frame);
var nextX = 100;
for (var c0 = 0; c0 < section.children.length; c0++) { var sib = section.children[c0]; if (sib !== frame && sib.x + sib.width + 100 > nextX) nextX = sib.x + sib.width + 100; }
frame.name = PLAN.frameName;
frame.x = nextX; frame.y = 100;
frame.resize(PLAN.width, PLAN.height);
frame.clipsContent = true;
frame.fills = [solid(PLAN.background.hex)];
if (section.width < frame.x + PLAN.width + 100 || section.height < frame.y + PLAN.height + 100) section.resizeWithoutConstraints(Math.max(section.width, frame.x + PLAN.width + 100), Math.max(section.height, frame.y + PLAN.height + 100));

var nodes = {}, stackInfo = null;
try {
  if (PLAN.panel) {
    var pn = figma.createRectangle(); frame.appendChild(pn);
    pn.name = 'Panel'; pn.x = PLAN.panel.rect.x; pn.y = PLAN.panel.rect.y; pn.resize(PLAN.panel.rect.width, PLAN.panel.rect.height);
    pn.fills = [solid(PLAN.panel.color.hex)];
    nodes.Panel = pn.id;
  }
  if (PLAN.image) {
    var im = figma.createRectangle(); frame.appendChild(im);
    im.name = PLAN.image.name; im.x = PLAN.image.rect.x; im.y = PLAN.image.rect.y; im.resize(PLAN.image.rect.width, PLAN.image.rect.height);
    im.fills = [{ type: 'IMAGE', imageHash: PLAN.image.imageHash, scaleMode: 'FILL' }];
    nodes[PLAN.image.name] = im.id;
  }
  var lg = figma.createNodeFromSvg(PLAN.logo.svg); frame.appendChild(lg);
  lg.name = PLAN.logo.name;
  lg.rescale(PLAN.logo.rect.width / lg.width);
  lg.x = PLAN.logo.rect.x; lg.y = PLAN.logo.rect.y;
  nodes[PLAN.logo.name] = lg.id;

  var Z = PLAN.stack.zone;
  var st = figma.createFrame(); frame.appendChild(st);
  st.name = PLAN.stack.name; st.fills = []; st.clipsContent = false;
  st.layoutMode = 'VERTICAL'; st.primaryAxisSizingMode = 'AUTO'; st.counterAxisSizingMode = 'FIXED'; st.itemSpacing = PLAN.stack.gapPx;
  st.resize(Z.width, 10); st.x = Z.x; st.y = Z.y;
  nodes[PLAN.stack.name] = st.id;
  var items = PLAN.stack.texts.slice();
  if (PLAN.cta) items.splice(PLAN.stack.ctaIndex, 0, null);
  for (var k = 0; k < items.length; k++) {
    if (items[k] === null) {
      var cf = figma.createFrame(); st.appendChild(cf);
      cf.name = PLAN.cta.name; cf.layoutMode = 'HORIZONTAL'; cf.primaryAxisSizingMode = 'AUTO'; cf.counterAxisSizingMode = 'AUTO';
      cf.paddingLeft = PLAN.cta.padX; cf.paddingRight = PLAN.cta.padX; cf.paddingTop = PLAN.cta.padY; cf.paddingBottom = PLAN.cta.padY;
      cf.fills = [solid(PLAN.cta.fill.hex)];
      var ct = mkText(PLAN.cta.text); cf.appendChild(ct); ct.textAutoResize = 'WIDTH_AND_HEIGHT';
      cf.cornerRadius = PLAN.cta.radiusPx === null ? cf.height / 2 : PLAN.cta.radiusPx;
      if (cf.width > Z.width + 0.5) throw new Error('PCB_CTA_TOO_WIDE ' + cf.width);
      nodes[PLAN.cta.name] = cf.id; nodes[PLAN.cta.text.name] = ct.id;
      continue;
    }
    var tn = mkText(items[k]); st.appendChild(tn);
    tn.layoutSizingHorizontal = 'FILL'; tn.textAutoResize = 'HEIGHT';
    nodes[items[k].name] = tn.id;
  }
  stackInfo = { height: st.height, zoneHeight: Z.height };
  if (st.height > Z.height + 0.5) throw new Error('PCB_TEXT_DOES_NOT_FIT ' + JSON.stringify(stackInfo));
  st.y = PLAN.stack.anchor === 'bottom' ? Z.y + Z.height - st.height : Z.y;
} catch (e) {
  var msg = String(e && e.message ? e.message : e);
    frame.remove(); // PCB_DISCARD_OWN_FRAME
  return { schema: SCHEMA, scriptVersion: SCRIPT_VERSION, status: 'failed', frameId: null, frameName: PLAN.frameName, sectionId: section.id, sectionCreated: sectionCreated, nodes: {}, stack: stackInfo, fonts: fonts, error: msg + ' (frame descartado)' };
}
if (section.parent !== page) throw new Error('PCB_OUTPUT_NOT_ON_PAGE');
return { schema: SCHEMA, scriptVersion: SCRIPT_VERSION, status: 'created', frameId: frame.id, frameName: frame.name, sectionId: section.id, sectionCreated: sectionCreated, nodes: nodes, stack: stackInfo, fonts: fonts, error: null };
`;

export function buildMasterScript(plan: MasterPlan): string {
  if (plan.blockers.length) throw new Error(`El plan tiene bloqueos:\n${plan.blockers.map((b) => `- ${b}`).join('\n')}`);
  const fonts = [...new Map([...plan.stack.texts, ...(plan.cta ? [plan.cta.text] : [])].map((t) => [`${t.font.family}|${t.font.style}`, t.font])).values()];
  const code = [
    `var PLAN = ${JSON.stringify(plan)};`,
    `var FONTS = ${JSON.stringify(fonts)};`,
    `var SCRIPT_VERSION = ${JSON.stringify(MASTER_SCRIPT_VERSION)};`,
    `var SCHEMA = ${JSON.stringify(MASTER_RESULT_SCHEMA_ID)};`,
    BODY,
  ].join('\n');
  const v = staticMasterViolations(code);
  if (v.length) throw new Error(`El script de maestra contiene operaciones no permitidas: ${v.join(', ')}`);
  return code;
}
