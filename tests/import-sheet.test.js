"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const imp = require("../lib/import-sheet");
const { upgrade } = require("../lib/migrate");

const TODAY = "2026-10-12";
let n = 0;
const uid = (p) => `${p}-${++n}`;

const HEADER = "Priority\tStatus\tClient Name (Brand)\tDM\tSDM\tRevenue\tProject Category\tProject Scope (Locked on Hubspot)\tCompleted from Scope\t28th Sept Mon\t29th Sept Tue\tWed\t1 October\t09th October";
const ROWS = [
  "High\tActive\tNorthwind Pharma: Heart\tAsha Rao, Ben Thomas\tChitra Iyer\t\tPersonalisation\t\"Content at scale: 3 video templates;\n2000 videos\"\t\t\tRemaining languages to go live\t\t\t",
  "Medium\tActive\tGlobex: Festive DVC\tDev Mehta, Esha Kapoor\tFarid (CSM)\t\tCinematic\t2 end-to-end DVCs\tOngoing\tStoryboard locked, first cut due today\tStoryboard locked, first cut due today\t\t\tfeedback on audio and video for cut 1",
  "High\tActive\tInitech\tGita Menon, Hari Das\tIndu\t10,00,000\tContent @ Scale\tContent at Scale — 2,500 videos\t\t600 videos rendering\t\"- 4 new videos\n- feedback incorporation\"\t\t\tPipeline fix in progress",
  "Low\tOn Hold\tNewCo\tEsha Kapoor\tJai\t₹650,000.00\tPersonalisation, Avatar Creative\tMascot + 3 E2E videos\t\t\t\tscripts shared\t\t",
  "Medium\tActive\tUmbrella Bank\tHari Das\tKiran\t75,00,000\tPersonalisation, Cinematic\t\t\t\t\t\t\t",
];
const TSV = [HEADER, ...ROWS].join("\n");

function board() {
  const d = {
    schema: 1, version: 1, settings: { staleUpdateDays: 7 },
    people: [{ id: "asha-rao", name: "Asha Rao", roles: ["dm"], pods: [], active: true }],
    projects: [
      { id: "northwind-pharma-heart-healthy-hearts-campaign", client: "Northwind Pharma", clientKey: "northwind-pharma", projectName: "Heart - Healthy Hearts Campaign",
        label: "Northwind Pharma — Heart - Healthy Hearts Campaign", dms: ["Asha Rao"], editorLeads: [], podOwner: "", sdm: "Chitra Iyer",
        priority: "", status: "Active", categories: ["Personalisation"], scope: "", completedFromScope: "", end: null, openEnded: false },
      { id: "northwind-pharma-sleep", client: "Northwind Pharma", clientKey: "northwind-pharma", projectName: "Sleep", label: "Northwind Pharma — Sleep",
        dms: [], editorLeads: [], podOwner: "", sdm: "Chitra Iyer", priority: "", status: "On Hold", categories: [], scope: "", completedFromScope: "", end: null, openEnded: false },
      { id: "globex-festive-campaign-dvc", client: "Globex", clientKey: "globex", projectName: "Festive Campaign- DVC", label: "Globex — Festive Campaign- DVC",
        dms: ["Dev Mehta"], editorLeads: [], podOwner: "", sdm: "Farid (CSM)", priority: "", status: "Active", categories: ["Cinematic"], scope: "", completedFromScope: "", end: null, openEnded: false },
      { id: "globex-festive-campaign-stills-and-tvc", client: "Globex", clientKey: "globex", projectName: "Festive Campaign- Stills and TVC", label: "Globex — Festive Campaign- Stills and TVC",
        dms: ["Dev Mehta"], editorLeads: [], podOwner: "", sdm: "Farid (CSM)", priority: "", status: "Active", categories: ["Cinematic"], scope: "", completedFromScope: "", end: null, openEnded: false },
      { id: "initech", client: "Initech", clientKey: "initech", projectName: "", label: "Initech", dms: ["Gita Menon"], editorLeads: ["Lata"],
        podOwner: "", sdm: "Indu", priority: "High", status: "Active", categories: ["Content @ Scale"], scope: "Content at Scale — 2,500 videos", completedFromScope: "", end: null, openEnded: true },
      { id: "umbrella-bank", client: "Umbrella Bank", clientKey: "umbrella-bank", projectName: "", label: "Umbrella Bank", dms: ["Hari Das"], editorLeads: [],
        podOwner: "", sdm: "Kiran", priority: "Medium", status: "Active", categories: ["Personalisation"], scope: "", completedFromScope: "", end: null, openEnded: false },
    ],
    revenue: [{ id: "r1", client: "Umbrella Bank", clientKey: "umbrella-bank", amount: 5000000, unmapped: false }],
    updates: [
      // Seeded with a guessed date; the sheet says 28 Sept.
      { id: "seed-1", projectId: "globex-festive-campaign-dvc", author: "Dev Mehta", role: "imported", date: "2026-09-26", dateLabel: "Sat",
        text: "Storyboard locked, first cut due today", seeded: true },
    ],
    milestones: [], audit: [],
  };
  upgrade(d);
  return d;
}

test("TSV parser handles quoted multi-line cells and doubled quotes", () => {
  const rows = imp.parseTSV('a\t"line 1\nline 2"\t"say ""hi"""\nb\tc\td\n');
  assert.deepEqual(rows, [["a", "line 1\nline 2", 'say "hi"'], ["b", "c", "d"]]);
});

test("revenue, category and status normalisation", () => {
  assert.equal(imp.parseRevenue("10,00,000"), 1000000);
  assert.equal(imp.parseRevenue("₹650,000.00"), 650000);
  assert.equal(imp.parseRevenue("3000000"), 3000000);
  assert.equal(imp.parseRevenue("4,18,300.20"), 418300);
  assert.equal(imp.parseRevenue("₹ 300,000.00"), 300000);
  assert.equal(imp.parseRevenue(""), null);
  assert.equal(imp.parseRevenue("TBD"), null);
  assert.deepEqual(imp.parseCategories("Content @ Scale, Cinematic"), ["Content @ Scale", "Cinematic"]);
  assert.deepEqual(imp.parseCategories("Cinematic + Personalisation"), ["Cinematic", "Personalisation"]);
  assert.deepEqual(imp.parseCategories("Personalisation, Avatar Simple"), ["Personalisation", "Avatar Simple"]);
  assert.deepEqual(imp.parseCategories("End to End"), ["End to End"]);
  assert.equal(imp.parseStatus("On Hold"), "On Hold");
  assert.equal(imp.parseStatus("active"), "Active");
  assert.equal(imp.parsePriority("medium"), "Medium");
});

test("header detection maps fixed columns and resolves bare weekday headers between dated ones", () => {
  const { cols, dateCols } = imp.detectHeader(imp.parseTSV(TSV), TODAY);
  assert.equal(cols.client, 2);
  assert.equal(cols.scope, 7);
  assert.equal(cols.completed, 8);
  assert.deepEqual(dateCols.map((c) => c.date), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-09"]);
  assert.equal(dateCols[2].guessed, true);
});

test("rows match the board by id, then by client + project words", () => {
  const d = board();
  const { rows } = imp.parseSheet(TSV, TODAY);
  assert.equal(imp.match(rows[0], d.projects).projectId, "northwind-pharma-heart-healthy-hearts-campaign");
  assert.equal(imp.match(rows[0], d.projects).confidence, "name");
  assert.equal(imp.match(rows[1], d.projects).projectId, "globex-festive-campaign-dvc");
  assert.equal(imp.match(rows[2], d.projects).confidence, "exact");
  assert.equal(imp.match(rows[3], d.projects).confidence, "new");
});

test("preview reports field changes, app-edit conflicts, update dedupe by text and revenue beside the book", () => {
  const d = board();
  // Someone fixed the priority in the app after the (nonexistent) last import — the app wins.
  d.projects[0].priority = "Low";
  d.projects[0].touched = { priority: "2026-10-10T10:00:00.000Z" };

  const pv = imp.preview(d, TSV, {}, TODAY);
  assert.equal(pv.summary.rows, 5);
  assert.equal(pv.summary.create, 1);
  assert.equal(pv.summary.update, 4);

  const sun = pv.rows[0];
  const prio = sun.changes.find((c) => c.field === "priority");
  assert.equal(prio.apply, false);
  assert.equal(prio.to, "High");
  assert.deepEqual(sun.changes.find((c) => c.field === "dms").to, ["Asha Rao", "Ben Thomas"]);
  assert.equal(sun.updates.add.length, 1);

  const bajaj = pv.rows[1];
  assert.equal(bajaj.updates.add.length, 1);            // "feedbacks in audio…" is new
  assert.equal(bajaj.updates.redate.length, 1);         // the seeded Sat row is really 28 Sept
  assert.equal(bajaj.updates.redate[0].to, "2026-09-28");
  assert.equal(bajaj.updates.dup.length, 0);

  const flip = pv.rows[2];
  assert.equal(flip.changes.find((c) => c.field === "sheetRevenue").to, 1000000);
  assert.equal(flip.updates.add.length, 3);

  const hdfc = pv.revenue.find((r) => r.clientKey === "umbrella-bank");
  assert.equal(hdfc.booked, 5000000);
  assert.equal(hdfc.sheetSum, 7500000);
  assert.equal(hdfc.action, "keep");
  const flipRev = pv.revenue.find((r) => r.clientKey === "initech");
  assert.equal(flipRev.action, "adopt");               // nothing was booked
  assert.deepEqual(pv.newPeople.map((p) => p.name).sort(), ["Ben Thomas", "Chitra Iyer", "Dev Mehta", "Esha Kapoor", "Farid (CSM)", "Gita Menon", "Hari Das", "Indu", "Jai", "Kiran"]);
  assert.equal(pv.notInSheet.length, 2);               // Sleep and Stills&TVC rows stay, flagged
});

test("commit applies the preview, creates the new row, dedupes, adopts revenue and records the import", () => {
  const d = board();
  const before = d.updates.length;
  const r = imp.apply(d, TSV, { revenue: { "umbrella-bank": "adopt" } }, "Asha", TODAY, uid);
  assert.equal(r.counts.created, 1);
  const newco = d.projects.find((p) => p.client === "NewCo");
  assert.equal(newco.status, "On Hold");
  assert.equal(newco.sheetRevenue, 650000);
  assert.deepEqual(newco.categories, ["Personalisation", "Avatar Creative"]);
  assert.equal(d.updates.length, before + 1 + 1 + 3 + 1);   // sun + bajaj + initech ×3 + newco
  const seeded = d.updates.find((u) => u.id === "seed-1");
  assert.equal(seeded.date, "2026-09-28");
  assert.equal(d.revenue.find((x) => x.clientKey === "umbrella-bank").amount, 7500000);
  assert.equal(d.revenue.find((x) => x.clientKey === "initech").amount, 1000000);
  assert.equal(d.projects.find((p) => p.id === "initech").primaryDm, "Gita Menon");
  assert.ok(d.people.find((p) => p.name === "Ben Thomas"));
  assert.equal(d.settings.lastImport.by, "Asha");

  // Running the same paste again changes nothing.
  const pv2 = imp.preview(d, TSV, {}, TODAY);
  assert.equal(pv2.summary.updatesAdd, 0);
  assert.equal(pv2.summary.updatesRedate, 0);
  assert.equal(pv2.summary.fieldChanges, 0);
  assert.equal(pv2.summary.create, 0);
});

test("commit refuses a paste that changed since the preview", () => {
  const d = board();
  assert.throws(() => imp.apply(d, TSV, { hash: "nope" }, "Asha", TODAY, uid), /changed since the preview/);
});
