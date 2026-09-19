"use strict";
/* Builds data/store.json from the original PodLoadBoard.html export.
   Run once: node lib/seed.js  (add --force to rebuild over an existing store). */

const fs = require("fs");
const path = require("path");
const { parseDate, inferFromProse, DEFAULT_YEAR } = require("./dates");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "PodLoadBoard.html");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const OUT = path.join(DATA_DIR, "store.json");

const WEEKDAYS = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

function slug(x) {
  return String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readSource() {
  const html = fs.readFileSync(SOURCE, "utf8");
  const m = html.match(/<script id="board-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("board-data block not found in " + SOURCE);
  return JSON.parse(m[1]);
}

/* The sheet export is gitignored — it carries a real client book. So a fresh
   clone seeds an empty but valid board rather than refusing to start. */
const EMPTY_SOURCE = { projects: [], revenue: [] };

/* History rows are labelled "15th Sept Tue", "09th Sept Wed" or just "Fri".
   Dated labels win; a bare weekday resolves to its most recent occurrence. */
function labelToDate(label, anchorISO) {
  const raw = String(label || "").trim();
  if (!raw) return null;

  const stripped = raw.replace(/\s+(sun|mon|tues?|wed|thur?s?|fri|sat)\.?$/i, "").trim();
  const parsed = parseDate(stripped);
  if (parsed.date) return parsed.date;

  const wd = WEEKDAYS[raw.toLowerCase().replace(/\.$/, "")];
  if (wd === undefined) return null;
  const anchor = new Date(anchorISO + "T00:00:00Z");
  let back = (anchor.getUTCDay() - wd + 7) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - back);
  return anchor.toISOString().slice(0, 10);
}

function normaliseProject(p) {
  const s = parseDate(p.startDate);
  const e = parseDate(p.endDate);
  let end = e.date;
  let openEnded = e.kind === "openEnded";
  let endInferred = false;
  if (!end && e.kind === "note") {
    const inferred = inferFromProse(e.note);
    if (inferred) { end = inferred; endInferred = true; }
    else if (/\b(till|until|ongoing|recurring|diwali)\b/i.test(e.note)) openEnded = true;
  }

  const display = [p.client, String(p.projectName || "").replace(/^\s*-\s*/, "")]
    .filter(Boolean).join(" — ");

  return {
    id: p.id,
    client: p.client || "",
    clientKey: slug(p.client),
    projectName: String(p.projectName || "").replace(/^\s*-\s*/, "").trim(),
    label: display || p.client || p.id,
    dms: p.dms || [],
    editorLeads: p.editorLeads || [],
    editorTagging: p.editorTagging || "",
    podOwner: p.podOwner || "",
    sdm: p.sdm || "",
    priority: p.priority || "",
    status: p.status || "Active",
    categories: p.categories || [],
    scope: p.scope || "",
    completedFromScope: p.completedFromScope || "",
    waGroupLink: p.waGroupLink || "",
    start: s.date,
    startNote: s.note,
    end,
    endNote: e.note,
    endInferred,
    openEnded,
    datesUnknown: s.kind === "unknown" || e.kind === "unknown",
    progress: null,
    health: "",
    sourceRow: p.sourceRow,
  };
}

function build() {
  const base = fs.existsSync(SOURCE) ? readSource() : EMPTY_SOURCE;
  const anchor = new Date().toISOString().slice(0, 10);
  const projects = base.projects.map(normaliseProject);

  const updates = [];
  base.projects.forEach((p) => {
    (p.history || []).forEach((h, i) => {
      const text = String(h.text || "").trim();
      if (!text) return;
      const date = labelToDate(h.label, anchor);
      updates.push({
        id: `seed-${p.id}-${i}`,
        projectId: p.id,
        author: (p.dms && p.dms[0]) || (p.editorLeads && p.editorLeads[0]) || "Sheet import",
        role: "imported",
        date: date || "",
        dateLabel: h.label || "",
        status: "",
        text,
        blockers: "",
        eta: "",
        createdAt: (date || anchor) + "T09:00:00.000Z",
        seeded: true,
      });
    });
  });
  updates.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Roster, derived from who actually appears on the board.
  const people = {};
  const add = (name, role, pod) => {
    const n = String(name || "").trim();
    if (!n || n === "(unassigned)") return;
    const k = slug(n);
    if (!people[k]) people[k] = { id: k, name: n, roles: [], pods: [], active: true };
    if (!people[k].roles.includes(role)) people[k].roles.push(role);
    if (pod && !people[k].pods.includes(pod)) people[k].pods.push(pod);
  };
  projects.forEach((p) => {
    p.dms.forEach((d) => add(d, "dm", p.podOwner));
    p.editorLeads.forEach((d) => add(d, "editorLead", p.podOwner));
    add(p.podOwner, "podOwner", p.podOwner);
    add(p.sdm, "sdm", p.podOwner);
  });

  const store = {
    schema: 1,
    seededFrom: fs.existsSync(SOURCE) ? "PodLoadBoard.html" : "empty",
    version: 1,
    updatedAt: new Date().toISOString(),
    fiscalYear: DEFAULT_YEAR,
    settings: {
      orgName: "TrueFan",
      adminName: "your admin",   // who to ask for the password
      boardName: "TFOps",
      capacityPerDM: 8,
      capacityPerEditor: 10,
      costPerDM: 1400000,
      costPerEditor: 1100000,
      targetRevenueCr: 15,
      staleUpdateDays: 7,
    },
    people: Object.values(people).sort((a, b) => a.name.localeCompare(b.name)),
    projects,
    revenue: base.revenue.map((r) => ({
      id: r.id,
      client: r.client,
      clientKey: slug(r.client),
      amount: Number(r.amount) || 0,
      unmapped: !!r.unmapped,
    })),
    updates,
    milestones: [],
    audit: [
      { ts: new Date().toISOString(), who: "system", action: "seed",
        detail: `${projects.length} projects, ${base.revenue.length} clients, ${updates.length} historical updates` },
    ],
  };
  return store;
}

function main() {
  const force = process.argv.includes("--force");
  if (fs.existsSync(OUT) && !force) {
    console.log(`${OUT} already exists — leaving it alone (pass --force to rebuild).`);
    return;
  }
  const store = build();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(store, null, 2));
  const dated = store.projects.filter((p) => p.start || p.end).length;
  console.log(`Wrote ${OUT}`);
  console.log(`  projects ${store.projects.length}  (${dated} with at least one real date)`);
  console.log(`  clients  ${store.revenue.length}  people ${store.people.length}  updates ${store.updates.length}`);
  if (store.seededFrom === "empty") {
    console.log("");
    console.log(`  No ${path.basename(SOURCE)} found, so the board starts empty.`);
    console.log(`  Add projects in the app, or drop your own export next to lib/seed.js`);
    console.log(`  and re-run with --force.`);
  }
}

if (require.main === module) main();
module.exports = { build, slug, labelToDate };
