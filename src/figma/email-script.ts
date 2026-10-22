// Script use_figma de create-email-design: dibuja el plan en una sección de salida NUEVA (o reutilizada) del archivo
// destino. Garantías del propio script (además de email-check sobre su auditoría):
//  - Solo CREA nodos (sección, frames Email_<n>_Desktop/_Mobile/_Asunto/_Notas/_Componentes y su contenido). Nada
//    existente se modifica: las imágenes de origen solo se leen (imageHash).
//  - Fuentes: carga todas antes de crear nada; si falta una del email se detiene sin escribir (no sustituye fuentes).
//  - Auto layout en todos los contenedores, textos editables, componentes con variantes Breakpoint=Desktop/Mobile para
//    cabecera, pie y botones (instancias en el email), anotaciones con alt, URL y comportamiento responsive.
//  - Si algo falla, borra SOLO lo que acaba de crear y devuelve el error.
//  - Devuelve una auditoría de los nodos creados (tamaño, fuente, color, fondo efectivo, hash del texto).
// Por el límite de tamaño de use_figma (50 000 caracteres) el plan va compacto y se puede construir por partes.
import { EMAIL_RESULT_SCHEMA_ID, type EmailPlan, type PNode } from '../contracts/email.ts';
import { djb2 } from '../email/check.ts';

export const EMAIL_SCRIPT_VERSION = 'pcb.email-script.v1';
export const EMAIL_PARTS = ['desktop', 'mobile', 'extras'] as const;
export type EmailPart = (typeof EMAIL_PARTS)[number];
export const USE_FIGMA_MAX_CHARS = 50000;
const DISCARD = '// PCB_DISCARD_OWN_NODE';
export const FORBIDDEN_IN_EMAIL_SCRIPT = [
  '.remove(', 'setPluginData', 'setSharedPluginData', 'exportAsync', 'loadAllPagesAsync', 'createImage', 'detachInstance',
  'flatten(', 'swapComponent', 'insertCharacters', 'deleteCharacters', 'importComponentByKeyAsync', 'figma.notify',
];

export function staticEmailViolations(code: string): string[] {
  const scanned = code.split('\n').filter((l) => !l.includes(DISCARD)).join('\n');
  const v = FORBIDDEN_IN_EMAIL_SCRIPT.filter((f) => scanned.includes(f));
  if (/\bsrc\.\w+\s*=(?!=)/.test(scanned)) v.push('escritura sobre un nodo de imagen de origen');
  return v;
}

type Enc = Record<string, unknown>;
const COMP_NAMES: Record<string, string> = { header: 'Email/Cabecera', footer: 'Email/Pie', cta: 'Email/Botón primario', 'cta-secundario': 'Email/Botón secundario' };

/** Codifica el árbol en formato compacto; las claves de componente incluyen la firma de su estructura. */
function encode(n: PNode, fonts: string[]): Enc {
  const fi = (f: { family: string; style: string }) => { const k = `${f.family}|${f.style}`; let i = fonts.indexOf(k); if (i < 0) { fonts.push(k); i = fonts.length - 1; } return i; };
  const sig = (e: Enc): string => djb2(JSON.stringify(e, (k, v) => (['t', 'n', 'h', 'o', 'b', 'id', 'v'].includes(k) ? undefined : v)));
  switch (n.k) {
    case 'text': return { k: 't', n: n.name, t: n.text, f: fi(n.font), s: n.size, l: n.lineHeight, c: n.color.hex, a: n.align === 'CENTER' ? 'C' : 'L', d: n.underline ? 1 : 0, U: n.upper ? 1 : 0, h: n.url, o: n.note };
    case 'image': return { k: 'i', n: n.name, w: n.w, h: n.h, c: n.fallback.hex, b: n.label, id: n.figmaNodeId, o: n.note };
    case 'logo': return { k: 'g', n: n.name, w: n.w, h: n.h, v: n.svgId, b: n.label, o: n.note };
    case 'button': {
      const e: Enc = { k: 'b', n: n.name, w: n.w, h: n.h, c: n.fill.hex, r: n.border?.hex ?? null, R: n.radius, p: n.padX, x: encode(n.text, fonts), o: n.note };
      if (n.comp) e.m = `${n.comp}~${sig(e)}`;
      return e;
    }
    case 'frame': {
      const e: Enc = { k: 'f', n: n.name, d: n.dir, w: n.w, p: n.pad, g: n.gap, c: n.fill?.hex ?? null, a: n.align, ch: n.children.map((c) => encode(c, fonts)), o: n.note };
      if (n.comp) e.m = `${n.comp}~${sig(e)}`;
      return e;
    }
  }
}

const BODY = String.raw`
var page = await figma.getNodeByIdAsync(P.pageId);
if (!page || page.type !== 'PAGE') throw new Error('PCB_PAGE_NOT_FOUND ' + P.pageId);
await figma.setCurrentPageAsync(page);

var fontsInfo = [], missing = [];
var NOTE_FONTS = [{ family: 'Inter', style: 'Regular' }, { family: 'Inter', style: 'Bold' }];
var all = F.map(function (k) { var s = k.split('|'); return { family: s[0], style: s[1] }; });
for (var i0 = 0; i0 < all.length; i0++) {
  try { await figma.loadFontAsync(all[i0]); fontsInfo.push({ family: all[i0].family, style: all[i0].style, loaded: true, error: null }); }
  catch (e) { fontsInfo.push({ family: all[i0].family, style: all[i0].style, loaded: false, error: String(e && e.message ? e.message : e).split('\n')[0] }); missing.push(all[i0].family + ' ' + all[i0].style); }
}
if (missing.length) throw new Error('PCB_FONT_UNAVAILABLE ' + JSON.stringify(missing));
var noteFont = NOTE_FONTS;
try { await figma.loadFontAsync(NOTE_FONTS[0]); await figma.loadFontAsync(NOTE_FONTS[1]); } catch (e) { noteFont = [all[0], all[0]]; }

function solid(hex) { var n = parseInt(hex.slice(1), 16); return { type: 'SOLID', color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 } }; }
function hexOf(c) { function h(v) { var s = Math.round(v * 255).toString(16); return s.length < 2 ? '0' + s : s; } return ('#' + h(c.r) + h(c.g) + h(c.b)).toUpperCase(); }
function djb2(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); }
var ann = { ok: 0, failed: 0, error: null };
function annotate(node, md) {
  if (!md) return;
  try { node.annotations = (node.annotations || []).concat([{ labelMarkdown: md }]); ann.ok++; }
  catch (e) { ann.failed++; ann.error = String(e && e.message ? e.message : e).split('\n')[0]; }
}

// Sección de salida y frames existentes (no se duplican ni se tocan).
var section = null;
for (var s0 = 0; s0 < page.children.length; s0++) if (page.children[s0].type === 'SECTION' && page.children[s0].name === P.sectionName) section = page.children[s0];
var targets = [];
if (PARTS.indexOf('desktop') >= 0) targets.push(P.frames.desktop);
if (PARTS.indexOf('mobile') >= 0) targets.push(P.frames.mobile);
if (PARTS.indexOf('extras') >= 0) { targets.push(P.frames.subject); targets.push(P.frames.notes); }
if (section) for (var s1 = 0; s1 < section.children.length; s1++) if (targets.indexOf(section.children[s1].name) >= 0) {
  return { schema: SCHEMA, scriptVersion: VERSION, status: 'exists', sectionId: section.id, frames: { existing: section.children[s1].id }, components: [], audit: [], images: [], annotations: ann, fonts: fontsInfo, error: 'Ya existe ' + section.children[s1].name + ': cambia el nombre del email (versión) en el brief' };
}
var created = [], sectionCreated = false;
if (!section) {
  var maxRight = 0;
  for (var p0 = 0; p0 < page.children.length; p0++) { var bb = page.children[p0].absoluteBoundingBox; if (bb && bb.x + bb.width > maxRight) maxRight = bb.x + bb.width; }
  section = figma.createSection(); page.appendChild(section);
  section.name = P.sectionName; section.x = Math.round(maxRight + 400); section.y = 0;
  section.resizeWithoutConstraints(2000, 2000);
  sectionCreated = true;
}
function nextX() { var x = 100; for (var i = 0; i < section.children.length; i++) { var c = section.children[i]; if (c.x + c.width + 120 > x) x = c.x + c.width + 120; } return x; }
function topFrame(name, w, dir) {
  var f = figma.createAutoLayout(dir || 'VERTICAL'); section.appendChild(f);
  f.name = name; f.x = nextX(); f.y = 100; f.resize(w, 10);
  f.layoutSizingHorizontal = 'FIXED'; f.layoutSizingVertical = 'HUG'; f.itemSpacing = 0; f.clipsContent = false;
  created.push(f); return f;
}

var comps = null;
for (var s2 = 0; s2 < section.children.length; s2++) if (section.children[s2].name === P.frames.components) comps = section.children[s2];
var compsCreated = false;
function compsFrame() {
  if (comps) return comps;
  comps = topFrame(P.frames.components, 720); comps.itemSpacing = 64; comps.paddingTop = 40; comps.paddingBottom = 40; comps.paddingLeft = 40; comps.paddingRight = 40;
  comps.fills = [solid('#F2F2F2')]; comps.layoutSizingHorizontal = 'HUG'; compsCreated = true; return comps;
}
var masters = {}, newMasters = [], instCount = {};
if (comps) { var ex = comps.findAll(function (n) { return n.type === 'COMPONENT'; }); for (var e0 = 0; e0 < ex.length; e0++) { var mk = /pcb:key=(\S+)/.exec(ex[e0].description || ''); if (mk) masters[mk[1]] = ex[e0]; } }

var images = [], BP = null;
async function mkText(t, parent, fill) {
  var n = figma.createText(); parent.appendChild(n);
  var fs = F[t.f].split('|');
  n.fontName = { family: fs[0], style: fs[1] };
  n.characters = t.t; n.fontSize = t.s; n.lineHeight = { unit: 'PIXELS', value: t.l };
  n.fills = [solid(t.c)]; n.textAlignHorizontal = t.a === 'C' ? 'CENTER' : 'LEFT';
  if (t.U) n.textCase = 'UPPER';
  if (t.d) n.textDecoration = 'UNDERLINE';
  if (t.h && t.h.charAt(0) !== '#') { try { n.hyperlink = { type: 'URL', value: t.h }; } catch (e) {} }
  n.name = t.n;
  if (fill) { n.textAutoResize = 'HEIGHT'; n.layoutSizingHorizontal = 'FILL'; } else n.textAutoResize = 'WIDTH_AND_HEIGHT';
  annotate(n, [t.o, t.h ? 'URL: ' + t.h : null].filter(Boolean).join(' · '));
  return n;
}
async function mkImage(im, parent) {
  var f = figma.createAutoLayout('VERTICAL'); parent.appendChild(f);
  f.name = im.n; f.resize(im.w, im.h); f.layoutSizingHorizontal = 'FIXED'; f.layoutSizingVertical = 'FIXED';
  f.primaryAxisAlignItems = 'CENTER'; f.counterAxisAlignItems = 'CENTER'; f.fills = [solid(im.c)]; f.clipsContent = true;
  var placed = false, reason = 'asset pendiente';
  if (im.id) {
    var src = await figma.getNodeByIdAsync(im.id), hash = null;
    if (src && 'fills' in src && Array.isArray(src.fills)) for (var q = 0; q < src.fills.length; q++) if (src.fills[q].type === 'IMAGE' && src.fills[q].imageHash) hash = src.fills[q].imageHash;
    if (hash) { f.fills = [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FILL' }]; placed = true; reason = null; } else reason = 'el nodo ' + im.id + ' no contiene una imagen';
  }
  if (!placed) {
    f.fills = [solid('#D9D9D9')];
    var lb = figma.createText(); f.appendChild(lb);
    lb.fontName = noteFont[0]; lb.characters = im.b; lb.fontSize = 12; lb.fills = [solid('#4D4D4D')]; lb.textAlignHorizontal = 'CENTER';
    lb.name = 'PLACEHOLDER_etiqueta'; lb.resize(Math.max(40, im.w - 24), 20); lb.textAutoResize = 'HEIGHT';
  }
  images.push({ name: im.n, bp: BP, placed: placed, reason: reason });
  annotate(f, (placed ? '' : '**IMAGEN PENDIENTE** · ') + im.o);
  return f;
}
async function mkLogo(g, parent) {
  if (g.v && SVG[g.v]) {
    var n = figma.createNodeFromSvg(SVG[g.v]); parent.appendChild(n);
    n.name = g.n; n.rescale(g.w / n.width); return n;
  }
  var f = figma.createAutoLayout('VERTICAL'); parent.appendChild(f);
  f.name = g.n + ' [PENDIENTE]'; f.resize(g.w, g.h); f.layoutSizingHorizontal = 'FIXED'; f.layoutSizingVertical = 'FIXED';
  f.primaryAxisAlignItems = 'CENTER'; f.counterAxisAlignItems = 'CENTER'; f.fills = [solid('#D9D9D9')]; f.strokes = [solid('#8C8C8C')]; f.dashPattern = [4, 4];
  var lb = figma.createText(); f.appendChild(lb); lb.fontName = noteFont[0]; lb.characters = '[LOGO PENDIENTE] ' + g.b; lb.fontSize = 10; lb.fills = [solid('#4D4D4D')];
  lb.name = 'PLACEHOLDER_etiqueta';
  annotate(f, g.o);
  return f;
}
async function mkButton(b, parent) {
  var f = figma.createAutoLayout('HORIZONTAL'); parent.appendChild(f);
  f.name = b.n; f.paddingLeft = b.p; f.paddingRight = b.p; f.primaryAxisAlignItems = 'CENTER'; f.counterAxisAlignItems = 'CENTER';
  f.fills = [solid(b.c)]; if (b.r) { f.strokes = [solid(b.r)]; f.strokeWeight = 2; }
  f.cornerRadius = b.R; f.resize(b.w || 120, b.h);
  f.layoutSizingVertical = 'FIXED'; f.layoutSizingHorizontal = b.w ? 'FIXED' : 'HUG';
  await mkText(b.x, f, false);
  return f;
}
async function mkFrame(fr, parent) {
  var f = figma.createAutoLayout(fr.d === 'H' ? 'HORIZONTAL' : 'VERTICAL'); parent.appendChild(f);
  f.name = fr.n; f.resize(fr.w, 10); f.layoutSizingHorizontal = 'FIXED'; f.layoutSizingVertical = 'HUG';
  f.paddingTop = fr.p[0]; f.paddingRight = fr.p[1]; f.paddingBottom = fr.p[2]; f.paddingLeft = fr.p[3]; f.itemSpacing = fr.g;
  f.fills = fr.c ? [solid(fr.c)] : []; f.counterAxisAlignItems = fr.d === 'H' ? 'MIN' : fr.a; f.clipsContent = false;
  for (var i = 0; i < fr.ch.length; i++) await render(fr.ch[i], f, fr.d === 'V');
  annotate(f, fr.o);
  return f;
}
function textsOf(e, out) { if (e.k === 't') out.push(e); else if (e.k === 'b') out.push(e.x); else if (e.k === 'f') for (var i = 0; i < e.ch.length; i++) textsOf(e.ch[i], out); return out; }
async function render(e, parent, fillText) {
  if (e.m) {
    var key = e.m + '@' + BP, master = masters[key];
    if (!master) {
      var tmp = e.k === 'b' ? await mkButton(e, compsFrame()) : await mkFrame(e, compsFrame());
      master = figma.createComponentFromNode(tmp);
      master.name = 'Breakpoint=' + (BP === 'desktop' ? 'Desktop' : 'Mobile');
      master.description = 'pcb:key=' + key + ' · generado por create-email-design';
      masters[key] = master; newMasters.push({ base: e.m.split('~')[0], node: master });
    }
    var inst = master.createInstance(); parent.appendChild(inst);
    var want = textsOf(e, []), got = inst.findAll(function (n) { return n.type === 'TEXT' && n.name !== 'PLACEHOLDER_etiqueta'; });
    for (var i = 0; i < want.length && i < got.length; i++) {
      if (got[i].characters !== want[i].t) got[i].characters = want[i].t;
      if (got[i].name !== want[i].n) got[i].name = want[i].n;
      if (want[i].h && want[i].h.charAt(0) !== '#') { try { got[i].hyperlink = { type: 'URL', value: want[i].h }; } catch (x) {} }
    }
    inst.name = e.n;
    if (e.k === 'b' && !e.w) inst.layoutSizingHorizontal = 'HUG';
    var base = e.m.split('~')[0]; instCount[base] = (instCount[base] || 0) + 1;
    var tnotes = want.filter(function (t) { return t.o || t.h; }).map(function (t) { return t.n + ': ' + [t.o, t.h ? 'URL: ' + t.h : null].filter(Boolean).join(' · '); });
    annotate(inst, [e.o].concat(tnotes).filter(Boolean).join('\n'));
    return inst;
  }
  if (e.k === 't') return mkText(e, parent, fillText);
  if (e.k === 'i') return mkImage(e, parent);
  if (e.k === 'g') return mkLogo(e, parent);
  if (e.k === 'b') return mkButton(e, parent);
  return mkFrame(e, parent);
}
function noteText(parent, txt, bold, size) {
  var n = figma.createText(); parent.appendChild(n);
  n.fontName = bold ? noteFont[1] : noteFont[0]; n.characters = txt; n.fontSize = size || 13; n.lineHeight = { unit: 'PIXELS', value: Math.round((size || 13) * 1.45) };
  n.fills = [solid('#1F1F1F')]; n.textAutoResize = 'HEIGHT'; n.layoutSizingHorizontal = 'FILL'; return n;
}

var frames = {}, audit = [];
function auditFrame(root, bp) {
  function bgOf(n) { var p = n.parent; while (p && p.type !== 'SECTION' && p.type !== 'PAGE') { if ('fills' in p && Array.isArray(p.fills)) for (var i = 0; i < p.fills.length; i++) if (p.fills[i].type === 'SOLID' && p.fills[i].visible !== false) return hexOf(p.fills[i].color); p = p.parent; } return null; }
  audit.push({ bp: bp, id: root.id, name: root.name, type: root.type, w: root.width, h: root.height, size: null, font: null, color: null, bg: null, underline: null, chars: null, sha: null });
  var nodes = root.findAll(function (n) { return n.type === 'TEXT' || /^CTA/.test(n.name); });
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.type !== 'TEXT') { audit.push({ bp: bp, id: n.id, name: n.name, type: n.type, w: n.width, h: n.height, size: null, font: null, color: null, bg: null, underline: null, chars: null, sha: null }); continue; }
    var col = Array.isArray(n.fills) && n.fills[0] && n.fills[0].type === 'SOLID' ? hexOf(n.fills[0].color) : null;
    audit.push({ bp: bp, id: n.id, name: n.name, type: 'TEXT', w: Math.round(n.width), h: Math.round(n.height), size: typeof n.fontSize === 'number' ? n.fontSize : null,
      font: typeof n.fontName === 'object' && n.fontName.family ? n.fontName.family + ' ' + n.fontName.style : null, color: col, bg: bgOf(n),
      underline: n.textDecoration === 'UNDERLINE', chars: n.characters.length, sha: djb2(n.characters) });
  }
}

try {
  for (var b0 = 0; b0 < 2; b0++) {
    var bp = b0 === 0 ? 'desktop' : 'mobile';
    if (PARTS.indexOf(bp) < 0) continue;
    BP = bp;
    var root = topFrame(P.frames[bp], P.widths[bp]);
    root.fills = [solid(P.canvas)];
    for (var m0 = 0; m0 < T[bp].length; m0++) await render(T[bp][m0], root, true);
    frames[bp] = root.id;
    annotate(root, bp === 'desktop' ? 'Versión desktop (' + P.widths.desktop + ' px). Notas de desarrollo en ' + P.frames.notes : 'Versión mobile (' + P.widths.mobile + ' px de diseño; comprobar a 320 px)');
  }
  if (PARTS.indexOf('extras') >= 0) {
    BP = 'subject';
    var sj = topFrame(P.frames.subject, 600); sj.paddingTop = 24; sj.paddingBottom = 24; sj.paddingLeft = 24; sj.paddingRight = 24; sj.itemSpacing = 12; sj.fills = [solid('#FFFFFF')];
    noteText(sj, 'Asunto y preheader', true, 16);
    for (var k0 = 0; k0 < SUBJ.length; k0++) { noteText(sj, SUBJ[k0].label, true, 12); await mkText(SUBJ[k0].x, sj, true); }
    frames.subject = sj.id;
    var nt = topFrame(P.frames.notes, 560); nt.paddingTop = 32; nt.paddingBottom = 32; nt.paddingLeft = 32; nt.paddingRight = 32; nt.itemSpacing = 10; nt.fills = [solid('#FFF8DB')];
    noteText(nt, 'Notas de diseño y desarrollo — DEMO pendiente de revisión humana', true, 18);
    for (var n0 = 0; n0 < NOTES.length; n0++) { noteText(nt, NOTES[n0][0], true, 14); noteText(nt, NOTES[n0][1].length ? NOTES[n0][1].map(function (x) { return '• ' + x; }).join('\n') : '—', false, 12); }
    frames.notes = nt.id;
  }
  // Variantes por breakpoint en un conjunto por componente.
  var bases = {};
  for (var c0 = 0; c0 < newMasters.length; c0++) (bases[newMasters[c0].base] = bases[newMasters[c0].base] || []).push(newMasters[c0].node);
  var compsOut = [];
  for (var bk in bases) {
    var setName = CN[bk] || ('Email/' + bk), set = null;
    var sets = compsFrame().findAll(function (n) { return n.type === 'COMPONENT_SET' && n.name === setName; });
    var used = {};
    if (sets.length) { set = sets[0]; for (var u0 = 0; u0 < set.children.length; u0++) used[set.children[u0].name] = true; }
    for (var v0 = 0; v0 < bases[bk].length; v0++) { var nm = bases[bk][v0].name, k = 2; while (used[nm]) nm = bases[bk][v0].name + ' ' + (k++); bases[bk][v0].name = nm; used[nm] = true; }
    if (set) for (var v1 = 0; v1 < bases[bk].length; v1++) set.appendChild(bases[bk][v1]);
    else { set = figma.combineAsVariants(bases[bk], compsFrame()); set.name = setName; set.layoutMode = 'HORIZONTAL'; set.itemSpacing = 40; set.paddingTop = 24; set.paddingBottom = 24; set.paddingLeft = 24; set.paddingRight = 24; set.counterAxisSizingMode = 'AUTO'; set.primaryAxisSizingMode = 'AUTO'; }
    compsOut.push({ id: set.id, name: setName, instances: instCount[bk] || 0 });
  }
  // Recolocación final: los frames de esta llamada en fila (Desktop, Mobile, Asunto, Notas, Componentes) sin solaparse;
  // Componentes crece al añadir variantes y por eso va al final.
  var row = [frames.desktop, frames.mobile, frames.subject, frames.notes].filter(Boolean);
  if (compsCreated) row.push(comps.id);
  if (row.length) {
    var nodesRow = []; for (var r1 = 0; r1 < row.length; r1++) nodesRow.push(await figma.getNodeByIdAsync(row[r1]));
    var x0 = Math.min.apply(null, nodesRow.map(function (n) { return n.x; }));
    for (var r2 = 0; r2 < nodesRow.length; r2++) { nodesRow[r2].x = x0; nodesRow[r2].y = 100; x0 += nodesRow[r2].width + 120; }
  }
  if (frames.desktop) auditFrame(await figma.getNodeByIdAsync(frames.desktop), 'desktop');
  if (frames.mobile) auditFrame(await figma.getNodeByIdAsync(frames.mobile), 'mobile');
  if (frames.subject) auditFrame(await figma.getNodeByIdAsync(frames.subject), 'subject');
  var maxB = 0, maxR = 0; for (var z = 0; z < section.children.length; z++) { var ch = section.children[z]; if (ch.y + ch.height > maxB) maxB = ch.y + ch.height; if (ch.x + ch.width > maxR) maxR = ch.x + ch.width; }
  section.resizeWithoutConstraints(Math.max(section.width, maxR + 100), Math.max(section.height, maxB + 100));
  if (comps) frames.components = comps.id;
  return { schema: SCHEMA, scriptVersion: VERSION, status: 'created', sectionId: section.id, frames: frames, components: compsOut, audit: audit, images: images, annotations: ann, fonts: fontsInfo, error: null };
} catch (e) {
  var msg = String(e && e.message ? e.message : e);
  for (var r0 = created.length - 1; r0 >= 0; r0--) { try { if (!(created[r0] === comps && !compsCreated)) created[r0].remove(); } catch (x) {} } // PCB_DISCARD_OWN_NODE
  if (sectionCreated && section.children.length === 0) section.remove(); // PCB_DISCARD_OWN_NODE
  return { schema: SCHEMA, scriptVersion: VERSION, status: 'failed', sectionId: sectionCreated ? null : section.id, frames: {}, components: [], audit: [], images: images, annotations: ann, fonts: fontsInfo, error: msg + ' (se descartó lo creado en esta llamada)' };
}
`;

export function buildEmailScript(plan: EmailPlan, parts: readonly EmailPart[] = EMAIL_PARTS): string {
  if (plan.blockers.length) throw new Error(`El plan tiene bloqueos:\n${plan.blockers.map((b) => `- ${b}`).join('\n')}`);
  const fonts: string[] = [];
  const T = { desktop: parts.includes('desktop') ? plan.desktop.map((n) => encode(n, fonts)) : [], mobile: parts.includes('mobile') ? plan.mobile.map((n) => encode(n, fonts)) : [] };
  const SUBJ = parts.includes('extras') ? ([['Asunto', plan.subject.subject], ['Preheader', plan.subject.preheader]] as const).flatMap(([label, t]) => (t ? [{ label: `${label}${t.status === 'proposed' ? ' (PROPUESTA)' : t.status === 'placeholder' ? ' (PENDIENTE)' : ''}`, x: encode(t, fonts) }] : [])) : [];
  const n = plan.notes;
  const NOTES = parts.includes('extras') ? [
    ['Copys propuestos (pendientes de aprobación)', n.proposedCopy], ['Pendientes y placeholders', n.pending], ['Decisiones del encargo', n.decisions], ['Supuestos', n.assumptions],
    ['Responsive: cómo cambia mobile', n.responsive], ['Accesibilidad (WCAG 2.2 AA como referencia)', n.accessibility], ['Dark mode', n.darkMode], ['Para desarrollo', n.development],
    ['Reglas internas (no son normas de marca)', plan.internalRules], ['Conflictos en el conocimiento', plan.conflicts],
  ] : [];
  const P = { pageId: plan.pageId, sectionName: plan.sectionName, frames: plan.frames, widths: plan.widths, canvas: plan.canvasFill.hex };
  const usesSvg = JSON.stringify(T).includes('"v":"');
  const code = [
    `var P = ${JSON.stringify(P)};`,
    `var PARTS = ${JSON.stringify(parts)};`,
    `var F = ${JSON.stringify(fonts)};`,
    `var T = ${JSON.stringify(T)};`,
    `var SUBJ = ${JSON.stringify(SUBJ)};`,
    `var NOTES = ${JSON.stringify(NOTES)};`,
    `var SVG = ${JSON.stringify(usesSvg ? plan.svgs : {})};`,
    `var CN = ${JSON.stringify(COMP_NAMES)};`,
    `var VERSION = ${JSON.stringify(EMAIL_SCRIPT_VERSION)};`,
    `var SCHEMA = ${JSON.stringify(EMAIL_RESULT_SCHEMA_ID)};`,
    BODY,
  ].join('\n');
  const v = staticEmailViolations(code);
  if (v.length) throw new Error(`El script de email contiene operaciones no permitidas: ${v.join(', ')}`);
  return code;
}

/** Reparte la construcción en el menor número de llamadas que respetan el límite de use_figma. */
export function splitEmailScript(plan: EmailPlan): Array<{ parts: EmailPart[]; code: string }> {
  for (const group of [[['desktop', 'mobile', 'extras']], [['desktop', 'mobile'], ['extras']], [['desktop'], ['mobile'], ['extras']]] as EmailPart[][][]) {
    const calls = group.map((parts) => ({ parts, code: buildEmailScript(plan, parts) }));
    if (calls.every((c) => c.code.length <= USE_FIGMA_MAX_CHARS)) return calls;
  }
  const sizes = EMAIL_PARTS.map((p) => `${p}: ${buildEmailScript(plan, [p]).length}`).join(', ');
  throw new Error(`El email no cabe en llamadas de ${USE_FIGMA_MAX_CHARS} caracteres ni por partes (${sizes}): reducir módulos o el SVG del logo`);
}
