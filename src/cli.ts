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
import { AdaptJobSchema, DemoAcceptanceSchema } from './contracts/demo.ts';
import { buildAcceptance, compareMasters, layoutSummary, precheckPlan, remapNodeIds, remapProposals } from './demo/tools.ts';
import { sha256Hex } from './hash/canonical.ts';
import { extractEnvelope } from './figma/ingest-envelope.ts';
import { checkDemo } from './demo/check.ts';
import { compareNodeDigests } from './figma/digests.ts';
import { buildSafeZoneTemplateScript, resolveSafeZoneTemplate, SAFE_ZONE_TEMPLATES_SCHEMA_ID, type SafeZoneTemplates } from './figma/safe-zone-template.ts';
import { runDoctor } from './doctor.ts';
import { readingFlow } from './demo/attention.ts';
import { buildTextCapabilitiesScript, summarizeTextCapabilities, TEXT_CAPABILITIES_SCHEMA_ID, type TextCapabilities } from './figma/text-capabilities.ts';
import { fontRequiredNodeIds } from './figma/adapt-script.ts';
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

  ADAPTACIÓN (skill .claude/skills/adapt-master-creative; nada de esto es aprobación de producción):
  job-check      --job F                                 Valida el trabajo (maestra, destinos, composiciones)
  layout-summary --snapshot F [--depth N]                Cajas relativas al frame para componer un destino
  precheck       --plan F --composition F --snapshot F   Predicción sobre el plan (sin tocar Figma)
  compare-masters --snapshot A --current-snapshot B --out F   ¿Misma maestra en otro archivo? + correspondencia de ids
  remap          --id-map F --composition F|--proposals F [--manifest F] --out F   Traduce ids con una correspondencia
  verify-sent    --request F [--request F2 ...] --calls F   El script enviado == el generado (SHA-256)
  record-acceptance --clone-snapshot F --composition F --plan F --checks F --by NOMBRE --scope TEXTO --file-key K --out F
  proposals-check --manifest F --proposals F --config F    Valida las propuestas del agente contra el borrador
  demo-plan      --snapshot F --composition F [--config F] --out F   Plan exacto y comprobación previa (--config obligatorio
                 si edita texto o escala el logo: límites de texto del proyecto)
  adapt-request  --plan F --composition F --file-key K --clone-name N [--mode patch --existing-clone-id ID | --mode copy --source-clone-id ID] --out F
                 Script de ESCRITURA sobre un clon ('patch' actualiza el clon existente sin duplicar la salida;
                 'copy' duplica un clon existente tal cual y adapta solo la copia)
  vector-probe-request --file-key K --frame-id ID --node-id N [--node-id N2 ...] --out F   Sonda vectorial (solo lectura)
  digests-compare --master-raw F [--master-raw F2 ...] --digests F   ¿La maestra releída es idéntica al inventario?
  demo-check     --snapshot F --clone-snapshot F --adapt-result F --plan F --composition F --config F
                 --master-raw F... --digests F [--visual F] [--vector-before F --vector-after F] --meta F --out DIR

  PILOTO:
  doctor         [--config F]                            Comprobación de entorno y capacidades (no instala ni escribe)
  attention-flow --clone-snapshot F --adapt-result F --composition F --out F   Recorrido de lectura y notas heurísticas
                 (después: scripts/attention-overlay.py dibuja la superposición separada de la creatividad)
  text-capabilities-request --file-key K --node-id N [--node-id N2 ...] --out F   Fuentes y APIs de edición (solo lectura)
  text-capabilities-check --raw F [--plan F]             ¿Se pueden ejecutar las ediciones de texto / logo del plan?
  safe-zone-template-request --file-key K --node-id N --out F   Lee (solo lectura) las plantillas de safe zone de Figma
  safe-zone-resolve --raw F --width W --height H --provenance client|internal|platform_official
                 [--template-hint TXT] [--layer-hint TXT] --out F
                 Elige la plantilla SOLO por tamaño exacto; 'none' o 'ambiguous' ⇒ no se aplica y se pregunta`;

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
  'source-clone-id': { type: 'string' },
  'frame-id': { type: 'string' },
  'vector-before': { type: 'string' },
  'vector-after': { type: 'string' },
  job: { type: 'string' },
  depth: { type: 'string' },
  'id-map': { type: 'string' },
  request: { type: 'string', multiple: true },
  calls: { type: 'string' },
  checks: { type: 'string' },
  scope: { type: 'string' },
  notes: { type: 'string' },
  width: { type: 'string' },
  height: { type: 'string' },
  provenance: { type: 'string' },
  'template-hint': { type: 'string' },
  'layer-hint': { type: 'string' },
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
      if ((comp.textEdits.length > 0 || comp.logoPolicy.mode === 'experimental') && !a.config) throw new Error('Esta composición edita texto o escala el logo: indica --config (límites de texto del proyecto)');
      const r = buildDemoPlan(snap, comp, a.config ? { textPolicy: (await loadConfig(a.config)).textPolicy } : {});
      if (!r.ok) {
        console.error(`Composición rechazada:\n${r.issues.map((i) => `  ${i}`).join('\n')}`);
        return 2;
      }
      await writeJson(need(a.out, 'out'), r.plan);
      console.log(r.plan.moves.map((m) => `${m.unitId}: dx=${m.dx} dy=${m.dy}`).join('\n'));
      if (r.plan.logo.mode === 'experimental') console.log(`LOGO EXPERIMENTAL ×${r.plan.logo.scale} (${r.plan.logo.authorization})`);
      for (const e of r.plan.textEdits) console.log(`texto ${e.nodeId}: ${[e.box && `caja ${e.box.width}×${e.box.height ?? 'auto'}`, e.align, e.lineBreaks && 'saltos de línea', e.fontScale !== null && `cuerpo ×${e.fontScale}`, e.lineHeight && `interlineado ${e.lineHeight.value}${e.lineHeight.unit === 'PIXELS' ? 'px' : '%'}`].filter(Boolean).join(', ')}`);
      const req = fontRequiredNodeIds(r.plan);
      if (req.length) console.log(`Fuentes que deben cargarse antes de escribir (comprobar con text-capabilities-request): ${req.join(', ')}`);
      return 0;
    }
    case 'adapt-request': {
      const plan = (await readJson(need(a.plan, 'plan'))) as DemoPlan;
      const comp = parseOrThrow(DemoCompositionSchema, await readJson(need(a.composition, 'composition')), 'composition');
      const mode = a.mode === 'patch' ? 'patch' : a.mode === 'copy' ? 'copy' : 'create';
      // Un resultado con el logo escalado se identifica SIEMPRE como experimental en el propio nombre del clon.
      let cloneName = need(a['clone-name'], 'clone-name');
      if (plan.logo?.mode === 'experimental' && !/EXPERIMENTAL/.test(cloneName)) cloneName = `${cloneName} · LOGO EXPERIMENTAL ×${plan.logo.scale}`;
      const codeText = buildAdaptScript(plan, {
        sectionName: comp.output.sectionName, cloneName, gapFromContentPx: comp.output.gapFromContentPx,
        mode, existingCloneId: mode === 'patch' ? need(a['existing-clone-id'], 'existing-clone-id') : undefined,
        sourceCloneId: mode === 'copy' ? need(a['source-clone-id'], 'source-clone-id') : undefined,
      });
      await writeJson(need(a.out, 'out'), {
        tool: 'use_figma', fileKey: need(a['file-key'], 'file-key'), scriptVersion: ADAPT_SCRIPT_VERSION, writesOnlyClone: true,
        mode,
        description: mode === 'patch'
          ? `DEMO (actualización): aplica las ediciones de decoración del plan SOLO sobre el clon existente ${a['existing-clone-id']}. La maestra no se modifica.`
          : mode === 'copy'
          ? `DEMO (copia): duplica el clon ${a['source-clone-id']} tal cual (sin modificarlo) y adapta SOLO la copia a ${plan.target.width}×${plan.target.height}. La maestra no se modifica.`
          : `DEMO: clona ${plan.masterNodeId} en una sección de salida y adapta SOLO el clon a ${plan.target.width}×${plan.target.height}. La maestra no se modifica.`,
        code: codeText,
      });
      return 0;
    }
    case 'job-check': {
      const jobPath = need(a.job, 'job');
      const job = parseOrThrow(AdaptJobSchema, await readJson(jobPath), 'job');
      await loadConfig(resolve(jobPath, '..', job.configPath));
      const issues: string[] = [];
      for (const d of job.destinations) {
        const cp = resolve(jobPath, '..', d.compositionPath);
        try {
          const comp = parseOrThrow(DemoCompositionSchema, await readJson(cp), d.compositionPath);
          if (comp.target.width !== d.width || comp.target.height !== d.height) issues.push(`${d.id}: la composición es ${comp.target.width}×${comp.target.height}`);
          console.log(`${d.id} ${d.width}×${d.height} · ${d.status} · ${comp.safeArea.kind} · ${comp.units.length} bloques, ${comp.effectResizes.length} efectos, ${comp.vectorEdits.length} ediciones vectoriales`);
        } catch (e) {
          issues.push(`${d.id}: ${(e as Error).message.split('\n')[0]}`);
        }
      }
      if (issues.length) { console.error(issues.join('\n')); return 2; }
      return 0;
    }
    case 'layout-summary': {
      const snap = await loadSnapshot(need(a.snapshot, 'snapshot'));
      for (const r of layoutSummary(snap, a.depth ? Number(a.depth) : 2)) {
        const b = r.rect ? `${Math.round(r.rect.x)},${Math.round(r.rect.y)} ${Math.round(r.rect.width)}×${Math.round(r.rect.height)}` : '—';
        console.log(`${'  '.repeat(r.depth)}${r.id.padEnd(9)} ${r.type.padEnd(10)} ${b.padEnd(24)} ${r.text ? 'T' : ' '}${r.image ? 'I' : ' '}${r.mask ? 'M' : ' '} ${JSON.stringify(r.name)}`);
      }
      return 0;
    }
    case 'precheck': {
      const plan = (await readJson(need(a.plan, 'plan'))) as DemoPlan;
      const comp = parseOrThrow(DemoCompositionSchema, await readJson(need(a.composition, 'composition')), 'composition');
      const snap = await loadSnapshot(need(a.snapshot, 'snapshot'));
      const f = precheckPlan(plan, comp, snap.nodes.filter((n) => n.text).map((n) => n.id));
      if (f.length === 0) console.log('Predicción sin incidencias (revisar igualmente la captura del clon).');
      for (const x of f) console.log(`${x.code.padEnd(28)} ${x.nodeId}  ${x.detail}`);
      return f.length ? 3 : 0;
    }
    case 'compare-masters': {
      const cmp = compareMasters(await loadSnapshot(need(a.snapshot, 'snapshot')), await loadSnapshot(need(a['current-snapshot'], 'current-snapshot')));
      await writeJson(need(a.out, 'out'), cmp);
      console.log(cmp.identical ? `Idénticas sin ids (${cmp.idMap.length} nodos).` : `${cmp.diffs.length} diferencia(s); ver ${a.out}`);
      return cmp.identical ? 0 : 3;
    }
    case 'remap': {
      const map = ((await readJson(need(a['id-map'], 'id-map'))) as { idMap?: Array<[string, string]> });
      const idMap = Array.isArray(map) ? (map as Array<[string, string]>) : map.idMap ?? [];
      if (a.composition) {
        const comp = parseOrThrow(DemoCompositionSchema, await readJson(a.composition), 'composition');
        await writeJson(need(a.out, 'out'), remapNodeIds(comp, idMap));
      } else {
        const p = parseOrThrow(AgentProposalsSchema, await readJson(need(a.proposals, 'proposals')), 'proposals');
        await writeJson(need(a.out, 'out'), remapProposals(p, idMap, await loadManifest(need(a.manifest, 'manifest'))));
      }
      return 0;
    }
    case 'verify-sent': {
      const calls = (await readJson(need(a.calls, 'calls'))) as { calls: Array<{ scriptSha256: string; isError: boolean }> };
      const gen = await Promise.all((a.request ?? []).map(async (f) => sha256Hex(((await readJson(f)) as { code: string }).code)));
      const bad = calls.calls.filter((c) => !gen.includes(c.scriptSha256));
      console.log(`${calls.calls.length} llamada(s); ${calls.calls.length - bad.length} con script idéntico al generado; ${calls.calls.filter((c) => c.isError).length} con error.`);
      return bad.length ? 3 : 0;
    }
    case 'record-acceptance': {
      const clone = await loadSnapshot(need(a['clone-snapshot'], 'clone-snapshot'));
      const checksText = await readFile(need(a.checks, 'checks'), 'utf8');
      const acc = buildAcceptance({
        acceptedBy: need(a.by, 'by'), acceptedAt: now, scope: need(a.scope, 'scope'), notes: a.notes ?? null,
        fileKey: need(a['file-key'], 'file-key'), clone,
        compositionText: await readFile(need(a.composition, 'composition'), 'utf8'),
        planText: await readFile(need(a.plan, 'plan'), 'utf8'),
        checksText, checksAggregate: (JSON.parse(checksText) as { aggregate: { status: string } }).aggregate.status,
      });
      await writeJson(need(a.out, 'out'), parseOrThrow(DemoAcceptanceSchema, acc, 'acceptance'));
      console.log(`Aceptación registrada para ${acc.cloneId} (${acc.target.width}×${acc.target.height}) por el nombre declarado ${JSON.stringify(acc.acceptedBy)}. Alcance: ${acc.scope}`);
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
    case 'doctor': {
      const root = resolve(import.meta.dirname, '..');
      const items = runDoctor(root);
      const cfgPath = a.config ?? join(root, 'config', 'example.project.json');
      try { await loadConfig(cfgPath); items.push({ id: 'config', level: 'ok', message: `Configuración válida: ${cfgPath}` }); }
      catch (e) { items.push({ id: 'config', level: 'error', message: `Configuración no válida (${cfgPath}): ${(e as Error).message.split('\n')[0]}` }); }
      const mark = { ok: '✓', warn: '!', error: '✗', info: 'i' } as const;
      for (const it of items) console.log(`${mark[it.level]} ${it.id.padEnd(7)} ${it.message}`);
      return items.some((i) => i.level === 'error') ? 1 : 0;
    }
    case 'safe-zone-template-request': {
      const ids = a['node-id'] ?? [];
      if (ids.length !== 1) throw new Error('Indica un único --node-id (sección o frame con las plantillas)');
      await writeJson(need(a.out, 'out'), {
        tool: 'use_figma', fileKey: need(a['file-key'], 'file-key'), readOnly: true,
        description: `Solo lectura: plantillas de safe zone bajo ${ids[0]} (tamaños, capas y formas en coordenadas de cada plantilla).`,
        code: buildSafeZoneTemplateScript(ids[0]!),
      });
      return 0;
    }
    case 'safe-zone-resolve': {
      const raws = a.raw ?? [];
      if (raws.length !== 1) throw new Error('Indica una única --raw (respuesta de safe-zone-template-request)');
      const ext = extractEnvelope(await readFile(raws[0]!, 'utf8'), SAFE_ZONE_TEMPLATES_SCHEMA_ID);
      if ('code' in ext) throw new Error(`${raws[0]}: ${ext.message}`);
      const inv = ext.value as SafeZoneTemplates;
      const prov = need(a.provenance, 'provenance');
      if (!['client', 'internal', 'platform_official'].includes(prov)) throw new Error('--provenance debe ser client, internal o platform_official');
      const dest = { width: Number(need(a.width, 'width')), height: Number(need(a.height, 'height')) };
      const res = resolveSafeZoneTemplate(inv, dest, { template: a['template-hint'], layer: a['layer-hint'] });
      const fileKey = a['file-key'] ?? null;
      const safeArea = res.status === 'applicable' && res.chosen && res.allowed ? {
        kind: 'safe_zone_rule', ruleId: `figma:${res.chosen.templateId}/${res.chosen.layerId}`, version: 'plantilla leída en esta ejecución',
        provenance: prov, allowed: res.allowed, exclusions: res.exclusions,
        note: `Plantilla «${res.chosen.templateName}», capa «${res.chosen.layerName}» de ${inv.sourceName} (${inv.sourceNodeId}).`,
        source: fileKey ? { fileKey, nodeId: inv.sourceNodeId, templateNodeId: res.chosen.templateId, layerNodeId: res.chosen.layerId } : null,
      } : null;
      await writeJson(need(a.out, 'out'), { schema: 'pcb.safe-zone-resolution.v1', source: { nodeId: inv.sourceNodeId, name: inv.sourceName, type: inv.sourceType, page: inv.page }, provenance: prov, ...res, safeArea });
      console.log(`${res.status}: ${res.reason}`);
      return res.status === 'applicable' ? 0 : res.status === 'none' ? 4 : 5;
    }
    case 'attention-flow': {
      const clone = await loadSnapshot(need(a['clone-snapshot'], 'clone-snapshot'));
      const res = parseOrThrow(AdaptResultSchema, await readJson(need(a['adapt-result'], 'adapt-result')), 'adapt-result');
      const comp = parseOrThrow(DemoCompositionSchema, await readJson(need(a.composition, 'composition')), 'composition');
      if (!comp.messagePlan) throw new Error('La composición no tiene messagePlan (mensaje principal, persona/producto y recorrido previsto)');
      const flow = readingFlow(clone, res.idMap, comp.messagePlan);
      await writeJson(need(a.out, 'out'), flow);
      console.log(`${flow.elements.length} pasos · ${flow.notes.length} observación(es) heurística(s). ${flow.disclaimer}`);
      for (const n of flow.notes) console.log(`  - ${n}`);
      return 0;
    }
    case 'text-capabilities-request': {
      const ids = a['node-id'] ?? [];
      if (ids.length === 0) throw new Error('Falta --node-id (textos que se editarán y/o raíz del logo experimental)');
      await writeJson(need(a.out, 'out'), {
        tool: 'use_figma', fileKey: need(a['file-key'], 'file-key'), readOnly: true,
        description: `Solo lectura: fuentes y capacidades de edición de ${ids.join(', ')} (no modifica el documento).`,
        code: buildTextCapabilitiesScript(ids),
      });
      return 0;
    }
    case 'text-capabilities-check': {
      const raws = a.raw ?? [];
      if (raws.length !== 1) throw new Error('Indica una única --raw (respuesta de text-capabilities-request)');
      const ext = extractEnvelope(await readFile(raws[0]!, 'utf8'), TEXT_CAPABILITIES_SCHEMA_ID);
      if ('code' in ext) throw new Error(`${raws[0]}: ${ext.message}`);
      const caps = ext.value as TextCapabilities;
      const plan = a.plan ? ((await readJson(a.plan)) as DemoPlan) : null;
      const apis = plan ? [...(plan.textEdits.length ? ['setRangeFontSize', 'setRangeLineHeight', 'resize', ...(plan.textEdits.some((e) => e.lineBreaks) ? ['insertCharacters', 'deleteCharacters'] : [])] : []), ...(plan.logo.mode === 'experimental' ? ['rescale'] : [])] : [];
      const sum = summarizeTextCapabilities(caps, apis);
      for (const l of sum.lines) console.log(l);
      console.log(sum.ok ? 'Se puede ejecutar.' : 'NO se puede ejecutar tal cual en este entorno (ver arriba); no se sustituye ninguna fuente.');
      return sum.ok ? 0 : 6;
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
