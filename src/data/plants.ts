// Starter plant library. Mature sizes are typical landscape figures (they vary
// with cultivar, climate and pruning); zones are USDA hardiness ranges. "Native"
// is deliberately absent — it depends on region, not species alone.

export type PlantForm = 'tree' | 'shrub' | 'perennial' | 'grass' | 'groundcover';
export type Sun = 'full' | 'part' | 'shade';
export type Water = 'low' | 'medium' | 'high';

export interface Species {
  id: string;
  name: string;
  botanical: string;
  form: PlantForm;
  /** Mature height and spread, feet. */
  height: number;
  spread: number;
  zones: [number, number];
  sun: Sun[];
  water: Water;
}

const S = (
  id: string,
  name: string,
  botanical: string,
  form: PlantForm,
  height: number,
  spread: number,
  zones: [number, number],
  sun: Sun[],
  water: Water,
): Species => ({ id, name, botanical, form, height, spread, zones, sun, water });

export const PLANTS: Species[] = [
  // Trees
  S('red-maple', 'Red maple', 'Acer rubrum', 'tree', 50, 35, [3, 9], ['full', 'part'], 'medium'),
  S('live-oak', 'Southern live oak', 'Quercus virginiana', 'tree', 50, 70, [8, 10], ['full'], 'medium'),
  S('crape-myrtle', 'Crape myrtle', 'Lagerstroemia indica', 'tree', 20, 15, [7, 10], ['full'], 'low'),
  S('redbud', 'Eastern redbud', 'Cercis canadensis', 'tree', 25, 25, [4, 9], ['full', 'part'], 'medium'),
  S('dogwood', 'Flowering dogwood', 'Cornus florida', 'tree', 25, 25, [5, 9], ['part'], 'medium'),
  S('japanese-maple', 'Japanese maple', 'Acer palmatum', 'tree', 20, 20, [5, 8], ['part'], 'medium'),
  S('magnolia', 'Southern magnolia', 'Magnolia grandiflora', 'tree', 70, 40, [6, 10], ['full', 'part'], 'medium'),
  S('river-birch', 'River birch', 'Betula nigra', 'tree', 50, 40, [4, 9], ['full', 'part'], 'high'),
  S('bald-cypress', 'Bald cypress', 'Taxodium distichum', 'tree', 60, 25, [4, 10], ['full'], 'medium'),
  S('green-giant', "Arborvitae 'Green Giant'", 'Thuja standishii × plicata', 'tree', 40, 15, [5, 8], ['full', 'part'], 'medium'),
  S('lacebark-elm', 'Lacebark elm', 'Ulmus parvifolia', 'tree', 50, 40, [5, 9], ['full'], 'low'),
  S('mountain-laurel', 'Texas mountain laurel', 'Dermatophyllum secundiflorum', 'tree', 15, 10, [8, 11], ['full', 'part'], 'low'),
  S('desert-willow', 'Desert willow', 'Chilopsis linearis', 'tree', 20, 20, [7, 11], ['full'], 'low'),
  // Shrubs
  S('boxwood', 'Boxwood', 'Buxus sempervirens', 'shrub', 4, 4, [5, 9], ['full', 'part'], 'medium'),
  S('dwarf-yaupon', 'Dwarf yaupon holly', "Ilex vomitoria 'Nana'", 'shrub', 4, 5, [7, 10], ['full', 'part'], 'low'),
  S('knockout-rose', 'Knock Out rose', "Rosa 'Radrazz'", 'shrub', 4, 4, [5, 9], ['full'], 'medium'),
  S('hydrangea', 'Bigleaf hydrangea', 'Hydrangea macrophylla', 'shrub', 5, 5, [6, 9], ['part'], 'high'),
  S('azalea', 'Encore azalea', 'Rhododendron hybrids', 'shrub', 4, 4, [7, 10], ['part'], 'medium'),
  S('loropetalum', 'Loropetalum', 'Loropetalum chinense', 'shrub', 6, 6, [7, 10], ['full', 'part'], 'medium'),
  S('nandina', 'Nandina', 'Nandina domestica', 'shrub', 5, 4, [6, 10], ['full', 'part', 'shade'], 'low'),
  S('abelia', 'Glossy abelia', 'Abelia × grandiflora', 'shrub', 5, 5, [6, 9], ['full', 'part'], 'medium'),
  S('texas-sage', 'Texas sage', 'Leucophyllum frutescens', 'shrub', 6, 6, [8, 10], ['full'], 'low'),
  S('wax-myrtle', 'Wax myrtle', 'Morella cerifera', 'shrub', 15, 12, [7, 10], ['full', 'part'], 'low'),
  S('indian-hawthorn', 'Indian hawthorn', 'Rhaphiolepis indica', 'shrub', 4, 5, [8, 10], ['full', 'part'], 'low'),
  S('sweet-viburnum', 'Sweet viburnum', 'Viburnum odoratissimum', 'shrub', 15, 10, [7, 10], ['full', 'part'], 'medium'),
  S('spirea', 'Spirea', 'Spiraea japonica', 'shrub', 4, 4, [4, 8], ['full'], 'medium'),
  S('blue-rug', "Juniper 'Blue Rug'", "Juniperus horizontalis 'Wiltonii'", 'groundcover', 0.5, 8, [3, 9], ['full'], 'low'),
  // Perennials
  S('black-eyed-susan', 'Black-eyed Susan', 'Rudbeckia hirta', 'perennial', 2, 2, [3, 9], ['full'], 'low'),
  S('coneflower', 'Purple coneflower', 'Echinacea purpurea', 'perennial', 3, 2, [3, 9], ['full', 'part'], 'low'),
  S('daylily', 'Daylily', 'Hemerocallis', 'perennial', 2, 2, [3, 10], ['full', 'part'], 'low'),
  S('lantana', 'Lantana', 'Lantana camara', 'perennial', 3, 4, [8, 11], ['full'], 'low'),
  S('may-night', "Salvia 'May Night'", 'Salvia nemorosa', 'perennial', 1.5, 1.5, [4, 8], ['full'], 'low'),
  S('autumn-sage', 'Autumn sage', 'Salvia greggii', 'perennial', 3, 3, [7, 9], ['full'], 'low'),
  S('lavender', 'Lavender', 'Lavandula angustifolia', 'perennial', 2, 3, [5, 9], ['full'], 'low'),
  S('hosta', 'Hosta', 'Hosta', 'perennial', 2, 3, [3, 9], ['shade', 'part'], 'medium'),
  S('russian-sage', 'Russian sage', 'Salvia yangii', 'perennial', 4, 3, [4, 9], ['full'], 'low'),
  S('shasta-daisy', 'Shasta daisy', 'Leucanthemum × superbum', 'perennial', 2, 2, [5, 9], ['full'], 'medium'),
  S('liriope', 'Liriope', 'Liriope muscari', 'groundcover', 1, 1.5, [5, 10], ['full', 'part', 'shade'], 'low'),
  // Grasses
  S('muhly', 'Pink muhly grass', 'Muhlenbergia capillaris', 'grass', 3, 3, [6, 10], ['full'], 'low'),
  S('feather-reed', "Feather reed grass 'Karl Foerster'", 'Calamagrostis × acutiflora', 'grass', 5, 2, [4, 9], ['full'], 'medium'),
  S('little-bluestem', 'Little bluestem', 'Schizachyrium scoparium', 'grass', 3, 2, [3, 9], ['full'], 'low'),
  S('fountain-grass', 'Dwarf fountain grass', "Pennisetum alopecuroides 'Hameln'", 'grass', 3, 3, [5, 9], ['full'], 'medium'),
];

export const PLANT_BY_ID = new Map(PLANTS.map((p) => [p.id, p]));

export const FORM_LABEL: Record<PlantForm, string> = {
  tree: 'Trees',
  shrub: 'Shrubs',
  perennial: 'Perennials',
  grass: 'Grasses',
  groundcover: 'Groundcovers',
};
