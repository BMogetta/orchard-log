// Flower / fruit phenology, derived from the timeline — never a duplicate store.
// `flowering` and `fruit-set` are existing event types, so an observation is just
// a dated event. From a tree's past observations we tell whether the tree is
// flowering/fruiting *now* ("active") or is *expected* to around now, predicted
// from the same month-day in earlier years ("predicted").
//
// Mirrors lib/harvest.js (pure derivation) and lib/attention.js (async orchestrator
// over the repo). The pure `phaseStatus` is unit-tested in isolation.

import { trees, events } from "../data/repository.js";
import { parseLocalDate } from "./attention.js";

const DAY = 1000 * 60 * 60 * 24;

// The event types that carry each phenophase.
export const PHENO_EVENT = { flowering: "flowering", fruiting: "fruit-set" };

// ±2 weeks: how far today can be from an observation and still count.
export const PHENO_WINDOW_DAYS = 14;

// Day-of-year on a fixed non-leap calendar (0-based). Leap-day drift (≤1 day)
// is irrelevant next to a ±14-day window, so we ignore Feb 29 on purpose.
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function dayOfYear(date) {
  return MONTH_START[date.getMonth()] + (date.getDate() - 1);
}

// Circular distance in days between two month-days, wrapping the year end so a
// late-December bloom matches an early-January "today".
function annualDistance(a, b) {
  const d = Math.abs(dayOfYear(a) - dayOfYear(b));
  return Math.min(d, 365 - d);
}

// Status of one phenophase given its observed dates ("YYYY-MM-DD" strings):
//   "active"    — an observation falls within ±window of today (this season).
//   "predicted" — today falls within ±window of some observation's month-day
//                 (recurs annually), but none is recent enough to be active.
//   "none"      — no observation lands near today on the yearly cycle.
export function phaseStatus(dates, today = new Date(), windowDays = PHENO_WINDOW_DAYS) {
  let predicted = false;
  for (const s of dates || []) {
    if (!s) continue;
    const d = parseLocalDate(s);
    if (Number.isNaN(d.getTime())) continue;
    if (Math.abs((today.getTime() - d.getTime()) / DAY) <= windowDays) return "active";
    if (annualDistance(today, d) <= windowDays) predicted = true;
  }
  return predicted ? "predicted" : "none";
}

// Both phenophases for one tree from its event list.
export function treePhenology(eventList, today = new Date()) {
  const dates = (type) =>
    (eventList || []).filter((e) => e.type === type).map((e) => e.date);
  return {
    flowering: phaseStatus(dates(PHENO_EVENT.flowering), today),
    fruiting: phaseStatus(dates(PHENO_EVENT.fruiting), today),
  };
}

// Map treeId -> { flowering, fruiting } across all trees, read from the repo.
// Used by the list via useLive so the card indicator stays reactive. Skips trees
// with no phenology signal to keep the map small.
export async function computePhenology(today = new Date()) {
  const allTrees = await trees.all();
  const out = new Map();
  for (const tree of allTrees) {
    const evs = await events.forTree(tree.id);
    const status = treePhenology(evs, today);
    if (status.flowering !== "none" || status.fruiting !== "none") {
      out.set(tree.id, status);
    }
  }
  return out;
}
