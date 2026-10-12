"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { upgrade, SCHEMA } = require("../lib/migrate");

const schema1 = () => ({
  schema: 1, version: 3, settings: { orgName: "TrueFan", capacityPerDM: 8, staleUpdateDays: 7 },
  people: [
    { id: "mira", name: "Mira", roles: ["editorLead"], pods: [], active: true, capacity: 35 },
    { id: "dev", name: "Dev", roles: ["dm"], pods: [], active: true },
  ],
  projects: [
    { id: "acme", client: "Acme", clientKey: "acme", projectName: "", label: "Acme", dms: ["Dev", "Esha"], editorLeads: ["Mira"],
      status: "Active", end: "2026-10-30", openEnded: false, scope: "10 videos", completedFromScope: "4", health: "" },
    { id: "beta", client: "Beta", clientKey: "beta", projectName: "", label: "Beta", dms: [], editorLeads: [], status: "Active", end: null, openEnded: true },
  ],
  revenue: [], updates: [],
  milestones: [{ id: "ms-1", projectId: "acme", title: "First cut", date: "2026-10-20", done: false, owner: "Dev" },
               { id: "ms-2", projectId: "acme", title: "Brief", date: "2026-10-01", done: true, owner: "Dev" }],
  audit: [],
});

test("schema 1 upgrades to the current schema with neutral defaults", () => {
  const d = schema1();
  const r = upgrade(d);
  assert.equal(r.changed, true);
  assert.equal(r.from, 1);
  assert.equal(d.schema, SCHEMA);
  assert.deepEqual(d.assignments, []);
  assert.deepEqual(d.escalations, []);
  assert.equal(d.settings.utilAmber, 0.8);
  assert.ok(Array.isArray(d.settings.milestoneTemplate));
  assert.equal(d.settings.capacityPerDM, 8);                     // untouched

  const acme = d.projects[0];
  assert.equal(acme.primaryDm, "Dev");
  assert.equal(acme.revenue, null);
  assert.equal(acme.scopeLocked, "10 videos");
  assert.equal(acme.scopeCompleted, "4");
  assert.equal(acme.baselineOriginal, "2026-10-30");
  assert.equal(acme.end, "2026-10-30");                          // still the one baseline field
  assert.equal("health" in acme, false);
  assert.equal(d.projects[1].baselineOriginal, null);            // open-ended: nothing committed
  assert.equal(d.projects[1].primaryDm, "");

  const [m1, m2] = d.milestones;
  assert.equal(m1.baselineDue, "2026-10-20");
  assert.equal(m1.actualDone, null);
  assert.equal(m1.status, "planned");
  assert.equal("date" in m1, false);
  assert.equal(m2.actualDone, "2026-10-01");
  assert.equal(m2.status, "done");
  assert.deepEqual(m1.dependsOn, []);

  assert.equal(d.people[0].capacityHoursPerWeek, 35);            // old capacity carried over
  assert.equal("capacity" in d.people[0], false);
  assert.equal(d.people[1].capacityHoursPerWeek, null);          // a DM has no editing hours
  assert.equal(d.audit[0].action, "migrate");
});

test("upgrade is idempotent", () => {
  const d = schema1();
  upgrade(d);
  const snapshot = JSON.stringify(d);
  const r = upgrade(d);
  assert.equal(r.changed, false);
  assert.equal(JSON.stringify(d), snapshot);
});

test("a current board with a missing collection is repaired without a schema bump", () => {
  const d = schema1();
  upgrade(d);
  delete d.escalations;
  const r = upgrade(d);
  assert.equal(r.changed, true);
  assert.deepEqual(d.escalations, []);
  assert.equal(d.audit.filter((a) => a.action === "migrate").length, 1);
});
