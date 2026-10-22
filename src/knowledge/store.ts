// Acceso al conocimiento compartido de clientes (client-knowledge/). Lo usan todas las skills; ninguna copia datos de
// un cliente dentro de su carpeta. Garantías:
//  - Aislamiento: solo se leen archivos declarados en el índice del cliente y siempre DENTRO de su carpeta (sin rutas
//    absolutas, «..» ni enlaces simbólicos que salgan). Todo identificador (marca, canal) debe ser el mismo slug.
//  - Carga selectiva: knowledge-context carga los archivos `load: always` del canal pedido y solo ANUNCIA los
//    `on_demand` (temas y tamaño) para que la skill lea únicamente lo que necesite.
//  - Trazabilidad: cada archivo cargado queda con su versión, estado y SHA-256 en el contexto del encargo.
//  - Las propuestas (proposals/) nunca se cargan como conocimiento.
import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse, parseOrThrow } from '../contracts/schema.ts';
import { BrandSchema, type Brand } from '../contracts/brand.ts';
import {
  ClientIndexSchema, EmailChannelSchema, KNOWLEDGE_CONTEXT_SCHEMA_ID, KnowledgeProposalSchema, PaidChannelSchema,
  type ClientIndex, type EmailChannel, type KnowledgeFile, type KnowledgeProposal, type PaidChannel,
} from '../contracts/knowledge.ts';
import { checkBrand, confirmedColors } from '../brand/check.ts';
import { sha256Hex } from '../hash/canonical.ts';

export interface KnowledgeIssue { code: string; severity: 'blocking' | 'pending' | 'warning'; message: string }

/** Raíz del conocimiento: --root > CLIENT_KNOWLEDGE_ROOT > <cwd>/client-knowledge > <repo>/client-knowledge. */
export function resolveKnowledgeRoot(explicit?: string): string {
  const candidates = [explicit, process.env.CLIENT_KNOWLEDGE_ROOT, join(process.cwd(), 'client-knowledge'), resolve(import.meta.dirname, '..', '..', 'client-knowledge')];
  for (const c of candidates) if (c && existsSync(join(c, 'clients'))) return resolve(c);
  throw new Error('No encuentro el conocimiento de clientes: usa --root DIR o la variable CLIENT_KNOWLEDGE_ROOT (carpeta que contiene clients/).');
}

const SLUG = /^[a-z][a-z0-9-]*$/;

/** Ruta de un archivo del cliente, verificada para que no salga de su carpeta. */
export function clientPath(root: string, slug: string, rel: string): string {
  if (!SLUG.test(slug)) throw new Error(`Slug de cliente inválido: ${slug}`);
  if (isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`Ruta fuera del cliente ${slug}: ${rel}`);
  const dir = resolve(root, 'clients', slug);
  const p = resolve(dir, rel);
  if (!(p + sep).startsWith(dir + sep) && p !== dir) throw new Error(`Ruta fuera del cliente ${slug}: ${rel}`);
  if (existsSync(p)) {
    const real = realpathSync(p), realDir = realpathSync(dir);
    if (relative(realDir, real).startsWith('..')) throw new Error(`Enlace que sale de la carpeta del cliente ${slug}: ${rel}`);
  }
  return p;
}

export async function listClients(root: string): Promise<ClientIndex[]> {
  const out: ClientIndex[] = [];
  for (const e of await readdir(join(root, 'clients'), { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const p = join(root, 'clients', e.name, 'client.json');
    if (!existsSync(p)) continue;
    const r = parse(ClientIndexSchema, JSON.parse(await readFile(p, 'utf8')));
    if (r.ok) out.push(r.value);
  }
  return out;
}

/** Identifica el cliente de un texto por slug, nombre o alias. Más de uno = ambiguo (se pregunta). */
export function identifyClient(clients: ClientIndex[], text: string): ClientIndex[] {
  const t = text.toLowerCase();
  return clients.filter((c) => [c.slug, c.name, ...c.aliases].some((a) => a.length >= 3 && t.includes(a.toLowerCase())));
}

export async function loadIndex(root: string, slug: string): Promise<ClientIndex> {
  const p = clientPath(root, slug, 'client.json');
  if (!existsSync(p)) throw new Error(`El cliente ${slug} no tiene conocimiento en ${root} (falta clients/${slug}/client.json)`);
  const idx = parseOrThrow(ClientIndexSchema, JSON.parse(await readFile(p, 'utf8')), `clients/${slug}/client.json`);
  if (idx.slug !== slug) throw new Error(`clients/${slug}/client.json declara el slug ${idx.slug}`);
  return idx;
}

const forChannel = (f: KnowledgeFile, channel: string) => f.status !== 'deprecated' && (f.channels.includes('all') || f.channels.includes(channel as never));

export interface LoadedFile { id: string; path: string; kind: string; status: string; version: string; updatedAt: string; sha256: string; bytes: number }

export interface KnowledgeContext {
  schema: typeof KNOWLEDGE_CONTEXT_SCHEMA_ID;
  root: string;
  channel: string;
  client: { slug: string; name: string; status: string; domains: string[]; figmaLibraries: ClientIndex['figma']['libraries']; figmaFiles: ClientIndex['figma']['files'] };
  loaded: LoadedFile[];
  /** Documentación disponible que NO se ha cargado: la skill la lee solo si la necesita. */
  onDemand: Array<{ id: string; path: string; topics: string[]; description: string; bytes: number; status: string }>;
  brand: Brand | null;
  email: EmailChannel | null;
  /** Reglas del canal paid (plantillas del cliente). */
  paid: PaidChannel | null;
  /** SVG de los logos que el canal referencia (para construirlos en Figma). */
  logoSvgs: Record<string, string>;
  issues: KnowledgeIssue[];
  openProposals: string[];
}

/** Carga el contexto de un cliente para un canal. No mezcla clientes: todo sale de clients/<slug>/. */
export async function loadContext(root: string, slug: string, channel: string): Promise<KnowledgeContext> {
  const idx = await loadIndex(root, slug);
  const issues: KnowledgeIssue[] = [];
  const loaded: LoadedFile[] = [], onDemand: KnowledgeContext['onDemand'] = [];
  let brand: Brand | null = null, email: EmailChannel | null = null, paid: PaidChannel | null = null;
  for (const f of idx.files) {
    if (!forChannel(f, channel)) continue;
    const p = clientPath(root, slug, f.path);
    if (!existsSync(p)) { issues.push({ code: 'FILE_MISSING', severity: 'blocking', message: `${f.id}: falta ${f.path}` }); continue; }
    if (f.load === 'on_demand') { onDemand.push({ id: f.id, path: f.path, topics: f.topics, description: f.description, bytes: statSync(p).size, status: f.status }); continue; }
    const raw = await readFile(p, 'utf8');
    loaded.push({ id: f.id, path: f.path, kind: f.kind, status: f.status, version: f.version, updatedAt: f.updatedAt, sha256: sha256Hex(raw), bytes: Buffer.byteLength(raw) });
    if (f.status !== 'validated') issues.push({ code: 'FILE_DRAFT', severity: 'warning', message: `${f.id} (${f.path}) está en borrador: lo que se produzca con él es una propuesta` });
    const json = JSON.parse(raw) as { schema?: string };
    if (json.schema === 'pcb.brand.v1') brand = parseOrThrow(BrandSchema, json, f.path);
    else if (json.schema === 'ck.email.v1') email = parseOrThrow(EmailChannelSchema, json, f.path);
    else if (json.schema === 'ck.paid.v1') paid = parseOrThrow(PaidChannelSchema, json, f.path);
  }
  if (brand && brand.slug !== slug) issues.push({ code: 'BRAND_OTHER_CLIENT', severity: 'blocking', message: `brand.json es de ${brand.slug}, no de ${slug}` });
  if (email && email.client !== slug) issues.push({ code: 'EMAIL_OTHER_CLIENT', severity: 'blocking', message: `channels/email.json es de ${email.client}, no de ${slug}` });
  if (paid && paid.client !== slug) issues.push({ code: 'PAID_OTHER_CLIENT', severity: 'blocking', message: `channels/paid.json es de ${paid.client}, no de ${slug}` });
  if (!brand) issues.push({ code: 'NO_BRAND', severity: 'blocking', message: `${slug} no tiene brand.json cargable para ${channel}` });
  if (channel === 'email' && !email) issues.push({ code: 'NO_EMAIL_CHANNEL', severity: 'warning', message: `${slug} no tiene reglas de email: se usarán los valores por defecto de la skill, declarados` });
  if (channel === 'paid' && !paid) issues.push({ code: 'NO_PAID_CHANNEL', severity: 'warning', message: `${slug} no tiene reglas paid (channels/paid.json): sin plantillas del cliente, solo se puede crear desde cero` });
  if (brand && email) issues.push(...crossCheck(brand, email, idx));
  if (paid) issues.push(...crossCheckPaid(paid, idx));

  const logoSvgs: Record<string, string> = {};
  if (brand && email?.logo) for (const id of [email.logo.logoId, email.logo.darkModeLogoId].filter((x): x is string => !!x)) {
    const l = brand.logos.find((x) => x.id === id);
    if (l?.file?.endsWith('.svg')) {
      const p = clientPath(root, slug, l.file);
      if (existsSync(p)) logoSvgs[id] = await readFile(p, 'utf8');
    }
  }
  const openProposals = await listProposals(root, slug).then((ps) => ps.filter((x) => x.p.status === 'proposed').map((x) => x.file));
  if (openProposals.length) issues.push({ code: 'OPEN_PROPOSALS', severity: 'warning', message: `${openProposals.length} propuesta(s) de cambio sin revisar (no se aplican): ${openProposals.join(', ')}` });
  return {
    schema: KNOWLEDGE_CONTEXT_SCHEMA_ID, root, channel,
    client: { slug, name: idx.name, status: idx.status, domains: idx.domains, figmaLibraries: idx.figma.libraries.filter((l) => l.channels.includes('all') || l.channels.includes(channel as never)), figmaFiles: idx.figma.files },
    loaded, onDemand, brand, email, paid, logoSvgs, issues, openProposals,
  };
}

/** Carga bajo demanda el SVG de un logo de la marca (p. ej. el decidido en el encargo). Solo de la carpeta del cliente. */
export async function withLogoSvg(ctx: KnowledgeContext, logoId: string | null | undefined): Promise<KnowledgeContext> {
  if (!logoId || ctx.logoSvgs[logoId]) return ctx;
  const l = ctx.brand?.logos.find((x) => x.id === logoId);
  if (!l?.file?.endsWith('.svg')) return ctx;
  const p = clientPath(ctx.root, ctx.client.slug, l.file);
  return existsSync(p) ? { ...ctx, logoSvgs: { ...ctx.logoSvgs, [logoId]: await readFile(p, 'utf8') } } : ctx;
}

/** Coherencia entre la marca y el canal email. Las contradicciones se informan; nunca se resuelven en silencio. */
export function crossCheck(brand: Brand, email: EmailChannel, idx: ClientIndex): KnowledgeIssue[] {
  const out: KnowledgeIssue[] = [];
  const brandHex = confirmedColors(brand);
  const ids = new Set<string>();
  for (const c of email.colors) {
    if (ids.has(c.id)) out.push({ code: 'EMAIL_COLOR_DUPLICATE', severity: 'blocking', message: `Color de email repetido: ${c.id}` });
    ids.add(c.id);
    if (c.brandColorId) {
      const b = brand.colors.find((x) => x.id === c.brandColorId);
      if (!b) out.push({ code: 'EMAIL_COLOR_BRAND_UNKNOWN', severity: 'blocking', message: `${c.id} apunta a ${c.brandColorId}, que no está en la paleta de marca` });
      else if (b.hex && b.hex !== c.hex) out.push({ code: 'EMAIL_COLOR_CONFLICT', severity: 'pending', message: `${c.id}: email usa ${c.hex} y la marca define ${b.name} ${b.hex} (${b.source}). Confirmar cuál vale.` });
    } else if (c.status !== 'needs_confirmation' && ![...brandHex.values()].includes(c.hex)) {
      out.push({ code: 'EMAIL_COLOR_NOT_IN_BRAND', severity: 'warning', message: `${c.id} ${c.hex} (${c.status}) no está en la paleta de marca: color propio del canal (${c.source})` });
    }
  }
  const colorRef = (id: string | null | undefined, where: string) => {
    if (id && !ids.has(id)) out.push({ code: 'EMAIL_COLOR_REF_UNKNOWN', severity: 'blocking', message: `${where}: ${id} no es un color de channels/email.json` });
  };
  colorRef(email.cta?.fill, 'CTA'); colorRef(email.cta?.text, 'CTA'); colorRef(email.links?.color, 'Enlaces');
  colorRef(email.header?.background, 'Cabecera'); colorRef(email.footer?.background, 'Pie');
  for (const id of [email.logo?.logoId, email.logo?.darkModeLogoId]) {
    if (!id) continue;
    const l = brand.logos.find((x) => x.id === id);
    if (!l) out.push({ code: 'EMAIL_LOGO_UNKNOWN', severity: 'blocking', message: `El canal email usa el logo ${id}, que no está en brand.json` });
    else if (!l.file) out.push({ code: 'EMAIL_LOGO_FILE_MISSING', severity: 'pending', message: `Logo ${l.label}: falta el archivo (se diseñará con un hueco de logo pendiente)` });
    else if (!l.externalUse) out.push({ code: 'EMAIL_LOGO_NOT_EXTERNAL', severity: 'blocking', message: `Logo ${l.label}: la marca no lo permite en comunicación externa` });
  }
  const policy = email.typography.policy?.value;
  for (const [role, r] of Object.entries(email.typography.roles)) {
    const first = r.stack.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
    const brandFamilies = brand.typography.families.map((f) => f.family);
    if (policy === 'web_font_with_fallback' && !brandFamilies.includes(first)) out.push({ code: 'EMAIL_FONT_NOT_BRAND', severity: 'warning', message: `${role}: la pila empieza por ${first}, que no es una tipografía de marca` });
    if (policy === 'web_safe' && brandFamilies.includes(first)) out.push({ code: 'EMAIL_FONT_POLICY_CONFLICT', severity: 'pending', message: `${role}: la política es web-safe pero la pila empieza por ${first} (fuente de marca, no de sistema)` });
    if (r.figma.family !== first) out.push({ code: 'EMAIL_FONT_FIGMA_PROXY', severity: 'warning', message: `${role}: se diseña en Figma con ${r.figma.family} como sustituto declarado de ${first} (${r.source})` });
  }
  for (const m of email.modules) if (m.figma && !idx.figma.files.some((f) => f.fileKey === m.figma!.fileKey)) out.push({ code: 'MODULE_FILE_NOT_DECLARED', severity: 'blocking', message: `Módulo ${m.id}: el archivo ${m.figma.fileKey} no está declarado en client.json (posible mezcla de clientes)` });
  for (const t of email.templates) if (!idx.figma.files.some((f) => f.fileKey === t.fileKey)) out.push({ code: 'TEMPLATE_FILE_NOT_DECLARED', severity: 'blocking', message: `Plantilla ${t.id}: el archivo ${t.fileKey} no está declarado en client.json` });
  for (const q of email.openQuestions) if (q.status === 'open') out.push({ code: 'EMAIL_OPEN_QUESTION', severity: 'warning', message: `Pregunta abierta (email): ${q.question}` });
  return out;
}

/** Coherencia del canal paid con el índice: las plantillas solo pueden venir de archivos de Figma del cliente. */
export function crossCheckPaid(paid: PaidChannel, idx: ClientIndex): KnowledgeIssue[] {
  const out: KnowledgeIssue[] = [];
  const ids = new Set<string>();
  for (const t of paid.templates) {
    if (ids.has(t.id)) out.push({ code: 'PAID_TEMPLATE_DUPLICATE', severity: 'blocking', message: `Plantilla paid repetida: ${t.id}` });
    ids.add(t.id);
    if (!idx.figma.files.some((f) => f.fileKey === t.fileKey)) out.push({ code: 'PAID_TEMPLATE_FILE_NOT_DECLARED', severity: 'blocking', message: `Plantilla ${t.id}: el archivo ${t.fileKey} no está declarado en client.json (posible mezcla de clientes)` });
    if (!Object.keys(t.slots).length) out.push({ code: 'PAID_TEMPLATE_WITHOUT_SLOTS', severity: 'blocking', message: `Plantilla ${t.id}: sin huecos declarados` });
  }
  for (const q of paid.openQuestions) if (q.status === 'open') out.push({ code: 'PAID_OPEN_QUESTION', severity: 'warning', message: `Pregunta abierta (paid): ${q.question}` });
  return out;
}

/** Comprobación completa del conocimiento de un cliente (knowledge-check). */
export async function checkClient(root: string, slug: string): Promise<{ issues: KnowledgeIssue[]; index: ClientIndex }> {
  const idx = await loadIndex(root, slug);
  const issues: KnowledgeIssue[] = [];
  const seen = new Set<string>();
  for (const f of idx.files) {
    if (seen.has(f.id)) issues.push({ code: 'FILE_ID_DUPLICATE', severity: 'blocking', message: `Id repetido en el índice: ${f.id}` });
    seen.add(f.id);
    let p: string;
    try { p = clientPath(root, slug, f.path); } catch (e) { issues.push({ code: 'FILE_PATH_ESCAPES', severity: 'blocking', message: (e as Error).message }); continue; }
    if (!existsSync(p)) { issues.push({ code: 'FILE_MISSING', severity: 'blocking', message: `${f.id}: falta ${f.path}` }); continue; }
    if (f.status === 'validated' && !f.approval) issues.push({ code: 'VALIDATED_WITHOUT_APPROVAL', severity: 'blocking', message: `${f.id}: validado sin registro de quién lo aprobó` });
    if (f.path.endsWith('.json')) {
      const json = JSON.parse(await readFile(p, 'utf8')) as { schema?: string };
      if (json.schema === 'pcb.brand.v1') {
        const r = parse(BrandSchema, json);
        if (!r.ok) issues.push({ code: 'BRAND_INVALID', severity: 'blocking', message: `${f.path}: ${r.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}` });
        else {
          for (const i of (await checkBrand(r.value, join(root, 'clients', slug))).issues) issues.push({ code: `BRAND_${i.code}`, severity: i.severity, message: i.message });
          if (r.value.status !== f.status) issues.push({ code: 'STATUS_MISMATCH', severity: 'pending', message: `${f.id}: el índice dice «${f.status}» y brand.json «${r.value.status}»` });
        }
      } else if (json.schema === 'ck.email.v1') {
        const r = parse(EmailChannelSchema, json);
        if (!r.ok) issues.push({ code: 'EMAIL_INVALID', severity: 'blocking', message: `${f.path}: ${r.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}` });
        else if (r.value.status !== f.status) issues.push({ code: 'STATUS_MISMATCH', severity: 'pending', message: `${f.id}: el índice dice «${f.status}» y ${f.path} «${r.value.status}»` });
      } else if (json.schema === 'ck.paid.v1') {
        const r = parse(PaidChannelSchema, json);
        if (!r.ok) issues.push({ code: 'PAID_INVALID', severity: 'blocking', message: `${f.path}: ${r.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}` });
        else if (r.value.status !== f.status) issues.push({ code: 'STATUS_MISMATCH', severity: 'pending', message: `${f.id}: el índice dice «${f.status}» y ${f.path} «${r.value.status}»` });
      }
    }
  }
  if (issues.every((i) => i.severity !== 'blocking')) {
    for (const ch of new Set(idx.files.flatMap((f) => f.channels).filter((c) => c !== 'all'))) {
      const ctx = await loadContext(root, slug, ch);
      for (const i of ctx.issues) if (!issues.some((x) => x.message === i.message)) issues.push(i);
    }
  }
  return { issues, index: idx };
}

export async function listProposals(root: string, slug: string): Promise<Array<{ file: string; p: KnowledgeProposal }>> {
  const dir = clientPath(root, slug, 'proposals');
  if (!existsSync(dir)) return [];
  const out: Array<{ file: string; p: KnowledgeProposal }> = [];
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.json')).sort()) {
    const r = parse(KnowledgeProposalSchema, JSON.parse(await readFile(join(dir, f), 'utf8')));
    if (r.ok) out.push({ file: `proposals/${f}`, p: r.value });
  }
  return out;
}

/** Registra una propuesta de cambio en la cuarentena del cliente. No modifica ningún archivo de conocimiento. */
export async function writeProposal(root: string, p: KnowledgeProposal): Promise<string> {
  const idx = await loadIndex(root, p.client);
  if (p.status !== 'proposed' || p.review) throw new Error('Una propuesta nueva nace «proposed» y sin revisión');
  for (const it of p.items) if (!idx.files.some((f) => f.id === it.targetFile)) throw new Error(`La propuesta apunta a ${it.targetFile}, que no está en el índice de ${p.client}`);
  const dir = clientPath(root, p.client, 'proposals');
  await mkdir(dir, { recursive: true });
  const name = `${p.createdAt.slice(0, 10)}-${sha256Hex(JSON.stringify(p)).slice(0, 8)}.json`;
  await writeFile(join(dir, name), `${JSON.stringify(p, null, 2)}\n`, 'utf8');
  return `proposals/${name}`;
}

/** Marca un archivo del índice como validado. Solo a petición explícita de una persona y sin pendientes. */
export async function validateFile(root: string, slug: string, fileId: string, by: string, note: string): Promise<ClientIndex> {
  const idx = await loadIndex(root, slug);
  const f = idx.files.find((x) => x.id === fileId);
  if (!f) throw new Error(`${slug} no tiene el archivo ${fileId}`);
  const { issues } = await checkClient(root, slug);
  const stop = issues.filter((i) => i.severity !== 'warning' && (i.message.includes(f.path) || i.message.startsWith(`${f.id}:`) || (f.kind === 'brand' && i.code.startsWith('BRAND_')) || (f.kind === 'channel' && (i.code.startsWith('EMAIL_') || i.code.startsWith('PAID_')))));
  if (stop.length) throw new Error(`No se puede validar ${fileId} con pendientes:\n${stop.map((i) => `- ${i.message}`).join('\n')}`);
  const at = new Date().toISOString();
  const next = { ...idx, files: idx.files.map((x) => (x.id === fileId ? { ...x, status: 'validated' as const, approval: { by, at, note }, updatedAt: at.slice(0, 10) } : x)) };
  await writeFile(clientPath(root, slug, 'client.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/** Versión siguiente (AAAA-MM-DD.n): el mismo día suma 1; otro día empieza en .1. */
export const nextVersion = (prev: string | null, today: string): string => {
  const m = prev?.match(/^(\d{4}-\d{2}-\d{2})\.(\d+)$/);
  return m && m[1] === today ? `${today}.${Number(m[2]) + 1}` : `${today}.1`;
};

/** Añade una línea al CHANGELOG.md del cliente (lo crea con su cabecera si no existe). */
export async function appendChangelog(root: string, slug: string, line: string): Promise<void> {
  const p = clientPath(root, slug, 'CHANGELOG.md');
  const head = `# Cambios del conocimiento — ${slug}\n\nCada cambio aprobado: fecha, archivo (id del índice), versión nueva, qué cambia, quién lo aprobó y de dónde sale.\nLas propuestas sin revisar están en \`proposals/\` y **no** forman parte del conocimiento.\n\n`;
  const prev = existsSync(p) ? await readFile(p, 'utf8') : head;
  await writeFile(p, `${prev.replace(/\n*$/, '\n')}- ${line}\n`, 'utf8');
}

export type KnowledgeFileEntry = Omit<KnowledgeFile, 'status' | 'version' | 'updatedAt' | 'approval'>;

/** Registra en el índice un cambio de archivos de conocimiento ya escritos en la carpeta del cliente: los da de alta si
 *  no están, sube su versión, los deja en borrador (un cambio anula la validación) y añade la línea al CHANGELOG. Si el
 *  cliente no tiene índice, lo crea con lo mínimo. No escribe el contenido de los archivos. */
export async function recordChange(
  root: string, slug: string, entries: KnowledgeFileEntry[], note: string,
  opts: { name: string; today?: string },
): Promise<ClientIndex> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  for (const e of entries) if (!existsSync(clientPath(root, slug, e.path))) throw new Error(`${slug}: falta ${e.path}`);
  const idx: ClientIndex = existsSync(clientPath(root, slug, 'client.json')) ? await loadIndex(root, slug) : {
    schema: 'ck.client.v1', slug, name: opts.name, aliases: [opts.name], domains: [], status: 'draft', owners: [], updatedAt: today,
    relatedClients: [], figma: { libraries: [], files: [] }, files: [],
  };
  const files = [...idx.files];
  const changed: string[] = [];
  for (const e of entries) {
    const i = files.findIndex((f) => f.id === e.id);
    const prev = i >= 0 ? files[i]! : null;
    if (prev && prev.path !== e.path) throw new Error(`${slug}: el archivo ${e.id} del índice es ${prev.path}, no ${e.path}`);
    const next: KnowledgeFile = { ...(prev ?? e), source: e.source, status: 'draft', version: nextVersion(prev?.version ?? null, today), updatedAt: today, approval: null };
    if (i >= 0) files[i] = next; else files.push(next);
    changed.push(`${e.id} v${next.version}`);
  }
  const out = parseOrThrow(ClientIndexSchema, { ...idx, status: 'draft', updatedAt: today, files }, `clients/${slug}/client.json`);
  await writeFile(clientPath(root, slug, 'client.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  await appendChangelog(root, slug, `${today} · ${changed.join(', ')} · ${note}. Borrador.`);
  return out;
}
