// Storage-agnostic domain model: enums, the blank-tree factory, derived values,
// and the v1->v2 normalisation. No database code here — the backend (PouchDB)
// and the repository consume these.

// --- Enum values (single source of truth for form + detail views) --------
// Only the stored `value` slugs live here. Human labels come from i18n via
// `t(`${prefix}.${value}`)`. "unknown" stays first so it is the default option.

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
export const SOIL_PH_VALUES = ["unknown", "acidic", "slightly-acidic", "neutral", "alkaline"];
export const GROWTH_RATE_VALUES = [
  "unknown",
  "slow",
  "slow-medium",
  "medium",
  "medium-fast",
  "fast",
];

// Whether the tree needs winter chill to flower. "yes" reveals the hour range;
// "no" reads as "No" in the detail; "unknown" hides it.
export const CHILL_REQ_VALUES = ["unknown", "yes", "no"];
export const WIND_TOLERANCE_VALUES = ["unknown", "low", "medium", "high"];
export const POLLINATION_VALUES = ["unknown", "self", "partial-self", "needs-partner"];

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

// Factory for a blank tree so the shape is consistent everywhere.
export function blankTree() {
  const now = new Date().toISOString();
  return {
    // --- Identity ---
    label: "", // short id you write on the pot, e.g. "07"
    commonName: "",
    otherNames: [], // synonyms / alternate common names — searchable, not shown
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
    referenceNotes: "", // free-text "encyclopedia entry" for the species: origin,
    // distribution, altitude, rainfall, soil texture, root habit... general
    // reference prose that isn't fertilizer/pruning-specific and isn't observed.
    sunSpec: "unknown",
    waterSpec: "unknown",
    minTempC: null, // cold hardiness floor
    maxTempC: null, // heat tolerance ceiling
    chillHoursRequired: "unknown", // "yes" -> range applies, "no" -> shows "No"
    chillHoursMinSpec: null, // hours < ~7C required for flowering; a min–max range
    chillHoursMaxSpec: null,
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
    careSchedule: [],

    createdAt: now,
    updatedAt: now,
  };
}

// --- v1 -> v2 normalisation (also used on legacy backup/db import) --------

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

// Migrate a v1 tree record in place to v2. Usable from live migration and from
// backup import. Preserves legacy free text as *Notes so nothing is lost.
export function migrateTreeToV2(tree) {
  const oldObservedSun = typeof tree.observedSun === "string" ? tree.observedSun : "";
  const oldObservedWater = typeof tree.observedWater === "string" ? tree.observedWater : "";

  tree.sunSpec = normalizeSunEnum(tree.sunSpec);
  tree.waterSpec = normalizeWaterEnum(tree.waterSpec);
  tree.observedSun = normalizeSunEnum(oldObservedSun);
  tree.observedWater = normalizeWaterEnum(oldObservedWater);

  if (tree.observedSunNotes == null) {
    tree.observedSunNotes =
      tree.observedSun === "unknown" && oldObservedSun ? oldObservedSun : "";
  }
  if (tree.observedWaterNotes == null) {
    tree.observedWaterNotes =
      tree.observedWater === "unknown" && oldObservedWater ? oldObservedWater : "";
  }

  if (tree.referenceNotes == null) tree.referenceNotes = "";
  if (tree.pruningTiming == null) tree.pruningTiming = "unknown";
  if (tree.pruningNotes == null) tree.pruningNotes = tree.pruningSpec ?? "";
  if (tree.fertilizerType == null) tree.fertilizerType = "unknown";
  if (tree.fertilizerNotes == null) tree.fertilizerNotes = tree.fertilizerSpec ?? "";

  // Chill hours became a min–max range; carry a legacy single value into the min.
  if (tree.chillHoursMinSpec === undefined) {
    tree.chillHoursMinSpec = tree.chillHoursSpec ?? null;
  }
  if (tree.chillHoursMaxSpec === undefined) tree.chillHoursMaxSpec = null;
  delete tree.chillHoursSpec;
  if (tree.deciduous == null) tree.deciduous = "unknown";
  if (tree.matureHeightM === undefined) tree.matureHeightM = null;
  if (tree.matureSpreadM === undefined) tree.matureSpreadM = null;
  if (tree.soilPhSpec == null) tree.soilPhSpec = "unknown";
  if (tree.growthRate == null) tree.growthRate = "unknown";
  if (tree.windTolerance == null) tree.windTolerance = "unknown";

  if (Array.isArray(tree.careSchedule)) {
    for (const t of tree.careSchedule) {
      if (t.intervalDaysSummer === undefined) t.intervalDaysSummer = null;
      if (t.intervalDaysWinter === undefined) t.intervalDaysWinter = null;
    }
  }

  return tree;
}

// Estimated current age in months, derived from purchase date + claimed age.
export function estimatedAgeMonths(tree) {
  if (!tree.purchaseDate || tree.claimedAgeMonthsAtPurchase == null) return null;
  const bought = new Date(tree.purchaseDate);
  const monthsWithYou = (Date.now() - bought.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  return Math.round(tree.claimedAgeMonthsAtPurchase + monthsWithYou);
}
