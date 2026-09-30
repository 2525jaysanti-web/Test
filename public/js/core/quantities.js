// Converts measurements on scaled sheets into condition quantities.
import { polygonArea, polygonPerimeter, polylineLength } from './geometry.js';

export const BASE_UNIT = { linear: 'LF', area: 'SF', count: 'EA' };

/**
 * Base quantity of one measurement: LF for linear, SF for area (negative when a deduction),
 * EA for count. Returns null when the sheet has no scale yet (counts need no scale).
 */
export function measurementBase(measurement, sheet, type) {
  if (type === 'count') return measurement.points.length;
  const fpu = sheet?.scale?.feetPerUnit;
  if (!(fpu > 0)) return null;
  if (type === 'linear') return polylineLength(measurement.points) * fpu;
  if (type === 'area') {
    const sf = polygonArea(measurement.points) * fpu * fpu;
    return measurement.deduct ? -sf : sf;
  }
  return null;
}

/** Perimeter (LF) of an area measurement — handy for base, edge forms, etc. */
export function measurementPerimeter(measurement, sheet) {
  const fpu = sheet?.scale?.feetPerUnit;
  if (!(fpu > 0)) return null;
  return polygonPerimeter(measurement.points) * fpu;
}

/** Convert a base quantity (LF/SF/EA) into the condition's priced unit. */
export function convertToUnit(base, condition) {
  const { type, unit } = condition;
  if (type === 'linear') {
    if (unit === 'SF') return base * (condition.heightFt || 0);
    if (unit === 'CY') return (base * ((condition.widthIn || 0) / 12) * ((condition.depthIn || 0) / 12)) / 27;
    return base;
  }
  if (type === 'area') {
    if (unit === 'SY') return base / 9;
    if (unit === 'SQ') return base / 100;
    if (unit === 'CY') return (base * ((condition.thicknessIn || 0) / 12)) / 27;
    return base;
  }
  return base;
}

/**
 * Totals for one condition across all sheets.
 * @returns {{ base:number, baseUnit:string, perimeter:number, quantity:number, orderQuantity:number,
 *            measurementCount:number, unscaledCount:number }}
 */
export function conditionQuantities(condition, measurements, sheetsById) {
  let base = 0;
  let perimeter = 0;
  let measurementCount = 0;
  let unscaledCount = 0;
  for (const m of measurements) {
    if (m.conditionId !== condition.id) continue;
    measurementCount++;
    const sheet = sheetsById.get(m.sheetId);
    const q = measurementBase(m, sheet, condition.type);
    if (q === null) {
      unscaledCount++;
      continue;
    }
    base += q;
    if (condition.type === 'area') {
      const p = measurementPerimeter(m, sheet);
      if (p !== null && !m.deduct) perimeter += p;
    }
  }
  const quantity = convertToUnit(base, condition);
  const orderQuantity = quantity * (1 + (condition.wastePct || 0) / 100);
  return {
    base,
    baseUnit: BASE_UNIT[condition.type],
    perimeter,
    quantity,
    orderQuantity,
    measurementCount,
    unscaledCount,
  };
}
