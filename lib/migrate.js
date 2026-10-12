"use strict";
/* Store migrations. `upgrade(data)` brings any board up to the current schema
   in place and says whether it changed anything. It is idempotent, so the
   store runs it on every load and nothing happens on a current board.

   Schema 2 (delivery product): dependency-linked milestones with baseline and
   forecast dates, hour-based editor assignments, escalation records, the
   structured daily update, and per-person capacity. Nothing is removed from a
   schema-1 board; new fields get neutral defaults ("not set", never zero). */

const SCHEMA = 2;

/* The default milestone chain. Durations are working days and are only a
   starting point — every project edits its own copy. */
const MILESTONE_TEMPLATE = [
  { stage: "brief",           title: "Brief / Inputs",            durationDays: 2, ownerType: "Client" },
  { stage: "script",          title: "Script",                    durationDays: 3, ownerType: "Creative" },
  { stage: "storyboard",      title: "Storyboard",                durationDays: 3, ownerType: "Creative" },
  { stage: "base_video",      title: "Base Video",                durationDays: 5, ownerType: "Editor" },
  { stage: "client_feedback", title: "Client Feedback",           durationDays: 3, ownerType: "Client" },
  { stage: "revisions",       title: "Revisions",                 durationDays: 3, ownerType: "Editor" },
  { stage: "adaptations",     title: "Adaptations / Automation",  durationDays: 4, ownerType: "AI/Tech" },
  { stage: "qc",              title: "QC",                        durationDays: 2, ownerType: "DM" },
  { stage: "final_delivery",  title: "Final Delivery",            durationDays: 1, ownerType: "DM" },
];

const SETTINGS_DEFAULTS = {
  utilAmber: 0.8,
  utilRed: 1.0,
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  capacityHoursPerWeek: 40,
  milestoneTemplate: MILESTONE_TEMPLATE,
  lastImport: null,                 // {at, by, hash, counts} after a sheet import
};

const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* `end` stays the one committed-delivery field (the sheet's date). The copy in
   `baselineOriginal` is taken the first time someone locks it and never moves
   again, so "original commitment vs today's forecast" needs no history scan. */
function upgradeProject(p) {
  let changed = false;
  const set = (k, v) => { if (!(k in p)) { p[k] = v; changed = true; } };
  set("primaryDm", (p.dms && p.dms[0]) || "");
  set("revenue", null);                                   // per-row override; null = share of the client booking
  set("sheetRevenue", null);                              // what the DM sheet said, for provenance
  set("scopeLocked", p.scope || "");
  set("scopeCompleted", p.completedFromScope || "");
  set("scopeUnits", null);                                // {locked, completed, unit} when measurable
  set("baselineOriginal", !p.openEnded && isISO(p.end) ? p.end : null);
  set("baselineLocked", false);
  set("deliveryOverride", null);
  set("touched", {});                                     // field -> ISO of the last in-app edit
  set("history", []);                                     // baseline / override changes, with reasons
  set("tags", []);
  if ("health" in p) { delete p.health; changed = true; } // always computed now
  return changed;
}

function upgradeMilestone(m, i) {
  if ("baselineDue" in m) return false;
  const date = isISO(m.date) ? m.date : null;
  Object.assign(m, {
    stage: m.stage || "custom",
    ownerType: m.ownerType || "DM",
    startDate: null,
    baselineDue: date,
    ownerEta: null,
    durationDays: null,
    lagDays: 0,
    dependsOn: [],
    actualStart: null,
    actualDone: m.done ? date : null,
    status: m.done ? "done" : "planned",
    blocker: "",
    locked: false,
    external: false,
    override: null,
    history: [],
    order: i,
  });
  delete m.date;
  delete m.done;
  return true;
}

function upgradePerson(person, defaults) {
  let changed = false;
  const set = (k, v) => { if (!(k in person)) { person[k] = v; changed = true; } };
  set("title", "");
  // The old `capacity` field was never read by anything; hours per week replaces it.
  const isEditor = (person.roles || []).some((r) => r === "editorLead" || r === "editor");
  set("capacityHoursPerWeek", isEditor ? (Number(person.capacity) > 0 ? Number(person.capacity) : defaults.capacityHoursPerWeek) : null);
  if ("capacity" in person) { delete person.capacity; changed = true; }
  set("skills", []);
  set("availability", { status: "available", fraction: null, until: null });
  return changed;
}

/** @returns {{changed:boolean, from:number, to:number}} */
function upgrade(data) {
  const from = data.schema || 1;
  let changed = false;

  // Collections that may be missing on any older board.
  for (const k of ["projects", "people", "revenue", "updates", "milestones", "audit"]) {
    if (!Array.isArray(data[k])) { data[k] = []; changed = true; }
  }
  for (const k of ["assignments", "escalations"]) {
    if (!Array.isArray(data[k])) { data[k] = []; changed = true; }
  }
  data.settings = data.settings || {};
  for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) {
    if (!(k in data.settings)) { data.settings[k] = JSON.parse(JSON.stringify(v)); changed = true; }
  }

  data.projects.forEach((p) => { if (upgradeProject(p)) changed = true; });
  data.milestones.forEach((m, i) => { if (upgradeMilestone(m, i)) changed = true; });
  data.people.forEach((p) => { if (upgradePerson(p, data.settings)) changed = true; });

  if (from < SCHEMA) {
    data.schema = SCHEMA;
    data.audit = data.audit || [];
    data.audit.unshift({
      ts: new Date().toISOString(), v: data.version || 0, who: "system", action: "migrate",
      detail: `schema ${from} → ${SCHEMA}: milestone chains, assignments, escalations, structured updates`,
    });
    changed = true;
  }
  return { changed, from, to: SCHEMA };
}

module.exports = { upgrade, SCHEMA, MILESTONE_TEMPLATE, SETTINGS_DEFAULTS };
