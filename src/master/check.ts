// Validación de una maestra nueva sobre la RELECTURA de su frame (master-check), no sobre lo que dice el script.
// Comprueba el plan (copy exacto, fuentes, colores, geometría) y las reglas de la marca que se pueden medir (logo:
// proporción, mínimo, área de reserva, contraste; contraste de texto WCAG). La revisión visual solo puede empeorar el
// estado y no es aprobación humana.
import type { MasterSnapshot, NodeSnapshot, Paint } from '../contracts/snapshot.ts';
import type { Rect } from '../contracts/geometry.ts';
import type { MasterPlan, PlanText } from '../contracts/master.ts';
import { aggregate, type Aggregate, type CheckStatus, type Finding, type ValidationResult } from '../contracts/validation.ts';
import { contrast, rgbToHex } from '../brand/color.ts';

export const MASTER_CHECK_VERSION = '1';

export interface MasterCheckInput {
  plan: MasterPlan;
  snapshot: MasterSnapshot;
  /** Proporción ancho/alto del SVG del logo (del kit). */
  logoAspect: number | null;
  minLogoContrast: number | null;
  visual: { status: CheckStatus; findings: Finding[] } | null;
}
export interface MasterCheckReport { frameId: string; results: ValidationResult[]; aggregate: Aggregate }

const solidHex = (p: Paint | undefined): string | null => {
  const c = (p?.raw as { color?: { r: number; g: number; b: number } } | undefined)?.color;
  return p && p.type === 'SOLID' && c ? rgbToHex([c.r * 255, c.g * 255, c.b * 255]) : null;
};
const fillsOf = (n: NodeSnapshot): Paint[] => (Array.isArray(n.fills) ? n.fills.filter((p) => p.visible) : []);
const hit = (a: Rect, b: Rect) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
const within = (r: Rect, s: Rect, tol = 0.5) => r.x >= s.x - tol && r.y >= s.y - tol && r.x + r.width <= s.x + s.width + tol && r.y + r.height <= s.y + s.height + tol;
/** WCAG: texto grande = ≥ 24 px, o ≥ 18,66 px en negrita. */
const isLarge = (t: PlanText) => t.sizePx >= 24 || (t.sizePx >= 18.66 && /bold|black|heavy|semibold|extrabold/i.test(t.font.style));

export function checkMaster(inp: MasterCheckInput): MasterCheckReport {
  const { plan, snapshot: s } = inp;
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const root = byId.get(s.rootNodeId)!;
  const results: ValidationResult[] = [];
  const r = (id: string, status: CheckStatus, coverage: string, findings: Finding[] = [], kind: 'deterministic' | 'visual' = 'deterministic'): ValidationResult =>
    ({ validatorId: id, validatorVersion: MASTER_CHECK_VERSION, destinationId: `master:${plan.briefSlug}`, kind, status, findings, coverage });
  const statusOf = (f: Finding[]): CheckStatus => (f.some((x) => x.severity === 'blocking') ? 'fail' : f.length ? 'needs_review' : 'pass');
  const rel = (n: NodeSnapshot, render = false): Rect | null => {
    const b = render ? n.absoluteRenderBounds ?? n.absoluteBoundingBox : n.absoluteBoundingBox, o = root.absoluteBoundingBox;
    return b && o ? { x: b.x - o.x, y: b.y - o.y, width: b.width, height: b.height } : null;
  };
  const named = (name: string) => s.nodes.filter((n) => n.name === name && n.id !== root.id);
  const one = (name: string) => named(name)[0];
  const frameRect: Rect = { x: 0, y: 0, width: plan.width, height: plan.height };

  // 1. Frame.
  {
    const f: Finding[] = [];
    if (root.width !== plan.width || root.height !== plan.height) f.push({ code: 'SIZE', severity: 'blocking', nodeIds: [root.id], measured: [root.width, root.height], expected: [plan.width, plan.height], message: 'El frame no mide lo planificado' });
    if (root.name !== plan.frameName) f.push({ code: 'NAME', severity: 'blocking', nodeIds: [root.id], measured: root.name, expected: plan.frameName, message: 'El frame no se llama como el plan' });
    if (solidHex(fillsOf(root)[0]) !== plan.background.hex) f.push({ code: 'BACKGROUND', severity: 'blocking', nodeIds: [root.id], measured: solidHex(fillsOf(root)[0]), expected: plan.background.hex, message: 'El fondo no es el color planificado' });
    if (root.clipsContent !== true) f.push({ code: 'CLIP', severity: 'blocking', nodeIds: [root.id], message: 'El frame no recorta su contenido' });
    results.push(r('master_frame', statusOf(f), 'Tamaño, nombre, fondo y recorte del frame.', f));
  }

  // 2. Textos: copy exacto, tipografía, cuerpo, mayúsculas por estilo y color de la paleta.
  const texts = [...plan.stack.texts, ...(plan.cta ? [plan.cta.text] : [])];
  {
    const f: Finding[] = [];
    for (const t of texts) {
      const n = one(t.name);
      if (!n?.text) { f.push({ code: 'TEXT_MISSING', severity: 'blocking', nodeIds: [], expected: t.name, message: `Falta el texto «${t.name}»` }); continue; }
      if (n.text.characters !== t.text) f.push({ code: 'TEXT_NOT_CONFIRMED_COPY', severity: 'blocking', nodeIds: [n.id], measured: n.text.characters, expected: t.text, message: `«${t.name}» no es el copy confirmado` });
      for (const g of n.text.segments) {
        if (g.fontName?.family !== t.font.family || g.fontName?.style !== t.font.style) f.push({ code: 'FONT', severity: 'blocking', nodeIds: [n.id], measured: g.fontName, expected: t.font, message: `«${t.name}»: tipografía distinta de la planificada` });
        if (typeof g.fontSize === 'number' && Math.abs(g.fontSize - t.sizePx) > 0.01) f.push({ code: 'FONT_SIZE', severity: 'blocking', nodeIds: [n.id], measured: g.fontSize, expected: t.sizePx, message: `«${t.name}»: cuerpo distinto del planificado` });
        if (t.upper && g.textCase !== 'UPPER') f.push({ code: 'TEXT_CASE', severity: 'blocking', nodeIds: [n.id], measured: g.textCase, message: `«${t.name}»: la marca pide mayúsculas` });
        const hx = Array.isArray(g.fills) ? solidHex(g.fills.find((p) => p.visible)) : null;
        if (hx !== t.color.hex) f.push({ code: 'TEXT_COLOR', severity: 'blocking', nodeIds: [n.id], measured: hx, expected: t.color.hex, message: `«${t.name}»: color distinto del planificado` });
      }
    }
    results.push(r('master_copy_and_type', statusOf(f), 'Cada texto con el copy confirmado (carácter a carácter), la tipografía y el cuerpo del plan, mayúsculas por estilo si la marca las pide y el color de la paleta.', f));
  }

  // 3. Logo: presente, sin deformar ni girar, ≥ mínimo, dentro del frame, área de reserva libre y contraste.
  {
    const f: Finding[] = [];
    const lg = one(plan.logo.name);
    const lr = lg ? rel(lg) : null;
    if (!lg || !lr) f.push({ code: 'LOGO_MISSING', severity: 'blocking', nodeIds: [], message: 'Falta el logo' });
    else {
      if (inp.logoAspect && Math.abs(lr.width / lr.height / inp.logoAspect - 1) > 0.01) f.push({ code: 'LOGO_DEFORMED', severity: 'blocking', nodeIds: [lg.id], measured: lr.width / lr.height, expected: inp.logoAspect, message: 'El logo no conserva su proporción' });
      if ((lg.rotation ?? 0) !== 0) f.push({ code: 'LOGO_ROTATED', severity: 'blocking', nodeIds: [lg.id], message: 'El logo está girado' });
      if (plan.logo.minWidthPx && lr.width < plan.logo.minWidthPx - 0.5) f.push({ code: 'LOGO_BELOW_MIN', severity: 'blocking', nodeIds: [lg.id], measured: lr.width, expected: plan.logo.minWidthPx, message: 'El logo es más pequeño que el mínimo de la marca' });
      if (!within(lr, frameRect)) f.push({ code: 'LOGO_OUTSIDE', severity: 'blocking', nodeIds: [lg.id], message: 'El logo sale del frame' });
      if (plan.safeArea && !within(lr, plan.safeArea)) f.push({ code: 'LOGO_OUTSIDE_SAFE_AREA', severity: 'blocking', nodeIds: [lg.id], message: 'El logo sale de la zona segura' });
      const cs = plan.logo.clearSpacePx;
      const reserve: Rect = { x: lr.x - cs, y: lr.y - cs, width: lr.width + 2 * cs, height: lr.height + 2 * cs };
      const logoIds = new Set<string>([lg.id]);
      for (const n of s.nodes) for (let p = n.parentId; p; p = byId.get(p)?.parentId ?? null) if (p === lg.id) logoIds.add(n.id);
      const backgrounds = new Set(['Panel', ...(plan.logo.overPhoto && plan.image ? [plan.image.name] : [])]);
      for (const n of s.nodes) {
        if (n.id === root.id || logoIds.has(n.id) || backgrounds.has(n.name) || !n.visible) continue;
        if (n.name === plan.stack.name) continue; // se comprueba por sus hijos (el contenedor no se pinta)
        const nr = rel(n, true);
        if (nr && hit(nr, reserve)) f.push({ code: 'LOGO_CLEAR_SPACE', severity: 'blocking', nodeIds: [lg.id, n.id], message: `«${n.name}» invade el área de reserva del logo (${Math.round(cs)}px)` });
      }
      if (!plan.logo.overPhoto) {
        const minC = inp.minLogoContrast ?? 4.5;
        for (const ink of plan.logo.inks) {
          const k = contrast(ink.hex, plan.background.hex);
          if (k + 0.005 < minC) f.push({ code: 'LOGO_CONTRAST', severity: 'blocking', nodeIds: [lg.id], measured: k, expected: minC, message: `Tinta ${ink.id} del logo sobre el fondo: contraste ${k.toFixed(2)} (< ${minC})` });
        }
      } else f.push({ code: 'LOGO_OVER_PHOTO', severity: 'warning', nodeIds: [lg.id], message: 'Logo sobre foto: su legibilidad la juzga la revisión de la captura' });
    }
    results.push(r('master_logo', statusOf(f), 'Logo presente, proporción del SVG (±1 %), sin giro, ≥ ancho mínimo de la marca, dentro del frame/zona segura, área de reserva sin otros elementos (cajas de render) y contraste de sus tintas con el fondo.', f));
  }

  // 4. Contraste del texto con su fondo (WCAG AA), si el fondo es de color.
  {
    const f: Finding[] = [];
    if (!plan.textBackdrop) results.push(r('master_text_contrast', 'not_evaluable', 'Texto sobre foto: el contraste lo juzga la revisión visual.', [{ code: 'TEXT_OVER_PHOTO', severity: 'warning', nodeIds: [], message: 'Texto sobre foto' }]));
    else {
      for (const t of plan.stack.texts) {
        const k = contrast(t.color.hex, plan.textBackdrop.hex), need = isLarge(t) ? 3 : 4.5;
        if (k + 0.005 < need) f.push({ code: 'TEXT_CONTRAST', severity: 'blocking', nodeIds: [one(t.name)?.id ?? ''], measured: k, expected: need, message: `«${t.name}»: contraste ${k.toFixed(2)} (< ${need})` });
      }
      if (plan.cta) {
        const k = contrast(plan.cta.text.color.hex, plan.cta.fill.hex), need = isLarge(plan.cta.text) ? 3 : 4.5;
        if (k + 0.005 < need) f.push({ code: 'CTA_CONTRAST', severity: 'blocking', nodeIds: [one(plan.cta.name)?.id ?? ''], measured: k, expected: need, message: `CTA: contraste ${k.toFixed(2)} (< ${need})` });
      }
      results.push(r('master_text_contrast', statusOf(f), 'Contraste WCAG 2.x de cada texto con el color que tiene detrás (≥ 4,5; ≥ 3 en texto grande) y del texto del CTA con su botón.', f));
    }
  }

  // 5. Composición: textos dentro de su zona, del frame y de la zona segura; sin solapes entre textos; imagen.
  {
    const f: Finding[] = [];
    const st = one(plan.stack.name), sr = st ? rel(st) : null;
    if (!sr) f.push({ code: 'STACK_MISSING', severity: 'blocking', nodeIds: [], message: 'Falta el bloque de textos' });
    else if (!within(sr, plan.stack.zone, 1)) f.push({ code: 'TEXT_OUTSIDE_ZONE', severity: 'blocking', nodeIds: [st!.id], measured: sr, expected: plan.stack.zone, message: 'Los textos salen de su zona' });
    const boxes: Array<[string, Rect]> = [];
    for (const t of texts) {
      const n = one(t.name), b = n ? rel(n, true) : null;
      if (!n || !b) continue;
      if (!n.absoluteRenderBounds) f.push({ code: 'TEXT_NOT_RENDERED', severity: 'blocking', nodeIds: [n.id], message: `«${t.name}» sin render` });
      if (!within(b, frameRect)) f.push({ code: 'TEXT_OUTSIDE_FRAME', severity: 'blocking', nodeIds: [n.id], message: `«${t.name}» sale del frame` });
      if (plan.safeArea && !within(b, plan.safeArea)) f.push({ code: 'TEXT_OUTSIDE_SAFE_AREA', severity: 'blocking', nodeIds: [n.id], message: `«${t.name}» sale de la zona segura` });
      for (const [name, o] of boxes) if (hit(b, o) && !(t.role === 'cta')) f.push({ code: 'TEXT_OVERLAP', severity: 'blocking', nodeIds: [n.id], message: `«${t.name}» se solapa con «${name}»` });
      boxes.push([t.name, b]);
    }
    if (plan.image) {
      const im = one(plan.image.name);
      const p = im ? fillsOf(im).find((x) => x.type === 'IMAGE') : undefined;
      if (!im || p?.imageHash !== plan.image.imageHash) f.push({ code: 'IMAGE_NOT_CONFIRMED', severity: 'blocking', nodeIds: im ? [im.id] : [], message: 'La imagen no es la confirmada' });
      if (plan.image.aiGenerated) f.push({ code: 'AI_GENERATED_IMAGE', severity: 'warning', nodeIds: im ? [im.id] : [], message: 'Imagen generada con IA: revisar fidelidad a la marca y derechos antes de usarla' });
    }
    results.push(r('master_layout', statusOf(f), 'Bloque de textos dentro de su zona (±1 px), cada texto con render dentro del frame y de la zona segura, sin solapes entre textos, imagen confirmada.', f));
  }

  // 6. Estado del kit y decisiones del encargo (informativo).
  {
    const f: Finding[] = [];
    if (plan.brand.status !== 'validated') f.push({ code: 'BRAND_DRAFT', severity: 'warning', nodeIds: [], message: 'Kit de marca en borrador' });
    for (const w of plan.internalRules) f.push({ code: 'INTERNAL_RULE', severity: 'warning', nodeIds: [], message: w });
    results.push(r('master_brand_basis', statusOf(f), 'Base de marca de la pieza: estado del kit y reglas internas aplicadas donde la marca no especifica (no son normas de marca).', f));
  }

  results.push(inp.visual
    ? r('visual_agent_review', inp.visual.status, 'Revisión visual del agente sobre la captura: jerarquía, legibilidad sobre foto, encuadre, rostros, coherencia con el manual. No sustituye la revisión humana.', inp.visual.findings, 'visual')
    : r('visual_agent_review', 'not_evaluable', 'Sin captura revisada.', [], 'visual'));
  return { frameId: root.id, results, aggregate: aggregate(results) };
}

export function renderMasterReport(plan: MasterPlan, rep: MasterCheckReport, link: string | null, screenshot: string | null): string {
  const ST: Record<string, string> = { pass: 'superada', needs_review: 'a revisar', not_evaluable: 'no evaluable', fail: 'FALLA' };
  const out = [`# Pieza maestra ${plan.frameName}`, '', `Marca: ${plan.brand.name} (kit ${plan.brand.status === 'validated' ? 'validado' : 'en borrador'}). Composición: ${plan.archetype}. Estado: **DEMO pendiente de revisión humana**.`, ''];
  if (link) out.push(`Pieza: ${link}`, '');
  if (screenshot) out.push(`![${plan.frameName}](${screenshot})`, '');
  out.push(`Validación sobre la relectura: **${ST[rep.aggregate.status]}**`, '');
  for (const r of rep.results) out.push(`- ${r.validatorId}: ${ST[r.status]}${r.findings.filter((x) => x.code !== 'INTERNAL_RULE').length ? ` — ${r.findings.filter((x) => x.code !== 'INTERNAL_RULE').map((x) => `${x.code}: ${x.message}`).join('; ')}` : ''}`);
  out.push('', '## Decisiones del encargo', '', ...(plan.decisions.length ? plan.decisions.map((d) => `- ${d}`) : ['- —']));
  out.push('', '## Reglas internas (la marca no las especifica)', '', ...plan.internalRules.map((d) => `- ${d}`));
  if (plan.warnings.length) out.push('', '## Avisos del plan', '', ...plan.warnings.map((d) => `- ${d}`));
  out.push('', '## Siguiente paso', '', '- Revisión humana del diseño. Si se acepta, `adapt-master-creative` la lleva al resto de tamaños.', '');
  return out.join('\n');
}
