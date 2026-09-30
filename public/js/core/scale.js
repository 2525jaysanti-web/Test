// Drawing scales, length parsing and formatting.
//
// Every sheet stores `unitsPerInch` (72 for PDF pages, which use points; the DPI for raster
// images) and, once set, a `scale` of { feetPerUnit, label }. Quantities are always computed
// internally in feet.

/** `ratio` is real length / paper length (e.g. 1/4" = 1'-0" is 48). */
export const SCALE_PRESETS = [
  { group: 'Architectural', label: '1/32" = 1\'-0"', ratio: 384 },
  { group: 'Architectural', label: '1/16" = 1\'-0"', ratio: 192 },
  { group: 'Architectural', label: '3/32" = 1\'-0"', ratio: 128 },
  { group: 'Architectural', label: '1/8" = 1\'-0"', ratio: 96 },
  { group: 'Architectural', label: '3/16" = 1\'-0"', ratio: 64 },
  { group: 'Architectural', label: '1/4" = 1\'-0"', ratio: 48 },
  { group: 'Architectural', label: '3/8" = 1\'-0"', ratio: 32 },
  { group: 'Architectural', label: '1/2" = 1\'-0"', ratio: 24 },
  { group: 'Architectural', label: '3/4" = 1\'-0"', ratio: 16 },
  { group: 'Architectural', label: '1" = 1\'-0"', ratio: 12 },
  { group: 'Architectural', label: '1 1/2" = 1\'-0"', ratio: 8 },
  { group: 'Architectural', label: '3" = 1\'-0"', ratio: 4 },
  { group: 'Engineering', label: '1" = 10\'', ratio: 120 },
  { group: 'Engineering', label: '1" = 20\'', ratio: 240 },
  { group: 'Engineering', label: '1" = 30\'', ratio: 360 },
  { group: 'Engineering', label: '1" = 40\'', ratio: 480 },
  { group: 'Engineering', label: '1" = 50\'', ratio: 600 },
  { group: 'Engineering', label: '1" = 60\'', ratio: 720 },
  { group: 'Engineering', label: '1" = 100\'', ratio: 1200 },
  { group: 'Metric', label: '1:20', ratio: 20 },
  { group: 'Metric', label: '1:50', ratio: 50 },
  { group: 'Metric', label: '1:100', ratio: 100 },
  { group: 'Metric', label: '1:200', ratio: 200 },
  { group: 'Metric', label: '1:500', ratio: 500 },
];

/** Feet of real-world length represented by one sheet unit at the given paper ratio. */
export function feetPerUnitFromRatio(ratio, unitsPerInch = 72) {
  return ratio / (12 * unitsPerInch);
}

export function scaleFromPreset(label, unitsPerInch = 72) {
  const preset = SCALE_PRESETS.find((p) => p.label === label);
  if (!preset) return null;
  return { feetPerUnit: feetPerUnitFromRatio(preset.ratio, unitsPerInch), label: preset.label };
}

/** Scale from a calibration: `unitDistance` sheet units correspond to `realFeet` feet. */
export function scaleFromCalibration(unitDistance, realFeet) {
  if (!(unitDistance > 0) || !(realFeet > 0)) return null;
  return { feetPerUnit: realFeet / unitDistance, label: `Calibrated (${formatFeetInches(realFeet)})` };
}

const FRACTION = String.raw`(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?|(\d+)\/(\d+)`;

function parseNumberWithFraction(str) {
  const m = new RegExp(`^(?:${FRACTION})$`).exec(str.trim());
  if (!m) return NaN;
  if (m[4] !== undefined) return Number(m[4]) / Number(m[5]);
  let v = Number(m[1]);
  if (m[2] !== undefined) v += Number(m[2]) / Number(m[3]);
  return v;
}

/**
 * Parse a user-entered length into feet. Accepts e.g.
 * `12'6"`, `12'-6 1/2"`, `12' 6"`, `12.5`, `12.5 ft`, `150"`, `6 in`, `3.5m`, `300mm`, `45cm`.
 * A bare number is interpreted as feet. Returns NaN when the input cannot be parsed.
 */
export function parseLength(input) {
  if (input === null || input === undefined) return NaN;
  const s = String(input).trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!s) return NaN;

  const metric = /^(\d+(?:\.\d+)?)\s*(mm|cm|m)$/.exec(s);
  if (metric) {
    const meters = Number(metric[1]) / { mm: 1000, cm: 100, m: 1 }[metric[2]];
    return meters / 0.3048;
  }

  const ftIn = /^(?:(.+?)\s*(?:'|ft|feet|foot))?\s*-?\s*(?:(.+?)\s*(?:"|in|inch|inches))?$/.exec(s);
  if (ftIn && (ftIn[1] !== undefined || ftIn[2] !== undefined)) {
    const ft = ftIn[1] !== undefined ? parseNumberWithFraction(ftIn[1]) : 0;
    const inch = ftIn[2] !== undefined ? parseNumberWithFraction(ftIn[2]) : 0;
    if (Number.isNaN(ft) || Number.isNaN(inch)) return NaN;
    return ft + inch / 12;
  }

  return parseNumberWithFraction(s);
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/** Format feet as architectural feet-inches, rounded to 1/`denominator` inch. */
export function formatFeetInches(feet, denominator = 8) {
  if (!Number.isFinite(feet)) return '—';
  const sign = feet < 0 ? '-' : '';
  let totalUnits = Math.round(Math.abs(feet) * 12 * denominator);
  const ft = Math.floor(totalUnits / (12 * denominator));
  totalUnits -= ft * 12 * denominator;
  const inch = Math.floor(totalUnits / denominator);
  const frac = totalUnits - inch * denominator;
  let inchStr = String(inch);
  if (frac) {
    const g = gcd(frac, denominator);
    inchStr += ` ${frac / g}/${denominator / g}`;
  }
  return `${sign}${ft}'-${inchStr}"`;
}
