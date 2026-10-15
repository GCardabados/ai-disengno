// Comandos translation-* (modo traducción de la skill creative-content-variants). Ninguno escribe en Figma: la
// extracción es de solo lectura y la escritura la hace el pipeline variant-* (variant-request → use_figma).
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseOrThrow } from '../contracts/schema.ts';
import { MasterSnapshotSchema } from '../contracts/snapshot.ts';
import { TRANSLATION_EXTRACT_SCHEMA_ID, TranslationExtractSchema, TranslationSchema, type FontName, type Translation } from '../contracts/translation.ts';
import type { VariantTextPolicy } from '../contracts/variants.ts';
import { extractEnvelope } from '../figma/ingest-envelope.ts';
import { buildTranslationExtractScript } from '../figma/translation-script.ts';
import { authorizeFontFallback, buildTranslationJob, buildTranslationTable, checkTranslation, confirmTranslation, renderTranslationTable } from './translation.ts';

export const TRANSLATION_USAGE = `
  TRADUCCIONES (modo traducción de creative-content-variants; una variante por idioma):
  translation-extract-request --file-key K --node-id M [--frames ID ...] --out F
                 Lectura (solo lectura): textos de la maestra M y de sus adaptaciones (frames, sección o página) y fuentes
  translation-table --raw F --file-key K --lang EN [--lang FR ...] [--source-lang ES] [--locale EN=en-GB ...] --out DIR
                 Etiqueta los textos (Texto 1, Texto 2…) → DIR/translation.json (traducciones por rellenar) y DIR/tabla.md
  translation-check --translation F [--out F]   Comprueba la tabla y escribe los dos bloques para confirmar
                 (0 = confirmada y lista, 4 = faltan traducciones o confirmaciones, 2 = tabla inválida)
  translation-confirm --translation F --lang EN --what copy --note TEXTO     Confirmación de la PERSONA de la tabla
  translation-confirm --translation F --lang EN --what font-fallback --from "Familia|Estilo" --to "Familia|Estilo" --note TEXTO
                 Autorización de la PERSONA para una fuente sustituta (solo copias traducidas, _PENDIENTE-FUENTE)
  translation-job --translation F --snapshot F --lang EN [--lang FR ...] [--text-policy strict|reflow|reflow:ALTOpx|fit:0.9]
                 [--logo ID ...] [--section NOMBRE] --out F
                 Encargo de variantes de UNA pieza (la de la instantánea) ya confirmado; sigue con variant-job-check,
                 variant-plan, variant-request, variant-check y variant-report --translation F`;

const opts = {
  'file-key': { type: 'string' }, 'node-id': { type: 'string' }, frames: { type: 'string', multiple: true }, out: { type: 'string' },
  raw: { type: 'string' }, lang: { type: 'string', multiple: true }, 'source-lang': { type: 'string' }, locale: { type: 'string', multiple: true },
  translation: { type: 'string' }, what: { type: 'string' }, note: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
  snapshot: { type: 'string' }, 'text-policy': { type: 'string' }, logo: { type: 'string', multiple: true }, section: { type: 'string' },
} as const;

const readJson = async (p: string): Promise<unknown> => JSON.parse(await readFile(p, 'utf8'));
const writeJson = async (p: string, v: unknown) => writeFile(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
const need = (v: string | undefined, name: string): string => { if (!v) throw new Error(`Falta --${name}\n${TRANSLATION_USAGE}`); return v; };
const loadTranslation = async (p: string): Promise<Translation> => parseOrThrow(TranslationSchema, await readJson(p), 'translation');
const font = (s: string, name: string): FontName => {
  const i = s.lastIndexOf('|');
  if (i <= 0 || i === s.length - 1) throw new Error(`--${name} con formato "Familia|Estilo": ${s}`);
  return { family: s.slice(0, i), style: s.slice(i + 1) };
};
export function parseTextPolicy(s: string | undefined): VariantTextPolicy {
  if (!s || s === 'strict') return { mode: 'strict' };
  if (s === 'reflow') return { mode: 'reflow', maxHeightPx: null };
  let m = /^reflow:(\d+(?:\.\d+)?)(?:px)?$/.exec(s);
  if (m) return { mode: 'reflow', maxHeightPx: Number(m[1]) };
  m = /^fit:(0?\.\d+|1(?:\.0+)?)$/.exec(s);
  if (m) return { mode: 'fit_text', minScale: Number(m[1]), authorization: null };
  throw new Error(`--text-policy desconocida: ${s} (strict | reflow | reflow:ALTOpx | fit:0.9)`);
}

export async function runTranslationCommand(cmd: string, rest: string[]): Promise<number> {
  const { values: a } = parseArgs({ args: rest, options: opts, strict: true });
  switch (cmd) {
    case 'translation-extract-request': {
      const fileKey = need(a['file-key'], 'file-key'), master = need(a['node-id'], 'node-id');
      await writeJson(need(a.out, 'out'), {
        tool: 'use_figma', fileKey, readOnly: true,
        description: `Solo lectura: textos visibles de ${master}${a.frames?.length ? ` y de ${a.frames.join(', ')}` : ''} para traducirlos, y si sus fuentes cargan (no modifica el documento).`,
        code: buildTranslationExtractScript(master, a.frames ?? []),
      });
      return 0;
    }
    case 'translation-table': {
      const rawPath = need(a.raw, 'raw');
      const ext = extractEnvelope(await readFile(rawPath, 'utf8'), TRANSLATION_EXTRACT_SCHEMA_ID);
      if ('code' in ext) throw new Error(`${rawPath}: ${ext.message}`);
      const x = parseOrThrow(TranslationExtractSchema, ext.value, 'extract');
      const fileKey = need(a['file-key'], 'file-key');
      const locales = Object.fromEntries((a.locale ?? []).map((l) => { const i = l.indexOf('='); if (i <= 0) throw new Error(`--locale con formato LANG=variante: ${l}`); return [l.slice(0, i).toUpperCase(), l.slice(i + 1)]; }));
      if (!a.lang?.length) throw new Error('Falta --lang');
      const tr = buildTranslationTable(x, { fileKey, sourceLang: a['source-lang'] ?? 'ES', langs: a.lang, locales });
      const out = need(a.out, 'out');
      await mkdir(out, { recursive: true });
      const path = join(out, 'translation.json');
      if (await access(path).then(() => true, () => false)) throw new Error(`${path} ya existe: no se sobrescribe una tabla (puede estar confirmada). Usa translation-check o bórrala a mano`);
      await writeJson(path, tr);
      await writeFile(join(out, 'tabla.md'), renderTranslationTable(tr, checkTranslation(tr)), 'utf8');
      const unloadable = tr.fonts.filter((f) => !f.loadable);
      console.log(`${tr.entries.length} texto(s) únicos en ${tr.frames.length} pieza(s) → ${path} (rellena las traducciones y presenta la tabla)`);
      for (const f of unloadable) console.log(`⚠ Fuente no disponible: ${f.family} ${f.style} (afecta a ${f.usedIn.length} texto(s))`);
      return 0;
    }
    case 'translation-check': {
      const tr = await loadTranslation(need(a.translation, 'translation'));
      const chk = checkTranslation(tr);
      if (a.out) await writeFile(a.out, renderTranslationTable(tr, chk), 'utf8');
      for (const i of chk.issues) console.log(`${i.severity.padEnd(8)} ${i.code.padEnd(30)} ${i.lang}  ${i.message}`);
      console.log(`Listas: ${chk.readyLangs.join(', ') || '—'} de ${tr.targets.map((t) => t.lang).join(', ')}.`);
      return chk.issues.some((i) => i.severity === 'blocking') ? 2 : chk.readyLangs.length === tr.targets.length ? 0 : 4;
    }
    case 'translation-confirm': {
      const path = need(a.translation, 'translation');
      const lang = need(a.lang?.[0], 'lang');
      const decision = { by: 'user' as const, at: new Date().toISOString(), note: need(a.note, 'note') };
      const tr = await loadTranslation(path);
      const what = need(a.what, 'what');
      let next: Translation;
      if (what === 'copy') next = confirmTranslation(tr, lang, decision);
      else if (what === 'font-fallback') next = authorizeFontFallback(tr, lang, font(need(a.from, 'from'), 'from'), font(need(a.to, 'to'), 'to'), decision);
      else throw new Error('--what debe ser copy o font-fallback');
      await writeJson(path, next);
      console.log(what === 'copy' ? `Tabla ${lang.toUpperCase()} confirmada por la persona.` : `Sustituta autorizada para ${lang.toUpperCase()}: ${a.to} en lugar de ${a.from} (copias _PENDIENTE-FUENTE).`);
      return 0;
    }
    case 'translation-job': {
      const tr = await loadTranslation(need(a.translation, 'translation'));
      const snap = parseOrThrow(MasterSnapshotSchema, await readJson(need(a.snapshot, 'snapshot')), 'snapshot');
      if (!a.lang?.length) throw new Error('Falta --lang');
      const job = buildTranslationJob(tr, snap, a.lang, { textPolicy: parseTextPolicy(a['text-policy']), logoNodeIds: a.logo, sectionName: a.section });
      await writeJson(need(a.out, 'out'), job);
      console.log(`${snap.source === 'MOCK' ? '[MOCK] ' : ''}${job.master.name}: ${job.fields.length} texto(s) × ${job.variants.length} idioma(s) → ${a.out} (sigue con variant-job-check)`);
      return 0;
    }
    default:
      console.log(TRANSLATION_USAGE);
      return 1;
  }
}
