// Representación segura de cadenas NO CONFIABLES (nombres de capa, textos, metadatos de Figma).
// Se muestran como datos literales: control/bidi escapados y encerrados en código inline con una
// cerca de backticks más larga que cualquier secuencia interna.

// Rangos por código numérico (sin caracteres invisibles literales en el código fuente):
// C0, DEL+C1, ZWSP..RLM, LS/PS + marcas de embedding/override bidi, WJ..isolates bidi, BOM.
const RANGES: Array<[number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];

function isDangerous(code: number): boolean {
  return RANGES.some(([a, b]) => code >= a && code <= b);
}

export function escapeControls(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    out += isDangerous(code) ? `\\u${code.toString(16).padStart(4, '0')}` : ch;
  }
  return out;
}

export function untrustedInline(s: string): string {
  const cleaned = escapeControls(s);
  if (cleaned.length === 0) return '`∅`';
  const longest = Math.max(0, ...(cleaned.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${cleaned} ${fence}`;
}
