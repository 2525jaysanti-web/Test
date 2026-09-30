// CSI MasterFormat divisions and a starter assembly library.
//
// Unit costs in the library are illustrative placeholders only — replace them with your own
// pricing, supplier quotes or a cost database before bidding.

export const DIVISIONS = [
  ['01', 'General Requirements'],
  ['02', 'Existing Conditions'],
  ['03', 'Concrete'],
  ['04', 'Masonry'],
  ['05', 'Metals'],
  ['06', 'Wood, Plastics & Composites'],
  ['07', 'Thermal & Moisture Protection'],
  ['08', 'Openings'],
  ['09', 'Finishes'],
  ['10', 'Specialties'],
  ['11', 'Equipment'],
  ['12', 'Furnishings'],
  ['13', 'Special Construction'],
  ['14', 'Conveying Equipment'],
  ['21', 'Fire Suppression'],
  ['22', 'Plumbing'],
  ['23', 'HVAC'],
  ['26', 'Electrical'],
  ['27', 'Communications'],
  ['28', 'Electronic Safety & Security'],
  ['31', 'Earthwork'],
  ['32', 'Exterior Improvements'],
  ['33', 'Utilities'],
].map(([code, name]) => ({ code, name }));

export function divisionName(code) {
  return DIVISIONS.find((d) => d.code === code)?.name ?? 'Unassigned';
}

/** Units a condition of each measurement type can be priced in. */
export const UNITS_BY_TYPE = {
  linear: ['LF', 'SF', 'CY'],
  area: ['SF', 'SY', 'SQ', 'CY'],
  count: ['EA'],
};

export const UNIT_HELP = {
  LF: 'Linear feet measured',
  SF: 'Square feet (linear: length × height)',
  SY: 'Square yards (SF ÷ 9)',
  SQ: 'Roofing squares (SF ÷ 100)',
  CY: 'Cubic yards (linear: length × width × depth; area: SF × thickness)',
  EA: 'Each (count)',
};

export const PALETTE = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6',
  '#9a6324', '#469990', '#800000', '#808000', '#000075', '#bfef45', '#fabed4',
];

/**
 * Starter assemblies. Dimensions: heightFt (linear→SF), widthIn/depthIn (linear→CY),
 * thicknessIn (area→CY). Costs are per priced unit.
 */
export const ASSEMBLIES = [
  { division: '02', name: 'Demolish interior partition', type: 'linear', unit: 'SF', heightFt: 9, wastePct: 0, material: 0, labor: 2.1, equipment: 0.35 },
  { division: '03', name: 'Continuous footing 24"x12"', type: 'linear', unit: 'CY', widthIn: 24, depthIn: 12, wastePct: 5, material: 165, labor: 95, equipment: 18 },
  { division: '03', name: 'Slab on grade 4"', type: 'area', unit: 'CY', thicknessIn: 4, wastePct: 5, material: 160, labor: 70, equipment: 12 },
  { division: '03', name: 'Slab finish - trowel', type: 'area', unit: 'SF', wastePct: 0, material: 0.05, labor: 0.85, equipment: 0.1 },
  { division: '03', name: 'Concrete foundation wall 8"', type: 'linear', unit: 'SF', heightFt: 8, wastePct: 3, material: 9.5, labor: 12.5, equipment: 1.2 },
  { division: '04', name: 'CMU wall 8"', type: 'linear', unit: 'SF', heightFt: 10, wastePct: 5, material: 6.25, labor: 9.75, equipment: 0.6 },
  { division: '04', name: 'Brick veneer', type: 'area', unit: 'SF', wastePct: 5, material: 9.8, labor: 16.5, equipment: 0.5 },
  { division: '05', name: 'Steel lintel', type: 'count', unit: 'EA', wastePct: 0, material: 140, labor: 85, equipment: 0 },
  { division: '05', name: 'Steel handrail', type: 'linear', unit: 'LF', wastePct: 0, material: 55, labor: 28, equipment: 0 },
  { division: '06', name: 'Wood stud wall 2x4 @16" o.c.', type: 'linear', unit: 'SF', heightFt: 9, wastePct: 10, material: 2.4, labor: 3.1, equipment: 0 },
  { division: '06', name: 'Roof sheathing 5/8" plywood', type: 'area', unit: 'SF', wastePct: 10, material: 1.65, labor: 1.05, equipment: 0 },
  { division: '06', name: 'Base cabinets', type: 'linear', unit: 'LF', wastePct: 0, material: 260, labor: 45, equipment: 0 },
  { division: '07', name: 'Batt insulation R-19', type: 'area', unit: 'SF', wastePct: 5, material: 0.85, labor: 0.45, equipment: 0 },
  { division: '07', name: 'Asphalt shingle roofing', type: 'area', unit: 'SQ', wastePct: 10, material: 135, labor: 120, equipment: 0 },
  { division: '07', name: 'TPO membrane roofing', type: 'area', unit: 'SF', wastePct: 5, material: 3.2, labor: 2.6, equipment: 0.15 },
  { division: '07', name: 'Sealant joint', type: 'linear', unit: 'LF', wastePct: 5, material: 0.6, labor: 2.25, equipment: 0 },
  { division: '08', name: 'Hollow metal door & frame 3070', type: 'count', unit: 'EA', wastePct: 0, material: 950, labor: 310, equipment: 0 },
  { division: '08', name: 'Wood door & frame 3070', type: 'count', unit: 'EA', wastePct: 0, material: 620, labor: 240, equipment: 0 },
  { division: '08', name: 'Aluminum storefront', type: 'area', unit: 'SF', wastePct: 0, material: 58, labor: 22, equipment: 1.5 },
  { division: '08', name: 'Vinyl window 3040', type: 'count', unit: 'EA', wastePct: 0, material: 420, labor: 140, equipment: 0 },
  { division: '09', name: 'Metal stud partition w/ GWB both sides', type: 'linear', unit: 'SF', heightFt: 10, wastePct: 10, material: 3.4, labor: 5.9, equipment: 0 },
  { division: '09', name: 'Gypsum board ceiling', type: 'area', unit: 'SF', wastePct: 10, material: 1.35, labor: 2.6, equipment: 0 },
  { division: '09', name: 'Acoustical ceiling tile 2x4', type: 'area', unit: 'SF', wastePct: 5, material: 2.3, labor: 1.85, equipment: 0 },
  { division: '09', name: 'Carpet tile', type: 'area', unit: 'SY', wastePct: 8, material: 32, labor: 7.5, equipment: 0 },
  { division: '09', name: 'Luxury vinyl tile', type: 'area', unit: 'SF', wastePct: 8, material: 3.9, labor: 1.9, equipment: 0 },
  { division: '09', name: 'Ceramic floor tile', type: 'area', unit: 'SF', wastePct: 10, material: 5.5, labor: 7.8, equipment: 0 },
  { division: '09', name: 'Rubber base 4"', type: 'linear', unit: 'LF', wastePct: 5, material: 1.35, labor: 1.6, equipment: 0 },
  { division: '09', name: 'Paint walls - 2 coats', type: 'linear', unit: 'SF', heightFt: 9, wastePct: 0, material: 0.22, labor: 0.78, equipment: 0 },
  { division: '10', name: 'Toilet accessories set', type: 'count', unit: 'EA', wastePct: 0, material: 450, labor: 160, equipment: 0 },
  { division: '10', name: 'Fire extinguisher & cabinet', type: 'count', unit: 'EA', wastePct: 0, material: 310, labor: 95, equipment: 0 },
  { division: '21', name: 'Fire sprinkler (light hazard)', type: 'area', unit: 'SF', wastePct: 0, material: 1.9, labor: 2.4, equipment: 0.1 },
  { division: '22', name: 'Plumbing fixture (lav/WC)', type: 'count', unit: 'EA', wastePct: 0, material: 780, labor: 520, equipment: 0 },
  { division: '22', name: 'Domestic water pipe 3/4" copper', type: 'linear', unit: 'LF', wastePct: 5, material: 9.5, labor: 14, equipment: 0 },
  { division: '23', name: 'Supply diffuser', type: 'count', unit: 'EA', wastePct: 0, material: 85, labor: 65, equipment: 0 },
  { division: '23', name: 'Rectangular ductwork (allowance)', type: 'area', unit: 'SF', wastePct: 0, material: 4.2, labor: 5.8, equipment: 0.2 },
  { division: '26', name: 'Duplex receptacle', type: 'count', unit: 'EA', wastePct: 0, material: 28, labor: 95, equipment: 0 },
  { division: '26', name: '2x4 LED troffer', type: 'count', unit: 'EA', wastePct: 0, material: 165, labor: 110, equipment: 0 },
  { division: '26', name: 'EMT conduit 3/4" w/ wire', type: 'linear', unit: 'LF', wastePct: 10, material: 3.8, labor: 7.2, equipment: 0 },
  { division: '31', name: 'Excavation - trench', type: 'linear', unit: 'CY', widthIn: 36, depthIn: 48, wastePct: 0, material: 0, labor: 6.5, equipment: 9.5 },
  { division: '31', name: 'Site grading', type: 'area', unit: 'SY', wastePct: 0, material: 0, labor: 1.1, equipment: 2.4 },
  { division: '32', name: 'Asphalt paving 3"', type: 'area', unit: 'SY', wastePct: 3, material: 18.5, labor: 6.5, equipment: 5.5 },
  { division: '32', name: 'Concrete curb & gutter', type: 'linear', unit: 'LF', wastePct: 3, material: 14, labor: 12, equipment: 3 },
  { division: '32', name: 'Chain link fence 6\'', type: 'linear', unit: 'LF', wastePct: 0, material: 18, labor: 11, equipment: 1.5 },
  { division: '33', name: 'Storm pipe 12" RCP', type: 'linear', unit: 'LF', wastePct: 0, material: 32, labor: 18, equipment: 14 },
];
