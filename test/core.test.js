import test from 'node:test';
import assert from 'node:assert/strict';
import { polylineLength, polygonArea, polygonPerimeter, constrainAngle, pointInPolygon, distanceToPolyline, polygonCentroid } from '../public/js/core/geometry.js';
import { parseLength, formatFeetInches, scaleFromPreset, scaleFromCalibration, feetPerUnitFromRatio } from '../public/js/core/scale.js';
import { convertToUnit, conditionQuantities } from '../public/js/core/quantities.js';
import { buildEstimate, estimateToCSV } from '../public/js/core/estimate.js';
import { createProject, createCondition, createSheet, createMeasurement, normalizeProject } from '../public/js/core/model.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('geometry basics', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  close(polylineLength(sq), 30);
  close(polygonPerimeter(sq), 40);
  close(polygonArea(sq), 100);
  close(polygonArea([...sq].reverse()), 100);
  assert.deepEqual(polygonCentroid(sq), { x: 5, y: 5 });
  assert.equal(pointInPolygon({ x: 5, y: 5 }, sq), true);
  assert.equal(pointInPolygon({ x: 15, y: 5 }, sq), false);
  close(distanceToPolyline({ x: 5, y: -3 }, sq), 3);
  const c = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
  close(c.y, 0);
  close(c.x, 10);
  const d = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 9 });
  close(d.x, d.y);
});

test('parseLength handles architectural, decimal and metric input', () => {
  close(parseLength("12'6\""), 12.5);
  close(parseLength("12'-6 1/2\""), 12 + 6.5 / 12);
  close(parseLength("12' 6\""), 12.5);
  close(parseLength('12.5'), 12.5);
  close(parseLength('12.5 ft'), 12.5);
  close(parseLength('150"'), 12.5);
  close(parseLength('6 in'), 0.5);
  close(parseLength("20'"), 20);
  close(parseLength('3/4"'), 0.0625);
  close(parseLength('3.048m'), 10);
  close(parseLength('3048mm'), 10);
  assert.ok(Number.isNaN(parseLength('abc')));
  assert.ok(Number.isNaN(parseLength('')));
});

test('formatFeetInches', () => {
  assert.equal(formatFeetInches(12.5), "12'-6\"");
  assert.equal(formatFeetInches(12 + 6.5 / 12), "12'-6 1/2\"");
  assert.equal(formatFeetInches(0.0625), "0'-0 3/4\"");
  assert.equal(formatFeetInches(11.99999), "12'-0\"");
});

test('scales', () => {
  // 1/4" = 1'-0" on a PDF: 18 points per foot
  close(scaleFromPreset('1/4" = 1\'-0"', 72).feetPerUnit, 1 / 18);
  // 1" = 20' on a PDF: 72 points per 20 feet
  close(scaleFromPreset('1" = 20\'', 72).feetPerUnit, 20 / 72);
  close(feetPerUnitFromRatio(48, 150), 48 / 1800);
  close(scaleFromCalibration(360, 20).feetPerUnit, 20 / 360);
  assert.equal(scaleFromCalibration(0, 20), null);
  assert.equal(scaleFromPreset('nope'), null);
});

test('unit conversions', () => {
  close(convertToUnit(100, { type: 'linear', unit: 'LF' }), 100);
  close(convertToUnit(100, { type: 'linear', unit: 'SF', heightFt: 9 }), 900);
  close(convertToUnit(27, { type: 'linear', unit: 'CY', widthIn: 12, depthIn: 12 }), 1);
  close(convertToUnit(81, { type: 'area', unit: 'CY', thicknessIn: 4 }), 1);
  close(convertToUnit(900, { type: 'area', unit: 'SY' }), 100);
  close(convertToUnit(1500, { type: 'area', unit: 'SQ' }), 15);
});

function sampleProject() {
  const p = createProject({ name: 'Test, "Quoted"' });
  const s = createSheet({ fileId: 'f1', fileName: 'A101.pdf', width: 2592, height: 1728 });
  s.scale = scaleFromPreset('1/4" = 1\'-0"', 72); // 18 units per foot
  const unscaled = createSheet({ fileId: 'f1', fileName: 'A101.pdf', pageIndex: 1, width: 100, height: 100 });
  p.sheets.push(s, unscaled);
  const wall = createCondition({ name: 'Partition', division: '09', type: 'linear', unit: 'SF', heightFt: 10, wastePct: 10, material: 2, labor: 3 });
  const slab = createCondition({ name: 'Slab', division: '03', type: 'area', unit: 'SF', material: 1 });
  const doors = createCondition({ name: 'Doors', division: '08', type: 'count', unit: 'EA', material: 500, labor: 100 });
  p.conditions.push(wall, slab, doors);
  // 20' wall (360 units) + a measurement on an unscaled sheet
  p.measurements.push(createMeasurement({ sheetId: s.id, conditionId: wall.id, points: [{ x: 0, y: 0 }, { x: 360, y: 0 }] }));
  p.measurements.push(createMeasurement({ sheetId: unscaled.id, conditionId: wall.id, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }));
  // 10'x10' slab with a 5'x2' deduction
  p.measurements.push(createMeasurement({ sheetId: s.id, conditionId: slab.id, points: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 180 }, { x: 0, y: 180 }] }));
  p.measurements.push(createMeasurement({ sheetId: s.id, conditionId: slab.id, deduct: true, points: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 36 }, { x: 0, y: 36 }] }));
  // 3 doors, counts work even on unscaled sheets
  for (const sid of [s.id, s.id, unscaled.id]) {
    p.measurements.push(createMeasurement({ sheetId: sid, conditionId: doors.id, points: [{ x: 1, y: 1 }] }));
  }
  p.markups = { taxPct: 10, overheadPct: 10, profitPct: 10, contingencyPct: 0, bondPct: 0 };
  return { p, wall, slab, doors };
}

test('condition quantities', () => {
  const { p, wall, slab, doors } = sampleProject();
  const byId = new Map(p.sheets.map((s) => [s.id, s]));
  const w = conditionQuantities(wall, p.measurements, byId);
  close(w.base, 20);
  close(w.quantity, 200);
  close(w.orderQuantity, 220);
  assert.equal(w.measurementCount, 2);
  assert.equal(w.unscaledCount, 1);
  const s = conditionQuantities(slab, p.measurements, byId);
  close(s.base, 90);
  close(s.perimeter, 40);
  assert.equal(conditionQuantities(doors, p.measurements, byId).quantity, 3);
});

test('estimate totals and markups', () => {
  const { p } = sampleProject();
  const est = buildEstimate(p);
  assert.deepEqual(est.groups.map((g) => g.code), ['03', '08', '09']);
  // material: 220*2 + 90*1 + 3*500 = 2030; labor: 220*3 + 300 = 960
  close(est.totals.material, 2030);
  close(est.totals.labor, 960);
  close(est.totals.direct, 2990);
  close(est.totals.tax, 203);
  close(est.totals.overhead, 319.3);
  close(est.totals.profit, 351.23);
  close(est.totals.grandTotal, 3863.53);
  const csv = estimateToCSV(p, est);
  assert.match(csv, /^Project,"Test, ""Quoted"""/);
  assert.match(csv, /GRAND TOTAL,(,){13}3863\.53/);
});

test('normalizeProject fills defaults', () => {
  const p = normalizeProject({ info: { name: 'Old' }, conditions: [{ id: 'c1', name: 'X', type: 'area' }] });
  assert.equal(p.info.name, 'Old');
  assert.equal(p.conditions[0].id, 'c1');
  assert.equal(p.conditions[0].unit, 'SF');
  assert.equal(p.markups.overheadPct, 10);
  assert.throws(() => normalizeProject(null));
});
