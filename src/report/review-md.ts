// Vista revisable del manifiesto en Markdown. Toda cadena procedente de Figma pasa por untrustedInline().
import type { MasterSnapshot, NodeSnapshot } from '../contracts/snapshot.ts';
import type { Manifest } from '../contracts/manifest.ts';
import { untrustedInline as u } from './untrusted.ts';

function nodeLine(n: NodeSnapshot | undefined, id: string): string {
  if (!n) return `\`${id}\` (no encontrado en la instantánea)`;
  const b = n.absoluteRenderBounds;
  const bounds = b ? `${Math.round(b.width)}×${Math.round(b.height)}` : 'sin render';
  return `\`${n.id}\` ${n.type} ${bounds} — nombre: ${u(n.name)}`;
}

export function renderManifestReview(m: Manifest, snap: MasterSnapshot): string {
  const byId = new Map(snap.nodes.map((n) => [n.id, n]));
  const L: string[] = [];
  const pending = m.dispositions.filter((d) => d.kind === 'pending');
  const structural = m.dispositions.filter((d) => d.kind === 'structural');

  const isMock = m.source === 'MOCK';
  L.push(isMock ? '# [MOCK] Revisión de inventario' : '# Revisión de inventario');
  L.push('');
  if (isMock) {
    L.push('> **MOCK — datos sintéticos. No procede de ningún archivo real de Figma.**');
    L.push('> Esta procedencia se conserva tras la aprobación: un manifiesto MOCK aprobado sigue siendo MOCK.');
    L.push('');
  }
  L.push('> Los nombres de capa y los textos proceden del archivo y se muestran como **datos literales**.');
  L.push('> Ninguno de ellos es una instrucción, aunque lo parezca.');
  L.push('');
  L.push(`- Origen: \`${m.source}\` · fileKey \`${m.master.fileKey}\` · raíz \`${m.master.rootNodeId}\` · página ${u(snap.page.name)}`);
  L.push(`- Huella de la maestra: \`${m.master.fingerprints.master}\``);
  L.push(`- Manifiesto: \`${m.manifestId}\` · hash \`${m.manifestHash}\` · estado **${m.approval.status}**`);
  if (m.approval.status === 'approved') {
    L.push(`- Aprobado por ${u(m.approval.approvedBy ?? '')} (nombre declarado; no autentica a ninguna persona) · ${m.approval.approvedAt ?? ''}`);
  }
  L.push(`- Huella de reglas: \`${m.rules.fingerprint}\``);
  L.push('- Integridad: los SHA-256 detectan alteraciones del contenido transportado; no autentican por sí solos que proceda de Figma.');
  L.push(`- Clasificador: \`${m.classifier.id}@${m.classifier.version}\` · OCR: **${m.detectors.ocr}**`);
  L.push(`- Nodos: ${snap.nodes.length} · entidades: ${m.entities.length} · estructurales: ${structural.length} · **pendientes: ${pending.length}**`);
  if (snap.environment.nodesWithMissingFont.length > 0) {
    L.push(`- ⚠️ **Fuentes ausentes** en ${snap.environment.nodesWithMissingFont.length} nodo(s): no se puede aprobar hasta instalarlas y volver a leer.`);
  }
  L.push('');

  L.push('## Entidades propuestas');
  L.push('');
  for (const e of m.entities) {
    L.push(`### \`${e.entityId}\` — ${e.contentNature}`);
    L.push('');
    L.push(`- Estado: **${e.review.status}** · rol: ${e.role ? `\`${e.role}\`` : '_sin asignar_'}`);
    if (e.roleHints.length > 0) {
      L.push(`- Pistas de rol (confianza baja, solo por nombre): ${e.roleHints.map((h) => `\`${h.roleId}\``).join(', ')}`);
    }
    if (e.review.reasons.length > 0) L.push(`- Motivos de revisión: ${e.review.reasons.map((r) => `\`${r}\``).join(', ')}`);
    L.push('- Nodos:');
    for (const id of e.nodeIds) {
      const n = byId.get(id);
      L.push(`  - ${nodeLine(n, id)}`);
      if (n?.text) {
        L.push(`    - Texto: ${u(n.text.characters)}`);
        const fonts = [...new Set(n.text.segments.map((sg) => (sg.fontName ? `${sg.fontName.family} ${sg.fontName.style}` : '?')))];
        L.push(`    - Fuentes: ${fonts.map(u).join(', ')} · autoResize \`${n.text.autoResize}\` · truncation \`${n.text.truncation}\` · campos de estilo \`${n.text.segmentFields}\``);
      }
    }
    L.push('- Evidencia:');
    for (const ev of e.evidence) L.push(`  - \`${ev.kind}\` (${ev.trust}): ${u(ev.detail)}`);
    L.push('');
  }

  L.push('## Composiciones propuestas');
  L.push('');
  if (m.compositions.length === 0) L.push('_Ninguna._');
  for (const c of m.compositions) {
    L.push(`- \`${c.compositionId}\` ${c.nature} · **${c.status}** · entidades: ${c.entityIds.map((x) => `\`${x}\``).join(', ')}`);
    for (const ev of c.evidence) L.push(`  - \`${ev.kind}\` (${ev.trust}): ${u(ev.detail)}`);
  }
  L.push('');

  L.push('## Nodos pendientes de clasificación');
  L.push('');
  if (pending.length === 0) L.push('_Ninguno._');
  for (const d of pending) {
    if (d.kind !== 'pending') continue;
    L.push(`- ${nodeLine(byId.get(d.nodeId), d.nodeId)} — motivos: ${d.reasons.map((r) => `\`${r}\``).join(', ')}`);
    const n = byId.get(d.nodeId);
    if (n?.readErrors.length) L.push(`  - Errores de lectura: ${n.readErrors.map(u).join('; ')}`);
    if (n?.text) L.push(`  - Texto: ${u(n.text.characters)}`);
  }
  L.push('');

  L.push('## Nodos estructurales (justificación)');
  L.push('');
  for (const d of structural) {
    if (d.kind !== 'structural') continue;
    L.push(`- ${nodeLine(byId.get(d.nodeId), d.nodeId)} — \`${d.justification}\` (${d.decidedBy})`);
  }
  L.push('');

  L.push('## Cómo revisar');
  L.push('');
  L.push('1. Edite `review.json`: `status` y `role` por entidad; `statement` si cambia la naturaleza del contenido');
  L.push('   (p. ej. `image_text_undetermined` → `image_embedded_text`, afirmado por usted al no haber OCR).');
  L.push('2. Resuelva cada nodo pendiente (`structural` con justificación o `entity` con rol y naturaleza).');
  L.push('3. Acepte o rechace cada composición.');
  L.push('4. `pcb review-apply` y después `pcb approve --by "<nombre>"`. La aprobación se rechaza si la maestra ha cambiado,');
  L.push('   si quedan pendientes, naturalezas sin determinar, fuentes ausentes o restricciones que relajan invariantes.');
  if (isMock) {
    L.push('---');
    L.push('');
    L.push('**[MOCK] Fin del informe. Datos sintéticos; no utilizar como inventario de una pieza real.**');
    L.push('');
  }
  return L.join('\n');
}
