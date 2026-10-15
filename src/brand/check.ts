// Comprobación de un brand kit (brand-check): coherencia interna, archivos de logo y erratas detectables. No juzga el
// diseño; dice qué está listo para producir, qué hay que confirmar con el cliente y qué no especifica el manual.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Brand } from '../contracts/brand.ts';
import { contrast, rgbToHex, svgAspect, svgColors } from './color.ts';

export interface BrandIssue { code: string; severity: 'blocking' | 'pending' | 'warning'; message: string }
export interface BrandCheck { issues: BrandIssue[]; logoAspects: Record<string, number | null>; ready: boolean }

export async function checkBrand(b: Brand, dir: string): Promise<BrandCheck> {
  const issues: BrandIssue[] = [];
  const add = (code: string, severity: BrandIssue['severity'], message: string) => issues.push({ code, severity, message });

  // Colores: ids únicos, HEX ↔ RGB coherentes (las erratas del manual se detectan aquí).
  const ids = new Set<string>();
  for (const c of b.colors) {
    if (ids.has(c.id)) add('COLOR_DUPLICATE', 'blocking', `Color repetido: ${c.id}`);
    ids.add(c.id);
    if (c.hex && c.rgb && rgbToHex(c.rgb) !== c.hex) {
      add('COLOR_HEX_RGB_MISMATCH', c.status === 'needs_confirmation' ? 'pending' : 'blocking', `${c.name}: HEX ${c.hex} no corresponde a RGB ${c.rgb.join(',')} (= ${rgbToHex(c.rgb)}) — confirmar con el cliente (${c.source})`);
    }
    if (!c.hex) add('COLOR_WITHOUT_HEX', 'pending', `${c.name}: sin HEX utilizable (${c.source})`);
    if (c.status === 'needs_confirmation' && !b.openQuestions.some((q) => q.status === 'open' && q.question.includes(c.name))) add('COLOR_UNCONFIRMED_NO_QUESTION', 'warning', `${c.name}: marcado para confirmar pero sin pregunta abierta que lo explique`);
  }
  const palette = new Set(b.colors.flatMap((c) => (c.hex && c.status === 'confirmed' ? [c.hex] : [])));
  for (const id of b.graphicDevices.flatMap((g) => g.colorIds)) if (!ids.has(id)) add('DEVICE_COLOR_UNKNOWN', 'blocking', `Un elemento gráfico usa el color ${id}, que no está en la paleta`);

  // Tipografía: los roles apuntan a familias y estilos declarados.
  for (const [role, r] of Object.entries(b.typography.roles)) {
    if (!r) { add('TYPE_ROLE_UNSPECIFIED', 'warning', `Tipografía para «${role}» no especificada por la marca: se decide por encargo`); continue; }
    const fam = b.typography.families.find((f) => f.family === r.family);
    if (!fam) add('TYPE_ROLE_FAMILY_UNKNOWN', 'blocking', `«${role}» usa ${r.family}, que no está en las familias de la marca`);
    else if (!fam.styles.includes(r.style)) add('TYPE_ROLE_STYLE_UNKNOWN', 'blocking', `«${role}» usa ${r.family} ${r.style}, estilo no declarado (${fam.styles.join(', ')})`);
  }
  for (const f of b.typography.families) if (f.figma !== 'google_fonts') add('FONT_NEEDS_INSTALL', 'warning', `${f.family}: ${f.figma === 'custom' ? 'hay que instalarla o activarla en Figma' : 'disponibilidad en Figma sin comprobar'}; si no carga, no se sustituye`);

  // Logos: archivos presentes, colores del SVG dentro de la paleta, al menos uno apto para paid.
  const logoAspects: Record<string, number | null> = {};
  const logoIds = new Set<string>();
  for (const l of b.logos) {
    if (logoIds.has(l.id)) add('LOGO_DUPLICATE', 'blocking', `Logo repetido: ${l.id}`);
    logoIds.add(l.id);
    logoAspects[l.id] = null;
    for (const ink of l.inks) if (ink !== 'white' && ink !== 'black' && !ids.has(ink)) add('LOGO_INK_UNKNOWN', 'blocking', `${l.label}: la tinta ${ink} no está en la paleta`);
    if (!l.file) { add('LOGO_FILE_MISSING', l.externalUse ? 'pending' : 'warning', `${l.label}: falta el archivo`); continue; }
    let svg: string;
    try { svg = await readFile(join(dir, l.file), 'utf8'); } catch { add('LOGO_FILE_NOT_FOUND', 'blocking', `${l.label}: no existe ${l.file}`); continue; }
    if (!l.file.endsWith('.svg')) continue;
    logoAspects[l.id] = svgAspect(svg);
    const off = svgColors(svg).filter((h) => !palette.has(h) && h !== '#FFFFFF' && h !== '#000000');
    if (off.length) add('LOGO_COLOR_OFF_PALETTE', 'warning', `${l.label}: el SVG usa ${off.join(', ')}, que no está en la paleta confirmada`);
    if (/<image\b|<text\b/i.test(svg)) add('LOGO_SVG_NOT_VECTOR', 'warning', `${l.label}: el SVG contiene imágenes o texto vivo (no es vectorial puro)`);
  }
  if (!b.logos.some((l) => l.externalUse && l.file)) add('NO_EXTERNAL_LOGO', 'pending', 'No hay ningún logo apto para comunicación externa con archivo');

  // Reglas del logo: límites de fondo coherentes con el contraste mínimo declarado.
  const minC = b.logoRules.minContrast?.value ?? null;
  for (const bg of b.logoRules.backgrounds) {
    const ref = b.logos.find((l) => l.colorway === bg.colorway && l.file?.endsWith('.svg'));
    if (!ref || !minC) continue;
    const edge = bg.darkestBg ?? bg.lightestBg;
    if (!edge) continue;
    const svgC = svgColors(await readFile(join(dir, ref.file!), 'utf8').catch(() => ''));
    const worst = svgC.length ? Math.min(...svgC.map((h) => contrast(h, edge))) : null;
    if (worst !== null && worst + 0.05 < minC) add('LOGO_BG_LIMIT_BELOW_CONTRAST', 'warning', `${ref.label} sobre ${edge}: contraste ${worst.toFixed(2)} < ${minC} (la regla del manual y su propio logo no cuadran)`);
  }
  if (!b.logoRules.clearSpace) add('CLEAR_SPACE_UNSPECIFIED', 'warning', 'Área de reserva del logo no especificada');

  // Plantillas.
  for (const t of b.templates) if (!Object.keys(t.slots).length) add('TEMPLATE_WITHOUT_SLOTS', 'blocking', `Plantilla ${t.id}: sin huecos declarados`);

  for (const q of b.openQuestions.filter((x) => x.status === 'open')) add('OPEN_QUESTION', 'pending', `${q.question} (${q.source})`);
  if (b.status === 'validated' && !b.validation) add('VALIDATED_WITHOUT_DECISION', 'blocking', 'El kit figura como validado sin registro de quién lo validó');
  if (b.status === 'validated' && issues.some((i) => i.severity === 'pending')) add('VALIDATED_WITH_PENDING', 'blocking', 'Un kit validado no puede tener pendientes');
  if (b.status === 'draft') add('BRAND_DRAFT', 'warning', 'Kit en borrador: sirve para propuestas; una persona debe validarlo (brand-validate) antes de producir sin avisos');
  return { issues, logoAspects, ready: !issues.some((i) => i.severity === 'blocking') };
}

/** Colores confirmados (HEX) por id, más 'white' y 'black'. */
export const confirmedColors = (b: Brand): Map<string, string> => new Map([['white', '#FFFFFF'], ['black', '#000000'], ...b.colors.flatMap((c) => (c.hex && c.status === 'confirmed' ? [[c.id, c.hex] as [string, string]] : []))]);
