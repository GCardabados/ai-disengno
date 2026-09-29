import { z } from 'zod';

export const RectSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
});
export type Rect = z.infer<typeof RectSchema>;

const row = z.tuple([z.number(), z.number(), z.number()]);
/** Transformación afín 2×3 de Figma: [[a, b, tx], [c, d, ty]]. */
export const TransformSchema = z.tuple([row, row]);
export type Transform = [[number, number, number], [number, number, number]];

/** Unión de rectángulos en px del destino. Intervalos semiabiertos [x, x+w). */
export const RegionSchema = z.strictObject({ rects: z.array(RectSchema) });
export type Region = z.infer<typeof RegionSchema>;

export const IDENTITY: Transform = [
  [1, 0, 0],
  [0, 1, 0],
];

export function multiply(m: Transform, n: Transform): Transform {
  const [[a, b, c], [d, e, f]] = m;
  const [[g, h, i], [j, k, l]] = n;
  return [
    [a * g + b * j, a * h + b * k, a * i + b * l + c],
    [d * g + e * j, d * h + e * k, d * i + e * l + f],
  ];
}

export function invert(m: Transform): Transform {
  const [[a, b, c], [d, e, f]] = m;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-12) throw new Error('non-invertible transform');
  const ia = e / det;
  const ib = -b / det;
  const id = -d / det;
  const ie = a / det;
  return [
    [ia, ib, -(ia * c + ib * f)],
    [id, ie, -(id * c + ie * f)],
  ];
}

/** R = A(frame)⁻¹ · A(node): transformación del nodo en coordenadas del frame raíz. */
export function relativeTo(frameAbsolute: Transform, nodeAbsolute: Transform): Transform {
  return multiply(invert(frameAbsolute), nodeAbsolute);
}

/** Caja envolvente alineada a ejes de un rectángulo local (0,0,w,h) transformado. */
export function transformedBounds(t: Transform, width: number, height: number): Rect {
  const pts: Array<[number, number]> = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) => [t[0][0] * x! + t[0][1] * y! + t[0][2], t[1][0] * x! + t[1][1] * y! + t[1][2]]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
