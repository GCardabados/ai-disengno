// Descubrimiento del contenido variable de una maestra. Produce una PROPUESTA del agente (variar / mantener /
// preguntar) a partir de la estructura y la apariencia leídas de Figma, combinadas con los términos de la intención
// de la persona (p. ej. {grado: 'Derecho', ciudad: 'Madrid'}). No autoriza nada.
// - La función de cada elemento NO se deduce del nombre de capa: el nombre solo es una pista débil (logo).
// - Textos y nombres son datos no confiables: se muestran como citas, nunca se interpretan.
import type { MasterSnapshot, NodeSnapshot } from '../contracts/snapshot.ts';
import type { ProjectConfig } from '../contracts/config.ts';
import { intersectionArea, type Rect } from '../contracts/geometry.ts';
import { VARIANT_DISCOVERY_SCHEMA_ID, type FieldCandidate, type VariantDiscovery } from '../contracts/variants.ts';
import { classify, hintMatches } from '../inventory/classify.ts';
import { relRect } from '../demo/plan.ts';
import { escapeControls } from '../report/untrusted.ts';

const PATTERNS: Array<[string, RegExp]> = [
  ['url', /\bhttps?:\/\/\S+|\bwww\.\S+|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|es|edu|org|net|eu|info|io)\b|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+\/\S*/iu],
  ['price', /\d+(?:[.,]\d+)?\s?(?:€|eur\b)|€\s?\d+/iu],
  ['percent', /\d+(?:[.,]\d+)?\s?%/u],
  ['date', /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b|\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/iu],
  ['phone', /(?:\+\d{2}\s?)?\b\d{3}[\s.]?\d{2,3}[\s.]?\d{2,3}[\s.]?\d{0,3}\b/u],
];
const LEGAL_HINT = /condicion|consult[ae]|v[aá]lid|bases\b|plazas limitadas|sujeto a|seg[uú]n disponibilidad|\*/iu;
const COMMERCIAL = new Set(['url', 'price', 'percent', 'date', 'phone', 'commercial']);

/** ¿Aparece el término como palabra completa? (sin distinguir mayúsculas; respeta tildes). */
export function mentionsTerm(text: string, term: string): boolean {
  const t = term.normalize('NFC').trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu').test(text.normalize('NFC'));
}

/** Patrones de datos comerciales presentes en un texto (url, precio, porcentaje, fecha, teléfono). */
export function commercialSignals(text: string): string[] {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
}

const visiblePaint = (p: { visible: boolean; opacity: number }) => p.visible && p.opacity > 0;
export function imagePaintIndexes(n: NodeSnapshot): number[] {
  return Array.isArray(n.fills) ? n.fills.flatMap((p, i) => (p.type === 'IMAGE' && visiblePaint(p) ? [i] : [])) : [];
}

/** Cita legible de un dato no confiable (sin controles ni marcado Markdown activo). */
export function quote(s: string, max = 90): string {
  const one = escapeControls(s.replace(/\s*\n\s*/g, ' / ')).replace(/([\\`*_[\]<>#|])/g, '\\$1');
  return `«${one.length > max ? `${one.slice(0, max - 1)}…` : one}»`;
}

export interface DiscoverOptions {
  /** Términos de la intención: {param: valor visible en la maestra}. */
  terms?: Record<string, string>;
}

export function discoverVariantFields(s: MasterSnapshot, cfg: ProjectConfig, opts: DiscoverOptions = {}): VariantDiscovery {
  const terms = opts.terms ?? {};
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const root = byId.get(s.rootNodeId)!;
  const frameArea = (root.width ?? 0) * (root.height ?? 0);
  const missingFont = new Set(s.environment.nodesWithMissingFont);
  const effVisible = (n: NodeSnapshot): boolean => {
    for (let c: NodeSnapshot | undefined = n; c; c = c.parentId ? byId.get(c.parentId) : undefined) {
      if (!c.visible || c.opacity === 0) return false;
      if (c.id === root.id) return true;
    }
    return true;
  };
  const ancestors = (n: NodeSnapshot): NodeSnapshot[] => {
    const out: NodeSnapshot[] = [];
    for (let c = n.parentId ? byId.get(n.parentId) : undefined; c && c.id !== root.id; c = c.parentId ? byId.get(c.parentId) : undefined) out.push(c);
    return out;
  };
  const rect = (n: NodeSnapshot): Rect | null => relRect(n, root);
  const cls = classify(s, cfg);

  const texts = s.nodes.filter((n) => n.text && n.id !== root.id && effVisible(n));
  const sizeOf = (n: NodeSnapshot) => Math.max(0, ...n.text!.segments.map((g) => g.fontSize ?? 0));
  const sizes = texts.map(sizeOf).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)]! : 0;
  const maxSize = sizes.length ? sizes[sizes.length - 1]! : 0;

  // Logo: pista de rol por nombre (débil) en el nodo o un contenedor; se confirma en la captura.
  const logoIds = new Set<string>();
  for (const e of cls.entities) if (e.roleHints.some((h) => h.roleId === 'logo')) e.nodeIds.forEach((id) => logoIds.add(id));
  for (const n of s.nodes) if (n.id !== root.id && ['logo', 'marca', 'brand', 'logotipo'].some((h) => hintMatches(n.name, h))) logoIds.add(n.id);
  const inLogo = (n: NodeSnapshot) => logoIds.has(n.id) || ancestors(n).some((a) => logoIds.has(a.id));
  const vectorized = cls.entities.filter((e) => e.contentNature === 'vectorized_text' || e.review.reasons.includes('POSSIBLE_VECTORIZED_TEXT'));
  const imageText = new Set(cls.entities.filter((e) => e.contentNature === 'image_text_undetermined' || e.contentNature === 'image_embedded_text').flatMap((e) => e.nodeIds));

  const candidates: FieldCandidate[] = [];
  const push = (c: Omit<FieldCandidate, 'candidateId'>) => candidates.push({ candidateId: `c${candidates.length + 1}`, ...c });

  // Textos editables.
  for (const n of [...texts].sort((a, b) => (rect(a)?.y ?? 0) - (rect(b)?.y ?? 0) || (rect(a)?.x ?? 0) - (rect(b)?.x ?? 0))) {
    if (inLogo(n)) continue;
    const t = n.text!;
    const chars = t.characters;
    const words = chars.trim().split(/\s+/).filter(Boolean).length;
    const signals = commercialSignals(chars);
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const inButton = !!parent && parent.id !== root.id && parent.type !== 'GROUP' && Array.isArray(parent.fills) && parent.fills.some((p) => p.type === 'SOLID' && visiblePaint(p)) && words <= 4;
    const sz = sizeOf(n);
    let role = 'body';
    if (signals.includes('url')) role = 'url';
    else if (inButton) role = 'cta_label';
    else if (LEGAL_HINT.test(chars) && sz <= median) role = 'legal';
    else if (sz === maxSize && words >= 2) role = 'headline';
    else if (signals.some((x) => COMMERCIAL.has(x))) role = signals.includes('price') ? 'price' : signals.includes('date') ? 'date' : 'commercial';
    const ev: string[] = [`cuerpo ${sz}px${sz === maxSize ? ' (el mayor de la pieza)' : ''}`, `${words} palabra(s)`];
    if (inButton) ev.push('dentro de un contenedor con relleno (botón)');
    if (signals.length) ev.push(`datos: ${signals.join(', ')}`);
    const mentions = Object.fromEntries(Object.entries(terms).filter(([, v]) => mentionsTerm(chars, v)));
    const risks: string[] = [];
    if (t.segments.length > 1) risks.push(`estilos mixtos (${t.segments.length} tramos): hay que decidir cómo se reparte el nuevo copy entre ellos`);
    if (missingFont.has(n.id)) risks.push('fuente no disponible en el entorno: no se puede editar sin sustituirla (no se sustituye)');
    if (t.truncation && t.truncation !== 'DISABLED') risks.push('la caja trunca el texto: un copy más largo quedaría cortado');
    if (t.autoResize === 'NONE') risks.push('caja fija: un copy más largo puede no caber');
    if (parent?.layout.mode && parent.layout.mode !== 'NONE') risks.push('dentro de auto layout: un cambio de longitud puede desplazar o redimensionar otros elementos');
    const reasons: string[] = [];
    let proposal: FieldCandidate['proposal'];
    const named = Object.entries(mentions).map(([k, v]) => `${k} ${quote(v)}`).join(' y ');
    if (named && role === 'legal') { proposal = 'ask'; reasons.push(`legal que menciona ${named}: ¿cambia por variante? (no se reduce ni se resume)`); }
    else if (named && COMMERCIAL.has(role)) { proposal = 'ask'; reasons.push(`menciona ${named}: probablemente cambia, pero necesito el dato exacto de cada variante (no lo deduzco)`); }
    else if (named) { proposal = 'vary'; reasons.push(`menciona ${named}`); }
    else if (role === 'cta_label') { proposal = 'keep'; reasons.push('CTA genérico: se mantiene salvo que indiques otro'); }
    else if (role === 'legal') { proposal = 'keep'; reasons.push('legal/condiciones: se mantiene salvo indicación'); }
    else if (COMMERCIAL.has(role) || role === 'commercial') { proposal = 'ask'; reasons.push('dato comercial: ¿cambia por variante? Si cambia, necesito el dato exacto (no se inventa)'); }
    else { proposal = 'ask'; reasons.push(role === 'headline' ? 'titular sin mención de los términos: ¿cambia por variante?' : '¿este texto cambia por variante?'); }
    push({ kind: 'text', nodeIds: [n.id], roleGuess: role, excerpt: chars, mentions, signals: ev, proposal, reasons, risks });
  }

  // Imágenes (rellenos IMAGE visibles).
  const images = s.nodes.filter((n) => n.id !== root.id && imagePaintIndexes(n).length > 0 && effVisible(n) && !inLogo(n));
  const area = (n: NodeSnapshot) => { const r = rect(n); return r ? r.width * r.height : 0; };
  const mainImage = [...images].sort((a, b) => area(b) - area(a))[0];
  for (const n of images) {
    const r = rect(n);
    const cover = frameArea > 0 && r ? intersectionArea(r, { x: 0, y: 0, width: root.width ?? 0, height: root.height ?? 0 }) / frameArea : 0;
    const role = cover >= 0.7 ? 'background_image' : 'image';
    const risks: string[] = [];
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const mask = parent?.childIds.map((id) => byId.get(id)!).find((sib) => sib.isMask && sib.paintOrder < n.paintOrder);
    if (mask) risks.push(mask.type === 'RECTANGLE' ? 'recortada por una máscara rectangular' : `recortada por una máscara ${mask.type} (posible silueta): puede no servir para otra foto; requiere decisión`);
    if (imageText.has(n.id)) risks.push('posible texto incrustado en la imagen: revisar en la captura (sin OCR)');
    const over = texts.filter((t) => { const tr = rect(t); return r && tr && t.paintOrder > n.paintOrder && intersectionArea(r, tr) > 0; });
    if (over.length) risks.push(`${over.length} texto(s) encima: revisar contraste y rostros con la nueva foto`);
    const p = Array.isArray(n.fills) ? n.fills[imagePaintIndexes(n)[0]!]! : null;
    const signals = [`${Math.round(r?.width ?? 0)}×${Math.round(r?.height ?? 0)} px`, `cubre ${(cover * 100).toFixed(0)} % del frame`, `encaje ${p?.scaleMode ?? '?'}`];
    const isMain = n === mainImage;
    push({
      kind: 'image', nodeIds: [n.id], roleGuess: role, excerpt: isMain ? 'imagen principal' : 'imagen secundaria', mentions: {}, signals,
      proposal: isMain ? 'vary' : 'ask',
      reasons: [isMain ? 'imagen principal: suele ser específica de cada variante (necesito las fotos o su ubicación en Figma)' : '¿esta imagen cambia por variante?'],
      risks,
    });
  }

  // Logo, texto vectorizado y superposiciones: se mantienen y se informan.
  const logoRoots = [...logoIds].filter((id) => { const n = byId.get(id); return n && !ancestors(n).some((a) => logoIds.has(a.id)); });
  if (logoRoots.length) push({ kind: 'logo', nodeIds: logoRoots, roleGuess: 'logo', excerpt: 'logo', mentions: {}, signals: ['pista por nombre de capa (débil): confirmar en la captura'], proposal: 'keep', reasons: ['marca: tamaño, proporción y disposición intactos'], risks: [] });
  for (const e of vectorized) {
    if (e.nodeIds.some((id) => logoIds.has(id) || inLogo(byId.get(id)!))) continue;
    push({ kind: 'vectorized_text', nodeIds: e.nodeIds, roleGuess: 'vectorized_text', excerpt: 'posible texto vectorizado', mentions: {}, signals: [`${e.nodeIds.length} vectores alineados`], proposal: 'keep', reasons: ['no es texto editable'], risks: ['si debe cambiar por variante, hace falta un activo editable o una alternativa autorizada'] });
  }
  for (const n of s.nodes) {
    if (n.id === root.id || !effVisible(n) || n.text || imagePaintIndexes(n).length || !Array.isArray(n.fills)) continue;
    const grad = n.fills.some((p) => p.type.startsWith('GRADIENT') && visiblePaint(p));
    const translucent = n.fills.some((p) => p.type === 'SOLID' && visiblePaint(p) && p.opacity < 1) || (n.opacity < 1 && n.fills.some(visiblePaint));
    const r = rect(n);
    if ((grad || translucent) && r && images.some((im) => { const ir = rect(im); return ir && im.paintOrder < n.paintOrder && intersectionArea(ir, r) > 0; })) {
      push({ kind: 'overlay', nodeIds: [n.id], roleGuess: 'overlay', excerpt: grad ? 'degradado sobre la imagen' : 'velo semitransparente sobre la imagen', mentions: {}, signals: [], proposal: 'keep', reasons: ['superposición que sostiene la legibilidad: se conserva'], risks: ['comprobar que sigue funcionando con la nueva foto'] });
    }
  }

  return {
    schema: VARIANT_DISCOVERY_SCHEMA_ID, status: 'agent_proposal', source: s.source,
    master: { fileKey: s.fileKey, nodeId: root.id, name: root.name, width: root.width ?? 0, height: root.height ?? 0, fingerprint: s.fingerprints.master },
    terms, candidates,
  };
}

const ROLE_LABEL: Record<string, string> = {
  headline: 'Titular', body: 'Texto', cta_label: 'Botón (CTA)', url: 'URL', legal: 'Legal / condiciones', price: 'Precio',
  date: 'Fecha', commercial: 'Dato comercial', background_image: 'Fotografía de fondo', image: 'Imagen', logo: 'Logo',
  vectorized_text: 'Texto vectorizado', overlay: 'Superposición',
};
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

/** Síntesis para la persona: contenido reconocible, sin IDs técnicos (van en un anexo para el agente). */
export function renderDiscovery(d: VariantDiscovery): string {
  const line = (c: FieldCandidate) => `- **${roleLabel(c.roleGuess)}**${c.kind === 'text' ? `: ${quote(c.excerpt)}` : c.kind === 'image' ? ` (${c.excerpt}, ${c.signals[0]})` : ''}${c.reasons.length ? ` — ${c.reasons.join('; ')}` : ''}`;
  const by = (p: string) => d.candidates.filter((c) => c.proposal === p);
  const risks = d.candidates.filter((c) => c.risks.length);
  const terms = Object.entries(d.terms).map(([k, v]) => `${k} ${quote(v)}`).join(', ');
  const out = [
    `# Propuesta de variantes — ${quote(d.master.name)} (${d.master.width}×${d.master.height})`,
    '',
    `${d.source === 'MOCK' ? '**[MOCK]** ' : ''}Estado: **propuesta del agente**. No autoriza ningún cambio hasta que la confirmes.${terms ? ` Términos de tu encargo: ${terms}.` : ''}`,
    '',
    '## Propongo variar', '', ...(by('vary').length ? by('vary').map(line) : ['- (nada con seguridad)']), '',
    '## Propongo mantener', '', ...(by('keep').length ? by('keep').map(line) : ['- (nada)']), '',
    '## Necesito que me lo aclares', '', ...(by('ask').length ? by('ask').map(line) : ['- (nada)']), '',
  ];
  if (risks.length) out.push('## Limitaciones y riesgos detectados', '', ...risks.map((c) => `- ${roleLabel(c.roleGuess)}${c.kind === 'text' ? ` ${quote(c.excerpt, 40)}` : ''}: ${c.risks.join('; ')}`), '');
  out.push(
    '## Preguntas (una sola ronda)', '',
    '1. ¿Qué variantes necesitas? Dime las combinaciones concretas (no asumo que todas sean válidas).',
    '2. ¿Confirmas qué varía y qué se mantiene? Corrige lo que no sea así.',
    '3. ¿Tienes los copies y las fotos, o quieres que proponga borradores de copy? Las fotos deben estar en Figma (dime dónde).',
    '4. Datos por variante que no puedo deducir: los que aparecen en «Necesito que me lo aclares» (URLs, precios, fechas, condiciones…).',
    '',
    '<details><summary>Anexo técnico (para el agente)</summary>', '',
    '| cand. | tipo | nodos | función estimada | propuesta | señales |', '|---|---|---|---|---|---|',
    ...d.candidates.map((c) => `| ${c.candidateId} | ${c.kind} | ${c.nodeIds.join(' ')} | ${c.roleGuess} | ${c.proposal} | ${c.signals.join('; ').replace(/\|/g, '\\|')} |`),
    '', '</details>', '',
  );
  return out.join('\n');
}
