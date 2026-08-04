// Export a single recurring care task as a downloadable .ics (iCalendar) file,
// so the phone's own calendar can deliver the reminder this app deliberately
// does NOT push (iOS PWA push is unreliable — see CLAUDE.md). One VEVENT with a
// DAILY/INTERVAL recurrence and a display alarm at the event start.
//
// Notes:
//  - Seasonal interval overrides (summer/winter) can't be expressed in a single
//    RRULE, so the base intervalDays drives the recurrence.
//  - Times are "floating" (no Z, no TZID): the calendar treats 09:00 as local
//    wherever the user is, which is what a daily-care reminder wants.

const pad = (n) => String(n).padStart(2, "0");

// Parse "YYYY-MM-DD" as a LOCAL calendar date (same rationale as
// attention.parseLocalDate; inlined to keep this module free of data-layer deps).
function parseLocalDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Floating local stamp: YYYYMMDDTHHMMSS (no suffix).
function floatingStamp(date) {
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

// UTC stamp for DTSTAMP: YYYYMMDDTHHMMSSZ.
function utcStamp(date) {
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

// Escape TEXT values per RFC 5545 (backslash, comma, semicolon, newline).
function escapeText(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// Fold a content line to <=75 octets, continuation lines prefixed with a space.
function fold(line) {
  const out = [];
  let s = line;
  while (s.length > 75) {
    out.push(s.slice(0, 75));
    s = " " + s.slice(75);
  }
  out.push(s);
  return out.join("\r\n");
}

// First occurrence: (lastDone + interval) if the task has been done, otherwise
// today. Pinned to 09:00 local so the alarm fires at a sensible hour.
function firstDue(task, now) {
  const interval = Math.max(1, Number(task.intervalDays) || 1);
  const d = task.lastDone ? parseLocalDate(task.lastDone) : new Date(now);
  if (task.lastDone) d.setDate(d.getDate() + interval);
  d.setHours(9, 0, 0, 0);
  return d;
}

// Build the iCalendar text for one care task. Pure — takes `now` for testability.
export function buildCareTaskIcs({ task, treeName, treeId, index = 0, now = new Date() }) {
  const interval = Math.max(1, Number(task.intervalDays) || 1);
  const start = firstDue(task, now);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 30);
  const title = task.task ? `${task.task} · ${treeName}` : treeName;
  const uid = `${treeId}-care-${index}@orchard-log`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orchard Log//Care//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${floatingStamp(start)}`,
    `DTEND:${floatingStamp(end)}`,
    `RRULE:FREQ=DAILY;INTERVAL=${interval}`,
    `SUMMARY:${escapeText(title)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(title)}`,
    "TRIGGER:PT0S",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

function slug(s) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "care"
  );
}

// Build the file and hand it to the browser as a download.
export function downloadCareTaskIcs(args) {
  const ics = buildCareTaskIcs(args);
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orchard-${slug(args.treeName)}-${slug(args.task.task)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
