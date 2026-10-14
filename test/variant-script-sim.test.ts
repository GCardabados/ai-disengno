// MOCK — simulación ESCRIBIBLE mínima de la Plugin API para EJECUTAR el script de variantes fuera de Figma.
// No reproduce el render real: la medida del texto es aproximada (ancho de glifo = 0,5 × cuerpo, alto de línea = 1,2 ×
// cuerpo). Sirve para probar el control de flujo del script (clonado, guardas, fallo aislado, reejecución, fit_text),
// no la tipografía.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVariantPlan, type VariantPlan } from '../src/variants/plan.ts';
import { checkVariantJob, confirm } from '../src/variants/job.ts';
import { buildVariantScript } from '../src/figma/variant-script.ts';
import { universityMasterSpec } from '../src/figma/mock/fixtures.ts';
import type { MockNodeSpec } from '../src/figma/mock/fake-figma.ts';
import type { VariantAssetsRead, VariantJob, VariantResult } from '../src/contracts/variants.ts';
import { snap } from './helpers.ts';

interface Seg { end: number; style: string; size: number }
interface SimNode {
  id: string; type: string; name: string; x: number; y: number; width: number; height: number; parent: SimNode | null;
  children: SimNode[]; fills: unknown[]; layoutMode: string; characters?: string; segs?: Seg[]; textAutoResize?: string; textAlignHorizontal?: string;
  [k: string]: unknown;
}

function sim(root: MockNodeSpec, opts: { missingFont?: string; hug?: boolean } = {}) {
  let next = 500;
  const all = new Map<string, SimNode>();
  const writes: string[] = [];
  const reflow = (n: SimNode) => {
    if (n.type !== 'TEXT') return;
    const chars = n.characters!;
    const size = Math.max(...n.segs!.map((s) => s.size));
    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') { n.width = chars.length * size * 0.5; n.height = size * 1.2; }
    else if (n.textAutoResize === 'HEIGHT') { const per = Math.max(1, Math.floor(n.width / (size * 0.5))); n.height = Math.ceil(chars.length / per) * size * 1.2; }
  };
  const abs = (n: SimNode): { x: number; y: number } => (n.parent && n.parent.type !== 'PAGE' ? { x: abs(n.parent).x + n.x, y: abs(n.parent).y + n.y } : { x: n.x, y: n.y });
  const mk = (s: Partial<SimNode> & { id: string; type: string }, parent: SimNode | null): SimNode => {
    const n = {
      name: '', x: 0, y: 0, width: 0, height: 0, children: [], fills: [], layoutMode: 'NONE', ...s, parent,
    } as SimNode;
    Object.defineProperty(n, 'absoluteBoundingBox', { get: () => ({ ...abs(n), width: n.width, height: n.height }), enumerable: false });
    all.set(n.id, n);
    return n;
  };
  const methods = (n: SimNode) => {
    // Auto layout con «hug»: el marco sigue el ancho de su texto (+ relleno de 30 px por lado).
    if (opts.hug && n.layoutMode === 'HORIZONTAL') Object.defineProperty(n, 'width', { get: () => (n.children[0]?.width ?? 0) + 60, set: () => {}, enumerable: true, configurable: true });
    n.findAll = (f: (x: SimNode) => boolean) => { const out: SimNode[] = []; const w = (x: SimNode) => x.children.forEach((c) => { if (f(c)) out.push(c); w(c); }); w(n); return out; };
    n.appendChild = (c: SimNode) => { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); n.children.push(c); c.parent = n; };
    n.resizeWithoutConstraints = (w: number, h: number) => { n.width = w; n.height = h; };
    n.resize = (w: number, h: number) => { writes.push(`resize ${n.id}`); n.width = w; n.height = h; };
    n.remove = () => { writes.push(`remove ${n.id}`); n.parent!.children = n.parent!.children.filter((x) => x !== n); const rm = (x: SimNode) => { all.delete(x.id); x.children.forEach(rm); }; rm(n); };
    n.clone = () => {
      const cp = (x: SimNode, p: SimNode | null): SimNode => {
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(x)) if (typeof v !== 'function' && !['parent', 'children', 'textAutoResize'].includes(k)) data[k] = structuredClone(v);
        const y = mk({ ...data, id: `${900 + next++}:1` } as SimNode, p);
        y.children = x.children.map((ch) => cp(ch, y));
        methods(y);
        return y;
      };
      const c = cp(n, n.parent);
      n.parent!.children.push(c);
      return c;
    };
    if (n.type === 'TEXT') {
      const segOf = (i: number) => n.segs!.find((s, k) => i < s.end && i >= (k ? n.segs![k - 1]!.end : 0))!;
      n.getStyledTextSegments = () => n.segs!.map((s, k) => ({ start: k ? n.segs![k - 1]!.end : 0, end: s.end, fontName: { family: 'Inter', style: s.style } }));
      n.insertCharacters = (pos: number, t: string, use: string) => {
        writes.push(`insert ${n.id}`);
        assert.equal(use, 'BEFORE');
        const style = segOf(pos - 1);
        n.characters = n.characters!.slice(0, pos) + t + n.characters!.slice(pos);
        n.segs = n.segs!.map((s) => (s.end >= pos && s !== style && s.end > pos ? { ...s, end: s.end + t.length } : s.end >= pos ? { ...s, end: s.end + t.length } : s));
        reflow(n);
      };
      n.deleteCharacters = (a: number, b: number) => {
        writes.push(`delete ${n.id}`);
        n.characters = n.characters!.slice(0, a) + n.characters!.slice(b);
        n.segs = n.segs!.map((s) => ({ ...s, end: s.end <= a ? s.end : Math.max(a, s.end - (b - a)) })).filter((s, k, arr) => s.end > (k ? arr[k - 1]!.end : 0));
        reflow(n);
      };
      n.getRangeFontSize = (a: number) => segOf(a).size;
      n.getRangeLineHeight = () => ({ unit: 'AUTO' });
      n.getRangeLetterSpacing = () => ({ unit: 'PERCENT', value: 0 });
      n.setRangeFontSize = (a: number, b: number, v: number) => {
        writes.push(`fontSize ${n.id}`);
        // Solo tramos completos (lo que hace el script).
        n.segs = n.segs!.map((s, k) => ((k ? n.segs![k - 1]!.end : 0) >= a && s.end <= b ? { ...s, size: v } : s));
        reflow(n);
      };
      Object.defineProperty(n, 'textAutoResize', { get: () => n._ar, set: (v: string) => { writes.push(`autoResize ${n.id}`); n._ar = v; reflow(n); }, enumerable: true });
    }
  };
  const build = (s: MockNodeSpec, parent: SimNode | null): SimNode => {
    const n = mk({ id: s.id, type: s.type, name: s.name, x: s.x ?? 0, y: s.y ?? 0, width: s.width, height: s.height, fills: structuredClone((s.fills as unknown[]) ?? []), layoutMode: s.layoutMode ?? 'NONE' }, parent);
    if (s.type === 'TEXT') {
      n.characters = s.text!.characters;
      n.segs = (s.text!.segments ?? [{ end: s.text!.characters.length }]).map((r) => ({ end: r.end, style: r.fontStyle ?? 'Regular', size: r.fontSize ?? s.text!.fontSize ?? 32 }));
      n._ar = s.text!.autoResize ?? 'HEIGHT';
      n.textAlignHorizontal = 'LEFT';
    }
    methods(n);
    n.children = (s.children ?? []).map((c) => build(c, n));
    return n;
  };
  const page = mk({ id: '1:1', type: 'PAGE', name: 'MOCK página' }, null);
  methods(page);
  page.loadAsync = async () => {};
  page.children = [build(root, page)];
  const figma = {
    getNodeByIdAsync: async (id: string) => all.get(id) ?? null,
    loadFontAsync: async (f: { style: string }) => { if (opts.missingFont === f.style) throw new Error(`MOCK: font ${f.style} not available`); },
    createSection: () => { const s = mk({ id: `${800 + next++}:1`, type: 'SECTION', name: '' }, null); methods(s); return s; },
    getImageByHash: (h: string) => (h.startsWith('img_') ? { getSizeAsync: async () => ({ width: 2000, height: 2000 }) } : null),
  };
  const run = async (code: string): Promise<VariantResult> => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (f: unknown) => Promise<unknown>;
    return (await new AsyncFunction('figma', code)(figma)) as VariantResult;
  };
  return { page, all, writes, run, master: () => all.get(root.id)! };
}

const USER = { by: 'user' as const, at: '2026-10-14T10:00:00.000Z', note: 'MOCK' };
const ASSETS: VariantAssetsRead = {
  schema: 'pcb.variant-assets.v1', hashes: [],
  nodes: [
    { nodeId: '70:2', found: true, type: 'RECTANGLE', width: 1080, height: 1080, images: [{ paintIndex: 0, hash: 'img_derecho_madrid', visible: true, width: 2000, height: 2000, error: null }] },
    { nodeId: '80:2', found: true, type: 'RECTANGLE', width: 400, height: 400, images: [{ paintIndex: 0, hash: 'img_medicina_sevilla', visible: true, width: 2000, height: 2000, error: null }] },
  ],
};

async function plan(titulares: Record<string, string>, policy: VariantJob['fields'][number]['textPolicy'] = { mode: 'strict' }): Promise<VariantPlan> {
  const s = await snap(universityMasterSpec());
  const job: VariantJob = {
    schema: 'pcb.variant-job.v1', request: 'MOCK',
    master: { fileKey: s.fileKey, nodeId: '70:1', name: 'UNI_Grados_1080x1080', width: 1080, height: 1080, fingerprint: s.fingerprints.master, params: { grado: 'Derecho', ciudad: 'Madrid' } },
    params: [{ paramId: 'grado', label: 'Grado' }, { paramId: 'ciudad', label: 'Ciudad' }],
    fields: [
      { fieldId: 'titular', label: 'Titular', kind: 'text', nodeId: '70:7', role: 'headline', isLegal: false, masterValue: 'Estudia Derecho en Madrid', styleMapping: 'segments', textPolicy: policy, imagePolicy: null, paintIndex: null, maskDecision: null },
      { fieldId: 'foto', label: 'Foto', kind: 'image', nodeId: '70:2', role: null, isLegal: false, masterValue: 'img_derecho_madrid', styleMapping: null, textPolicy: null, imagePolicy: { mode: 'fill' }, paintIndex: 0, maskDecision: null },
    ],
    kept: [{ label: 'Legal y URL', nodeIds: ['70:12', '70:11'], why: 'MOCK' }],
    protected: { logoNodeIds: ['70:4'], safeArea: null, safeAreaNote: null },
    variants: Object.entries(titulares).map(([id, ciudad]) => ({
      variantId: id, label: id, params: { grado: 'Medicina', ciudad }, notes: null,
      values: {
        titular: { kind: 'text' as const, text: null, parts: ['Estudia ', `Medicina en ${ciudad}`], display: null, source: 'user_provided' as const },
        foto: { kind: 'image' as const, asset: { kind: 'figma_node' as const, nodeId: '80:2', label: 'foto' }, source: 'user_provided' as const },
      },
    })),
    output: { sectionName: 'PCB · Variantes', cloneNamePattern: '{master} · VAR {variant}' },
    confirmations: { fields: null, content: null },
  };
  const j = confirm(confirm(job, 'fields', USER), 'content', USER);
  assert.equal(checkVariantJob(j, s).ready, true, JSON.stringify(checkVariantJob(j, s).issues));
  return buildVariantPlan(j, s, ASSETS).plan;
}

test('MOCK [simulación]: crea una variante por fila desde la maestra, con el estilo de cada tramo, sin tocar la maestra', async () => {
  const p = await plan({ vigo: 'Vigo', cadiz: 'Cádiz' });
  const f = sim(universityMasterSpec());
  const res = await f.run(buildVariantScript(p));
  assert.deepEqual(res.variants.map((v) => v.status), ['created', 'created'], JSON.stringify(res.variants.map((v) => v.error)));
  assert.equal(f.all.get('70:7')!.characters, 'Estudia Derecho en Madrid', 'la maestra intacta');
  assert.equal(f.master().children.length, 9);
  assert.ok(!f.writes.some((w) => /^(insert|delete|fontSize|resize|autoResize|remove) 70:/.test(w)), 'ninguna escritura sobre nodos de la maestra');
  const section = f.page.children.find((n) => n.type === 'SECTION')!;
  assert.deepEqual(section.children.map((c) => c.name), ['UNI_Grados_1080x1080 · VAR vigo', 'UNI_Grados_1080x1080 · VAR cadiz']);
  const t = section.children[1]!.children.find((c) => c.name === 'Text 1')!;
  assert.equal(t.characters, 'Estudia Medicina en Cádiz');
  assert.deepEqual(t.segs, [{ end: 8, style: 'Regular', size: 72 }, { end: 25, style: 'Bold', size: 72 }], 'cada tramo conserva su estilo');
  const foto = section.children[0]!.children.find((c) => c.name === 'Rectangle 12')!;
  assert.equal((foto.fills[0] as { imageHash: string }).imageHash, 'img_medicina_sevilla');
});

test('MOCK [simulación]: una variante que no cabe falla sola (clon descartado); la reejecución no duplica', async () => {
  const p = await plan({ vigo: 'Vigo', larga: 'San Sebastián de los Reyes y Alcobendas del Norte con prácticas' });
  const f = sim(universityMasterSpec());
  const res = await f.run(buildVariantScript(p));
  assert.deepEqual(res.variants.map((v) => v.status), ['created', 'failed']);
  assert.match(res.variants[1]!.error!, /PCB_TEXT_DOES_NOT_FIT .*clon descartado/);
  const section = f.page.children.find((n) => n.type === 'SECTION')!;
  assert.equal(section.children.length, 1, 'no queda ninguna salida parcial');
  const again = await f.run(buildVariantScript(p, { variantIds: ['vigo'] }));
  assert.deepEqual(again.variants.map((v) => v.status), ['exists']);
  assert.equal(section.children.length, 1);
});

test('MOCK [simulación]: fit_text reduce todos los tramos con el mismo factor hasta el mínimo autorizado, nunca por debajo', async () => {
  const p = await plan({ larga: 'San Sebastián de los Reyes y Alcobendas' }, { mode: 'fit_text', minScale: 0.7, authorization: null });
  const f = sim(universityMasterSpec());
  const res = await f.run(buildVariantScript(p));
  assert.equal(res.variants[0]!.status, 'created', res.variants[0]!.error ?? '');
  const t = f.page.children.find((n) => n.type === 'SECTION')!.children[0]!.children.find((c) => c.name === 'Text 1')!;
  const k = t.segs![0]!.size / 72;
  assert.ok(k < 1 && k >= 0.7, `factor ${k}`);
  assert.equal(t.segs![1]!.size / 72, k, 'misma jerarquía');
  assert.ok(t.height <= 160 + 0.5);
  const tight = await plan({ larga: 'San Sebastián de los Reyes y Alcobendas del Norte con prácticas en empresa' }, { mode: 'fit_text', minScale: 0.9, authorization: null });
  const g = sim(universityMasterSpec());
  assert.equal((await g.run(buildVariantScript(tight))).variants[0]!.status, 'failed', 'si no cabe ni con el mínimo, falla');
});

test('MOCK [simulación]: patch reaplica sin duplicar; con un cambio manual en el clon no escribe nada de esa variante', async () => {
  const p = await plan({ vigo: 'Vigo' });
  const f = sim(universityMasterSpec());
  const first = await f.run(buildVariantScript(p));
  const cloneId = first.variants[0]!.cloneId!;
  const ok = await f.run(buildVariantScript(p, { mode: 'patch', existingCloneIds: { vigo: cloneId } }));
  assert.equal(ok.variants[0]!.status, 'patched');
  const clone = f.all.get(cloneId)!;
  clone.children.find((c) => c.name === 'Text 1')!.characters = 'Retocado a mano';
  const before = f.writes.length;
  const res = await f.run(buildVariantScript(p, { mode: 'patch', existingCloneIds: { vigo: cloneId } }));
  assert.equal(res.variants[0]!.status, 'failed');
  assert.match(res.variants[0]!.error!, /PCB_TEXT_UNEXPECTED.*no se escribió nada/);
  assert.equal(f.writes.length, before, 'ninguna escritura');
});

test('MOCK [simulación]: si el auto layout desplaza otro elemento, la variante se detiene («requiere adaptación de diseño»)', async () => {
  const p = await plan({ vigo: 'Vigo' });
  // La variante cambia también el texto del botón (auto layout con hug): un copy más corto encoge el botón.
  p.variants[0]!.ops.push({ kind: 'text', fieldId: 'cta', nodeId: '70:10', masterCharacters: 'Infórmate', segments: [{ start: 0, end: 9 }], parts: ['Ven'], characters: 'Ven', policy: { mode: 'strict' }, isLegal: false });
  const f = sim(universityMasterSpec(), { hug: true });
  const res = await f.run(buildVariantScript(p));
  assert.equal(res.variants[0]!.status, 'failed');
  assert.match(res.variants[0]!.error!, /^PCB_LAYOUT_SHIFT requiere adaptación de diseño: 70:9 .*clon descartado/);
  assert.equal(f.page.children.find((n) => n.type === 'SECTION')!.children.length, 0);
});

test('MOCK [simulación]: una fuente que no carga detiene todo ANTES de clonar', async () => {
  const p = await plan({ vigo: 'Vigo' });
  const f = sim(universityMasterSpec(), { missingFont: 'Bold' });
  await assert.rejects(f.run(buildVariantScript(p)), /PCB_FONT_UNAVAILABLE .*Bold/);
  assert.ok(!f.page.children.some((n) => n.type === 'SECTION'), 'ni sección ni clones');
});
