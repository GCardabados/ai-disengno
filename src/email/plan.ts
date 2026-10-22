// Plan de un email (email-plan): árbol de nodos EXACTO para desktop y para mobile, con medidas enteras (las columnas y
// sus separaciones suman exactamente el ancho útil, como exige la maquetación HTML), tokens resueltos con procedencia,
// notas de desarrollo y reglas internas declaradas. Mobile NO es desktop reducido: cada tipo de módulo tiene su regla
// de transformación (columnas → apiladas en el orden del código, CTA a ancho completo, márgenes y titulares propios).
import type { KnowledgeContext } from '../knowledge/store.ts';
import { EMAIL_PLAN_SCHEMA_ID, type Copy, type EmailBrief, type EmailPlan, type ImageSpec, type ModuleSpec, type PButton, type PColor, type PFrame, type PImage, type PLogo, type PNode, type PText, type ProvenanceT } from '../contracts/email.ts';
import type { EmailTextRole } from '../contracts/knowledge.ts';
import { contrast, svgAspect } from '../brand/color.ts';
import { checkEmailBrief, emailBriefHash } from './brief.ts';
import { bestTextColor, colorById, DEFAULT_CTA, DEFAULT_LAYOUT, layoutValue, typeFor, usableColor, type TypeRes } from './tokens.ts';
import { checkPlanTree } from './check.ts';

export type Bp = 'desktop' | 'mobile';
const PLACEHOLDER_FILL: PColor = { id: 'placeholder', hex: '#D9D9D9' };
const NOTES_FONT = { family: 'Inter', style: 'Regular' };
export const FALTA_URL = '#FALTA-URL';
/** Cita para notas que también se dibujan en Figma: sin escapes Markdown, solo controles fuera y recorte. */
const plain = (t: string, max = 100) => { const one = t.replace(/\s*\n\s*/g, ' / ').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, ''); return `«${one.length > max ? `${one.slice(0, max - 1)}…` : one}»`; };

interface Ctx {
  ctx: KnowledgeContext; b: EmailBrief; bp: Bp; W: number; pad: number; band: number; gap: number;
  types: Record<EmailTextRole, TypeRes>; canvas: PColor; canvasText: PColor;
  cta: { fill: PColor; text: PColor; radius: number | 'pill'; h: number; fullWidthMobile: boolean } | null;
  link: { color: PColor | null; underline: boolean };
  notes: EmailPlan['notes']; warnings: string[]; blockers: string[]; internalRules: string[];
}

const C = (ctx: KnowledgeContext, id: string | null | undefined): PColor | null => { const c = colorById(ctx, id); return usableColor(c) ? { id: c.id, hex: c.hex } : null; };
const suffix = (c: Copy) => (c.source === 'agent_draft' ? ' [PROPUESTA]' : c.source === 'placeholder' ? ' [PENDIENTE]' : '');
const statusOf = (c: Copy): PText['status'] => (c.source === 'agent_draft' ? 'proposed' : c.source === 'placeholder' ? 'placeholder' : 'approved');

function text(k: Ctx, role: EmailTextRole, name: string, copy: Copy, color: PColor, align: 'left' | 'center', opts: { bold?: boolean; underline?: boolean; url?: string | null } = {}): PText {
  const t = k.types[role];
  const [size, lh] = k.bp === 'desktop' ? t.d : t.m;
  const style = opts.bold && !/bold/i.test(t.figma.style) ? 'Bold' : t.figma.style;
  if (copy.source === 'agent_draft') k.notes.proposedCopy.push(`${name}: ${plain(copy.text, 120)}`);
  return {
    k: 'text', name: `${name}${suffix(copy)}`, role, text: copy.text, font: { family: t.figma.family, style }, stack: t.stack, size, lineHeight: lh, color,
    align: align === 'center' ? 'CENTER' : 'LEFT', underline: opts.underline ?? false, upper: t.upper, url: opts.url === undefined ? null : opts.url ?? FALTA_URL,
    status: statusOf(copy), note: copy.source === 'agent_draft' ? 'PROPUESTA del agente: pendiente de aprobación' : copy.source === 'placeholder' ? 'PENDIENTE: no se puede completar con seguridad' : null,
  };
}

function image(k: Ctx, im: ImageSpec, name: string, w: number, fallback: PColor): PImage {
  const h = Math.round((w * im.ratio[1]) / im.ratio[0]);
  const alt = im.decorative ? 'alt="" (decorativa)' : im.alt ? `alt: ${plain(im.alt.text, 140)}${im.alt.source === 'agent_draft' ? ' (PROPUESTA)' : ''}` : 'alt: [PENDIENTE]';
  const exp = `${w * 2}×${h * 2} px @2x`;
  if (k.bp === 'desktop' || im.mobileCrop) k.notes.development.push(`${name}: ${plain(im.label, 60)} — exportar ${exp}${im.figmaNodeId ? ` desde el nodo ${im.figmaNodeId}` : ' (asset PENDIENTE)'}; ${alt}`);
  return { k: 'image', name, w, h, fallback, label: `[IMAGEN PENDIENTE] ${im.label} · ${exp}`, figmaNodeId: im.figmaNodeId, note: `${alt} · ${exp}${im.mobileCrop && k.bp === 'mobile' ? ' · recorte MOBILE propio' : ''}` };
}

function button(k: Ctx, cta: NonNullable<ModuleSpec['cta']>, comp: string, inner: number, align: 'left' | 'center', bg: PColor): PButton | PText {
  if (!k.cta) return text(k, 'body', 'CTA', cta.label, k.link.color ?? k.canvasText, align, { underline: true, url: cta.url });
  const h = k.bp === 'desktop' ? k.cta.h : Math.max(k.cta.h, DEFAULT_CTA.heightMobile);
  const primary = cta.variant === 'primary';
  const fill = primary ? k.cta.fill : bg;
  const fg = primary ? k.cta.text : contrast(k.cta.fill.hex, bg.hex) >= 4.5 ? k.cta.fill : k.canvasText;
  const t = text(k, 'cta', 'CTA_texto', cta.label, fg, 'center', { url: cta.url });
  // WCAG 1.4.11: si el relleno del botón no se distingue del fondo (< 3:1), borde en el color de su texto (de la paleta).
  let border: PColor | null = primary ? null : k.cta.fill;
  if (primary && contrast(fill.hex, bg.hex) < 3 && contrast(fg.hex, bg.hex) >= 3) {
    border = fg;
    const rule = `Botón con borde de 2 px en ${fg.id} cuando su relleno no alcanza 3:1 con el fondo (WCAG 1.4.11; colores de la paleta)`;
    if (!k.internalRules.includes(rule)) k.internalRules.push(rule);
  }
  return {
    k: 'button', name: `CTA${primary ? '' : '_secundario'}${suffix(cta.label)}`, w: k.bp === 'mobile' && k.cta.fullWidthMobile ? inner : null, h, fill, border,
    radius: k.cta.radius === 'pill' ? Math.round(h / 2) : k.cta.radius, padX: DEFAULT_CTA.padX, text: t, comp: `${comp}${primary ? '' : '-secundario'}`,
    note: `Botón en texto vivo (bulletproof), ${h}px de alto; URL: ${cta.url ?? FALTA_URL}${k.bp === 'mobile' && k.cta.fullWidthMobile ? '; ancho completo en mobile' : ''}`,
  };
}

const band = (k: Ctx, name: string, fill: PColor, align: 'left' | 'center', children: PNode[], note: string | null, padY?: number): PFrame => ({
  k: 'frame', name, dir: 'V', w: k.W, pad: [padY ?? k.band, k.pad, padY ?? k.band, k.pad], gap: DEFAULT_LAYOUT.ctaGap, fill, align: align === 'center' ? 'CENTER' : 'MIN', children, comp: null, note,
});
const stack = (name: string, w: number, gap: number, align: 'left' | 'center', children: PNode[]): PFrame => ({ k: 'frame', name, dir: 'V', w, pad: [0, 0, 0, 0], gap, fill: null, align: align === 'center' ? 'CENTER' : 'MIN', children, comp: null, note: null });

/** Anchos enteros de n columnas que suman exactamente el ancho útil (el resto va a la última). */
export function columnWidths(inner: number, n: number, gap: number): number[] {
  const base = Math.floor((inner - gap * (n - 1)) / n);
  const ws = Array.from({ length: n }, () => base);
  ws[n - 1] = inner - gap * (n - 1) - base * (n - 1);
  return ws;
}

function textBlock(k: Ctx, m: ModuleSpec, w: number, color: PColor, align: 'left' | 'center'): PNode[] {
  const out: PNode[] = [];
  if (m.eyebrow) out.push(text(k, 'small', 'Antetitulo', m.eyebrow, color, align, { bold: true }));
  if (m.headline) out.push(text(k, m.headlineLevel ?? 'h2', 'Titular', m.headline, color, align));
  m.body.forEach((c, i) => out.push(text(k, 'body', `Parrafo${i + 1}`, c, color, align)));
  return out.length ? [stack('Textos', w, k.gap, align, out)] : [];
}

function moduleNode(k: Ctx, m: ModuleSpec, logo: { id: string | null; w: number; h: number; label: string; minW: number | null } | null): PNode {
  const bg = C(k.ctx, m.background) ?? k.canvas;
  const fg = C(k.ctx, m.textColor) ?? (m.background ? (() => { const c = bestTextColor(k.ctx, bg.hex); return c ? { id: c.id, hex: c.hex } : k.canvasText; })() : k.canvasText);
  const inner = k.W - 2 * k.pad;
  const isD = k.bp === 'desktop';
  // Párrafos largos centrados en desktop → izquierda en mobile.
  const longText = m.body.some((c) => c.text.length > 180);
  let align: 'left' | 'center' = m.align ?? (m.type === 'hero' || m.type === 'cta' ? 'center' : 'left');
  if (!isD && align === 'center' && longText) align = 'left';
  const ctaNode = (bgc: PColor) => (m.cta ? [button(k, m.cta, 'cta', inner, align, bgc)] : []);
  // Texto centrado en desktop con medida máxima: líneas centradas largas se leen mal y dejan viudas en los titulares.
  const measure = isD && align === 'center' ? Math.min(inner, DEFAULT_LAYOUT.centerMeasure) : inner;
  if (measure < inner) {
    const rule = `Texto centrado en desktop con medida máxima ${DEFAULT_LAYOUT.centerMeasure}px (≈ 55–60 caracteres a 16 px; evita líneas centradas largas y viudas en titulares)`;
    if (!k.internalRules.includes(rule)) k.internalRules.push(rule);
  }

  switch (m.type) {
    case 'header': {
      const children: PNode[] = [];
      if (k.ctx.email?.header?.viewOnline || m.eyebrow) {
        if (!m.eyebrow && isD) k.warnings.push(`VIEW_ONLINE_TEXT_MISSING: el cliente usa «ver online» pero el brief no trae su texto (header.eyebrow) → placeholder`);
        children.push(text(k, 'small', 'Ver_online', m.eyebrow ?? { text: '[PENDIENTE: texto «ver en el navegador»]', source: 'placeholder', note: null }, fg, 'center', { underline: true, url: null }));
      }
      if (logo) {
        const w = isD ? logo.w : Math.max(logo.minW ?? 0, Math.min(logo.w, Math.floor(inner * 0.6)));
        const h = Math.round((w * logo.h) / logo.w);
        const node: PLogo = { k: 'logo', name: 'Logotipo', w, h, svgId: logo.id, label: logo.label, note: logo.id ? null : '[LOGO PENDIENTE] exportar el PNG @2x desde el archivo del cliente' };
        children.push(node);
      }
      const logoAlign = k.ctx.email?.logo?.align ?? 'center';
      const f = band(k, m.id, bg, logoAlign, children, 'Cabecera: logo enlazado a la web del cliente. Mobile: mismo orden, logo ≤ 60 % del ancho útil y nunca por debajo de su mínimo.', isD ? 24 : 20);
      f.gap = isD ? 16 : 12;
      f.comp = 'header';
      return f;
    }
    case 'hero': {
      const content = band(k, 'Contenido', bg, align, [...textBlock(k, m, measure, fg, align), ...ctaNode(bg)], null);
      const kids: PNode[] = m.image ? [image(k, m.image, isD ? 'Imagen_desktop' : 'Imagen_mobile', k.W, bg), content] : [content];
      return { k: 'frame', name: m.id, dir: 'V', w: k.W, pad: [0, 0, 0, 0], gap: 0, fill: bg, align: 'MIN', children: kids, comp: null, note: 'Hero: imagen a ancho completo SIN texto encima (con imágenes bloqueadas el mensaje sigue en texto vivo). Mobile: imagen 100 % del ancho manteniendo proporción, márgenes laterales propios, titular un escalón menor y CTA a ancho completo.' };
    }
    case 'text':
      return band(k, m.id, bg, align, [...textBlock(k, m, measure, fg, align), ...ctaNode(bg)], 'Texto a una columna. Mobile: márgenes laterales propios; párrafos largos alineados a la izquierda.');
    case 'cta':
      return band(k, m.id, bg, 'center', [...textBlock(k, m, isD ? Math.min(inner, DEFAULT_LAYOUT.centerMeasure) : inner, fg, 'center'), ...ctaNode(bg)], 'Bloque de acción. Mobile: botón a ancho completo y 48 px de alto.');
    case 'image-text': {
      const im = m.image!;
      if (isD) {
        const gap = 24;
        const [w1, w2] = columnWidths(inner, 2, gap) as [number, number];
        const imgW = m.imageSide === 'left' ? w1 : w2, txtW = m.imageSide === 'left' ? w2 : w1;
        const img = image(k, im, m.imageSide === 'left' ? 'ImgIzq_dk' : 'ImgDer_dk', imgW, bg);
        const txt = stack('Columna_texto', txtW, DEFAULT_LAYOUT.ctaGap, align, [...textBlock(k, m, txtW, fg, align), ...ctaNode(bg)]);
        const row: PFrame = { k: 'frame', name: 'Columnas', dir: 'H', w: inner, pad: [0, 0, 0, 0], gap, fill: null, align: 'MIN', children: m.imageSide === 'left' ? [img, txt] : [txt, img], comp: null, note: null };
        return band(k, m.id, bg, 'left', [row], `Imagen y texto en 2 columnas (${imgW}+${gap}+${txtW} = ${inner}). Mobile: se apilan en el orden del código (${m.imageSide === 'left' ? 'imagen arriba' : 'texto arriba, imagen debajo; subir la imagen exigiría dir="rtl"'}).`);
      }
      const img = image(k, im, m.imageSide === 'left' ? 'ImgIzq_mb' : 'ImgDer_mb', inner, bg);
      const txt = [...textBlock(k, m, inner, fg, align), ...ctaNode(bg)];
      return band(k, m.id, bg, align, m.imageSide === 'left' ? [img, ...txt] : [...txt, img], null);
    }
    case 'columns': {
      const n = isD ? m.columns ?? 2 : 1;
      const gap = isD && n > 1 ? 24 : 0;
      const ws = isD ? columnWidths(inner, n, gap) : [inner];
      if (isD && m.items.every((it) => !it.image) && Math.min(...ws) < DEFAULT_LAYOUT.minTextColumn) k.warnings.push(`NARROW_COLUMNS: ${m.id}: columnas de solo texto de ${Math.min(...ws)}px (< ${DEFAULT_LAYOUT.minTextColumn}): medida de ~${Math.round(Math.min(...ws) / 8.5)} caracteres por línea; valorar 2 columnas, iconos o una lista`);
      const linkColor = k.link.color ?? fg;
      const item = (it: ModuleSpec['items'][number], i: number, w: number): PFrame => {
        const kids: PNode[] = [];
        if (it.image) kids.push(image(k, it.image, `Imagen_${i + 1}_${isD ? 'dk' : 'mb'}`, w, bg));
        if (it.title) kids.push(text(k, 'body', `Titulo_${i + 1}`, it.title, fg, align, { bold: true }));
        if (it.body) kids.push(text(k, 'body', `Texto_${i + 1}`, it.body, fg, align));
        if (it.link) kids.push(text(k, 'body', `Enlace_${i + 1}`, it.link.label, linkColor, align, { underline: k.link.underline, url: it.link.url, bold: true }));
        return stack(`Elemento_${i + 1}`, w, isD ? 8 : 8, align, kids);
      };
      const rows: PNode[] = [];
      for (let r = 0; r < m.items.length; r += n) {
        const slice = m.items.slice(r, r + n);
        if (!isD || n === 1) { rows.push(item(slice[0]!, r, inner)); continue; }
        rows.push({ k: 'frame', name: `Fila_${r / n + 1}`, dir: 'H', w: inner, pad: [0, 0, 0, 0], gap, fill: null, align: 'MIN', children: slice.map((it, j) => item(it, r + j, ws[j]!)), comp: null, note: null });
      }
      const grid = stack('Elementos', inner, 24, align, rows);
      return band(k, m.id, bg, align, [...textBlock(k, m, inner, fg, align), grid, ...ctaNode(bg)], isD ? (n === 1 ? 'Lista de elementos a una columna (misma estructura en mobile, con márgenes propios).' : `${n} columnas en desktop (${ws.join('+')} con separación ${gap} = ${inner}). Mobile: 1 columna, elementos apilados en el orden del código; imágenes al 100 %.`) : null);
    }
    case 'legal': {
      const kids = m.body.map((c, i) => text(k, 'legal', i ? `Legal${i + 1}` : 'Legal', c, fg, 'left'));
      return band(k, m.id, bg, 'left', [stack('Textos', inner, 8, 'left', kids)], 'Legales en texto vivo, contraste ≥ 4,5:1, alineados a la izquierda. Mobile: mismo tamaño (12 px mínimo).', isD ? 24 : 20);
    }
    case 'footer': {
      const req = k.ctx.email?.footer?.required ?? [{ id: 'baja', label: 'Enlace de baja / gestión de preferencias', text: null, source: 'skill' }, { id: 'remitente', label: 'Identificación legal del remitente', text: null, source: 'skill' }];
      const kids: PNode[] = [
        ...m.body.map((c, i) => text(k, 'legal', `Footer_texto${i + 1}`, c, fg, 'center')),
        ...req.map((r) => text(k, 'legal', `Footer_${r.id}`, r.text ? { text: r.text, source: 'client_approved', note: null } : { text: `[PENDIENTE: ${r.label}]`, source: 'placeholder', note: null }, fg, 'center', /baja|prefer/i.test(r.id + r.label) ? { underline: true, url: null } : {})),
      ];
      const fill = C(k.ctx, m.background ?? k.ctx.email?.footer?.background) ?? bg;
      const f = band(k, m.id, fill, 'center', [stack('Textos', inner, 8, 'center', kids)], `Pie: baja visible (nunca escondida) e identificación del remitente.${k.ctx.email?.footer?.moduleId ? ` El cliente tiene un pie propio (${k.ctx.email.footer.moduleId}): en producción se usa ese componente.` : ''}`, isD ? 32 : 24);
      f.comp = 'footer';
      return f;
    }
  }
}

export function buildEmailPlan(b: EmailBrief, ctx: KnowledgeContext): EmailPlan {
  const blockers: string[] = [], warnings: string[] = [], internalRules: string[] = [], conflicts: string[] = [];
  const provenance: ProvenanceT[] = [];
  const chk = checkEmailBrief(b, ctx);
  for (const i of chk.issues) (i.severity === 'warning' ? warnings : blockers).push(`${i.code}: ${i.message}`);
  for (const i of ctx.issues) if (/CONFLICT|POLICY/.test(i.code)) conflicts.push(`${i.code}: ${i.message}`);
  const notes: EmailPlan['notes'] = { responsive: [], accessibility: [], development: [], darkMode: [], decisions: [], assumptions: [...b.assumptions], pending: [], proposedCopy: [] };

  const wD = layoutValue(ctx, 'desktopWidthPx', DEFAULT_LAYOUT.desktopWidth), wM = layoutValue(ctx, 'mobileWidthPx', DEFAULT_LAYOUT.mobileWidth);
  const pD = layoutValue(ctx, 'sidePaddingDesktopPx', DEFAULT_LAYOUT.padDesktop), pM = layoutValue(ctx, 'sidePaddingMobilePx', DEFAULT_LAYOUT.padMobile);
  for (const [topic, v] of [['ancho desktop', wD], ['ancho mobile', wM], ['margen lateral desktop', pD], ['margen lateral mobile', pM]] as const) {
    provenance.push({ topic, value: `${v.value}px`, from: v.from, source: v.source });
    if (v.from === 'skill_default') internalRules.push(`${topic}: ${v.value}px (valor por defecto de la skill; el cliente no lo define)`);
  }
  internalRules.push(`Separación vertical de bandas ${DEFAULT_LAYOUT.bandDesktop}/${DEFAULT_LAYOUT.bandMobile}px y entre textos ${DEFAULT_LAYOUT.gapDesktop}/${DEFAULT_LAYOUT.gapMobile}px, ${DEFAULT_LAYOUT.ctaGap}px antes del CTA (desktop/mobile; múltiplos de 8)`);

  // Tipografía.
  const types = {} as Record<EmailTextRole, TypeRes>;
  for (const role of ['h1', 'h2', 'body', 'small', 'cta', 'legal'] as const) {
    const t = typeFor(ctx, b, role);
    if (!t) { blockers.push(`FONT_UNDECIDED: ${role}`); continue; }
    types[role] = t;
    provenance.push({ topic: `tipografía ${role}`, value: `${t.stack} · Figma ${t.figma.family} ${t.figma.style} · ${t.d[0]}/${t.d[1]} → ${t.m[0]}/${t.m[1]}`, from: t.from, source: t.source });
    if (t.derived) internalRules.push(t.derived);
    const first = t.stack.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
    if (first !== t.figma.family) notes.development.push(`${role}: implementar con «${t.stack}»; en Figma se diseña con ${t.figma.family} (sustituto métrico declarado).`);
  }
  if (!Object.keys(types).length || blockers.some((x) => x.startsWith('FONT_UNDECIDED'))) return emptyPlan();

  // Colores base.
  const canvas = C(ctx, b.canvas.background) ?? C(ctx, ctx.email?.colors.find((c) => c.roles.some((r) => /fondo|background/i.test(r)))?.id) ?? { id: 'white', hex: '#FFFFFF' };
  if (canvas.id === 'white' && !colorById(ctx, 'white')) internalRules.push('Fondo del email blanco #FFFFFF (el cliente no define un fondo de email)');
  const canvasText = C(ctx, b.canvas.text) ?? (() => { const c = bestTextColor(ctx, canvas.hex); return c ? { id: c.id, hex: c.hex } : { id: 'black', hex: '#000000' }; })();
  provenance.push({ topic: 'fondo / texto', value: `${canvas.id} ${canvas.hex} / ${canvasText.id} ${canvasText.hex}`, from: b.canvas.background ? 'brief_decision' : 'skill_default', source: b.canvas.background ? 'encargo' : 'paleta del cliente, mayor contraste' });

  // CTA.
  const ec = ctx.email?.cta;
  const dc = b.decisions.cta;
  let cta: Ctx['cta'] = null;
  const fillId = dc?.fill ?? ec?.fill, textId = dc?.text ?? ec?.text, radius = dc?.radius ?? ec?.radius ?? null;
  if (fillId && textId && radius !== null) {
    const fill = C(ctx, fillId), tx = C(ctx, textId);
    if (fill && tx) {
      cta = { fill, text: tx, radius, h: Math.max(ec?.heightPx ?? DEFAULT_CTA.heightDesktop, 44), fullWidthMobile: ec?.fullWidthMobile ?? DEFAULT_CTA.fullWidthMobile };
      provenance.push({ topic: 'CTA', value: `${fill.id}/${tx.id}, radio ${radius}, alto ${cta.h}px`, from: dc ? 'brief_decision' : ec!.status === 'confirmed' ? 'email_confirmed' : 'email_observed', source: dc ? `encargo (${dc.by})` : ec!.source });
      if (!ec?.heightPx) internalRules.push(`CTA de ${cta.h}px de alto (≥ 44 px; el cliente no lo define)`);
    }
  }
  const linkC = C(ctx, ctx.email?.links?.color);
  const link = { color: linkC, underline: ctx.email?.links?.underline ?? true };
  if (!ctx.email?.links) internalRules.push('Enlaces en texto subrayados y del color del texto (WCAG 1.4.1; el cliente no define estilo de enlace)');

  // Logo.
  const logoId = b.decisions.logo?.logoId ?? ctx.email?.logo?.logoId ?? null;
  const bl = logoId ? ctx.brand?.logos.find((l) => l.id === logoId) : null;
  let logo: Parameters<typeof moduleNode>[2] = null;
  if (bl) {
    const svg = ctx.logoSvgs[bl.id] ?? null;
    const w = b.decisions.logo?.widthPx ?? ctx.email?.logo?.widthPx ?? Math.max(bl.minWidthPx ?? 0, 160);
    if (bl.minWidthPx && w < bl.minWidthPx) blockers.push(`LOGO_BELOW_MIN: ${bl.label} a ${w}px, por debajo del mínimo de marca ${bl.minWidthPx}px`);
    const aspect = svg ? svgAspect(svg) ?? 4 : 4;
    logo = { id: svg ? bl.id : null, w, h: Math.round(w / aspect), label: bl.label, minW: bl.minWidthPx };
    provenance.push({ topic: 'logo', value: `${bl.label}, ${w}px${svg ? '' : ' (hueco pendiente: sin SVG)'}`, from: b.decisions.logo ? 'brief_decision' : ctx.email?.logo?.status === 'confirmed' ? 'email_confirmed' : 'email_observed', source: b.decisions.logo ? 'encargo' : ctx.email?.logo?.source ?? 'brand.json' });
    if (!svg) { notes.pending.push(`Logo ${bl.label}: falta el archivo; se dibuja un hueco del tamaño previsto.`); internalRules.push('Hueco de logo con proporción 4:1 (sin archivo del logo para medirla)'); }
  }

  // Árboles por versión.
  const trees: Record<Bp, PNode[]> = { desktop: [], mobile: [] };
  for (const bp of ['desktop', 'mobile'] as const) {
    const k: Ctx = {
      ctx, b, bp, W: bp === 'desktop' ? wD.value : wM.value, pad: bp === 'desktop' ? pD.value : pM.value,
      band: bp === 'desktop' ? DEFAULT_LAYOUT.bandDesktop : DEFAULT_LAYOUT.bandMobile, gap: bp === 'desktop' ? DEFAULT_LAYOUT.gapDesktop : DEFAULT_LAYOUT.gapMobile,
      types, canvas, canvasText, cta, link, notes: bp === 'desktop' ? notes : { ...notes, proposedCopy: [], development: notes.development }, warnings, blockers, internalRules,
    };
    trees[bp] = b.modules.map((m) => moduleNode(k, m, logo));
  }
  // Notas responsive (una por módulo, de la versión desktop).
  for (const n of trees.desktop) if (n.k === 'frame' && n.note) notes.responsive.push(`${n.name}: ${n.note}`);

  // Accesibilidad y desarrollo.
  notes.accessibility.push(`Orden de lectura = orden de los módulos: ${b.modules.map((m) => m.id).join(' → ')}. Un único H1 (${b.modules.find((m) => m.headlineLevel === 'h1')?.id ?? '—'}).`);
  notes.accessibility.push('Todo el copy es texto vivo; el mensaje y el CTA se entienden con las imágenes bloqueadas.');
  notes.accessibility.push('Enlaces subrayados; CTA descriptivos; área táctil ≥ 44 px. Referencia WCAG 2.2 AA: el diseño NO garantiza la accesibilidad del HTML (validar alt, lang, roles de tabla y orden del código).');
  notes.development.push(`Ancho ${wD.value}px; mobile diseñado a ${wM.value}px (comprobar a 320 px). Columnas híbridas que se apilan sin media queries.`);
  notes.development.push('Botones bulletproof (celda con fondo + enlace con padding); en Outlook clásico las esquinas pueden salir rectas.');
  const urls = b.modules.flatMap((m) => [...(m.cta ? [m.cta] : []), ...m.items.flatMap((i) => (i.link ? [i.link] : []))]);
  for (const u of urls) notes.development.push(`Enlace «${u.label.text}»: ${u.url ?? `${FALTA_URL} (pendiente)`}`);
  if (urls.some((u) => !u.url)) notes.pending.push(`URLs pendientes: ${urls.filter((u) => !u.url).map((u) => plain(u.label.text, 40)).join(', ')} → ${FALTA_URL}`);

  // Dark mode.
  const dm = ctx.email?.darkMode;
  if (dm?.strategy === 'designed') notes.darkMode.push(...dm.rules.map((r) => `${r.text} (${r.source})`));
  else {
    notes.darkMode.push(dm?.strategy === 'light_only' ? `El cliente trabaja solo en claro (${dm.source}).` : 'El cliente no define dark mode: se diseña en claro y se anotan riesgos.');
    notes.darkMode.push('Logo: necesita versión que funcione sobre oscuro (PNG con halo o versión clara) para Gmail app / Outlook.');
    notes.darkMode.push('Bloques de color de marca con poco texto: candidatos a imagen si el cliente de correo los invierte; el texto largo en fondos neutros se deja adaptable.');
    if (cta) notes.darkMode.push(`Comprobar que el CTA (${cta.fill.hex} / ${cta.text.hex}) conserva contraste tras la inversión parcial.`);
    for (const r of dm?.rules ?? []) notes.darkMode.push(`${r.text} (${r.status}, ${r.source})`);
  }

  // Decisiones y pendientes.
  for (const p of provenance) if (p.from === 'brief_decision') notes.decisions.push(`${p.topic}: ${p.value} (${p.source})`);
  for (const d of b.decisions.other) notes.decisions.push(`${d.topic}: ${d.decision} (${d.by})`);
  const placeholders = trees.desktop.flatMap(function walk(n: PNode): string[] { return n.k === 'frame' ? n.children.flatMap(walk) : n.k === 'text' && n.status === 'placeholder' ? [n.text] : n.k === 'button' && n.text.status === 'placeholder' ? [n.text.text] : n.k === 'image' && !n.figmaNodeId ? [n.label] : []; });
  notes.pending.push(...placeholders.map((p) => `Placeholder: ${plain(p, 100)}`));
  for (const q of ctx.email?.openQuestions ?? []) if (q.status === 'open') notes.pending.push(`Pregunta abierta del cliente: ${q.question}`);

  // Comprobaciones previas sobre el árbol (contraste, tamaños, sumas de anchos).
  for (const bp of ['desktop', 'mobile'] as const) for (const f of checkPlanTree(trees[bp], bp === 'desktop' ? wD.value : wM.value, canvas)) (f.severity === 'blocking' ? blockers : warnings).push(`${bp}: ${f.message}`);

  const subjT = (role: EmailTextRole, name: string, c: Copy | null): PText | null => (c ? text({ ctx, b, bp: 'desktop', W: wD.value, pad: 0, band: 0, gap: 0, types, canvas, canvasText, cta, link, notes, warnings, blockers, internalRules }, role, name, c, canvasText, 'left') : null);
  const fonts = new Map<string, { family: string; style: string }>();
  const collect = (n: PNode): void => { if (n.k === 'text') fonts.set(`${n.font.family}|${n.font.style}`, n.font); else if (n.k === 'button') collect(n.text); else if (n.k === 'frame') n.children.forEach(collect); };
  [...trees.desktop, ...trees.mobile].forEach(collect);
  const subject = { subject: subjT('body', 'Asunto', b.subject), preheader: subjT('small', 'Preheader', b.preheader) };
  [subject.subject, subject.preheader].forEach((t) => t && collect(t));
  const usedSvgs = Object.fromEntries(Object.entries(ctx.logoSvgs).filter(([id]) => id === logo?.id));

  return {
    schema: EMAIL_PLAN_SCHEMA_ID, briefSlug: b.slug, briefHash: emailBriefHash(b),
    client: { slug: ctx.client.slug, name: ctx.client.name, status: ctx.client.status },
    knowledge: ctx.loaded.map((f) => ({ id: f.id, version: f.version, status: f.status, sha256: f.sha256 })),
    fileKey: b.figma.fileKey, pageId: b.figma.pageId, sectionName: b.figma.sectionName,
    frames: { desktop: `Email_${b.name}_Desktop`, mobile: `Email_${b.name}_Mobile`, subject: `Email_${b.name}_Asunto`, notes: `Email_${b.name}_Notas`, components: `Email_${b.name}_Componentes` },
    widths: { desktop: wD.value, mobile: wM.value }, canvasFill: canvas,
    desktop: trees.desktop, mobile: trees.mobile, subject,
    fonts: [...fonts.values()], notesFont: NOTES_FONT, svgs: usedSvgs, notes, provenance, internalRules, conflicts, warnings, blockers,
  };

  function emptyPlan(): EmailPlan {
    return {
      schema: EMAIL_PLAN_SCHEMA_ID, briefSlug: b.slug, briefHash: emailBriefHash(b), client: { slug: ctx.client.slug, name: ctx.client.name, status: ctx.client.status },
      knowledge: [], fileKey: b.figma.fileKey, pageId: b.figma.pageId, sectionName: b.figma.sectionName,
      frames: { desktop: '', mobile: '', subject: '', notes: '', components: '' }, widths: { desktop: wD.value, mobile: wM.value }, canvasFill: PLACEHOLDER_FILL,
      desktop: [], mobile: [], subject: { subject: null, preheader: null }, fonts: [], notesFont: NOTES_FONT, svgs: {}, notes, provenance, internalRules, conflicts, warnings, blockers,
    };
  }
}

export { PLACEHOLDER_FILL };
