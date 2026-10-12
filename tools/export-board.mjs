/* Flatten the board into one JSON blob for the Excel builder.

   This imports the *live* compute.js the web app uses, so the spreadsheet and
   the board can never drift: effort weights, revenue attribution, risk rules
   and the rollups are all read from the same file the browser runs.

     node tools/export-board.mjs [out.json]

   compute.js pulls a handful of helpers from core.js, which is written for a
   browser. Stub the two globals it touches at load time and it imports fine. */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

globalThis.window = { addEventListener() {}, location: { href: "" } };
globalThis.document = {
  addEventListener() {}, createElement: () => ({ classList: { add() {}, remove() {} }, style: {} }),
  body: { appendChild() {} }, hidden: false, querySelector: () => null,
};

/* The front end's .js files are ES modules, but package.json says the repo is
   commonjs for the server's sake, so Node refuses to import them where they
   sit. Copy the two we need to a scratch directory as .mjs and import those.
   They are still read fresh off disk every run, so this is a rename, not a
   fork: compute.js stays the one definition of every number. */
const scratch = mkdtempSync(join(tmpdir(), "tfops-export-"));
const asModule = (name, src) => {
  const dest = join(scratch, name);
  writeFileSync(dest, readFileSync(resolve(root, src), "utf8")
    .replace(/from\s+"\.\/core\.js"/g, 'from "./core.mjs"'));
  return pathToFileURL(dest).href;
};
asModule("core.mjs", "public/js/core.js");
asModule("schedule.mjs", "public/js/schedule.mjs");      // already an ES module; compute.js imports it by that name
const computeUrl = asModule("compute.mjs", "public/js/compute.js");

const core = await import(pathToFileURL(join(scratch, "core.mjs")).href);
const C = await import(computeUrl);
rmSync(scratch, { recursive: true, force: true });

const dataDir = process.env.DATA_DIR || resolve(root, "data");
const store = JSON.parse(readFileSync(resolve(dataDir, "store.json"), "utf8"));
core.S.data = store;

const { TODAY, relDays, slug } = core;
const set = new Set();
const names = (a) => (a || []).slice();

/* ---------------------------------------------------------------- rows */

const project = (p) => {
  const e = C.effortOf(p);
  const risks = C.risksOf(p);
  const last = C.lastUpdate(p);
  const next = C.plannedNext(p);
  const cats = p.categories || [];
  const health = C.healthOf(p);
  const delivery = C.deliveryOf(p);
  const fc = C.forecastOf(p);
  const scope = C.scopeCompletion(p);
  // Which service line the assumed weight actually came from, so the sheet can
  // show the same VLOOKUP the board does in its head.
  const WEIGHTS = { "Content @ Scale": 5, Personalisation: 4, Cinematic: 3, "End to End": 3, "Avatar Creative": 2, "Avatar Simple": 1 };
  const weighted = cats.filter((c) => c in WEIGHTS).sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
  return {
    id: p.id, client: p.client, clientKey: p.clientKey || slug(p.client),
    projectName: p.projectName, label: p.label,
    dms: names(p.dms), primaryDm: p.primaryDm || "", editorLeads: C.editorsOf(p), editorTagging: p.editorTagging || "",
    podOwner: p.podOwner || "", sdm: p.sdm || "",
    priority: p.priority || "", status: p.status || "", statusKind: C.statusKind(p.status),
    categories: cats, weightFrom: weighted[0] || "",
    bulk: /\b\d{4,}\b/.test(p.scopeLocked || p.scope || "") ? 1 : 0,
    scope: p.scopeLocked || p.scope || "", completedFromScope: p.scopeCompleted || p.completedFromScope || "",
    scopePct: scope.pct, scopeMeasured: scope.measured,
    start: p.start, startNote: p.startNote || "", end: p.end, endNote: p.endNote || "",
    openEnded: !!p.openEnded, datesUnknown: !!p.datesUnknown, endInferred: !!p.endInferred,
    progress: p.progress, health: health.key, healthLabel: health.label, healthReasons: health.reasons.map((r) => r.label),
    baselineDelivery: delivery.baseline, baselineOriginal: delivery.baselineOriginal, forecastDelivery: delivery.forecast,
    forecastSource: delivery.source, slipDays: delivery.slipDays, daysRemaining: delivery.daysRemaining, forecastMiss: !!delivery.forecastMiss,
    currentMilestone: fc.current ? fc.current.title : "", nextMilestone: fc.next ? fc.next.title : "",
    nextMilestoneDate: fc.next ? (fc.milestones.get(fc.next.id)?.forecast || null) : null,
    milestonesDone: fc.doneCount, milestonesTotal: fc.total, overdueMilestones: fc.overdueMilestones.length,
    openEscalations: C.openEscalations(p).length,
    sourceRow: p.sourceRow,
    effortBase: e.base, effortPoints: e.points, effortSource: e.source, effortWhy: e.why,
    rev: C.shareOf(p), unmapped: C.isUnmapped(p),
    risks: risks.map((r) => ({ code: r.code, label: r.label, sev: r.sev })),
    riskScore: C.riskScore(p), escalation: C.escalationScore(p),
    staleDays: C.staleDays(p), activity60: C.activityOf(p),
    lastUpdate: last && { date: last.date, author: last.author, text: last.text, blockers: last.blockers || "", eta: last.eta || "" },
    plannedNext: next && { date: next.date, author: next.author, text: next.text },
    blocker: C.openBlocker(p) ? C.openBlocker(p).blockers : "",
    overdueDays: p.end && !p.openEnded && relDays(p.end) < 0 ? -relDays(p.end) : null,
  };
};

const person = (r) => ({
  name: r.name, role: r.role, points: r.points, projects: r.projects,
  live: r.live, held: r.held, upcoming: r.upcoming, rev: r.rev,
  clients: r.clientCount, activity: r.activity, assumed: r.assumed, set: r.set,
  top: r.top ? { label: r.top.p.label, share: r.top.share } : null,
});

const clientRow = (c) => {
  const b = C.balanceOf(c);
  return {
    key: c.key, name: c.name, points: c.points, rev: c.rev, projects: c.projects,
    live: c.live, held: c.held, dmCount: c.dmCount, edCount: c.edCount, people: c.people,
    dms: [...c.dms], eds: [...c.eds], pods: [...c.pods],
    teamShare: c.teamShare, revShare: c.revShare, revPerPoint: c.revPerPoint,
    activity: c.activity, unmapped: !!c.unmapped, balance: b.label, balanceKey: b.key,
  };
};

const t = C.totals();
const lt = C.loadTotals();
const conc = C.concentration();

const out = {
  generatedAt: new Date().toISOString(),
  today: TODAY,
  updatedAt: store.updatedAt,
  fiscalYear: store.fiscalYear,
  settings: store.settings,
  effortWeights: { "Content @ Scale": 5, Personalisation: 4, Cinematic: 3, "End to End": 3, "Avatar Creative": 2, "Avatar Simple": 1 },
  effortDefault: 2,
  statusWeights: { active: 1, upcoming: 0.5, hold: 0.25, done: 0 },
  effortLabels: C.EFFORT_LABELS,
  projects: C.projects().map(project),
  revenue: store.revenue.map((r) => ({ key: r.clientKey || slug(r.client), client: r.client, amount: Number(r.amount) || 0, unmapped: !!r.unmapped })),
  updates: store.updates.filter((u) => !u.draft).map((u) => ({
    id: u.id, projectId: u.projectId, author: u.author, role: u.role || "",
    date: u.date, status: u.status || "", text: u.completed || u.text || "", planned: u.planned || "",
    blockers: u.blockers || "", dependencyOwner: u.dependencyOwner || "", nextAction: u.nextAction || "",
    nextActionOwner: u.nextActionOwner || "", expectedResolution: u.expectedResolution || "",
    eta: u.nextMilestoneDate || u.eta || "", forecastDelivery: u.forecastDelivery || "",
    seeded: !!u.seeded, imported: !!u.imported,
  })),
  milestones: (store.milestones || []).map((m) => {
    const p = C.projectById(m.projectId);
    const fm = p ? C.forecastOf(p).milestones.get(m.id) : null;
    return { id: m.id, projectId: m.projectId, title: m.title, stage: m.stage, owner: m.owner || "", ownerType: m.ownerType || "",
      status: m.status, startDate: m.startDate, baselineDue: m.baselineDue, ownerEta: m.ownerEta, forecast: fm ? fm.forecast : null,
      slipDays: fm ? fm.slipDays : null, actualDone: m.actualDone, durationDays: m.durationDays, dependsOn: m.dependsOn || [],
      locked: !!m.locked, external: !!m.external, blocker: m.blocker || "" };
  }),
  assignments: C.resolvedAssignments().map((a) => ({
    id: a.id, projectId: a.projectId, milestoneId: a.milestoneId || "", editor: a.editor, dm: a.dm || "",
    estimatedHours: a.estimatedHours ?? null, start: a.start, end: a.end, derived: !!a.derived, status: a.status,
  })),
  escalationRecords: (store.escalations || []).map((e) => ({
    id: e.id, projectId: e.projectId, reason: e.reason, severity: e.severity, owner: e.owner || "", raisedBy: e.raisedBy,
    raisedOn: e.raisedOn, resolutionTarget: e.resolutionTarget, status: e.status, blocker: e.blocker || "", nextAction: e.nextAction || "",
    comments: e.comments.length, resolvedAt: e.resolvedAt, resolution: e.resolution || "",
  })),
  dmPerformance: C.dmPerformance(C.projects()).map((r) => ({
    name: r.name, projects: r.projects, active: r.active, high: r.high, atRisk: r.atRisk, points: r.points, rev: r.rev,
    editors: r.editorCount, perEditor: r.perEditor, onTime: r.onTime, overdueMilestones: r.overdueMs, compliance: r.compliance,
  })),
  people: store.people.map((p) => ({ name: p.name, roles: p.roles, pods: p.pods || [], active: p.active !== false,
    capacityHoursPerWeek: p.capacityHoursPerWeek ?? null, skills: p.skills || [], availability: p.availability || null })),
  dmLoad: C.loadRollup("dms").map(person),
  edLoad: C.loadRollup("editorLeads").map(person),
  clients: C.bandwidthByClient().map(clientRow),
  clientBook: C.clientRollup().map((c) => ({
    key: c.key, name: c.name, rev: c.rev, projects: c.load, active: c.active,
    hold: c.hold, pods: [...c.pods], unmapped: !!c.unmapped, orphan: !!c.orphan,
  })),
  pods: C.podRollup().map((p) => ({
    name: p.name, rev: p.rev, projects: p.load, active: p.active, hold: p.hold,
    upcoming: p.upcoming, risk: p.risk, dmCount: p.dmCount, edCount: p.edCount,
    clientCount: p.clientCount, revPerDM: p.revPerDM, loadPerDM: p.loadPerDM,
  })),
  categories: C.categoryRollup().map((c) => ({ name: c.name, rev: c.rev, projects: c.load, active: c.active })),
  loadByService: C.loadByGroup((p) => p.categories).map((g) => ({ name: g.name, points: g.points, projects: g.projects, rev: g.rev })),
  loadByPod: C.loadByGroup((p) => p.podOwner).map((g) => ({ name: g.name, points: g.points, projects: g.projects, rev: g.rev })),
  totals: {
    rev: t.rev, activeRev: t.activeRev, holdRev: t.holdRev, upcomingRev: t.upcomingRev,
    n: t.n, active: t.active, hold: t.hold, upcoming: t.upcoming, done: t.done,
    unmapped: t.unmapped, unmappedRev: t.unmappedRev, atRisk: t.atRisk, riskRev: t.riskRev,
    serious: t.serious, seriousRev: t.seriousRev,
    dmCount: t.dmCount, edCount: t.edCount, podCount: t.podCount, clientCount: t.clientCount,
    revPerDM: t.revPerDM, revPerEditor: t.revPerEditor, loadPerDM: t.loadPerDM,
  },
  loadTotals: lt,
  concentration: {
    total: conc.total, top1: conc.top1, top3: conc.top3, top5: conc.top5,
    top10: conc.top10, hhi: conc.hhi, effectiveClients: conc.effectiveClients, billing: conc.billing,
  },
  escalations: C.projects()
    .map((p) => ({ p, s: C.escalationScore(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p.id),
};

const dest = process.argv[2] || resolve(root, "board-export.json");
writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`wrote ${dest} — ${out.projects.length} projects, ${out.revenue.length} revenue rows, ${out.updates.length} updates`);
