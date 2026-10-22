// Comandos brand-* (skill brand-kit-generator). Leen y escriben el brand kit en el conocimiento compartido de clientes
// (client-knowledge/clients/<slug>/: brand.json, guidelines.md, assets/logos) y mantienen su índice (client.json) y su
// CHANGELOG.md. Nada se envía a Figma.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseOrThrow } from '../contracts/schema.ts';
import { BrandSchema, type Brand } from '../contracts/brand.ts';
import { appendChangelog, checkClient, clientPath, loadIndex, recordChange, resolveKnowledgeRoot, validateFile, type KnowledgeFileEntry } from '../knowledge/store.ts';
import { checkBrand } from './check.ts';

export const BRAND_USAGE = `
  BRAND KITS (skill .claude/skills/brand-kit-generator; client-knowledge/clients/<slug>/brand.json; raíz: --root o CLIENT_KNOWLEDGE_ROOT):
  brand-check    --client SLUG [--root DIR]   Coherencia del kit: colores (HEX ↔ RGB), tipografías por rol, logos y sus
                 colores, erratas y preguntas abiertas, más el índice del cliente (0 = listo, 4 = pendientes, 2 = inválido)
  brand-register --client SLUG --note TEXTO [--source TEXTO] [--root DIR]
                 Tras escribir brand.json / guidelines.md: los da de alta en client.json, sube versión y fecha, los deja
                 en borrador y añade la línea al CHANGELOG.md (crea el índice si el cliente es nuevo)
  brand-validate --client SLUG --by NOMBRE --note TEXTO [--root DIR]   Una PERSONA valida el kit (solo sin pendientes)`;

const opts = { client: { type: 'string' }, root: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' }, source: { type: 'string' } } as const;
const need = (v: string | undefined, name: string): string => { if (!v) throw new Error(`Falta --${name}\n${BRAND_USAGE}`); return v; };

/** Carpeta del cliente en el conocimiento compartido (las rutas de logos del kit son relativas a ella). */
export const clientDir = (root: string, slug: string): string => clientPath(root, slug, '.');

/** Lee el brand.json del cliente. No exige índice: sirve también para un alta nueva antes de brand-register. */
export async function loadBrandKit(root: string, slug: string): Promise<Brand> {
  const p = clientPath(root, slug, 'brand.json');
  if (!existsSync(p)) throw new Error(`${slug} no tiene brand.json en ${root} (clients/${slug}/brand.json)`);
  const b = parseOrThrow(BrandSchema, JSON.parse(await readFile(p, 'utf8')), `clients/${slug}/brand.json`);
  if (b.slug !== slug) throw new Error(`clients/${slug}/brand.json declara el slug ${b.slug}`);
  return b;
}

/** Archivos del kit en el índice (alta por defecto; si ya están, se conservan sus temas y descripción). */
const KIT_FILES: Array<Omit<KnowledgeFileEntry, 'source'>> = [
  { id: 'brand', path: 'brand.json', kind: 'brand', channels: ['all'], topics: ['color', 'tipografía', 'logo', 'fotografía', 'maquetación', 'tono', 'reglas', 'lagunas'], load: 'always', description: 'Tokens y reglas de marca (pcb.brand.v1), cada dato con su página del manual' },
  { id: 'guidelines', path: 'guidelines.md', kind: 'guidelines', channels: ['all'], topics: ['logo', 'color', 'tipografía', 'sistema gráfico', 'fotografía', 'maquetación', 'tono de voz', 'lagunas'], load: 'on_demand', description: 'Lectura humana del manual con páginas' },
];

export async function runBrandCommand(cmd: string, rest: string[]): Promise<number> {
  const { values: a } = parseArgs({ args: rest, options: opts, strict: true });
  const root = resolveKnowledgeRoot(a.root);
  switch (cmd) {
    case 'brand-check': {
      const slug = need(a.client, 'client');
      const b = await loadBrandKit(root, slug);
      const chk = await checkBrand(b, clientDir(root, slug));
      const issues: Array<{ code: string; severity: string; message: string }> = [...chk.issues];
      if (existsSync(clientPath(root, slug, 'client.json'))) {
        for (const i of (await checkClient(root, slug)).issues) if (!i.code.startsWith('BRAND_')) issues.push(i);
      } else issues.push({ code: 'NO_CLIENT_INDEX', severity: 'pending', message: `Falta clients/${slug}/client.json: regístralo con brand-register` });
      for (const i of issues) console.log(`${i.severity.padEnd(8)} ${i.code.padEnd(30)} ${i.message}`);
      console.log(`${b.name} (${b.status}): ${b.colors.length} colores, ${b.typography.families.length} familias, ${b.logos.length} logos (${b.logos.filter((l) => l.file).length} con archivo), ${b.gaps.length} lagunas, ${b.openQuestions.filter((q) => q.status === 'open').length} preguntas abiertas.`);
      return issues.some((i) => i.severity === 'blocking') ? 2 : issues.some((i) => i.severity === 'pending') ? 4 : 0;
    }
    case 'brand-register': {
      const slug = need(a.client, 'client');
      const b = await loadBrandKit(root, slug);
      const prev = existsSync(clientPath(root, slug, 'client.json')) ? await loadIndex(root, slug) : null;
      const entries: KnowledgeFileEntry[] = KIT_FILES.filter((e) => existsSync(clientPath(root, slug, e.path)))
        .map((e) => ({ ...e, source: a.source ?? prev?.files.find((f) => f.id === e.id)?.source ?? `brand-kit-generator desde ${b.sources[0]!.label}` }));
      if (b.status === 'validated') {
        // Un kit que cambia deja de estar validado: el índice y brand.json vuelven a borrador a la vez.
        await writeFile(clientPath(root, slug, 'brand.json'), `${JSON.stringify({ ...b, status: 'draft', validation: null }, null, 2)}\n`, 'utf8');
        console.log(`${b.name}: el kit estaba validado; vuelve a borrador hasta que una persona lo valide de nuevo.`);
      }
      const idx = await recordChange(root, slug, entries, need(a.note, 'note'), { name: b.name });
      for (const f of idx.files.filter((x) => entries.some((e) => e.id === x.id))) console.log(`  ${f.id.padEnd(12)} v${f.version} ${f.status}  ${f.path}`);
      const { issues } = await checkClient(root, slug);
      for (const i of issues) console.log(`${i.severity.padEnd(8)} ${i.code.padEnd(30)} ${i.message}`);
      console.log(`${b.name}: registrado en clients/${slug}/client.json y CHANGELOG.md.`);
      return issues.some((i) => i.severity === 'blocking') ? 2 : 0;
    }
    case 'brand-validate': {
      const slug = need(a.client, 'client');
      const b = await loadBrandKit(root, slug);
      const pend = (await checkBrand(b, clientDir(root, slug))).issues.filter((i) => i.severity !== 'warning');
      if (pend.length) throw new Error(`No se puede validar con pendientes:\n${pend.map((i) => `- ${i.message}`).join('\n')}`);
      const by = need(a.by, 'by'), note = need(a.note, 'note');
      // Índice y brand.json se validan juntos (si no, knowledge-check marca STATUS_MISMATCH).
      const idx = await validateFile(root, slug, (await loadIndex(root, slug)).files.find((f) => f.path === 'brand.json')?.id ?? 'brand', by, note);
      const f = idx.files.find((x) => x.path === 'brand.json')!;
      await writeFile(clientPath(root, slug, 'brand.json'), `${JSON.stringify({ ...b, status: 'validated', validation: f.approval }, null, 2)}\n`, 'utf8');
      await appendChangelog(root, slug, `${f.updatedAt} · ${f.id} v${f.version} · Kit validado por ${by}: ${note}.`);
      console.log(`${b.name}: kit validado por ${by}.`);
      return 0;
    }
    default:
      console.log(BRAND_USAGE);
      return 1;
  }
}
