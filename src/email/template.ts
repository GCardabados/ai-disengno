// Emails desde bloques y plantillas del cliente (ck.email-blocks.v1) + brief completo (pcb.email-template-brief.v1).
// 1) resolveComposition: plantilla o composición propia → bloques con la variante exacta según idioma, canal y legal.
// 2) checkTemplateBrief: qué falta (huecos sin copy, imágenes), qué es inválido y qué es un riesgo; nada se inventa.
// 3) buildTemplateFillScript: script use_figma que crea el email con INSTANCIAS de los bloques, rellena los huecos y
//    devuelve una auditoría. Solo crea nodos nuevos; si falla, borra lo que acaba de crear.
// 4) verifyTemplateResult: la auditoría coincide con el brief (textos por hash, mediador según canal, sin huecos vacíos).
import { hashOf } from '../hash/canonical.ts';
import { quote } from '../variants/discover.ts';
import type { Copy } from '../contracts/email.ts';
import { EMAIL_TEMPLATE_RESULT_SCHEMA_ID, type CatalogBlock, type EmailBlocksCatalog, type EmailTemplateBrief, type EmailTemplateResult, type SlotValue } from '../contracts/email-template.ts';
import { PLACEHOLDER_RE, unsourcedClaims } from './brief.ts';
import { djb2 } from './check.ts';

export interface TplIssue { code: string; severity: 'blocking' | 'pending' | 'warning'; message: string }
export interface ResolvedBlock {
  at: number; name: string; block: CatalogBlock | null; variant: string | null; componentId: string | null; visible: boolean;
  slots: string[]; content: EmailTemplateBrief['content'][number] | null;
}

/** Placeholders de los bloques vacíos (los que escribe el constructor de bloques). */
export const BLOCK_PLACEHOLDERS = ['Título del bloque', 'Texto del bloque: sustituir por el copy del brief.', 'Texto destacado', 'TEXTO DEL CTA', 'Nota o aclaración', 'Texto de cierre personalizado', 'Notas legales de la campaña (opcional): notas numeradas, bases o condiciones de la promoción.'];

const copyOf = (v: SlotValue): Copy => (typeof v === 'string' ? { text: v, source: 'brief', note: null } : v);
const props = (variant: string | null): Record<string, string> => Object.fromEntries((variant ?? '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => p.split('=').map((x) => x.trim()) as [string, string]));
const variantName = (p: Record<string, string>, order: string[]) => order.map((k) => `${k}=${p[k]}`).join(', ');

export const templateBriefHash = (b: EmailTemplateBrief): string => { const { confirmation: _c, ...rest } = b; return hashOf('pcb.email-template-brief', rest); };

export function resolveComposition(b: EmailTemplateBrief, cat: EmailBlocksCatalog, issues: TplIssue[]): ResolvedBlock[] {
  let seq: Array<{ block: string; variant: string | null }>;
  if ('template' in b.composition) {
    const key = b.composition.template;
    const t = cat.templates.find((x) => x.key === key || x.name === key);
    if (!t) { issues.push({ code: 'TEMPLATE_UNKNOWN', severity: 'blocking', message: `No existe la plantilla «${key}»; plantillas: ${cat.templates.map((x) => x.key).join(', ')}` }); return []; }
    seq = t.blocks;
  } else seq = b.composition.blocks;
  const canal = cat.options.canal[b.canal];
  return seq.map((s, at) => {
    const block = cat.blocks.find((x) => x.name === s.block) ?? null;
    const content = b.content.find((c) => c.at === at) ?? null;
    if (!block) { issues.push({ code: 'BLOCK_UNKNOWN', severity: 'blocking', message: `Posición ${at}: no existe el bloque «${s.block}»` }); return { at, name: s.block, block, variant: null, componentId: null, visible: false, slots: [], content }; }
    let variant: string | null = null, comp = block.variants[0]!;
    if (block.type === 'COMPONENT_SET') {
      const order = Object.keys(props(block.variants[0]!.name));
      const want = { ...props(s.variant ?? block.variants[0]!.name) };
      // «Personalizado» elegido en la composición se respeta (el cierre lleva texto propio); si no, manda el idioma del brief.
      if ('Idioma' in want && want.Idioma !== 'Personalizado') want.Idioma = b.idioma;
      if ('Entidad' in want) want.Entidad = b.legal;
      if (canal && canal.block === block.name && canal.set) Object.assign(want, canal.set);
      // Un cierre con texto propio usa la variante «Personalizado».
      if (content && Object.keys(content.slots).length && block.variants.some((v) => props(v.name).Idioma === 'Personalizado')) want.Idioma = 'Personalizado';
      const name = variantName(want, order);
      const v = block.variants.find((x) => x.name === name);
      if (!v) issues.push({ code: 'VARIANT_MISSING', severity: 'blocking', message: `${block.name}: no hay variante «${name}» (disponibles: ${block.variants.map((x) => x.name).join(' | ')})` });
      else { comp = v; variant = name; }
    }
    const hiddenByCanal = !!(canal && canal.block === block.name && canal.hide);
    return { at, name: block.name, block, variant, componentId: comp.componentId, visible: !hiddenByCanal && !(content?.omit), slots: comp.slots.map((x) => x.id), content };
  });
}

export function checkTemplateBrief(b: EmailTemplateBrief, cat: EmailBlocksCatalog): { issues: TplIssue[]; blocks: ResolvedBlock[]; ready: boolean } {
  const issues: TplIssue[] = [];
  const add = (code: string, severity: TplIssue['severity'], message: string) => issues.push({ code, severity, message });
  if (b.client !== cat.client) add('CLIENT_MISMATCH', 'blocking', `El brief es de ${b.client} y el catálogo de ${cat.client}`);
  if (cat.status !== 'validated') add('CATALOG_DRAFT', 'warning', 'Catálogo de bloques en borrador: el resultado es una propuesta');
  if (!cat.options.idioma.includes(b.idioma)) add('IDIOMA_UNKNOWN', 'blocking', `Idioma «${b.idioma}» no disponible (${cat.options.idioma.join(', ')})`);
  const canal = cat.options.canal[b.canal];
  if (!canal) add('CANAL_UNKNOWN', 'blocking', `Canal «${b.canal}» no disponible (${Object.keys(cat.options.canal).join(', ')})`);
  else if (canal.onlyIdioma && !canal.onlyIdioma.includes(b.idioma)) add('CANAL_IDIOMA', 'blocking', `El canal ${b.canal} solo existe en ${canal.onlyIdioma.join(', ')} en las referencias`);
  if (!cat.options.legal.includes(b.legal)) add('LEGAL_UNKNOWN', 'blocking', `Variante legal «${b.legal}» no disponible (${cat.options.legal.join(' | ')})`);
  const blocks = resolveComposition(b, cat, issues);
  // Contenido: posiciones, huecos conocidos, copys con origen.
  const sourced = b.content.flatMap((c) => Object.values(c.slots).map(copyOf)).concat([b.subject, b.preheader]).filter((c) => c.source === 'brief' || c.source === 'client_approved').map((c) => c.text).join(' \u0000 ');
  for (const c of b.content) {
    const r = blocks.find((x) => x.at === c.at);
    if (!r) { add('CONTENT_AT_UNKNOWN', 'blocking', `Contenido para la posición ${c.at}, que no existe en la composición`); continue; }
    if (r.name !== c.block) add('CONTENT_BLOCK_MISMATCH', 'blocking', `Posición ${c.at}: el contenido es para «${c.block}» pero ahí va «${r.name}»`);
    const ids = new Set(r.slots);
    for (const k of [...Object.keys(c.slots), ...Object.keys(c.images), ...c.hide]) if (!ids.has(k)) add('SLOT_UNKNOWN', 'blocking', `${r.name} (pos. ${c.at}): no tiene el hueco ${k} (huecos: ${r.slots.join(', ') || 'ninguno'})`);
    for (const k of Object.keys(c.links)) if (!c.slots[k] && !ids.has(k)) add('LINK_SLOT_UNKNOWN', 'blocking', `${r.name}: enlace para ${k}, que no es un hueco`);
    for (const [k, v] of Object.entries(c.slots)) {
      const cp = copyOf(v);
      if (cp.source === 'placeholder' && !PLACEHOLDER_RE.test(cp.text)) add('PLACEHOLDER_NOT_MARKED', 'blocking', `${r.name} · ${k}: un placeholder debe empezar por «[PENDIENTE»`);
      if (cp.source === 'agent_draft') { const u = unsourcedClaims(cp.text, sourced); if (u.length) add('COMMERCIAL_CLAIM_UNSOURCED', 'blocking', `${r.name} · ${k}: el borrador incluye ${u.join(', ')} sin fuente en el brief`); }
      if (BLOCK_PLACEHOLDERS.includes(cp.text)) add('COPY_IS_BLOCK_PLACEHOLDER', 'blocking', `${r.name} · ${k}: el copy es el texto de ejemplo del bloque`);
    }
  }
  // Huecos variables sin copy ni imagen, enlaces de CTA y avisos de idioma.
  for (const r of blocks) {
    if (!r.block || !r.visible) continue;
    const c = r.content;
    for (const s of r.slots) {
      const done = c && (s in c.slots || s in c.images || c.hide.includes(s));
      if (!done) add('SLOT_EMPTY', 'pending', `${r.name} (pos. ${r.at}): falta ${s}${r.block.variants.find((v) => v.componentId === r.componentId)?.slots.find((x) => x.id === s)?.example ? ` (ej.: ${quote(r.block.variants.find((v) => v.componentId === r.componentId)!.slots.find((x) => x.id === s)!.example!, 50)})` : ''}`);
      if (/^cta_/.test(s) && c && s in c.slots && !c.links[s]) add('URL_MISSING', 'warning', `${r.name}: CTA ${s} sin URL → «#FALTA-URL»`);
    }
    if (b.idioma !== 'CAST' && /Saludo|saludo/.test(r.name)) add('GREETING_CAST', 'warning', `${r.name}: el saludo fijo «¡Hola, #Nombre!» está en castellano (no hay variante ${b.idioma})`);
  }
  // Los placeholders se permiten (se montan como «[PENDIENTE…]» con anotación), pero se listan para que no pasen por copy.
  const ph = b.content.flatMap((c) => Object.entries(c.slots).filter(([, v]) => copyOf(v).source === 'placeholder').map(([k]) => `${k}@${c.at}`));
  for (const [n, cp] of [['asunto', b.subject], ['preheader', b.preheader]] as const) if (cp.source === 'placeholder') ph.push(n);
  if (ph.length) add('PLACEHOLDERS', 'warning', `${ph.length} textos siguen como [PENDIENTE] y se montarán así: ${ph.join(', ')}`);
  if (b.subject.text.length > 60) add('SUBJECT_LONG', 'warning', `Asunto de ${b.subject.text.length} caracteres`);
  if (b.preheader.text.length < 40 || b.preheader.text.length > 100) add('PREHEADER_LENGTH', 'warning', `Preheader de ${b.preheader.text.length} caracteres (recomendado 40–100)`);
  if (!b.confirmation) add('BRIEF_NOT_CONFIRMED', 'pending', 'Falta la confirmación del brief');
  else if (b.confirmation.hash !== templateBriefHash(b)) add('BRIEF_CHANGED', 'pending', 'El brief cambió después de confirmarlo');
  return { issues, blocks, ready: !issues.some((i) => i.severity !== 'warning') };
}

/** «**negrita**» → texto plano + rangos en negrita. */
export function parseBold(src: string): { text: string; bold: Array<[number, number]> } {
  const bold: Array<[number, number]> = []; let text = '', i = 0;
  for (const part of src.split('**')) { if (i % 2 === 1 && part) bold.push([text.length, text.length + part.length]); text += part; i++; }
  return { text, bold };
}

const BODY = String.raw`
var page = await figma.getNodeByIdAsync(P.pageId);
if (!page || page.type !== 'PAGE') throw new Error('PCB_PAGE_NOT_FOUND');
await figma.setCurrentPageAsync(page);
for (var f0 = 0; f0 < FONTS.length; f0++) await figma.loadFontAsync(FONTS[f0]);
var ANN = 0;
function ann(n, md) { try { n.annotations = (n.annotations || []).concat([{ labelMarkdown: md }]); ANN++; } catch (e) {} }
function solid(h) { var n = parseInt(h.slice(1), 16); return { type: 'SOLID', color: { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 } }; }
function djb2(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); }
var SUBS = { 'Arial': 'Arimo', 'Helvetica': 'Arimo', 'Georgia': 'Gelasio', 'Publico Headline': 'Gelasio' };
function fixFonts(t) {
  var segs = t.getStyledTextSegments(['fontName']);
  if (!segs.some(function (s) { return SUBS[s.fontName.family]; })) return;
  var base = SUBS[segs[0].fontName.family] || segs[0].fontName.family;
  t.setRangeFontName(0, t.characters.length, { family: base, style: 'Regular' });
}
var section = null;
for (var s0 = 0; s0 < page.children.length; s0++) if (page.children[s0].type === 'SECTION' && page.children[s0].name === P.sectionName) section = page.children[s0];
if (section) for (var s1 = 0; s1 < section.children.length; s1++) if (section.children[s1].name === P.name) return { schema: SCHEMA, status: 'exists', frameId: section.children[s1].id, subjectFrameId: null, sectionId: section.id, blocks: [], slots: [], placeholdersLeft: [], annotations: 0, error: 'Ya existe un email con ese nombre en la sección' };
var created = [], sectionCreated = false;
if (!section) {
  var maxR = 0; for (var p0 = 0; p0 < page.children.length; p0++) { var b0 = page.children[p0].absoluteBoundingBox; if (b0 && b0.x + b0.width > maxR) maxR = b0.x + b0.width; }
  section = figma.createSection(); page.appendChild(section); section.name = P.sectionName; section.x = Math.round(maxR + 400); section.y = 0; section.resizeWithoutConstraints(2000, 2000); sectionCreated = true;
}
var nx = 100; for (var s2 = 0; s2 < section.children.length; s2++) { var c2 = section.children[s2]; if (c2.x + c2.width + 160 > nx) nx = c2.x + c2.width + 160; }
var blocksOut = [], slotsOut = [], left = [];
try {
  var fr = figma.createAutoLayout('VERTICAL'); section.appendChild(fr); created.push(fr);
  fr.name = P.name; fr.x = nx; fr.y = 100; fr.resize(P.canvas.emailWidth, 100); fr.layoutSizingHorizontal = 'FIXED'; fr.layoutSizingVertical = 'HUG';
  fr.paddingTop = P.canvas.paddingTop; fr.paddingLeft = P.canvas.gutter; fr.paddingRight = P.canvas.gutter; fr.paddingBottom = 0; fr.itemSpacing = P.canvas.gap; fr.counterAxisAlignItems = 'CENTER';
  fr.fills = [solid(P.canvas.background)];
  for (var i = 0; i < P.entries.length; i++) {
    var e = P.entries[i];
    var comp = await figma.getNodeByIdAsync(e.componentId);
    if (!comp || comp.type !== 'COMPONENT') throw new Error('PCB_BLOCK_NOT_FOUND ' + e.name + ' ' + e.componentId);
    var inst = comp.createInstance(); fr.appendChild(inst);
    inst.name = e.name.replace(/^[A-Z]+\//, ''); inst.visible = e.visible;
    blocksOut.push({ at: e.at, id: inst.id, name: e.name, variant: e.variant, visible: e.visible });
    var nodes = inst.findAll(function (n) { return /^slot:/.test(n.name); });
    function slotNode(id) { for (var k = 0; k < nodes.length; k++) if (nodes[k].name === 'slot:' + id) return nodes[k]; return null; }
    for (var sid in e.texts) {
      var t = slotNode(sid), v = e.texts[sid];
      if (!t || t.type !== 'TEXT') { slotsOut.push({ at: e.at, slot: sid, kind: 'text', ok: false, sha: null, font: null, error: 'hueco no encontrado' }); continue; }
      try {
        fixFonts(t);
        var fam = t.getStyledTextSegments(['fontName'])[0].fontName.family;
        t.characters = v.t;
        if (v.b.length) { t.setRangeFontName(0, t.characters.length, { family: fam, style: 'Regular' }); for (var r = 0; r < v.b.length; r++) t.setRangeFontName(v.b[r][0], v.b[r][1], { family: fam, style: 'Bold' }); }
        if (e.links[sid]) { try { t.hyperlink = { type: 'URL', value: e.links[sid] }; } catch (x) {} }
        ann(t, (v.s === 'agent_draft' ? '**PROPUESTA** · ' : v.s === 'placeholder' ? '**PENDIENTE** · ' : '') + (sid.indexOf('cta_') === 0 ? 'URL: ' + (e.links[sid] || '#FALTA-URL') : 'hueco ' + sid));
        slotsOut.push({ at: e.at, slot: sid, kind: 'text', ok: true, sha: djb2(t.characters), font: fam, error: null });
      } catch (x) { slotsOut.push({ at: e.at, slot: sid, kind: 'text', ok: false, sha: null, font: null, error: String(x.message || x).slice(0, 120) }); }
    }
    for (var iid in e.images) {
      var n = slotNode(iid), ok = false, err = null;
      // Se copian TODAS las capas de imagen visibles del nodo fuente (p. ej. captura + marco de móvil).
      var src = await figma.getNodeByIdAsync(e.images[iid]), hash = null, paints = [];
      if (src && 'fills' in src && Array.isArray(src.fills)) for (var q = 0; q < src.fills.length; q++) if (src.fills[q].type === 'IMAGE' && src.fills[q].imageHash && src.fills[q].visible !== false) { paints.push(src.fills[q]); if (!hash) hash = src.fills[q].imageHash; }
      if (!n) err = 'hueco no encontrado'; else if (!hash) err = 'el nodo ' + e.images[iid] + ' no contiene una imagen';
      else { n.fills = paints; ok = true; }
      slotsOut.push({ at: e.at, slot: iid, kind: 'image', ok: ok, sha: hash, font: null, error: err });
    }
    for (var h = 0; h < e.hide.length; h++) { var hn = slotNode(e.hide[h]); if (hn) hn.visible = false; }
    if (e.visible) for (var k2 = 0; k2 < nodes.length; k2++) {
      var nd = nodes[k2];
      if (nd.type === 'TEXT' && nd.visible && PH.indexOf(nd.characters) >= 0) left.push({ at: e.at, slot: nd.name.slice(5), text: nd.characters });
      if (nd.type !== 'TEXT' && nd.visible && /^slot:imagen/.test(nd.name) && !(nd.name.slice(5) in e.images)) left.push({ at: e.at, slot: nd.name.slice(5), text: '[imagen sin asignar]' });
    }
  }
  ann(fr, '**' + P.name + '** · ' + P.summary);
  var sj = figma.createAutoLayout('VERTICAL'); section.appendChild(sj); created.push(sj);
  sj.name = P.name + ' · Asunto y preheader'; sj.x = nx + P.canvas.emailWidth + 120; sj.y = 100; sj.resize(560, 100); sj.layoutSizingHorizontal = 'FIXED'; sj.layoutSizingVertical = 'HUG';
  sj.paddingTop = 24; sj.paddingBottom = 24; sj.paddingLeft = 24; sj.paddingRight = 24; sj.itemSpacing = 10; sj.fills = [solid('#FFFFFF')];
  for (var z = 0; z < P.notes.length; z++) { var tx = figma.createText(); sj.appendChild(tx); tx.fontName = { family: 'Inter', style: P.notes[z][0] ? 'Bold' : 'Regular' }; tx.fontSize = P.notes[z][0] ? 13 : 12; tx.characters = P.notes[z][1]; tx.textAutoResize = 'HEIGHT'; tx.layoutSizingHorizontal = 'FILL'; }
  var mr = 0, mb = 0; for (var z2 = 0; z2 < section.children.length; z2++) { var ch = section.children[z2]; mr = Math.max(mr, ch.x + ch.width); mb = Math.max(mb, ch.y + ch.height); }
  section.resizeWithoutConstraints(Math.max(section.width, mr + 100), Math.max(section.height, mb + 100));
  return { schema: SCHEMA, status: 'created', frameId: fr.id, subjectFrameId: sj.id, sectionId: section.id, blocks: blocksOut, slots: slotsOut, placeholdersLeft: left, annotations: ANN, error: null };
} catch (x) {
  for (var d = created.length - 1; d >= 0; d--) { try { created[d].remove(); } catch (y) {} } // PCB_DISCARD_OWN_NODE
  if (sectionCreated && section.children.length === 0) section.remove(); // PCB_DISCARD_OWN_NODE
  return { schema: SCHEMA, status: 'failed', frameId: null, subjectFrameId: null, sectionId: null, blocks: blocksOut, slots: slotsOut, placeholdersLeft: [], annotations: ANN, error: String(x.message || x) + ' (se descartó lo creado)' };
}
`;

export const TEMPLATE_FORBIDDEN = ['setPluginData', 'setSharedPluginData', 'exportAsync', 'loadAllPagesAsync', 'createImage', 'detachInstance', 'flatten(', 'figma.notify'];

export function buildTemplateFillScript(b: EmailTemplateBrief, cat: EmailBlocksCatalog, blocks: ResolvedBlock[]): string {
  const entries = blocks.map((r) => {
    const c = r.content;
    const texts: Record<string, { t: string; b: Array<[number, number]>; s: string }> = {};
    for (const [k, v] of Object.entries(c?.slots ?? {})) { const cp = copyOf(v); const p = parseBold(cp.text); texts[k] = { t: p.text, b: p.bold, s: cp.source }; }
    return { at: r.at, name: r.name, variant: r.variant, componentId: r.componentId, visible: r.visible, texts, images: c?.images ?? {}, links: c?.links ?? {}, hide: c?.hide ?? [] };
  });
  const tag = (c: Copy) => (c.source === 'agent_draft' ? ' (PROPUESTA)' : c.source === 'placeholder' ? ' (PENDIENTE)' : '');
  const notes: Array<[boolean, string]> = [
    [true, 'Asunto' + tag(b.subject)], [false, b.subject.text], [true, 'Preheader' + tag(b.preheader)], [false, b.preheader.text],
    [true, 'Encargo'], [false, `Objetivo: ${b.intent.objetivo}${b.intent.audiencia ? ` · Audiencia: ${b.intent.audiencia}` : ''}${b.intent.mensaje ? ` · Mensaje: ${b.intent.mensaje}` : ''}`],
    [false, `Composición: ${'template' in b.composition ? `plantilla ${b.composition.template}` : 'propia'} · idioma ${b.idioma} · canal ${b.canal} · legal ${b.legal}`],
    [true, 'Para desarrollo'], [false, Object.entries(cat.fonts).map(([f, v]) => `${f}: implementar como ${v.implement}`).join('\n')],
    [false, 'Personalización: tokens neutros ' + Object.values(cat.options.tokens).join(', ') + ' (la sintaxis de la plataforma se pone al maquetar).'],
  ];
  const P = { pageId: b.figma.pageId, sectionName: b.figma.sectionName, name: b.name, canvas: cat.canvas, entries, notes, summary: `${'template' in b.composition ? `plantilla ${b.composition.template}` : 'composición propia'} · ${b.idioma} · canal ${b.canal} · legal ${b.legal}. DEMO pendiente de revisión humana.` };
  const fonts = [['Arimo', 'Regular'], ['Arimo', 'Bold'], ['Gelasio', 'Regular'], ['Gelasio', 'Bold'], ['Inter', 'Regular'], ['Inter', 'Bold']].map(([family, style]) => ({ family, style }));
  const code = [`var P = ${JSON.stringify(P)};`, `var FONTS = ${JSON.stringify(fonts)};`, `var PH = ${JSON.stringify(BLOCK_PLACEHOLDERS)};`, `var SCHEMA = ${JSON.stringify(EMAIL_TEMPLATE_RESULT_SCHEMA_ID)};`, BODY].join('\n');
  const bad = TEMPLATE_FORBIDDEN.filter((f) => code.includes(f));
  const removes = code.split('\n').filter((l) => l.includes('.remove(') && !l.includes('PCB_DISCARD_OWN_NODE'));
  if (bad.length || removes.length) throw new Error(`Script de plantilla con operaciones no permitidas: ${[...bad, ...removes].join(', ')}`);
  return code;
}

export interface TplVerify { status: 'pass' | 'pass_with_warnings' | 'fail'; findings: TplIssue[] }

export function verifyTemplateResult(b: EmailTemplateBrief, blocks: ResolvedBlock[], r: EmailTemplateResult): TplVerify {
  const f: TplIssue[] = [];
  if (r.status !== 'created') f.push({ code: `RESULT_${r.status.toUpperCase()}`, severity: 'blocking', message: r.error ?? r.status });
  for (const rb of blocks) {
    const got = r.blocks.find((x) => x.at === rb.at);
    if (!got) { f.push({ code: 'BLOCK_MISSING', severity: 'blocking', message: `Falta el bloque ${rb.name} (pos. ${rb.at})` }); continue; }
    if (got.visible !== rb.visible) f.push({ code: 'VISIBILITY', severity: 'blocking', message: `${rb.name}: visible=${got.visible}, esperado ${rb.visible}` });
    for (const [k, v] of Object.entries(rb.content?.slots ?? {})) {
      const s = r.slots.find((x) => x.at === rb.at && x.slot === k);
      const want = djb2(parseBold(copyOf(v).text).text);
      if (!s?.ok) f.push({ code: 'SLOT_NOT_FILLED', severity: 'blocking', message: `${rb.name} · ${k}: ${s?.error ?? 'sin rellenar'}` });
      else if (s.sha !== want) f.push({ code: 'SLOT_TEXT_ALTERED', severity: 'blocking', message: `${rb.name} · ${k}: el texto no coincide con el brief` });
    }
    for (const k of Object.keys(rb.content?.images ?? {})) { const s = r.slots.find((x) => x.at === rb.at && x.slot === k); if (!s?.ok) f.push({ code: 'IMAGE_NOT_PLACED', severity: 'blocking', message: `${rb.name} · ${k}: ${s?.error ?? 'sin colocar'}` }); }
  }
  for (const p of r.placeholdersLeft) f.push({ code: 'PLACEHOLDER_LEFT', severity: 'blocking', message: `Pos. ${p.at} · ${p.slot}: queda el texto de ejemplo del bloque «${p.text}»` });
  const status = f.some((x) => x.severity === 'blocking') ? 'fail' : f.length ? 'pass_with_warnings' : 'pass';
  return { status, findings: f };
}

export function renderTemplateSummary(b: EmailTemplateBrief, cat: EmailBlocksCatalog, chk: { issues: TplIssue[]; blocks: ResolvedBlock[] }): string {
  const out = [`# ${b.name} — ${cat.client.toUpperCase()}`, '', `Objetivo: ${b.intent.objetivo} · Idioma ${b.idioma} · Canal ${b.canal} · Legal ${b.legal}`, `Asunto: ${quote(b.subject.text)} · Preheader: ${quote(b.preheader.text)}`, '', '| # | Bloque | Variante | Visible | Huecos rellenos |', '|---|---|---|---|---|'];
  for (const r of chk.blocks) { const n = Object.keys(r.content?.slots ?? {}).length + Object.keys(r.content?.images ?? {}).length; out.push(`| ${r.at} | ${r.name} | ${r.variant ?? '—'} | ${r.visible ? 'sí' : 'no'} | ${r.slots.length ? `${n}/${r.slots.length}` : 'fijo'} |`); }
  if (chk.issues.length) { out.push('', '## Pendiente o a revisar', ''); for (const i of chk.issues) out.push(`- ${i.severity === 'blocking' ? '⛔' : i.severity === 'pending' ? '❓' : 'ℹ'} ${i.message}`); }
  out.push('', `Pendientes del catálogo: ${cat.pending.join(' · ')}`, '');
  return out.join('\n');
}
