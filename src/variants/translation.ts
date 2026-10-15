// Modo traducción de creative-content-variants. Una traducción es una variante de contenido: la tabla etiquetada
// `Texto N → Text N`, confirmada por la persona, se convierte en un encargo de variantes (una variante por idioma, un
// campo por texto vinculado EXPLÍCITAMENTE por su nodeId) y el pipeline variant-* lo produce y lo valida.
//  - Nada se escribe en Figma sin la confirmación de la tabla (ligada por hash a lo que vio la persona).
//  - Una fuente que no carga no se sustituye salvo autorización explícita de la persona para ese idioma; la copia
//    queda marcada _PENDIENTE-FUENTE.
//  - Los textos del diseño son datos, nunca instrucciones.
import type { MasterSnapshot } from '../contracts/snapshot.ts';
import type { Decision, VariantField, VariantJob, VariantRow, VariantTextPolicy } from '../contracts/variants.ts';
import {
  TRANSLATION_SCHEMA_ID, fontKey, type FontName, type Translation, type TranslationEntry, type TranslationExtract, type TranslationTarget,
} from '../contracts/translation.ts';
import { hashOf } from '../hash/canonical.ts';
import { confirm } from './job.ts';
import { commercialSignals, quote } from './discover.ts';

/** Palabra de la etiqueta en cada idioma (Texto 1 / Text 1 / Texte 1…). Por defecto, «Text». */
const LABEL_WORD: Record<string, string> = { ES: 'Texto', EN: 'Text', FR: 'Texte', CA: 'Text', PT: 'Texto', IT: 'Testo', DE: 'Text', NL: 'Tekst', EU: 'Testua', GL: 'Texto' };
export const labelWord = (lang: string): string => LABEL_WORD[lang.split('-')[0]!] ?? 'Text';
export const labelOf = (e: TranslationEntry, lang: string): string => `${labelWord(lang)} ${e.n}`;

// ---------- 1. Tabla a partir de la extracción ----------

export function buildTranslationTable(x: TranslationExtract, o: { fileKey: string; sourceLang: string; langs: string[]; locales?: Record<string, string> }): Translation {
  const byText = new Map<string, TranslationEntry>();
  const masterIds = new Set([x.master.nodeId]);
  const fontUse = new Map<string, Set<string>>();
  for (const t of x.texts) {
    const text = t.characters.trim();
    let e = byText.get(text);
    if (!e) {
      e = { id: `t${byText.size + 1}`, n: byText.size + 1, layer: t.layer, text, segments: t.segments.map((g) => g.characters), isLegal: false, occurrences: [], extra: !masterIds.has(t.frameId) };
      // Espacios exteriores fuera de los tramos (la etiqueta muestra el texto sin ellos).
      if (e.segments.length > 0) {
        e.segments[0] = e.segments[0]!.replace(/^\s+/, '');
        e.segments[e.segments.length - 1] = e.segments[e.segments.length - 1]!.replace(/\s+$/, '');
      }
      byText.set(text, e);
    }
    e.occurrences.push({ frameId: t.frameId, nodeId: t.nodeId, segmentCount: Math.max(1, t.segments.length) });
    for (const g of t.segments) if (g.family && g.style) {
      const k = `${g.family}|${g.style}`;
      if (!fontUse.has(k)) fontUse.set(k, new Set());
      fontUse.get(k)!.add(e.id);
    }
  }
  const entries = [...byText.values()];
  const langs = [...new Set(o.langs.map((l) => l.toUpperCase()))];
  if (langs.includes(o.sourceLang.toUpperCase())) throw new Error(`El idioma destino ${o.sourceLang} es el del original`);
  return {
    schema: TRANSLATION_SCHEMA_ID, fileKey: o.fileKey, sourceLang: o.sourceLang.toUpperCase(),
    master: { nodeId: x.master.nodeId, name: x.master.name },
    frames: [{ nodeId: x.master.nodeId, name: x.master.name, width: x.master.width, height: x.master.height }, ...x.frames],
    entries,
    fonts: x.fonts.map((f) => ({ family: f.family, style: f.style, loadable: f.loadable, usedIn: [...(fontUse.get(`${f.family}|${f.style}`) ?? [])] })),
    targets: langs.map((lang) => ({
      lang, locale: o.locales?.[lang] ?? null, typography: [], fontFallbacks: [], confirmation: null,
      values: Object.fromEntries(entries.map((e) => [e.id, { text: null, parts: null, keep: false, note: null }])),
    })),
  };
}

// ---------- 2. Comprobación, confirmación y fallback ----------

export interface TranslationIssue { code: string; severity: 'blocking' | 'pending' | 'warning'; lang: string; entryId?: string; message: string }
export interface TranslationCheck { issues: TranslationIssue[]; readyLangs: string[] }

export const copyHash = (tr: Translation, t: TranslationTarget): string =>
  hashOf('pcb.translation-copy', { sourceLang: tr.sourceLang, master: tr.master, entries: tr.entries.map((e) => ({ id: e.id, text: e.text, segments: e.segments, isLegal: e.isLegal })), lang: t.lang, locale: t.locale, values: t.values, typography: t.typography });

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/u;

/** Traducción final de una entrada (una parte por tramo si tiene estilos mixtos). */
export function translatedParts(e: TranslationEntry, t: TranslationTarget): string[] | { code: string; error: string } {
  const v = t.values[e.id];
  if (!v) return { code: 'VALUE_MISSING', error: 'sin traducción' };
  if (v.keep) return e.segments;
  if (e.segments.length > 1) {
    if (!v.parts) return v.text !== null ? { code: 'MIXED_STYLES_UNMAPPED', error: `lleva ${e.segments.length} estilos (${e.segments.map((g) => quote(g, 30)).join(' + ')}): indica qué parte de la traducción lleva cada uno` } : { code: 'VALUE_MISSING', error: 'sin traducción' };
    if (v.parts.length !== e.segments.length) return { code: 'PARTS_MISMATCH', error: `${v.parts.length} parte(s) para ${e.segments.length} tramo(s) de estilo` };
    if (v.parts.some((p) => p.length === 0)) return { code: 'PART_EMPTY', error: 'una parte vacía eliminaría un tramo de estilo' };
    return v.parts;
  }
  if (v.parts && v.parts.length !== 1) return { code: 'PARTS_MISMATCH', error: 'el original tiene un solo estilo: da la traducción completa' };
  const text = v.parts?.[0] ?? v.text;
  return text === null ? { code: 'VALUE_MISSING', error: 'sin traducción' } : [text];
}

export function checkTranslation(tr: Translation): TranslationCheck {
  const issues: TranslationIssue[] = [];
  for (const t of tr.targets) {
    const add = (i: Omit<TranslationIssue, 'lang'>) => issues.push({ ...i, lang: t.lang });
    for (const k of Object.keys(t.values)) if (!tr.entries.some((e) => e.id === k)) add({ code: 'VALUE_FOR_UNKNOWN_TEXT', severity: 'blocking', message: `Hay traducción para ${k}, que no es un texto de la tabla` });
    for (const e of tr.entries) {
      const L = `${labelOf(e, t.lang)} · ${e.layer}`;
      const r = translatedParts(e, t);
      if (!Array.isArray(r)) { add({ entryId: e.id, code: r.code, severity: r.code === 'VALUE_MISSING' || r.code === 'MIXED_STYLES_UNMAPPED' ? 'pending' : 'blocking', message: `${L}: ${r.error}` }); continue; }
      if (t.values[e.id]!.keep) continue;
      const out = r.join('');
      if (!out.trim()) add({ entryId: e.id, code: 'TEXT_EMPTY', severity: 'blocking', message: `${L}: traducción vacía` });
      if (CONTROL.test(out)) add({ entryId: e.id, code: 'TEXT_CONTROL_CHARS', severity: 'blocking', message: `${L}: contiene caracteres de control o invisibles` });
      const grow = out.length / Math.max(1, e.text.length) - 1;
      if (grow > 0.15) add({ entryId: e.id, code: 'LONGER_THAN_ORIGINAL', severity: 'warning', message: `${L}: +${Math.round(grow * 100)} % de longitud; puede no caber` });
      const added = commercialSignals(out).filter((k) => !commercialSignals(e.text).includes(k));
      if (added.length) add({ entryId: e.id, code: 'NEW_COMMERCIAL_DATA', severity: 'warning', message: `${L}: la traducción contiene ${added.join(', ')} que no aparece en el original (solo se adapta el formato; no se inventan datos)` });
      if (e.isLegal) add({ entryId: e.id, code: 'LEGAL_PENDING_VALIDATION', severity: 'warning', message: `${L}: legal traducido, pendiente de validación legal` });
    }
    // Fuentes: una que no carga y afecta a textos traducidos exige decisión.
    for (const f of tr.fonts.filter((x) => !x.loadable)) {
      const affected = f.usedIn.filter((id) => !t.values[id]?.keep);
      if (!affected.length) continue;
      const labels = affected.map((id) => labelOf(tr.entries.find((e) => e.id === id)!, t.lang)).join(', ');
      const fb = t.fontFallbacks.find((x) => x.from.family === f.family && x.from.style === f.style);
      if (!fb) add({ code: 'FONT_UNAVAILABLE', severity: 'pending', message: `La fuente ${f.family} ${f.style} no está disponible en esta sesión de Figma. Afecta a: ${labels}. Opciones: activarla y volver a extraer (recomendado), una sustituta de métricas parecidas o la que indiques (se marca _PENDIENTE-FUENTE)` });
      else if (!fb.decision) add({ code: 'FONT_FALLBACK_NOT_AUTHORIZED', severity: 'pending', message: `Sustituir ${f.family} ${f.style} por ${fb.to.family} ${fb.to.style} requiere tu autorización explícita` });
      else add({ code: 'FONT_FALLBACK_AUTHORIZED', severity: 'warning', message: `${fb.to.family} ${fb.to.style} en lugar de ${f.family} ${f.style} (autorizado): copias marcadas _PENDIENTE-FUENTE, no aceptables hasta restituir la original` });
    }
    for (const fb of t.fontFallbacks) if (fb.decision && fb.decision.by !== 'user') add({ code: 'FONT_FALLBACK_NOT_BY_USER', severity: 'blocking', message: 'Una sustituta de fuente solo la autoriza la persona' });
    if (!t.confirmation) add({ code: 'COPY_NOT_CONFIRMED', severity: 'pending', message: `Falta tu confirmación de la tabla (${t.lang})` });
    else if (t.confirmation.hash !== copyHash(tr, t)) add({ code: 'COPY_CHANGED_AFTER_CONFIRMATION', severity: 'pending', message: `La tabla (${t.lang}) cambió después de tu confirmación: hay que volver a confirmarla` });
  }
  const stops = (i: TranslationIssue) => i.severity !== 'warning';
  return { issues, readyLangs: tr.targets.filter((t) => !issues.some((i) => i.lang === t.lang && stops(i))).map((t) => t.lang) };
}

const targetOf = (tr: Translation, lang: string): TranslationTarget => {
  const t = tr.targets.find((x) => x.lang === lang.toUpperCase());
  if (!t) throw new Error(`No hay tabla para ${lang} (idiomas: ${tr.targets.map((x) => x.lang).join(', ')})`);
  return t;
};
const withTarget = (tr: Translation, t: TranslationTarget): Translation => ({ ...tr, targets: tr.targets.map((x) => (x.lang === t.lang ? t : x)) });

/** Confirmación de la tabla de un idioma por la PERSONA (solo tras su OK explícito). */
export function confirmTranslation(tr: Translation, lang: string, decision: Decision): Translation {
  if (decision.by !== 'user') throw new Error('La tabla de traducción solo la confirma la persona');
  const t = targetOf(tr, lang);
  const blocking = checkTranslation(tr).issues.filter((i) => i.lang === t.lang && (i.severity === 'blocking' || (i.severity === 'pending' && !['COPY_NOT_CONFIRMED', 'COPY_CHANGED_AFTER_CONFIRMATION', 'FONT_UNAVAILABLE', 'FONT_FALLBACK_NOT_AUTHORIZED'].includes(i.code))));
  if (blocking.length) throw new Error(`La tabla (${t.lang}) no está completa:\n${blocking.map((i) => `- ${i.message}`).join('\n')}`);
  return withTarget(tr, { ...t, confirmation: { decision, hash: copyHash(tr, t) } });
}

/** Autorización de la PERSONA para usar `to` en lugar de `from` (solo en las copias traducidas de ese idioma). */
export function authorizeFontFallback(tr: Translation, lang: string, from: FontName, to: FontName, decision: Decision): Translation {
  if (decision.by !== 'user') throw new Error('Una sustituta de fuente solo la autoriza la persona');
  const f = tr.fonts.find((x) => x.family === from.family && x.style === from.style);
  if (!f) throw new Error(`${fontKey(from)} no es una fuente de los textos extraídos`);
  if (f.loadable) throw new Error(`${fontKey(from)} se puede cargar: no hace falta sustituta (nunca se sustituye una fuente disponible)`);
  if (from.family === to.family && from.style === to.style) throw new Error('La sustituta es la misma fuente');
  const t = targetOf(tr, lang);
  return withTarget(tr, { ...t, fontFallbacks: [...t.fontFallbacks.filter((x) => fontKey(x.from) !== fontKey(from)), { from, to, decision }] });
}

/** Tabla en dos bloques con las mismas etiquetas (original y traducción), para comparar línea a línea. */
export function renderTranslationTable(tr: Translation, chk: TranslationCheck): string {
  const line = (e: TranslationEntry, lang: string, s: string) => `${labelOf(e, lang)} · ${e.layer.replace(/[\n\r]+/g, ' ')}: ${s.replace(/\n/g, ' / ')}`;
  const out = [`# Traducción de ${quote(tr.master.name)}`, '', `Piezas: ${tr.frames.map((f) => `${quote(f.name)} (${f.width}×${f.height})`).join(', ')}.`, ''];
  out.push('```', `Original (${tr.sourceLang})`, ...tr.entries.map((e) => line(e, tr.sourceLang, `${e.text}${e.segments.length > 1 ? `  [${e.segments.length} estilos: ${e.segments.map((g) => `«${g}»`).join(' + ')}]` : ''}${e.extra ? '  [solo en adaptaciones]' : ''}`)), '```', '');
  for (const t of tr.targets) {
    const own = chk.issues.filter((i) => i.lang === t.lang);
    out.push('```', `Traducción (${t.lang}${t.locale ? `, ${t.locale}` : ''})`);
    for (const e of tr.entries) {
      const v = t.values[e.id];
      const r = translatedParts(e, t);
      const shown = !v ? '⚠ falta' : v.keep ? `${e.text}  (no se traduce)` : Array.isArray(r) ? (r.length > 1 ? r.map((p) => `«${p}»`).join(' + ') : r[0]!) : `⚠ ${r.error}`;
      const notes = [v?.note, ...own.filter((i) => i.entryId === e.id && i.severity === 'warning').map((i) => i.message.replace(/^[^:]+: /, ''))].filter(Boolean);
      out.push(line(e, t.lang, `${shown}${notes.length ? `  ⚠ ${notes.join('; ')}` : ''}`));
    }
    out.push('```', '');
    if (t.typography.length) out.push(`Normas ortotipográficas (${t.lang}):`, '', ...t.typography.map((x) => `- ${x}`), '');
    const glob = own.filter((i) => !i.entryId && i.code !== 'COPY_NOT_CONFIRMED');
    const pend = own.filter((i) => i.entryId && i.severity !== 'warning');
    if (glob.length || pend.length) out.push(...[...glob, ...pend].map((i) => `- ${i.severity === 'blocking' ? '⛔' : i.severity === 'pending' ? '❓' : 'ℹ'} ${i.message}`), '');
    out.push(chk.readyLangs.includes(t.lang) ? `✔ Tabla ${t.lang} confirmada.` : '¿Lo doy por bueno o quieres cambiar algún texto antes de construir en Figma?', '');
  }
  return out.join('\n');
}

// ---------- 3. Encargo de variantes para una pieza (maestra o adaptación) ----------

export interface TranslationJobOptions {
  textPolicy: VariantTextPolicy;
  logoNodeIds?: string[];
  sectionName?: string;
}

/**
 * Encargo de variantes de UNA pieza (la raíz de la instantánea: la maestra o una adaptación) con una variante por idioma.
 * Cada campo es un texto de la tabla vinculado por su nodeId en esa pieza (nunca por coincidencia global de palabras).
 * La confirmación de la tabla de cada idioma es la autorización de campos y contenido; se registra ligada por hash.
 */
export function buildTranslationJob(tr: Translation, s: MasterSnapshot, langs: string[], o: TranslationJobOptions): VariantJob {
  const frame = tr.frames.find((f) => f.nodeId === s.rootNodeId);
  if (!frame) throw new Error(`La instantánea (${s.rootNodeId}) no es una de las piezas de la tabla: ${tr.frames.map((f) => f.nodeId).join(', ')}`);
  if (s.fileKey !== tr.fileKey) throw new Error('La instantánea es de otro archivo');
  const chk = checkTranslation(tr);
  const targets = langs.map((l) => targetOf(tr, l));
  // Las fuentes las vuelven a comprobar la instantánea (variant-job-check) y el propio script: una fuente pendiente de
  // decisión no impide preparar el encargo, pero sin sustituta autorizada ese texto no se escribirá si no carga.
  const FONT_PENDING = ['FONT_UNAVAILABLE', 'FONT_FALLBACK_NOT_AUTHORIZED'];
  const stops = chk.issues.filter((i) => targets.some((t) => t.lang === i.lang) && i.severity !== 'warning' && !FONT_PENDING.includes(i.code));
  if (stops.length) throw new Error(`Tabla sin confirmar o incompleta:\n${stops.map((i) => `- ${i.lang}: ${i.message}`).join('\n')}`);
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const root = byId.get(s.rootNodeId)!;
  const fields: VariantField[] = [];
  const keptIds: string[] = [];
  const valuesByLang = new Map<string, VariantRow['values']>(targets.map((t) => [t.lang, {}]));
  const errors: string[] = [];
  for (const e of tr.entries) {
    const occ = e.occurrences.filter((x) => x.frameId === s.rootNodeId);
    occ.forEach((x, i) => {
      const n = byId.get(x.nodeId);
      const L = `${labelOf(e, tr.sourceLang)} · ${e.layer}`;
      if (!n?.text) { errors.push(`${L}: el nodo ${x.nodeId} no está en la pieza o no es un texto (¿cambió desde la extracción?)`); return; }
      if (n.text.characters.trim() !== e.text) { errors.push(`${L}: la pieza ya no dice ${quote(e.text, 50)} (vuelve a extraer)`); return; }
      if (targets.every((t) => t.values[e.id]!.keep)) { keptIds.push(n.id); return; }
      const chars = n.text.characters, lead = chars.match(/^\s*/)![0], trail = chars.slice(lead.length).match(/\s*$/)![0];
      const segCount = n.text.segments.length;
      const fieldId = `${e.id}${occ.length > 1 ? `_${i + 1}` : ''}`;
      for (const t of targets) {
        const r = translatedParts(e, t) as string[];
        let parts: string[];
        if (t.values[e.id]!.keep) parts = n.text.segments.map((g) => g.characters);
        else if (segCount === 1) parts = [`${lead}${r.join('')}${trail}`];
        else if (r.length === segCount) parts = r.map((p, k) => `${k === 0 ? lead : ''}${p}${k === r.length - 1 ? trail : ''}`);
        else { errors.push(`${L}: en esta pieza tiene ${segCount} tramos de estilo y la traducción ${t.lang} ${r.length}; reparte la traducción por tramos`); continue; }
        valuesByLang.get(t.lang)![fieldId] = segCount === 1
          ? { kind: 'text', text: parts[0]!, parts: null, display: null, source: 'user_provided' }
          : { kind: 'text', text: null, parts, display: null, source: 'user_provided' };
      }
      fields.push({
        fieldId, label: `${labelOf(e, tr.sourceLang)} · ${e.layer}`, kind: 'text', nodeId: n.id, role: e.isLegal ? 'legal' : null, isLegal: e.isLegal,
        // Un legal no se reduce sin autorización: con fit_text sin autorizar, el legal queda en strict.
        masterValue: chars, styleMapping: segCount === 1 ? 'whole' : 'segments', textPolicy: e.isLegal && o.textPolicy.mode === 'fit_text' && !o.textPolicy.authorization ? { mode: 'strict' } : o.textPolicy, imagePolicy: null, paintIndex: null, maskDecision: null,
      });
    });
  }
  if (errors.length) throw new Error(`No se puede vincular la tabla a ${quote(root.name)}:\n${errors.map((x) => `- ${x}`).join('\n')}`);
  if (!fields.length) throw new Error(`${quote(root.name)} no tiene textos que traducir`);
  const LANG_NAME: Record<string, string> = { EN: 'Inglés', FR: 'Francés', CA: 'Catalán', PT: 'Portugués', IT: 'Italiano', DE: 'Alemán', EU: 'Euskera', GL: 'Gallego', ES: 'Español', NL: 'Neerlandés' };
  const job: VariantJob = {
    schema: 'pcb.variant-job.v1',
    request: `Traducción de ${root.name} (${tr.sourceLang} → ${targets.map((t) => t.lang).join(', ')})`,
    master: { fileKey: s.fileKey, nodeId: s.rootNodeId, name: root.name, width: root.width ?? frame.width, height: root.height ?? frame.height, fingerprint: s.fingerprints.master, params: {} },
    params: [],
    fields,
    kept: keptIds.length ? [{ label: 'Textos que no se traducen', nodeIds: keptIds, why: 'marcados en la tabla como no traducibles (marca, producto, claims…)' }] : [],
    protected: { logoNodeIds: o.logoNodeIds ?? [], safeArea: null, safeAreaNote: null },
    variants: targets.map((t) => ({
      variantId: t.lang.toLowerCase(), label: `${LANG_NAME[t.lang.split('-')[0]!] ?? t.lang} (${t.lang}${t.locale ? `, ${t.locale}` : ''})`, params: {}, notes: t.typography.length ? t.typography.join(' · ') : null,
      values: valuesByLang.get(t.lang)!,
    })),
    output: { sectionName: o.sectionName ?? 'PCB · Traducciones', cloneNamePattern: '{master}_{VARIANT}' },
    translation: {
      sourceLang: tr.sourceLang,
      tableHashes: Object.fromEntries(targets.map((t) => [t.lang.toLowerCase(), t.confirmation!.hash])),
      fontFallbacks: Object.fromEntries(targets.map((t) => [t.lang.toLowerCase(), t.fontFallbacks.filter((x) => x.decision).map((x) => ({ from: x.from, to: x.to, decision: x.decision! }))])),
    },
    confirmations: { fields: null, content: null },
  };
  // La tabla confirmada autoriza qué textos cambian y con qué contenido (por idioma): se registra tal cual.
  const first = targets[0]!.confirmation!.decision;
  let j = confirm(job, 'fields', { ...first, note: `Tablas de traducción confirmadas (${targets.map((t) => t.lang).join(', ')}): ${first.note ?? ''}`.trim() });
  for (const t of targets) j = confirm(j, 'content', { ...t.confirmation!.decision, note: `Tabla ${t.lang} confirmada: ${t.confirmation!.decision.note ?? ''}`.trim() }, [t.lang.toLowerCase()]);
  return j;
}

/** Sección del informe final: normas del idioma, legales pendientes y piezas pendientes de fuente. */
export function renderTranslationReport(tr: Translation, langs?: string[]): string {
  const out = ['## Traducción', ''];
  for (const t of tr.targets.filter((x) => !langs?.length || langs.map((l) => l.toUpperCase()).includes(x.lang))) {
    out.push(`### ${t.lang}${t.locale ? ` (${t.locale})` : ''}`, '');
    const legal = tr.entries.filter((e) => e.isLegal && !t.values[e.id]?.keep).map((e) => labelOf(e, t.lang));
    const noted = tr.entries.filter((e) => t.values[e.id]?.note).map((e) => `${labelOf(e, t.lang)}: ${t.values[e.id]!.note}`);
    out.push(`- Pendiente de validación: ${[...(legal.length ? [`legales (${legal.join(', ')})`] : []), ...noted].join('; ') || '—'}`);
    const fb = t.fontFallbacks.filter((x) => x.decision);
    out.push(`- Pendiente de fuente: ${fb.length ? fb.map((x) => `${x.to.family} ${x.to.style} en lugar de ${x.from.family} ${x.from.style} (copias _PENDIENTE-FUENTE; no se aceptan hasta restituir la original)`).join('; ') : '—'}`);
    out.push('', `Normas del idioma (${t.lang}):`, '', ...(t.typography.length ? t.typography.map((x) => `- ${x}`) : ['- ⚠ Sin anotar: falta indicar qué normas se aplicaron, cuáles cambiaron el ancho y cuáles se omitieron.']), '');
  }
  return out.join('\n');
}
