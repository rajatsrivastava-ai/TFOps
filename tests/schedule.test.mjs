import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addWorkingDays, workingDaysIn, templateChain, forecastMilestones, projectForecast,
  impact, utilisation, bestEditor, healthOf, overloadedDays, resolveAssignments,
} from "../public/js/schedule.mjs";

// 2026-10-12 is a Monday.
const TODAY = "2026-10-12";
const ms = (over) => ({
  id: "m", projectId: "p", title: "M", stage: "custom", ownerType: "DM", owner: "",
  startDate: null, baselineDue: null, ownerEta: null, durationDays: null, lagDays: 0, dependsOn: [],
  actualStart: null, actualDone: null, status: "planned", blocker: "", locked: false, external: false,
  override: null, history: [], order: 0, ...over,
});
const proj = (over) => ({ id: "p", status: "Active", end: null, openEnded: false, ...over });

test("working-day arithmetic skips weekends and holidays", () => {
  assert.equal(addWorkingDays("2026-10-09", 1), "2026-10-12");            // Fri + 1 = Mon
  assert.equal(addWorkingDays("2026-10-10", 0), "2026-10-12");            // Sat -> Mon
  assert.equal(addWorkingDays("2026-10-12", 4), "2026-10-16");
  assert.equal(workingDaysIn("2026-10-12", "2026-10-18"), 5);
  const cal = { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-10-13"] };
  assert.equal(addWorkingDays("2026-10-12", 1, cal), "2026-10-14");
});

test("template chain lays baselines end to end and links dependencies", () => {
  const chain = templateChain([
    { stage: "brief", title: "Brief", durationDays: 2 },
    { stage: "script", title: "Script", durationDays: 3 },
  ], "2026-10-12");
  assert.equal(chain[0].startDate, "2026-10-12");
  assert.equal(chain[0].baselineDue, "2026-10-13");
  assert.equal(chain[1].startDate, "2026-10-14");
  assert.equal(chain[1].baselineDue, "2026-10-16");
  assert.deepEqual(chain[1].dependsOnIndex, [0]);
});

test("a done milestone forecasts its actual date; an untouched planned one holds its baseline", () => {
  const list = [
    ms({ id: "a", baselineDue: "2026-10-14", durationDays: 3, startDate: "2026-10-12", actualDone: "2026-10-13", status: "done" }),
    ms({ id: "b", baselineDue: "2026-10-20", durationDays: 3, startDate: "2026-10-16", dependsOn: ["a"], order: 1 }),
  ];
  const fc = forecastMilestones(list, TODAY);
  assert.equal(fc.get("a").forecast, "2026-10-13");
  assert.equal(fc.get("a").drivenBy, "done");
  // b: deps finish 13th -> starts 14th, own start 16th wins -> 16,19,20 -> due 20th = baseline
  assert.equal(fc.get("b").forecast, "2026-10-20");
  assert.equal(fc.get("b").slipDays, 0);
});

test("a late dependency pushes downstream forecasts, baselines stay put", () => {
  const list = [
    ms({ id: "a", baselineDue: "2026-10-09", durationDays: 2, startDate: "2026-10-08", status: "in_progress", actualStart: "2026-10-08" }),
    ms({ id: "b", baselineDue: "2026-10-14", durationDays: 3, startDate: "2026-10-12", dependsOn: ["a"], order: 1 }),
    ms({ id: "c", baselineDue: "2026-10-16", durationDays: 2, startDate: "2026-10-15", dependsOn: ["b"], stage: "final_delivery", order: 2 }),
  ];
  const fc = forecastMilestones(list, TODAY);
  // a started on the 8th with 2 days of work; elapsed 2 working days (8th, 9th) -> remaining 1 -> finishes today.
  assert.equal(fc.get("a").forecast, TODAY);
  assert.equal(fc.get("a").overdue, true);
  assert.equal(fc.get("a").baseline, "2026-10-09");
  // b starts the working day after a (13th), 3 days -> 15th; slipped one day past its 14th baseline.
  assert.equal(fc.get("b").forecast, "2026-10-15");
  assert.equal(fc.get("b").slipDays, 1);
  // c starts 16th, 2 days -> 19th (Mon). baseline 16th -> slip 3 calendar days.
  assert.equal(fc.get("c").forecast, "2026-10-19");
  assert.equal(fc.get("c").slipDays, 3);

  const pf = projectForecast(proj(), list, TODAY);
  assert.equal(pf.baseline, "2026-10-16");
  assert.equal(pf.forecast, "2026-10-19");
  assert.equal(pf.forecastMiss, true);
  assert.equal(pf.current.id, "a");
});

test("an owner's later promise is the forecast; an optimistic one is flagged, not believed", () => {
  const late = forecastMilestones([ms({ id: "a", baselineDue: "2026-10-14", durationDays: 3, startDate: "2026-10-12", ownerEta: "2026-10-21" })], TODAY).get("a");
  assert.equal(late.forecast, "2026-10-21");
  assert.equal(late.drivenBy, "eta");
  const early = forecastMilestones([ms({ id: "a", baselineDue: "2026-10-14", durationDays: 3, startDate: "2026-10-12", ownerEta: "2026-10-13" })], TODAY).get("a");
  assert.equal(early.forecast, "2026-10-14");
  assert.equal(early.etaOptimisticBy, 1);
});

test("a past override goes stale instead of forecasting the past", () => {
  const f = forecastMilestones([ms({ id: "a", baselineDue: "2026-10-05", durationDays: 2, override: { date: "2026-10-08", reason: "client", by: "x", at: "" } })], TODAY).get("a");
  assert.equal(f.forecast, TODAY);
  assert.equal(f.overrideStale, true);
});

test("a lock protects the baseline but still shows the slip", () => {
  const f = forecastMilestones([ms({ id: "a", baselineDue: "2026-10-05", durationDays: 3, startDate: "2026-10-01", locked: true })], TODAY).get("a");
  assert.equal(f.baseline, "2026-10-05");
  assert.equal(f.forecast, "2026-10-14");          // starts today, 3 working days
  assert.equal(f.slipDays, 9);
});

test("missing duration is reported, not treated as zero", () => {
  const f = forecastMilestones([ms({ id: "a", baselineDue: "2026-10-20" })], TODAY).get("a");
  assert.deepEqual(f.missing, ["duration"]);
  assert.equal(f.forecast, "2026-10-20");
  const g = forecastMilestones([ms({ id: "a" })], TODAY).get("a");
  assert.deepEqual(g.missing, ["duration", "date"]);
  assert.equal(g.forecast, TODAY);
});

test("a dependency cycle is flagged and does not blank the project", () => {
  const list = [
    ms({ id: "a", baselineDue: "2026-10-14", durationDays: 2, dependsOn: ["b"] }),
    ms({ id: "b", baselineDue: "2026-10-16", durationDays: 2, dependsOn: ["a"], order: 1 }),
  ];
  const fc = forecastMilestones(list, TODAY);
  assert.equal(fc.get("a").cycle, true);
  assert.equal(fc.get("b").cycle, true);
  assert.ok(fc.get("a").forecast);
  assert.equal(projectForecast(proj(), list, TODAY).cycle, true);
});

test("project baseline is the sheet's end date; open-ended work is never late by date", () => {
  const pf = projectForecast(proj({ end: "2026-10-01" }), [], TODAY);
  assert.equal(pf.baseline, "2026-10-01");
  assert.equal(pf.overdue, true);
  assert.equal(pf.forecast, TODAY);
  assert.equal(pf.forecastSource, "today");
  const og = projectForecast(proj({ openEnded: true, end: null }), [], TODAY);
  assert.equal(og.forecast, null);
  assert.equal(og.forecastSource, "ongoing");
  assert.equal(og.overdue, false);
  const unset = projectForecast(proj(), [], TODAY);
  assert.equal(unset.forecastSource, "unset");
  assert.ok(unset.missing.includes("committed delivery date"));
});

test("impact lists moved milestones, the new delivery, and shared-editor conflicts", () => {
  const milestones = [
    ms({ id: "a", projectId: "p", baselineDue: "2026-10-14", durationDays: 3, startDate: "2026-10-12" }),
    ms({ id: "b", projectId: "p", baselineDue: "2026-10-19", durationDays: 2, startDate: "2026-10-15", dependsOn: ["a"], stage: "final_delivery", order: 1 }),
    ms({ id: "x", projectId: "q", baselineDue: "2026-10-22", durationDays: 3, startDate: "2026-10-20" }),
  ];
  const assignments = [
    { id: "as1", projectId: "p", milestoneId: "b", editor: "Mira", estimatedHours: 16, scheduledStart: null, scheduledEnd: null, status: "planned" },
    { id: "as2", projectId: "q", milestoneId: "x", editor: "Mira", estimatedHours: 24, scheduledStart: null, scheduledEnd: null, status: "planned" },
  ];
  const r = impact({ project: proj(), milestones, assignments, change: { id: "a", patch: { ownerEta: "2026-10-20" } }, today: TODAY });
  assert.deepEqual(r.moved.map((m) => m.id), ["a", "b"]);
  assert.equal(r.delivery.before, "2026-10-19");
  assert.equal(r.delivery.after, "2026-10-22");
  assert.equal(r.delivery.forecastMiss, true);
  assert.equal(r.affectsCommitment, true);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].editor, "Mira");
  assert.equal(r.conflicts[0].otherProjectId, "q");
  assert.equal(r.conflicts[0].hoursKnown, true);
});

test("utilisation is a lower bound when hours are missing, and never green then", () => {
  const person = { name: "Nikhil", roles: ["editorLead"], capacityHoursPerWeek: 40, availability: { status: "available" } };
  const base = [{ id: "a1", editor: "Nikhil", projectId: "p", estimatedHours: 20, scheduledStart: "2026-10-12", scheduledEnd: "2026-10-16", status: "planned" }];
  const full = utilisation({ person, assignments: base, from: "2026-10-12", to: "2026-10-16" });
  assert.equal(full.capacity, 40);
  assert.equal(full.scheduled, 20);
  assert.equal(full.band, "green");
  const partial = utilisation({ person, assignments: [...base, { id: "a2", editor: "Nikhil", projectId: "q", estimatedHours: null, scheduledStart: "2026-10-13", scheduledEnd: "2026-10-14", status: "planned" }], from: "2026-10-12", to: "2026-10-16" });
  assert.equal(partial.scheduled, 20);
  assert.equal(partial.incomplete, true);
  assert.deepEqual(partial.unestimated, ["a2"]);
  assert.equal(partial.band, "incomplete");
  const over = utilisation({ person, assignments: [{ ...base[0], estimatedHours: 44 }], from: "2026-10-12", to: "2026-10-16" });
  assert.equal(over.band, "red");
  const leave = utilisation({ person: { ...person, availability: { status: "out", until: "2026-10-14" } }, assignments: [], from: "2026-10-12", to: "2026-10-16" });
  assert.equal(leave.capacity, 16);
});

test("overloaded days and best editor", () => {
  const people = [
    { name: "A", roles: ["editorLead"], capacityHoursPerWeek: 40, skills: ["cinematic"] },
    { name: "B", roles: ["editorLead"], capacityHoursPerWeek: 40, skills: [] },
    { name: "C", roles: ["dm"] },
  ];
  const assignments = [{ id: "x", editor: "A", projectId: "p", estimatedHours: 30, scheduledStart: "2026-10-12", scheduledEnd: "2026-10-13", status: "planned" }];
  const od = overloadedDays({ person: people[0], assignments, from: "2026-10-12", to: "2026-10-16" });
  assert.equal(od.length, 2);
  assert.equal(od[0].hours, 15);
  const ranked = bestEditor({ people, assignments, from: "2026-10-12", to: "2026-10-16", skills: ["cinematic"] });
  assert.deepEqual(ranked.map((r) => r.name), ["B", "A"]);
  assert.equal(ranked[1].skillMatch, 1);
});

test("resolveAssignments windows unpinned work by its milestone", () => {
  const milestones = [ms({ id: "a", projectId: "p", baselineDue: "2026-10-16", durationDays: 3, startDate: "2026-10-14" })];
  const [r] = resolveAssignments([{ id: "as", projectId: "p", milestoneId: "a", editor: "A", status: "planned" }], milestones, TODAY);
  assert.equal(r.end, "2026-10-16");
  assert.equal(r.start, "2026-10-14");
  assert.equal(r.derived, true);
});

test("health never reports on-track without a commitment", () => {
  const p = proj();
  const unset = healthOf({ project: p, forecast: projectForecast(p, [], TODAY), today: TODAY, lastUpdateDate: TODAY });
  assert.equal(unset.key, "unknown");
  const ok = healthOf({ project: proj({ end: "2026-11-01" }), forecast: projectForecast(proj({ end: "2026-11-01" }), [], TODAY), today: TODAY, lastUpdateDate: TODAY });
  assert.equal(ok.key, "on_track");
  const stale = healthOf({ project: proj({ end: "2026-11-01" }), forecast: projectForecast(proj({ end: "2026-11-01" }), [], TODAY), today: TODAY, lastUpdateDate: "2026-09-01", staleUpdateDays: 7 });
  assert.equal(stale.key, "on_track");          // stale alone is advisory, sev 1
  assert.equal(stale.reasons[0].code, "stale");
  const late = healthOf({ project: proj({ end: "2026-10-01" }), forecast: projectForecast(proj({ end: "2026-10-01" }), [], TODAY), today: TODAY, lastUpdateDate: TODAY });
  assert.equal(late.key, "critical");
  const esc = healthOf({ project: proj({ end: "2026-11-01" }), forecast: projectForecast(proj({ end: "2026-11-01" }), [], TODAY), today: TODAY, lastUpdateDate: TODAY,
    escalations: [{ projectId: "p", status: "open", severity: "medium", reason: "x" }] });
  assert.equal(esc.key, "at_risk");
  const hold = healthOf({ project: proj({ status: "On Hold", end: "2026-10-01" }), forecast: projectForecast(proj({ status: "On Hold", end: "2026-10-01" }), [], TODAY), today: TODAY });
  assert.equal(hold.key, "on_hold");
});
