// Drawing viewer: renders a PDF page or raster image, handles zoom/pan, and draws the takeoff
// overlay. Also runs the interactive tools (measure, calibrate, select/edit).
import {
  constrainAngle, distance, distanceToPolyline, pointInPolygon, polygonArea, polygonCentroid,
  polylineLength, polylineMidpoint,
} from './core/geometry.js';
import { formatFeetInches } from './core/scale.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_CANVAS_PIXELS = 24e6;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent?.appendChild(el);
  return el;
}

const fmtNum = (n, d = 1) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

export class DrawingViewer {
  /**
   * @param {HTMLElement} viewport scroll container
   * @param {object} hooks { onMeasure(points), onCalibrate(unitDistance), onSelect(id|null),
   *                        onEdit(id, points), onCursor({x,y}|null), onDraftChange(text) }
   */
  constructor(viewport, hooks) {
    this.viewport = viewport;
    this.hooks = hooks;
    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    this.canvas = document.createElement('canvas');
    this.overlay = svg('svg', { class: 'overlay' });
    this.stage.append(this.canvas, this.overlay);
    viewport.appendChild(this.stage);

    this.sheet = null;
    this.source = null;
    this.zoom = 1;
    this.tool = 'pan';
    this.measureType = null; // 'linear' | 'area' | 'count' while measuring
    this.activeColor = '#e6194b';
    this.deduct = false;
    this.showLabels = true;
    this.draft = [];
    this.cursor = null;
    this.shift = false;
    this.selectedId = null;
    this.measurements = [];
    this.conditionsById = new Map();
    this.renderTask = null;
    this.renderTimer = null;
    this.drag = null;

    this.#bindEvents();
  }

  // ---------------------------------------------------------------- public API

  async showSheet(sheet, source) {
    this.sheet = sheet;
    this.source = source;
    this.draft = [];
    this.selectedId = null;
    this.stage.hidden = !sheet;
    if (!sheet) return;
    this.overlay.setAttribute('viewBox', `0 0 ${sheet.width} ${sheet.height}`);
    this.fit();
  }

  setData(measurements, conditionsById) {
    this.measurements = measurements;
    this.conditionsById = conditionsById;
    this.drawOverlay();
  }

  setTool(tool, { type = null, color = null } = {}) {
    this.tool = tool;
    this.measureType = type;
    if (color) this.activeColor = color;
    this.draft = [];
    this.viewport.dataset.tool = tool;
    this.#emitDraft();
    this.drawOverlay();
  }

  setSelected(id) {
    this.selectedId = id;
    this.drawOverlay();
  }

  cancelDraft() {
    this.draft = [];
    this.#emitDraft();
    this.drawOverlay();
  }

  fit() {
    if (!this.sheet) return;
    const pad = 24;
    const z = Math.min(
      (this.viewport.clientWidth - pad) / this.sheet.width,
      (this.viewport.clientHeight - pad) / this.sheet.height,
    );
    this.setZoom(Math.max(MIN_ZOOM, z));
    this.viewport.scrollLeft = 0;
    this.viewport.scrollTop = 0;
  }

  zoomBy(factor, clientPoint) {
    this.setZoom(this.zoom * factor, clientPoint);
  }

  setZoom(z, clientPoint) {
    if (!this.sheet) return;
    z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    const vpRect = this.viewport.getBoundingClientRect();
    const anchor = clientPoint ?? { x: vpRect.left + vpRect.width / 2, y: vpRect.top + vpRect.height / 2 };
    const before = this.toSheet(anchor);
    this.zoom = z;
    this.#layout();
    // keep the sheet point under the anchor fixed
    const stageRect = this.stage.getBoundingClientRect();
    this.viewport.scrollLeft += stageRect.left + before.x * z - anchor.x;
    this.viewport.scrollTop += stageRect.top + before.y * z - anchor.y;
    this.drawOverlay();
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.render(), 120);
    this.hooks.onZoom?.(z);
  }

  toSheet(clientPoint) {
    const r = this.stage.getBoundingClientRect();
    return { x: (clientPoint.x - r.left) / this.zoom, y: (clientPoint.y - r.top) / this.zoom };
  }

  async render() {
    if (!this.sheet || !this.source) return;
    const dpr = window.devicePixelRatio || 1;
    let scale = this.zoom * dpr;
    const pixels = this.sheet.width * this.sheet.height * scale * scale;
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    const w = Math.max(1, Math.floor(this.sheet.width * scale));
    const h = Math.max(1, Math.floor(this.sheet.height * scale));

    // render off-screen, then swap in, so the old image stays visible while rendering
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    if (this.source.kind === 'pdf') {
      this.renderTask?.cancel();
      const page = this.source.page;
      const viewport = page.getViewport({ scale: w / this.sheet.width });
      const task = page.render({ canvasContext: ctx, viewport });
      this.renderTask = task;
      try {
        await task.promise;
      } catch (e) {
        if (e?.name === 'RenderingCancelledException') return;
        throw e;
      } finally {
        if (this.renderTask === task) this.renderTask = null;
      }
    } else {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.source.image, 0, 0, w, h);
    }
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.getContext('2d').drawImage(off, 0, 0);
  }

  // ---------------------------------------------------------------- drawing

  #layout() {
    const w = this.sheet.width * this.zoom;
    const h = this.sheet.height * this.zoom;
    for (const el of [this.stage, this.canvas, this.overlay]) {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
  }

  #lengthLabel(units) {
    const fpu = this.sheet?.scale?.feetPerUnit;
    return fpu ? formatFeetInches(units * fpu) : `${fmtNum(units, 0)} u (no scale)`;
  }

  #areaLabel(units2) {
    const fpu = this.sheet?.scale?.feetPerUnit;
    return fpu ? `${fmtNum(units2 * fpu * fpu)} SF` : `${fmtNum(units2, 0)} u² (no scale)`;
  }

  drawOverlay() {
    const o = this.overlay;
    o.replaceChildren();
    if (!this.sheet) return;
    const z = this.zoom;
    const px = (n) => n / z; // screen pixels → sheet units

    for (const m of this.measurements) {
      const c = this.conditionsById.get(m.conditionId);
      if (!c || c.visible === false) continue;
      const selected = m.id === this.selectedId;
      const g = svg('g', { class: `m m-${c.type}${selected ? ' selected' : ''}`, 'data-id': m.id }, o);
      const points = this.drag?.kind === 'vertex' && this.drag.id === m.id ? this.drag.points : m.points;
      const pts = points.map((p) => `${p.x},${p.y}`).join(' ');
      let labelAt = null;
      let label = '';
      if (c.type === 'count') {
        for (const p of points) {
          svg('circle', { cx: p.x, cy: p.y, r: px(7), fill: c.color, 'fill-opacity': 0.85, stroke: '#fff', 'stroke-width': px(1.5) }, g);
        }
      } else if (c.type === 'linear') {
        svg('polyline', { points: pts, fill: 'none', stroke: c.color, 'stroke-width': px(3), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': 0.85 }, g);
        labelAt = polylineMidpoint(points);
        label = this.#lengthLabel(polylineLength(points));
      } else {
        svg('polygon', {
          points: pts,
          fill: m.deduct ? 'url(#deduct-hatch)' : c.color,
          'fill-opacity': m.deduct ? 1 : 0.25,
          stroke: c.color,
          'stroke-width': px(2),
          'stroke-dasharray': m.deduct ? `${px(6)} ${px(4)}` : 'none',
        }, g);
        labelAt = polygonCentroid(points);
        label = (m.deduct ? '− ' : '') + this.#areaLabel(polygonArea(points));
      }
      if (selected) {
        for (const p of points) {
          svg('rect', { class: 'handle', x: p.x - px(5), y: p.y - px(5), width: px(10), height: px(10), 'stroke-width': px(1.5) }, g);
        }
      }
      if (this.showLabels && labelAt) this.#label(g, labelAt, label, c.color);
    }

    // hatch pattern for deductions, sized in screen pixels
    const defs = svg('defs', {}, o);
    const pat = svg('pattern', { id: 'deduct-hatch', patternUnits: 'userSpaceOnUse', width: px(8), height: px(8), patternTransform: 'rotate(45)' }, defs);
    svg('rect', { width: px(8), height: px(8), fill: 'rgba(255,255,255,0.35)' }, pat);
    svg('line', { x1: 0, y1: 0, x2: 0, y2: px(8), stroke: '#c00', 'stroke-width': px(2), 'stroke-opacity': 0.5 }, pat);

    this.#drawDraft();
  }

  #label(parent, at, text, color) {
    const fs = 12 / this.zoom;
    const t = svg('text', { x: at.x, y: at.y, 'font-size': fs, class: 'mlabel', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, parent);
    t.textContent = text;
    // background pill sized to the rendered text (with an estimate as fallback)
    const w = (t.getComputedTextLength?.() || text.length * fs * 0.62) + fs;
    const bg = svg('rect', { x: at.x - w / 2, y: at.y - fs * 0.8, width: w, height: fs * 1.6, rx: fs * 0.4, fill: '#fff', 'fill-opacity': 0.85, stroke: color, 'stroke-width': 1 / this.zoom });
    parent.insertBefore(bg, t);
  }

  #drawDraft() {
    const cursor = this.cursor;
    const isCal = this.tool === 'calibrate';
    const type = isCal ? 'linear' : this.measureType;
    if (!['measure', 'calibrate'].includes(this.tool) || !type || type === 'count') return;
    const pts = [...this.draft];
    if (cursor && pts.length) pts.push(this.#constrained(cursor));
    if (!pts.length) return;
    const g = svg('g', { class: 'draft' }, this.overlay);
    const color = isCal ? '#ff00aa' : this.activeColor;
    const w = 2 / this.zoom;
    const str = pts.map((p) => `${p.x},${p.y}`).join(' ');
    if (type === 'area' && pts.length > 2) {
      svg('polygon', { points: str, fill: color, 'fill-opacity': 0.15, stroke: color, 'stroke-width': w, 'stroke-dasharray': `${6 / this.zoom} ${4 / this.zoom}` }, g);
    } else {
      svg('polyline', { points: str, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-dasharray': `${6 / this.zoom} ${4 / this.zoom}` }, g);
    }
    for (const p of this.draft) svg('circle', { cx: p.x, cy: p.y, r: 4 / this.zoom, fill: color }, g);
  }

  #constrained(p) {
    if (this.shift && this.draft.length) return constrainAngle(this.draft[this.draft.length - 1], p);
    return p;
  }

  #emitDraft() {
    const pts = [...this.draft];
    if (this.cursor && pts.length) pts.push(this.#constrained(this.cursor));
    let text = '';
    if (this.tool === 'calibrate') {
      text = pts.length < 2 ? 'Calibrate: click the first point of a known dimension' : `Calibrate: ${fmtNum(polylineLength(pts), 1)} units — click the second point`;
    } else if (this.tool === 'measure' && pts.length) {
      if (this.measureType === 'linear') text = `Length ${this.#lengthLabel(polylineLength(pts))} · Enter/double-click to finish`;
      if (this.measureType === 'area') text = `Area ${this.#areaLabel(polygonArea(pts))} · Enter/double-click or click start point to close`;
    }
    this.hooks.onDraftChange?.(text);
  }

  // ---------------------------------------------------------------- input

  #bindEvents() {
    const vp = this.viewport;
    vp.addEventListener('wheel', (e) => {
      if (!this.sheet) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      this.zoomBy(factor, { x: e.clientX, y: e.clientY });
    }, { passive: false });

    vp.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    vp.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    vp.addEventListener('pointerup', (e) => this.#onPointerUp(e));
    vp.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.hooks.onCursor?.(null);
      this.drawOverlay();
    });
    vp.addEventListener('dblclick', (e) => {
      if (this.tool === 'measure' && this.draft.length) {
        e.preventDefault();
        this.finishDraft();
      }
    });
    vp.addEventListener('contextmenu', (e) => {
      if (this.draft.length) {
        e.preventDefault();
        this.finishDraft();
      }
    });
  }

  /** Handle keyboard input routed from the app. Returns true if consumed. */
  handleKey(e) {
    if (e.key === 'Shift') {
      this.shift = e.type === 'keydown';
      this.drawOverlay();
      return false;
    }
    if (e.type !== 'keydown') {
      if (e.key === ' ') this.spaceDown = false;
      return false;
    }
    if (e.key === ' ') {
      this.spaceDown = true;
      return true;
    }
    if (e.key === 'Escape' && this.draft.length) {
      this.cancelDraft();
      return true;
    }
    if (e.key === 'Enter' && this.draft.length) {
      this.finishDraft();
      return true;
    }
    if (e.key === 'Backspace' && this.draft.length) {
      this.draft.pop();
      this.#emitDraft();
      this.drawOverlay();
      return true;
    }
    return false;
  }

  finishDraft() {
    // a double-click adds the same point twice; drop near-duplicates
    const pts = this.draft.filter((p, i, a) => i === 0 || distance(p, a[i - 1]) > 0.5 / this.zoom);
    const need = this.measureType === 'area' ? 3 : 2;
    this.draft = [];
    if (pts.length >= need) this.hooks.onMeasure?.(pts);
    this.#emitDraft();
    this.drawOverlay();
  }

  #panning(e) {
    return this.tool === 'pan' || e.button === 1 || this.spaceDown;
  }

  #onPointerDown(e) {
    if (!this.sheet || (e.button !== 0 && e.button !== 1)) return;
    const p = this.toSheet({ x: e.clientX, y: e.clientY });

    if (this.#panning(e)) {
      e.preventDefault();
      this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, sl: this.viewport.scrollLeft, st: this.viewport.scrollTop };
      this.viewport.setPointerCapture(e.pointerId);
      this.viewport.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;

    if (this.tool === 'select') {
      const sel = this.measurements.find((m) => m.id === this.selectedId);
      if (sel) {
        const idx = sel.points.findIndex((q) => distance(q, p) < 8 / this.zoom);
        if (idx >= 0) {
          this.drag = { kind: 'vertex', id: sel.id, idx, points: sel.points.map((q) => ({ ...q })) };
          this.viewport.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = this.hitTest(p);
      this.selectedId = hit?.id ?? null;
      this.hooks.onSelect?.(this.selectedId);
      this.drawOverlay();
      return;
    }

    if (this.tool === 'calibrate') {
      this.draft.push(this.#constrained(p));
      if (this.draft.length === 2) {
        const d = distance(this.draft[0], this.draft[1]);
        this.draft = [];
        this.drawOverlay();
        if (d > 0) this.hooks.onCalibrate?.(d);
      }
      this.#emitDraft();
      this.drawOverlay();
      return;
    }

    if (this.tool === 'measure' && this.measureType) {
      if (this.measureType === 'count') {
        this.hooks.onMeasure?.([p]);
        return;
      }
      if (this.measureType === 'area' && this.draft.length >= 3 && distance(p, this.draft[0]) < 8 / this.zoom) {
        this.finishDraft();
        return;
      }
      this.draft.push(this.#constrained(p));
      this.#emitDraft();
      this.drawOverlay();
    }
  }

  #onPointerMove(e) {
    if (!this.sheet) return;
    if (this.drag?.kind === 'pan') {
      this.viewport.scrollLeft = this.drag.sl - (e.clientX - this.drag.x);
      this.viewport.scrollTop = this.drag.st - (e.clientY - this.drag.y);
      return;
    }
    const p = this.toSheet({ x: e.clientX, y: e.clientY });
    this.cursor = p;
    this.hooks.onCursor?.(p);
    if (this.drag?.kind === 'vertex') {
      this.drag.points[this.drag.idx] = p;
      this.drawOverlay(); // live preview; committed through onEdit on pointerup
      return;
    }
    if (this.draft.length) {
      this.#emitDraft();
      this.drawOverlay();
    }
  }

  #onPointerUp(e) {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.viewport.classList.remove('panning');
    if (this.viewport.hasPointerCapture(e.pointerId)) this.viewport.releasePointerCapture(e.pointerId);
    if (d.kind === 'vertex') this.hooks.onEdit?.(d.id, d.points);
  }

  hitTest(p) {
    const tol = 8 / this.zoom;
    const visible = this.measurements.filter((m) => this.conditionsById.get(m.conditionId)?.visible !== false);
    const typeOf = (m) => this.conditionsById.get(m.conditionId).type;
    // topmost first; points and lines win over the areas they sit on
    const ordered = [...visible].reverse();
    return ordered.find((m) => typeOf(m) === 'count' && m.points.some((q) => distance(q, p) < tol))
      ?? ordered.find((m) => typeOf(m) === 'linear' && distanceToPolyline(p, m.points) < tol)
      ?? ordered.find((m) => typeOf(m) === 'area' && distanceToPolyline(p, m.points, true) < tol)
      ?? ordered.find((m) => typeOf(m) === 'area' && pointInPolygon(p, m.points))
      ?? null;
  }
}
