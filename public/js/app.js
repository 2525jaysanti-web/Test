// TakeOff Pro — application controller: state, persistence, and UI wiring.
import * as pdfjsLib from '/vendor/pdfjs/pdf.min.mjs';
import { ASSEMBLIES, DIVISIONS, UNIT_HELP, UNITS_BY_TYPE, divisionName } from './core/catalog.js';
import { buildEstimate, estimateToCSV } from './core/estimate.js';
import { createCondition, createMeasurement, createProject, createSheet, normalizeProject, uid } from './core/model.js';
import { conditionQuantities, convertToUnit, measurementBase } from './core/quantities.js';
import { SCALE_PRESETS, formatFeetInches, parseLength, scaleFromCalibration, scaleFromPreset } from './core/scale.js';
import { blobToDataURL, dataURLToBlob, store } from './store.js';
import { DrawingViewer } from './viewer.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const TYPE_ICON = { linear: '╱', area: '▱', count: '●' };
const IMAGE_DEFAULT_DPI = 150;

// ------------------------------------------------------------------ state
const state = {
  project: null,
  sheetId: null,
  conditionId: null,
  selectedId: null,
  tool: 'pan',
  view: 'takeoff',
  undo: [],
  redo: [],
  pendingCalibration: null,
};
const sources = new Map(); // fileId → Promise<{kind:'pdf', doc} | {kind:'image', image}>

const viewer = new DrawingViewer($('#viewport'), {
  onMeasure: addMeasurement,
  onCalibrate: openCalibrateDialog,
  onSelect: (id) => {
    state.selectedId = id;
    renderSelection();
  },
  onEdit: (id, points) => commit(() => {
    const m = state.project.measurements.find((x) => x.id === id);
    if (m) m.points = points;
  }),
  onCursor: (p) => {
    const fpu = currentSheet()?.scale?.feetPerUnit;
    $('#statusCursor').textContent = p && fpu ? `X ${formatFeetInches(p.x * fpu, 2)}  Y ${formatFeetInches(p.y * fpu, 2)}` : '';
  },
  onDraftChange: (text) => ($('#statusDraft').textContent = text),
  onZoom: (z) => ($('#zoomLabel').textContent = `${Math.round(z * 100)}%`),
});

// ------------------------------------------------------------------ helpers
const currentSheet = () => state.project.sheets.find((s) => s.id === state.sheetId) ?? null;
const activeCondition = () => state.project.conditions.find((c) => c.id === state.conditionId) ?? null;
const sheetsById = () => new Map(state.project.sheets.map((s) => [s.id, s]));
const conditionsById = () => new Map(state.project.conditions.map((c) => [c.id, c]));

function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = 'toast'), 2800);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(s) {
  return (s || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'project';
}

// ------------------------------------------------------------------ persistence & undo
let saveTimer = null;
function persist() {
  $('#saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await store.saveProject(state.project);
      await store.setMeta('currentProjectId', state.project.id);
      $('#saveState').textContent = 'Saved';
    } catch (e) {
      console.error(e);
      $('#saveState').textContent = 'Save failed';
      toast(`Could not save: ${e.message}`, 'error');
    }
  }, 400);
}

function snapshot() {
  const { sheets, conditions, measurements, markups } = state.project;
  return JSON.stringify({ sheets, conditions, measurements, markups });
}

function restore(snap) {
  Object.assign(state.project, JSON.parse(snap));
  if (!state.project.sheets.some((s) => s.id === state.sheetId)) state.sheetId = state.project.sheets[0]?.id ?? null;
  if (!activeCondition()) state.conditionId = null;
  if (!state.project.measurements.some((m) => m.id === state.selectedId)) state.selectedId = null;
}

/** Apply a mutation to the project with undo support, then refresh the UI. */
function commit(fn) {
  const before = snapshot();
  fn();
  if (snapshot() === before) return;
  state.undo.push(before);
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  changed();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  restore(state.undo.pop());
  changed({ sheetChanged: true });
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  restore(state.redo.pop());
  changed({ sheetChanged: true });
}

function changed({ sheetChanged = false } = {}) {
  persist();
  renderSheets();
  renderConditions();
  renderQuantities();
  renderSelection();
  renderToolbar();
  if (sheetChanged) showSheet(state.sheetId, { keepView: true });
  else refreshViewerData();
  if (state.view === 'estimate') renderEstimate();
}

// ------------------------------------------------------------------ project lifecycle
async function loadProject(project) {
  state.project = normalizeProject(project);
  state.undo = [];
  state.redo = [];
  state.selectedId = null;
  state.conditionId = null;
  state.sheetId = state.project.sheets[0]?.id ?? null;
  sources.clear();
  setTool('pan');
  renderAll();
  await showSheet(state.sheetId);
}

async function newProject() {
  if (!confirm('Start a new project? The current project stays saved in this browser.')) return;
  await loadProject(createProject());
  persist();
  setView('project');
  $('#projectForm [name=name]').select();
}

async function exportProject() {
  toast('Preparing project file…');
  const embeddedFiles = {};
  for (const f of state.project.files) {
    const blob = await store.getFile(f.id);
    if (blob) embeddedFiles[f.id] = await blobToDataURL(blob);
  }
  const data = { format: 'takeoff-pro', ...state.project, embeddedFiles };
  download(`${safeFileName(state.project.info.name)}.takeoff.json`, JSON.stringify(data), 'application/json');
}

async function importProject(file) {
  try {
    const raw = JSON.parse(await file.text());
    const embedded = raw.embeddedFiles || {};
    delete raw.embeddedFiles;
    delete raw.format;
    const project = normalizeProject(raw);
    const existing = await store.getProject(project.id);
    if (existing && !confirm(`"${existing.info.name}" already exists in this browser. Replace it with the file's version?`)) {
      project.id = uid('prj');
    }
    for (const [id, url] of Object.entries(embedded)) {
      const meta = project.files.find((f) => f.id === id);
      await store.saveFile(id, await dataURLToBlob(url), meta?.name);
    }
    await store.saveProject(project);
    await loadProject(project);
    persist();
    toast(`Opened "${project.info.name}"`);
  } catch (e) {
    console.error(e);
    toast(`Could not open project: ${e.message}`, 'error');
  }
}

// ------------------------------------------------------------------ drawings
async function getSource(sheet) {
  if (!sources.has(sheet.fileId)) {
    sources.set(sheet.fileId, (async () => {
      const blob = await store.getFile(sheet.fileId);
      if (!blob) throw new Error(`Drawing file "${sheet.fileName}" is missing`);
      if (blob.type === 'application/pdf' || /\.pdf$/i.test(sheet.fileName)) {
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        return { kind: 'pdf', doc };
      }
      return { kind: 'image', image: await loadImage(blob) };
    })());
  }
  const src = await sources.get(sheet.fileId);
  if (src.kind === 'pdf') return { kind: 'pdf', page: await src.doc.getPage(sheet.pageIndex + 1) };
  return src;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unsupported image'));
    img.src = URL.createObjectURL(blob);
  });
}

async function addDrawingFiles(fileList) {
  const files = [...fileList].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || f.type.startsWith('image/'));
  if (!files.length) {
    toast('Please choose PDF, PNG, JPG or WebP files', 'error');
    return;
  }
  const newSheets = [];
  const newFiles = [];
  for (const file of files) {
    toast(`Loading ${file.name}…`);
    try {
      const fileId = uid('fil');
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      await store.saveFile(fileId, file, file.name);
      newFiles.push({ id: fileId, name: file.name, mime: file.type || (isPdf ? 'application/pdf' : '') });
      if (isPdf) {
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        sources.set(fileId, Promise.resolve({ kind: 'pdf', doc }));
        for (let i = 0; i < doc.numPages; i++) {
          const page = await doc.getPage(i + 1);
          const vp = page.getViewport({ scale: 1 });
          const sheet = createSheet({ fileId, fileName: file.name, pageIndex: i, width: vp.width, height: vp.height, unitsPerInch: 72 });
          sheet.name = (await guessSheetName(page)) || (doc.numPages > 1 ? `${stripExt(file.name)} — p${i + 1}` : stripExt(file.name));
          newSheets.push(sheet);
        }
      } else {
        const image = await loadImage(file);
        sources.set(fileId, Promise.resolve({ kind: 'image', image }));
        newSheets.push(createSheet({
          fileId, fileName: file.name, width: image.naturalWidth, height: image.naturalHeight,
          unitsPerInch: IMAGE_DEFAULT_DPI, name: stripExt(file.name),
        }));
      }
    } catch (e) {
      console.error(e);
      toast(`Could not read ${file.name}: ${e.message}`, 'error');
    }
  }
  if (!newSheets.length) return;
  commit(() => {
    state.project.files.push(...newFiles);
    state.project.sheets.push(...newSheets);
  });
  toast(`Added ${newSheets.length} sheet${newSheets.length > 1 ? 's' : ''}. Set the scale before measuring.`);
  await showSheet(newSheets[0].id);
}

const stripExt = (n) => n.replace(/\.[^.]+$/, '');

/** Look for a sheet number like "A-101" or "S2.01" in the PDF text, preferring the title block corner. */
async function guessSheetName(page) {
  try {
    const vp = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    const re = /^(?:[A-Z]{1,2}[-.]?\d{1,3}(?:\.\d{1,2})?[A-Z]?)$/;
    let best = null;
    for (const it of items) {
      const s = it.str.trim();
      if (!re.test(s)) continue;
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const size = Math.hypot(it.transform[2], it.transform[3]);
      // score: big text near the bottom-right corner wins
      const score = size * 2 + (x / vp.width) * 10 + (y / vp.height) * 10;
      if (!best || score > best.score) best = { s, score };
    }
    return best?.s ?? null;
  } catch {
    return null;
  }
}

async function showSheet(id, { keepView = false } = {}) {
  state.sheetId = id;
  const sheet = currentSheet();
  $('#viewportEmpty').hidden = Boolean(sheet);
  renderSheets();
  renderToolbar();
  renderQuantities();
  if (!sheet) {
    await viewer.showSheet(null);
    return;
  }
  if (keepView && viewer.sheet?.id === sheet.id) {
    viewer.sheet = sheet;
    refreshViewerData();
    return;
  }
  try {
    const source = await getSource(sheet);
    if (state.sheetId !== id) return; // user moved on while loading
    await viewer.showSheet(sheet, source);
    refreshViewerData();
    await viewer.render();
  } catch (e) {
    console.error(e);
    toast(e.message, 'error');
  }
}

function refreshViewerData() {
  const sheet = currentSheet();
  if (viewer.sheet && sheet) viewer.sheet = sheet; // keep scale in sync after edits
  viewer.showLabels = $('#chkLabels').checked;
  viewer.selectedId = state.selectedId;
  viewer.setData(state.project.measurements.filter((m) => m.sheetId === state.sheetId), conditionsById());
}

function deleteSheet(id) {
  const sheet = state.project.sheets.find((s) => s.id === id);
  const n = state.project.measurements.filter((m) => m.sheetId === id).length;
  if (!confirm(`Remove sheet "${sheet.name}"${n ? ` and its ${n} measurement${n > 1 ? 's' : ''}` : ''}?`)) return;
  const idx = state.project.sheets.indexOf(sheet);
  commit(() => {
    const p = state.project;
    p.sheets = p.sheets.filter((s) => s.id !== id);
    p.measurements = p.measurements.filter((m) => m.sheetId !== id);
    // files are kept (not deleted from IndexedDB) so undo can bring the sheet back
  });
  if (state.sheetId === id) showSheet(state.project.sheets[Math.min(idx, state.project.sheets.length - 1)]?.id ?? null);
}

// ------------------------------------------------------------------ tools & measuring
function setTool(tool) {
  if (tool === 'measure' && !activeCondition()) {
    toast('Select or create a condition first');
    tool = 'pan';
  }
  if (tool === 'calibrate' && !currentSheet()) tool = 'pan';
  state.tool = tool;
  const c = activeCondition();
  viewer.setTool(tool, { type: c?.type, color: c?.color });
  renderToolbar();
}

function addMeasurement(points) {
  const c = activeCondition();
  const sheet = currentSheet();
  if (!c || !sheet) return;
  if (c.type !== 'count' && !sheet.scale) toast('Heads up: this sheet has no scale yet — quantities will update once it is set.');
  commit(() => {
    state.project.measurements.push(createMeasurement({
      sheetId: sheet.id,
      conditionId: c.id,
      points,
      deduct: c.type === 'area' && $('#chkDeduct').checked,
    }));
  });
}

function deleteSelected() {
  if (!state.selectedId) return;
  const id = state.selectedId;
  state.selectedId = null;
  commit(() => (state.project.measurements = state.project.measurements.filter((m) => m.id !== id)));
}

function openCalibrateDialog(unitDistance) {
  state.pendingCalibration = unitDistance;
  $('#calUnits').textContent = fmt(unitDistance, 1);
  $('#calError').hidden = true;
  $('#calLength').value = '';
  $('#calibrateDialog [name=all]').checked = false;
  $('#calibrateDialog').showModal();
  $('#calLength').focus();
}

function applyScale(scale, { allSheets = false, sameFileOnly = false } = {}) {
  const sheet = currentSheet();
  commit(() => {
    for (const s of state.project.sheets) {
      const include = s.id === sheet.id || (allSheets && (!sameFileOnly || s.fileId === sheet.fileId));
      if (!include) continue;
      // presets depend on the sheet's own resolution; calibrations transfer only between equal resolutions
      if (s.id !== sheet.id && scale.preset) {
        s.scale = { ...scaleFromPreset(scale.preset, s.unitsPerInch), preset: scale.preset };
      } else if (s.id === sheet.id || s.unitsPerInch === sheet.unitsPerInch) {
        s.scale = { ...scale };
      }
    }
  });
}

// ------------------------------------------------------------------ rendering: takeoff
function renderAll() {
  $('#projectName').value = state.project.info.name;
  document.title = `${state.project.info.name} — TakeOff Pro`;
  renderSheets();
  renderConditions();
  renderQuantities();
  renderSelection();
  renderToolbar();
  renderProjectForm();
  if (state.view === 'estimate') renderEstimate();
}

function renderSheets() {
  const ul = $('#sheetList');
  const { sheets, measurements } = state.project;
  $('#sheetEmpty').hidden = sheets.length > 0;
  ul.innerHTML = sheets.map((s) => {
    const n = measurements.filter((m) => m.sheetId === s.id).length;
    return `<li data-id="${s.id}" class="${s.id === state.sheetId ? 'active' : ''}" title="${escapeHtml(s.fileName)} p${s.pageIndex + 1}">
      <span class="name">${escapeHtml(s.name)}</span>
      ${s.scale ? '' : '<span class="badge warn">no scale</span>'}
      ${n ? `<span class="badge">${n}</span>` : ''}
      <span class="actions">
        <button class="icon" data-act="rename" title="Rename">✎</button>
        <button class="icon danger" data-act="delete" title="Remove">✕</button>
      </span>
    </li>`;
  }).join('');
}

function renderConditions() {
  const ul = $('#conditionList');
  const conds = [...state.project.conditions].sort((a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name));
  $('#conditionEmpty').hidden = conds.length > 0;
  const byId = sheetsById();
  let html = '';
  let lastDiv = null;
  for (const c of conds) {
    if (c.division !== lastDiv) {
      html += `<li class="cond-group">${c.division} · ${escapeHtml(divisionName(c.division))}</li>`;
      lastDiv = c.division;
    }
    const q = conditionQuantities(c, state.project.measurements, byId);
    html += `<li data-id="${c.id}" class="${c.id === state.conditionId ? 'active' : ''} ${c.visible === false ? 'hidden-cond' : ''}">
      <span class="swatch" style="background:${c.color}"></span>
      <span class="type-icon" title="${c.type}">${TYPE_ICON[c.type]}</span>
      <span class="name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
      <span class="meta">${fmt(q.quantity, c.unit === 'EA' ? 0 : 1)} ${c.unit}</span>
      <span class="actions">
        <button class="icon" data-act="toggle" title="${c.visible === false ? 'Show' : 'Hide'} on drawing">${c.visible === false ? '◌' : '◉'}</button>
        <button class="icon" data-act="edit" title="Edit">✎</button>
        <button class="icon" data-act="dup" title="Duplicate">⧉</button>
        <button class="icon danger" data-act="delete" title="Delete">✕</button>
      </span>
    </li>`;
  }
  ul.innerHTML = html;
}

function renderQuantities() {
  const sheetOnly = $('#chkSheetOnly').checked;
  const msrs = sheetOnly ? state.project.measurements.filter((m) => m.sheetId === state.sheetId) : state.project.measurements;
  const byId = sheetsById();
  const rows = state.project.conditions
    .map((c) => ({ c, q: conditionQuantities(c, msrs, byId) }))
    .filter(({ q }) => q.measurementCount > 0);
  $('#qtyBody').innerHTML = rows.length
    ? rows.map(({ c, q }) => `<tr class="${c.id === state.conditionId ? 'active' : ''}">
        <td><span class="swatch" style="background:${c.color}"></span>${escapeHtml(c.name)}${q.unscaledCount ? ' <span class="badge warn" title="Measurements on unscaled sheets are excluded">!</span>' : ''}</td>
        <td class="num">${fmt(q.quantity, c.unit === 'EA' ? 0 : 1)}</td><td>${c.unit}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">No measurements yet.</td></tr>';
}

function renderSelection() {
  const m = state.project.measurements.find((x) => x.id === state.selectedId);
  $('#selectionPanel').hidden = !m;
  if (!m) return;
  const c = conditionsById().get(m.conditionId);
  const sheet = sheetsById().get(m.sheetId);
  const base = measurementBase(m, sheet, c.type);
  const unitBase = { linear: 'LF', area: 'SF', count: 'EA' }[c.type];
  const priced = base === null ? null : convertToUnit(base, c);
  const sameType = state.project.conditions.filter((x) => x.type === c.type);
  $('#selectionBody').innerHTML = `
    <div><span class="swatch" style="background:${c.color};display:inline-block;vertical-align:middle"></span> ${escapeHtml(c.name)}</div>
    <div class="big">${base === null ? 'No scale' : `${fmt(base, c.type === 'count' ? 0 : 2)} ${unitBase}`}</div>
    ${c.type === 'linear' && base !== null ? `<div class="muted">${formatFeetInches(base)}</div>` : ''}
    ${priced !== null && c.unit !== unitBase ? `<div class="muted">= ${fmt(priced, 2)} ${c.unit}</div>` : ''}
    <label class="small muted">Condition
      <select id="selCondition">${sameType.map((x) => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>
    </label>
    ${c.type === 'area' ? `<label class="toggle"><input type="checkbox" id="selDeduct" ${m.deduct ? 'checked' : ''}> Deduction (subtract)</label>` : ''}
    <div class="row"><button id="selDelete" class="danger">Delete</button></div>`;
  $('#selCondition').onchange = (e) => commit(() => (m.conditionId = e.target.value));
  $('#selDelete').onclick = deleteSelected;
  const d = $('#selDeduct');
  if (d) d.onchange = () => commit(() => (m.deduct = d.checked));
}

function renderToolbar() {
  for (const b of $$('#toolGroup button')) b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool));
  $('#btnUndo').disabled = !state.undo.length;
  $('#btnRedo').disabled = !state.redo.length;
  const sheet = currentSheet();
  const sel = $('#scaleSelect');
  sel.disabled = !sheet;
  $('#btnScaleAll').disabled = !sheet?.scale;
  const current = sheet?.scale?.preset ?? (sheet?.scale ? '__custom' : '');
  const custom = sheet?.scale && !sheet.scale.preset ? `<option value="__custom">${escapeHtml(sheet.scale.label)}</option>` : '';
  const groups = [...new Set(SCALE_PRESETS.map((p) => p.group))];
  sel.innerHTML = `<option value="">— Not set —</option>${custom}` +
    groups.map((g) => `<optgroup label="${g}">${SCALE_PRESETS.filter((p) => p.group === g)
      .map((p) => `<option>${escapeHtml(p.label)}</option>`).join('')}</optgroup>`).join('');
  sel.value = current;
  const isImage = sheet && !/\.pdf$/i.test(sheet.fileName) && sheet.unitsPerInch !== 72;
  $('#dpiWrap').hidden = !isImage;
  if (isImage) $('#dpiInput').value = sheet.unitsPerInch;
  $('#statusScale').textContent = sheet ? (sheet.scale ? `Scale: ${sheet.scale.label}` : 'Scale not set') : '';
  const c = activeCondition();
  $('#statusActive').innerHTML = c ? `Active: <span class="swatch" style="display:inline-block;vertical-align:-2px;background:${c.color}"></span> ${escapeHtml(c.name)}` : '';
  $('#chkDeduct').disabled = c?.type !== 'area';
}

// ------------------------------------------------------------------ conditions dialog
let editingConditionId = null;

function openConditionDialog(condition = null) {
  editingConditionId = condition?.id ?? null;
  const form = $('#conditionForm');
  form.reset();
  $('#conditionDialogTitle').textContent = condition ? 'Edit condition' : 'New condition';
  $('#assemblySelect').closest('label').hidden = Boolean(condition);
  $('#assemblySelect').value = '';
  const c = condition ?? createCondition({ type: activeCondition()?.type ?? 'linear' }, state.project.conditions);
  fillConditionForm(c);
  $('#conditionDialog').showModal();
  form.elements.name.select();
}

function fillConditionForm(c) {
  const f = $('#conditionForm').elements;
  f.name.value = c.name;
  f.division.value = c.division;
  f.color.value = c.color;
  f.type.value = c.type;
  updateUnitOptions(c.unit);
  for (const k of ['heightFt', 'widthIn', 'depthIn', 'thicknessIn', 'wastePct', 'material', 'labor', 'equipment']) f[k].value = c[k] || '';
  f.notes.value = c.notes || '';
  updateDimFields();
}

function updateUnitOptions(selected) {
  const f = $('#conditionForm').elements;
  const units = UNITS_BY_TYPE[f.type.value];
  f.unit.innerHTML = units.map((u) => `<option>${u}</option>`).join('');
  f.unit.value = units.includes(selected) ? selected : units[0];
}

function updateDimFields() {
  const f = $('#conditionForm').elements;
  const type = f.type.value;
  const unit = f.unit.value;
  const show = {
    heightFt: type === 'linear' && unit === 'SF',
    widthIn: type === 'linear' && unit === 'CY',
    depthIn: type === 'linear' && unit === 'CY',
    thicknessIn: type === 'area' && unit === 'CY',
  };
  for (const [k, v] of Object.entries(show)) {
    $(`[data-dim=${k}]`).hidden = !v;
    f[k].required = v;
  }
  $('#unitHelp').textContent = UNIT_HELP[unit] ?? '';
}

function saveConditionForm() {
  const f = $('#conditionForm').elements;
  const fields = {
    name: f.name.value.trim(), division: f.division.value, color: f.color.value, type: f.type.value, unit: f.unit.value,
    heightFt: f.heightFt.value, widthIn: f.widthIn.value, depthIn: f.depthIn.value, thicknessIn: f.thicknessIn.value,
    wastePct: f.wastePct.value, material: f.material.value, labor: f.labor.value, equipment: f.equipment.value, notes: f.notes.value,
  };
  if (editingConditionId) {
    const existing = state.project.conditions.find((c) => c.id === editingConditionId);
    const used = state.project.measurements.some((m) => m.conditionId === existing.id);
    if (used && existing.type !== fields.type) {
      toast('Cannot change the measurement type of a condition that has measurements', 'error');
      fields.type = existing.type;
      fields.unit = UNITS_BY_TYPE[existing.type].includes(fields.unit) ? fields.unit : existing.unit;
    }
    commit(() => Object.assign(existing, createCondition(fields), { id: existing.id, visible: existing.visible }));
  } else {
    const c = createCondition(fields, state.project.conditions);
    commit(() => state.project.conditions.push(c));
    activateCondition(c.id);
  }
  if (state.tool === 'measure') setTool('measure'); // pick up type/color changes
}

function activateCondition(id) {
  state.conditionId = id;
  renderConditions();
  renderQuantities();
  const c = activeCondition();
  if (c && c.visible === false) commit(() => (c.visible = true));
  setTool(c ? 'measure' : 'pan');
  if (c && c.type !== 'count' && currentSheet() && !currentSheet().scale) toast('Set this sheet’s scale (toolbar) or calibrate before measuring');
}

function deleteCondition(id) {
  const c = state.project.conditions.find((x) => x.id === id);
  const n = state.project.measurements.filter((m) => m.conditionId === id).length;
  if (!confirm(`Delete condition "${c.name}"${n ? ` and its ${n} measurement${n > 1 ? 's' : ''}` : ''}?`)) return;
  if (state.conditionId === id) {
    state.conditionId = null;
    setTool('pan');
  }
  commit(() => {
    state.project.conditions = state.project.conditions.filter((x) => x.id !== id);
    state.project.measurements = state.project.measurements.filter((m) => m.conditionId !== id);
  });
}

// ------------------------------------------------------------------ estimate
function renderEstimate() {
  const p = state.project;
  const est = buildEstimate(p);
  $('#estTitle').textContent = p.info.name;
  $('#estMeta').textContent = [p.info.client, p.info.location, p.info.bidDate && `Bid ${p.info.bidDate}`, p.info.estimator && `Estimator: ${p.info.estimator}`]
    .filter(Boolean).join(' · ');

  const warnings = [];
  const unscaled = p.sheets.filter((s) => !s.scale && p.measurements.some((m) => m.sheetId === s.id && conditionsById().get(m.conditionId)?.type !== 'count'));
  if (unscaled.length) warnings.push(`${unscaled.length} sheet(s) with measurements have no scale: ${unscaled.map((s) => escapeHtml(s.name)).join(', ')}. Those quantities are excluded.`);
  const unpriced = est.lines.filter((l) => l.quantity > 0 && l.unitCost === 0);
  if (unpriced.length) warnings.push(`${unpriced.length} item(s) have quantities but no unit cost.`);
  $('#estWarnings').innerHTML = warnings.length ? `<div class="warnings">${warnings.map((w) => `<div>⚠ ${w}</div>`).join('')}</div>` : '';

  const costInput = (c, key, cls = '') => `<input type="number" step="any" min="0" class="${cls}" data-id="${c.id}" data-key="${key}" value="${c[key] || 0}">`;
  let html = '';
  if (!est.groups.length) html = '<tr><td colspan="13" class="muted">No conditions yet. Create conditions and measure them on the Takeoff tab.</td></tr>';
  for (const g of est.groups) {
    html += `<tr class="division"><td colspan="13">${g.code} — ${escapeHtml(g.name)}</td></tr>`;
    for (const l of g.lines) {
      const c = l.condition;
      const d = c.unit === 'EA' ? 0 : 2;
      html += `<tr>
        <td><div class="item"><span class="swatch" style="background:${c.color}"></span>${escapeHtml(c.name)}
          ${l.unscaledCount ? `<span class="warn" title="Measurements on unscaled sheets are excluded">(${l.unscaledCount} unscaled)</span>` : ''}</div></td>
        <td class="num">${fmt(l.base, c.type === 'count' ? 0 : 1)} ${l.baseUnit}</td>
        <td class="num">${fmt(l.quantity, d)}</td>
        <td>${l.unit}</td>
        <td class="num">${costInput(c, 'wastePct', 'waste')}</td>
        <td class="num">${fmt(l.orderQuantity, d)}</td>
        <td class="num">${costInput(c, 'material')}</td>
        <td class="num">${costInput(c, 'labor')}</td>
        <td class="num">${costInput(c, 'equipment')}</td>
        <td class="num">${money.format(l.material)}</td>
        <td class="num">${money.format(l.labor)}</td>
        <td class="num">${money.format(l.equipment)}</td>
        <td class="num"><strong>${money.format(l.total)}</strong></td>
      </tr>`;
    }
    html += `<tr class="subtotal"><td colspan="9">Subtotal ${g.code}</td>
      <td class="num">${money.format(g.material)}</td><td class="num">${money.format(g.labor)}</td>
      <td class="num">${money.format(g.equipment)}</td><td class="num">${money.format(g.total)}</td></tr>`;
  }
  const t = est.totals;
  if (est.groups.length) {
    html += `<tr class="total"><td colspan="9">Direct cost</td><td class="num">${money.format(t.material)}</td>
      <td class="num">${money.format(t.labor)}</td><td class="num">${money.format(t.equipment)}</td><td class="num">${money.format(t.direct)}</td></tr>`;
  }
  $('#estBody').innerHTML = html;

  const form = $('#markupForm');
  for (const [k, v] of Object.entries(p.markups)) if (form.elements[k] && document.activeElement !== form.elements[k]) form.elements[k].value = v;

  const m = p.markups;
  const rows = [
    ['Material', t.material], ['Labor', t.labor], ['Equipment', t.equipment], ['Direct cost', t.direct, true],
    [`Sales tax on material (${m.taxPct}%)`, t.tax], [`Overhead (${m.overheadPct}%)`, t.overhead], [`Profit (${m.profitPct}%)`, t.profit],
    [`Contingency (${m.contingencyPct}%)`, t.contingency], [`Bond (${m.bondPct}%)`, t.bond],
  ];
  $('#summaryTable').innerHTML = rows.map(([label, v, bold]) => `<tr${bold ? ' style="font-weight:700"' : ''}><td>${label}</td><td class="num">${money.format(v)}</td></tr>`).join('') +
    `<tr class="grand"><td>Total bid</td><td class="num">${money.format(t.grandTotal)}</td></tr>`;
}

// ------------------------------------------------------------------ project tab
function renderProjectForm() {
  const f = $('#projectForm').elements;
  for (const k of ['name', 'client', 'location', 'bidDate', 'estimator', 'notes']) {
    if (document.activeElement !== f[k]) f[k].value = state.project.info[k] ?? '';
  }
  renderProjectList();
}

async function renderProjectList() {
  const projects = (await store.listProjects()).sort((a, b) => a.info.name.localeCompare(b.info.name));
  $('#projectList').innerHTML = projects.map((p) => `<li data-id="${p.id}" class="${p.id === state.project.id ? 'active' : ''}">
    <span class="name">${escapeHtml(p.info.name)}</span>
    <span class="meta">${p.sheets.length} sheets · ${p.measurements.length} meas.</span>
    <span class="actions">${p.id === state.project.id ? '' : '<button class="icon danger" data-act="delete" title="Delete from browser">✕</button>'}</span>
  </li>`).join('') || '<li class="muted">None</li>';
}

function setView(view) {
  state.view = view;
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === view));
  for (const v of ['takeoff', 'estimate', 'project']) $(`#view-${v}`).hidden = v !== view;
  if (view === 'estimate') renderEstimate();
  if (view === 'project') renderProjectForm();
  if (view === 'takeoff' && currentSheet()) viewer.render();
}

// ------------------------------------------------------------------ event wiring
function bindEvents() {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#btnNew').onclick = newProject;
  $('#btnOpen').onclick = () => $('#openInput').click();
  $('#openInput').onchange = (e) => {
    if (e.target.files[0]) importProject(e.target.files[0]);
    e.target.value = '';
  };
  $('#btnExport').onclick = exportProject;
  $('#projectName').onchange = (e) => updateInfo('name', e.target.value.trim() || 'Untitled Project');

  // drawings
  $('#btnAddDrawing').onclick = () => $('#drawingInput').click();
  $('#drawingInput').onchange = (e) => {
    addDrawingFiles(e.target.files);
    e.target.value = '';
  };
  $('#sheetList').onclick = (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'delete') return deleteSheet(li.dataset.id);
    if (act === 'rename') {
      const s = state.project.sheets.find((x) => x.id === li.dataset.id);
      const name = prompt('Sheet name', s.name);
      if (name?.trim()) commit(() => (s.name = name.trim()));
      return;
    }
    if (li.dataset.id !== state.sheetId) {
      state.selectedId = null;
      renderSelection();
      showSheet(li.dataset.id);
    }
  };

  // drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth++;
    $('#dropHint').hidden = false;
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) $('#dropHint').hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropHint').hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    const json = files.find((f) => /\.json$/i.test(f.name));
    if (json) importProject(json);
    else if (files.length) {
      setView('takeoff');
      addDrawingFiles(files);
    }
  });

  // conditions
  $('#btnAddCondition').onclick = () => openConditionDialog();
  $('#conditionList').onclick = (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const c = state.project.conditions.find((x) => x.id === li.dataset.id);
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'edit') return openConditionDialog(c);
    if (act === 'delete') return deleteCondition(c.id);
    if (act === 'toggle') return commit(() => (c.visible = c.visible === false));
    if (act === 'dup') {
      const copy = createCondition({ ...c, name: `${c.name} (copy)`, color: undefined }, state.project.conditions);
      commit(() => state.project.conditions.push(copy));
      return activateCondition(copy.id);
    }
    activateCondition(c.id === state.conditionId ? null : c.id);
  };
  $('#conditionList').ondblclick = (e) => {
    const li = e.target.closest('li[data-id]');
    if (li && !e.target.closest('button')) openConditionDialog(state.project.conditions.find((x) => x.id === li.dataset.id));
  };

  const cf = $('#conditionForm');
  cf.elements.type.onchange = () => {
    updateUnitOptions();
    updateDimFields();
  };
  cf.elements.unit.onchange = updateDimFields;
  $('#assemblySelect').onchange = (e) => {
    const a = ASSEMBLIES[Number(e.target.value)];
    if (!a) return;
    fillConditionForm(createCondition({
      ...a, color: cf.elements.color.value,
      material: a.material, labor: a.labor, equipment: a.equipment,
    }));
  };
  $('#conditionDialog').addEventListener('close', () => {
    if ($('#conditionDialog').returnValue === 'ok') saveConditionForm();
  });

  // calibrate
  const calDialog = $('#calibrateDialog');
  calDialog.querySelector('form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'ok') return;
    const feet = parseLength($('#calLength').value);
    if (!(feet > 0)) {
      e.preventDefault();
      $('#calError').hidden = false;
      return;
    }
    const scale = scaleFromCalibration(state.pendingCalibration, feet);
    applyScale(scale, { allSheets: calDialog.querySelector('[name=all]').checked, sameFileOnly: true });
    toast(`Scale set: ${formatFeetInches(feet)} over ${fmt(state.pendingCalibration, 1)} units`);
    setTool(activeCondition() ? 'measure' : 'pan');
  });
  calDialog.addEventListener('close', () => {
    if (state.tool === 'calibrate' && calDialog.returnValue !== 'ok') setTool('pan');
  });

  // toolbar
  $$('#toolGroup button').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  $('#chkLabels').onchange = refreshViewerData;
  $('#chkSheetOnly').onchange = renderQuantities;
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnZoomIn').onclick = () => viewer.zoomBy(1.25);
  $('#btnZoomOut').onclick = () => viewer.zoomBy(0.8);
  $('#btnFit').onclick = () => viewer.fit();
  $('#scaleSelect').onchange = (e) => {
    const sheet = currentSheet();
    const v = e.target.value;
    if (v === '__custom') return;
    if (!v) return commit(() => (sheet.scale = null));
    applyScale({ ...scaleFromPreset(v, sheet.unitsPerInch), preset: v });
  };
  $('#btnScaleAll').onclick = () => {
    const sheet = currentSheet();
    if (!sheet?.scale) return;
    if (!confirm(`Apply "${sheet.scale.label}" to all ${state.project.sheets.length} sheets?`)) return;
    applyScale(sheet.scale, { allSheets: true });
    toast('Scale applied to all sheets');
  };
  $('#dpiInput').onchange = (e) => {
    const sheet = currentSheet();
    const dpi = Number(e.target.value);
    if (!(dpi > 0)) return;
    commit(() => {
      sheet.unitsPerInch = dpi;
      if (sheet.scale?.preset) sheet.scale = { ...scaleFromPreset(sheet.scale.preset, dpi), preset: sheet.scale.preset };
    });
  };

  // estimate edits
  $('#estBody').addEventListener('change', (e) => {
    const input = e.target.closest('input[data-id]');
    if (!input) return;
    const c = state.project.conditions.find((x) => x.id === input.dataset.id);
    const v = Number(input.value);
    commit(() => (c[input.dataset.key] = Number.isFinite(v) && v >= 0 ? v : 0));
  });
  $('#markupForm').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    commit(() => (state.project.markups[e.target.name] = v));
  });
  $('#btnCsv').onclick = () => download(`${safeFileName(state.project.info.name)}_estimate.csv`, estimateToCSV(state.project), 'text/csv');
  $('#btnPrint').onclick = () => window.print();

  // project form
  $('#projectForm').addEventListener('input', (e) => {
    if (e.target.name) updateInfo(e.target.name, e.target.value);
  });
  $('#projectList').onclick = async (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    if (e.target.closest('button')?.dataset.act === 'delete') {
      const p = await store.getProject(li.dataset.id);
      if (!confirm(`Permanently delete "${p.info.name}" from this browser?`)) return;
      for (const f of p.files) await store.deleteFile(f.id);
      await store.deleteProject(p.id);
      renderProjectList();
      return;
    }
    if (li.dataset.id === state.project.id) return;
    const p = await store.getProject(li.dataset.id);
    if (p) {
      await loadProject(p);
      await store.setMeta('currentProjectId', p.id);
      setView('takeoff');
    }
  };

  // keyboard
  const onKey = (e) => {
    const typing = e.target.closest('input, textarea, select, dialog');
    if (typing) return;
    if (state.view === 'takeoff' && viewer.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.type !== 'keydown') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) return e.preventDefault(), undo();
    if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) return e.preventDefault(), redo();
    if (mod && e.key.toLowerCase() === 's') return e.preventDefault(), exportProject();
    if (mod || e.altKey || state.view !== 'takeoff') return;
    const keyMap = {
      v: () => setTool('pan'), h: () => setTool('pan'), s: () => setTool('select'), m: () => setTool('measure'), k: () => setTool('calibrate'),
      f: () => viewer.fit(), '+': () => viewer.zoomBy(1.25), '=': () => viewer.zoomBy(1.25), '-': () => viewer.zoomBy(0.8),
      d: () => { const cb = $('#chkDeduct'); if (!cb.disabled) cb.checked = !cb.checked; },
      Delete: deleteSelected, Backspace: deleteSelected,
      Escape: () => { state.selectedId = null; viewer.setSelected(null); renderSelection(); },
      PageDown: () => stepSheet(1), PageUp: () => stepSheet(-1),
    };
    const fn = keyMap[e.key] ?? keyMap[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('resize', () => viewer.render());
  window.addEventListener('beforeunload', () => store.saveProject(state.project));
}

function stepSheet(dir) {
  const sheets = state.project.sheets;
  const i = sheets.findIndex((s) => s.id === state.sheetId);
  const next = sheets[i + dir];
  if (next) {
    state.selectedId = null;
    renderSelection();
    showSheet(next.id);
  }
}

let infoTimer = null;
function updateInfo(key, value) {
  state.project.info[key] = value;
  if (key === 'name') {
    $('#projectName').value = value;
    document.title = `${value} — TakeOff Pro`;
  }
  clearTimeout(infoTimer);
  infoTimer = setTimeout(() => {
    persist();
    renderProjectList();
  }, 300);
}

function populateStatic() {
  $('#divisionSelect').innerHTML = DIVISIONS.map((d) => `<option value="${d.code}">${d.code} — ${escapeHtml(d.name)}</option>`).join('');
  const byDiv = new Map();
  ASSEMBLIES.forEach((a, i) => {
    if (!byDiv.has(a.division)) byDiv.set(a.division, []);
    byDiv.get(a.division).push(`<option value="${i}">${escapeHtml(a.name)} (${a.unit})</option>`);
  });
  $('#assemblySelect').innerHTML += [...byDiv].map(([d, opts]) => `<optgroup label="${d} ${escapeHtml(divisionName(d))}">${opts.join('')}</optgroup>`).join('');
}

// ------------------------------------------------------------------ boot
async function init() {
  populateStatic();
  bindEvents();
  let project = null;
  try {
    const id = await store.getMeta('currentProjectId');
    if (id) project = await store.getProject(id);
  } catch (e) {
    console.warn('Storage unavailable', e);
    toast('Browser storage is unavailable — use Save As… to keep your work', 'error');
  }
  await loadProject(project ?? createProject());
  if (!project) persist();
  $('#saveState').textContent = project ? 'Saved' : '';
}

init();
