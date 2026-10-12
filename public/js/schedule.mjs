/* The schedule engine — pure functions over milestones, assignments and people.

   Shared by the browser (every view imports it) and the server (lib/schedule.js
   loads this same file), so a forecast is the same number wherever it is read.
   Nothing in here touches the DOM, the store or the clock: `today` is always an
   argument, and the engine imports nothing.

   The rules, in one place:

   - A milestone has a BASELINE (what was committed) and a FORECAST (what we now
     expect). The engine never moves a baseline; a person does, with a reason,
     and the milestone's history records it. The computed forecast is never
     stored — `ownerEta` is the owner's current promise, and that is a human
     input like any other.
   - A finished milestone's forecast is the day it finished. An override wins
     while it is in the future; once it has passed it stops being a promise.
   - Otherwise the forecast is arithmetic on remaining work: a milestone that
     has not started starts on the latest of its own start date, the working
     day after its dependencies finish, and today; one that is in progress has
     its remaining duration counted from today. Nothing unfinished finishes in
     the past.
   - A missing duration or date stays missing. The engine reports it; it never
     invents a value and never treats a blank as on time. */

export const STAGES = {
  brief: "Brief / Inputs", script: "Script", storyboard: "Storyboard",
  base_video: "Base Video", client_feedback: "Client Feedback", revisions: "Revisions",
  adaptations: "Adaptations / Automation", qc: "QC", final_delivery: "Final Delivery",
  custom: "Custom",
};

export const OWNER_TYPES = ["Client", "DM", "Editor", "AI/Tech", "Creative", "Other"];
export const SEVERITIES = ["low", "medium", "high", "critical"];
export const MILESTONE_STATUSES = ["planned", "in_progress", "blocked", "done"];

/* ------------------------------------------------------------------ dates */

const DAY = 86400000;
const n2d = (n) => new Date(n).toISOString().slice(0, 10);
const d2n = (iso) => Date.parse(iso + "T00:00:00Z");

export const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const addDays = (iso, n) => n2d(d2n(iso) + n * DAY);
export const daysBetween = (a, b) => Math.round((d2n(b) - d2n(a)) / DAY);
export const maxDate = (...list) => list.filter(isISO).sort().pop() || null;
export const minDate = (...list) => list.filter(isISO).sort()[0] || null;

const WEEK = [1, 2, 3, 4, 5];
const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();

export function calendar(settings = {}) {
  if (settings && settings.holidays instanceof Set) return settings;     // already a calendar
  const workingDays = Array.isArray(settings.workingDays) && settings.workingDays.length ? settings.workingDays : WEEK;
  const holidays = new Set(Array.isArray(settings.holidays) ? settings.holidays.filter(isISO) : []);
  return { workingDays, holidays };
}
export const isWorkingDay = (iso, cal) => {
  const c = calendar(cal);
  return c.workingDays.includes(dow(iso)) && !c.holidays.has(iso);
};

/** `iso` plus `n` working days. n = 0 gives the first working day on or after iso. */
export function addWorkingDays(iso, n, calOrSettings) {
  if (!isISO(iso)) return null;
  const cal = calendar(calOrSettings);
  let d = iso;
  let left = Math.max(0, Math.round(n || 0));
  let guard = 0;
  while (!isWorkingDay(d, cal) && guard++ < 60) d = addDays(d, 1);
  while (left > 0 && guard++ < 10000) {
    d = addDays(d, 1);
    if (isWorkingDay(d, cal)) left -= 1;
  }
  return d;
}

/** Working days from `a` to `b` inclusive (0 when b < a). */
export function workingDaysIn(a, b, calOrSettings) {
  if (!isISO(a) || !isISO(b) || b < a) return 0;
  const cal = calendar(calOrSettings);
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (isWorkingDay(d, cal)) n += 1;
  return n;
}

/* ------------------------------------------------------------- statuses */

export const statusKind = (s) => {
  const t = String(s || "").toLowerCase();
  if (t.includes("hold")) return "hold";
  if (t.includes("upcoming") || t.includes("pipeline")) return "upcoming";
  if (t.includes("complet") || t.includes("done") || t.includes("closed")) return "done";
  return "active";
};

/* ---------------------------------------------------------- the template */

/** Lay a template out as a chain from `startISO`: baselines end to end in
    working days, each step depending on the one before. Returns milestone
    bodies without ids; the caller assigns ids and resolves `dependsOnIndex`. */
export function templateChain(template, startISO, settings = {}) {
  const cal = calendar(settings);
  const out = [];
  let cursor = null;
  template.forEach((t, i) => {
    const dur = Math.max(1, Number(t.durationDays) || 1);
    const start = cursor ? addWorkingDays(cursor, 1, cal) : addWorkingDays(startISO, 0, cal);
    const due = addWorkingDays(start, dur - 1, cal);
    out.push({
      stage: t.stage || "custom", title: t.title, ownerType: t.ownerType || "DM", owner: "",
      startDate: start, baselineDue: due, ownerEta: null, durationDays: dur, lagDays: 0,
      dependsOnIndex: i === 0 ? [] : [i - 1],
      actualStart: null, actualDone: null, status: "planned", blocker: "",
      locked: false, external: t.ownerType === "Client", override: null, history: [], order: i,
    });
    cursor = due;
  });
  return out;
}

/* ------------------------------------------------------------ forecasts */

/** Topological order over dependsOn. Milestones in a cycle are flagged and
    evaluated as if their dependency edges were not there, so one bad link
    cannot blank a whole project. */
function order(ms) {
  const byId = new Map(ms.map((m) => [m.id, m]));
  const state = new Map();
  const out = [];
  const cyclic = new Set();
  const visit = (m, stack) => {
    if (state.get(m.id) === 2) return;
    if (state.get(m.id) === 1) { stack.forEach((id) => cyclic.add(id)); cyclic.add(m.id); return; }
    state.set(m.id, 1);
    (m.dependsOn || []).forEach((id) => { const d = byId.get(id); if (d) visit(d, [...stack, m.id]); });
    state.set(m.id, 2);
    out.push(m);
  };
  ms.forEach((m) => visit(m, []));
  return { out, cyclic, byId };
}

/** @returns Map<id, forecast record> — see the fields assembled at the bottom. */
export function forecastMilestones(ms, today, settings = {}) {
  const cal = calendar(settings);
  const { out, cyclic } = order(ms || []);
  const res = new Map();

  out.forEach((m) => {
    const baseline = isISO(m.baselineDue) ? m.baselineDue : null;
    const done = isISO(m.actualDone);
    const missing = [];
    const dur = Number.isFinite(Number(m.durationDays)) && Number(m.durationDays) > 0 ? Number(m.durationDays) : null;

    // The working day after the dependencies finish (plus any lag).
    const depEnds = cyclic.has(m.id) ? [] : (m.dependsOn || []).map((id) => res.get(id)?.forecast).filter(isISO);
    const depsFinish = depEnds.length ? maxDate(...depEnds) : null;
    const depStart = depsFinish ? addWorkingDays(depsFinish, 1 + Math.max(0, Number(m.lagDays) || 0), cal) : null;

    let forecast = null, drivenBy = "none", start = null, overrideStale = false, etaOptimisticBy = null;

    if (done) {
      forecast = m.actualDone; drivenBy = "done";
    } else if (m.override && isISO(m.override.date)) {
      forecast = m.override.date; drivenBy = "override";
      if (isISO(today) && today > forecast) { forecast = today; overrideStale = true; drivenBy = "override_stale"; }
    } else {
      const inProgress = m.status === "in_progress" || m.status === "blocked";
      if (dur === null) {
        // No duration: we can only say "not before its commitment, not before today".
        missing.push("duration");
        forecast = maxDate(baseline, depsFinish, isISO(today) ? today : null);
        drivenBy = !forecast ? "none" : forecast === baseline ? "baseline" : forecast === depsFinish ? "dependency" : "today";
        if (!baseline && !depsFinish) missing.push("date");
      } else if (inProgress) {
        const ref = maxDate(m.actualStart, m.startDate, depStart) || today;
        start = ref;
        const elapsed = isISO(today) && ref < today ? workingDaysIn(ref, addDays(today, -1), cal) : 0;
        const remaining = Math.max(1, dur - elapsed);
        const base = isISO(today) ? maxDate(today, depStart) : (depStart || ref);
        forecast = addWorkingDays(base, remaining - 1, cal);
        drivenBy = "progress";
      } else {
        start = maxDate(m.startDate, depStart, isISO(today) ? today : null);
        if (!start) { missing.push("date"); }
        else {
          forecast = addWorkingDays(start, dur - 1, cal);
          drivenBy = start === depStart ? "dependency" : start === m.startDate ? "start" : "today";
          // Planned work does not finish before its commitment unless someone says so.
          if (baseline && forecast < baseline) { forecast = baseline; drivenBy = "baseline"; }
        }
      }
      if (isISO(m.ownerEta) && forecast) {
        if (m.ownerEta >= forecast) { forecast = m.ownerEta; drivenBy = "eta"; }
        else etaOptimisticBy = daysBetween(m.ownerEta, forecast);
      } else if (isISO(m.ownerEta) && !forecast) {
        forecast = maxDate(m.ownerEta, isISO(today) ? today : null); drivenBy = "eta";
      }
    }

    res.set(m.id, {
      id: m.id,
      forecast, baseline, start,
      slipDays: baseline && forecast ? daysBetween(baseline, forecast) : null,   // calendar days
      overdue: !done && !!baseline && isISO(today) && baseline < today,
      done, drivenBy,
      cycle: cyclic.has(m.id),
      missing,
      overrideStale, etaOptimisticBy,
      blocked: m.status === "blocked" || !!m.blocker,
      waitingOn: !done && m.external ? (m.ownerType || "Client") : null,
    });
  });

  (ms || []).forEach((m) => {
    if (!res.has(m.id)) res.set(m.id, { id: m.id, forecast: null, baseline: null, start: null, slipDays: null, overdue: false, done: false, drivenBy: "none", cycle: true, missing: ["cycle"], overrideStale: false, etaOptimisticBy: null, blocked: false, waitingOn: null });
  });
  return res;
}

/** The project-level picture: committed vs forecast delivery, slip, where it stands.
    The baseline is the project's `end` (the sheet's committed date) when it has
    one and is not open-ended; otherwise the final milestone's baseline. */
export function projectForecast(p, ms, today, settings = {}) {
  const list = (ms || []).filter((m) => m.projectId === p.id).sort((a, b) => (a.order || 0) - (b.order || 0));
  const fc = forecastMilestones(list, today, settings);
  const kind = statusKind(p.status);
  const done = kind === "done";

  const dependents = new Set(list.flatMap((m) => m.dependsOn || []));
  const finals = list.filter((m) => m.stage === "final_delivery");
  const sinks = list.filter((m) => !dependents.has(m.id));
  const latest = (arr) => arr.slice().sort((a, b) => {
    const fa = fc.get(a.id)?.forecast || "", fb = fc.get(b.id)?.forecast || "";
    return fa < fb ? 1 : fa > fb ? -1 : 0;
  })[0] || null;
  const finalM = finals[0] || latest(sinks);

  const baseline = p.openEnded ? null
    : isISO(p.end) ? p.end
    : finalM && isISO(finalM.baselineDue) ? finalM.baselineDue : null;
  const baselineOriginal = isISO(p.baselineOriginal) ? p.baselineOriginal : baseline;

  let forecast = null, forecastSource = "unset";
  if (done) { forecast = baseline; forecastSource = "done"; }
  else if (p.deliveryOverride && isISO(p.deliveryOverride.date)) { forecast = p.deliveryOverride.date; forecastSource = "override"; }
  else if (finalM && fc.get(finalM.id)?.forecast) { forecast = fc.get(finalM.id).forecast; forecastSource = "milestones"; }
  else if (p.openEnded) { forecast = null; forecastSource = "ongoing"; }
  else if (baseline) {
    forecast = baseline; forecastSource = "baseline";
    if (kind === "active" && isISO(today) && today > forecast) { forecast = today; forecastSource = "today"; }
  }

  const open = list.filter((m) => !isISO(m.actualDone));
  const byForecast = (a, b) => {
    const fa = fc.get(a.id)?.forecast || "9999", fb = fc.get(b.id)?.forecast || "9999";
    return fa < fb ? -1 : fa > fb ? 1 : (a.order || 0) - (b.order || 0);
  };
  const next = open.slice().sort(byForecast)[0] || null;
  const current = open.find((m) => m.status === "in_progress" || m.status === "blocked") || next;
  const lastDone = list.filter((m) => isISO(m.actualDone)).sort((a, b) => (a.actualDone < b.actualDone ? 1 : -1))[0] || null;

  const missing = [];
  if (!baseline && !p.openEnded) missing.push("committed delivery date");
  if (!list.length) missing.push("milestones");

  return {
    milestones: fc,
    final: finalM,
    baseline, baselineOriginal, forecast, forecastSource,
    slipDays: baseline && forecast ? daysBetween(baseline, forecast) : null,
    forecastMiss: !done && !!baseline && !!forecast && forecast > baseline,
    overdue: !done && !!baseline && isISO(today) && baseline < today,
    daysRemaining: !done && (forecast || baseline) && isISO(today) ? daysBetween(today, forecast || baseline) : null,
    current, next, lastDone,
    overdueMilestones: list.filter((m) => fc.get(m.id)?.overdue),
    blockedMilestones: list.filter((m) => fc.get(m.id)?.blocked && !fc.get(m.id)?.done),
    hasChain: list.length > 0,
    doneCount: list.length - open.length, total: list.length,
    cycle: list.some((m) => fc.get(m.id)?.cycle),
    missing,
    ongoing: !!p.openEnded,
  };
}

/* ----------------------------------------------------------- assignments */

/** An assignment's window: its own dates when pinned, otherwise the window of
    the milestone it is attached to (so it moves when the milestone moves). */
export function assignmentWindow(a, milestoneById, forecasts) {
  if (isISO(a.scheduledStart) && isISO(a.scheduledEnd)) return { start: a.scheduledStart, end: a.scheduledEnd, derived: false };
  const m = a.milestoneId ? milestoneById.get(a.milestoneId) : null;
  const f = m ? forecasts.get(m.id) : null;
  if (f && f.forecast) {
    const end = f.forecast;
    const dur = Number(m.durationDays) > 0 ? Number(m.durationDays) : 1;
    const start = f.start || maxDate(m.startDate, addDays(end, -(dur * 1.4) | 0)) || end;
    return { start: minDate(start, end), end, derived: true };
  }
  if (isISO(a.scheduledStart)) return { start: a.scheduledStart, end: a.scheduledStart, derived: false };
  return { start: null, end: null, derived: true };
}

/** Attach a resolved window to every live assignment. */
export function resolveAssignments(assignments, milestones, today, settings = {}) {
  const byProject = new Map();
  (milestones || []).forEach((m) => { (byProject.get(m.projectId) || byProject.set(m.projectId, []).get(m.projectId)).push(m); });
  const byId = new Map((milestones || []).map((m) => [m.id, m]));
  const fcCache = new Map();
  const fcFor = (projectId) => {
    if (!fcCache.has(projectId)) fcCache.set(projectId, forecastMilestones(byProject.get(projectId) || [], today, settings));
    return fcCache.get(projectId);
  };
  return (assignments || [])
    .filter((a) => a.status !== "cancelled")
    .map((a) => ({ ...a, ...assignmentWindow(a, byId, fcFor(a.projectId)) }));
}

/** Hours an assignment puts on each working day of its (resolved) window. */
export function spreadHours(a, cal = calendar()) {
  const start = a.start || a.scheduledStart, end = a.end || a.scheduledEnd;
  if (!isISO(start) || !isISO(end) || !(Number(a.estimatedHours) > 0)) return new Map();
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkingDay(d, cal)) days.push(d);
  if (!days.length) days.push(start);
  const per = Number(a.estimatedHours) / days.length;
  return new Map(days.map((d) => [d, per]));
}

const availabilityFactor = (person, day) => {
  const av = person?.availability;
  if (!av || av.status === "available") return 1;
  if (av.until && day > av.until) return 1;
  if (av.status === "limited") return Number(av.fraction) > 0 && Number(av.fraction) < 1 ? Number(av.fraction) : 0.5;
  if (av.status === "out") return 0;
  return 1;
};

/** Scheduled hours against available hours for one person over a date range.
    Hours are a LOWER BOUND when any assignment in range has no estimate: the
    result says so (`incomplete`, `unestimated`) and is never green then. */
export function utilisation({ person, assignments = [], from, to, settings = {} }) {
  const cal = calendar(settings);
  const perWeek = Number(person?.capacityHoursPerWeek) > 0 ? Number(person.capacityHoursPerWeek) : (Number(settings.capacityHoursPerWeek) || 40);
  const perDay = perWeek / cal.workingDays.length;
  const name = person?.name;
  const mine = assignments.filter((a) => a.editor === name && a.status !== "cancelled" && a.status !== "done");

  let scheduled = 0, capacity = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWorkingDay(d, cal)) continue;
    capacity += perDay * availabilityFactor(person, d);
  }
  const unestimated = [], inRange = [];
  mine.forEach((a) => {
    const s = a.start || a.scheduledStart, e = a.end || a.scheduledEnd;
    const overlaps = !isISO(s) || !isISO(e) ? true : (s <= to && e >= from);
    if (!overlaps) return;
    inRange.push(a.id);
    if (!(Number(a.estimatedHours) > 0)) { unestimated.push(a.id); return; }
    spreadHours(a, cal).forEach((h, d) => { if (d >= from && d <= to) scheduled += h; });
  });

  const amber = Number(settings.utilAmber) || 0.8, red = Number(settings.utilRed) || 1.0;
  const ratio = capacity > 0 ? scheduled / capacity : null;
  const incomplete = unestimated.length > 0;
  const band = ratio === null ? "unknown" : ratio > red ? "red" : ratio >= amber ? "amber" : incomplete ? "incomplete" : "green";
  return {
    scheduled: Math.round(scheduled * 10) / 10,
    capacity: Math.round(capacity * 10) / 10,
    free: Math.round(Math.max(0, capacity - scheduled) * 10) / 10,
    ratio, band, lowerBound: incomplete,
    unestimated, incomplete,
    assignments: inRange.length,
    coverage: inRange.length ? (inRange.length - unestimated.length) / inRange.length : 1,
  };
}

/** Per-day over-capacity check for one person: days where known hours exceed
    the day's capacity. Used by the assignment board to flag clashes. */
export function overloadedDays({ person, assignments = [], from, to, settings = {} }) {
  const cal = calendar(settings);
  const perWeek = Number(person?.capacityHoursPerWeek) > 0 ? Number(person.capacityHoursPerWeek) : (Number(settings.capacityHoursPerWeek) || 40);
  const perDay = perWeek / cal.workingDays.length;
  const load = new Map();
  assignments.filter((a) => a.editor === person?.name && a.status !== "cancelled" && a.status !== "done")
    .forEach((a) => spreadHours(a, cal).forEach((h, d) => { if (d >= from && d <= to) load.set(d, (load.get(d) || 0) + h); }));
  const out = [];
  load.forEach((h, d) => { const cap = perDay * availabilityFactor(person, d); if (h > cap + 1e-9) out.push({ day: d, hours: Math.round(h * 10) / 10, capacity: Math.round(cap * 10) / 10 }); });
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Rank editors for a piece of work in a window: known free hours first,
    skills as a tiebreak, leave excluded, unestimated work stated. */
export function bestEditor({ people = [], assignments = [], from, to, skills = [], settings = {}, exclude = [] }) {
  return people
    .filter((p) => (p.roles || []).some((r) => r === "editorLead" || r === "editor"))
    .filter((p) => p.active !== false && !exclude.includes(p.name))
    .filter((p) => !(p.availability?.status === "out" && (!p.availability.until || p.availability.until >= to)))
    .map((p) => {
      const u = utilisation({ person: p, assignments, from, to, settings });
      const have = new Set((p.skills || []).map((s) => String(s).toLowerCase()));
      const matched = skills.filter((s) => have.has(String(s).toLowerCase()));
      return {
        name: p.name, free: u.free, ratio: u.ratio, band: u.band, unestimated: u.unestimated.length,
        confidence: u.coverage, skillMatch: skills.length ? matched.length / skills.length : null,
        clashes: u.assignments,
        score: u.free + (skills.length ? matched.length * 0.5 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || (b.skillMatch || 0) - (a.skillMatch || 0));
}

/* ---------------------------------------------------------------- impact */

/** What changing one milestone does — to its project and to anyone sharing an
    editor with it. Reports; never reschedules anybody else. `change` is
    {id, patch} for an existing milestone, or {add: milestone} / {remove: id}. */
export function impact({ project, milestones, assignments = [], people = [], change, today, settings = {} }) {
  const mine = (milestones || []).filter((m) => m.projectId === project.id);
  let after = mine;
  if (change.remove) after = mine.filter((m) => m.id !== change.remove).map((m) => ({ ...m, dependsOn: (m.dependsOn || []).filter((d) => d !== change.remove) }));
  else if (change.add) after = [...mine, change.add];
  else after = mine.map((m) => (m.id === change.id ? { ...m, ...change.patch } : m));

  const before = projectForecast(project, mine, today, settings);
  const next = projectForecast(project, after, today, settings);

  const moved = after.map((m) => {
    const a = before.milestones.get(m.id)?.forecast || null;
    const b = next.milestones.get(m.id)?.forecast || null;
    if (a === b) return null;
    return { id: m.id, title: m.title, from: a, to: b, days: a && b ? daysBetween(a, b) : null };
  }).filter(Boolean);

  // Assignments that follow a moved milestone shift with it; pinned ones that
  // fall outside the new window need a person to reschedule them.
  const byId = new Map(after.map((m) => [m.id, m]));
  const cal = calendar(settings);
  const conflicts = [], reschedule = [];
  const live = (assignments || []).filter((a) => a.status !== "cancelled" && a.status !== "done");
  const personByName = new Map((people || []).map((p) => [p.name, p]));

  moved.forEach((mv) => {
    live.filter((a) => a.projectId === project.id && a.milestoneId === mv.id).forEach((a) => {
      const win = assignmentWindow(a, byId, next.milestones);
      if (!win.derived) {
        if (mv.to && a.scheduledEnd && a.scheduledEnd < mv.to) reschedule.push({ assignmentId: a.id, editor: a.editor, scheduledEnd: a.scheduledEnd, milestoneForecast: mv.to });
        return;
      }
      if (!win.start || !win.end) return;
      live.forEach((o) => {
        if (o.id === a.id || o.editor !== a.editor || o.projectId === project.id) return;
        const ow = assignmentWindow(o, new Map((milestones || []).map((m) => [m.id, m])), forecastMilestones((milestones || []).filter((m) => m.projectId === o.projectId), today, settings));
        if (!ow.start || !ow.end) return;
        const s = maxDate(win.start, ow.start), e = minDate(win.end, ow.end);
        if (!s || !e || s > e) return;
        const overlap = workingDaysIn(s, e, cal);
        const person = personByName.get(a.editor);
        const perDay = (Number(person?.capacityHoursPerWeek) > 0 ? Number(person.capacityHoursPerWeek) : 40) / cal.workingDays.length;
        const known = (Number(a.estimatedHours) > 0 && Number(o.estimatedHours) > 0);
        let hoursOver = null;
        if (known) {
          const ha = spreadHours({ ...a, ...win }, cal), ho = spreadHours({ ...o, ...ow }, cal);
          let over = 0;
          for (let d = s; d <= e; d = addDays(d, 1)) { const h = (ha.get(d) || 0) + (ho.get(d) || 0); if (h > perDay) over += h - perDay; }
          hoursOver = Math.round(over * 10) / 10;
        }
        if (!known || hoursOver > 0) conflicts.push({ editor: a.editor, assignmentId: a.id, otherAssignmentId: o.id, otherProjectId: o.projectId, overlapWorkingDays: overlap, hoursOver, hoursKnown: known });
      });
    });
  });

  return {
    moved,
    delivery: { before: before.forecast, after: next.forecast, baseline: next.baseline, slipDays: next.slipDays, forecastMiss: next.forecastMiss },
    conflicts, reschedule,
    affectsCommitment: !!next.baseline && !!next.forecast && next.forecast > next.baseline && !(before.forecast && before.forecast > before.baseline),
  };
}

/* ---------------------------------------------------------------- health */

/** One word for where a project stands, plus why and what is missing.
    Order: completed, on hold, critical, at risk, on track — and "unknown"
    whenever there is nothing committed to be on track against. */
export function healthOf({ project, forecast, escalations = [], risks = [], lastUpdateDate = null, today, staleUpdateDays = 7 }) {
  const kind = statusKind(project.status);
  const reasons = [];
  const missing = forecast?.missing ? [...forecast.missing] : [];
  if (kind === "done") return { key: "completed", label: "Completed", reasons, missing: [] };
  if (kind === "hold") return { key: "on_hold", label: "On hold", reasons, missing: [] };

  const open = escalations.filter((e) => e.projectId === project.id && e.status !== "resolved");
  const hot = open.filter((e) => e.severity === "high" || e.severity === "critical");
  if (hot.length) reasons.push({ code: "escalated", sev: 3, label: `Escalated — ${hot[0].severity}: ${hot[0].reason || ""}`.trim() });
  if (forecast?.overdue) reasons.push({ code: "overdue", sev: 3, label: `Committed delivery passed ${daysBetween(forecast.baseline, today)}d ago` });

  if (forecast?.forecastMiss && !forecast.overdue) reasons.push({ code: "forecastMiss", sev: 2, label: `Forecast slips ${forecast.slipDays}d past the commitment` });
  if (forecast?.overdueMilestones?.length) reasons.push({ code: "milestoneOverdue", sev: 2, label: `${forecast.overdueMilestones.length} milestone${forecast.overdueMilestones.length > 1 ? "s" : ""} overdue` });
  if (open.length && !hot.length) reasons.push({ code: "escalation", sev: 2, label: `Open escalation — ${open[0].severity}` });
  if (forecast?.blockedMilestones?.length) {
    const b = forecast.blockedMilestones[0];
    reasons.push({ code: "blocked", sev: 2, label: `Blocked: ${b.blocker || b.title}` });
  }
  risks.forEach((r) => {
    if (r.code === "stale" || r.code === "noupdate" || r.code === "nodm") reasons.push({ code: r.code, sev: r.code === "stale" ? 1 : 2, label: r.label });
  });
  if (kind === "active" && !risks.length) {
    if (!lastUpdateDate) reasons.push({ code: "noupdate", sev: 2, label: "No update ever logged" });
    else if (isISO(today) && daysBetween(lastUpdateDate, today) > staleUpdateDays) reasons.push({ code: "stale", sev: 1, label: `No update in ${daysBetween(lastUpdateDate, today)} days` });
  }

  if (reasons.some((r) => r.sev === 3)) return { key: "critical", label: "Critical", reasons, missing };
  if (reasons.some((r) => r.sev === 2)) return { key: "at_risk", label: "At risk", reasons, missing };
  if (kind === "upcoming") return { key: "upcoming", label: "Upcoming", reasons, missing };
  if (forecast?.ongoing) return { key: "on_track", label: "Ongoing", reasons, missing };
  if (!forecast?.baseline) return { key: "unknown", label: "Not set", reasons, missing: missing.length ? missing : ["committed delivery date"] };
  return { key: "on_track", label: "On track", reasons, missing };
}

export const HEALTH_ORDER = { critical: 0, at_risk: 1, unknown: 2, on_track: 3, upcoming: 4, on_hold: 5, completed: 6 };
export const HEALTH_LABEL = { critical: "Critical", at_risk: "At risk", unknown: "Not set", on_track: "On track", upcoming: "Upcoming", on_hold: "On hold", completed: "Completed" };
