// Sum harvest yield grouped by calendar year (taken from the event date).
// Returns [{ year, total, unit }] sorted newest year first. `unit` is the shared
// unit for that year, or "" when a year mixes units (then only the number shows).
// Events without a positive numeric yieldAmount are ignored.
export function harvestTotals(events) {
  const byYear = new Map();
  for (const e of events || []) {
    if (e.type !== "harvest") continue;
    const amount = Number(e.yieldAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const year = Number((e.date || "").slice(0, 4));
    if (!year) continue;
    const entry = byYear.get(year) || { year, total: 0, units: new Set() };
    entry.total += amount;
    if (e.yieldUnit) entry.units.add(e.yieldUnit);
    byYear.set(year, entry);
  }
  return [...byYear.values()]
    .map(({ year, total, units }) => ({
      year,
      // Round to avoid floating-point noise from summing decimals.
      total: Math.round(total * 100) / 100,
      unit: units.size === 1 ? [...units][0] : "",
    }))
    .sort((a, b) => b.year - a.year);
}
