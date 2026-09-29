#!/usr/bin/env node
// CLI de H0/H1. Ningún comando escribe en Figma.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseOrThrow } from './contracts/schema.ts';
import { ProjectConfigSchema, checkConfigSemantics, type ProjectConfig } from './contracts/config.ts';
import { MasterSnapshotSchema, type MasterSnapshot } from './contracts/snapshot.ts';
import { ManifestSchema, ReviewDecisionsSchema, type Manifest } from './contracts/manifest.ts';
import { buildReadRequest } from './figma/read-script.ts';
import { ingestReadResponse } from './figma/ingest.ts';
import { mockReadRaw } from './figma/mock/mock-relay.ts';
import { MOCK_FIXTURES, MOCK_FILE_KEY } from './figma/mock/fixtures.ts';
import { classify } from './inventory/classify.ts';
import { applyReview, approveManifest, buildDraftManifest, buildReviewTemplate, verifyMasterUnchanged } from './inventory/manifest.ts';
import { renderManifestReview } from './report/review-md.ts';

const USAGE = `pcb <comando> [opciones]

  read-request   --file-key K --node-id N [--out F]      Genera la petición use_figma de SOLO LECTURA
  ingest         --raw F --file-key K --node-id N --source mcp|mock --out DIR
  mock-read      --fixture base|missing-font|read-error --out DIR    (MOCK)
  inventory      --snapshot F --config F --out DIR       Manifiesto borrador + review.md + plantilla
  review-apply   --manifest F --review F --config F --out F
  approve        --manifest F --snapshot F --config F --by NOMBRE --out F
  verify-master  --manifest F --approved-snapshot F --current-snapshot F`;

const opts = {
  'file-key': { type: 'string' },
  'node-id': { type: 'string' },
  out: { type: 'string' },
  raw: { type: 'string' },
  source: { type: 'string' },
  fixture: { type: 'string' },
  snapshot: { type: 'string' },
  config: { type: 'string' },
  manifest: { type: 'string' },
  review: { type: 'string' },
  by: { type: 'string' },
  'approved-snapshot': { type: 'string' },
  'current-snapshot': { type: 'string' },
} as const;

function need(v: string | undefined, name: string): string {
  if (!v) throw new Error(`Falta --${name}\n\n${USAGE}`);
  return v;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function loadConfig(path: string): Promise<ProjectConfig> {
  const cfg = parseOrThrow(ProjectConfigSchema, await readJson(path), 'config');
  const issues = checkConfigSemantics(cfg);
  if (issues.length > 0) throw new Error(`config: ${issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`);
  return cfg;
}

const loadSnapshot = async (p: string): Promise<MasterSnapshot> => parseOrThrow(MasterSnapshotSchema, await readJson(p), 'snapshot');
const loadManifest = async (p: string): Promise<Manifest> => parseOrThrow(ManifestSchema, await readJson(p), 'manifest');

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values: a } = parseArgs({ args: rest, options: opts, strict: true });
  const now = new Date().toISOString();

  switch (cmd) {
    case 'read-request': {
      const req = buildReadRequest(need(a['file-key'], 'file-key'), need(a['node-id'], 'node-id'));
      if (a.out) await writeJson(a.out, req);
      else process.stdout.write(`${JSON.stringify(req, null, 2)}\n`);
      return 0;
    }
    case 'mock-read': {
      const name = need(a.fixture, 'fixture');
      const spec = MOCK_FIXTURES[name]?.();
      if (!spec) throw new Error(`Fixture desconocido: ${name}`);
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      const { rawText, violations } = await mockReadRaw(spec);
      if (violations.length > 0) throw new Error(`El script intentó escribir (MOCK): ${violations.join('; ')}`);
      await writeFile(join(out, 'raw-response.MOCK.txt'), rawText, 'utf8');
      console.log(`MOCK: respuesta escrita en ${join(out, 'raw-response.MOCK.txt')} (fileKey ${MOCK_FILE_KEY}, raíz ${spec.id})`);
      return 0;
    }
    case 'ingest': {
      const source = need(a.source, 'source');
      if (source !== 'mcp' && source !== 'mock') throw new Error('--source debe ser mcp o mock');
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      const rawPath = resolve(need(a.raw, 'raw'));
      // Conserva la respuesta original byte a byte junto a la instantánea.
      const keptRaw = join(out, source === 'mock' ? 'raw-response.MOCK.txt' : 'raw-response.txt');
      if (resolve(keptRaw) !== rawPath) await copyFile(rawPath, keptRaw);
      const r = ingestReadResponse({
        rawText: await readFile(rawPath, 'utf8'),
        fileKey: need(a['file-key'], 'file-key'),
        expectedRootNodeId: need(a['node-id'], 'node-id'),
        source: source === 'mock' ? 'MOCK' : 'FIGMA_MCP_USE_FIGMA',
        rawResponsePath: keptRaw,
      });
      if (!r.ok) {
        console.error(r.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
        return 2;
      }
      await writeJson(join(out, 'snapshot.json'), r.snapshot);
      r.warnings.forEach((w) => console.warn(`AVISO: ${w}`));
      console.log(`Instantánea ${r.snapshot.source}: ${r.snapshot.nodes.length} nodos · ${r.snapshot.fingerprints.master}`);
      return 0;
    }
    case 'inventory': {
      const snap = await loadSnapshot(need(a.snapshot, 'snapshot'));
      const cfg = await loadConfig(need(a.config, 'config'));
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      const manifest = buildDraftManifest(snap, classify(snap, cfg), cfg, now);
      await writeJson(join(out, 'manifest.draft.json'), manifest);
      await writeJson(join(out, 'review.template.json'), buildReviewTemplate(manifest));
      await writeFile(join(out, 'review.md'), renderManifestReview(manifest, snap), 'utf8');
      const pending = manifest.dispositions.filter((d) => d.kind === 'pending').length;
      console.log(`${snap.source}: ${manifest.entities.length} entidades, ${pending} nodos pendientes, ${manifest.compositions.length} composiciones → ${out}`);
      return 0;
    }
    case 'review-apply': {
      const m = await loadManifest(need(a.manifest, 'manifest'));
      const review = parseOrThrow(ReviewDecisionsSchema, await readJson(need(a.review, 'review')), 'review');
      const r = applyReview(m, review, await loadConfig(need(a.config, 'config')), now);
      if (!r.ok) {
        console.error(r.issues.map((i) => `${i.code}: ${i.message}`).join('\n'));
        return 2;
      }
      await writeJson(need(a.out, 'out'), r.manifest);
      return 0;
    }
    case 'approve': {
      const r = approveManifest(
        await loadManifest(need(a.manifest, 'manifest')),
        await loadSnapshot(need(a.snapshot, 'snapshot')),
        await loadConfig(need(a.config, 'config')),
        need(a.by, 'by'),
        now,
      );
      if (!r.ok) {
        console.error(`Aprobación rechazada:\n${r.issues.map((i) => `  ${i.code}: ${i.message}`).join('\n')}`);
        return 2;
      }
      await writeJson(need(a.out, 'out'), r.manifest);
      console.log(`Aprobado: ${r.manifest.manifestHash}`);
      return 0;
    }
    case 'verify-master': {
      const v = verifyMasterUnchanged(
        await loadManifest(need(a.manifest, 'manifest')),
        await loadSnapshot(need(a['approved-snapshot'], 'approved-snapshot')),
        await loadSnapshot(need(a['current-snapshot'], 'current-snapshot')),
      );
      console.log(JSON.stringify(v, null, 2));
      return v.unchanged ? 0 : 3;
    }
    default:
      console.log(USAGE);
      return cmd ? 1 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(err.message);
    process.exit(1);
  },
);
