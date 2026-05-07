// Static product catalog. Source of truth — never invent products or prices.
export const CATALOG = [
  // Papas — 80g — $2.650
  { name: 'Papa Limón',         category: 'papas',        size: '80g',  price: 2650 },
  { name: 'Papa Limón Pimienta', category: 'papas',       size: '80g',  price: 2650 },
  { name: 'Papa Natural',       category: 'papas',        size: '80g',  price: 2650 },
  { name: 'Papa Mayonesa',      category: 'papas',        size: '80g',  price: 2650 },
  { name: 'Papa BBQ Picante',   category: 'papas',        size: '80g',  price: 2650 },
  // Platanitos — 85g
  { name: 'Platanito Natural',  category: 'platanitos',   size: '85g',  price: 2650 },
  { name: 'Platanito Limón',    category: 'platanitos',   size: '85g',  price: 2650 },
  // Chicharrones
  { name: 'Chicharrón Natural', category: 'chicharrones', size: null,   price: 2650 },
  { name: 'Chicharrón Limón',   category: 'chicharrones', size: null,   price: 2650 },
  // Mixto — 80g
  { name: 'Mixto Limón',        category: 'mixto',        size: '80g',  price: 2650 },
  { name: 'Mixto Natural',      category: 'mixto',        size: '80g',  price: 2650 },
  // Crispetas — 50g — $2.300
  { name: 'Crispetas Dulces',   category: 'crispetas',    size: '50g',  price: 2300 },
  { name: 'Crispetas de Sal',   category: 'crispetas',    size: '50g',  price: 2300 },
  { name: 'Crispetas Mixtas',   category: 'crispetas',    size: '50g',  price: 2300 },
  // Maní — $1.000
  { name: 'Maní Dulce',         category: 'mani',         size: null,   price: 1000 },
  { name: 'Maní Salado',        category: 'mani',         size: null,   price: 1000 },
  { name: 'Maní Mixto',         category: 'mani',         size: null,   price: 1000 },
  { name: 'Maní Sal Pasas',     category: 'mani',         size: null,   price: 1000 }
];

const NAME_INDEX = new Map(CATALOG.map((p) => [normalize(p.name), p]));

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Resolve a product name (case/accent-insensitive). Returns the canonical
// catalog entry or null if no exact match.
export function findProduct(name) {
  if (!name) return null;
  return NAME_INDEX.get(normalize(name)) ?? null;
}

export const MIN_PACKAGES = 30;
