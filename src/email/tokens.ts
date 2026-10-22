// Resolución de tokens de un email con PRECEDENCIA y PROCEDENCIA explícitas. Orden (de más a menos fuerte):
//   1. legal_technical  — restricciones legales y técnicas del canal (p. ej. política de fuentes web-safe): el brief
//                         no las puede saltar; si las contradice, se para y se pregunta.
//   2. brief_decision   — lo decidido en el encargo, solo DENTRO de la marca (colores de la paleta, fuentes de la política).
//   3. email_confirmed  — reglas del canal email del cliente escritas o validadas.
//   4. brand            — brand.json (manual de marca), confirmado.
//   5. email_observed   — valores vistos en emails/plantillas aprobados del cliente: referencia, no norma.
//   6. skill_default    — valores por defecto de la skill (references/criterios-diseno-email.md), declarados.
// Los ejemplos históricos nunca son fuente de tokens. Ningún valor se toma de otro cliente.
import type { KnowledgeContext } from '../knowledge/store.ts';
import type { EmailBrief, ProvenanceT } from '../contracts/email.ts';
import type { EmailTextRole, FactStatusT } from '../contracts/knowledge.ts';
import { contrast } from '../brand/color.ts';

export interface ColorRes { id: string; hex: string; status: FactStatusT; source: string; from: 'email' | 'brand' }

/** Paleta utilizable en email: colores del canal + colores confirmados de la marca (sin duplicar ids). */
export function palette(ctx: KnowledgeContext): ColorRes[] {
  const out: ColorRes[] = [];
  for (const c of ctx.email?.colors ?? []) out.push({ id: c.id, hex: c.hex, status: c.status, source: c.source, from: 'email' });
  for (const c of ctx.brand?.colors ?? []) {
    if (!c.hex || out.some((x) => x.id === c.id)) continue;
    out.push({ id: c.id, hex: c.hex, status: c.status === 'confirmed' ? 'confirmed' : 'needs_confirmation', source: c.source, from: 'brand' });
  }
  return out;
}

export const colorById = (ctx: KnowledgeContext, id: string | null | undefined): ColorRes | null => (id ? palette(ctx).find((c) => c.id === id) ?? null : null);
export const usableColor = (c: ColorRes | null): c is ColorRes => !!c && c.status !== 'needs_confirmation';

/** Color de texto de la paleta con mayor contraste sobre un fondo (prefiere los marcados para texto). */
export function bestTextColor(ctx: KnowledgeContext, bgHex: string): ColorRes | null {
  const all = palette(ctx).filter(usableColor);
  const roleText = new Set((ctx.email?.colors ?? []).filter((c) => c.roles.some((r) => /texto|text/i.test(r))).map((c) => c.id));
  const pool = all.filter((c) => roleText.has(c.id));
  const cands = (pool.length ? pool : all).filter((c) => c.hex !== bgHex);
  return cands.sort((a, b) => contrast(b.hex, bgHex) - contrast(a.hex, bgHex))[0] ?? null;
}

// ---------- Valores por defecto de la skill (justificados en references/criterios-diseno-email.md) ----------

export const DEFAULT_LAYOUT = { desktopWidth: 600, mobileWidth: 375, padDesktop: 32, padMobile: 20, bandDesktop: 40, bandMobile: 32, gapDesktop: 16, gapMobile: 12, ctaGap: 24, centerMeasure: 480, minTextColumn: 180 };
export const DEFAULT_TYPE: Record<EmailTextRole, { d: [number, number]; m: [number, number] }> = {
  h1: { d: [32, 40], m: [26, 32] },
  h2: { d: [24, 32], m: [22, 28] },
  body: { d: [16, 24], m: [16, 24] },
  small: { d: [14, 20], m: [14, 20] },
  cta: { d: [16, 20], m: [16, 20] },
  legal: { d: [12, 18], m: [12, 18] },
};
export const DEFAULT_CTA = { heightDesktop: 48, heightMobile: 48, padX: 32, fullWidthMobile: true };
export const MIN_SIZES = { body: 14, legal: 12, cta: 44 };
/** Propuesta (no aplicada sin decisión) cuando el cliente no define tipografía de email. */
export const WEB_SAFE_PROPOSAL = { stack: 'Arial, Helvetica, sans-serif', figma: { family: 'Arimo', regular: 'Regular', bold: 'Bold' } };

export interface TypeRes { stack: string; figma: { family: string; style: string }; d: [number, number]; m: [number, number]; upper: boolean; from: ProvenanceT['from']; source: string; derived: string | null }

const RELATED: Record<EmailTextRole, EmailTextRole[]> = { h1: ['h2'], h2: ['h1'], body: ['small', 'legal'], small: ['body'], cta: ['body'], legal: ['small', 'body'] };
const BOLD: Record<EmailTextRole, boolean> = { h1: true, h2: true, body: false, small: false, cta: true, legal: false };

/** Tipografía resuelta de un rol (o null si nadie la define: decisión pendiente). */
export function typeFor(ctx: KnowledgeContext, b: EmailBrief, role: EmailTextRole): TypeRes | null {
  const sizes = (desk: { sizePx: number; lineHeightPx: number | null } | null | undefined, mob: { sizePx: number; lineHeightPx: number | null } | null | undefined): { d: [number, number]; m: [number, number]; derived: string | null } => {
    const def = DEFAULT_TYPE[role];
    const lh = (s: number, l: number | null, ratio: number) => l ?? Math.round(s * ratio / 2) * 2;
    const ratio = def.d[1] / def.d[0];
    const d: [number, number] = desk ? [desk.sizePx, lh(desk.sizePx, desk.lineHeightPx, ratio)] : def.d;
    let m: [number, number], derived: string | null = null;
    if (mob) m = [mob.sizePx, lh(mob.sizePx, mob.lineHeightPx, ratio)];
    else if (desk && (role === 'h1' || role === 'h2')) {
      const s = Math.max(DEFAULT_TYPE.body.m[0] + 4, Math.round(desk.sizePx * 0.8 / 2) * 2);
      m = [s, lh(s, null, ratio)];
      derived = `${role} mobile ${s}px (80 % del desktop, mínimo cuerpo + 4 px; regla interna: el cliente no define el tamaño mobile)`;
    } else m = desk ? d : def.m;
    return { d, m, derived };
  };
  const dec = b.decisions.fonts[role];
  const er = ctx.email?.typography.roles[role];
  if (dec) {
    const s = sizes(er?.desktop, er?.mobile);
    return { stack: dec.stack, figma: dec.figma, d: s.d, m: s.m, upper: er?.upper ?? false, from: 'brief_decision', source: `encargo (${dec.by})`, derived: s.derived };
  }
  if (er) {
    const s = sizes(er.desktop, er.mobile);
    return { stack: er.stack, figma: er.figma, d: s.d, m: s.m, upper: er.upper, from: er.status === 'confirmed' ? 'email_confirmed' : 'email_observed', source: er.source, derived: s.derived };
  }
  // Rol no definido: misma familia que un rol relacionado del canal (regla interna declarada).
  for (const rel of RELATED[role]) {
    const r = b.decisions.fonts[rel] ?? ctx.email?.typography.roles[rel];
    if (!r) continue;
    const s = sizes(null, null);
    const style = BOLD[role] ? 'Bold' : 'Regular';
    return { stack: r.stack, figma: { family: r.figma.family, style }, d: s.d, m: s.m, upper: false, from: 'skill_default', source: `misma familia que ${rel}`, derived: `${role}: ${r.figma.family} ${style}, misma familia que ${rel} y tamaños por defecto (regla interna)` };
  }
  // Política web font: la marca define la familia.
  if (ctx.email?.typography.policy?.value === 'web_font_with_fallback' && ctx.brand) {
    const map: Record<EmailTextRole, 'headline' | 'body' | 'cta'> = { h1: 'headline', h2: 'headline', body: 'body', small: 'body', cta: 'cta', legal: 'body' };
    const br = ctx.brand.typography.roles[map[role]] ?? ctx.brand.typography.roles.body;
    if (br) {
      const s = sizes(null, null);
      return { stack: `${br.family}, ${ctx.brand.typography.fallback?.family ?? 'Arial'}, sans-serif`, figma: { family: br.family, style: br.style }, d: s.d, m: s.m, upper: br.upper ?? false, from: 'brand', source: br.source, derived: null };
    }
  }
  return null;
}

/** Valor de layout con su procedencia. */
export function layoutValue(ctx: KnowledgeContext, key: 'desktopWidthPx' | 'mobileWidthPx' | 'sidePaddingDesktopPx' | 'sidePaddingMobilePx', def: number): { value: number; from: ProvenanceT['from']; source: string } {
  const f = ctx.email?.layout[key];
  if (f && f.status !== 'needs_confirmation') return { value: f.value, from: f.status === 'confirmed' ? 'email_confirmed' : 'email_observed', source: f.source };
  return { value: def, from: 'skill_default', source: 'criterios-diseno-email.md' };
}
