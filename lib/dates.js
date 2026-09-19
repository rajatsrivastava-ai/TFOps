"use strict";
/* Date normalisation for the load-board sheet.
   The source sheet mixes real dates, Indian dd.mm.yyyy, "7-Sept" shorthand and
   free text like "Need to check with the pod lead." or "Recurring". We keep both: an
   ISO date when we can read one, and the original text as a note so nothing is
   silently dropped. */

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const OPEN_ENDED = /^(recurring|ongoing|continuous|as needed|open[- ]?ended|open)$/i;
const UNKNOWN = /^(tbd|tba|to be decided|to be confirmed|\?+)$/i;

const DEFAULT_YEAR = 2026;

function iso(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** @returns {{date:string|null, note:string, kind:"date"|"openEnded"|"unknown"|"note"|"empty"}} */
function parseDate(raw, fallbackYear = DEFAULT_YEAR) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text || text === "-" || text === "--") {
    return { date: null, note: "", kind: "empty" };
  }
  if (OPEN_ENDED.test(text)) {
    return { date: null, note: text, kind: "openEnded" };
  }
  if (UNKNOWN.test(text)) {
    return { date: null, note: text, kind: "unknown" };
  }

  // 2026-06-22 00:00:00  |  2026-06-22
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]|$)/);
  if (m) {
    const d = iso(+m[1], +m[2], +m[3]);
    if (d) return { date: d, note: "", kind: "date" };
  }

  // 07.08.2026 | 7/8/2026 | 12-05-2026  -> day first (Indian convention)
  m = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const d = iso(y, +m[2], +m[1]);
    if (d) return { date: d, note: "", kind: "date" };
  }

  // 7-Sept | 2 Sept | 16- Sept | 21st Sept | Sept 7
  m = text.match(/^(\d{1,2})\s*(?:st|nd|rd|th)?\s*[-. ]\s*([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const d = iso(m[3] ? +m[3] : fallbackYear, MONTHS[m[2].toLowerCase()], +m[1]);
    if (d) return { date: d, note: "", kind: "date" };
  }
  m = text.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const d = iso(m[3] ? +m[3] : fallbackYear, MONTHS[m[1].toLowerCase()], +m[2]);
    if (d) return { date: d, note: "", kind: "date" };
  }

  return { date: null, note: text, kind: "note" };
}

/** Pull a usable date out of prose like "Will go on till end of September." */
function inferFromProse(text, fallbackYear = DEFAULT_YEAR) {
  const t = String(text || "").toLowerCase();
  const m = t.match(/(?:till|until|by|through|end of|mid)\s+(?:the\s+)?(?:end\s+of\s+)?([a-z]{3,9})/);
  if (m && MONTHS[m[1]]) {
    const mo = MONTHS[m[1]];
    const last = new Date(Date.UTC(fallbackYear, mo, 0)).getUTCDate();
    return iso(fallbackYear, mo, /\bmid\b/.test(t) ? 15 : last);
  }
  return null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000
  );
}

module.exports = { parseDate, inferFromProse, todayISO, addDays, daysBetween, MONTHS, DEFAULT_YEAR, OPEN_ENDED, UNKNOWN };
