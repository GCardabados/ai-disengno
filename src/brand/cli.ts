// Comandos brand-* (skill brand-kit-generator). Solo leen y escriben el brand kit local; nada se envía a Figma.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseOrThrow } from '../contracts/schema.ts';
import { BrandSchema, type Brand } from '../contracts/brand.ts';
import { checkBrand } from './check.ts';

export const BRAND_USAGE = `
  BRAND KITS (skill .claude/skills/brand-kit-generator; brands/<marca>/brand.json):
  brand-check    --brand DIR        Coherencia del kit: colores (HEX ↔ RGB), tipografías por rol, logos y sus colores,
                 erratas y preguntas abiertas (0 = listo, 4 = pendientes, 2 = kit inválido)
  brand-validate --brand DIR --by NOMBRE --note TEXTO   Una PERSONA valida el kit (solo sin pendientes)`;

const opts = { brand: { type: 'string' }, by: { type: 'string' }, note: { type: 'string' } } as const;
const need = (v: string | undefined, name: string): string => { if (!v) throw new Error(`Falta --${name}\n${BRAND_USAGE}`); return v; };
export const loadBrand = async (dir: string): Promise<Brand> => parseOrThrow(BrandSchema, JSON.parse(await readFile(join(dir, 'brand.json'), 'utf8')), 'brand');

export async function runBrandCommand(cmd: string, rest: string[]): Promise<number> {
  const { values: a } = parseArgs({ args: rest, options: opts, strict: true });
  switch (cmd) {
    case 'brand-check': {
      const dir = need(a.brand, 'brand');
      const b = await loadBrand(dir);
      const chk = await checkBrand(b, dir);
      for (const i of chk.issues) console.log(`${i.severity.padEnd(8)} ${i.code.padEnd(30)} ${i.message}`);
      console.log(`${b.name} (${b.status}): ${b.colors.length} colores, ${b.typography.families.length} familias, ${b.logos.length} logos (${b.logos.filter((l) => l.file).length} con archivo), ${b.gaps.length} lagunas, ${b.openQuestions.filter((q) => q.status === 'open').length} preguntas abiertas.`);
      return chk.issues.some((i) => i.severity === 'blocking') ? 2 : chk.issues.some((i) => i.severity === 'pending') ? 4 : 0;
    }
    case 'brand-validate': {
      const dir = need(a.brand, 'brand');
      const b = await loadBrand(dir);
      const pend = (await checkBrand(b, dir)).issues.filter((i) => i.severity !== 'warning');
      if (pend.length) throw new Error(`No se puede validar con pendientes:\n${pend.map((i) => `- ${i.message}`).join('\n')}`);
      const next: Brand = { ...b, status: 'validated', validation: { by: need(a.by, 'by'), at: new Date().toISOString(), note: need(a.note, 'note') } };
      await writeFile(join(dir, 'brand.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      console.log(`${b.name}: kit validado por ${a.by}.`);
      return 0;
    }
    default:
      console.log(BRAND_USAGE);
      return 1;
  }
}
