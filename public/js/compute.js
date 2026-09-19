/* Everything derived from the board.

   Revenue attribution rule (carried over from the original load board, and the
   reason every breakdown reconciles to the same book): the sheet books revenue
   once per CLIENT, but a client can have several project rows. So we split a
   client's amount evenly across its projects, and then again across the people
   named on each project. Sum any breakdown and you get the real book back. */

import { S, TODAY, relDays, slug } from "./core.js";

const memo = new Map();
let memoVersion = -1;

function cached(key, fn) {
  if (memoVersion !== S.data.version) { memo.clear(); memoVersion = S.data.version; }
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key);
}

export const projects = () => S.data.projects;
export const settings = () => S.data.settings;

export const revenueIndex = () =>
  cached("revIdx", () => {
    const m = {};
    S.data.revenue.forEach((r) => { m[r.clientKey || slug(r.client)] = r; });
    return m;
  });

const clientProjectCount = () =>
  cached("clientCount", () => {
    const m = {};
    projects().forEach((p) => { const k = p.clientKey || slug(p.client); m[k] = (m[k] || 0) + 1; });
    return m;
  });

/** Revenue attributed to one project row. */
export function shareOf(p) {
  const k = p.clientKey || slug(p.client);
  const r = revenueIndex()[k];
  if (!r) return 0;
  return (Number(r.amount) || 0) / (clientProjectCount()[k] || 1);
}

export function isUnmapped(p) {
  const r = revenueIndex()[p.clientKey || slug(p.client)];
  return !!(r && r.unmapped);
}

export const statusKind = (s) => {
  const t = String(s || "").toLowerCase();
  if (t.includes("hold")) return "hold";
  if (t.includes("upcoming") || t.includes("pipeline")) return "upcoming";
  if (t.includes("complet") || t.includes("done") || t.includes("closed")) return "done";
  return "active";
};

/* ------------------------------------------------------------- updates */

export const updatesByProject = () =>
  cached("updByProj", () => {
    const m = {};
    S.data.updates.forEach((u) => { (m[u.projectId] ||= []).push(u); });
    Object.values(m).forEach((list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));
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

export const milestonesByProject = () =>
  cached("msByProj", () => {
    const m = {};
    S.data.milestones.forEach((x) => { (m[x.projectId] ||= []).push(x); });
    Object.values(m).forEach((l) => l.sort((a, b) => (a.date > b.date ? 1 : -1)));
    return m;
  });

/* ---------------------------------------------------------------- risk */

/** Delivery risks, worst first. Each is {code, label, sev} where sev 2 = red. */
export function risksOf(p) {
  const out = [];
  const kind = statusKind(p.status);
  const stale = staleDays(p);
  const limit = settings().staleUpdateDays || 7;

  if (kind !== "done" && p.end && relDays(p.end) < 0 && !p.openEnded) {
    out.push({ code: "overdue", label: `End date passed ${-relDays(p.end)}d ago`, sev: 2 });
  }
  if (kind === "active" && !p.start && !p.end && !p.openEnded) {
    out.push({ code: "nodates", label: "No start or end date on the board", sev: 1 });
  }
  if (kind === "active" && stale === null) {
    out.push({ code: "noupdate", label: "Never had a status update", sev: 2 });
  } else if (kind === "active" && stale > limit) {
    out.push({ code: "stale", label: `No update in ${stale} days`, sev: stale > limit * 2 ? 2 : 1 });
  }
  if (isUnmapped(p)) {
    out.push({ code: "unmapped", label: "Revenue not mapped to this client", sev: 1 });
  }
  if (kind === "hold" && shareOf(p) > 0) {
    out.push({ code: "heldrev", label: "On hold while carrying revenue", sev: 1 });
  }
  if (!p.editorLeads?.length) out.push({ code: "noeditor", label: "No editor lead assigned", sev: 1 });
  if (!p.dms?.length) out.push({ code: "nodm", label: "No DM assigned", sev: 2 });
  if (p.datesUnknown) out.push({ code: "tbd", label: "Dates marked TBD in the sheet", sev: 1 });

  return out.sort((a, b) => b.sev - a.sev);
}

export function riskScore(p) {
  return risksOf(p).reduce((n, r) => n + r.sev, 0);
}

/** The latest blocker anyone has posted against this project, if it still stands. */
export function openBlocker(p) {
  const u = lastUpdate(p);
  return u && u.blockers ? u : null;
}

/** How loudly this project is asking for someone senior.
    Severity dominates, money breaks ties, silence adds to both. */
export function escalationScore(p) {
  const risks = risksOf(p);
  if (statusKind(p) === "done") return 0;
  let s = risks.reduce((n, r) => n + (r.sev === 2 ? 10 : 3), 0);
  if (openBlocker(p)) s += 12;
  const stale = staleDays(p);
  if (stale !== null) s += Math.min(10, Math.floor(stale / 7) * 2);
  // Revenue is a tie-breaker, not the driver — a ₹0 project can still be on fire.
  s += Math.min(8, (shareOf(p) / 1e7) * 6);
  return s;
}

export const atRisk = () =>
  cached("atRisk", () =>
    projects()
      .map((p) => ({ p, risks: risksOf(p), score: riskScore(p), rev: shareOf(p) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.rev - a.rev));

/* --------------------------------------------------------- delivery load

   There are no timesheets on this board, so "bandwidth" is deliberately two
   separate numbers rather than one invented score:

     effort points   what we ASSUME the work costs — from the service line,
                     overridable per project once someone who knows says otherwise
     observed        what is actually being worked on — status updates logged

   Keeping them apart means you can see when they disagree, which is the useful
   signal: a 5-point project nobody has mentioned in a month is either
   mis-weighted or quietly stalled. */

const EFFORT_BY_CATEGORY = {
  "Content @ Scale": 5,
  "Personalisation": 4,
  "Cinematic": 3,
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
  // A scope that names a four-figure volume is not a standard job.
  if (/\b\d{4,}\b/.test(p.scope || "")) {
    base = Math.min(5, base + 1);
    why += ", scope names a bulk volume";
  }
  return { points: applyStatus(base, p), base, source: "assumed", why };
}

/** Parked work still occupies a slot in someone's head, but not a full one. */
function applyStatus(base, p) {
  const k = statusKind(p.status);
  if (k === "hold") return base * 0.25;
  if (k === "upcoming") return base * 0.5;
  if (k === "done") return 0;
  return base;
}

/** Updates logged against a project in the trailing window (default 60 days). */
export function activityOf(p, days = 60) {
  const since = new Date(Date.parse(TODAY + "T00:00:00Z") - days * 86400000)
    .toISOString().slice(0, 10);
  return (updatesByProject()[p.id] || [])
    .filter((u) => u.date && u.date >= since && u.date <= TODAY).length;
}

/** Per-person delivery load for a role field, with each project's share. */
export function loadRollup(field) {
  return cached("load:" + field, () => {
    const m = {};
    projects().forEach((p) => {
      const names = p[field] || [];
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
        return {
          ...r,
          clientCount: r.clients.size,
          projects: r.items.length,
          top: r.items[0] || null,
          weighted: r.points,
        };
      })
      .sort((a, b) => b.points - a.points);
  });
}

/** Projects ranked by what they cost, with the per-seat weight for each role. */
export function bandwidthRanking() {
  return cached("bandwidth", () => projects()
    .map((p) => {
      const e = effortOf(p);
      const dms = (p.dms || []).length;
      const eds = (p.editorLeads || []).length;
      return {
        p, effort: e, points: e.points,
        activity: activityOf(p),
        dms, eds,
        perDM: dms ? e.points / dms : null,
        perEditor: eds ? e.points / eds : null,
        rev: shareOf(p),
      };
    })
    .filter((x) => x.points > 0)
    .sort((a, b) => b.points - a.points || b.activity - a.activity));
}

/** Effort points grouped by any dimension — pods, service lines, clients. */
export function loadByGroup(keyFn) {
  const m = {};
  bandwidthRanking().forEach((x) => {
    const keys = keyFn(x.p);
    const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    const use = list.length ? list : ["(none)"];
    const w = 1 / use.length;
    use.forEach((k) => {
      const e = (m[k] ||= { name: k, points: 0, projects: 0, rev: 0, activity: 0 });
      e.points += x.points * w;
      e.projects += w;
      e.rev += x.rev * w;
      e.activity += x.activity * w;
    });
  });
  return Object.values(m).sort((a, b) => b.points - a.points);
}

/** Bandwidth rolled up to the client — revenue, headcount and effort per client,
    heaviest first. This is the CEO's view of who is eating the delivery team. */
export const bandwidthByClient = () =>
  cached("bwClient", () => {
    const m = {};
    bandwidthRanking().forEach((x) => {
      const key = x.p.clientKey || slug(x.p.client);
      const e = (m[key] ||= {
        key, name: x.p.client, points: 0, rev: 0, projects: 0, activity: 0,
        live: 0, held: 0, dms: new Set(), eds: new Set(), pods: new Set(),
      });
      e.points += x.points;
      e.rev += x.rev;
      e.projects += 1;
      e.activity += x.activity;
      const k = statusKind(x.p.status);
      if (k === "active") e.live += 1;
      else if (k === "hold") e.held += 1;
      (x.p.dms || []).forEach((d) => e.dms.add(d));
      (x.p.editorLeads || []).forEach((d) => e.eds.add(d));
      if (x.p.podOwner) e.pods.add(x.p.podOwner);
      if (isUnmapped(x.p)) e.unmapped = true;
    });
    const totalPoints = Object.values(m).reduce((s, e) => s + e.points, 0) || 1;
    const totalRev = totals().rev || 1;

    return Object.values(m)
      .map((e) => ({
        ...e,
        dmCount: e.dms.size,
        edCount: e.eds.size,
        people: e.dms.size + e.eds.size,
        // Two shares of the same 100%, so they can be read against each other
        // without anyone having to hold a unit in their head.
        teamShare: (e.points / totalPoints) * 100,
        revShare: (e.rev / totalRev) * 100,
        // Don't quote ₹0/point for a client whose revenue was never mapped —
        // that reads as "free work" when it is really a hole in the sheet.
        revPerPoint: e.points > 0 && e.rev > 0 ? e.rev / e.points : null,
      }))
      .sort((a, b) => b.points - a.points);
  });

/** Is a client paying for the team time it uses? Compares the two shares. */
export function balanceOf(c) {
  if (c.unmapped || c.rev <= 0) {
    return { key: "unmapped", label: "Revenue not mapped", tone: "watch", ic: "✎" };
  }
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
      dmAvg: dms.length ? sum(dms) / dms.length : 0,
      edAvg: eds.length ? sum(eds) / eds.length : 0,
      dmMedian: median(dms), edMedian: median(eds),
      dmCount: dms.length, edCount: eds.length,
      liveProjects: projects().filter((p) => statusKind(p.status) === "active").length,
      heldProjects: projects().filter((p) => statusKind(p.status) === "hold").length,
      // Held work counts at a quarter today; unfreezing it adds the other 3/4.
      heldUpside: projects()
        .filter((p) => statusKind(p.status) === "hold")
        .reduce((s, p) => s + effortOf(p).base * 0.75, 0),
      assumed: projects().filter((p) => effortOf(p).source === "assumed").length,
      set: projects().filter((p) => effortOf(p).source === "set").length,
      unassignedEditor: projects().filter((p) => !(p.editorLeads || []).length).length,
      unassignedDM: projects().filter((p) => !(p.dms || []).length).length,
    };
  });

/* ------------------------------------------------------------- rollups */

/** Per-person rollup over a people field ("dms" | "editorLeads"). */
export function rollup(field) {
  return cached("rollup:" + field, () => {
    const m = {};
    projects().forEach((p) => {
      const names = p[field]?.length ? p[field] : ["(unassigned)"];
      const w = 1 / names.length;
      const money = shareOf(p) * w;
      names.forEach((name) => {
        const e = (m[name] ||= {
          name, rev: 0, load: 0, active: 0, hold: 0, risk: 0,
          clients: new Set(), peers: new Set(), projects: [],
        });
        e.rev += money;
        e.load += w;
        e.clients.add(p.client);
        e.projects.push(p);
        const k = statusKind(p.status);
        if (k === "active") e.active += w;
        if (k === "hold") e.hold += w;
        e.risk += riskScore(p) * w;
        (p[field === "dms" ? "editorLeads" : "dms"] || []).forEach((q) => e.peers.add(q));
      });
    });
    return Object.values(m)
      .map((e) => ({
        ...e,
        clientCount: e.clients.size,
        peerCount: e.peers.size,
        perProject: e.load > 0 ? e.rev / e.load : 0,
      }))
      .sort((a, b) => b.rev - a.rev);
  });
}

export const podRollup = () =>
  cached("pods", () => {
    const m = {};
    projects().forEach((p) => {
      const key = p.podOwner || "(unassigned)";
      const e = (m[key] ||= {
        name: key, rev: 0, load: 0, active: 0, hold: 0, upcoming: 0,
        risk: 0, dms: new Set(), eds: new Set(), clients: new Set(), projects: [],
      });
      e.rev += shareOf(p);
      e.load += 1;
      e.projects.push(p);
      e[statusKind(p.status) === "done" ? "active" : statusKind(p.status)] += 1;
      e.risk += riskScore(p);
      (p.dms || []).forEach((d) => e.dms.add(d));
      (p.editorLeads || []).forEach((d) => e.eds.add(d));
      e.clients.add(p.client);
    });
    return Object.values(m)
      .map((e) => ({
        ...e, dmCount: e.dms.size, edCount: e.eds.size, clientCount: e.clients.size,
        revPerDM: e.dms.size ? e.rev / e.dms.size : 0,
        loadPerDM: e.dms.size ? e.load / e.dms.size : 0,
      }))
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
        e.rev += shareOf(p) * w;
        e.load += w;
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
      const e = (m[key] ||= {
        key, name: p.client, rev: 0, load: 0, active: 0, hold: 0,
        pods: new Set(), projects: [], unmapped: isUnmapped(p),
      });
      e.rev += shareOf(p);
      e.load += 1;
      e.projects.push(p);
      const k = statusKind(p.status);
      if (k === "active") e.active += 1;
      if (k === "hold") e.hold += 1;
      if (p.podOwner) e.pods.add(p.podOwner);
    });
    // Clients that are billed but carry no project row at all.
    S.data.revenue.forEach((r) => {
      if (!m[r.clientKey]) {
        m[r.clientKey] = {
          key: r.clientKey, name: r.client, rev: Number(r.amount) || 0, load: 0,
          active: 0, hold: 0, pods: new Set(), projects: [], unmapped: r.unmapped, orphan: true,
        };
      }
    });
    return Object.values(m).sort((a, b) => b.rev - a.rev);
  });

export const totals = () =>
  cached("totals", () => {
    const t = {
      rev: 0, activeRev: 0, holdRev: 0, upcomingRev: 0,
      n: projects().length, active: 0, hold: 0, upcoming: 0, done: 0,
      unmapped: 0, unmappedRev: 0, atRisk: 0, riskRev: 0,
      serious: 0, seriousRev: 0,
      dms: new Set(), eds: new Set(), pods: new Set(), clients: new Set(),
    };
    projects().forEach((p) => {
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
      (p.dms || []).forEach((d) => t.dms.add(d));
      (p.editorLeads || []).forEach((d) => t.eds.add(d));
      if (p.podOwner) t.pods.add(p.podOwner);
      t.clients.add(p.client);
    });
    t.dmCount = t.dms.size; t.edCount = t.eds.size;
    t.podCount = t.pods.size; t.clientCount = t.clients.size;
    t.revPerDM = t.dmCount ? t.rev / t.dmCount : 0;
    t.revPerEditor = t.edCount ? t.rev / t.edCount : 0;
    t.loadPerDM = t.dmCount ? t.n / t.dmCount : 0;
    return t;
  });

/** Client concentration: top-1, top-3, top-5 share and a Herfindahl index. */
export const concentration = () =>
  cached("conc", () => {
    const list = clientRollup().filter((c) => c.rev > 0);
    const total = list.reduce((s, c) => s + c.rev, 0) || 1;
    const share = (n) => list.slice(0, n).reduce((s, c) => s + c.rev, 0) / total;
    const hhi = list.reduce((s, c) => s + Math.pow(c.rev / total, 2), 0);
    return {
      list, total, top1: share(1), top3: share(3), top5: share(5), top10: share(10),
      hhi,
      // HHI reads as an "effective number of clients" — 1/HHI.
      effectiveClients: hhi > 0 ? 1 / hhi : 0,
      billing: list.length,
    };
  });

/* -------------------------------------------------------- the timeline */

/** Projects placed on a date axis, with sensible fallbacks for missing dates. */
export function timelineRows(list = projects()) {
  const rows = [];
  list.forEach((p) => {
    let start = p.start, end = p.end, inferred = false;
    if (!start && end) { start = end; inferred = true; }
    if (start && !end) {
      end = p.openEnded ? null : start;
      inferred = true;
    }
    rows.push({
      p, start, end,
      open: p.openEnded && !!start,
      placed: !!(p.start || p.end),
      inferred,
      milestones: milestonesByProject()[p.id] || [],
    });
  });
  return rows;
}

export function timelineExtent(rows) {
  const dates = [];
  rows.forEach((r) => { if (r.start) dates.push(r.start); if (r.end) dates.push(r.end); });
  S.data.milestones.forEach((m) => { if (m.date) dates.push(m.date); });
  dates.push(TODAY);
  dates.sort();
  const pad = (iso, days) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const lo = dates[0], hi = dates[dates.length - 1];
  // Snap to month edges with a little breathing room.
  const from = lo.slice(0, 8) + "01";
  const toD = new Date(hi + "T00:00:00Z");
  toD.setUTCMonth(toD.getUTCMonth() + 1, 1);
  return { from: pad(from, 0), to: toD.toISOString().slice(0, 10) };
}

/* --------------------------------------------------------- what-if maths */

export const defaultScenario = () => ({
  dmDelta: 0,
  editorDelta: 0,
  activateHold: 0,      // 0..1 of on-hold revenue brought back to active
  winNewCr: 0,          // brand-new business, in ₹ Cr
  churn: [],            // clientKeys assumed lost
  priceUplift: 0,       // % across the whole book
  targetCr: null,
});

/** Run the levers and report the before/after the CEO view compares. */
export function runScenario(sc) {
  const t = totals();
  const set = settings();
  const conc = concentration();

  const churnSet = new Set(sc.churn || []);
  const churnRev = conc.list
    .filter((c) => churnSet.has(c.key))
    .reduce((s, c) => s + c.rev, 0);
  const churnProjects = projects().filter((p) => churnSet.has(p.clientKey || slug(p.client))).length;

  const uplift = 1 + (sc.priceUplift || 0) / 100;
  const keptRev = (t.rev - churnRev) * uplift;
  const reactivated = t.holdRev * (sc.activateHold || 0) * uplift;
  const newRev = (sc.winNewCr || 0) * 1e7;

  const revAfter = keptRev + newRev;
  const activeRevAfter = (t.activeRev - churnRev * (t.activeRev / (t.rev || 1))) * uplift + reactivated + newRev;

  // A won client is assumed to land as roughly one project per ₹0.5 Cr, floored at 1.
  const newProjects = sc.winNewCr > 0 ? Math.max(1, Math.round(sc.winNewCr / 0.5)) : 0;
  const projAfter = t.n - churnProjects + newProjects;

  const dmAfter = Math.max(1, t.dmCount + (sc.dmDelta || 0));
  const edAfter = Math.max(1, t.edCount + (sc.editorDelta || 0));

  const costBefore = t.dmCount * (set.costPerDM || 0) + t.edCount * (set.costPerEditor || 0);
  const costAfter = dmAfter * (set.costPerDM || 0) + edAfter * (set.costPerEditor || 0);

  const before = {
    rev: t.rev, activeRev: t.activeRev, projects: t.n,
    dms: t.dmCount, editors: t.edCount,
    revPerDM: t.rev / (t.dmCount || 1),
    revPerEditor: t.rev / (t.edCount || 1),
    loadPerDM: t.n / (t.dmCount || 1),
    loadPerEditor: t.n / (t.edCount || 1),
    cost: costBefore,
    contribution: t.rev - costBefore,
    margin: t.rev > 0 ? (t.rev - costBefore) / t.rev : 0,
    top1: conc.top1, top3: conc.top3,
  };

  // Concentration after churn: recompute on the surviving book.
  const survivors = conc.list.filter((c) => !churnSet.has(c.key)).map((c) => c.rev * uplift);
  if (newRev > 0) survivors.push(newRev);
  survivors.sort((a, b) => b - a);
  const survTotal = survivors.reduce((s, v) => s + v, 0) || 1;
  const shareN = (n) => survivors.slice(0, n).reduce((s, v) => s + v, 0) / survTotal;

  const after = {
    rev: revAfter, activeRev: activeRevAfter, projects: projAfter,
    dms: dmAfter, editors: edAfter,
    revPerDM: revAfter / dmAfter,
    revPerEditor: revAfter / edAfter,
    loadPerDM: projAfter / dmAfter,
    loadPerEditor: projAfter / edAfter,
    cost: costAfter,
    contribution: revAfter - costAfter,
    margin: revAfter > 0 ? (revAfter - costAfter) / revAfter : 0,
    top1: shareN(1), top3: shareN(3),
  };

  const capDM = set.capacityPerDM || 8;
  const capEd = set.capacityPerEditor || 10;

  return {
    before, after,
    churnRev, reactivated, newRev, churnProjects,
    capacity: {
      dmUtilBefore: before.loadPerDM / capDM,
      dmUtilAfter: after.loadPerDM / capDM,
      edUtilBefore: before.loadPerEditor / capEd,
      edUtilAfter: after.loadPerEditor / capEd,
      dmsNeeded: Math.ceil(projAfter / capDM),
      editorsNeeded: Math.ceil(projAfter / capEd),
      capDM, capEd,
    },
    target: sc.targetCr ? { cr: sc.targetCr, gap: sc.targetCr * 1e7 - revAfter } : null,
  };
}

/* ----------------------------------------------------------- filtering */

export function filtered() {
  const f = S.filters;
  const q = f.q.trim().toLowerCase();
  return projects().filter((p) => {
    if (f.pod && p.podOwner !== f.pod) return false;
    if (f.status && statusKind(p.status) !== f.status) return false;
    if (f.category && !(p.categories || []).includes(f.category)) return false;
    if (f.person) {
      const all = [...(p.dms || []), ...(p.editorLeads || []), p.podOwner, p.sdm];
      if (!all.includes(f.person)) return false;
    }
    if (f.risk) {
      const codes = risksOf(p).map((r) => r.code);
      if (f.risk === "any" ? !codes.length : !codes.includes(f.risk)) return false;
    }
    if (q) {
      const hay = [p.client, p.projectName, p.scope, p.podOwner, p.sdm,
        ...(p.dms || []), ...(p.editorLeads || []), ...(p.categories || [])]
        .join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export const allOf = (field) =>
  [...new Set(projects().flatMap((p) => (Array.isArray(p[field]) ? p[field] : [p[field]])).filter(Boolean))].sort();

export const roster = () =>
  [...new Set([...allOf("dms"), ...allOf("editorLeads"), ...allOf("podOwner"), ...allOf("sdm")])].sort();

/** Which hats a person wears — used by "My work" and the standup composer. */
export function rolesOf(name) {
  const r = new Set();
  projects().forEach((p) => {
    if ((p.dms || []).includes(name)) r.add("DM");
    if ((p.editorLeads || []).includes(name)) r.add("Editor lead");
    if (p.podOwner === name) r.add("Pod owner");
    if (p.sdm === name) r.add("SDM");
  });
  return [...r];
}

export function myProjects(name) {
  if (!name) return [];
  return projects().filter((p) =>
    (p.dms || []).includes(name) || (p.editorLeads || []).includes(name) ||
    p.podOwner === name || p.sdm === name);
}
