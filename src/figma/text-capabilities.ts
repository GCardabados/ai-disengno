/**
 * Comprobación PREVIA (solo lectura) de lo que necesita una edición de texto o un logo experimental: si el plugin puede
 * cargar las fuentes exactas de esos textos y si el entorno expone las APIs que usará el ejecutor. No modifica el
 * documento (cargar una fuente no lo cambia). Una fuente no disponible es una limitación del ENTORNO: se informa con
 * familia, estilo y nodos afectados; nunca se sustituye ni se convierte en regla de marca.
 */
export const TEXT_CAPABILITIES_SCHEMA_ID = 'pcb.text-capabilities.v1';

export interface TextCapabilities {
  schema: typeof TEXT_CAPABILITIES_SCHEMA_ID;
  fonts: Array<{ family: string; style: string; loaded: boolean; error: string | null; nodeIds: string[] }>;
  nodes: Array<{ id: string; type: string; found: boolean; hasMissingFont: boolean | null; api: Record<string, boolean> }>;
}

export function buildTextCapabilitiesScript(nodeIds: string[]): string {
  return `var IDS = ${JSON.stringify(nodeIds)};
var API = ['insertCharacters', 'deleteCharacters', 'setRangeFontSize', 'setRangeLineHeight', 'setRangeLetterSpacing', 'resize', 'rescale'];
var byFont = {}, nodes = [];
for (var i = 0; i < IDS.length; i++) {
  var n = await figma.getNodeByIdAsync(IDS[i]);
  if (!n) { nodes.push({ id: IDS[i], type: null, found: false, hasMissingFont: null, api: {} }); continue; }
  var api = {};
  for (var a = 0; a < API.length; a++) api[API[a]] = typeof n[API[a]] === 'function';
  var texts = n.type === 'TEXT' ? [n] : ('findAllWithCriteria' in n ? n.findAllWithCriteria({ types: ['TEXT'] }) : []);
  for (var t = 0; t < texts.length; t++) {
    var segs = texts[t].getStyledTextSegments(['fontName']);
    for (var s = 0; s < segs.length; s++) {
      var key = segs[s].fontName.family + '\\u0000' + segs[s].fontName.style;
      if (!byFont[key]) byFont[key] = { family: segs[s].fontName.family, style: segs[s].fontName.style, nodeIds: [] };
      if (byFont[key].nodeIds.indexOf(texts[t].id) < 0) byFont[key].nodeIds.push(texts[t].id);
    }
  }
  nodes.push({ id: n.id, type: n.type, found: true, hasMissingFont: n.type === 'TEXT' ? n.hasMissingFont === true : null, api: api });
}
var fonts = [];
var keys = Object.keys(byFont).sort();
for (var k = 0; k < keys.length; k++) {
  var f = byFont[keys[k]];
  try { await figma.loadFontAsync({ family: f.family, style: f.style }); fonts.push({ family: f.family, style: f.style, loaded: true, error: null, nodeIds: f.nodeIds }); }
  catch (e) { fonts.push({ family: f.family, style: f.style, loaded: false, error: String(e && e.message ? e.message : e).split('\\n')[0], nodeIds: f.nodeIds }); }
}
return { schema: ${JSON.stringify(TEXT_CAPABILITIES_SCHEMA_ID)}, fonts: fonts, nodes: nodes };
`;
}

/** Resumen legible: qué se puede ejecutar y qué no, y por qué (sin convertir el bloqueo en una regla). */
export function summarizeTextCapabilities(c: TextCapabilities, requiredApis: string[]): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  for (const f of c.fonts) {
    if (f.loaded) lines.push(`✓ fuente ${f.family} ${f.style} disponible (${f.nodeIds.join(', ')})`);
    else { ok = false; lines.push(`✗ fuente ${f.family} ${f.style} NO disponible en este entorno (${f.nodeIds.join(', ')}): ${f.error ?? 'sin detalle'}. Limitación técnica: no se sustituye; esos textos solo pueden trasladarse aquí.`); }
  }
  for (const n of c.nodes) {
    if (!n.found) { ok = false; lines.push(`✗ nodo ${n.id} no encontrado`); continue; }
    const missing = requiredApis.filter((a) => n.api[a] === false);
    if (missing.length) { ok = false; lines.push(`✗ ${n.id} (${n.type}) sin API ${missing.join(', ')}`); }
  }
  return { ok, lines };
}
