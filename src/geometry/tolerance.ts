// Comparaciones geométricas CON tolerancia, separadas de los hashes de integridad (que son exactos).
// Uso: explicar magnitudes de cambio y, en H3, validar invariantes con las tolerancias numéricas del proyecto.
// Nunca deciden si la maestra ha cambiado: eso lo decide la huella exacta.

/** Máxima diferencia absoluta entre números en posiciones equivalentes de dos árboles JSON. null si la forma difiere. */
export function maxNumericDelta(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? 0 : null;
  if (Array.isArray(a) !== Array.isArray(b)) return null;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length || ka.some((k) => !kb.includes(k))) return null;
  let max = 0;
  for (const k of ka) {
    const d = maxNumericDelta((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
    if (d === null) return null;
    if (d > max) max = d;
  }
  return max;
}

export function approxEqual(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

export function withinTolerance(a: unknown, b: unknown, eps: number): boolean {
  const d = maxNumericDelta(a, b);
  return d !== null && d <= eps;
}
