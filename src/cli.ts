#!/usr/bin/env node
// CLI. Ningún comando escribe en Figma: adapt-request solo GENERA el script de escritura sobre un clon (DEMO).
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseOrThrow } from './contracts/schema.ts';
import { ProjectConfigSchema, checkConfigSemantics, type ProjectConfig } from './contracts/config.ts';
import { MasterSnapshotSchema, type MasterSnapshot } from './contracts/snapshot.ts';
import { ManifestSchema, ReviewDecisionsSchema, type Manifest } from './contracts/manifest.ts';
import { buildReadRequest, DEFAULT_CHUNK_BYTE_BUDGET } from './figma/read-script.ts';
import { buildDiscoverRequest } from './figma/discover-script.ts';
import { resolveFromDiscovery } from './figma/resolve-master.ts';
import { EntryRefSchema, type EntryRef } from './contracts/discovery.ts';
import { ingestReadResponses } from './figma/ingest.ts';
import { mockReadRaw } from './figma/mock/mock-relay.ts';
import { MOCK_FIXTURES, MOCK_FILE_KEY } from './figma/mock/fixtures.ts';
import { classify } from './inventory/classify.ts';
import { applyReview, approveManifest, buildDraftManifest, buildReviewTemplate, verifyMasterUnchanged } from './inventory/manifest.ts';
import { renderManifestReview } from './report/review-md.ts';
import { AdaptResultSchema, AgentProposalsSchema, DemoCompositionSchema } from './contracts/demo.ts';
import { validateProposals } from './inventory/proposals.ts';
import { buildDemoPlan, type DemoPlan } from './demo/plan.ts';
import { buildAdaptScript, ADAPT_SCRIPT_VERSION } from './figma/adapt-script.ts';
import { buildVectorProbeScript } from './figma/vector-probe.ts';
import { extractEnvelope } from './figma/ingest-envelope.ts';
import { checkDemo } from './demo/check.ts';
import { compareNodeDigests } from './figma/digests.ts';
import { assembleChunks } from './figma/chunks.ts';
import { renderDemoReport, type DemoReportMeta } from './report/demo-md.ts';
import type { CheckStatus, Finding } from './contracts/validation.ts';

const USAGE = `pcb <comando> [opciones]

  read-request   --file-key K --node-id N [--root-type FRAME] [--chunk-index I] [--byte-budget B] [--out F]\n                 Petición use_figma de SOLO LECTURA para un fragmento
  discover-request --file-key K --entry-node-id E --target-name NOMBRE [--out F]   Descubrimiento de SOLO LECTURA
  resolve        --raw F --file-key K --entry-node-id E --target-name NOMBRE --out F   entryNodeId → masterNodeId
  ingest         --raw F [--raw F2 ...] --file-key K --node-id N --source mcp|mock [--root-type FRAME] [--discovery F] --out DIR\n                 (una --raw por fragmento, en cualquier orden)
  mock-read      --fixture base|missing-font|read-error|section [--byte-budget B] --out DIR    (MOCK)
  inventory      --snapshot F --config F --out DIR       Manifiesto borrador + review.md + plantilla
  review-apply   --manifest F --review F --config F --out F
  approve        --manifest F --snapshot F --config F --by NOMBRE --out F
                 (--by registra un nombre declarado; NO autentica a la persona)
  verify-master  --manifest F --approved-snapshot F --current-snapshot F

  DEMO (primera adaptación; nada de esto es aprobación de producción):
  proposals-check --manifest F --proposals F --config F    Valida las propuestas del agente contra el borrador
  demo-plan      --snapshot F --composition F --out F      Plan exacto (traslaciones/efectos) y comprobación previa
  adapt-request  --plan F --composition F --file-key K --clone-name N [--mode patch --existing-clone-id ID] --out F
                 Script de ESCRITURA sobre un clon ('patch' actualiza el clon existente sin duplicar la salida)
  vector-probe-request --file-key K --frame-id ID --node-id N [--node-id N2 ...] --out F   Sonda vectorial (solo lectura)
  digests-compare --master-raw F [--master-raw F2 ...] --digests F   ¿La maestra releída es idéntica al inventario?
  demo-check     --snapshot F --clone-snapshot F --adapt-result F --plan F --composition F --config F
                 --master-raw F... --digests F [--visual F] [--vector-before F --vector-after F] --meta F --out DIR`;

const opts = {
  'file-key': { type: 'string' },
  'node-id': { type: 'string', multiple: true },
  'root-type': { type: 'string' },
  'entry-node-id': { type: 'string' },
  'target-name': { type: 'string' },
  discovery: { type: 'string' },
  out: { type: 'string' },
  raw: { type: 'string', multiple: true },
  'chunk-index': { type: 'string' },
  'byte-budget': { type: 'string' },
  mode: { type: 'string' },
  'full-node-id': { type: 'string', multiple: true },
  source: { type: 'string' },
  fixture: { type: 'string' },
  snapshot: { type: 'string' },
  config: { type: 'string' },
  manifest: { type: 'string' },
  review: { type: 'string' },
  by: { type: 'string' },
  'approved-snapshot': { type: 'string' },
  'current-snapshot': { type: 'string' },
  proposals: { type: 'string' },
  composition: { type: 'string' },
  plan: { type: 'string' },
  'clone-snapshot': { type: 'string' },
  'adapt-result': { type: 'string' },
  digests: { type: 'string' },
  visual: { type: 'string' },
  meta: { type: 'string' },
  'master-raw': { type: 'string', multiple: true },
  'clone-name': { type: 'string' },
  'existing-clone-id': { type: 'string' },
  'frame-id': { type: 'string' },
  'vector-before': { type: 'string' },
  'vector-after': { type: 'string' },
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
async function loadResolvedEntry(path: string): Promise<EntryRef> {
  const d = (await readJson(path)) as { resolution?: { status?: string; entry?: unknown } };
  if (d.resolution?.status !== 'resolved') throw new Error('El descubrimiento no está resuelto; no se puede enlazar la entrada.');
  return parseOrThrow(EntryRefSchema, d.resolution.entry, 'discovery.entry');
}

const tag = (source: string): string => (source === 'MOCK' ? '[MOCK] ' : '');
const loadManifest = async (p: string): Promise<Manifest> => parseOrThrow(ManifestSchema, await readJson(p), 'manifest');

async function assembledPayload(paths: string[]): Promise<string> {
  if (paths.length === 0) throw new Error('Falta --master-raw (respuestas originales de la lectura del inventario)');
  const r = assembleChunks(await Promise.all(paths.map(async (p) => ({ rawText: await readFile(p, 'utf8'), rawResponsePath: p }))));
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
  return r.value.payload;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values: a } = parseArgs({ args: rest, options: opts, strict: true });
  const now = new Date().toISOString();

  switch (cmd) {
    case 'read-request': {
      const req = buildReadRequest(need(a['file-key'], 'file-key'), need(a['node-id']?.[0], 'node-id'), {
        requiredRootType: a['root-type'] ?? 'FRAME',
        chunkIndex: a['chunk-index'] ? Number(a['chunk-index']) : 0,
        byteBudget: a['byte-budget'] ? Number(a['byte-budget']) : DEFAULT_CHUNK_BYTE_BUDGET,
        mode: a.mode === 'node-digests' ? 'node-digests' : 'chunk',
        fullNodeIds: a['full-node-id'] ?? [],
      });
      if (a.out) await writeJson(a.out, req);
      else process.stdout.write(`${JSON.stringify(req, null, 2)}\n`);
      return 0;
    }
    case 'discover-request': {
      const req = buildDiscoverRequest(need(a['file-key'], 'file-key'), need(a['entry-node-id'], 'entry-node-id'), need(a['target-name'], 'target-name'));
      if (a.out) await writeJson(a.out, req);
      else process.stdout.write(`${JSON.stringify(req, null, 2)}\n`);
      return 0;
    }
    case 'resolve': {
      const r = resolveFromDiscovery({
        rawText: await readFile(need(a.raw?.[0], 'raw'), 'utf8'),
        fileKey: need(a['file-key'], 'file-key'),
        entryNodeId: need(a['entry-node-id'], 'entry-node-id'),
        targetName: need(a['target-name'], 'target-name'),
        requiredRootType: a['root-type'] ?? 'FRAME',
      });
      if (!r.ok) {
        console.error(r.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
        return 2;
      }
      await writeJson(need(a.out, 'out'), { resolution: r.resolution, discovery: r.payload, digest: r.digest, rawSha256: r.rawSha256 });
      console.log(`Resolución: ${r.resolution.status}${r.resolution.status === 'resolved' ? ` → masterNodeId ${r.resolution.entry.masterNodeId} (${r.resolution.entry.method})` : ''}`);
      return r.resolution.status === 'resolved' ? 0 : 4;
    }
    case 'mock-read': {
      const name = need(a.fixture, 'fixture');
      const spec = MOCK_FIXTURES[name]?.();
      if (!spec) throw new Error(`Fixture desconocido: ${name}`);
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      const { rawTexts, violations } = await mockReadRaw(spec, a['byte-budget'] ? { byteBudget: Number(a['byte-budget']) } : {});
      if (violations.length > 0) throw new Error(`El script intentó escribir (MOCK): ${violations.join('; ')}`);
      for (const [i, text] of rawTexts.entries()) await writeFile(join(out, `raw-response-${i}.MOCK.txt`), text, 'utf8');
      console.log(`[MOCK] ${rawTexts.length} respuesta(s) escritas en ${out} (fileKey ${MOCK_FILE_KEY}, raíz ${spec.id})`);
      return 0;
    }
    case 'ingest': {
      const source = need(a.source, 'source');
      if (source !== 'mcp' && source !== 'mock') throw new Error('--source debe ser mcp o mock');
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      const raws = a.raw ?? [];
      if (raws.length === 0) throw new Error(`Falta --raw (una por fragmento)\n\n${USAGE}`);
      // Conserva cada respuesta original byte a byte junto a la instantánea.
      const responses = [];
      for (const [i, p] of raws.entries()) {
        const rawPath = resolve(p);
        const kept = join(out, source === 'mock' ? `raw-response-${i}.MOCK.txt` : `raw-response-${i}.txt`);
        if (resolve(kept) !== rawPath) await copyFile(rawPath, kept);
        responses.push({ rawText: await readFile(rawPath, 'utf8'), rawResponsePath: kept });
      }
      const r = ingestReadResponses({
        responses,
        fileKey: need(a['file-key'], 'file-key'),
        expectedRootNodeId: need(a['node-id']?.[0], 'node-id'),
        expectedRootType: a['root-type'] ?? 'FRAME',
        entry: a.discovery ? await loadResolvedEntry(a.discovery) : null,
        source: source === 'mock' ? 'MOCK' : 'FIGMA_MCP_USE_FIGMA',
      });
      if (!r.ok) {
        console.error(r.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
        return 2;
      }
      await writeJson(join(out, 'snapshot.json'), r.snapshot);
      r.warnings.forEach((w) => console.warn(`AVISO: ${w}`));
      console.log(`${tag(r.snapshot.source)}Instantánea ${r.snapshot.source}: ${r.snapshot.nodes.length} nodos · ${r.snapshot.fingerprints.master}`);
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
      console.log(`${tag(snap.source)}${snap.source}: ${manifest.entities.length} entidades, ${pending} nodos pendientes, ${manifest.compositions.length} composiciones → ${out}`);
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
      console.log(`${tag(r.manifest.source)}Aprobado (origen ${r.manifest.source}) por el nombre declarado ${JSON.stringify(r.manifest.approval.approvedBy)}: ${r.manifest.manifestHash}`);
      console.log('Nota: --by registra un nombre; no autentica a ninguna persona.');
      return 0;
    }
    case 'verify-master': {
      const manifest = await loadManifest(need(a.manifest, 'manifest'));
      const current = await loadSnapshot(need(a['current-snapshot'], 'current-snapshot'));
      const v = verifyMasterUnchanged(manifest, await loadSnapshot(need(a['approved-snapshot'], 'approved-snapshot')), current);
      console.log(`${tag(manifest.source)}manifiesto ${manifest.source} · lectura actual ${current.source}`);
      console.log(JSON.stringify(v, null, 2));
      return v.unchanged ? 0 : 3;
    }
    case 'proposals-check': {
      const m = await loadManifest(need(a.manifest, 'manifest'));
      const p = parseOrThrow(AgentProposalsSchema, await readJson(need(a.proposals, 'proposals')), 'proposals');
      const issues = validateProposals(m, p, await loadConfig(need(a.config, 'config')));
      if (issues.length > 0) {
        console.error(issues.map((i) => `${i.code}: ${i.message}`).join('\n'));
        return 2;
      }
      console.log(`Propuestas del agente coherentes con ${m.manifestId}: ${p.roles.length} roles, ${p.groups.length} agrupaciones, ${p.uncertain.length} nodo(s) incierto(s). Estado: agent_proposal (no aprobado).`);
      return 0;
    }
    case 'demo-plan': {
      const snap = await loadSnapshot(need(a.snapshot, 'snapshot'));
      const comp = parseOrThrow(DemoCompositionSchema, await readJson(need(a.composition, 'composition')), 'composition');
      const r = buildDemoPlan(snap, comp);
      if (!r.ok) {
        console.error(`Composición rechazada:\n${r.issues.map((i) => `  ${i}`).join('\n')}`);
        return 2;
      }
      await writeJson(need(a.out, 'out'), r.plan);
      console.log(r.plan.moves.map((m) => `${m.unitId}: dx=${m.dx} dy=${m.dy}`).join('\n'));
      return 0;
    }
    case 'adapt-request': {
      const plan = (await readJson(need(a.plan, 'plan'))) as DemoPlan;
      const comp = parseOrThrow(DemoCompositionSchema, await readJson(need(a.composition, 'composition')), 'composition');
      const mode = a.mode === 'patch' ? 'patch' : 'create';
      const codeText = buildAdaptScript(plan, {
        sectionName: comp.output.sectionName, cloneName: need(a['clone-name'], 'clone-name'), gapFromContentPx: comp.output.gapFromContentPx,
        mode, existingCloneId: mode === 'patch' ? need(a['existing-clone-id'], 'existing-clone-id') : undefined,
      });
      await writeJson(need(a.out, 'out'), {
        tool: 'use_figma', fileKey: need(a['file-key'], 'file-key'), scriptVersion: ADAPT_SCRIPT_VERSION, writesOnlyClone: true,
        mode,
        description: mode === 'patch'
          ? `DEMO (actualización): aplica las ediciones de decoración del plan SOLO sobre el clon existente ${a['existing-clone-id']}. La maestra no se modifica.`
          : `DEMO: clona ${plan.masterNodeId} en una sección de salida y adapta SOLO el clon a ${plan.target.width}×${plan.target.height}. La maestra no se modifica.`,
        code: codeText,
      });
      return 0;
    }
    case 'vector-probe-request': {
      const ids = a['node-id'] ?? [];
      if (ids.length === 0) throw new Error('Falta --node-id');
      await writeJson(need(a.out, 'out'), {
        tool: 'use_figma', fileKey: need(a['file-key'], 'file-key'), readOnly: true,
        description: `Solo lectura: vértices y tiradores de ${ids.join(', ')} en coordenadas del frame ${a['frame-id']}.`,
        code: buildVectorProbeScript(need(a['frame-id'], 'frame-id'), ids),
      });
      return 0;
    }
    case 'digests-compare': {
      const payload = await assembledPayload(a['master-raw'] ?? []);
      const cmp = compareNodeDigests(payload, await readFile(need(a.digests, 'digests'), 'utf8'));
      console.log(JSON.stringify(cmp, null, 2));
      return cmp.equal ? 0 : 3;
    }
    case 'demo-check': {
      const master = await loadSnapshot(need(a.snapshot, 'snapshot'));
      const clone = await loadSnapshot(need(a['clone-snapshot'], 'clone-snapshot'));
      const res = parseOrThrow(AdaptResultSchema, await readJson(need(a['adapt-result'], 'adapt-result')), 'adapt-result');
      const plan = (await readJson(need(a.plan, 'plan'))) as DemoPlan;
      const comp = parseOrThrow(DemoCompositionSchema, await readJson(need(a.composition, 'composition')), 'composition');
      const cfg = await loadConfig(need(a.config, 'config'));
      const digests = a.digests ? compareNodeDigests(await assembledPayload(a['master-raw'] ?? []), await readFile(a.digests, 'utf8')) : null;
      const visual = a.visual ? ((await readJson(a.visual)) as { status: CheckStatus; findings: Finding[] }) : null;
      const meta = (await readJson(need(a.meta, 'meta'))) as Omit<DemoReportMeta, 'cloneId' | 'cloneName' | 'sectionId' | 'fonts'>;
      if (clone.rootNodeId !== res.cloneId) throw new Error('La instantánea del clon no corresponde al resultado de la adaptación');
      const probe = async (f: string | undefined) => {
        if (!f) return null;
        const ext = extractEnvelope(await readFile(f, 'utf8'), 'pcb.vector-probe.v1');
        if ('code' in ext) throw new Error(`${f}: ${ext.message}`);
        return (ext.value as { nodes: Record<string, never> }).nodes;
      };
      const vb = await probe(a['vector-before']), va = await probe(a['vector-after']);
      const rep = checkDemo({ master, clone, idMap: res.idMap, plan, composition: comp, tolerancePx: cfg.tolerances.px, masterDigestsEqual: digests ? digests.equal : null, visual, vectorProbe: vb && va ? { before: vb, after: va } : null });
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      await writeJson(join(out, 'checks.json'), { ...rep, masterDigests: digests });
      await writeFile(join(out, 'report.md'), renderDemoReport(comp, rep, { ...meta, cloneId: res.cloneId, cloneName: res.cloneName, sectionId: res.sectionId, fonts: res.fonts }), 'utf8');
      console.log(`Estado agregado: ${rep.aggregate.status}`);
      for (const r of rep.results) console.log(`  ${r.status.padEnd(13)} ${r.validatorId}${r.findings.length ? ` — ${r.findings.map((f) => f.code).join(', ')}` : ''}`);
      return rep.aggregate.status === 'fail' ? 3 : 0;
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
