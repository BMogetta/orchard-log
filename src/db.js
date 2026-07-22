import Dexie from "dexie";

// ---------------------------------------------------------------------------
// Local-first database. Everything lives in IndexedDB on this device.
// Three tables:
//   trees  - one record per tree (identity + spec + observed reality)
//   events - the clinical-history timeline (one row per logged event)
//   photos - image blobs, linked to a tree and optionally to an event
//
// The core idea of this app: a tree has a SPEC (what references say) and an
// OBSERVED reality (what YOUR plant actually does in YOUR spot). Both are
// stored side by side so the observed notes can override the book.
// ---------------------------------------------------------------------------

export const db = new Dexie("orchard-log");

db.version(1).stores({
  // Only indexed fields are listed here; records may hold many more fields.
  trees: "++id, label, commonName, pollinationPartnerId, updatedAt",
  events: "++id, treeId, date, type",
  photos: "++id, treeId, eventId, createdAt",
});

// v2: index schema is unchanged, but the upgrade callback normalises legacy
// free-text spec fields into the closed enums introduced below, and backfills
// new fields on existing records so the form doesn't have to guard for gaps.
db.version(2)
  .stores({
    trees: "++id, label, commonName, pollinationPartnerId, updatedAt",
    events: "++id, treeId, date, type",
    photos: "++id, treeId, eventId, createdAt",
  })
  .upgrade(async (tx) => {
    await tx.table("trees").toCollection().modify(migrateTreeToV2);
  });

// --- Enum values (single source of truth for form + detail views) --------
// Only the stored `value` slugs live here. Human labels are pulled from the
// i18n dictionary by the caller: `t(`${prefix}.${value}`)`. Keep "unknown"
// first so it is the default option in a <select>.

export const SUN_VALUES = ["unknown", "full-sun", "part-sun", "part-shade", "full-shade"];
export const WATER_VALUES = ["unknown", "low", "moderate", "high", "very-high"];
export const PRUNING_TIMING_VALUES = [
  "unknown",
  "winter-dormant",
  "summer-green",
  "after-fruit",
  "not-needed",
];
export const FERTILIZER_TYPE_VALUES = [
  "unknown",
  "general-npk",
  "high-potash",
  "citrus-blend",
  "acid-loving",
  "slow-release",
  "none",
  "other",
];
export const DECIDUOUS_VALUES = ["unknown", "deciduous", "evergreen", "semi-deciduous"];
export const SOIL_PH_VALUES = ["unknown", "acidic", "neutral", "alkaline"];
export const GROWTH_RATE_VALUES = ["unknown", "slow", "medium", "fast"];
export const WIND_TOLERANCE_VALUES = ["unknown", "low", "medium", "high"];
export const POLLINATION_VALUES = ["unknown", "self", "needs-partner"];

// Factory for a blank tree so the shape is consistent everywhere.
export function blankTree() {
  const now = new Date().toISOString();
  return {
    // --- Identity ---
    label: "", // short id you write on the pot, e.g. "07"
    commonName: "",
    scientificName: "",
    variety: "", // cultivar, e.g. 'Valencia'

    // --- Provenance ---
    source: "", // nursery, market, gift, seed, cutting...
    purchaseDate: "", // ISO date string
    claimedAgeMonthsAtPurchase: null, // seller's claim, in months
    price: null,

    // --- Physical state ---
    potLiters: null,
    substrate: "",
    grafted: false,
    rootstock: "",

    // --- Spec (reference guidance) ---
    sunSpec: "unknown",
    waterSpec: "unknown",
    minTempC: null, // cold hardiness floor
    chillHoursSpec: null, // hours < ~7C required for flowering (stone fruit)
    deciduous: "unknown", // deciduous | evergreen | semi-deciduous
    matureHeightM: null,
    matureSpreadM: null,
    soilPhSpec: "unknown",
    growthRate: "unknown",
    windTolerance: "unknown",
    fertilizerType: "unknown",
    fertilizerNotes: "",
    pruningTiming: "unknown",
    pruningNotes: "",
    pollination: "unknown", // "self" | "needs-partner" | "unknown"
    pollinationPartnerId: null,
    fruitingSeason: "", // kept as free text ("late spring", "Jan-Mar", ...)

    // --- Observed reality (your overrides) ---
    positionOnTerrace: "",
    observedSun: "unknown",
    observedSunNotes: "", // e.g. "scorched in January afternoon sun"
    observedWater: "unknown",
    observedWaterNotes: "",
    quirks: "",

    // --- Recurring care tasks -> feed the "Needs attention" panel ---
    // Each item: {
    //   task: string,
    //   intervalDays: number,             // fallback interval, always required
    //   intervalDaysSummer: number|null,  // override for hot half (SH: Oct-Mar)
    //   intervalDaysWinter: number|null,  // override for cold half (SH: Apr-Sep)
    //   lastDone: ISOdate|null,
    // }
    careSchedule: [],

    createdAt: now,
    updatedAt: now,
  };
}

// --- Migration helpers ----------------------------------------------------

// Best-effort mapping from v1 free-text to the v2 enum. Anything unrecognised
// becomes "unknown"; the user re-selects on next edit. The original free text
// is preserved as *Notes so no information is silently lost.
function normalizeSunEnum(v) {
  if (!v || typeof v !== "string") return "unknown";
  const s = v.toLowerCase().trim();
  const allowed = new Set(["unknown", "full-sun", "part-sun", "part-shade", "full-shade"]);
  if (allowed.has(s)) return s;
  if (/(full|pleno|plena).*(sun|sol)|^sol$|^full sun$/.test(s)) return "full-sun";
  if (/part.*sun|half.*sun|medio.*sol/.test(s)) return "part-sun";
  if (/part.*shade|half.*shade|media.*sombra|sombra.*parcial/.test(s)) return "part-shade";
  if (/full.*shade|deep.*shade|sombra.*(plena|total|completa)/.test(s)) return "full-shade";
  return "unknown";
}

function normalizeWaterEnum(v) {
  if (!v || typeof v !== "string") return "unknown";
  const s = v.toLowerCase().trim();
  const allowed = new Set(["unknown", "low", "moderate", "high", "very-high"]);
  if (allowed.has(s)) return s;
  if (/(very.*high|abundant|abundante|frecuente)/.test(s)) return "very-high";
  if (/(low|dry|xeric|poco|escaso|drought)/.test(s)) return "low";
  if (/(moderate|medium|moderado|medio|regular)/.test(s)) return "moderate";
  if (/(high|moist|humid|humedo)/.test(s)) return "high";
  return "unknown";
}

// Migrate a v1 tree record in place to v2. Also usable from backup import.
export function migrateTreeToV2(tree) {
  const oldObservedSun = typeof tree.observedSun === "string" ? tree.observedSun : "";
  const oldObservedWater = typeof tree.observedWater === "string" ? tree.observedWater : "";

  tree.sunSpec = normalizeSunEnum(tree.sunSpec);
  tree.waterSpec = normalizeWaterEnum(tree.waterSpec);
  tree.observedSun = normalizeSunEnum(oldObservedSun);
  tree.observedWater = normalizeWaterEnum(oldObservedWater);

  // Preserve the old observed free text as notes if the normalisation lost it.
  if (tree.observedSunNotes == null) {
    tree.observedSunNotes =
      tree.observedSun === "unknown" && oldObservedSun ? oldObservedSun : "";
  }
  if (tree.observedWaterNotes == null) {
    tree.observedWaterNotes =
      tree.observedWater === "unknown" && oldObservedWater ? oldObservedWater : "";
  }

  // Split legacy pruning / fertilizer free-text into type + notes.
  if (tree.pruningTiming == null) tree.pruningTiming = "unknown";
  if (tree.pruningNotes == null) tree.pruningNotes = tree.pruningSpec ?? "";
  if (tree.fertilizerType == null) tree.fertilizerType = "unknown";
  if (tree.fertilizerNotes == null) tree.fertilizerNotes = tree.fertilizerSpec ?? "";

  // Fields new in v2 default to null / unknown if missing on a v1 record.
  if (tree.chillHoursSpec === undefined) tree.chillHoursSpec = null;
  if (tree.deciduous == null) tree.deciduous = "unknown";
  if (tree.matureHeightM === undefined) tree.matureHeightM = null;
  if (tree.matureSpreadM === undefined) tree.matureSpreadM = null;
  if (tree.soilPhSpec == null) tree.soilPhSpec = "unknown";
  if (tree.growthRate == null) tree.growthRate = "unknown";
  if (tree.windTolerance == null) tree.windTolerance = "unknown";

  // Seasonal fields on existing care schedule tasks — null means "no override".
  if (Array.isArray(tree.careSchedule)) {
    for (const t of tree.careSchedule) {
      if (t.intervalDaysSummer === undefined) t.intervalDaysSummer = null;
      if (t.intervalDaysWinter === undefined) t.intervalDaysWinter = null;
    }
  }

  // Legacy free-text fields are left on the record so old JSON backups still
  // round-trip cleanly. The form no longer reads them.
  return tree;
}

// Estimated current age in months, derived from purchase date + claimed age.
export function estimatedAgeMonths(tree) {
  if (!tree.purchaseDate || tree.claimedAgeMonthsAtPurchase == null) return null;
  const bought = new Date(tree.purchaseDate);
  const monthsWithYou =
    (Date.now() - bought.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  return Math.round(tree.claimedAgeMonthsAtPurchase + monthsWithYou);
}

export const EVENT_TYPES = [
  "repot",
  "prune",
  "fertilize",
  "pest",
  "treatment",
  "flowering",
  "fruit-set",
  "harvest",
  "problem",
  "move",
  "note",
];

// --- Write helpers (keep updatedAt fresh) --------------------------------

export async function saveTree(tree) {
  tree.updatedAt = new Date().toISOString();
  if (tree.id == null) {
    tree.createdAt = tree.updatedAt;
    return db.trees.add(tree);
  }
  return db.trees.put(tree);
}

export async function addEvent(event) {
  return db.events.add({
    date: new Date().toISOString().slice(0, 10),
    type: "note",
    notes: "",
    ...event,
  });
}

export async function addPhoto({ treeId, eventId = null, blob }) {
  return db.photos.add({
    treeId,
    eventId,
    blob,
    createdAt: new Date().toISOString(),
  });
}

export async function deleteTree(id) {
  await db.transaction("rw", db.trees, db.events, db.photos, async () => {
    await db.trees.delete(id);
    await db.events.where("treeId").equals(id).delete();
    await db.photos.where("treeId").equals(id).delete();
  });
}
