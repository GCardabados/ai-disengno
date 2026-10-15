// Utilidades de color deterministas (sin dependencias): HEX ↔ RGB y contraste WCAG 2.x.

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`HEX inválido: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (c: RGB): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Luminancia relativa (WCAG 2.x). */
export function luminance(c: RGB): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Ratio de contraste WCAG entre dos colores (1..21). */
export function contrast(a: RGB | string, b: RGB | string): number {
  const la = luminance(typeof a === 'string' ? hexToRgb(a) : a), lb = luminance(typeof b === 'string' ? hexToRgb(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Colores de relleno/trazo que declara un SVG (atributos y estilos en línea). */
export function svgColors(raw: string): string[] {
  // Las definiciones (clipPath, máscaras, defs) no se pintan: su relleno no es un color del logo.
  const svg = raw.replace(/<defs\b[\s\S]*?<\/defs>|<clipPath\b[\s\S]*?<\/clipPath>|<mask\b[\s\S]*?<\/mask>/gi, '');
  const out = new Set<string>();
  for (const m of svg.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b/g)) {
    let h = m[1]!;
    if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
    out.add(h.toUpperCase());
  }
  if (/(?:fill|stroke)\s*[:=]\s*["']?\s*(?:white|#fff\b)/i.test(svg)) out.add('#FFFFFF');
  if (/(?:fill|stroke)\s*[:=]\s*["']?\s*black\b/i.test(svg)) out.add('#000000');
  return [...out].sort();
}

/** Proporción ancho/alto declarada por un SVG (viewBox o width/height). */
export function svgAspect(svg: string): number | null {
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/.exec(svg);
  if (vb) return Number(vb[1]) / Number(vb[2]);
  const w = /\swidth\s*=\s*["']([\d.]+)/.exec(svg), h = /\sheight\s*=\s*["']([\d.]+)/.exec(svg);
  return w && h ? Number(w[1]) / Number(h[1]) : null;
}
