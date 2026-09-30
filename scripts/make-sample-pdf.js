// Generates samples/sample-floor-plan.pdf: a simple 1/4" = 1'-0" floor plan on a 36"x24" sheet,
// useful for trying the app and for automated tests. Zero dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 36 * 72, H = 24 * 72; // ARCH D in points
const FT = 18; // 1/4" = 1'-0" → 18 pt per foot
const ox = 216, oy = 216; // origin of the plan (PDF coords, bottom-left)
const X = (ft) => (ox + ft * FT).toFixed(2);
const Y = (ft) => (oy + ft * FT).toFixed(2);

const ops = [];
const line = (x1, y1, x2, y2) => ops.push(`${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S`);
const rect = (x, y, w, h) => ops.push(`${X(x)} ${Y(y)} ${(w * FT).toFixed(2)} ${(h * FT).toFixed(2)} re S`);
const text = (x, y, size, s) => ops.push(`BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`);

// border + title block
ops.push('1 w', `36 36 ${W - 72} ${H - 72} re S`, `${W - 36 - 360} 36 360 144 re S`);
text(W - 380, 140, 14, 'SAMPLE OFFICE - FLOOR PLAN');
text(W - 380, 110, 10, 'SCALE: 1/4" = 1\'-0"');
text(W - 380, 60, 36, 'A101');

// exterior walls 80' x 50' (double line, 8" thick)
ops.push('2 w');
rect(0, 0, 80, 50);
rect(0.67, 0.67, 78.67, 48.67);
ops.push('1 w');
// interior partitions
line(30, 0.67, 30, 49.33);
line(0.67, 25, 30, 25);
line(30, 30, 79.33, 30);
line(55, 30, 55, 49.33);
// doors (swing arcs as simple squares) at 4 locations
for (const [x, y] of [[30, 10], [15, 25], [45, 30], [65, 30]]) rect(x - 1.5, y - 1.5, 3, 3);
// dimension string along the bottom: 80'-0"
line(0, -6, 80, -6);
line(0, -7, 0, -5);
line(80, -7, 80, -5);
text(Number(X(38)), Number(Y(-5.5)), 12, '80\'-0"');
line(-6, 0, -6, 50);
text(Number(X(-11)), Number(Y(25)), 12, '50\'-0"');
// room names
text(Number(X(10)), Number(Y(12)), 14, 'OPEN OFFICE');
text(Number(X(10)), Number(Y(37)), 14, 'CONFERENCE');
text(Number(X(50)), Number(Y(15)), 14, 'WORK AREA');
text(Number(X(40)), Number(Y(40)), 14, 'OFFICE 1');
text(Number(X(64)), Number(Y(40)), 14, 'OFFICE 2');
text(80, H - 80, 12, 'Plan dimensions: building 80\'-0" x 50\'-0". Use the bottom dimension to calibrate.');

const content = ops.join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((o, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

mkdirSync(new URL('../samples/', import.meta.url), { recursive: true });
writeFileSync(new URL('../samples/sample-floor-plan.pdf', import.meta.url), pdf);
console.log('Wrote samples/sample-floor-plan.pdf');
