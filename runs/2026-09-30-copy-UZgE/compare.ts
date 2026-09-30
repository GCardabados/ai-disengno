// Compara la maestra original (4:142) y la de la copia (1:537) por recorrido en preorden, sin IDs.
import { readFileSync, writeFileSync } from 'node:fs';
import { contentProjection } from '../../src/hash/fingerprint.ts';
import { canonicalize } from '../../src/hash/canonical.ts';
const a = JSON.parse(readFileSync('runs/2026-09-30-read-4-142-chunked/attempt-3/ingest/snapshot.json', 'utf8'));
const b = JSON.parse(readFileSync('runs/2026-09-30-copy-UZgE/ingest/snapshot.json', 'utf8'));
const ra = a.nodes[0].absoluteBoundingBox, rb = b.nodes[0].absoluteBoundingBox;
const rel = (n: any, r: any) => n.absoluteBoundingBox && { x: n.absoluteBoundingBox.x - r.x, y: n.absoluteBoundingBox.y - r.y, w: n.absoluteBoundingBox.width, h: n.absoluteBoundingBox.height };
const diffs: any[] = [];
const idMap: Array<[string, string]> = [];
if (a.nodes.length !== b.nodes.length) throw new Error('distinto número de nodos');
a.nodes.forEach((n: any, i: number) => {
  const m = b.nodes[i];
  idMap.push([n.id, m.id]);
  const ca = contentProjection(n) as any, cb = contentProjection(m) as any;
  const keys = Object.keys(ca).filter((k) => canonicalize(ca[k]) !== canonicalize(cb[k]));
  if (n.name !== m.name) keys.push('name');
  if (n.depth !== m.depth || n.childIds.length !== m.childIds.length) keys.push('structure');
  const la = rel(n, ra), lb = rel(m, rb);
  const d = la && lb ? Math.max(Math.abs(la.x - lb.x), Math.abs(la.y - lb.y), Math.abs(la.w - lb.w), Math.abs(la.h - lb.h)) : 0;
  if (d > 1e-3) keys.push(`layout(Δ${d})`);
  if (keys.length) diffs.push({ original: n.id, copy: m.id, name: n.name, keys });
});
writeFileSync('runs/2026-09-30-copy-UZgE/id-map-original-to-copy.json', JSON.stringify(idMap, null, 1));
console.log(JSON.stringify(diffs, null, 1));
