// MOCK — hace de transporte: ejecuta el script de lectura real contra el `figma` falso, una llamada por fragmento
// (releyendo la maestra en cada llamada, como en use_figma), e ingiere las respuestas.
import { buildReadScript, DEFAULT_CHUNK_BYTE_BUDGET } from '../read-script.ts';
import { ingestReadResponses, type ChunkResponse, type IngestResult } from '../ingest.ts';
import { createFakeFigma, runScriptInMock, type MockNodeSpec } from './fake-figma.ts';
import { fakeOptions, MOCK_FILE_KEY } from './fixtures.ts';

export interface MockReadOptions {
  /** Raíz a leer; por defecto, la raíz del spec. */
  rootId?: string;
  byteBudget?: number;
  maxResponseBytes?: number;
  /** Permite cambiar la maestra entre llamadas (para probar la detección de inconsistencias). */
  specForCall?: (chunkIndex: number) => MockNodeSpec;
}

export async function mockReadChunk(spec: MockNodeSpec, chunkIndex: number, opts: MockReadOptions = {}) {
  const fake = createFakeFigma(fakeOptions(spec));
  const { rawText, returned } = await runScriptInMock(
    buildReadScript(opts.rootId ?? spec.id, { chunkIndex, byteBudget: opts.byteBudget ?? DEFAULT_CHUNK_BYTE_BUDGET, maxResponseBytes: opts.maxResponseBytes }),
    fake,
  );
  return { rawText, returned: returned as { chunkCount: number }, violations: fake.violations };
}

export async function mockReadRaw(
  spec: MockNodeSpec,
  opts: MockReadOptions = {},
): Promise<{ responses: ChunkResponse[]; rawTexts: string[]; violations: string[] }> {
  const at = (i: number) => opts.specForCall?.(i) ?? spec;
  const first = await mockReadChunk(at(0), 0, opts);
  const rawTexts = [first.rawText];
  const violations = [...first.violations];
  for (let i = 1; i < first.returned.chunkCount; i++) {
    const r = await mockReadChunk(at(i), i, opts);
    rawTexts.push(r.rawText);
    violations.push(...r.violations);
  }
  return { responses: rawTexts.map((rawText) => ({ rawText, rawResponsePath: null })), rawTexts, violations };
}

export async function mockSnapshot(spec: MockNodeSpec, now = '2026-09-29T00:00:00.000Z', opts: MockReadOptions = {}): Promise<IngestResult> {
  const { responses, violations } = await mockReadRaw(spec, opts);
  if (violations.length > 0) throw new Error(`MOCK read script attempted writes: ${violations.join('; ')}`);
  return ingestReadResponses({
    responses,
    fileKey: MOCK_FILE_KEY,
    expectedRootNodeId: spec.id,
    source: 'MOCK',
    now: () => now,
  });
}
