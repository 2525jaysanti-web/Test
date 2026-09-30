// Builds a priced estimate from a project's conditions and measurements.
import { DIVISIONS, divisionName } from './catalog.js';
import { conditionQuantities } from './quantities.js';

/**
 * Markups are applied in sequence:
 *   direct cost = material + labor + equipment
 *   tax         = material × tax%
 *   overhead    = (direct + tax) × overhead%
 *   profit      = (direct + tax + overhead) × profit%
 *   contingency = (… + profit) × contingency%
 *   bond        = (… + contingency) × bond%
 */
export function buildEstimate(project) {
  const sheetsById = new Map(project.sheets.map((s) => [s.id, s]));
  const lines = project.conditions.map((condition) => {
    const q = conditionQuantities(condition, project.measurements, sheetsById);
    const material = q.orderQuantity * (condition.material || 0);
    const labor = q.orderQuantity * (condition.labor || 0);
    const equipment = q.orderQuantity * (condition.equipment || 0);
    return {
      condition,
      ...q,
      unit: condition.unit,
      wastePct: condition.wastePct || 0,
      unitCost: (condition.material || 0) + (condition.labor || 0) + (condition.equipment || 0),
      material,
      labor,
      equipment,
      total: material + labor + equipment,
    };
  });

  const order = new Map(DIVISIONS.map((d, i) => [d.code, i]));
  const groupsByCode = new Map();
  for (const line of lines) {
    const code = line.condition.division;
    if (!groupsByCode.has(code)) {
      groupsByCode.set(code, { code, name: divisionName(code), lines: [], material: 0, labor: 0, equipment: 0, total: 0 });
    }
    const g = groupsByCode.get(code);
    g.lines.push(line);
    g.material += line.material;
    g.labor += line.labor;
    g.equipment += line.equipment;
    g.total += line.total;
  }
  const groups = [...groupsByCode.values()].sort((a, b) => (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99));
  for (const g of groups) g.lines.sort((a, b) => a.condition.name.localeCompare(b.condition.name));

  const m = project.markups || {};
  const material = sum(lines, 'material');
  const labor = sum(lines, 'labor');
  const equipment = sum(lines, 'equipment');
  const direct = material + labor + equipment;
  const tax = material * pct(m.taxPct);
  let running = direct + tax;
  const overhead = running * pct(m.overheadPct);
  running += overhead;
  const profit = running * pct(m.profitPct);
  running += profit;
  const contingency = running * pct(m.contingencyPct);
  running += contingency;
  const bond = running * pct(m.bondPct);
  running += bond;

  return {
    lines,
    groups,
    totals: { material, labor, equipment, direct, tax, overhead, profit, contingency, bond, grandTotal: running },
  };
}

function sum(items, key) {
  return items.reduce((s, x) => s + x[key], 0);
}

function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : 0;
}

function csvCell(v) {
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function estimateToCSV(project, estimate = buildEstimate(project)) {
  const rows = [
    ['Project', project.info.name],
    ['Client', project.info.client],
    ['Location', project.info.location],
    ['Bid date', project.info.bidDate],
    ['Estimator', project.info.estimator],
    [],
    ['Division', 'Item', 'Measured', 'Measured unit', 'Quantity', 'Unit', 'Waste %', 'Order qty',
      'Material $/unit', 'Labor $/unit', 'Equip $/unit', 'Material', 'Labor', 'Equipment', 'Total'],
  ];
  for (const g of estimate.groups) {
    for (const l of g.lines) {
      const c = l.condition;
      rows.push([`${g.code} ${g.name}`, c.name, l.base, l.baseUnit, l.quantity, l.unit, l.wastePct, l.orderQuantity,
        c.material, c.labor, c.equipment, l.material, l.labor, l.equipment, l.total]);
    }
    rows.push([`${g.code} subtotal`, '', '', '', '', '', '', '', '', '', '', g.material, g.labor, g.equipment, g.total]);
  }
  const t = estimate.totals;
  const mk = project.markups;
  rows.push(
    [],
    ['Direct cost', '', '', '', '', '', '', '', '', '', '', t.material, t.labor, t.equipment, t.direct],
    [`Sales tax on material (${mk.taxPct}%)`, ...blank(13), t.tax],
    [`Overhead (${mk.overheadPct}%)`, ...blank(13), t.overhead],
    [`Profit (${mk.profitPct}%)`, ...blank(13), t.profit],
    [`Contingency (${mk.contingencyPct}%)`, ...blank(13), t.contingency],
    [`Bond (${mk.bondPct}%)`, ...blank(13), t.bond],
    ['GRAND TOTAL', ...blank(13), t.grandTotal],
  );
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

function blank(n) {
  return Array(n).fill('');
}
