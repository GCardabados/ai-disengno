// ============================================================================
//  MOCK — `figma` falso para ejecutar el MISMO script de lectura fuera de Figma.
//  NO representa el comportamiento real de Figma: reproduce la forma de la Plugin API
//  que usa el script. Todo lo que produce debe etiquetarse como source: "MOCK".
//  Cualquier escritura o llamada de mutación lanza MOCK_READONLY_VIOLATION y se registra.
// ============================================================================
import { IDENTITY, multiply, transformedBounds, type Rect, type Transform } from '../../contracts/geometry.ts';

export interface MockPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  color?: { r: number; g: number; b: number };
  imageHash?: string;
  scaleMode?: string;
  imageTransform?: Transform;
  scalingFactor?: number;
}

export interface MockTextSpec {
  characters: string;
  hasMissingFont?: boolean;
  autoResize?: string;
  truncation?: string;
  maxLines?: number | null;
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  align?: string;
  /** Simula un entorno que rechaza campos avanzados de getStyledTextSegments. */
  rejectAdvancedSegmentFields?: boolean;
}

export interface MockNodeSpec {
  id: string;
  type: string;
  name: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
  rotation?: number;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  isMask?: boolean;
  clipsContent?: boolean;
  layoutMode?: string;
  constraints?: { horizontal: string; vertical: string };
  fills?: MockPaint[] | 'MIXED';
  strokes?: MockPaint[];
  effects?: Array<{ type: string; visible?: boolean; radius?: number }>;
  text?: MockTextSpec;
  /** Sustituye absoluteRenderBounds (coordenadas absolutas). null = sin render. */
  renderBounds?: Rect | null;
  geometry?: string;
  mainComponent?: { id: string; key: string; remote: boolean; name: string };
  /** Propiedades cuya lectura lanza un error (para probar readErrors). */
  throwOn?: string[];
  children?: MockNodeSpec[];
}

export interface FakeFigmaOptions {
  fileKey: string | null;
  page: { id: string; name: string };
  roots: MockNodeSpec[];
}

export interface FakeFigma {
  figma: Record<string | symbol, unknown>;
  violations: string[];
}

const CONTAINERS = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION', 'BOOLEAN_OPERATION']);
const FRAME_LIKE = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);
const GEOM = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'ELLIPSE', 'LINE', 'RECTANGLE']);

const NODE_MUTATORS = new Set([
  'resize', 'resizeWithoutConstraints', 'rescale', 'remove', 'clone', 'appendChild', 'insertChild',
  'setPluginData', 'setSharedPluginData', 'setRelaunchData', 'detachInstance', 'insertCharacters',
  'deleteCharacters', 'setBoundVariable', 'setProperties', 'swapComponent', 'screenshot', 'exportAsync',
  'set', 'setFillStyleIdAsync', 'setTextStyleIdAsync', 'setEffectStyleIdAsync', 'setStrokeStyleIdAsync',
]);
const FIGMA_MUTATORS = new Set([
  'setCurrentPageAsync', 'loadFontAsync', 'group', 'ungroup', 'flatten', 'union', 'subtract', 'intersect',
  'exclude', 'combineAsVariants', 'createImage', 'createImageAsync', 'loadAllPagesAsync', 'notify', 'closePlugin',
]);

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.values(v as object).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}

function readonlyProxy<T extends object>(
  target: T,
  label: string,
  violations: string[],
  isMutator: (p: string) => boolean,
  settable: Set<string> = new Set(),
): T {
  const deny = (what: string): never => {
    violations.push(`${what} on ${label}`);
    throw new Error(`MOCK_READONLY_VIOLATION: ${what} on ${label}`);
  };
  return new Proxy(target, {
    set(t, prop, value) {
      if (typeof prop === 'string' && settable.has(prop)) {
        (t as Record<string, unknown>)[prop] = value;
        return true;
      }
      return deny(`set ${String(prop)}`);
    },
    defineProperty(_t, prop) {
      return deny(`defineProperty ${String(prop)}`);
    },
    deleteProperty(_t, prop) {
      return deny(`delete ${String(prop)}`);
    },
    get(t, prop, recv) {
      if (typeof prop === 'string' && isMutator(prop)) {
        return () => deny(`call ${prop}()`);
      }
      return Reflect.get(t, prop, recv);
    },
  });
}

function relTransform(spec: MockNodeSpec): Transform {
  const rad = ((spec.rotation ?? 0) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [c, s, spec.x ?? 0],
    [-s, c, spec.y ?? 0],
  ];
}

function mkPaint(p: MockPaint): Record<string, unknown> {
  const o: Record<string, unknown> = {
    type: p.type,
    visible: p.visible ?? true,
    opacity: p.opacity ?? 1,
    blendMode: p.blendMode ?? 'NORMAL',
  };
  if (p.color) o.color = { ...p.color };
  if (p.type === 'IMAGE') {
    o.imageHash = p.imageHash ?? null;
    o.scaleMode = p.scaleMode ?? 'FILL';
    if (p.imageTransform) o.imageTransform = p.imageTransform;
    if (p.scalingFactor !== undefined) o.scalingFactor = p.scalingFactor;
  }
  return o;
}

const ADVANCED_SEGMENT_FIELDS = ['listOptions', 'indentation', 'hyperlink', 'textStyleId', 'fillStyleId', 'fontWeight', 'textCase', 'textDecoration', 'paragraphSpacing', 'paragraphIndent'];

export function createFakeFigma(opts: FakeFigmaOptions): FakeFigma {
  const violations: string[] = [];
  const byId = new Map<string, object>();
  const mixed = Symbol('figma.mixed');
  const isNodeMutator = (p: string) => NODE_MUTATORS.has(p) || p.startsWith('setRange');

  const documentTarget: Record<string, unknown> = { id: '0:0', type: 'DOCUMENT', name: 'Document', parent: null };
  const pageTarget: Record<string, unknown> = {
    id: opts.page.id,
    type: 'PAGE',
    name: opts.page.name,
    loadAsync: async () => {},
  };
  const doc = readonlyProxy(documentTarget, 'DOCUMENT', violations, isNodeMutator);
  const page = readonlyProxy(pageTarget, `PAGE ${opts.page.id}`, violations, isNodeMutator);

  function build(spec: MockNodeSpec, parent: object, parentAbs: Transform, parentVisible: boolean): object {
    const rel = relTransform(spec);
    const abs = multiply(parentAbs, rel);
    const visible = spec.visible ?? true;
    const effVisible = parentVisible && visible;
    const bbox = transformedBounds(abs, spec.width, spec.height);
    const t: Record<string, unknown> = {
      id: spec.id,
      type: spec.type,
      name: spec.name,
      parent,
      visible,
      opacity: spec.opacity ?? 1,
      blendMode: spec.blendMode ?? 'PASS_THROUGH',
      rotation: spec.rotation ?? 0,
      width: spec.width,
      height: spec.height,
      relativeTransform: deepFreeze(rel),
      absoluteTransform: deepFreeze(abs),
      absoluteBoundingBox: deepFreeze(bbox),
      absoluteRenderBounds: deepFreeze(spec.renderBounds !== undefined ? spec.renderBounds : effVisible ? { ...bbox } : null),
      effects: deepFreeze((spec.effects ?? []).map((e) => ({ type: e.type, visible: e.visible ?? true, radius: e.radius ?? 0 }))),
    };
    if (spec.type !== 'GROUP') {
      t.isMask = spec.isMask ?? false;
      t.maskType = 'ALPHA';
      t.constraints = deepFreeze(spec.constraints ?? { horizontal: 'MIN', vertical: 'MIN' });
      t.fills = spec.fills === 'MIXED' ? mixed : deepFreeze((spec.fills ?? []).map(mkPaint));
      t.strokes = deepFreeze((spec.strokes ?? []).map(mkPaint));
      t.strokeWeight = 0;
      t.strokeAlign = 'INSIDE';
    } else {
      t.isMask = false;
    }
    if (FRAME_LIKE.has(spec.type)) {
      t.clipsContent = spec.clipsContent ?? false;
      t.layoutMode = spec.layoutMode ?? 'NONE';
      t.layoutPositioning = 'AUTO';
      t.layoutSizingHorizontal = 'FIXED';
      t.layoutSizingVertical = 'FIXED';
    }
    if (GEOM.has(spec.type)) {
      t.fillGeometry = deepFreeze([{ windingRule: 'NONZERO', data: spec.geometry ?? `M0 0 L${spec.width} 0 L${spec.width} ${spec.height} Z` }]);
      t.strokeGeometry = deepFreeze([]);
      if (spec.type === 'VECTOR') t.vectorPaths = t.fillGeometry;
    }
    if (spec.type === 'TEXT') {
      const tx = spec.text ?? { characters: '' };
      t.characters = tx.characters;
      t.hasMissingFont = tx.hasMissingFont ?? false;
      t.textAutoResize = tx.autoResize ?? 'HEIGHT';
      t.textTruncation = tx.truncation ?? 'DISABLED';
      t.maxLines = tx.maxLines ?? null;
      t.textAlignHorizontal = tx.align ?? 'LEFT';
      t.textAlignVertical = 'TOP';
      t.leadingTrim = 'NONE';
      const fills = t.fills;
      t.getStyledTextSegments = (fields: string[]) => {
        if (tx.rejectAdvancedSegmentFields && fields.some((f) => ADVANCED_SEGMENT_FIELDS.includes(f))) {
          throw new Error('MOCK: unsupported segment field');
        }
        const full: Record<string, unknown> = {
          fontName: { family: tx.fontFamily ?? 'Inter', style: tx.fontStyle ?? 'Regular' },
          fontSize: tx.fontSize ?? 32,
          fontWeight: 400,
          lineHeight: { unit: 'AUTO' },
          letterSpacing: { unit: 'PERCENT', value: 0 },
          textCase: 'ORIGINAL',
          textDecoration: 'NONE',
          paragraphSpacing: 0,
          paragraphIndent: 0,
          fills,
          listOptions: { type: 'NONE' },
          indentation: 0,
          hyperlink: null,
          textStyleId: '',
          fillStyleId: '',
        };
        const seg: Record<string, unknown> = { start: 0, end: tx.characters.length, characters: tx.characters };
        for (const f of fields) if (f in full) seg[f] = full[f];
        return [deepFreeze(seg)];
      };
    }
    if (spec.type === 'INSTANCE') {
      const mc = spec.mainComponent ?? null;
      t.getMainComponentAsync = async () => (mc ? deepFreeze({ ...mc }) : null);
    }
    for (const prop of spec.throwOn ?? []) {
      Object.defineProperty(t, prop, {
        get() {
          throw new Error(`MOCK: cannot read ${prop}`);
        },
        enumerable: true,
      });
    }
    const proxy = readonlyProxy(t, `${spec.type} ${spec.id}`, violations, isNodeMutator);
    if (CONTAINERS.has(spec.type)) {
      const kids = (spec.children ?? []).map((c) => build(c, proxy, abs, effVisible));
      t.children = Object.freeze(kids);
    } else if (spec.children && spec.children.length > 0) {
      throw new Error(`MOCK fixture error: ${spec.type} ${spec.id} cannot have children`);
    }
    if (byId.has(spec.id)) throw new Error(`MOCK fixture error: duplicate id ${spec.id}`);
    byId.set(spec.id, proxy);
    return proxy;
  }

  pageTarget.parent = doc;
  pageTarget.children = Object.freeze(opts.roots.map((r) => build(r, page, IDENTITY, true)));
  documentTarget.children = Object.freeze([page]);
  byId.set(opts.page.id, page);

  const figmaTarget: Record<string | symbol, unknown> = {
    mixed,
    editorType: 'figma',
    fileKey: opts.fileKey ?? undefined,
    skipInvisibleInstanceChildren: true,
    root: doc,
    currentPage: page,
    getNodeByIdAsync: async (id: string) => byId.get(id) ?? null,
  };
  const figma = readonlyProxy(
    figmaTarget as Record<string, unknown>,
    'figma',
    violations,
    (p) => FIGMA_MUTATORS.has(p) || p.startsWith('create'),
    new Set(['skipInvisibleInstanceChildren']),
  );
  return { figma, violations };
}

/** Ejecuta un script de use_figma contra el `figma` falso y serializa el retorno como haría la herramienta (supuesto). */
export async function runScriptInMock(code: string, fake: FakeFigma): Promise<{ rawText: string; returned: unknown }> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (figma: unknown) => Promise<unknown>;
  const fn = new AsyncFunction('figma', code);
  const returned = await fn(fake.figma);
  return { rawText: JSON.stringify(returned), returned };
}
