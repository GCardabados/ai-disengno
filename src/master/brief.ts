// Comprobación del brief de una pieza maestra contra el brand kit (master-brief-check) y su confirmación por la persona.
// Dice qué falta, qué se decide por encargo porque la marca no lo especifica (con una propuesta concreta) y qué
// incumple la marca. La propuesta del agente no autoriza nada: el brief se confirma entero, ligado por hash.
import type { Brand, TextRole } from '../contracts/brand.ts';
import { TEXT_ROLES } from '../contracts/brand.ts';
import type { MasterBrief } from '../contracts/master.ts';
import { hashOf } from '../hash/canonical.ts';
import { confirmedColors } from '../brand/check.ts';
import { contrast } from '../brand/color.ts';
import { commercialSignals, quote } from '../variants/discover.ts';

export interface BriefIssue { code: string; severity: 'blocking' | 'pending' | 'warning'; message: string; proposal?: string }
export interface BriefCheck { issues: BriefIssue[]; ready: boolean }

const ROLE_LABEL: Record<TextRole, string> = { headline: 'titular', subheadline: 'subtítulo/etiqueta', body: 'cuerpo', cta: 'CTA', legal: 'legal', claim: 'claim' };
export const roleLabelEs = (r: TextRole) => ROLE_LABEL[r];

export const briefHash = (b: MasterBrief): string => { const { confirmation: _c, ...rest } = b; return hashOf('pcb.master-brief', rest); };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

/** Composición propuesta según formato e imagen. */
export function proposeArchetype(b: MasterBrief): MasterBrief['archetype'] {
  const r = b.format.width / b.format.height;
  if (b.image.source === 'none') return 'solid';
  return r >= 1.3 ? 'split' : 'photo-top';
}

/** Fuente efectiva de un rol: la de la marca o la decidida en el encargo. */
export function fontFor(brand: Brand, b: MasterBrief, role: TextRole): { family: string; style: string; upper: boolean; from: 'brand' | 'decision' } | null {
  const d = b.decisions.fonts[role];
  if (d) return { family: d.family, style: d.style, upper: false, from: 'decision' };
  const r = brand.typography.roles[role];
  return r ? { family: r.family, style: r.style, upper: r.upper ?? false, from: 'brand' } : null;
}

function proposeFont(brand: Brand, role: TextRole): string {
  const body = brand.typography.roles.body, head = brand.typography.roles.headline;
  const fam = (f: { family: string } | null | undefined) => f ? brand.typography.families.find((x) => x.family === f.family) : undefined;
  const bold = (f: { family: string; style: string } | null | undefined) => (f && fam(f)?.styles.includes('Bold') ? `${f.family} Bold` : f ? `${f.family} ${f.style}` : null);
  if (role === 'cta') return bold(body) ?? bold(head) ?? '—';
  if (role === 'legal') return body ? `${body.family} ${body.style}` : '—';
  return bold(head) ?? '—';
}

export function checkBrief(b: MasterBrief, brand: Brand): BriefCheck {
  const issues: BriefIssue[] = [];
  const add = (i: BriefIssue) => issues.push(i);
  // Para texto, fondo y CTA solo cuentan los colores de la paleta (blanco/negro puros solo existen para tintas de logo).
  const colors = new Map([...confirmedColors(brand)].filter(([id]) => id !== 'white' && id !== 'black'));
  const colorName = (id: string) => brand.colors.find((c) => c.id === id)?.name ?? id;

  if (b.brand !== brand.slug) add({ code: 'BRAND_MISMATCH', severity: 'blocking', message: `El brief es de ${b.brand} y el kit de ${brand.slug}` });
  if (brand.status !== 'validated') add({ code: 'BRAND_DRAFT', severity: 'warning', message: `El kit de ${brand.name} está en borrador: la pieza es una propuesta sobre un kit sin validar` });

  // Modo.
  if (b.mode === 'template') {
    const t = brand.templates.find((x) => x.id === b.templateId);
    if (!t) add({ code: 'TEMPLATE_UNKNOWN', severity: 'blocking', message: `La marca no tiene la plantilla ${b.templateId ?? '(sin indicar)'}; plantillas: ${brand.templates.map((x) => x.id).join(', ') || 'ninguna (usar modo scratch)'}` });
    else if (t.width !== b.format.width || t.height !== b.format.height) add({ code: 'TEMPLATE_SIZE', severity: 'blocking', message: `La plantilla ${t.id} mide ${t.width}×${t.height}, no ${b.format.width}×${b.format.height}: crea la maestra en su tamaño y adáptala después con adapt-master-creative` });
  } else if (!b.archetype) add({ code: 'ARCHETYPE_MISSING', severity: 'pending', message: 'Falta elegir la composición', proposal: `«${proposeArchetype(b)}»` });

  // Copy: exacto del brief o borrador del agente confirmado; nunca datos comerciales inventados.
  if (!b.copy.headline) add({ code: 'HEADLINE_MISSING', severity: 'pending', message: 'Falta el titular (del brief o un borrador para confirmar)' });
  const sourced = TEXT_ROLES.flatMap((r) => (b.copy[r] && b.copy[r]!.source !== 'agent_draft' ? [b.copy[r]!.text] : [])).join(' \u0000 ');
  for (const r of TEXT_ROLES) {
    const c = b.copy[r];
    if (!c) continue;
    if (CONTROL.test(c.text)) add({ code: 'COPY_CONTROL_CHARS', severity: 'blocking', message: `${ROLE_LABEL[r]}: contiene caracteres de control o invisibles` });
    if (c.source === 'agent_draft') {
      const unsourced = commercialSignals(c.text).filter((k) => !commercialSignals(sourced).includes(k));
      if (unsourced.length) add({ code: 'COMMERCIAL_CLAIM_UNSOURCED', severity: 'blocking', message: `${ROLE_LABEL[r]}: el borrador incluye ${unsourced.join(', ')} sin fuente en el brief (no se inventan precios, fechas, URLs…)` });
      else add({ code: 'AGENT_DRAFT', severity: 'warning', message: `${ROLE_LABEL[r]}: borrador del agente ${quote(c.text, 60)} (solo vale con la confirmación del brief)` });
    }
    // Tipografía por rol.
    const f = fontFor(brand, b, r);
    if (!f) add({ code: 'FONT_ROLE_UNDECIDED', severity: 'pending', message: `La marca no define la tipografía del ${ROLE_LABEL[r]}`, proposal: proposeFont(brand, r) });
    else {
      const fam = brand.typography.families.find((x) => x.family === f.family);
      if (!fam || !fam.styles.includes(f.style)) add({ code: 'FONT_NOT_IN_BRAND', severity: 'blocking', message: `${ROLE_LABEL[r]}: ${f.family} ${f.style} no es una tipografía de la marca` });
      else if (fam.figma !== 'google_fonts') add({ code: 'FONT_MAY_NOT_LOAD', severity: 'warning', message: `${ROLE_LABEL[r]}: ${f.family} hay que tenerla instalada/activada en Figma; si no carga, el script se detiene sin sustituirla` });
    }
  }
  for (const t of brand.copy.mandatoryTexts) add({ code: 'MANDATORY_TEXT', severity: 'warning', message: `La marca exige ${quote(t.text, 60)} cuando ${t.when}` });

  // Imagen.
  const needsImage = b.archetype && b.archetype !== 'solid';
  if (needsImage && b.image.source === 'none') add({ code: 'IMAGE_REQUIRED', severity: 'blocking', message: `La composición «${b.archetype}» necesita una imagen` });
  if (b.image.source !== 'none' && !b.image.nodeId) add({ code: 'IMAGE_NOT_IN_FIGMA', severity: 'pending', message: b.image.source === 'brief_file' ? `La imagen del brief (${b.image.path ?? b.image.label}) tiene que estar en el archivo de Figma: subirla y anotar su nodo` : b.image.source === 'ai_generated' ? 'Generar la imagen en Figma y anotar su nodo' : 'Falta el nodo de Figma con la imagen' });
  if (b.image.source === 'ai_generated' && !b.image.aiAuthorization) add({ code: 'AI_IMAGE_NOT_AUTHORIZED', severity: 'pending', message: 'Una imagen generada con IA requiere autorización explícita de la persona (derechos y fidelidad a la marca)' });
  if (b.image.source === 'ai_generated') add({ code: 'AI_IMAGE', severity: 'warning', message: 'Imagen generada con IA: queda marcada en la pieza y en el informe' });

  // Colores.
  for (const [k, id] of Object.entries(b.palette)) {
    if (id === null) continue;
    const c = brand.colors.find((x) => x.id === id);
    if (!c) add({ code: 'COLOR_UNKNOWN', severity: 'blocking', message: `${k}: ${id} no es un color de la marca` });
    else if (c.status !== 'confirmed' || !c.hex) add({ code: 'COLOR_UNCONFIRMED', severity: 'blocking', message: `${k}: ${c.name} tiene un valor sin confirmar en el manual; no se usa` });
  }
  const bg = colors.get(b.palette.background), tx = colors.get(b.palette.text);
  if (bg && tx && b.archetype !== 'photo-full') {
    const k = contrast(bg, tx);
    if (k < 3) add({ code: 'TEXT_CONTRAST_LOW', severity: 'blocking', message: `Texto ${colorName(b.palette.text)} sobre ${colorName(b.palette.background)}: contraste ${k.toFixed(2)} (< 3)` });
    else if (k < 4.5) add({ code: 'TEXT_CONTRAST_LARGE_ONLY', severity: 'warning', message: `Texto ${colorName(b.palette.text)} sobre ${colorName(b.palette.background)}: contraste ${k.toFixed(2)}, válido solo para texto grande (WCAG AA)` });
  }

  // Lagunas de la marca que esta pieza necesita.
  if (b.copy.cta && !b.decisions.cta) {
    // Propuesta: botón de acento o principal distinto del fondo; texto de la paleta con el mayor contraste sobre el botón.
    const fills = [b.palette.accent, ...brand.colors.filter((c) => c.role === 'primary').map((c) => c.id), b.palette.text].filter((x): x is string => !!x && colors.has(x) && x !== b.palette.background);
    const fill = fills[0];
    if (fill) {
      const fillHex = colors.get(fill)!;
      const textId = [...colors.keys()].filter((id) => id !== fill).sort((x, y) => contrast(fillHex, colors.get(y)!) - contrast(fillHex, colors.get(x)!))[0]!;
      add({ code: 'CTA_STYLE_UNDECIDED', severity: 'pending', message: 'La marca no define el estilo del CTA', proposal: `botón ${colorName(fill)} con texto ${colorName(textId)} (contraste ${contrast(fillHex, colors.get(textId)!).toFixed(2)}), esquinas en píldora` });
    } else add({ code: 'CTA_STYLE_UNDECIDED', severity: 'pending', message: 'La marca no define el estilo del CTA y no hay un color de la paleta distinto del fondo para el botón' });
  }
  if (!brand.logoRules.clearSpace?.ratioOfLogoHeight && !b.decisions.clearSpaceRatio) add({ code: 'CLEAR_SPACE_UNDECIDED', severity: 'pending', message: `Área de reserva sin cota en la marca (${brand.logoRules.clearSpace?.rule ?? 'sin regla'})`, proposal: '1 × la altura del logo (interpretación conservadora)' });
  if (b.decisions.cta) for (const id of [b.decisions.cta.fill, b.decisions.cta.text]) if (!colors.has(id)) add({ code: 'CTA_COLOR_UNKNOWN', severity: 'blocking', message: `CTA: ${id} no es un color confirmado de la marca` });

  // Logo.
  if (b.logoId) {
    const l = brand.logos.find((x) => x.id === b.logoId);
    if (!l) add({ code: 'LOGO_UNKNOWN', severity: 'blocking', message: `La marca no tiene el logo ${b.logoId}` });
    else {
      if (!l.externalUse) add({ code: 'LOGO_NOT_FOR_EXTERNAL', severity: 'blocking', message: `${l.label}: la marca no lo permite en comunicación externa (${l.source})` });
      if (!l.file?.endsWith('.svg')) add({ code: 'LOGO_FILE_MISSING', severity: 'blocking', message: `${l.label}: falta el archivo SVG` });
    }
  } else if (!brand.logos.some((l) => l.externalUse && l.file?.endsWith('.svg'))) add({ code: 'NO_USABLE_LOGO', severity: 'blocking', message: `${brand.name}: no hay ningún logo apto para paid con archivo SVG en el kit` });

  if (!b.confirmation) add({ code: 'BRIEF_NOT_CONFIRMED', severity: 'pending', message: 'Falta tu confirmación del brief (copy, composición, colores y decisiones)' });
  else if (b.confirmation.hash !== briefHash(b)) add({ code: 'BRIEF_CHANGED_AFTER_CONFIRMATION', severity: 'pending', message: 'El brief cambió después de tu confirmación' });
  return { issues, ready: !issues.some((i) => i.severity !== 'warning') };
}

export function confirmBrief(b: MasterBrief, brand: Brand, by: string, note: string): MasterBrief {
  const stop = checkBrief(b, brand).issues.filter((i) => i.severity === 'blocking' || (i.severity === 'pending' && !['BRIEF_NOT_CONFIRMED', 'BRIEF_CHANGED_AFTER_CONFIRMATION', 'IMAGE_NOT_IN_FIGMA'].includes(i.code)));
  if (stop.length) throw new Error(`El brief no se puede confirmar todavía:\n${stop.map((i) => `- ${i.message}${i.proposal ? ` (propuesta: ${i.proposal})` : ''}`).join('\n')}`);
  return { ...b, confirmation: { by, at: new Date().toISOString(), note, hash: briefHash(b) } };
}

export function renderBriefSummary(b: MasterBrief, brand: Brand, chk: BriefCheck): string {
  const out = [`# Pieza maestra ${quote(b.slug)} — ${brand.name}`, '', `Formato: ${b.format.name} (${b.format.width}×${b.format.height}). Modo: ${b.mode}${b.mode === 'scratch' ? ` · composición ${b.archetype ?? '(por decidir)'}` : ` · plantilla ${b.templateId}`}.`, ''];
  out.push('| Texto | Copy | Origen |', '|---|---|---|');
  for (const r of TEXT_ROLES) if (b.copy[r]) out.push(`| ${ROLE_LABEL[r]} | ${quote(b.copy[r]!.text, 90)} | ${b.copy[r]!.source === 'agent_draft' ? 'borrador del agente' : b.copy[r]!.source} |`);
  out.push('', `Imagen: ${b.image.source === 'none' ? 'sin imagen' : `${quote(b.image.label)} (${b.image.source}${b.image.nodeId ? `, nodo ${b.image.nodeId}` : ', pendiente de estar en Figma'})`}.`);
  out.push(`Colores: fondo ${b.palette.background}, texto ${b.palette.text}${b.palette.accent ? `, acento ${b.palette.accent}` : ''}. Logo: ${b.logoId ?? 'lo propone el plan según el fondo'}.`, '');
  if (chk.issues.length) {
    out.push('## Pendiente o a revisar', '');
    for (const i of chk.issues) out.push(`- ${i.severity === 'blocking' ? '⛔' : i.severity === 'pending' ? '❓' : 'ℹ'} ${i.message}${i.proposal ? ` — propuesta: ${i.proposal}` : ''}`);
    out.push('');
  }
  out.push(chk.ready ? '✔ Brief confirmado.' : '¿Confirmas el brief con estas propuestas? Con tu sí lo registro y preparo la pieza.', '');
  return out.join('\n');
}
