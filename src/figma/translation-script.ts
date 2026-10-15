// Script use_figma del modo traducción (SOLO LECTURA): textos visibles de la maestra y de sus adaptaciones, en orden de
// lectura, con sus tramos de estilo, y si cada fuente se puede cargar. Sin estilos completos ni geometría, para gastar
// los mínimos tokens: el etiquetado (Texto 1, Texto 2…) lo hace el CLI (translation-table). No modifica el documento.
import { TRANSLATION_EXTRACT_SCHEMA_ID } from '../contracts/translation.ts';

export function buildTranslationExtractScript(masterId: string, otherIds: string[]): string {
  return `var MASTER_ID = ${JSON.stringify(masterId)};
var OTHER_IDS = ${JSON.stringify(otherIds)};
function framesOf(root) {
  return root.type === 'PAGE' || root.type === 'SECTION' ? root.children.filter(function (n) { return 'findAll' in n; }) : [root];
}
function shown(t, frame) { for (var n = t; n && n !== frame; n = n.parent) if (n.visible === false) return false; return true; }
function textsOf(frame) {
  return frame.findAllWithCriteria({ types: ['TEXT'] })
    .filter(function (t) { return shown(t, frame) && t.characters.trim(); })
    .sort(function (a, b) {
      var A = a.absoluteTransform, B = b.absoluteTransform;
      // Orden de lectura: por filas (tolerancia 8 px) y luego de izquierda a derecha.
      return Math.abs(A[1][2] - B[1][2]) > 8 ? A[1][2] - B[1][2] : A[0][2] - B[0][2];
    });
}
var SEG_FULL = ['fontName', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textCase', 'textDecoration',
  'paragraphSpacing', 'paragraphIndent', 'fills', 'listOptions', 'indentation', 'hyperlink', 'textStyleId', 'fillStyleId'];
var SEG_MIN = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'fills'];
var fontKeys = {}, fontList = [];
function rec(frame, t) {
  // Mismas propiedades que el inventario (read-script): el número de tramos coincide con el del encargo de variantes.
  var segs;
  try { segs = t.getStyledTextSegments(SEG_FULL); } catch (e) { segs = t.getStyledTextSegments(SEG_MIN); }
  var out = [];
  for (var i = 0; i < segs.length; i++) {
    var fn = segs[i].fontName;
    var k = fn ? fn.family + '|' + fn.style : null;
    if (k && !fontKeys[k]) { fontKeys[k] = true; fontList.push(fn); }
    out.push({ characters: segs[i].characters, family: fn ? fn.family : null, style: fn ? fn.style : null });
  }
  return { frameId: frame.id, nodeId: t.id, layer: t.name, characters: t.characters, segments: out };
}
var master = await figma.getNodeByIdAsync(MASTER_ID);
if (!master || !('findAll' in master)) throw new Error('PCB_MASTER_NOT_FOUND ' + MASTER_ID);
var frames = [], texts = [];
textsOf(master).forEach(function (t) { texts.push(rec(master, t)); });
for (var i = 0; i < OTHER_IDS.length; i++) {
  var root = await figma.getNodeByIdAsync(OTHER_IDS[i]);
  if (!root || !('findAll' in root)) throw new Error('PCB_FRAME_NOT_FOUND ' + OTHER_IDS[i]);
  var fs = framesOf(root);
  for (var j = 0; j < fs.length; j++) {
    if (fs[j].id === MASTER_ID) continue;
    frames.push({ nodeId: fs[j].id, name: fs[j].name, width: fs[j].width, height: fs[j].height });
    textsOf(fs[j]).forEach(function (t) { texts.push(rec(fs[j], t)); });
  }
}
// Comprobación de fuentes: se intenta cargar cada una; aquí nunca se sustituye nada.
var fonts = [];
for (var f = 0; f < fontList.length; f++) {
  try { await figma.loadFontAsync(fontList[f]); fonts.push({ family: fontList[f].family, style: fontList[f].style, loadable: true, error: null }); }
  catch (e) { fonts.push({ family: fontList[f].family, style: fontList[f].style, loadable: false, error: String(e && e.message ? e.message : e).split('\\n')[0] }); }
}
return { schema: ${JSON.stringify(TRANSLATION_EXTRACT_SCHEMA_ID)}, master: { nodeId: master.id, name: master.name, width: master.width, height: master.height }, frames: frames, texts: texts, fonts: fonts };
`;
}
