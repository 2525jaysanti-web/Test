// Project data model: factories and normalization for saved projects.
import { PALETTE, UNITS_BY_TYPE } from './catalog.js';

export const PROJECT_VERSION = 1;

export function uid(prefix = 'id') {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand.replace(/-/g, '').slice(0, 12)}`;
}

export const DEFAULT_MARKUPS = {
  taxPct: 8.25, // sales tax, applied to material only
  overheadPct: 10,
  profitPct: 8,
  contingencyPct: 5,
  bondPct: 1.5,
};

export function createProject(info = {}) {
  return {
    version: PROJECT_VERSION,
    id: uid('prj'),
    info: {
      name: 'Untitled Project',
      client: '',
      location: '',
      bidDate: '',
      estimator: '',
      notes: '',
      ...info,
    },
    markups: { ...DEFAULT_MARKUPS },
    files: [], // { id, name, mime } — binary content lives in IndexedDB
    sheets: [],
    conditions: [],
    measurements: [],
  };
}

export function createSheet({ fileId, fileName, pageIndex = 0, name, width, height, unitsPerInch = 72 }) {
  return {
    id: uid('sht'),
    fileId,
    fileName,
    pageIndex,
    name: name || `${fileName} — p${pageIndex + 1}`,
    width,
    height,
    unitsPerInch,
    scale: null, // { feetPerUnit, label }
  };
}

export function createCondition(fields = {}, existing = []) {
  const type = fields.type in UNITS_BY_TYPE ? fields.type : 'linear';
  const unit = UNITS_BY_TYPE[type].includes(fields.unit) ? fields.unit : UNITS_BY_TYPE[type][0];
  return {
    id: uid('cnd'),
    name: fields.name || 'New condition',
    division: fields.division || '01',
    type,
    unit,
    color: fields.color || PALETTE[existing.length % PALETTE.length],
    heightFt: num(fields.heightFt),
    widthIn: num(fields.widthIn),
    depthIn: num(fields.depthIn),
    thicknessIn: num(fields.thicknessIn),
    wastePct: num(fields.wastePct),
    material: num(fields.material),
    labor: num(fields.labor),
    equipment: num(fields.equipment),
    notes: fields.notes || '',
    visible: true,
  };
}

export function createMeasurement({ sheetId, conditionId, points, deduct = false }) {
  return {
    id: uid('msr'),
    sheetId,
    conditionId,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    deduct: Boolean(deduct),
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Fill in any fields missing from an older or hand-edited project file. */
export function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a project file');
  const base = createProject();
  const project = {
    ...base,
    ...raw,
    info: { ...base.info, ...(raw.info || {}) },
    markups: { ...base.markups, ...(raw.markups || {}) },
    files: Array.isArray(raw.files) ? raw.files : [],
    sheets: Array.isArray(raw.sheets) ? raw.sheets : [],
    measurements: Array.isArray(raw.measurements) ? raw.measurements : [],
  };
  project.conditions = (Array.isArray(raw.conditions) ? raw.conditions : []).map((c, i, all) => ({
    ...createCondition(c, all.slice(0, i)),
    ...c,
  }));
  project.version = PROJECT_VERSION;
  return project;
}
