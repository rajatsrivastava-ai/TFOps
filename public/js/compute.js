/* Everything derived from the board.

   Revenue attribution rule (carried over from the original load board, and the
   reason every breakdown reconciles to the same book): the sheet books revenue
   once per CLIENT, but a client can have several project rows. A row with its
   own figure takes it; the rest of the client's booking is split evenly across
   the other rows, and then again across the people named on each. Sum any
   breakdown and you get the real book back.

   Forecasts and health come from the schedule engine (schedule.mjs), which the
   server runs too — this file only memoises them per board version and day. */

import { S, TODAY, relDays, slug, addDays, isISO } from "./core.js";
import * as SCH from "./schedule.mjs";

export { SCH };
export const statusKind = SCH.statusKind;

const memo = new Map();
let memoKey = "";

function cached(key, fn) {
  const k = `${S.data.version}|${TODAY}`;
  if (memoKey !== k) { memo.clear(); memoKey = k; }
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key);
}

export const projects = () => S.data.projects;
export const settings = () => S.data.settings;
export const people = () => S.data.people || [];
export const milestones = () => S.data.milestones || [];
export const assignments = () => S.data.assignments || [];
export const escalations = () => S.data.escalations || [];

export const projectById = (id) => cached("byId", () => new Map(projects().map((p) => [p.id, p]))).get(id) || null;
export const milestoneById = (id) => cached("msById", () => new Map(milestones().map((m) => [m.id, m]))).get(id) || null;
export const personByName = (name) => cached("pByName", () => new Map(people().map((p) => [p.name, p]))).get(name) || null;

/* ------------------------------------------------------------- revenue */

export const revenueIndex = () =>
  cached("revIdx", () => {
    const m = {};
    S.data.revenue.forEach((r) => { m[r.clientKey || slug(r.client)] = r; });
    return m;
  });

const clientRows = () =>
  cached("clientRows", () => {
    const m = {};
    projects().forEach((p) => { const k = p.clientKey || slug(p.client); (m[k] ||= []).push(p); });
    return m;
  });

/** Revenue attributed to one project row. */
export function shareOf(p) {
  const k = p.clientKey || slug(p.client);
  if (Number(p.revenue) > 0) return Number(p.revenue);
  const r = revenueIndex()[k];
  if (!r) return 0;
  const rows = clientRows()[k] || [p];
  const explicit = rows.reduce((s, x) => s + (Number(x.revenue) > 0 ? Number(x.revenue) : 0), 0);
  const rest = rows.filter((x) => !(Number(x.revenue) > 0)).length || 1;
  return Math.max(0, (Number(r.amount) || 0) - explicit) / rest;
}

export function isUnmapped(p) {
  const r = revenueIndex()[p.clientKey || slug(p.client)];
  return !!(r && r.unmapped) && !(Number(p.revenue) > 0);
}
/** True when nobody has put a figure against this row or its client. */
export const revenueUnknown = (p) => !(Number(p.revenue) > 0) && !revenueIndex()[p.clientKey || slug(p.client)];

/* ------------------------------------------------------------- updates */

export const updatesByProject = () =>
  cached("updByProj", () => {
    const m = {};
    S.data.updates.forEach((u) => { if (!u.draft) (m[u.projectId] ||= []).push(u); });
    Object.values(m).forEach((list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1))));
    return m;
  });

/** Most recent update that is not a future-dated plan. */
export function lastUpdate(p) {
  const list = updatesByProject()[p.id] || [];
  return list.find((u) => u.date && u.date <= TODAY) || null;
}
export function plannedNext(p) {
  const list = updatesByProject()[p.id] || [];
  const future = list.filter((u) => u.date > TODAY);
  return future.length ? future[future.length - 1] : null;
}
export function staleDays(p) {
  const u = lastUpdate(p);
  if (!u) return null;
  return -relDays(u.date);
}
export const myDrafts = () => S.data.updates.filter((u) => u.draft && u.author === S.me);

/* ---------------------------------------------------------- milestones */

export const milestonesByProject = () =>
  cached("msByProj", () => {
    const m = {};
    milestones().forEach((x) => { (m[x.projectId] ||= []).push(x); });
    Object.values(m).forEach((l) => l.sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.baselineDue || "9").localeCompare(String(b.baselineDue || "9"))));
    return m;
  });
export const milestonesOf = (p) => milestonesByProject()[p.id] || [];

export const assignmentsByProject = () =>
  cached("asByProj", () => {
    const m = {};
    assignments().forEach((a) => { if (a.status !== "cancelled") (m[a.projectId] ||= []).push(a); });
    return m;
  });
export const assignmentsOf = (p) => assignmentsByProject()[p.id] || [];

export const escalationsByProject = () =>
  cached("escByProj", () => {
    const m = {};
    escalations().forEach((e) => { (m[e.projectId] ||= []).push(e); });
    Object.values(m).forEach((l) => l.sort((a, b) => (a.status === "resolved") - (b.status === "resolved") || SEV_ORDER[b.severity] - SEV_ORDER[a.severity]));
    return m;
  });
export const SEV_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };
export const openEscalations = (p) => (escalationsByProject()[p.id] || []).filter((e) => e.status !== "resolved");

/** Resolved assignments: every live one with a start/end window attached. */
export const resolvedAssignments = () =>
  cached("resolvedAs", () => SCH.resolveAssignments(assignments(), milestones(), TODAY, settings()));

/* ------------------------------------------------------------ forecast */

export function forecastOf(p) {
  return cached("fc:" + p.id, () => SCH.projectForecast(p, milestonesOf(p), TODAY, settings()));
}
export const currentMilestone = (p) => forecastOf(p).current;
export const nextMilestone = (p) => forecastOf(p).next;

/** Where the delivery date stands: committed, forecast and the gap. */
export function deliveryOf(p) {
  const f = forecastOf(p);
  return {
    baseline: f.baseline, baselineOriginal: f.baselineOriginal, forecast: f.forecast,
    slipDays: f.slipDays, daysRemaining: f.daysRemaining, overdue: f.overdue, forecastMiss: f.forecastMiss,
    source: f.forecastSource, ongoing: f.ongoing,
  };
}

export function healthOf(p) {
  return cached("health:" + p.id, () => SCH.healthOf({
    project: p, forecast: forecastOf(p), escalations: openEscalations(p),
    risks: risksOf(p).filter((r) => ["stale", "noupdate", "nodm"].includes(r.code)),
    lastUpdateDate: lastUpdate(p)?.date || null, today: TODAY, staleUpdateDays: settings().staleUpdateDays || 7,
  }));
}
export const HEALTH = SCH.HEALTH_LABEL;
export const HEALTH_ORDER = SCH.HEALTH_ORDER;

/** The one line that explains why a project is on the risk table. */
export function riskReason(p) {
  const h = healthOf(p);
  if (h.reasons.length) return h.reasons.slice().sort((a, b) => b.sev - a.sev)[0].label;
  const r = risksOf(p);
  return r.length ? r[0].label : "";
}

/** Scope completion when it can be measured; otherwise honest about it. */
export function scopeCompletion(p) {
  const u = p.scopeUnits;
  if (u && Number(u.locked) > 0 && Number.isFinite(Number(u.completed))) {
    const pct = Math.min(100, (Number(u.completed) / Number(u.locked)) * 100);
    return { pct, label: `${u.completed} / ${u.locked}${u.unit ? " " + u.unit : ""}`, measured: true };
  }
  if (typeof p.progress === "number") return { pct: p.progress, label: `${p.progress}% (DM estimate)`, measured: false };
  return { pct: null, label: "Not measurable", measured: false };
}

export const editorsOf = (p) =>
  [...new Set([...(p.editorLeads || []), ...assignmentsOf(p).filter((a) => a.status !== "done").map((a) => a.editor)])].filter(Boolean);

/* ---------------------------------------------------------------- risk */

/** Delivery risks, worst first. Each is {code, label, sev} where sev 2 = red. */
export function risksOf(p) {
  return cached("risks:" + p.id, () => {
    const out = [];
    const kind = statusKind(p.status);
    const stale = staleDays(p);
    const limit = settings().staleUpdateDays || 7;
    const f = forecastOf(p);

    if (kind === "active" && f.overdue) {
      out.push({ code: "overdue", label: `Committed delivery passed ${-relDays(f.baseline)}d ago`, sev: 2 });
    } else if (kind === "active" && f.forecastMiss) {
      out.push({ code: "forecastMiss", label: `Forecast slips ${f.slipDays}d past the commitment`, sev: 2 });
    }
    if (kind === "active" && f.overdueMilestones.length) {
      out.push({ code: "milestoneOverdue", label: `${f.overdueMilestones.length} milestone${f.overdueMilestones.length > 1 ? "s" : ""} overdue`, sev: 2 });
    }
    const esc = openEscalations(p);
    if (esc.length) {
      const hot = esc.some((e) => e.severity === "high" || e.severity === "critical");
      out.push({ code: "escalated", label: `Escalated — ${esc[0].severity}`, sev: hot ? 2 : 1 });
    }
    if (kind === "active" && f.blockedMilestones.length) {
      out.push({ code: "blocked", label: `Blocked: ${f.blockedMilestones[0].blocker || f.blockedMilestones[0].title}`, sev: 2 });
    }
    const u = lastUpdate(p);
    if (kind === "active" && u && u.blockers && !f.blockedMilestones.length) {
      out.push({ code: "blocker", label: `Blocker: ${u.blockers}`, sev: 1 });
    }
    if (kind === "active" && !f.baseline && !p.openEnded) {
      out.push({ code: "nodates", label: "No committed delivery date", sev: 1 });
    }
    if (kind === "active" && stale === null) {
      out.push({ code: "noupdate", label: "Never had a status update", sev: 2 });
    } else if (kind === "active" && stale > limit) {
      out.push({ code: "stale", label: `No update in ${stale} days`, sev: stale > limit * 2 ? 2 : 1 });
    }
    if (isUnmapped(p)) out.push({ code: "unmapped", label: "Revenue not mapped to this client", sev: 1 });
    if (kind === "hold" && shareOf(p) > 0) out.push({ code: "heldrev", label: "On hold while carrying revenue", sev: 1 });
    if (kind === "active" && !editorsOf(p).length) out.push({ code: "noeditor", label: "No editor assigned", sev: 1 });
    if (!p.dms?.length) out.push({ code: "nodm", label: "No DM assigned", sev: 2 });
    if (p.datesUnknown) out.push({ code: "tbd", label: "Dates marked TBD in the sheet", sev: 1 });

    return out.sort((a, b) => b.sev - a.sev);
  });
}

export function riskScore(p) {
  return risksOf(p).reduce((n, r) => n + r.sev, 0);
}

/** The latest blocker anyone has posted against this project, if it still stands. */
export function openBlocker(p) {
  const u = lastUpdate(p);
  return u && u.blockers ? u : null;
}

/** How loudly this project is asking for someone senior. */
export function escalationScore(p) {
  if (statusKind(p.status) === "done") return 0;
  const risks = risksOf(p);
  let s = risks.reduce((n, r) => n + (r.sev === 2 ? 10 : 3), 0);
  if (openBlocker(p)) s += 12;
  const stale = staleDays(p);
  if (stale !== null) s += Math.min(10, Math.floor(stale / 7) * 2);
  s += Math.min(8, (shareOf(p) / 1e7) * 6);
  return s;
}

export const atRisk = () =>
  cached("atRisk", () =>
    projects()
      .map((p) => ({ p, risks: risksOf(p), score: riskScore(p), rev: shareOf(p) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.rev - a.rev));

/** The spec's definition: overdue, forecast to miss, blocked, or escalated. */
export const PRIO_ORDER = { High: 0, Medium: 1, Low: 2, "": 3 };
export function riskTable(list = filtered()) {
  return list
    .filter((p) => { const k = healthOf(p).key; return k === "critical" || k === "at_risk"; })
    .map((p) => ({ p, health: healthOf(p), delivery: deliveryOf(p), rev: shareOf(p), reason: riskReason(p), last: lastUpdate(p) }))
    .sort((a, b) => HEALTH_ORDER[a.health.key] - HEALTH_ORDER[b.health.key] || PRIO_ORDER[a.p.priority || ""] - PRIO_ORDER[b.p.priority || ""] || b.rev - a.rev);
}

/* --------------------------------------------------------- delivery load

   There are no timesheets on this board, so "bandwidth" is deliberately two
   separate numbers rather than one invented score:

     effort points   what we ASSUME the work costs — from the service line,
                     overridable per project once someone who knows says otherwise
     observed        what is actually being worked on — status updates logged

   Hour-based assignments (the Editor Allocation page) are a third number, kept
   apart from both. Keeping them apart means you can see when they disagree,
   which is the useful signal. */

const EFFORT_BY_CATEGORY = {
  "Content @ Scale": 5,
  "Personalisation": 4,
  "Cinematic": 3,
  "End to End": 3,
  "Avatar Creative": 2,
  "Avatar Simple": 1,
};
const EFFORT_DEFAULT = 2;

export const EFFORT_LABELS = {
  1: "Light", 2: "Standard", 3: "Heavy", 4: "Very heavy", 5: "Flagship",
};

/** @returns {{points:number, base:number, source:"set"|"assumed", why:string}} */
export function effortOf(p) {
  if (typeof p.effort === "number" && p.effort > 0) {
    return {
      points: applyStatus(p.effort, p), base: p.effort, source: "set",
      why: `Set to ${EFFORT_LABELS[p.effort] || p.effort} by the team`,
    };
  }
  const cats = (p.categories || []).filter((c) => c in EFFORT_BY_CATEGORY);
  let base = cats.length
    ? Math.max(...cats.map((c) => EFFORT_BY_CATEGORY[c]))
    : EFFORT_DEFAULT;
  let why = cats.length ? `${cats[0]} work` : "No service line on the row";
  if (/\b\d{4,}\b/.test(p.scopeLocked || p.scope || "")) {
    base = Math.min(5, base + 1);
    why += ", scope names a bulk volume";
  }
  return { points: applyStatus(base, p), base, source: "assumed", why };
}

function applyStatus(base, p) {
  const k = statusKind(p.status);
  if (k === "hold") return base * 0.25;
  if (k === "upcoming") return base * 0.5;
  if (k === "done") return 0;
  return base;
}

/** Updates logged against a project in the trailing window (default 60 days). */
export function activityOf(p, days = 60) {
  const since = addDays(TODAY, -days);
  return (updatesByProject()[p.id] || [])
    .filter((u) => u.date && u.date >= since && u.date <= TODAY).length;
}

/** Per-person delivery load for a role field, with each project's share. */
export function loadRollup(field) {
  return cached("load:" + field, () => {
    const m = {};
    projects().forEach((p) => {
      const names = field === "editorLeads" ? editorsOf(p) : (p[field] || []);
      if (!names.length) return;
      const e = effortOf(p);
      const share = e.points / names.length;
      const act = activityOf(p);
      names.forEach((name) => {
        const row = (m[name] ||= {
          name, role: field, points: 0, live: 0, held: 0, upcoming: 0,
          rev: 0, activity: 0, assumed: 0, set: 0,
          clients: new Set(), items: [],
        });
        row.points += share;
        row.rev += shareOf(p) / names.length;
        row.activity += act / names.length;
        row.clients.add(p.client);
        const k = statusKind(p.status);
        if (k === "active") row.live += 1;
        else if (k === "hold") row.held += 1;
        else if (k === "upcoming") row.upcoming += 1;
        row[e.source === "set" ? "set" : "assumed"] += 1;
        row.items.push({ p, share, effort: e, activity: act, shared: names.length });
      });
    });
    return Object.values(m)
      .map((r) => {
        r.items.sort((a, b) => b.share - a.share || b.activity - a.activity);
        return { ...r, clientCount: r.clients.size, projects: r.items.length, top: r.items[0] || null, weighted: r.points };
      })
      .sort((a, b) => b.points - a.points);
  });
}

export function bandwidthRanking() {
  return cached("bandwidth", () => projects()
    .map((p) => {
      const e = effortOf(p);
      const dms = (p.dms || []).length;
      const eds = editorsOf(p).length;
      return { p, effort: e, points: e.points, activity: activityOf(p), dms, eds,
        perDM: dms ? e.points / dms : null, perEditor: eds ? e.points / eds : null, rev: shareOf(p) };
    })
    .filter((x) => x.points > 0)
    .sort((a, b) => b.points - a.points || b.activity - a.activity));
}

export function loadByGroup(keyFn) {
  const m = {};
  bandwidthRanking().forEach((x) => {
    const keys = keyFn(x.p);
    const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    const use = list.length ? list : ["(none)"];
    const w = 1 / use.length;
    use.forEach((k) => {
      const e = (m[k] ||= { name: k, points: 0, projects: 0, rev: 0, activity: 0 });
      e.points += x.points * w; e.projects += w; e.rev += x.rev * w; e.activity += x.activity * w;
    });
  });
  return Object.values(m).sort((a, b) => b.points - a.points);
}

export const bandwidthByClient = () =>
  cached("bwClient", () => {
    const m = {};
    bandwidthRanking().forEach((x) => {
      const key = x.p.clientKey || slug(x.p.client);
      const e = (m[key] ||= { key, name: x.p.client, points: 0, rev: 0, projects: 0, activity: 0, live: 0, held: 0, dms: new Set(), eds: new Set(), pods: new Set() });
      e.points += x.points; e.rev += x.rev; e.projects += 1; e.activity += x.activity;
      const k = statusKind(x.p.status);
      if (k === "active") e.live += 1; else if (k === "hold") e.held += 1;
      (x.p.dms || []).forEach((d) => e.dms.add(d));
      editorsOf(x.p).forEach((d) => e.eds.add(d));
      if (x.p.podOwner) e.pods.add(x.p.podOwner);
      if (isUnmapped(x.p)) e.unmapped = true;
    });
    const totalPoints = Object.values(m).reduce((s, e) => s + e.points, 0) || 1;
    const totalRev = totals().rev || 1;
    return Object.values(m)
      .map((e) => ({ ...e, dmCount: e.dms.size, edCount: e.eds.size, people: e.dms.size + e.eds.size,
        teamShare: (e.points / totalPoints) * 100, revShare: (e.rev / totalRev) * 100,
        revPerPoint: e.points > 0 && e.rev > 0 ? e.rev / e.points : null }))
      .sort((a, b) => b.points - a.points);
  });

export function balanceOf(c) {
  if (c.unmapped || c.rev <= 0) return { key: "unmapped", label: "Revenue not mapped", tone: "watch", ic: "✎" };
  const ratio = c.teamShare > 0 ? c.revShare / c.teamShare : 0;
  if (ratio >= 1.5) return { key: "great", label: "Pays well", tone: "active", ic: "✓" };
  if (ratio >= 0.8) return { key: "even", label: "Balanced", tone: "upcoming", ic: "●" };
  if (ratio >= 0.4) return { key: "light", label: "Light on revenue", tone: "watch", ic: "●" };
  return { key: "poor", label: "Costs more than it earns", tone: "risk", ic: "▲" };
}

export const loadTotals = () =>
  cached("loadTotals", () => {
    const rank = bandwidthRanking();
    const dms = loadRollup("dms");
    const eds = loadRollup("editorLeads");
    const sum = (a) => a.reduce((s, x) => s + x.points, 0);
    const median = (a) => {
      if (!a.length) return 0;
      const v = a.map((x) => x.points).sort((x, y) => x - y);
      const i = Math.floor(v.length / 2);
      return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
    };
    return {
      totalPoints: rank.reduce((s, x) => s + x.points, 0),
      dmPoints: sum(dms), edPoints: sum(eds),
      dmAvg: dms.length ? sum(dms) / dms.length : 0, edAvg: eds.length ? sum(eds) / eds.length : 0,
      dmMedian: median(dms), edMedian: median(eds), dmCount: dms.length, edCount: eds.length,
      liveProjects: projects().filter((p) => statusKind(p.status) === "active").length,
      heldProjects: projects().filter((p) => statusKind(p.status) === "hold").length,
      heldUpside: projects().filter((p) => statusKind(p.status) === "hold").reduce((s, p) => s + effortOf(p).base * 0.75, 0),
      assumed: projects().filter((p) => effortOf(p).source === "assumed").length,
      set: projects().filter((p) => effortOf(p).source === "set").length,
      unassignedEditor: projects().filter((p) => statusKind(p.status) === "active" && !editorsOf(p).length).length,
      unassignedDM: projects().filter((p) => !(p.dms || []).length).length,
    };
  });

/* ------------------------------------------------------------- rollups */

export function rollup(field) {
  return cached("rollup:" + field, () => {
    const m = {};
    projects().forEach((p) => {
      const names = p[field]?.length ? p[field] : ["(unassigned)"];
      const w = 1 / names.length;
      const money = shareOf(p) * w;
      names.forEach((name) => {
        const e = (m[name] ||= { name, rev: 0, load: 0, active: 0, hold: 0, risk: 0, clients: new Set(), peers: new Set(), projects: [] });
        e.rev += money; e.load += w; e.clients.add(p.client); e.projects.push(p);
        const k = statusKind(p.status);
        if (k === "active") e.active += w;
        if (k === "hold") e.hold += w;
        e.risk += riskScore(p) * w;
        (p[field === "dms" ? "editorLeads" : "dms"] || []).forEach((q) => e.peers.add(q));
      });
    });
    return Object.values(m)
      .map((e) => ({ ...e, clientCount: e.clients.size, peerCount: e.peers.size, perProject: e.load > 0 ? e.rev / e.load : 0 }))
      .sort((a, b) => b.rev - a.rev);
  });
}

export const podRollup = () =>
  cached("pods", () => {
    const m = {};
    projects().forEach((p) => {
      const key = p.podOwner || "(unassigned)";
      const e = (m[key] ||= { name: key, rev: 0, load: 0, active: 0, hold: 0, upcoming: 0, done: 0, risk: 0, dms: new Set(), eds: new Set(), clients: new Set(), projects: [] });
      e.rev += shareOf(p); e.load += 1; e.projects.push(p);
      e[statusKind(p.status)] += 1;
      e.risk += riskScore(p);
      (p.dms || []).forEach((d) => e.dms.add(d));
      editorsOf(p).forEach((d) => e.eds.add(d));
      e.clients.add(p.client);
    });
    return Object.values(m)
      .map((e) => ({ ...e, dmCount: e.dms.size, edCount: e.eds.size, clientCount: e.clients.size,
        revPerDM: e.dms.size ? e.rev / e.dms.size : 0, loadPerDM: e.dms.size ? e.load / e.dms.size : 0 }))
      .sort((a, b) => b.rev - a.rev);
  });

export const categoryRollup = () =>
  cached("cats", () => {
    const m = {};
    projects().forEach((p) => {
      const cats = p.categories?.length ? p.categories : ["(uncategorised)"];
      const w = 1 / cats.length;
      cats.forEach((c) => {
        const e = (m[c] ||= { name: c, rev: 0, load: 0, active: 0 });
        e.rev += shareOf(p) * w; e.load += w;
        if (statusKind(p.status) === "active") e.active += w;
      });
    });
    return Object.values(m).sort((a, b) => b.rev - a.rev);
  });

export const clientRollup = () =>
  cached("clients", () => {
    const m = {};
    projects().forEach((p) => {
      const key = p.clientKey || slug(p.client);
      const e = (m[key] ||= { key, name: p.client, rev: 0, load: 0, active: 0, hold: 0, pods: new Set(), projects: [], unmapped: isUnmapped(p) });
      e.rev += shareOf(p); e.load += 1; e.projects.push(p);
      const k = statusKind(p.status);
      if (k === "active") e.active += 1;
      if (k === "hold") e.hold += 1;
      if (p.podOwner) e.pods.add(p.podOwner);
    });
    S.data.revenue.forEach((r) => {
      if (!m[r.clientKey]) m[r.clientKey] = { key: r.clientKey, name: r.client, rev: Number(r.amount) || 0, load: 0, active: 0, hold: 0, pods: new Set(), projects: [], unmapped: r.unmapped, orphan: true };
    });
    return Object.values(m).sort((a, b) => b.rev - a.rev);
  });

export const totals = (list = projects()) =>
  cached("totals:" + (list === projects() ? "all" : list.map((p) => p.id).join(",")), () => {
    const t = {
      rev: 0, activeRev: 0, holdRev: 0, upcomingRev: 0,
      n: list.length, active: 0, hold: 0, upcoming: 0, done: 0,
      unmapped: 0, unmappedRev: 0, atRisk: 0, riskRev: 0, serious: 0, seriousRev: 0,
      health: { critical: 0, at_risk: 0, unknown: 0, on_track: 0, upcoming: 0, on_hold: 0, completed: 0 },
      revAtRisk: 0,
      dms: new Set(), activeDms: new Set(), eds: new Set(), pods: new Set(), clients: new Set(),
    };
    list.forEach((p) => {
      const r = shareOf(p);
      const k = statusKind(p.status);
      t.rev += r;
      if (k === "active") { t.active++; t.activeRev += r; }
      else if (k === "hold") { t.hold++; t.holdRev += r; }
      else if (k === "upcoming") { t.upcoming++; t.upcomingRev += r; }
      else t.done++;
      if (isUnmapped(p)) { t.unmapped++; t.unmappedRev += r; }
      const rk = risksOf(p);
      if (rk.length) { t.atRisk++; t.riskRev += r; }
      if (rk.some((x) => x.sev === 2)) { t.serious++; t.seriousRev += r; }
      const h = healthOf(p).key;
      t.health[h] = (t.health[h] || 0) + 1;
      if (h === "critical" || h === "at_risk") t.revAtRisk += r;
      (p.dms || []).forEach((d) => { t.dms.add(d); if (k === "active") t.activeDms.add(d); });
      editorsOf(p).forEach((d) => t.eds.add(d));
      if (p.podOwner) t.pods.add(p.podOwner);
      t.clients.add(p.client);
    });
    t.dmCount = t.dms.size; t.activeDmCount = t.activeDms.size; t.edCount = t.eds.size;
    t.podCount = t.pods.size; t.clientCount = t.clients.size;
    t.revPerDM = t.dmCount ? t.rev / t.dmCount : 0;
    t.revPerEditor = t.edCount ? t.rev / t.edCount : 0;
    t.loadPerDM = t.activeDmCount ? t.active / t.activeDmCount : 0;
    t.loadPerEditor = t.edCount ? t.active / t.edCount : 0;
    t.projectsAtRisk = t.health.critical + t.health.at_risk;
    return t;
  });

export const concentration = () =>
  cached("conc", () => {
    const list = clientRollup().filter((c) => c.rev > 0);
    const total = list.reduce((s, c) => s + c.rev, 0) || 1;
    const share = (n) => list.slice(0, n).reduce((s, c) => s + c.rev, 0) / total;
    const hhi = list.reduce((s, c) => s + Math.pow(c.rev / total, 2), 0);
    return { list, total, top1: share(1), top3: share(3), top5: share(5), top10: share(10), hhi, effectiveClients: hhi > 0 ? 1 / hhi : 0, billing: list.length };
  });

/* ------------------------------------------------------- DM performance */

/** Per DM, with shared ownership split evenly. Scope and complexity are shown
    beside the counts (effort points), never folded into them. */
export function dmPerformance(list = filtered()) {
  const m = {};
  const limit = settings().staleUpdateDays || 7;
  list.forEach((p) => {
    const names = p.dms?.length ? p.dms : [];
    if (!names.length) return;
    const w = 1 / names.length;
    const k = statusKind(p.status);
    const h = healthOf(p).key;
    const f = forecastOf(p);
    names.forEach((name) => {
      const e = (m[name] ||= { name, projects: 0, active: 0, high: 0, atRisk: 0, rev: 0, points: 0, editors: new Set(), overdueMs: 0,
        msDone: 0, msOnTime: 0, updated: 0, activeCount: 0, items: [] });
      e.projects += 1; e.items.push(p);
      e.rev += shareOf(p) * w;
      e.points += effortOf(p).points * w;
      if (k === "active") {
        e.active += w; e.activeCount += 1;
        if (p.priority === "High") e.high += w;
        if (h === "critical" || h === "at_risk") e.atRisk += w;
        const d = staleDays(p);
        if (d !== null && d <= limit) e.updated += 1;
      }
      editorsOf(p).forEach((x) => e.editors.add(x));
      e.overdueMs += f.overdueMilestones.length * w;
      milestonesOf(p).forEach((ms) => {
        if (!isISO(ms.actualDone)) return;
        e.msDone += w;
        if (!ms.baselineDue || ms.actualDone <= ms.baselineDue) e.msOnTime += w;
      });
    });
  });
  return Object.values(m).map((e) => ({
    ...e,
    editorCount: e.editors.size,
    perEditor: e.editors.size ? e.active / e.editors.size : null,
    onTime: e.msDone > 0 ? e.msOnTime / e.msDone : null,
    compliance: e.activeCount ? e.updated / e.activeCount : null,
  })).sort((a, b) => b.atRisk - a.atRisk || b.active - a.active);
}

/* ------------------------------------------------------ upcoming / cal */

/** Deliveries landing inside the next `days`: final dates and milestones. */
export function upcomingDeliveries(days = 7, list = filtered()) {
  const to = addDays(TODAY, days);
  const out = [];
  list.forEach((p) => {
    if (statusKind(p.status) === "done") return;
    const f = forecastOf(p);
    const d = f.forecast || f.baseline;
    if (d && d >= TODAY && d <= to) out.push({ p, date: d, kind: "final", title: "Final delivery", health: healthOf(p), baseline: f.baseline, forecast: f.forecast });
    milestonesOf(p).forEach((m) => {
      if (isISO(m.actualDone)) return;
      const fm = f.milestones.get(m.id);
      const md = fm?.forecast;
      if (md && md >= TODAY && md <= to && m.stage !== "final_delivery") out.push({ p, date: md, kind: "milestone", title: m.title, owner: m.owner, health: healthOf(p), baseline: fm.baseline, forecast: md, milestone: m });
    });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : PRIO_ORDER[a.p.priority || ""] - PRIO_ORDER[b.p.priority || ""]));
}

/** Everything with a date inside [from, to], for the calendar. */
export function calendarEvents(from, to, list = filtered()) {
  const out = [];
  list.forEach((p) => {
    const f = forecastOf(p);
    const h = healthOf(p);
    const done = statusKind(p.status) === "done";
    const finalDate = f.forecast || f.baseline;
    if (finalDate && finalDate >= from && finalDate <= to && !f.ongoing) {
      out.push({ id: "final:" + p.id, p, date: finalDate, kind: "final", title: "Final delivery", health: h, baseline: f.baseline, forecast: f.forecast, done, escalated: openEscalations(p).length > 0 });
    }
    milestonesOf(p).forEach((m) => {
      if (m.stage === "final_delivery" && finalDate) return;
      const fm = f.milestones.get(m.id);
      const d = fm?.forecast;
      if (d && d >= from && d <= to) out.push({ id: "ms:" + m.id, p, date: d, kind: "milestone", title: m.title, owner: m.owner, health: h, baseline: fm.baseline, forecast: d, done: fm.done, milestone: m, escalated: openEscalations(p).length > 0 });
    });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "final" ? -1 : 1));
}

/* ------------------------------------------------------ editor capacity */

export const editorNames = () =>
  cached("editorNames", () => {
    const names = new Set();
    people().forEach((p) => { if ((p.roles || []).some((r) => r === "editorLead" || r === "editor") && p.active !== false) names.add(p.name); });
    projects().forEach((p) => editorsOf(p).forEach((n) => names.add(n)));
    assignments().forEach((a) => { if (a.editor) names.add(a.editor); });
    return [...names].sort();
  });

/** One row per editor over a window: hours against capacity, what is due. */
export function editorCapacity(from, to) {
  const resolved = resolvedAssignments();
  const set = settings();
  return editorNames().map((name) => {
    const person = personByName(name) || { name, roles: ["editorLead"], capacityHoursPerWeek: set.capacityHoursPerWeek || 40, availability: { status: "available" } };
    const u = SCH.utilisation({ person, assignments: resolved, from, to, settings: set });
    const mine = resolved.filter((a) => a.editor === name && a.status !== "done");
    const projs = new Set(projects().filter((p) => statusKind(p.status) === "active" && editorsOf(p).includes(name)).map((p) => p.id));
    const dms = new Set();
    projs.forEach((id) => (projectById(id)?.dms || []).forEach((d) => dms.add(d)));
    const dueWeek = mine.filter((a) => a.end && a.end >= from && a.end <= to).length;
    const overdue = mine.filter((a) => a.end && a.end < TODAY).length;
    const next = mine.map((a) => a.end).filter((d) => d && d >= TODAY).sort()[0] || null;
    const av = person.availability || { status: "available" };
    return {
      name, person, util: u, active: projs.size, projectIds: [...projs], dms: [...dms], dueWeek, overdue, next,
      availability: av.status === "out" ? "Out" + (av.until ? ` until ${av.until}` : "") : av.status === "limited" ? "Limited" : "Available",
      availabilityKey: av.status || "available",
      status: u.band === "red" ? "Over-allocated" : u.band === "amber" ? "At capacity" : u.band === "incomplete" ? "Partly estimated" : u.band === "unknown" ? "No capacity set" : "Available",
    };
  });
}

/** Work with nobody on it: active projects without an editor, and editor-owned
    milestones that are open but unassigned. */
export function unassignedQueue() {
  const projs = projects().filter((p) => statusKind(p.status) === "active" && !editorsOf(p).length);
  const live = assignments().filter((a) => a.status !== "cancelled" && a.status !== "done");
  const ms = milestones().filter((m) => !isISO(m.actualDone) && (m.ownerType === "Editor") && !live.some((a) => a.milestoneId === m.id))
    .map((m) => ({ m, p: projectById(m.projectId) })).filter((x) => x.p && statusKind(x.p.status) === "active");
  return { projects: projs, milestones: ms };
}

/** Open escalations, worst and oldest first, with the project beside each. */
export function escalationQueue(list = filtered()) {
  const ids = new Set(list.map((p) => p.id));
  return escalations()
    .filter((e) => ids.has(e.projectId))
    .map((e) => ({ e, p: projectById(e.projectId), age: e.raisedOn ? -relDays(e.raisedOn) : 0, late: e.resolutionTarget && e.status !== "resolved" && e.resolutionTarget < TODAY }))
    .filter((x) => x.p)
    .sort((a, b) => (a.e.status === "resolved") - (b.e.status === "resolved") || SEV_ORDER[b.e.severity] - SEV_ORDER[a.e.severity] || b.age - a.age);
}

/* ------------------------------------------------------------ timeline */

export function timelineRows(list = projects()) {
  return list.map((p) => {
    let start = p.start, end = p.end, inferred = false;
    if (!start && end) { start = end; inferred = true; }
    if (start && !end) { end = p.openEnded ? null : start; inferred = true; }
    return { p, start, end, open: p.openEnded && !!start, placed: !!(p.start || p.end), inferred, milestones: milestonesOf(p), forecast: forecastOf(p) };
  });
}

export function timelineExtent(rows) {
  const dates = [];
  rows.forEach((r) => { if (r.start) dates.push(r.start); if (r.end) dates.push(r.end); });
  milestones().forEach((m) => { if (m.baselineDue) dates.push(m.baselineDue); });
  dates.push(TODAY);
  dates.sort();
  const lo = dates[0], hi = dates[dates.length - 1];
  const from = lo.slice(0, 8) + "01";
  const toD = new Date(hi + "T00:00:00Z");
  toD.setUTCMonth(toD.getUTCMonth() + 1, 1);
  return { from, to: toD.toISOString().slice(0, 10) };
}

/* --------------------------------------------------------- what-if maths */

export const defaultScenario = () => ({
  dmDelta: 0, editorDelta: 0, activateHold: 0, winNewCr: 0, churn: [], priceUplift: 0, targetCr: null,
});

export function runScenario(sc) {
  const t = totals();
  const set = settings();
  const conc = concentration();
  const churnSet = new Set(sc.churn || []);
  const churnRev = conc.list.filter((c) => churnSet.has(c.key)).reduce((s, c) => s + c.rev, 0);
  const churnProjects = projects().filter((p) => churnSet.has(p.clientKey || slug(p.client))).length;
  const uplift = 1 + (sc.priceUplift || 0) / 100;
  const keptRev = (t.rev - churnRev) * uplift;
  const reactivated = t.holdRev * (sc.activateHold || 0) * uplift;
  const newRev = (sc.winNewCr || 0) * 1e7;
  const revAfter = keptRev + newRev;
  const activeRevAfter = (t.activeRev - churnRev * (t.activeRev / (t.rev || 1))) * uplift + reactivated + newRev;
  const newProjects = sc.winNewCr > 0 ? Math.max(1, Math.round(sc.winNewCr / 0.5)) : 0;
  const projAfter = t.n - churnProjects + newProjects;
  const dmAfter = Math.max(1, t.dmCount + (sc.dmDelta || 0));
  const edAfter = Math.max(1, t.edCount + (sc.editorDelta || 0));
  const costBefore = t.dmCount * (set.costPerDM || 0) + t.edCount * (set.costPerEditor || 0);
  const costAfter = dmAfter * (set.costPerDM || 0) + edAfter * (set.costPerEditor || 0);
  const before = { rev: t.rev, activeRev: t.activeRev, projects: t.n, dms: t.dmCount, editors: t.edCount,
    revPerDM: t.rev / (t.dmCount || 1), revPerEditor: t.rev / (t.edCount || 1), loadPerDM: t.n / (t.dmCount || 1), loadPerEditor: t.n / (t.edCount || 1),
    cost: costBefore, contribution: t.rev - costBefore, margin: t.rev > 0 ? (t.rev - costBefore) / t.rev : 0, top1: conc.top1, top3: conc.top3 };
  const survivors = conc.list.filter((c) => !churnSet.has(c.key)).map((c) => c.rev * uplift);
  if (newRev > 0) survivors.push(newRev);
  survivors.sort((a, b) => b - a);
  const survTotal = survivors.reduce((s, v) => s + v, 0) || 1;
  const shareN = (n) => survivors.slice(0, n).reduce((s, v) => s + v, 0) / survTotal;
  const after = { rev: revAfter, activeRev: activeRevAfter, projects: projAfter, dms: dmAfter, editors: edAfter,
    revPerDM: revAfter / dmAfter, revPerEditor: revAfter / edAfter, loadPerDM: projAfter / dmAfter, loadPerEditor: projAfter / edAfter,
    cost: costAfter, contribution: revAfter - costAfter, margin: revAfter > 0 ? (revAfter - costAfter) / revAfter : 0, top1: shareN(1), top3: shareN(3) };
  const capDM = set.capacityPerDM || 8, capEd = set.capacityPerEditor || 10;
  return { before, after, churnRev, reactivated, newRev, churnProjects,
    capacity: { dmUtilBefore: before.loadPerDM / capDM, dmUtilAfter: after.loadPerDM / capDM, edUtilBefore: before.loadPerEditor / capEd, edUtilAfter: after.loadPerEditor / capEd,
      dmsNeeded: Math.ceil(projAfter / capDM), editorsNeeded: Math.ceil(projAfter / capEd), capDM, capEd },
    target: sc.targetCr ? { cr: sc.targetCr, gap: sc.targetCr * 1e7 - revAfter } : null };
}

/* ----------------------------------------------------------- filtering */

export function rangeBounds() {
  const r = S.range;
  if (!r || r.preset === "all") return null;
  if (r.preset === "7d") return [TODAY, addDays(TODAY, 7)];
  if (r.preset === "30d") return [TODAY, addDays(TODAY, 30)];
  if (r.preset === "month") { const a = TODAY.slice(0, 8) + "01"; const d = new Date(a + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); return [a, addDays(d.toISOString().slice(0, 10), -1)]; }
  if (r.preset === "quarter") { const q = Math.floor((Number(TODAY.slice(5, 7)) - 1) / 3); const a = `${TODAY.slice(0, 4)}-${String(q * 3 + 1).padStart(2, "0")}-01`; const d = new Date(a + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 3); return [a, addDays(d.toISOString().slice(0, 10), -1)]; }
  if (r.preset === "custom" && isISO(r.from) && isISO(r.to)) return [r.from, r.to];
  return null;
}

/** Does the project touch the selected date range? Undated work is never
    hidden by a date filter — hiding it is how it got forgotten in the sheet. */
function inRange(p, bounds) {
  if (!bounds) return true;
  const [from, to] = bounds;
  const f = forecastOf(p);
  const dates = [p.start, p.end, f.forecast, f.baseline].filter(isISO);
  milestonesOf(p).forEach((m) => { const fm = f.milestones.get(m.id); if (fm?.forecast) dates.push(fm.forecast); });
  if (!dates.length) return !(from > TODAY) || statusKind(p.status) !== "done";
  if (dates.some((d) => d >= from && d <= to)) return true;
  if (p.start && p.start <= to && (p.openEnded || (p.end && p.end >= from))) return true;
  return (updatesByProject()[p.id] || []).some((u) => u.date >= from && u.date <= to);
}

const QUICK = {
  today:        (p) => { const f = forecastOf(p); return (f.forecast || f.baseline) === TODAY || milestonesOf(p).some((m) => !m.actualDone && f.milestones.get(m.id)?.forecast === TODAY); },
  next7:        (p) => { const to = addDays(TODAY, 7); const f = forecastOf(p); const d = f.forecast || f.baseline; return (d && d >= TODAY && d <= to) || milestonesOf(p).some((m) => !m.actualDone && (f.milestones.get(m.id)?.forecast || "") >= TODAY && (f.milestones.get(m.id)?.forecast || "") <= to); },
  overdue:      (p) => forecastOf(p).overdue || forecastOf(p).overdueMilestones.length > 0,
  atrisk:       (p) => ["critical", "at_risk"].includes(healthOf(p).key),
  escalated:    (p) => openEscalations(p).length > 0,
  waitclient:   (p) => { const u = lastUpdate(p); const f = forecastOf(p); return (u?.dependencyOwner === "Client") || (f.current?.external && !f.current?.actualDone && f.current?.ownerType === "Client" && f.current?.status !== "planned"); },
  waitinternal: (p) => { const u = lastUpdate(p); return !!u?.dependencyOwner && u.dependencyOwner !== "Client"; },
  hold:         (p) => statusKind(p.status) === "hold",
  notset:       (p) => healthOf(p).key === "unknown",
};
export const QUICK_LABELS = { today: "Due today", next7: "Next 7 days", overdue: "Overdue", atrisk: "At risk", escalated: "Escalated", waitclient: "Waiting for client", waitinternal: "Waiting internally", hold: "On hold", notset: "Dates not set" };

export function filtered(opts = {}) {
  const f = S.filters;
  const q = (opts.ignoreQ ? "" : f.q).trim().toLowerCase();
  const bounds = opts.ignoreRange ? null : rangeBounds();
  const has = (arr, v) => !arr?.length || arr.includes(v);
  return projects().filter((p) => {
    if (!has(f.status, statusKind(p.status))) return false;
    if (f.priority?.length && !f.priority.includes(p.priority || "")) return false;
    if (f.dm?.length && !(p.dms || []).some((d) => f.dm.includes(d))) return false;
    if (f.sdm?.length && !f.sdm.includes(p.sdm || "")) return false;
    if (f.category?.length && !(p.categories || []).some((c) => f.category.includes(c))) return false;
    if (f.editor?.length && !editorsOf(p).some((e) => f.editor.includes(e))) return false;
    if (f.client?.length && !f.client.includes(p.client)) return false;
    if (f.pod?.length && !f.pod.includes(p.podOwner || "")) return false;
    if (f.health?.length && !f.health.includes(healthOf(p).key)) return false;
    if (f.person) {
      const all = [...(p.dms || []), ...editorsOf(p), p.podOwner, p.sdm];
      if (!all.includes(f.person)) return false;
    }
    if (f.mine && S.me && !myProjects(S.me).includes(p)) return false;
    if (f.risk) {
      const codes = risksOf(p).map((r) => r.code);
      if (f.risk === "any" ? !codes.length : !codes.includes(f.risk)) return false;
    }
    if (f.quick && QUICK[f.quick] && !QUICK[f.quick](p)) return false;
    if (!inRange(p, bounds)) return false;
    if (q) {
      const hay = [p.client, p.projectName, p.scopeLocked || p.scope, p.podOwner, p.sdm,
        ...(p.dms || []), ...editorsOf(p), ...(p.categories || []), ...(p.tags || [])].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export const activeFilterCount = () => {
  const f = S.filters;
  return ["status", "priority", "dm", "sdm", "category", "client", "pod", "health", "editor"].reduce((n, k) => n + (f[k]?.length ? 1 : 0), 0)
    + (f.person ? 1 : 0) + (f.risk ? 1 : 0) + (f.quick ? 1 : 0) + (f.mine ? 1 : 0) + (S.range.preset !== "all" ? 1 : 0);
};

export const allOf = (field) =>
  [...new Set(projects().flatMap((p) => (Array.isArray(p[field]) ? p[field] : [p[field]])).filter(Boolean))].sort();

export const roster = () =>
  [...new Set([...people().map((p) => p.name), ...allOf("dms"), ...allOf("editorLeads"), ...allOf("podOwner"), ...allOf("sdm")])].filter(Boolean).sort();

export const dmNames = () => [...new Set([...people().filter((p) => (p.roles || []).includes("dm")).map((p) => p.name), ...allOf("dms")])].sort();
export const sdmNames = () => allOf("sdm");
export const clientNames = () => allOf("client");
export const categoryNames = () => [...new Set([...Object.keys(EFFORT_BY_CATEGORY), ...allOf("categories")])];

export function rolesOf(name) {
  const r = new Set();
  projects().forEach((p) => {
    if ((p.dms || []).includes(name)) r.add("DM");
    if (editorsOf(p).includes(name)) r.add("Editor");
    if (p.podOwner === name) r.add("Pod owner");
    if (p.sdm === name) r.add("SDM");
  });
  return [...r];
}

export function myProjects(name) {
  if (!name) return [];
  return cached("mine:" + name, () => projects().filter((p) =>
    (p.dms || []).includes(name) || editorsOf(p).includes(name) || p.podOwner === name || p.sdm === name));
}

/** Active projects nobody has touched inside the stale window, by owner. */
export function updatesOwed() {
  const limit = settings().staleUpdateDays || 7;
  const owed = {};
  projects().filter((p) => statusKind(p.status) === "active").forEach((p) => {
    const d = staleDays(p);
    if (d !== null && d <= limit) return;
    const owners = [...new Set([p.primaryDm, ...(p.dms || [])])].filter(Boolean);
    (owners.length ? owners : ["(nobody assigned)"]).forEach((o) => { (owed[o] ||= []).push({ p, days: d }); });
  });
  return Object.entries(owed).map(([name, items]) => ({ name, items, rev: items.reduce((s, i) => s + shareOf(i.p), 0) }))
    .sort((a, b) => b.items.length - a.items.length);
}
