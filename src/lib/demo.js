import { trees, events, blankTree } from "../data";
import { resetDatabase } from "../data/backend.js";

// Demo mode ships a public, local-only showcase (GitHub Pages): PouchDB/Dexie
// with no sync, pre-seeded so the app isn't empty. Enabled at build time with
// VITE_DEMO=1. In every normal build this is false and none of this runs.
export const isDemo = import.meta.env.VITE_DEMO === "1";

const isoDaysAgo = (n) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Sample terrace: a self-fertile citrus, a stone fruit that needs a partner,
// and a fig. Enough to show spec-vs-observed, the care list, and the timeline.
const sampleTrees = [
  {
    label: "01",
    commonName: "Limonero",
    scientificName: "Citrus × limon",
    variety: "Eureka",
    source: "vivero",
    purchaseDate: "2023-03-15",
    claimedAgeMonthsAtPurchase: 24,
    potLiters: 40,
    substrate: "sustrato para cítricos + perlita",
    sunSpec: "full-sun",
    waterSpec: "moderate",
    minTempC: -2,
    deciduous: "evergreen",
    soilPhSpec: "acidic",
    fertilizerType: "citrus-blend",
    pruningTiming: "after-fruit",
    pollination: "self",
    fruitingSeason: "invierno",
    positionOnTerrace: "esquina noreste",
    observedSun: "part-sun",
    observedSunNotes: "las hojas se aclaran con el sol de tarde en verano",
    quirks: "muy sensible a la falta de hierro (clorosis)",
    careSchedule: [
      { task: "chequeo de riego", intervalDays: 4, intervalDaysSummer: 2, intervalDaysWinter: 7, lastDone: isoDaysAgo(9) },
      { task: "fertilizar", intervalDays: 30, intervalDaysSummer: null, intervalDaysWinter: null, lastDone: isoDaysAgo(40) },
    ],
    events: [
      { type: "repot", date: isoDaysAgo(1200), notes: "pasado a maceta de 40L" },
      { type: "flowering", date: isoDaysAgo(120), notes: "floración abundante" },
      { type: "note", date: isoDaysAgo(30), notes: "primeros frutos cuajando" },
    ],
  },
  {
    label: "02",
    commonName: "Durazno",
    scientificName: "Prunus persica",
    variety: "Flor de mayo",
    source: "mercado de productores",
    purchaseDate: "2024-08-01",
    claimedAgeMonthsAtPurchase: 12,
    potLiters: 25,
    sunSpec: "full-sun",
    waterSpec: "moderate",
    minTempC: -15,
    chillHoursMinSpec: 500,
    chillHoursMaxSpec: 700,
    deciduous: "deciduous",
    growthRate: "fast",
    pruningTiming: "winter-dormant",
    pollination: "needs-partner",
    fruitingSeason: "verano",
    positionOnTerrace: "borde sur, a pleno sol",
    observedWater: "high",
    observedWaterNotes: "se seca rápido en la maceta chica, subir de tamaño",
    careSchedule: [
      { task: "revisar plagas (pulgón)", intervalDays: 14, intervalDaysSummer: 7, intervalDaysWinter: null, lastDone: null },
    ],
    events: [
      { type: "prune", date: isoDaysAgo(200), notes: "poda de formación en dormancia" },
      { type: "pest", date: isoDaysAgo(60), notes: "pulgón en brotes nuevos, tratado con jabón potásico" },
    ],
  },
  {
    label: "03",
    commonName: "Higuera",
    scientificName: "Ficus carica",
    variety: "Brown Turkey",
    source: "estaca de un amigo",
    claimedAgeMonthsAtPurchase: 6,
    potLiters: 30,
    sunSpec: "full-sun",
    waterSpec: "low",
    minTempC: -10,
    deciduous: "deciduous",
    windTolerance: "high",
    pollination: "self",
    fruitingSeason: "fin de verano",
    positionOnTerrace: "contra la pared, refugiada del viento",
    quirks: "rebrota con fuerza desde la base cada primavera",
    careSchedule: [
      { task: "chequeo de riego", intervalDays: 5, intervalDaysSummer: 3, intervalDaysWinter: 10, lastDone: isoDaysAgo(2) },
    ],
    events: [
      { type: "harvest", date: isoDaysAgo(400), notes: "primera cosecha", yieldAmount: 15, yieldUnit: "higos" },
      { type: "harvest", date: isoDaysAgo(30), notes: "segunda temporada", yieldAmount: 22, yieldUnit: "higos" },
    ],
  },
];

// Seed only when the database is empty, so a returning visitor keeps whatever
// they added in the demo (until they hit reset).
export async function seedDemoData() {
  if ((await trees.all()).length > 0) return;
  for (const { events: eventList, ...tree } of sampleTrees) {
    const id = await trees.save({ ...blankTree(), ...tree });
    for (const ev of eventList || []) {
      await events.add({ treeId: id, ...ev });
    }
  }
}

// Wipe everything and re-seed — the "start over" button in the demo banner.
export async function resetDemoData() {
  await resetDatabase();
  await seedDemoData();
}
