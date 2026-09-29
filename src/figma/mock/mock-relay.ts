// MOCK — hace de transporte: ejecuta el script de lectura real contra el `figma` falso e ingiere la respuesta.
import { buildReadScript } from '../read-script.ts';
import { ingestReadResponse, type IngestResult } from '../ingest.ts';
import { createFakeFigma, runScriptInMock, type MockNodeSpec } from './fake-figma.ts';
import { fakeOptions, MOCK_FILE_KEY } from './fixtures.ts';

export async function mockReadRaw(spec: MockNodeSpec, rootId: string = spec.id): Promise<{ rawText: string; violations: string[] }> {
  const fake = createFakeFigma(fakeOptions(spec));
  const { rawText } = await runScriptInMock(buildReadScript(rootId), fake);
  return { rawText, violations: fake.violations };
}

export async function mockSnapshot(spec: MockNodeSpec, now = '2026-09-29T00:00:00.000Z'): Promise<IngestResult> {
  const { rawText, violations } = await mockReadRaw(spec);
  if (violations.length > 0) throw new Error(`MOCK read script attempted writes: ${violations.join('; ')}`);
  return ingestReadResponse({
    rawText,
    fileKey: MOCK_FILE_KEY,
    expectedRootNodeId: spec.id,
    source: 'MOCK',
    rawResponsePath: null,
    now: () => now,
  });
}
