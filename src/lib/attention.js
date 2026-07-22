import { trees, events } from "../data/repository.js";

const DAY = 1000 * 60 * 60 * 24;

// Parse a "YYYY-MM-DD" string as a LOCAL calendar date, not UTC midnight.
// `new Date("2023-01-01")` is UTC midnight, so in a negative-offset zone (e.g.
// UTC-3) .getFullYear()/day math land on the previous day/year. Building the
// date from its parts pins it to the user's own calendar in every timezone.
export function parseLocalDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Southern-hemisphere convention: the terrace's hot half runs Oct-Mar, the
// cold half Apr-Sep. Hardcoded because this is a personal app for one place;
// promote to a setting the day a second location is needed.
function currentSeason(date = new Date()) {
  const m = date.getMonth();
  return m >= 9 || m <= 2 ? "summer" : "winter";
}

function taskIntervalDays(task, season) {
  if (season === "summer" && task.intervalDaysSummer != null) {
    return task.intervalDaysSummer;
  }
  if (season === "winter" && task.intervalDaysWinter != null) {
    return task.intervalDaysWinter;
  }
  return task.intervalDays;
}

// Build the "Needs attention" list from each tree's own data:
//   - recurring care tasks whose interval has elapsed since lastDone
//     (interval is season-aware when the task defines an override)
//   - repot suggestion when the last repot event is older than repotYears
//
// This replaces fragile push notifications with a list you check in-app.
export async function computeAttention(repotYears = 2) {
  const allTrees = await trees.all();
  const items = [];
  const now = Date.now();
  const season = currentSeason();

  for (const tree of allTrees) {
    for (const task of tree.careSchedule || []) {
      const interval = taskIntervalDays(task, season);
      const last = task.lastDone ? parseLocalDate(task.lastDone).getTime() : 0;
      const dueIn = task.lastDone
        ? Math.round((last + interval * DAY - now) / DAY)
        : -999; // never done -> overdue
      if (dueIn <= 0) {
        items.push({
          treeId: tree.id,
          treeName: tree.commonName || tree.label || `#${tree.id}`,
          kind: "task",
          label: task.task,
          overdueDays: Math.abs(dueIn),
        });
      }
    }

    // Sort by event date (not insertion order) so backfilled repot events
    // don't mislead the "repot due" heuristic.
    const repotEvents = await events.forTreeOfType(tree.id, "repot");
    const lastRepot = repotEvents.at(-1) ?? null;
    const repotDate = lastRepot ? parseLocalDate(lastRepot.date) : null;
    const repotRef = repotDate ? repotDate.getTime() : null;
    if (repotRef && now - repotRef > repotYears * 365 * DAY) {
      items.push({
        treeId: tree.id,
        treeName: tree.commonName || tree.label || `#${tree.id}`,
        kind: "repot",
        // Deferred to the UI: the panel formats this with t(labelKey, labelParams).
        labelKey: "attention.repotDue",
        labelParams: { year: repotDate.getFullYear() },
        overdueDays: Math.round((now - repotRef) / DAY - repotYears * 365),
      });
    }
  }

  return items.sort((a, b) => b.overdueDays - a.overdueDays);
}
