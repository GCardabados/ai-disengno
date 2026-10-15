// Plan de una maestra nueva (modo scratch): geometría de la composición tipo con los tokens de la marca. Todo valor que
// la marca no especifica se toma de una decisión del encargo o de una REGLA INTERNA declarada (internalRules), nunca
// se presenta como norma de marca. El plan no escribe nada: lo ejecuta el script de master-request.
import type { Brand, BrandLogo, TextRole } from '../contracts/brand.ts';
import { MASTER_PLAN_SCHEMA_ID, type MasterBrief, type MasterPlan, type PlanText } from '../contracts/master.ts';
import type { Rect } from '../contracts/geometry.ts';
import type { VariantAssetsRead } from '../contracts/variants.ts';
import { confirmedColors } from '../brand/check.ts';
import { contrast, svgAspect, svgColors } from '../brand/color.ts';
import { briefHash, checkBrief, fontFor, roleLabelEs } from './brief.ts';

/** Escala tipográfica INTERNA (fracción del lado corto) y mínimos en px: la marca no define una. */
export const INTERNAL_TYPE_SCALE: Record<TextRole, { ratio: number; minPx: number; lineHeightPct: number }> = {
  headline: { ratio: 0.075, minPx: 20, lineHeightPct: 105 },
  claim: { ratio: 0.06, minPx: 18, lineHeightPct: 110 },
  subheadline: { ratio: 0.03, minPx: 12, lineHeightPct: 115 },
  body: { ratio: 0.03, minPx: 12, lineHeightPct: 130 },
  cta: { ratio: 0.032, minPx: 12, lineHeightPct: 100 },
  legal: { ratio: 0.017, minPx: 10, lineHeightPct: 125 },
};
const INTERNAL_MARGIN = 0.06, INTERNAL_LOGO_WIDTH = 0.2, GAP = 0.025;
const ORDER: TextRole[] = ['subheadline', 'headline', 'claim', 'body', 'cta', 'legal'];
const NAMES: Record<TextRole, string> = { headline: 'Titular', subheadline: 'Subtítulo', body: 'Cuerpo', cta: 'CTA/texto', legal: 'Legal', claim: 'Claim' };

export interface MasterPlanInput { brief: MasterBrief; brand: Brand; logoSvgs: Record<string, string>; assets: VariantAssetsRead | null }

const inside = (r: Rect, s: Rect) => r.x >= s.x - 0.5 && r.y >= s.y - 0.5 && r.x + r.width <= s.x + s.width + 0.5 && r.y + r.height <= s.y + s.height + 0.5;

export function buildMasterPlan({ brief: b, brand, logoSvgs, assets }: MasterPlanInput): MasterPlan {
  const blockers: string[] = [], warnings: string[] = [], internalRules: string[] = [], decisions: string[] = [];
  const chk = checkBrief(b, brand);
  for (const i of chk.issues) (i.severity === 'warning' ? warnings : blockers).push(`${i.code}: ${i.message}`);
  if (b.mode !== 'scratch') blockers.push('MODE_TEMPLATE: el modo plantilla se produce con master-template-job y el pipeline variant-*');
  const colors = confirmedColors(brand);
  const C = (id: string) => ({ id, hex: colors.get(id) ?? '#000000' });
  const W = b.format.width, H = b.format.height, S = Math.min(W, H);
  const archetype = b.archetype ?? 'solid';
  const bgC = C(b.palette.background), txC = C(b.palette.text);

  // Margen y logo.
  const marginRatio = b.decisions.marginRatio?.value ?? INTERNAL_MARGIN;
  if (!b.decisions.marginRatio) internalRules.push(`Margen ${Math.round(INTERNAL_MARGIN * 100)} % del lado corto (regla interna; la marca no define márgenes digitales)`);
  else decisions.push(`Margen ${b.decisions.marginRatio.value} del lado corto (${b.decisions.marginRatio.by})`);
  const m = Math.round(S * marginRatio);
  const sa = b.safeArea ?? { x: 0, y: 0, width: W, height: H };
  const left = Math.max(m, sa.x + (b.safeArea ? m / 2 : 0)), top = Math.max(m, sa.y + (b.safeArea ? m / 2 : 0));
  const right = Math.min(W - m, sa.x + sa.width - (b.safeArea ? m / 2 : 0)), bottom = Math.min(H - m, sa.y + sa.height - (b.safeArea ? m / 2 : 0));

  const photoBehindLogo = archetype === 'photo-top' || archetype === 'photo-full';
  const logo = pickLogo(brand, b, logoSvgs, photoBehindLogo ? null : bgC.hex, decisions, warnings, blockers);
  const svg = logo ? logoSvgs[logo.id] ?? '' : '';
  const aspect = svgAspect(svg) ?? 1;
  const widthRatio = b.decisions.logoWidthRatio?.value ?? brand.logoRules.idealWidthRatio?.value ?? INTERNAL_LOGO_WIDTH;
  if (!b.decisions.logoWidthRatio && !brand.logoRules.idealWidthRatio) internalRules.push(`Ancho del logo ${INTERNAL_LOGO_WIDTH * 100} % del ancho de la pieza (regla interna; la marca no lo define)`);
  let logoW = Math.round(W * widthRatio);
  if (logo?.minWidthPx && logoW < logo.minWidthPx) { warnings.push(`LOGO_RAISED_TO_MIN: el ancho ideal (${logoW}px) es menor que el mínimo de la marca; se usa ${logo.minWidthPx}px`); logoW = logo.minWidthPx; }
  if (logoW > right - left) blockers.push(`LOGO_DOES_NOT_FIT: el logo a su mínimo (${logoW}px) no cabe en el ancho útil (${Math.round(right - left)}px)`);
  const logoH = Math.round((logoW / aspect) * 100) / 100;
  const clearRatio = b.decisions.clearSpaceRatio?.value ?? brand.logoRules.clearSpace?.ratioOfLogoHeight ?? 1;
  if (b.decisions.clearSpaceRatio) decisions.push(`Área de reserva ${clearRatio} × altura del logo (${b.decisions.clearSpaceRatio.by})`);
  const clear = Math.round(logoH * clearRatio * 100) / 100;
  const logoRect: Rect = { x: left, y: top, width: logoW, height: logoH };

  // Composición.
  let image: MasterPlan['image'] = null, panel: MasterPlan['panel'] = null, zone: Rect, anchor: 'top' | 'bottom', backdrop: MasterPlan['textBackdrop'] = bgC;
  const belowLogo = top + logoH + clear;
  switch (archetype) {
    case 'photo-top': {
      const ih = Math.round(H * 0.5);
      image = imageOf(b, assets, { x: 0, y: 0, width: W, height: ih }, blockers, warnings);
      panel = { rect: { x: 0, y: ih, width: W, height: H - ih }, color: bgC };
      zone = { x: left, y: ih + m, width: right - left, height: bottom - ih - m };
      anchor = 'top';
      if (belowLogo > ih) warnings.push('LOGO_CROSSES_PHOTO_EDGE: el logo y su área de reserva salen de la foto');
      internalRules.push('Foto en la mitad superior y panel de color con los textos debajo (composición «photo-top»)');
      break;
    }
    case 'photo-full': {
      image = imageOf(b, assets, { x: 0, y: 0, width: W, height: H }, blockers, warnings);
      zone = { x: left, y: Math.max(belowLogo + m, Math.round(H * 0.45)), width: right - left, height: 0 };
      zone.height = bottom - zone.y;
      anchor = 'bottom';
      backdrop = null;
      warnings.push('TEXT_OVER_PHOTO: el texto va sobre la foto; el contraste lo decide la revisión visual de la captura');
      internalRules.push('Foto a sangre con textos abajo a la izquierda (composición «photo-full»)');
      break;
    }
    case 'split': {
      const half = Math.round(W / 2);
      image = imageOf(b, assets, { x: half, y: 0, width: W - half, height: H }, blockers, warnings);
      zone = { x: left, y: belowLogo + m, width: Math.min(right, half - m) - left, height: 0 };
      zone.height = bottom - zone.y;
      anchor = 'bottom';
      if (W / H < 1.2) warnings.push('SPLIT_ON_NARROW_FORMAT: «split» está pensada para formatos horizontales');
      internalRules.push('Texto en la mitad izquierda sobre color y foto en la mitad derecha (composición «split»)');
      break;
    }
    default: {
      zone = { x: left, y: belowLogo + m, width: right - left, height: 0 };
      zone.height = bottom - zone.y;
      anchor = 'bottom';
      internalRules.push('Fondo de color con el logo arriba a la izquierda y los textos abajo (composición «solid»)');
    }
  }
  if (zone.height < S * 0.15) blockers.push(`TEXT_ZONE_TOO_SMALL: la zona de texto mide ${Math.round(zone.height)}px de alto`);
  if (b.safeArea && !inside(logoRect, sa)) blockers.push('LOGO_OUTSIDE_SAFE_AREA: el logo no cabe dentro de la zona segura');

  // Textos (pila vertical con auto layout; la altura real la mide el script).
  const texts: PlanText[] = [];
  let cta: MasterPlan['cta'] = null, ctaIndex: number | null = null;
  const usedScale = new Set<TextRole>();
  for (const role of ORDER) {
    const c = b.copy[role];
    if (!c) continue;
    const f = fontFor(brand, b, role);
    if (!f) continue; // ya es un bloqueo del brief
    if (f.from === 'decision') decisions.push(`${roleLabelEs(role)}: ${f.family} ${f.style} (${b.decisions.fonts[role]!.by})`);
    const sc = INTERNAL_TYPE_SCALE[role];
    usedScale.add(role);
    const t: PlanText = { role, name: NAMES[role], text: c.text, font: { family: f.family, style: f.style }, sizePx: Math.max(sc.minPx, Math.round(S * sc.ratio)), lineHeightPct: sc.lineHeightPct, color: txC, upper: f.upper };
    if (role === 'cta') {
      const d = b.decisions.cta;
      if (!d) continue;
      decisions.push(`CTA: fondo ${d.fill}, texto ${d.text}, ${d.radiusPx === null ? 'píldora' : `radio ${d.radiusPx}px`} (${d.by})`);
      cta = { name: 'CTA', text: { ...t, color: C(d.text) }, fill: C(d.fill), radiusPx: d.radiusPx, padX: Math.round(t.sizePx * 1.2), padY: Math.round(t.sizePx * 0.6) };
      ctaIndex = texts.length;
      if (contrast(C(d.fill).hex, C(d.text).hex) < 4.5) warnings.push(`CTA_CONTRAST: texto del CTA sobre su fondo con contraste ${contrast(C(d.fill).hex, C(d.text).hex).toFixed(2)} (< 4,5)`);
      continue;
    }
    texts.push(t);
  }
  internalRules.push(`Escala tipográfica interna (la marca no define una): ${[...usedScale].map((r) => `${roleLabelEs(r)} ${Math.round(INTERNAL_TYPE_SCALE[r].ratio * 1000) / 10} % del lado corto (mín. ${INTERNAL_TYPE_SCALE[r].minPx}px)`).join(', ')}`);
  const gap = Math.round(S * GAP);
  // Estimación (aviso, no bloqueo): ancho medio de glifo ≈ 0,55 em.
  const est = [...texts, ...(cta ? [cta.text] : [])].reduce((h, t) => {
    const perLine = Math.max(1, Math.floor(zone.width / (t.sizePx * 0.55)));
    const lines = t.text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    return h + lines * t.sizePx * (t.lineHeightPct / 100) + (t.role === 'cta' && cta ? cta.padY * 2 : 0);
  }, 0) + gap * Math.max(0, texts.length + (cta ? 1 : 0) - 1);
  if (est > zone.height) warnings.push(`TEXT_MAY_NOT_FIT: los textos ocupan ≈ ${Math.round(est)}px y la zona mide ${Math.round(zone.height)}px (el script lo mide y se detiene si no caben)`);

  const logoInks = logo ? logo.inks.map((i) => C(i)) : [];
  return {
    schema: MASTER_PLAN_SCHEMA_ID, briefSlug: b.slug, briefHash: briefHash(b),
    brand: { slug: brand.slug, name: brand.name, status: brand.status },
    fileKey: b.figma.fileKey, pageId: b.figma.pageId, sectionName: b.figma.sectionName, frameName: `${brand.slug}_${b.slug}_${W}x${H}`,
    width: W, height: H, archetype, background: bgC, panel, image,
    logo: { name: 'Logo', logoId: logo?.id ?? '', colorway: logo?.colorway ?? '', inks: logoInks, svg, rect: logoRect, minWidthPx: logo?.minWidthPx ?? null, clearSpacePx: clear, overPhoto: photoBehindLogo },
    stack: { name: 'Textos', zone, anchor, gapPx: gap, texts, ctaIndex },
    cta, textBackdrop: backdrop, safeArea: b.safeArea, internalRules, decisions, warnings, blockers,
  };
}

function imageOf(b: MasterBrief, assets: VariantAssetsRead | null, rect: Rect, blockers: string[], warnings: string[]): MasterPlan['image'] {
  if (!b.image.nodeId) { blockers.push('IMAGE_NOT_IN_FIGMA: falta el nodo de Figma con la imagen'); return null; }
  if (!assets) { blockers.push('ASSETS_NOT_VERIFIED: falta comprobar la imagen en Figma (master-assets-request)'); return null; }
  const n = assets.nodes.find((x) => x.nodeId === b.image.nodeId);
  const img = n?.images.find((i) => i.visible && i.hash);
  if (!n?.found) { blockers.push(`ASSET_UNAVAILABLE: ${b.image.nodeId} no está en el archivo`); return null; }
  if (!img?.hash) { blockers.push(`ASSET_NOT_IMAGE: ${b.image.nodeId} no contiene una imagen`); return null; }
  const k = img.width && img.height ? Math.max(rect.width / img.width, rect.height / img.height) : 1;
  if (k > 1.001) warnings.push(`ASSET_LOW_RESOLUTION: la imagen (${img.width}×${img.height}) se amplía ×${k.toFixed(2)} para cubrir ${Math.round(rect.width)}×${Math.round(rect.height)}`);
  return { name: 'Foto', rect, assetNodeId: b.image.nodeId, imageHash: img.hash, aiGenerated: b.image.source === 'ai_generated' };
}

/** Logo apto para paid; sobre color, el primero del kit con contraste ≥ mínimo de la marca; sobre foto, uno permitido. */
function pickLogo(brand: Brand, b: MasterBrief, svgs: Record<string, string>, bgHex: string | null, decisions: string[], warnings: string[], blockers: string[]): BrandLogo | null {
  const colors = confirmedColors(brand);
  const usable = brand.logos.filter((l) => l.externalUse && l.file?.endsWith('.svg') && svgs[l.id]);
  const inkHex = (l: BrandLogo) => l.inks.map((i) => colors.get(i)).filter((x): x is string => !!x);
  const minC = brand.logoRules.minContrast?.value ?? 4.5;
  const worst = (l: BrandLogo) => (bgHex ? Math.min(...inkHex(l).map((h) => contrast(h, bgHex))) : Infinity);
  if (b.logoId) {
    const l = usable.find((x) => x.id === b.logoId);
    if (!l) { blockers.push(`LOGO_UNAVAILABLE: ${b.logoId} no tiene SVG o no es apto para paid`); return null; }
    if (bgHex && worst(l) < minC) blockers.push(`LOGO_CONTRAST: ${l.label} sobre el fondo tiene contraste ${worst(l).toFixed(2)} (< ${minC})`);
    if (!bgHex && brand.logoRules.overPhoto && !brand.logoRules.overPhoto.allowedColorways.includes(l.colorway)) blockers.push(`LOGO_OVER_PHOTO: sobre foto la marca pide ${brand.logoRules.overPhoto.allowedColorways.join(' o ')} (${brand.logoRules.overPhoto.source})`);
    return l;
  }
  const primary = usable.filter((l) => l.version === 'primary');
  const pool = primary.length ? primary : usable;
  let pick: BrandLogo | undefined;
  // Preferencia de la marca = orden del kit (p. ej. 2 tintas antes que 1 tinta), entre los que alcanzan el contraste.
  if (bgHex) pick = pool.find((l) => worst(l) >= minC);
  else {
    const allowed = brand.logoRules.overPhoto?.allowedColorways;
    pick = pool.find((l) => (allowed ? allowed.includes(l.colorway) : true) && l.colorway === 'negative_one_ink') ?? pool.find((l) => (allowed ? allowed.includes(l.colorway) : true));
    if (pick) warnings.push(`LOGO_OVER_PHOTO_REVIEW: ${pick.label} sobre la foto; confirmar en la captura que se lee (o elegir otro logo)`);
  }
  if (!pick) { blockers.push(bgHex ? `LOGO_NO_CONTRAST: ningún logo apto alcanza contraste ${minC} sobre ${bgHex}` : 'LOGO_NONE_FOR_PHOTO: ningún logo apto para ir sobre foto'); return null; }
  decisions.push(`Logo ${pick.label} (propuesta del plan según el fondo${bgHex ? `, contraste ${worst(pick).toFixed(2)}` : ''})`);
  if (!svgColors(svgs[pick.id]!).length) warnings.push(`LOGO_SVG_COLORS_UNKNOWN: no se pudieron leer los colores del SVG de ${pick.label}`);
  return pick;
}
