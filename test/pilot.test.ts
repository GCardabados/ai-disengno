// Piloto compartible: resolución de safe zones desde plantillas de Figma y comprobación de entorno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSafeZoneTemplateScript, resolveSafeZoneTemplate, type SafeZoneTemplates, type TemplateLayer } from '../src/figma/safe-zone-template.ts';
import { compareVersions, satisfiesRange } from '../src/doctor.ts';

const sh = (name: string, x: number, y: number, w: number, h: number) => ({ id: name, name, type: 'RECTANGLE', visible: true, rect: { x, y, w, h } });
const layer = (name: string, shapes: TemplateLayer['shapes']): TemplateLayer => ({ id: `L-${name}`, name, type: 'GROUP', visible: true, shapes });
const inv = (templates: SafeZoneTemplates['templates']): SafeZoneTemplates => ({
  schema: 'pcb.safe-zone-templates.v1', sourceNodeId: '1:1', sourceName: 'MOCK', sourceType: 'SECTION', page: null, templates,
});
const ui = layer('UI', [sh('Square (allowed)', 88, 118, 904, 844), sh('top', 90, 0, 900, 120), sh('right', 990, 0, 90, 1080)]);
const sq = (id: string, layers: TemplateLayer[]) => ({ id, name: `Post 1:1 ${id}`, width: 1080, height: 1080, layers });

test('safe zone: sin plantilla del tamaño exacto → none (nunca se escala otra)', () => {
  const r = resolveSafeZoneTemplate(inv([sq('a', [ui])]), { width: 1200, height: 1200 });
  assert.equal(r.status, 'none');
  assert.equal(r.allowed, null);
});

test('safe zone: plantilla única → zona permitida y exclusiones en coordenadas del destino (recortadas al frame)', () => {
  const r = resolveSafeZoneTemplate(inv([sq('a', [ui])]), { width: 1080, height: 1080 });
  assert.equal(r.status, 'applicable');
  assert.deepEqual(r.allowed, { x: 88, y: 118, width: 904, height: 844 });
  assert.deepEqual(r.exclusions.map((e) => e.name), ['top', 'right']);
});

test('safe zone: varias capas o plantillas distintas del mismo tamaño → ambiguous; la pista lo resuelve', () => {
  const grid = layer('Grid', [sh('left', 0, 0, 135, 1080)]);
  assert.equal(resolveSafeZoneTemplate(inv([sq('a', [ui, grid])]), { width: 1080, height: 1080 }).status, 'ambiguous');
  assert.equal(resolveSafeZoneTemplate(inv([sq('a', [ui, grid])]), { width: 1080, height: 1080 }, { layer: 'ui' }).status, 'applicable');
  const other = sq('b', [layer('UI', [sh('Square', 0, 200, 1080, 680)])]);
  assert.equal(resolveSafeZoneTemplate(inv([sq('a', [ui]), other]), { width: 1080, height: 1080 }).status, 'ambiguous');
  const r = resolveSafeZoneTemplate(inv([sq('a', [ui]), other]), { width: 1080, height: 1080 }, { template: '1:1 b' });
  assert.equal(r.status, 'applicable');
  assert.equal(r.chosen?.templateId, 'b');
});

test('safe zone: copias idénticas de la misma guía no son ambiguas', () => {
  const r = resolveSafeZoneTemplate(inv([sq('a', [ui]), sq('b', [ui])]), { width: 1080, height: 1080 });
  assert.equal(r.status, 'applicable');
});

test('safe zone: el script de lectura no escribe en Figma', () => {
  const code = buildSafeZoneTemplateScript('67:75');
  for (const w of ['.remove(', '.resize(', 'appendChild', '.x =', '.y =', 'createSection', 'setCurrentPage']) assert.ok(!code.includes(w), w);
});

test('doctor: comparación de versiones y rangos de engines', () => {
  assert.equal(compareVersions('24.21.0', '24.21.0'), 0);
  assert.equal(compareVersions('v25.6.1', '24.21.0'), 1);
  assert.ok(satisfiesRange('24.21.0', '>=24.21.0 <25'));
  assert.ok(satisfiesRange('24.30.1', '>=24.21.0 <25'));
  assert.ok(!satisfiesRange('25.6.1', '>=24.21.0 <25'));
  assert.ok(!satisfiesRange('24.20.9', '>=24.21.0 <25'));
});
