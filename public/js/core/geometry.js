// Pure 2D geometry helpers. Points are {x, y} in sheet units (PDF points or image pixels).

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Total length of an open polyline. */
export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** Perimeter of a closed polygon. */
export function polygonPerimeter(points) {
  if (points.length < 2) return 0;
  return polylineLength(points) + distance(points[points.length - 1], points[0]);
}

/** Unsigned area of a simple polygon (shoelace formula). */
export function polygonArea(points) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return Math.abs(sum) / 2;
}

/** Area-weighted centroid; falls back to the vertex average for degenerate polygons. */
export function polygonCentroid(points) {
  if (points.length === 0) return { x: 0, y: 0 };
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    a += cross;
    cx += (points[j].x + points[i].x) * cross;
    cy += (points[j].y + points[i].y) * cross;
  }
  if (Math.abs(a) < 1e-9) return averagePoint(points);
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function averagePoint(points) {
  const n = points.length || 1;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** Midpoint of a polyline measured along its length (for label placement). */
export function polylineMidpoint(points) {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };
  const half = polylineLength(points) / 2;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = distance(points[i - 1], points[i]);
    if (walked + seg >= half && seg > 0) {
      const t = (half - walked) / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    walked += seg;
  }
  return { ...points[points.length - 1] };
}

/**
 * Constrain `p` relative to `anchor` to the nearest 45° increment
 * (horizontal, vertical or diagonal), preserving the projected length.
 */
export function constrainAngle(anchor, p, stepDeg = 45) {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...p };
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const proj = dx * Math.cos(angle) + dy * Math.sin(angle);
  return { x: anchor.x + proj * Math.cos(angle), y: anchor.y + proj * Math.sin(angle) };
}

export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function distanceToPolyline(p, points, closed = false) {
  if (points.length === 1) return distance(p, points[0]);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
  if (closed && points.length > 2) best = Math.min(best, distanceToSegment(p, points[points.length - 1], points[0]));
  return best;
}

export function pointInPolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
