"use strict";
/* Boots the real server on a scratch data dir and walks the API end to end:
   migration on first read, the sheet import, a milestone chain with a moved
   date, an assignment preview, an escalation's life, a structured update. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 8871;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, "..");
let proc, dataDir;

const fixture = () => ({
  schema: 1, version: 1, updatedAt: "2026-10-01T00:00:00.000Z",
  settings: { orgName: "TrueFan", boardName: "TFOps", capacityPerDM: 8, capacityPerEditor: 10, costPerDM: 1, costPerEditor: 1, targetRevenueCr: 15, staleUpdateDays: 7 },
  people: [
    { id: "dev-mehta", name: "Dev Mehta", roles: ["dm"], pods: [], active: true },
    { id: "mira-sen", name: "Mira Sen", roles: ["editorLead"], pods: [], active: true },
    { id: "nikhil", name: "Nikhil", roles: ["editorLead"], pods: [], active: true },
  ],
  projects: [
    { id: "initech", client: "Initech", clientKey: "initech", projectName: "", label: "Initech", dms: ["Gita Menon"], editorLeads: ["Mira Sen"],
      editorTagging: "", podOwner: "Farid Ali", sdm: "Indu", priority: "High", status: "Active", categories: ["Content @ Scale"],
      scope: "2,500 videos", completedFromScope: "", waGroupLink: "", start: null, startNote: "", end: "2026-10-30", endNote: "", endInferred: false,
      openEnded: false, datesUnknown: false, progress: null, health: "", sourceRow: 1 },
    { id: "umbrella-bank", client: "Umbrella Bank", clientKey: "umbrella-bank", projectName: "", label: "Umbrella Bank", dms: ["Hari Das"], editorLeads: ["Nikhil"],
      editorTagging: "", podOwner: "", sdm: "Kiran", priority: "Medium", status: "Active", categories: ["Personalisation"],
      scope: "", completedFromScope: "", waGroupLink: "", start: null, startNote: "", end: null, endNote: "", endInferred: false,
      openEnded: false, datesUnknown: false, progress: null, health: "", sourceRow: 2 },
  ],
  revenue: [{ id: "r1", client: "Initech", clientKey: "initech", amount: 0, unmapped: true }],
  updates: [], milestones: [], audit: [],
});

const TSV = [
  "Priority\tStatus\tClient Name (Brand)\tDM\tSDM\tRevenue\tProject Category\tProject Scope (Locked on Hubspot)\tCompleted from Scope\t28th Sept Mon\t1 October",
  "High\tActive\tInitech\tGita Menon, Hari Das\tIndu\t10,00,000\tContent @ Scale\tContent at Scale — 2,500 videos\t\t600 videos rendering\tPipeline fix in progress",
  "Low\tOn Hold\tNewCo\tEsha Kapoor\tJai\t₹650,000.00\tPersonalisation\tMascot\t\t\tscripts shared",
].join("\n");

const call = async (method, p, body, headers = {}) => {
  const r = await fetch(BASE + p, {
    method, headers: { "content-type": "application/json", cookie: "tfops_user=Tester", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = {};
  try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
};

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfops-test-"));
  fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify(fixture()));
  proc = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, HOST: "127.0.0.1", TFOPS_PASSWORD: "", TFOPS_VIEW_PASSWORD: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  proc.stderr.on("data", (c) => { err += c; });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + "/api/version"); if (r.ok) return; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not start: " + err);
});

after(() => { try { proc.kill(); } catch (_) {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {} });

test("first read migrates the board and keeps a pre-migration copy", async () => {
  const { body } = await call("GET", "/api/state");
  assert.equal(body.schema, 2);
  assert.deepEqual(body.assignments, []);
  assert.equal(body.projects[0].primaryDm, "Gita Menon");
  assert.equal(body.projects[0].baselineOriginal, "2026-10-30");
  assert.ok(body.today);
  const backups = fs.readdirSync(path.join(dataDir, "backups")).filter((f) => f.startsWith("pre-migrate-schema1"));
  assert.equal(backups.length, 1);
});

test("project PATCH validates, records touched fields, and refuses a silent baseline move", async () => {
  let r = await call("PATCH", "/api/projects/initech", { priority: "Urgent" });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.fields, ["priority"]);
  r = await call("PATCH", "/api/projects/initech", { end: "2026-11-05" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /needs a reason/);
  r = await call("PATCH", "/api/projects/initech", { end: "2026-11-05", reason: "client moved the launch", priority: "Medium" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.changed.sort(), ["end", "priority"]);
  assert.ok(r.body.project.touched.priority);
  assert.equal(r.body.project.history[0].from, "2026-10-30");
  assert.equal(r.body.project.history[0].reason, "client moved the launch");
  assert.equal(r.body.project.baselineOriginal, "2026-10-30");   // the original commitment survives
});

test("sheet import: preview then commit, app edits win, revenue adopted where nothing was booked", async () => {
  let r = await call("POST", "/api/import/sheet", { tsv: TSV });
  assert.equal(r.status, 200);
  const pv = r.body.preview;
  assert.equal(pv.summary.update, 1);
  assert.equal(pv.summary.create, 1);
  const flip = pv.rows[0];
  const prio = flip.changes.find((c) => c.field === "priority");
  assert.equal(prio.apply, false);                                  // edited in the app a moment ago
  assert.equal(prio.to, "High");
  assert.equal(pv.revenue[0].action, "adopt");                       // Initech had ₹0 booked

  r = await call("POST", "/api/import/sheet", { tsv: TSV, commit: true, decisions: { hash: pv.hash } });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.counts.created, 1);
  assert.equal(r.body.result.counts.updatesAdded, 3);
  const { body } = await call("GET", "/api/state");
  assert.equal(body.projects.find((p) => p.id === "initech").priority, "Medium");
  assert.equal(body.revenue.find((x) => x.clientKey === "initech").amount, 1000000);
  assert.equal(body.settings.lastImport.by, "Tester");
  assert.ok(body.projects.find((p) => p.client === "NewCo"));

  r = await call("POST", "/api/import/sheet", { tsv: TSV + "\nchanged", commit: true, decisions: { hash: pv.hash } });
  assert.equal(r.status, 409);
});

test("template chain, moving a milestone with preview and commit, history and downstream slip", async () => {
  let r = await call("POST", "/api/projects/umbrella-bank/milestones/template", { startDate: "2026-10-12" });
  assert.equal(r.status, 200);
  const chain = r.body.milestones;
  assert.equal(chain.length, 9);
  assert.equal(chain[0].stage, "brief");
  assert.deepEqual(chain[1].dependsOn, [chain[0].id]);
  assert.equal(chain[8].stage, "final_delivery");
  const finalBaseline = chain[8].baselineDue;

  // Preview: pushing the script milestone's promise out a week.
  r = await call("PATCH", `/api/milestones/${chain[1].id}?preview=1`, { ownerEta: "2026-10-28" });
  assert.equal(r.status, 200);
  assert.equal(r.body.preview, true);
  assert.ok(r.body.impact.moved.length >= 7);
  assert.ok(r.body.impact.delivery.after > finalBaseline);
  assert.equal(r.body.impact.delivery.forecastMiss, true);
  assert.equal(r.body.impact.affectsCommitment, true);
  // Nothing was written by the preview.
  let state = (await call("GET", "/api/state")).body;
  assert.equal(state.milestones.find((m) => m.id === chain[1].id).ownerEta, null);

  // Baseline moves need a reason.
  r = await call("PATCH", `/api/milestones/${chain[1].id}`, { baselineDue: "2026-10-20" });
  assert.equal(r.status, 400);

  r = await call("PATCH", `/api/milestones/${chain[1].id}`, { ownerEta: "2026-10-28", status: "in_progress" });
  assert.equal(r.status, 200);
  assert.equal(r.body.milestone.ownerEta, "2026-10-28");
  assert.deepEqual(r.body.milestone.history.map((h) => h.field).sort(), ["ownerEta", "status"]);
  const eta = r.body.milestone.history.find((h) => h.field === "ownerEta");
  assert.equal(eta.to, "2026-10-28");
  assert.ok(r.body.milestone.actualStart);
  assert.ok(r.body.impact.delivery.after > finalBaseline);

  state = (await call("GET", "/api/state")).body;
  assert.equal(state.milestones.find((m) => m.id === chain[1].id).ownerEta, "2026-10-28");

  // Delete a milestone: dependents are relinked, not orphaned.
  r = await call("DELETE", `/api/milestones/${chain[2].id}`);
  assert.equal(r.status, 200);
  state = (await call("GET", "/api/state")).body;
  assert.equal(state.milestones.some((m) => m.id === chain[2].id), false);
  assert.deepEqual(state.milestones.find((m) => m.id === chain[3].id).dependsOn, []);
});

test("assignment preview reports utilisation before and after, and a creation adds the editor", async () => {
  let r = await call("POST", "/api/assignments/preview", { projectId: "initech", editor: "Mira Sen", estimatedHours: 30, scheduledStart: "2026-10-12", scheduledEnd: "2026-10-16" });
  assert.equal(r.status, 200);
  assert.equal(r.body.before.scheduled, 0);
  assert.equal(r.body.after.scheduled, 30);
  assert.equal(r.body.after.band, "green");
  assert.ok(Array.isArray(r.body.suggestions));

  r = await call("POST", "/api/assignments", { projectId: "umbrella-bank", editor: "Mira Sen", estimatedHours: 30, scheduledStart: "2026-10-12", scheduledEnd: "2026-10-16" });
  assert.equal(r.status, 200);
  const id = r.body.assignment.id;
  r = await call("POST", "/api/assignments/preview", { projectId: "initech", editor: "Mira Sen", estimatedHours: 20, scheduledStart: "2026-10-12", scheduledEnd: "2026-10-16" });
  assert.equal(r.body.after.scheduled, 50);
  assert.equal(r.body.after.band, "red");
  assert.ok(r.body.overloaded.length > 0);

  r = await call("PATCH", `/api/assignments/${id}`, { editor: "Nikhil", reason: "Mira is on Initech" });
  assert.equal(r.status, 200);
  assert.equal(r.body.assignment.history[0].to, "Nikhil");
  const state = (await call("GET", "/api/state")).body;
  assert.ok(state.projects.find((p) => p.id === "umbrella-bank").editorLeads.includes("Mira Sen"));
});

test("an escalation is raised, commented on and resolved", async () => {
  let r = await call("POST", "/api/escalations", { projectId: "initech", reason: "Client rejected the batch", severity: "high", owner: "Gita Menon", resolutionTarget: "2026-10-20" });
  assert.equal(r.status, 200);
  const id = r.body.escalation.id;
  assert.equal(r.body.escalation.status, "open");
  r = await call("POST", `/api/escalations/${id}/comments`, { text: "Pipeline team on the fix" });
  assert.equal(r.body.escalation.comments.length, 1);
  r = await call("PATCH", `/api/escalations/${id}`, { status: "resolved", resolution: "Workflow fixed, re-run delivered" });
  assert.equal(r.body.escalation.status, "resolved");
  assert.ok(r.body.escalation.resolvedAt);
});

test("a structured update posts, starts its milestone, records the next-milestone promise and can raise an escalation", async () => {
  const state = (await call("GET", "/api/state")).body;
  const ms = state.milestones.filter((m) => m.projectId === "umbrella-bank").sort((a, b) => a.order - b.order);
  const brief = ms[0], later = ms[ms.length - 1];
  let r = await call("POST", "/api/updates", {
    projectId: "umbrella-bank", completed: "Brief received, storyboard started", planned: "Share storyboard v1",
    milestoneId: brief.id, nextMilestoneId: later.id, nextMilestoneDate: "2026-11-20",
    blockers: "Waiting on brand kit", dependencyOwner: "Client", nextAction: "Chase brand kit", nextActionOwner: "Hari Das",
    expectedResolution: "2026-10-14", escalationRequired: true, escalationReason: "Brand kit overdue", escalationSeverity: "medium",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.update.draft, false);
  const after = (await call("GET", "/api/state")).body;
  assert.equal(after.milestones.find((m) => m.id === brief.id).status, "in_progress");
  assert.equal(after.milestones.find((m) => m.id === later.id).ownerEta, "2026-11-20");
  assert.ok(after.escalations.find((e) => e.reason === "Brand kit overdue"));

  // A draft saves without side effects and submits later.
  r = await call("POST", "/api/updates", { projectId: "umbrella-bank", draft: true, completed: "" });
  assert.equal(r.status, 200);
  const draftId = r.body.update.id;
  r = await call("PATCH", `/api/updates/${draftId}`, { draft: false });
  assert.equal(r.status, 403);                                       // nothing completed yet
  r = await call("PATCH", `/api/updates/${draftId}`, { completed: "Storyboard v1 shared", draft: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.update.draft, false);
});

test("writes need a name, and the read-only role is refused writes", async () => {
  const r = await fetch(BASE + "/api/escalations", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 401);
});
