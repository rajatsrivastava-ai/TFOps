"use strict";
/* The DM sheet, pasted in. One row per project: Priority, Status, Client
   Name (Brand), DM, SDM, Revenue, Project Category, Project Scope, Completed
   from Scope, then one column per day holding that day's free-text update.

   Two passes. `preview()` parses the paste and says what would change — which
   rows match which projects, which fields differ, how many updates are new —
   without touching the board. `commit()` applies the same parse with the
   reviewer's decisions, inside one store mutation.

   Rules that matter:
   - A row is matched by slug(client + " " + project), which is exactly how the
     board's ids were built; failing that, by the client's rows and the words
     in the project name. The reviewer can override any match.
   - The sheet is the source of truth for the fields it carries, unless the
     board was edited in the app since the last import — then the board wins
     and the preview shows both.
   - Updates are deduplicated by their text, not their date: the first seed
     resolved bare weekday headers by guesswork, so a matching text with a
     different date means the date was wrong, not the update new.
   - Revenue sits beside the booked figure (`sheetRevenue`) and only replaces
     it where the reviewer says so, or where nothing was booked at all.
   - Nothing is ever deleted: rows missing from the sheet are flagged, not removed. */

const crypto = require("crypto");
const { parseDate } = require("./dates");

const slug = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ------------------------------------------------------------------ TSV */

/** Google Sheets quotes any cell holding a tab, newline or quote, doubling
    inner quotes. A small state machine is the only honest parser for that. */
function parseTSV(text) {
  const src = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [], cell = "", inQ = false, i = 0;
  while (i < src.length) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQ = false; i += 1; continue;
      }
      cell += c; i += 1; continue;
    }
    if (c === '"' && cell === "") { inQ = true; i += 1; continue; }
    if (c === "\t") { row.push(cell); cell = ""; i += 1; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 1; continue; }
    cell += c; i += 1;
  }
  row.push(cell);
  rows.push(row);
  // Drop trailing empty rows.
  while (rows.length && rows[rows.length - 1].every((c) => !String(c).trim())) rows.pop();
  return rows;
}

/* -------------------------------------------------------------- headers */

const FIXED = [
  ["priority",  /^priority/i],
  ["status",    /^status/i],
  ["client",    /client|brand/i],
  ["dm",        /^dm\b|delivery manager/i],
  ["sdm",       /^sdm/i],
  ["revenue",   /revenue|value/i],
  ["category",  /categor|service line|work type/i],
  ["scope",     /scope/i],
  ["completed", /completed|delivered/i],
];

const WD = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const stripWeekday = (s) => String(s || "").replace(/[,\s]+(sun|mon|tues?|wed|thur?s?|fri|sat)\.?$/i, "").trim();
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();

/** Which row is the header, which column is which, and what date each
    trailing column stands for. */
function detectHeader(rows, today) {
  const year = Number(String(today || new Date().toISOString()).slice(0, 4));
  let hi = rows.findIndex((r) => r.some((c) => /^priority/i.test(String(c).trim())) && r.some((c) => /^status/i.test(String(c).trim())));
  if (hi < 0) hi = 0;
  const header = rows[hi].map((c) => String(c).trim());

  const cols = {};
  const used = new Set();
  FIXED.forEach(([key, re]) => {
    const idx = header.findIndex((h, i) => !used.has(i) && h && re.test(h) && !(key === "scope" && /completed/i.test(h)));
    if (idx >= 0) { cols[key] = idx; used.add(idx); }
  });
  if (cols.client === undefined) throw new Error("Could not find the client column in the header row.");

  // Everything after the last fixed column is a day. Dated headers first…
  const firstDay = Math.max(...Object.values(cols)) + 1;
  const dateCols = [];
  let prev = null;
  for (let i = firstDay; i < header.length; i++) {
    const label = header[i];
    if (!label) continue;
    const parsed = parseDate(stripWeekday(label), year);
    let date = parsed.date;
    // Headers run left to right in time; a drop of most of a year means the
    // year rolled over (the sheet never writes one).
    if (date && prev && date < addDays(prev, -300)) date = String(Number(date.slice(0, 4)) + 1) + date.slice(4);
    dateCols.push({ index: i, label, date, weekday: WD[label.toLowerCase().replace(/\.$/, "")] });
    if (date) prev = date;
  }
  // …then bare weekdays, placed between their dated neighbours.
  dateCols.forEach((c, k) => {
    if (c.date || c.weekday === undefined) return;
    const left = dateCols.slice(0, k).reverse().find((x) => x.date);
    if (left) {
      let d = addDays(left.date, 1);
      for (let g = 0; g < 7 && dow(d) !== c.weekday; g++) d = addDays(d, 1);
      c.date = d; c.guessed = true; return;
    }
    const right = dateCols.slice(k + 1).find((x) => x.date);
    if (right) {
      let d = addDays(right.date, -1);
      for (let g = 0; g < 7 && dow(d) !== c.weekday; g++) d = addDays(d, -1);
      c.date = d; c.guessed = true;
    }
  });
  return { headerIndex: hi, cols, dateCols: dateCols.filter((c) => c.date) };
}

/* ------------------------------------------------------------- parsing */

/** "10,00,000", "₹650,000.00", "3000000", "5,19,200.20", "Rs 2.5 L" → rupees, or null. */
function parseRevenue(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  const lakh = s.match(/^(?:₹|rs\.?|inr)?\s*([\d.]+)\s*(l|lac|lakh|lakhs)\b/i);
  if (lakh) return Math.round(Number(lakh[1]) * 1e5);
  const cr = s.match(/^(?:₹|rs\.?|inr)?\s*([\d.]+)\s*(cr|crore|crores)\b/i);
  if (cr) return Math.round(Number(cr[1]) * 1e7);
  const n = Number(s.replace(/[₹,\s]|rs\.?|inr/gi, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/* Canonical service lines — the names compute.js weighs effort by. */
const CATEGORY_ALIASES = [
  ["Content @ Scale",  /content\s*(@|at)\s*scale/i],
  ["Personalisation",  /personali[sz]ation|personali[sz]ed/i],
  ["Avatar Creative",  /avatar.*creative|creative.*avatar/i],
  ["Avatar Simple",    /avatar.*simple|simple.*avatar/i],
  ["Cinematic",        /cinematic/i],
  ["End to End",       /end\s*to\s*end|\be2e\b/i],
];
function parseCategories(raw) {
  return String(raw || "").split(/[,+/;]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const hit = CATEGORY_ALIASES.find(([, re]) => re.test(s));
    return hit ? hit[0] : s.replace(/\s+/g, " ");
  }).filter((v, i, a) => a.indexOf(v) === i);
}

const PRIORITY = { high: "High", medium: "Medium", med: "Medium", low: "Low" };
function parsePriority(raw) { return PRIORITY[String(raw || "").trim().toLowerCase()] || ""; }
function parseStatus(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return "";
  if (t.includes("hold")) return "On Hold";
  if (t.includes("complet") || t.includes("done") || t.includes("closed")) return "Completed";
  if (t.includes("upcoming") || t.includes("pipeline")) return "Upcoming";
  return "Active";
}
const splitNames = (raw) => String(raw || "").split(/[,;&]|\band\b/).map((s) => s.trim()).filter(Boolean);
const normText = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/^[\s\-•*–]+/, "").replace(/\s+/g, " ").replace(/[\s.;:,]+$/, "").trim();

function parseRow(cells, cols, dateCols, rowIndex) {
  const get = (k) => (cols[k] === undefined ? "" : String(cells[cols[k]] ?? "").trim());
  const clientRaw = get("client");
  if (!clientRaw) return null;
  const colon = clientRaw.indexOf(":");
  const client = (colon > 0 ? clientRaw.slice(0, colon) : clientRaw).trim();
  const projectName = (colon > 0 ? clientRaw.slice(colon + 1) : "").trim();
  const dms = splitNames(get("dm"));
  const updates = [];
  dateCols.forEach((c) => {
    const text = String(cells[c.index] ?? "").trim();
    if (text) updates.push({ date: c.date, label: c.label, text, guessedDate: !!c.guessed });
  });
  return {
    rowIndex, clientRaw, client, projectName,
    key: slug(client + " " + projectName),
    priority: parsePriority(get("priority")),
    status: parseStatus(get("status")),
    dms, primaryDm: dms[0] || "",
    sdm: get("sdm"),
    revenue: parseRevenue(get("revenue")),
    categories: parseCategories(get("category")),
    scopeLocked: get("scope"),
    scopeCompleted: get("completed"),
    updates,
  };
}

function parseSheet(text, today, renames = {}) {
  const rows = parseTSV(text);
  if (rows.length < 2) throw new Error("That does not look like the sheet — paste the header row and at least one project row.");
  const { headerIndex, cols, dateCols } = detectHeader(rows, today);
  const parsed = [];
  const fix = (n) => renames[n] || n;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = parseRow(rows[i], cols, dateCols, i + 1);
    if (!r) continue;
    // A reviewer may say "the sheet's X is the board's Y": apply before matching.
    r.dms = r.dms.map(fix); r.primaryDm = fix(r.primaryDm); r.sdm = fix(r.sdm);
    parsed.push(r);
  }
  return { rows: parsed, cols, dateCols, hash: crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16) };
}

/** Rename one person everywhere they appear on the board. */
function renamePerson(data, from, to) {
  const f = String(from || "").trim(), t = String(to || "").trim();
  if (!f || !t || f === t) return false;
  const swap = (v) => (v === f ? t : v);
  const swapList = (arr) => (Array.isArray(arr) ? arr.map(swap).filter((v, i, a) => a.indexOf(v) === i) : arr);
  const person = data.people.find((p) => p.name === f);
  const existing = data.people.find((p) => p.name === t);
  if (person && !existing) { person.name = t; person.id = slug(t); }
  else if (person && existing) { existing.roles = [...new Set([...(existing.roles || []), ...(person.roles || [])])]; data.people.splice(data.people.indexOf(person), 1); }
  data.projects.forEach((p) => { p.dms = swapList(p.dms); p.editorLeads = swapList(p.editorLeads); p.primaryDm = swap(p.primaryDm); p.sdm = swap(p.sdm); p.podOwner = swap(p.podOwner); });
  data.updates.forEach((u) => { u.author = swap(u.author); if (u.nextActionOwner) u.nextActionOwner = swap(u.nextActionOwner); });
  (data.assignments || []).forEach((a) => { a.editor = swap(a.editor); a.dm = swap(a.dm); });
  (data.escalations || []).forEach((e) => { e.owner = swap(e.owner); if (e.nextActionOwner) e.nextActionOwner = swap(e.nextActionOwner); });
  return true;
}

/* ------------------------------------------------------------- matching */

const tokens = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3).map((t) => t.replace(/s$/, "")));
function overlap(a, b) { let n = 0; a.forEach((t) => { if (b.has(t)) n += 1; }); return n; }

/** Which board row this sheet row is. Exact id first, then the client's rows
    by the words in the project name. */
function match(row, projects) {
  const exact = projects.find((p) => p.id === row.key || slug(p.client + " " + p.projectName) === row.key || slug(p.label) === row.key);
  if (exact) return { projectId: exact.id, confidence: "exact", candidates: [exact.id] };
  const ck = slug(row.client);
  const same = projects.filter((p) => (p.clientKey || slug(p.client)) === ck);
  if (same.length === 1 && !row.projectName) return { projectId: same[0].id, confidence: "client", candidates: [same[0].id] };
  if (same.length) {
    const want = tokens(row.projectName);
    const scored = same.map((p) => ({ p, s: overlap(want, tokens(p.projectName)) })).sort((a, b) => b.s - a.s);
    if (scored[0].s > 0 && (scored.length === 1 || scored[0].s > scored[1].s)) {
      return { projectId: scored[0].p.id, confidence: "name", candidates: same.map((p) => p.id) };
    }
    if (same.length === 1) return { projectId: same[0].id, confidence: "client", candidates: [same[0].id] };
    return { projectId: null, confidence: "ambiguous", candidates: same.map((p) => p.id) };
  }
  return { projectId: null, confidence: "new", candidates: [] };
}

/* ----------------------------------------------------------- the diff */

const FIELDS = ["priority", "status", "dms", "sdm", "categories", "scopeLocked", "scopeCompleted"];

/** Does the board's value for this field date from an in-app edit newer than
    the last import? Then the app wins and the sheet value is only shown. */
function appWins(p, field, lastImportAt) {
  const t = p.touched && p.touched[field];
  if (!t) return false;
  return !lastImportAt || t > lastImportAt;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function diffRow(row, p, decisions, lastImportAt) {
  const changes = [];
  FIELDS.forEach((f) => {
    const to = row[f];
    const from = p[f];
    if (f === "status" && !to) return;                 // a blank status cell is not "Active"
    if (f === "priority" && !to && !from) return;
    if (same(from, to)) return;
    const forced = decisions.fields && decisions.fields[`${p.id}:${f}`];
    const keep = forced === "app" || (forced !== "sheet" && appWins(p, f, lastImportAt));
    changes.push({ field: f, from, to, apply: !keep, reason: keep ? "edited in the app since the last import" : "" });
  });
  if (row.primaryDm && row.primaryDm !== p.primaryDm) {
    const dmChange = changes.find((c) => c.field === "dms");
    if (!dmChange || dmChange.apply) changes.push({ field: "primaryDm", from: p.primaryDm, to: row.primaryDm, apply: true, reason: "" });
  }
  if (row.revenue !== null && row.revenue !== p.sheetRevenue) changes.push({ field: "sheetRevenue", from: p.sheetRevenue, to: row.revenue, apply: true, reason: "" });
  return changes;
}

function diffUpdates(row, projectId, existing) {
  const byText = new Map();
  existing.filter((u) => u.projectId === projectId).forEach((u) => { byText.set(normText(u.text), u); });
  const add = [], redate = [], dup = [];
  const seen = new Set();
  row.updates.forEach((u) => {
    const k = normText(u.text);
    if (!k || seen.has(k)) return;
    seen.add(k);
    const hit = byText.get(k);
    if (!hit) { add.push(u); return; }
    if (hit.date !== u.date && (hit.seeded || hit.imported) && !u.guessedDate) redate.push({ id: hit.id, from: hit.date, to: u.date, label: u.label });
    else dup.push(hit.id);
  });
  return { add, redate, dup };
}

/** Everything the commit would do, without doing it. `decisions` is the
    reviewer's map: {matches:{rowIndex: projectId|"new"|"skip"}, fields:{"id:field":"sheet"|"app"},
    revenue:{clientKey:"adopt"|"keep"}, people:{name:"add"|"skip"}}. */
function preview(data, text, decisions = {}, today) {
  const renames = decisions.renames && typeof decisions.renames === "object" ? decisions.renames : {};
  const parsed = parseSheet(text, today, renames);
  const lastImportAt = data.settings.lastImport && data.settings.lastImport.at;
  const renamedTo = new Set(Object.values(renames));
  const peopleByKey = new Map(data.people.map((p) => [slug(p.name), p]));
  const newPeople = new Map();
  // A first name on the board and the full name in the sheet are usually one
  // person; say so rather than quietly minting a second.
  const lookalike = (n) => {
    const first = n.toLowerCase().split(/\s+/)[0];
    return data.people.find((p) => { const w = p.name.toLowerCase().split(/\s+/); return (w[0] === first) && (w.length === 1 || n.split(/\s+/).length === 1) && p.name !== n; })?.name || null;
  };
  const noteNewPerson = (name, role) => {
    const n = String(name || "").trim();
    if (!n || peopleByKey.has(slug(n)) || renamedTo.has(n)) return;
    const e = newPeople.get(slug(n)) || { name: n, roles: new Set(), maybe: lookalike(n) };
    e.roles.add(role);
    newPeople.set(slug(n), e);
  };

  const seenIds = new Set();
  const rows = parsed.rows.map((row) => {
    const forced = decisions.matches && decisions.matches[row.rowIndex];
    let m = match(row, data.projects);
    if (forced === "new") m = { projectId: null, confidence: "forced-new", candidates: m.candidates };
    else if (forced === "skip") m = { projectId: null, confidence: "skip", candidates: m.candidates };
    else if (forced) m = { projectId: forced, confidence: "forced", candidates: m.candidates };
    const p = m.projectId ? data.projects.find((x) => x.id === m.projectId) : null;
    if (p) seenIds.add(p.id);

    row.dms.forEach((n) => noteNewPerson(n, "dm"));
    if (row.sdm) noteNewPerson(row.sdm, "sdm");

    if (m.confidence === "skip") return { row, match: m, action: "skip", changes: [], updates: { add: [], redate: [], dup: [] } };
    if (!p) {
      return {
        row, match: m, action: "create", changes: [],
        updates: { add: row.updates, redate: [], dup: [] },
        duplicateOf: data.projects.find((x) => x.id === row.key)?.id || null,
      };
    }
    return { row, match: m, action: "update", changes: diffRow(row, p, decisions, lastImportAt), updates: diffUpdates(row, p.id, data.updates) };
  });

  // Revenue by client: what the sheet's rows add up to against the book.
  const revenueByClient = new Map();
  rows.forEach((r) => {
    if (r.action === "skip" || r.row.revenue === null) return;
    const ck = slug(r.row.client);
    const e = revenueByClient.get(ck) || { clientKey: ck, client: r.row.client, sheetSum: 0, rows: 0, booked: null };
    e.sheetSum += r.row.revenue; e.rows += 1;
    revenueByClient.set(ck, e);
  });
  const revenue = [...revenueByClient.values()].map((e) => {
    const booked = data.revenue.find((x) => x.clientKey === e.clientKey);
    e.booked = booked ? Number(booked.amount) || 0 : null;
    const forced = decisions.revenue && decisions.revenue[e.clientKey];
    e.action = forced || (e.booked === null || e.booked === 0 ? "adopt" : e.booked === e.sheetSum ? "same" : "keep");
    return e;
  });

  const notInSheet = data.projects.filter((p) => !seenIds.has(p.id) && String(p.status || "").toLowerCase() !== "completed").map((p) => ({ id: p.id, label: p.label, status: p.status }));

  const summary = {
    rows: rows.length,
    update: rows.filter((r) => r.action === "update").length,
    create: rows.filter((r) => r.action === "create").length,
    skip: rows.filter((r) => r.action === "skip").length,
    ambiguous: rows.filter((r) => r.match.confidence === "ambiguous").length,
    fieldChanges: rows.reduce((n, r) => n + r.changes.filter((c) => c.apply).length, 0),
    fieldConflicts: rows.reduce((n, r) => n + r.changes.filter((c) => !c.apply).length, 0),
    updatesAdd: rows.reduce((n, r) => n + r.updates.add.length, 0),
    updatesRedate: rows.reduce((n, r) => n + r.updates.redate.length, 0),
    updatesDup: rows.reduce((n, r) => n + r.updates.dup.length, 0),
    dateColumns: parsed.dateCols.length,
    dateRange: parsed.dateCols.length ? [parsed.dateCols[0].date, parsed.dateCols[parsed.dateCols.length - 1].date] : null,
    guessedDates: parsed.dateCols.filter((c) => c.guessed).length,
    notInSheet: notInSheet.length,
  };

  return {
    hash: parsed.hash, summary, rows, revenue, notInSheet,
    newPeople: [...newPeople.values()].map((e) => ({ name: e.name, roles: [...e.roles], maybe: e.maybe, action: (decisions.people && decisions.people[e.name]) || "add" })),
    renames,
    dateCols: parsed.dateCols,
  };
}

/* --------------------------------------------------------------- commit */

/** Apply a preview to the board, in place. Returns the counts for the audit line. */
function apply(data, text, decisions, who, today, uid) {
  const pv = preview(data, text, decisions, today);
  if (decisions.hash && decisions.hash !== pv.hash) {
    const err = new Error("The paste changed since the preview — run the preview again.");
    err.code = 409;
    throw err;
  }
  const now = new Date().toISOString();
  const batch = uid("imp");
  const counts = { created: 0, updated: 0, fields: 0, updatesAdded: 0, updatesRedated: 0, people: 0, revenue: 0, renamed: 0 };

  // Renames first, so every match below sees the board under its new names.
  Object.entries(pv.renames || {}).forEach(([from, to]) => { if (renamePerson(data, from, to)) counts.renamed += 1; });
  const rowProject = new Map();        // rowIndex -> project, for the revenue pass

  const addPerson = (name, role) => {
    const n = String(name || "").trim();
    if (!n) return;
    const k = slug(n);
    const existing = data.people.find((p) => p.id === k);
    if (existing) { if (!existing.roles.includes(role)) existing.roles.push(role); return; }
    const decision = pv.newPeople.find((x) => x.name === n)?.action || "add";
    if (decision !== "add") return;
    data.people.push({ id: k, name: n, roles: [role], pods: [], active: true, title: "",
      capacityHoursPerWeek: null, skills: [], availability: { status: "available", fraction: null, until: null } });
    counts.people += 1;
  };

  pv.rows.forEach((r) => {
    if (r.action === "skip") return;
    const row = r.row;
    let p = r.action === "update" ? data.projects.find((x) => x.id === r.match.projectId) : null;

    if (!p) {
      let id = row.key || uid("proj");
      if (data.projects.some((x) => x.id === id)) id = uid("proj");
      p = {
        id, client: row.client, clientKey: slug(row.client), projectName: row.projectName,
        label: [row.client, row.projectName].filter(Boolean).join(" — "),
        dms: row.dms, primaryDm: row.primaryDm, editorLeads: [], editorTagging: "",
        podOwner: "", sdm: row.sdm, priority: row.priority, status: row.status || "Active",
        categories: row.categories, scope: row.scopeLocked, scopeLocked: row.scopeLocked,
        completedFromScope: row.scopeCompleted, scopeCompleted: row.scopeCompleted, scopeUnits: null,
        waGroupLink: "", start: null, end: null, startNote: "", endNote: "", endInferred: false,
        openEnded: false, datesUnknown: false, progress: null,
        revenue: null, sheetRevenue: row.revenue, baselineOriginal: null, baselineLocked: false,
        deliveryOverride: null, touched: {}, tags: [],
        createdBy: who, createdAt: now, importedAt: now, importBatch: batch,
      };
      data.projects.push(p);
      counts.created += 1;
    } else {
      let touched = false;
      r.changes.forEach((c) => {
        if (!c.apply) return;
        p[c.field] = c.to;
        if (c.field === "scopeLocked") p.scope = c.to;
        if (c.field === "scopeCompleted") p.completedFromScope = c.to;
        counts.fields += 1; touched = true;
      });
      if (touched) { p.importedAt = now; p.importBatch = batch; counts.updated += 1; }
    }
    rowProject.set(row.rowIndex, p);

    row.dms.forEach((n) => addPerson(n, "dm"));
    if (row.sdm) addPerson(row.sdm, "sdm");

    r.updates.add.forEach((u) => {
      data.updates.unshift({
        id: uid("upd"), projectId: p.id, author: p.primaryDm || row.primaryDm || "Sheet import", role: "imported",
        date: u.date, dateLabel: u.label, status: "", text: u.text.slice(0, 4000), blockers: "", eta: "",
        createdAt: u.date + "T09:00:00.000Z", seeded: false, imported: true, importBatch: batch,
        guessedDate: !!u.guessedDate,
      });
      counts.updatesAdded += 1;
    });
    r.updates.redate.forEach((rd) => {
      const u = data.updates.find((x) => x.id === rd.id);
      if (!u) return;
      u.date = rd.to; u.dateLabel = rd.label; u.createdAt = rd.to + "T09:00:00.000Z"; u.guessedDate = false;
      counts.updatesRedated += 1;
    });
  });

  pv.revenue.forEach((e) => {
    if (e.action !== "adopt") return;
    const existing = data.revenue.find((x) => x.clientKey === e.clientKey);
    if (existing) { existing.amount = e.sheetSum; existing.unmapped = false; existing.editedBy = who; existing.source = "sheet"; }
    else data.revenue.push({ id: "rev-" + e.clientKey, client: e.client, clientKey: e.clientKey, amount: e.sheetSum, unmapped: false, source: "sheet" });
    // Several rows for one client, or a row filed under a different client key
    // on the board (the sheet's "Client: Project" matched a board row whose
    // client is "Client Project"): the figure goes on the row itself so
    // attribution cannot miss it.
    const rows = pv.rows.filter((r) => r.action !== "skip" && r.row.revenue !== null && slug(r.row.client) === e.clientKey);
    rows.forEach((r) => {
      const p = rowProject.get(r.row.rowIndex);
      if (!p) return;
      if (e.rows > 1 || (p.clientKey || slug(p.client)) !== e.clientKey) p.revenue = r.row.revenue;
    });
    counts.revenue += 1;
  });

  data.updates.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  data.settings.lastImport = { at: now, by: who, hash: pv.hash, counts, batch };
  return { counts, batch, hash: pv.hash };
}

module.exports = {
  parseTSV, detectHeader, parseRevenue, parseCategories, parseStatus, parsePriority, parseSheet,
  match, preview, apply, normText, slug, renamePerson,
};
