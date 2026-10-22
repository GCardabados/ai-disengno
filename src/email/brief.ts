// Comprobación del brief estructurado de un email contra el conocimiento del cliente (email-brief-check) y su
// confirmación. Separa lo que BLOQUEA (no se diseña), lo que hay que DECIDIR antes de diseñar (una sola ronda de
// preguntas, cada una con propuesta) y lo que se resuelve con un supuesto o un placeholder identificado (aviso).
import type { KnowledgeContext } from '../knowledge/store.ts';
import type { Copy, EmailBrief, ModuleSpec } from '../contracts/email.ts';
import { EMAIL_TEXT_ROLES, type EmailTextRole } from '../contracts/knowledge.ts';
import { hashOf } from '../hash/canonical.ts';
import { contrast } from '../brand/color.ts';
import { commercialSignals, quote } from '../variants/discover.ts';
import { bestTextColor, colorById, palette, typeFor, usableColor, WEB_SAFE_PROPOSAL } from './tokens.ts';

export interface BriefIssue { code: string; severity: 'blocking' | 'pending' | 'warning'; message: string; proposal?: string }
export interface BriefCheck { issues: BriefIssue[]; ready: boolean; copy: { approved: number; proposed: number; placeholder: number } }

export const emailBriefHash = (b: EmailBrief): string => { const { confirmation: _c, ...rest } = b; return hashOf('pcb.email-brief', rest); };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;
/** Afirmaciones comerciales que un borrador del agente no puede introducir sin fuente en el brief. */
const CLAIM = /\b(gratis|gratuit\w*|garantiz\w*|sin comisi\w*|rentabilidad\w*|descuento\w*|oferta\w*|promoci\w*|regalo\w*|sorteo\w*|premio\w*|[uú]ltim[oa]s (?:plazas|unidades|d[ií]as)|solo hoy|exclusiv\w*|n[ºo°]\s?1|l[ií]der\w*|el mejor|la mejor)\b/giu;
const claimsOf = (t: string) => [...new Set([...t.matchAll(CLAIM)].map((m) => m[0].toLowerCase()))];
export const PLACEHOLDER_RE = /^\[PENDIENTE\b/;

/** Todos los copys del brief con su ubicación legible. */
export function copiesOf(b: EmailBrief): Array<{ where: string; copy: Copy }> {
  const out: Array<{ where: string; copy: Copy }> = [];
  if (b.subject) out.push({ where: 'asunto', copy: b.subject });
  if (b.preheader) out.push({ where: 'preheader', copy: b.preheader });
  for (const m of b.modules) {
    const at = (s: string) => `${m.id} · ${s}`;
    if (m.eyebrow) out.push({ where: at('antetítulo'), copy: m.eyebrow });
    if (m.headline) out.push({ where: at('titular'), copy: m.headline });
    m.body.forEach((c, i) => out.push({ where: at(`párrafo ${i + 1}`), copy: c }));
    if (m.cta) out.push({ where: at('CTA'), copy: m.cta.label });
    if (m.image?.alt) out.push({ where: at('alt de la imagen'), copy: m.image.alt });
    m.items.forEach((it, i) => {
      if (it.title) out.push({ where: at(`elemento ${i + 1} · título`), copy: it.title });
      if (it.body) out.push({ where: at(`elemento ${i + 1} · texto`), copy: it.body });
      if (it.link) out.push({ where: at(`elemento ${i + 1} · enlace`), copy: it.link.label });
      if (it.image?.alt) out.push({ where: at(`elemento ${i + 1} · alt`), copy: it.image.alt });
    });
  }
  return out;
}

const ctasOf = (m: ModuleSpec) => [...(m.cta ? [m.cta] : []), ...m.items.flatMap((i) => (i.link ? [i.link] : []))];
const imagesOf = (m: ModuleSpec) => [...(m.image ? [m.image] : []), ...m.items.flatMap((i) => (i.image ? [i.image] : []))];

export function checkEmailBrief(b: EmailBrief, ctx: KnowledgeContext): BriefCheck {
  const issues: BriefIssue[] = [];
  const add = (i: BriefIssue) => issues.push(i);
  if (b.client !== ctx.client.slug) add({ code: 'CLIENT_MISMATCH', severity: 'blocking', message: `El brief es de ${b.client} y el conocimiento cargado de ${ctx.client.slug}` });
  if (ctx.channel !== 'email') add({ code: 'CONTEXT_NOT_EMAIL', severity: 'blocking', message: `El contexto cargado es del canal ${ctx.channel}` });
  for (const i of ctx.issues) if (i.severity === 'blocking') add({ code: `KNOWLEDGE_${i.code}`, severity: 'blocking', message: i.message });
  if (ctx.client.status !== 'validated' || ctx.loaded.some((f) => f.status !== 'validated')) add({ code: 'KNOWLEDGE_DRAFT', severity: 'warning', message: `Conocimiento de ${ctx.client.name} en borrador: el email es una propuesta sobre datos sin validar` });
  if (!b.figma.fileKey || !ctx.client.figmaFiles.length) add({ code: 'FIGMA_FILE_UNDECLARED', severity: 'warning', message: 'El cliente no declara archivos de Figma: comprobar que el archivo destino es el correcto' });

  // Estructura.
  const ids = new Set<string>();
  for (const m of b.modules) { if (ids.has(m.id)) add({ code: 'MODULE_ID_DUPLICATE', severity: 'blocking', message: `Módulo repetido: ${m.id}` }); ids.add(m.id); }
  if (b.modules[0]?.type !== 'header') add({ code: 'HEADER_NOT_FIRST', severity: 'warning', message: 'El primer módulo no es la cabecera (logo)' });
  if (!b.modules.some((m) => m.type === 'footer')) add({ code: 'FOOTER_MISSING', severity: 'pending', message: 'Falta el pie: baja y identificación del remitente son obligatorios en comunicaciones comerciales', proposal: 'añadir el módulo footer con los elementos obligatorios del cliente (o placeholders)' });
  else if (b.modules.at(-1)?.type !== 'footer') add({ code: 'FOOTER_NOT_LAST', severity: 'warning', message: 'El pie no es el último módulo' });
  const h1 = b.modules.filter((m) => m.headline && m.headlineLevel === 'h1').length;
  if (h1 !== 1) add({ code: 'H1_COUNT', severity: 'warning', message: `Hay ${h1} titulares H1; debe haber exactamente uno (el mensaje principal)` });
  const primaries = b.modules.flatMap(ctasOf).filter((c) => c.variant === 'primary');
  if (!primaries.length) add({ code: 'NO_PRIMARY_CTA', severity: 'warning', message: 'No hay CTA principal: confirmar que el email no pide una acción' });
  const distinctPrimary = new Set(primaries.map((c) => c.label.text.trim().toLowerCase()));
  if (distinctPrimary.size > 1) add({ code: 'SEVERAL_PRIMARY_ACTIONS', severity: 'warning', message: `${distinctPrimary.size} acciones principales distintas (${[...distinctPrimary].map((x) => quote(x, 30)).join(', ')}): compiten por la atención` });
  for (const m of b.modules) {
    if (m.type === 'hero' && !m.headline) add({ code: 'HERO_WITHOUT_HEADLINE', severity: 'pending', message: `${m.id}: el módulo principal necesita titular (del brief o propuesta del agente)` });
    if (m.type === 'image-text' && (!m.image || !m.imageSide)) add({ code: 'IMAGE_TEXT_INCOMPLETE', severity: 'blocking', message: `${m.id}: «image-text» necesita imagen y lado (imageSide)` });
    if (m.type === 'columns' && (m.items.length < 2 || !m.columns)) add({ code: 'COLUMNS_INCOMPLETE', severity: 'blocking', message: `${m.id}: «columns» necesita ≥ 2 elementos y columns 1 (lista), 2 o 3` });
    if (m.type !== 'columns' && m.items.length) add({ code: 'ITEMS_IGNORED', severity: 'blocking', message: `${m.id}: solo «columns» admite elementos` });
    if (m.cta && m.cta.label.text.length > 30) add({ code: 'CTA_LONG', severity: 'warning', message: `${m.id}: CTA de ${m.cta.label.text.length} caracteres; en mobile puede partirse en dos líneas` });
    if (m.cta && /^(haz )?(clic|click)( aqu[ií])?$|^aqu[ií]$|^m[aá]s$/i.test(m.cta.label.text.trim())) add({ code: 'CTA_NOT_DESCRIPTIVE', severity: 'warning', message: `${m.id}: el CTA ${quote(m.cta.label.text)} no describe la acción (WCAG 2.4.4)` });
  }

  // Copys: aprobados exactos; borradores sin afirmaciones comerciales inventadas; placeholders identificados.
  const all = copiesOf(b);
  const sourced = all.filter((c) => c.copy.source === 'brief' || c.copy.source === 'client_approved').map((c) => c.copy.text).join(' \u0000 ');
  const sourcedSignals = new Set([...commercialSignals(sourced), ...claimsOf(sourced)]);
  for (const { where, copy } of all) {
    if (CONTROL.test(copy.text)) add({ code: 'COPY_CONTROL_CHARS', severity: 'blocking', message: `${where}: contiene caracteres de control o invisibles` });
    if (copy.source === 'placeholder' && !PLACEHOLDER_RE.test(copy.text)) add({ code: 'PLACEHOLDER_NOT_MARKED', severity: 'blocking', message: `${where}: un placeholder debe empezar por «[PENDIENTE» para que nadie lo publique por error` });
    if (copy.source !== 'placeholder' && PLACEHOLDER_RE.test(copy.text)) add({ code: 'PLACEHOLDER_SOURCE', severity: 'blocking', message: `${where}: el texto es un placeholder pero su origen es ${copy.source}` });
    if (copy.source === 'agent_draft') {
      const unsourced = [...commercialSignals(copy.text), ...claimsOf(copy.text)].filter((k) => !sourcedSignals.has(k));
      if (unsourced.length) add({ code: 'COMMERCIAL_CLAIM_UNSOURCED', severity: 'blocking', message: `${where}: el borrador incluye ${unsourced.join(', ')} sin fuente en el brief (no se inventan precios, condiciones ni afirmaciones comerciales)` });
    }
  }
  for (const fc of ctx.email?.legal.forbiddenClaims ?? []) for (const { where, copy } of all) if (copy.text.toLowerCase().includes(fc.text.toLowerCase())) add({ code: 'FORBIDDEN_CLAIM', severity: 'blocking', message: `${where}: contiene ${quote(fc.text, 50)}, prohibido por el cliente (${fc.source})` });
  for (const mt of ctx.email?.legal.mandatoryTexts ?? []) {
    const present = all.some((c) => c.copy.text.includes(mt.text.slice(0, 40)));
    if (!present) add({ code: 'MANDATORY_TEXT_CHECK', severity: 'warning', message: `Texto legal del cliente ${quote(mt.text, 60)} obligatorio cuando ${mt.when} (${mt.status}): comprobar si aplica` });
  }
  if (!b.subject) add({ code: 'SUBJECT_MISSING', severity: 'pending', message: 'Falta el asunto (el agente propone uno, marcado como borrador)' });
  if (!b.preheader) add({ code: 'PREHEADER_MISSING', severity: 'pending', message: 'Falta el preheader (el agente propone uno, marcado como borrador)' });
  else if (b.preheader.source !== 'placeholder' && (b.preheader.text.length < 40 || b.preheader.text.length > 100)) add({ code: 'PREHEADER_LENGTH', severity: 'warning', message: `Preheader de ${b.preheader.text.length} caracteres (recomendado 40–100)` });
  if (b.subject && b.subject.text.length > 60) add({ code: 'SUBJECT_LONG', severity: 'warning', message: `Asunto de ${b.subject.text.length} caracteres: en mobile se corta hacia los 35–45` });

  // Enlaces.
  for (const m of b.modules) for (const c of ctasOf(m)) {
    if (!c.url) { add({ code: 'URL_MISSING', severity: 'warning', message: `${m.id}: ${quote(c.label.text, 40)} sin URL → «#FALTA-URL» en el diseño` }); continue; }
    let host = '';
    try { host = new URL(c.url).hostname; } catch { add({ code: 'URL_INVALID', severity: 'blocking', message: `${m.id}: URL no válida ${quote(c.url, 60)}` }); continue; }
    if (!c.url.startsWith('https://')) add({ code: 'URL_NOT_HTTPS', severity: 'warning', message: `${m.id}: la URL no es https` });
    if (ctx.client.domains.length && !ctx.client.domains.some((d) => host === d || host.endsWith(`.${d}`))) add({ code: 'URL_FOREIGN_DOMAIN', severity: 'pending', message: `${m.id}: el dominio ${host} no es de ${ctx.client.name} (${ctx.client.domains.join(', ')}); confirmar` });
  }

  // Imágenes.
  for (const m of b.modules) for (const im of imagesOf(m)) {
    if (!im.decorative && !im.alt) add({ code: 'ALT_MISSING', severity: 'pending', message: `${m.id}: imagen ${quote(im.label, 40)} sin texto alternativo (proponer uno)` });
    if (!im.figmaNodeId) add({ code: 'IMAGE_PLACEHOLDER', severity: 'warning', message: `${m.id}: ${quote(im.label, 40)} no está en Figma → placeholder identificado` });
  }

  // Colores.
  const seenObserved = new Set<string>();
  const colorCheck = (id: string | null, where: string) => {
    if (!id) return;
    const c = colorById(ctx, id);
    if (!c) add({ code: 'COLOR_UNKNOWN', severity: 'blocking', message: `${where}: ${id} no es un color del cliente` });
    else if (!usableColor(c)) add({ code: 'COLOR_UNCONFIRMED', severity: 'blocking', message: `${where}: ${id} está pendiente de confirmar; no se usa` });
    else if (c.status === 'observed' && !seenObserved.has(id)) { seenObserved.add(id); add({ code: 'COLOR_OBSERVED', severity: 'warning', message: `${id} ${c.hex}: observado en emails del cliente, no escrito como norma (${c.source})` }); }
  };
  colorCheck(b.canvas.background, 'fondo'); colorCheck(b.canvas.text, 'texto');
  const canvasBg = colorById(ctx, b.canvas.background)?.hex ?? '#FFFFFF';
  for (const m of b.modules) {
    colorCheck(m.background, `${m.id} · fondo`); colorCheck(m.textColor, `${m.id} · texto`);
    const bg = colorById(ctx, m.background)?.hex ?? canvasBg;
    const tx = colorById(ctx, m.textColor ?? b.canvas.text)?.hex ?? bestTextColor(ctx, bg)?.hex;
    if (tx) {
      const k = contrast(tx, bg);
      if (k < 3) add({ code: 'TEXT_CONTRAST_LOW', severity: 'blocking', message: `${m.id}: texto ${tx} sobre ${bg} con contraste ${k.toFixed(2)} (< 3)` });
      else if (k < 4.5) add({ code: 'TEXT_CONTRAST_LARGE_ONLY', severity: 'warning', message: `${m.id}: contraste ${k.toFixed(2)}, solo válido para texto grande (WCAG 1.4.3)` });
    }
  }

  // Lagunas que hay que decidir antes de diseñar (cada una con propuesta).
  for (const role of EMAIL_TEXT_ROLES) if (!typeFor(ctx, b, role)) add({ code: 'FONT_UNDECIDED', severity: 'pending', message: `El cliente no define la tipografía de email para ${role}`, proposal: `${WEB_SAFE_PROPOSAL.stack} (en Figma ${WEB_SAFE_PROPOSAL.figma.family}, métricamente compatible con Arial; el pipeline HTML solo admite fuentes web-safe)` });
  const usesCta = b.modules.some((m) => ctasOf(m).length);
  const cta = b.decisions.cta ?? (ctx.email?.cta && ctx.email.cta.fill && ctx.email.cta.text && ctx.email.cta.radius !== null ? { fill: ctx.email.cta.fill, text: ctx.email.cta.text } : null);
  if (usesCta && !cta) add({ code: 'CTA_STYLE_UNDECIDED', severity: 'pending', message: 'El cliente no define por completo el botón (color, texto o radio)', proposal: ctaProposal(ctx, canvasBg) });
  if (cta) {
    colorCheck(cta.fill, 'CTA · fondo'); colorCheck(cta.text, 'CTA · texto');
    const f = colorById(ctx, cta.fill), t = colorById(ctx, cta.text);
    if (f && t && contrast(f.hex, t.hex) < 4.5) add({ code: 'CTA_CONTRAST', severity: 'blocking', message: `CTA: texto sobre botón con contraste ${contrast(f.hex, t.hex).toFixed(2)} (< 4,5)` });
  }
  const logoId = b.decisions.logo?.logoId ?? ctx.email?.logo?.logoId ?? null;
  if (b.modules.some((m) => m.type === 'header')) {
    if (!logoId) add({ code: 'LOGO_UNDECIDED', severity: 'pending', message: 'El cliente no define qué logo usa en email', proposal: logoProposal(ctx) });
    else {
      const l = ctx.brand?.logos.find((x) => x.id === logoId);
      if (!l) add({ code: 'LOGO_UNKNOWN', severity: 'blocking', message: `La marca no tiene el logo ${logoId}` });
      else if (!l.externalUse) add({ code: 'LOGO_NOT_EXTERNAL', severity: 'blocking', message: `${l.label}: no apto para comunicación externa` });
      else if (!l.file?.endsWith('.svg') || !ctx.logoSvgs[logoId]) add({ code: 'LOGO_PLACEHOLDER', severity: 'warning', message: `${l.label}: sin SVG en el conocimiento → hueco de logo identificado (exportar el PNG @2x desde el archivo del cliente)` });
    }
  }
  for (const r of ctx.email?.footer?.required ?? []) if (!r.text) add({ code: 'FOOTER_TEXT_PENDING', severity: 'warning', message: `Pie: «${r.label}» lo aporta el cliente → «[PENDIENTE: ${r.label}]»` });

  if (!b.confirmation) add({ code: 'BRIEF_NOT_CONFIRMED', severity: 'pending', message: 'Falta tu confirmación de la estructura, los copys y las decisiones' });
  else if (b.confirmation.hash !== emailBriefHash(b)) add({ code: 'BRIEF_CHANGED_AFTER_CONFIRMATION', severity: 'pending', message: 'El brief cambió después de tu confirmación' });
  const counts = { approved: 0, proposed: 0, placeholder: 0 };
  for (const { copy } of all) counts[copy.source === 'agent_draft' ? 'proposed' : copy.source === 'placeholder' ? 'placeholder' : 'approved']++;
  return { issues, ready: !issues.some((i) => i.severity !== 'warning'), copy: counts };
}

function ctaProposal(ctx: KnowledgeContext, bg: string): string {
  const pal = palette(ctx).filter(usableColor).filter((c) => c.hex !== bg);
  // Preferencia: color de CTA del canal → color primario de la marca → cualquiera; entre ellos, el que más destaca del fondo.
  const ctaRole = pal.filter((c) => ctx.email?.colors.find((x) => x.id === c.id)?.roles.some((r) => /cta|bot/i.test(r)));
  const primary = pal.filter((c) => ctx.brand?.colors.find((x) => x.id === c.id)?.role === 'primary' && contrast(c.hex, bg) >= 3);
  const fill = (ctaRole.length ? ctaRole : primary.length ? primary : pal).sort((a, b) => contrast(b.hex, bg) - contrast(a.hex, bg))[0];
  if (!fill) return 'no hay un color de la paleta distinto del fondo';
  const text = pal.filter((c) => c.id !== fill.id).sort((a, b) => contrast(b.hex, fill.hex) - contrast(a.hex, fill.hex))[0];
  return `botón ${fill.id} ${fill.hex} con texto ${text?.id ?? '—'} (contraste ${text ? contrast(text.hex, fill.hex).toFixed(2) : '—'}), radio 4 px (las esquinas pueden salir rectas en Outlook)`;
}

function logoProposal(ctx: KnowledgeContext): string {
  const l = ctx.brand?.logos.find((x) => x.externalUse && x.version === 'primary' && x.file?.endsWith('.svg')) ?? ctx.brand?.logos.find((x) => x.externalUse);
  return l ? `${l.label} (${l.id}), ancho ${Math.max(l.minWidthPx ?? 0, 160)} px, centrado` : 'ninguno apto en el kit';
}

export function confirmEmailBrief(b: EmailBrief, ctx: KnowledgeContext, by: string, note: string): EmailBrief {
  const stop = checkEmailBrief(b, ctx).issues.filter((i) => i.severity === 'blocking' || (i.severity === 'pending' && !['BRIEF_NOT_CONFIRMED', 'BRIEF_CHANGED_AFTER_CONFIRMATION'].includes(i.code)));
  if (stop.length) throw new Error(`El brief no se puede confirmar todavía:\n${stop.map((i) => `- ${i.message}${i.proposal ? ` (propuesta: ${i.proposal})` : ''}`).join('\n')}`);
  return { ...b, confirmation: { by, at: new Date().toISOString(), note, hash: emailBriefHash(b) } };
}

const SRC: Record<Copy['source'], string> = { brief: 'brief', client_approved: 'aprobado', agent_draft: '**PROPUESTA**', placeholder: 'pendiente' };

export function renderEmailBriefSummary(b: EmailBrief, ctx: KnowledgeContext, chk: BriefCheck): string {
  const out = [`# Email ${quote(b.name)} — ${ctx.client.name}`, '', `Objetivo: ${b.objective ?? '—'} · Audiencia: ${b.audience ?? '—'} · Mensaje: ${b.mainMessage ?? '—'}`, ''];
  out.push(`Conocimiento usado: ${ctx.loaded.map((f) => `${f.id} v${f.version} (${f.status})`).join(', ')}.`, '');
  out.push('## Estructura', '', '| # | Módulo | Tipo | Para qué |', '|---|---|---|---|');
  b.modules.forEach((m, i) => out.push(`| ${i + 1} | ${m.id} | ${m.type} | ${quote(m.purpose, 80)} |`));
  out.push('', `## Copys (${chk.copy.approved} aprobados, ${chk.copy.proposed} propuestos, ${chk.copy.placeholder} pendientes)`, '', '| Dónde | Texto | Origen |', '|---|---|---|');
  for (const { where, copy } of copiesOf(b)) out.push(`| ${where} | ${quote(copy.text, 90)} | ${SRC[copy.source]} |`);
  const dec = [
    ...Object.entries(b.decisions.fonts).map(([r, d]) => `Tipografía ${r}: ${d!.stack} (Figma ${d!.figma.family} ${d!.figma.style}) — ${d!.by}`),
    ...(b.decisions.cta ? [`CTA: ${b.decisions.cta.fill} / ${b.decisions.cta.text}, radio ${b.decisions.cta.radius} — ${b.decisions.cta.by}`] : []),
    ...(b.decisions.logo ? [`Logo: ${b.decisions.logo.logoId}, ${b.decisions.logo.widthPx}px — ${b.decisions.logo.by}`] : []),
    ...b.decisions.other.map((d) => `${d.topic}: ${d.decision} — ${d.by}`),
  ];
  if (dec.length) out.push('', '## Decisiones del encargo', '', ...dec.map((d) => `- ${d}`));
  if (b.assumptions.length) out.push('', '## Supuestos', '', ...b.assumptions.map((a) => `- ${a}`));
  const order = { blocking: 0, pending: 1, warning: 2 };
  if (chk.issues.length) {
    out.push('', '## Pendiente o a revisar', '');
    for (const i of [...chk.issues].sort((x, y) => order[x.severity] - order[y.severity])) out.push(`- ${i.severity === 'blocking' ? '⛔' : i.severity === 'pending' ? '❓' : 'ℹ'} ${i.message}${i.proposal ? ` — propuesta: ${i.proposal}` : ''}`);
  }
  out.push('', chk.ready ? '✔ Brief confirmado.' : '¿Confirmas la estructura, los copys propuestos y las decisiones? Con tu sí lo registro y diseño desktop y mobile.', '');
  return out.join('\n');
}

export type { EmailTextRole };
