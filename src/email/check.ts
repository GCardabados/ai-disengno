// Control de calidad del email: (1) sobre el plan, antes de escribir en Figma; (2) sobre la auditoría de los nodos
// realmente creados que devuelve el script (relectura en la misma llamada). Criterios de diseño de WCAG 2.2 AA que se
// pueden comprobar en Figma (contraste, tamaños, área táctil, texto vivo, enlaces distinguibles) y viabilidad HTML
// (anchos exactos, columnas que suman). No certifica la accesibilidad del HTML final.
import type { EmailPlan, EmailResult, PColor, PNode, PText } from '../contracts/email.ts';
import { contrast } from '../brand/color.ts';
import { quote } from '../variants/discover.ts';
import { MIN_SIZES } from './tokens.ts';

export interface Finding { code: string; severity: 'blocking' | 'warning'; message: string }

const isLarge = (size: number, bold: boolean) => size >= 24 || (bold && size >= 18.66);
const bold = (style: string) => /bold|black|heavy|semi/i.test(style);
/** Hash corto y determinista (djb2 sobre unidades UTF-16): el mismo algoritmo corre dentro del script. */
export function djb2(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); }

function textFindings(t: PText, bg: PColor, where: string, out: Finding[]): void {
  const k = contrast(t.color.hex, bg.hex), need = isLarge(t.size, bold(t.font.style)) ? 3 : 4.5;
  if (k < need) out.push({ code: 'CONTRAST', severity: 'blocking', message: `${where}: ${t.name} ${t.color.hex} sobre ${bg.hex} = ${k.toFixed(2)} (< ${need}, WCAG 1.4.3)` });
  if (t.size < MIN_SIZES.legal) out.push({ code: 'TEXT_TOO_SMALL', severity: 'blocking', message: `${where}: ${t.name} a ${t.size}px (< ${MIN_SIZES.legal})` });
  else if ((t.role === 'body' || t.role === 'cta') && t.size < MIN_SIZES.body) out.push({ code: 'BODY_SMALL', severity: 'warning', message: `${where}: ${t.name} a ${t.size}px (< ${MIN_SIZES.body} recomendado para cuerpo)` });
  if (t.url !== null && t.role !== 'cta' && !t.underline) out.push({ code: 'LINK_NOT_UNDERLINED', severity: 'warning', message: `${where}: el enlace ${t.name} solo se distingue por el color (WCAG 1.4.1)` });
}

export function checkPlanTree(nodes: PNode[], width: number, canvas: PColor): Finding[] {
  const out: Finding[] = [];
  const walk = (n: PNode, bg: PColor, inner: number, path: string): void => {
    const where = `${path}/${n.name}`;
    if (n.k === 'text') return textFindings(n, bg, path, out);
    if (n.k === 'image' || n.k === 'logo') { if (n.w > inner + 0.5) out.push({ code: 'TOO_WIDE', severity: 'blocking', message: `${where}: ${n.w}px en un hueco de ${inner}px` }); return; }
    if (n.k === 'button') {
      if (n.h < MIN_SIZES.cta) out.push({ code: 'CTA_TOO_SMALL', severity: 'blocking', message: `${where}: ${n.h}px de alto (< 44, área táctil)` });
      if (n.w !== null && n.w > inner + 0.5) out.push({ code: 'TOO_WIDE', severity: 'blocking', message: `${where}: ${n.w}px en un hueco de ${inner}px` });
      textFindings(n.text, n.fill, where, out);
      if (!n.border && contrast(n.fill.hex, bg.hex) < 3) out.push({ code: 'CTA_BOUNDARY', severity: 'warning', message: `${where}: el botón ${n.fill.hex} sobre ${bg.hex} tiene contraste ${contrast(n.fill.hex, bg.hex).toFixed(2)} (< 3, WCAG 1.4.11); el texto lo identifica, valorar borde` });
      return;
    }
    if (n.w > inner + 0.5) out.push({ code: 'TOO_WIDE', severity: 'blocking', message: `${where}: ${n.w}px en un hueco de ${inner}px` });
    const own = n.w - n.pad[1] - n.pad[3];
    if (n.dir === 'H') {
      const sum = n.children.reduce((s, c) => s + (c.k === 'text' || (c.k === 'button' && c.w === null) ? 0 : c.w ?? 0), 0) + n.gap * Math.max(0, n.children.length - 1);
      if (sum !== own) out.push({ code: 'COLUMNS_SUM', severity: 'blocking', message: `${where}: columnas ${sum}px ≠ ancho útil ${own}px (la maquetación exige suma exacta)` });
    }
    for (const c of n.children) walk(c, n.fill ?? bg, n.dir === 'H' && c.k !== 'text' ? (c.w ?? own) : own, where);
  };
  for (const n of nodes) {
    if (n.k === 'frame' && n.w !== width) out.push({ code: 'BAND_WIDTH', severity: 'blocking', message: `${n.name}: ${n.w}px ≠ ancho del email ${width}px` });
    walk(n, canvas, width, '');
  }
  return out;
}

/** Textos esperados por versión (nombre → texto) a partir del plan. */
function expectedTexts(nodes: PNode[]): Array<{ name: string; t: PText }> {
  const out: Array<{ name: string; t: PText }> = [];
  const walk = (n: PNode): void => { if (n.k === 'text') out.push({ name: n.name, t: n }); else if (n.k === 'button') out.push({ name: n.text.name, t: n.text }); else if (n.k === 'frame') n.children.forEach(walk); };
  nodes.forEach(walk);
  return out;
}

export interface EmailCheckStats { textos: number; propuestos: number; pendientes: number; imagenesColocadas: number; imagenesPendientes: number; componentes: number; instancias: number; anotaciones: number }
export interface EmailCheckReport { status: 'pass' | 'pass_with_warnings' | 'fail'; findings: Finding[]; stats: EmailCheckStats }

export function checkEmailResult(plan: EmailPlan, r: EmailResult): EmailCheckReport {
  const out: Finding[] = [];
  if (r.status !== 'created') out.push({ code: `RESULT_${r.status.toUpperCase()}`, severity: 'blocking', message: r.error ?? `El script devolvió ${r.status}` });
  for (const f of r.fonts) if (!f.loaded) out.push({ code: 'FONT_NOT_LOADED', severity: 'blocking', message: `${f.family} ${f.style}: ${f.error}` });
  const stats: EmailCheckStats = { textos: 0, propuestos: 0, pendientes: 0, imagenesColocadas: 0, imagenesPendientes: 0, componentes: r.components.length, instancias: r.components.reduce((s, c) => s + c.instances, 0), anotaciones: r.annotations.ok };
  for (const bp of ['desktop', 'mobile'] as const) {
    const frameName = plan.frames[bp];
    const root = r.audit.find((a) => a.bp === bp && a.name === frameName);
    if (!root) { out.push({ code: 'FRAME_MISSING', severity: 'blocking', message: `No está el frame ${frameName}` }); continue; }
    if (Math.abs(root.w - plan.widths[bp]) > 0.5) out.push({ code: 'FRAME_WIDTH', severity: 'blocking', message: `${frameName}: ${root.w}px ≠ ${plan.widths[bp]}px` });
    const audit = r.audit.filter((a) => a.bp === bp && a.type === 'TEXT');
    for (const { name, t } of expectedTexts(plan[bp])) {
      const hits = audit.filter((a) => a.name === name && a.sha === djb2(t.text));
      if (!hits.length) { out.push({ code: 'TEXT_MISSING_OR_ALTERED', severity: 'blocking', message: `${bp}: ${name} no está o su texto no coincide con ${quote(t.text, 50)}` }); continue; }
      stats.textos++;
      if (bp === 'desktop' && t.status === 'proposed') stats.propuestos++;
      if (bp === 'desktop' && t.status === 'placeholder') stats.pendientes++;
      const a = hits[0]!;
      if (a.size !== t.size) out.push({ code: 'TEXT_SIZE', severity: 'blocking', message: `${bp}: ${name} a ${a.size}px (plan ${t.size})` });
      if (a.font !== `${t.font.family} ${t.font.style}`) out.push({ code: 'TEXT_FONT', severity: 'blocking', message: `${bp}: ${name} en ${a.font} (plan ${t.font.family} ${t.font.style})` });
      if (a.color && a.bg) {
        const k = contrast(a.color, a.bg), need = isLarge(t.size, bold(t.font.style)) ? 3 : 4.5;
        if (k < need) out.push({ code: 'CONTRAST_REAL', severity: 'blocking', message: `${bp}: ${name} ${a.color} sobre ${a.bg} = ${k.toFixed(2)} (< ${need})` });
      }
      if (t.url !== null && t.role !== 'cta' && !a.underline) out.push({ code: 'LINK_NOT_UNDERLINED', severity: 'warning', message: `${bp}: ${name} es un enlace sin subrayar` });
    }
    const btns = r.audit.filter((a) => a.bp === bp && /^CTA/.test(a.name) && a.type !== 'TEXT');
    for (const b of btns) if (b.h < MIN_SIZES.cta - 0.5) out.push({ code: 'CTA_TOO_SMALL', severity: 'blocking', message: `${bp}: ${b.name} mide ${b.h}px de alto` });
  }
  // Paridad de contenido desktop ↔ mobile (mismo copy en ambas versiones).
  const shas = (bp: string) => new Set(r.audit.filter((a) => a.bp === bp && a.type === 'TEXT' && !/^PLACEHOLDER_/.test(a.name)).map((a) => a.sha));
  const d = shas('desktop'), m = shas('mobile');
  const onlyD = [...d].filter((x) => !m.has(x)).length, onlyM = [...m].filter((x) => !d.has(x)).length;
  if (onlyD || onlyM) out.push({ code: 'CONTENT_PARITY', severity: 'warning', message: `Textos solo en desktop: ${onlyD}; solo en mobile: ${onlyM} (el contenido debería ser el mismo)` });
  for (const im of r.images) { if (im.placed) stats.imagenesColocadas++; else stats.imagenesPendientes++; }
  if (r.annotations.failed) out.push({ code: 'ANNOTATIONS_FAILED', severity: 'warning', message: `${r.annotations.failed} anotaciones no se pudieron crear (${r.annotations.error ?? '—'}); las notas siguen en el frame de notas` });
  if (!r.components.length) out.push({ code: 'NO_COMPONENTS', severity: 'warning', message: 'No se crearon componentes para los módulos reutilizables' });
  const status = out.some((f) => f.severity === 'blocking') ? 'fail' : out.length ? 'pass_with_warnings' : 'pass';
  return { status, findings: out, stats };
}

const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`) : ['- —']);

export function renderEmailReport(plan: EmailPlan, rep: EmailCheckReport | null, meta: { link?: string; screenshots?: string[] } = {}): string {
  const out = [`# ${plan.frames.desktop.replace(/_Desktop$/, '')} — ${plan.client.name}`, ''];
  out.push(`Estado: **${rep ? rep.status : 'plan (sin construir)'}** · DEMO pendiente de revisión humana. Conocimiento: ${plan.knowledge.map((k) => `${k.id} v${k.version} (${k.status})`).join(', ')}.`);
  if (meta.link) out.push('', `Figma: ${meta.link}`);
  for (const s of meta.screenshots ?? []) out.push(`Captura: ${s}`);
  if (rep) {
    out.push('', '## Validación', '', `Textos comprobados: ${rep.stats.textos} · propuestos: ${rep.stats.propuestos} · pendientes: ${rep.stats.pendientes} · imágenes colocadas/pendientes: ${rep.stats.imagenesColocadas}/${rep.stats.imagenesPendientes} · componentes: ${rep.stats.componentes} (${rep.stats.instancias} instancias) · anotaciones: ${rep.stats.anotaciones}`, '');
    out.push(...(rep.findings.length ? rep.findings.map((f) => `- ${f.severity === 'blocking' ? '⛔' : 'ℹ'} ${f.code}: ${f.message}`) : ['- ✓ Sin incidencias en las comprobaciones automáticas']));
  }
  out.push('', '## Copys propuestos (pendientes de aprobación)', '', ...list(plan.notes.proposedCopy));
  out.push('', '## Pendientes', '', ...list(plan.notes.pending));
  out.push('', '## Decisiones del encargo', '', ...list(plan.notes.decisions));
  out.push('', '## Supuestos', '', ...list(plan.notes.assumptions));
  out.push('', '## Conflictos detectados en el conocimiento', '', ...list(plan.conflicts));
  out.push('', '## Reglas internas aplicadas (no son normas de marca)', '', ...list(plan.internalRules));
  out.push('', '## Procedencia de los tokens', '', '| Tema | Valor | Origen | Fuente |', '|---|---|---|---|', ...plan.provenance.map((p) => `| ${p.topic} | ${p.value} | ${p.from} | ${p.source} |`));
  out.push('', '## Responsive (desktop → mobile)', '', ...list(plan.notes.responsive));
  out.push('', '## Accesibilidad', '', ...list(plan.notes.accessibility));
  out.push('', '## Dark mode', '', ...list(plan.notes.darkMode));
  out.push('', '## Para desarrollo', '', ...list(plan.notes.development));
  out.push('', '## Avisos', '', ...list(plan.warnings));
  out.push('', '> Comprobado automáticamente: lo listado en «Validación». Propuesto, no automático: lectura a 320 px, dark mode real por cliente de correo, revisión visual de jerarquía y la validación del HTML (Email on Acid) cuando se maquete.', '');
  return out.join('\n');
}
