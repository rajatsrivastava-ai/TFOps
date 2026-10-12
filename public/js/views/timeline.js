/* Project Timeline & delivery planner — list, calendar, gantt, and the
   escalation queue. The calendar is where dates get dragged; the engine
   shows the downstream impact before anything is saved. */

import { S, esc, money, fmtDate, fmtDateFull, ago, avatar, TODAY, relDays, num, canEdit, addDays, isISO, MONTHS, WEEKDAYS } from "../core.js";
import {
  filtered, forecastOf, deliveryOf, healthOf, milestonesOf, shareOf, lastUpdate, openEscalations, escalationQueue, escalations,
  calendarEvents, timelineRows, timelineExtent, statusKind, risksOf, editorsOf, PRIO_ORDER, HEALTH_ORDER, QUICK_LABELS, escalationScore,
  projectById, SEV_ORDER, settings,
} from "../compute.js";
import { filterBar, quickChips, healthPill, prioBadge, statusPill, sevPill, escStatus, deliveryCell, daysCell, lastUpdateCell, projectCell, people, notSet, viewBtn, scopeLine, msStatusLabel, slipTag, dateOr, escBadge, kpi } from "./shared.js";

const DAY = 86400000;
const d2n = (iso) => Date.parse(iso + "T00:00:00Z");
const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
const monday = (iso) => addDays(iso, -((dow(iso) + 6) % 7));

/* ------------------------------------------------------------------ list */

const COLS = [
  { key: "priority", label: "Priority", get: (p) => PRIO_ORDER[p.priority || ""] },
  { key: "project", label: "Project / client", get: (p) => p.label.toLowerCase() },
  { key: "dm", label: "DM", get: (p) => (p.primaryDm || "").toLowerCase() },
  { key: "sdm", label: "SDM", get: (p) => (p.sdm || "").toLowerCase() },
  { key: "status", label: "Status", get: (p) => HEALTH_ORDER[healthOf(p).key] },
  { key: "current", label: "Current milestone", sort: false },
  { key: "next", label: "Next milestone", get: (p) => { const f = forecastOf(p); return (f.next && f.milestones.get(f.next.id)?.forecast) || "9999"; } },
  { key: "committed", label: "Committed delivery", get: (p) => deliveryOf(p).baselineOriginal || "9999", tip: "The original client commitment. If it was moved with a reason, the current committed date is shown underneath." },
  { key: "forecast", label: "Forecast delivery", get: (p) => deliveryOf(p).forecast || "9999" },
  { key: "days", label: "Days", get: (p) => deliveryOf(p).daysRemaining ?? 9999, right: true },
  { key: "esc", label: "Escalation", get: (p) => -openEscalations(p).length },
  { key: "editor", label: "Editor", sort: false },
  { key: "update", label: "Last update", get: (p) => lastUpdate(p)?.date || "" },
];

function chainRow(p, m) {
  const f = forecastOf(p);
  const fm = f.milestones.get(m.id) || {};
  const deps = (m.dependsOn || []).map((id) => milestonesOf(p).find((z) => z.id === id)?.title).filter(Boolean);
  return `
    <div class="ms">
      <span class="st ${fm.done ? "done" : fm.blocked ? "blocked" : fm.overdue ? "late" : m.status}"></span>
      <span class="t">${esc(m.title)}<small>${esc(m.owner || m.ownerType || "")}${deps.length ? ` · after ${esc(deps.join(", "))}` : ""}${m.blocker ? ` · <span style="color:var(--crit-ink)">${esc(m.blocker)}</span>` : ""}</small></span>
      <span class="d">${dateOr(fm.baseline, "no date")}<small>committed</small></span>
      <span class="d">${fm.done ? dateOr(m.actualDone) : dateOr(fm.forecast, "—")}<small>${fm.done ? "done" : "forecast"}</small></span>
      ${slipTag(fm.slipDays)}
      <span class="acts"><span class="chip">${esc(msStatusLabel[m.status] || m.status)}</span></span>
    </div>`;
}

function listView(list) {
  const sort = S.sort.list;
  const col = COLS.find((c) => c.key === sort.key) || COLS[6];
  const rows = list.slice().sort((a, b) => { const va = col.get ? col.get(a) : 0, vb = col.get ? col.get(b) : 0; if (va < vb) return -sort.dir; if (va > vb) return sort.dir; return a.label.localeCompare(b.label); });
  const head = COLS.map((c) => c.sort === false ? `<th>${esc(c.label)}</th>` : `<th data-act="sort" data-table="list" data-key="${c.key}" class="${c.right ? "r" : ""}">${c.tip ? `<span class="th-help" data-tip="${esc(c.tip)}">${esc(c.label)}</span>` : esc(c.label)}${sort.key === c.key ? `<span class="arw">${sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("");
  const expanded = S.timeline.expanded || new Set();
  return `
    ${quickChips(["today", "next7", "overdue", "atrisk", "escalated", "waitclient", "waitinternal", "hold"])}
    <section class="card"><div class="scroller" style="max-height:70vh"><table class="rows">
      <thead><tr><th style="width:28px"></th>${head}<th></th></tr></thead>
      <tbody>${rows.map((p) => {
        const f = forecastOf(p), d = deliveryOf(p), h = healthOf(p).key;
        const cur = f.current, next = f.next;
        const nextDate = next ? f.milestones.get(next.id)?.forecast : null;
        const esc0 = openEscalations(p);
        const open = expanded.has(p.id);
        const ms = milestonesOf(p);
        return `
          <tr class="clickable ${h === "critical" ? "crit" : h === "at_risk" ? "warn" : ""}" data-act="open-project" data-id="${esc(p.id)}">
            <td><button class="exp-btn" data-act="tl-expand" data-id="${esc(p.id)}" aria-expanded="${open}" data-prevent aria-label="Show milestones">▸</button></td>
            <td>${prioBadge(p.priority)}</td>
            <td>${projectCell(p)}</td>
            <td>${p.primaryDm ? `${avatar(p.primaryDm, "sm")} ${esc(p.primaryDm)}` : notSet("No DM")}</td>
            <td>${esc(p.sdm || "—")}</td>
            <td>${healthPill(p, true)}<div class="cell-sub">${esc(p.status)}</div></td>
            <td>${cur ? `${esc(cur.title)}<div class="cell-sub">${esc(msStatusLabel[cur.status] || "")}</div>` : notSet("No milestones")}</td>
            <td>${next ? `${esc(next.title)}<div class="cell-sub num">${nextDate ? esc(fmtDate(nextDate)) : "no date"}</div>` : "—"}</td>
            <td class="num">${d.baselineOriginal ? esc(fmtDate(d.baselineOriginal)) : d.ongoing ? '<span class="muted">ongoing</span>' : notSet()}${d.baseline && d.baseline !== d.baselineOriginal ? `<div class="cell-sub">now ${esc(fmtDate(d.baseline))}</div>` : ""}</td>
            <td class="num" style="${d.forecastMiss ? "color:var(--crit-ink);font-weight:500" : ""}">${d.forecast ? esc(fmtDate(d.forecast)) : d.ongoing ? "—" : notSet()}${d.slipDays ? `<div class="cell-sub">${d.slipDays > 0 ? "+" : ""}${d.slipDays}d</div>` : ""}</td>
            <td class="r">${daysCell(p)}</td>
            <td>${esc0.length ? escBadge(p) : '<span class="muted">—</span>'}</td>
            <td>${editorsOf(p).length ? people(editorsOf(p)) : notSet("None")}</td>
            <td>${lastUpdateCell(p)}</td>
            <td class="r">${viewBtn(p, "Open")}</td>
          </tr>
          ${open ? `<tr class="expander"><td colspan="15">${ms.length ? `<div class="chain">${ms.map((m) => chainRow(p, m)).join("")}</div>` : `<div class="muted small">No milestones on this project.${canEdit() ? ` <button class="btn xs" data-act="open-project" data-id="${esc(p.id)}" data-tab="milestones">Add a chain</button>` : ""}</div>`}</td></tr>` : ""}`;
      }).join("") || `<tr><td colspan="15"><div class="empty">Nothing matches those filters.</div></td></tr>`}</tbody>
    </table></div></section>`;
}

/* -------------------------------------------------------------- calendar */

function calendarView(list) {
  const mode = S.timeline.cal || "month";
  let from = S.timeline.calFrom || "";
  if (!isISO(from)) from = mode === "week" ? monday(TODAY) : TODAY.slice(0, 8) + "01";
  let first, last, cells;
  if (mode === "week") {
    first = monday(from); last = addDays(first, 6);
    cells = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  } else {
    const m0 = from.slice(0, 8) + "01";
    first = monday(m0);
    const nextMonth = new Date(d2n(m0)); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const lastOfMonth = addDays(nextMonth.toISOString().slice(0, 10), -1);
    last = addDays(monday(lastOfMonth), 6);
    cells = []; for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d);
  }
  const events = calendarEvents(first, last, list);
  const byDay = {};
  events.forEach((e) => { (byDay[e.date] ||= []).push(e); });
  const month = mode === "week" ? first : from.slice(0, 8) + "01";
  const title = mode === "week" ? `${fmtDateFull(first)} → ${fmtDateFull(last)}` : `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  const limit = mode === "week" ? 40 : 4;

  const ev = (e) => `
    <div class="ev ${e.kind} ${e.health.key} ${e.escalated ? "escalated" : ""} ${e.done ? "done" : ""}" draggable="${canEdit() && !e.done ? "true" : "false"}"
         data-ev="${esc(e.id)}" data-act="open-project" data-id="${esc(e.p.id)}" data-tab="milestones"
         data-tip="${esc(`${e.p.label} — ${e.title}${e.baseline && e.baseline !== e.date ? ` (committed ${fmtDate(e.baseline)})` : ""} · DM ${e.p.primaryDm || "—"} · ${e.health.label}`)}">
      <b>${e.kind === "final" ? "◆ " : ""}${esc(e.p.client)}${e.p.projectName ? ` · ${esc(e.p.projectName)}` : ""}</b>
      <small>${esc(e.title)} · ${esc(e.p.primaryDm || "—")}${editorsOf(e.p).length ? ` · ${esc(editorsOf(e.p)[0])}` : ""}</small>
    </div>`;

  return `
    <section class="card">
      <div class="card-h cal-h">
        <div class="seg"><button data-act="cal-mode" data-mode="week" aria-pressed="${mode === "week"}">Week</button><button data-act="cal-mode" data-mode="month" aria-pressed="${mode === "month"}">Month</button></div>
        <button class="btn sm ghost" data-act="cal-nav" data-dir="-1">‹</button>
        <button class="btn sm ghost" data-act="cal-nav" data-dir="0">Today</button>
        <button class="btn sm ghost" data-act="cal-nav" data-dir="1">›</button>
        <h2 style="margin-left:4px">${esc(title)}</h2>
        <span class="spacer"></span>
        <span class="legend" style="margin:0">
          <span><i class="dot" style="background:var(--surface-ink)"></i>◆ final delivery</span>
          <span><i class="dot" style="background:var(--good)"></i>on track</span><span><i class="dot" style="background:var(--warn)"></i>at risk</span><span><i class="dot" style="background:var(--crit)"></i>critical</span>
          <span><i class="dot" style="background:transparent;box-shadow:inset 0 0 0 1.5px var(--crit)"></i>escalated</span>
        </span>
        <div class="hint">${canEdit() ? "Drag a milestone to another day to reschedule it — you see the downstream impact before it saves. " : ""}Click an event to open the project.</div>
      </div>
      <div class="card-b flush">
        <div class="cal ${mode}">
          ${WEEKDAYS.slice(1).concat(WEEKDAYS[0]).map((d) => `<div class="dow">${d}</div>`).join("")}
          ${cells.map((d) => {
            const list = byDay[d] || [];
            const out = mode === "month" && d.slice(0, 7) !== month.slice(0, 7);
            return `<div class="day ${out ? "out" : ""} ${d === TODAY ? "today" : ""}" data-day="${d}">
              <div class="dn"><span>${Number(d.slice(8, 10))}${d.slice(8, 10) === "01" ? ` ${MONTHS[Number(d.slice(5, 7)) - 1]}` : ""}</span>${list.length ? `<span class="muted">${list.length}</span>` : ""}</div>
              ${list.slice(0, limit).map(ev).join("")}
              ${list.length > limit ? `<button class="ev more btn xs ghost" data-act="cal-day" data-day="${d}" style="border:0">+${list.length - limit} more</button>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>
    </section>`;
}

/* ----------------------------------------------------------------- gantt */

const GROUPERS = {
  dm:     { label: "DM", of: (p) => p.primaryDm || (p.dms || [])[0] || "(no DM)" },
  client: { label: "Client", of: (p) => p.client },
  sdm:    { label: "SDM", of: (p) => p.sdm || "(no SDM)" },
  editor: { label: "Editor", of: (p) => editorsOf(p)[0] || "(no editor)" },
  health: { label: "Health", of: (p) => healthOf(p).label },
  none:   { label: "No grouping", of: () => "All projects" },
};
const STATUS_COLOUR = { active: "var(--s3)", hold: "var(--neutral)", upcoming: "var(--s1)", done: "var(--track)" };
const WINDOWS = { "3m": 3, "6m": 6, "12m": 12 };

function windowFor(key, ext) {
  if (key === "all" || !WINDOWS[key]) return ext;
  const start = new Date(TODAY + "T00:00:00Z"); start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + WINDOWS[key]);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
function axisMonths(from, to) {
  const out = []; const cur = new Date(from + "T00:00:00Z"); cur.setUTCDate(1); const end = d2n(to);
  while (cur.getTime() <= end) {
    const next = new Date(cur); next.setUTCMonth(next.getUTCMonth() + 1);
    out.push({ iso: cur.toISOString().slice(0, 10), m: cur.getUTCMonth(), y: cur.getUTCFullYear(), quarterStart: cur.getUTCMonth() % 3 === 0 });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

function ganttView(list) {
  const rows = timelineRows(list);
  const placed = rows.filter((r) => r.start), undated = rows.filter((r) => !r.start);
  const ext = placed.length ? timelineExtent(placed) : { from: TODAY.slice(0, 8) + "01", to: TODAY.slice(0, 8) + "28" };
  const { from, to } = windowFor(S.timeline.window, ext);
  const span = Math.max(DAY, d2n(to) - d2n(from));
  const months = axisMonths(from, to);
  const pxPerMonth = S.timeline.zoom === "month" ? 180 : S.timeline.zoom === "quarter" ? 96 : 54;
  const trackW = months.length * pxPerMonth;
  const intersects = (r) => { if (!r.start) return false; const s = d2n(r.start); const e = r.open ? Infinity : d2n(r.end || r.start) + DAY; return e > d2n(from) && s < d2n(to); };
  const visible = placed.filter(intersects);
  const grouper = GROUPERS[S.timeline.group] || GROUPERS.dm;
  const groups = {};
  visible.forEach((r) => { (groups[grouper.of(r.p)] ||= []).push(r); });
  const ordered = Object.entries(groups).map(([name, items]) => ({ name, items: items.sort((a, b) => (a.start < b.start ? -1 : 1)), rev: items.reduce((s, r) => s + shareOf(r.p), 0) })).sort((a, b) => b.rev - a.rev);
  const x = (iso) => ((d2n(iso) - d2n(from)) / span) * 100;
  const todayX = x(TODAY);
  const vlines = months.map((m) => { const px = x(m.iso); return px >= 0 && px <= 100 ? `<span class="vline ${m.quarterStart ? "q" : ""}" style="left:${px}%"></span>` : ""; }).join("");

  const bar = (r) => {
    const { p } = r;
    const kind = statusKind(p.status);
    const h = healthOf(p).key;
    const colour = h === "critical" ? "var(--crit)" : h === "at_risk" ? "var(--warn)" : STATUS_COLOUR[kind] || "var(--s1)";
    const s = Math.max(d2n(from), d2n(r.start));
    const e = r.open ? d2n(to) : Math.max(s + DAY * 2, d2n(r.end || r.start) + DAY);
    const left = ((s - d2n(from)) / span) * 100, width = Math.max(0.6, ((Math.min(e, d2n(to)) - s) / span) * 100);
    const f = r.forecast;
    const tip = esc(`<div class="t-t">${esc(p.label)}</div>` + [["Health", healthOf(p).label], ["Start", r.start ? fmtDateFull(r.start) : "—"], ["Committed", f.baseline ? fmtDateFull(f.baseline) : r.open ? "ongoing" : "not set"], ["Forecast", f.forecast ? fmtDateFull(f.forecast) : "—"], ["DM", p.primaryDm || "—"]].map((q) => `<div class="t-r"><span>${esc(q[0])}</span><b>${esc(q[1])}</b></div>`).join(""));
    const marks = r.milestones.map((m) => {
      const fm = f.milestones.get(m.id);
      const parts = [];
      if (fm?.baseline) { const px = x(fm.baseline); if (px >= 0 && px <= 100) parts.push(`<span class="gmile ${fm.done ? "done" : fm.overdue ? "late" : ""}" style="left:${px}%" data-tip="${esc(`${m.title} · committed ${fmtDateFull(fm.baseline)}${fm.done ? " · done" : fm.overdue ? " · overdue" : ""}`)}"></span>`); }
      if (fm?.forecast && fm.forecast !== fm.baseline && !fm.done) { const px = x(fm.forecast); if (px >= 0 && px <= 100) parts.push(`<span class="gmile fc" style="left:${px}%" data-tip="${esc(`${m.title} · forecast ${fmtDateFull(fm.forecast)}`)}"></span>`); }
      return parts.join("");
    }).join("");
    const fcMark = f.forecast && f.baseline && f.forecast !== f.baseline && x(f.forecast) >= 0 && x(f.forecast) <= 100 ? `<span class="gmile fc" style="left:${x(f.forecast)}%;border-color:var(--crit)" data-tip="${esc(`Forecast delivery ${fmtDateFull(f.forecast)}`)}"></span>` : "";
    if (r.inferred && !r.open) return `<span class="gpoint" style="left:${left}%" data-act="open-project" data-id="${esc(p.id)}" data-tip="${tip}"><i style="background:${colour}"></i><span class="glabel">${esc(p.projectName || p.client)}</span></span>${marks}${fcMark}`;
    return `<span class="gbar ${r.open ? "open" : ""}" style="left:${left}%;width:${width}%;background:${colour};color:${colour}" data-act="open-project" data-id="${esc(p.id)}" data-tip="${tip}"><span class="glabel">${width > 8 ? esc(p.projectName || p.client) : ""}</span></span>${marks}${fcMark}`;
  };

  const body = ordered.map((g) => `
    <div class="gantt-row group"><div class="lane"><span class="lane-txt">${esc(g.name)}</span><span class="chip" style="margin-left:auto">${g.items.length}</span></div><div class="gantt-track">${vlines}</div></div>
    ${g.items.map((r) => `<div class="gantt-row"><div class="lane" data-act="open-project" data-id="${esc(r.p.id)}" style="cursor:pointer">${healthPill(r.p, true)}<span class="lane-txt" title="${esc(r.p.label)}">${esc(r.p.projectName || r.p.client)}</span></div><div class="gantt-track">${vlines}${bar(r)}</div></div>`).join("")}`).join("");

  return `
    <section class="card">
      <div class="card-h">
        <h2>${esc(fmtDateFull(from))} → ${esc(fmtDateFull(to))}</h2>
        <span class="spacer"></span>
        <div class="seg">${[["3m", "3 mo"], ["6m", "6 mo"], ["12m", "12 mo"], ["all", "Fit all"]].map(([k, l]) => `<button data-act="tl-window" data-window="${k}" aria-pressed="${S.timeline.window === k}">${l}</button>`).join("")}</div>
        <div class="seg">${["month", "quarter", "year"].map((z) => `<button data-act="tl-zoom" data-zoom="${z}" aria-pressed="${S.timeline.zoom === z}">${z[0].toUpperCase() + z.slice(1)}</button>`).join("")}</div>
        <select data-change="tl-group" style="width:auto">${Object.entries(GROUPERS).map(([k, g]) => `<option value="${k}" ${S.timeline.group === k ? "selected" : ""}>Group by ${esc(g.label.toLowerCase())}</option>`).join("")}</select>
        <div class="hint">Bars coloured by health; ◆ committed milestones, ◇ forecasts that moved; the violet line is today. ${undated.length} projects have no dates and are listed below.</div>
      </div>
      <div class="card-b flush"><div class="gantt" style="--lane:230px"><div class="gantt-scroll"><div class="gantt-grid" style="min-width:${trackW + 230}px">
        <div class="gantt-head"><div class="lane-h">${esc(grouper.label)} · project</div><div class="gantt-months">${months.map((m, i) => `<div class="m ${m.quarterStart ? "q" : ""}" style="width:${pxPerMonth}px;flex:0 0 ${pxPerMonth}px">${MONTHS[m.m]}${i === 0 || m.m === 0 ? ` <span class="muted">’${String(m.y).slice(2)}</span>` : ""}</div>`).join("")}</div></div>
        <div style="position:relative">${todayX >= 0 && todayX <= 100 ? `<div class="today-line" style="left:calc(230px + (100% - 230px) * ${todayX / 100})"></div>` : ""}${body || `<div class="empty">Nothing with dates matches those filters.</div>`}</div>
      </div></div></div></div>
    </section>
    ${undated.length ? `<section class="card" style="margin-top:12px"><div class="card-h"><h2>No dates yet</h2><span class="chip on">${undated.length}</span><div class="hint">Open one and put a committed delivery date or a milestone chain on it.</div></div>
      <div class="scroller" style="max-height:300px"><table class="rows compact"><thead><tr><th>Project</th><th>DM</th><th>Health</th><th>What the sheet said</th></tr></thead><tbody>
        ${undated.map((r) => `<tr class="clickable" data-act="open-project" data-id="${esc(r.p.id)}"><td>${esc(r.p.label)}</td><td>${esc(r.p.primaryDm || "—")}</td><td>${healthPill(r.p, true)}</td><td>${[r.p.startNote, r.p.endNote].filter(Boolean).join(" → ") ? `<span class="sheetnote">✎ ${esc([r.p.startNote, r.p.endNote].filter(Boolean).join(" → "))}</span>` : '<span class="muted">blank</span>'}</td></tr>`).join("")}
      </tbody></table></div></section>` : ""}`;
}

/* ----------------------------------------------------------- escalations */

function escalationsView(list) {
  const q = escalationQueue(list);
  const open = q.filter((x) => x.e.status !== "resolved");
  const hot = open.filter((x) => x.e.severity === "high" || x.e.severity === "critical");
  const late = open.filter((x) => x.late);
  const monthAgo = addDays(TODAY, -30);
  const resolved = q.filter((x) => x.e.status === "resolved" && (x.e.resolvedAt || "").slice(0, 10) >= monthAgo);
  // Projects the numbers say should be escalated but nobody has raised.
  const suggested = list.filter((p) => statusKind(p.status) === "active" && !openEscalations(p).length && (healthOf(p).key === "critical" || escalationScore(p) >= 24))
    .map((p) => ({ p, s: escalationScore(p) })).sort((a, b) => b.s - a.s).slice(0, 8);

  return `
    <div class="kpis">
      ${kpi({ k: "Open escalations", v: open.length, tone: open.length ? "hot" : "", n: `${hot.length} high or critical` })}
      ${kpi({ k: "Past their deadline", v: late.length, tone: late.length ? "warm" : "", n: "resolution target passed" })}
      ${kpi({ k: "Average age", v: open.length ? Math.round(open.reduce((s, x) => s + x.age, 0) / open.length) : "—", n: "days open" })}
      ${kpi({ k: "Resolved, last 30 days", v: resolved.length })}
    </div>
    <section class="card" style="margin-bottom:12px">
      <div class="card-h"><h2>Escalation queue</h2><span class="chip ${open.length ? "on" : "ring"}">${open.length} open</span><span class="spacer"></span>
        <div class="hint">Raised by a DM or from a daily update. Highest severity first, then oldest. Click a row to comment, reassign or resolve.</div></div>
      <div class="scroller" style="max-height:60vh"><table class="rows">
        <thead><tr><th>Client / project</th><th>Reason</th><th>Severity</th><th>Owner</th><th>Raised</th><th>Deadline</th><th>Current blocker</th><th>Next action</th><th class="r">Age</th><th>Status</th><th></th></tr></thead>
        <tbody>${q.map(({ e, p, age, late }) => `
          <tr class="clickable ${e.status !== "resolved" && (e.severity === "critical" || late) ? "crit" : e.status !== "resolved" ? "warn" : ""}" data-act="open-escalation" data-id="${esc(p.id)}" data-escalation="${esc(e.id)}">
            <td>${projectCell(p)}</td>
            <td><div class="cell-sub wrap" style="color:var(--ink)">${esc(e.reason)}</div></td>
            <td>${sevPill(e.severity)}</td>
            <td>${e.owner ? `${avatar(e.owner, "sm")} ${esc(e.owner)}` : notSet("Unassigned")}</td>
            <td class="num">${esc(fmtDate(e.raisedOn))}<div class="cell-sub">${esc(e.raisedBy)}</div></td>
            <td class="num" style="${late ? "color:var(--crit-ink);font-weight:600" : ""}">${e.resolutionTarget ? esc(fmtDate(e.resolutionTarget)) : notSet()}</td>
            <td><div class="cell-sub wrap" style="color:var(--ink)">${esc(e.blocker || "—")}</div></td>
            <td><div class="cell-sub wrap" style="color:var(--ink)">${esc(e.nextAction || "—")}${e.nextActionOwner ? ` <span class="muted">· ${esc(e.nextActionOwner)}</span>` : ""}</div></td>
            <td class="r num">${e.status === "resolved" ? "—" : `${age}d`}</td>
            <td>${escStatus(e.status)}</td>
            <td class="r">${canEdit() && e.status !== "resolved" ? `<button class="btn xs" data-act="resolve-escalation-row" data-id="${esc(e.id)}" data-project="${esc(p.id)}" data-prevent>Resolve</button>` : ""}</td>
          </tr>`).join("") || `<tr><td colspan="11"><div class="empty"><div class="big">No escalations raised</div>Raise one from a project, or from the "Escalation required" box on a daily update.</div></td></tr>`}</tbody>
      </table></div>
    </section>
    ${suggested.length ? `<section class="card"><div class="card-h"><h2>Should these be escalated?</h2><span class="chip ring">${suggested.length}</span><div class="hint">Critical by the numbers — overdue, never updated, or blocked — with no escalation raised yet.</div></div>
      <div class="scroller"><table class="rows compact"><thead><tr><th>Project</th><th>Why</th><th>DM</th><th></th></tr></thead><tbody>
        ${suggested.map(({ p }) => `<tr><td>${projectCell(p)}</td><td><div class="cell-sub wrap" style="color:var(--ink)">${esc(healthOf(p).reasons.map((r) => r.label).join(" · ") || risksOf(p).map((r) => r.label).join(" · "))}</div></td><td>${esc(p.primaryDm || "—")}</td>
          <td class="r">${canEdit() ? `<button class="btn xs" data-act="open-escalation" data-id="${esc(p.id)}">Raise</button>` : ""} ${viewBtn(p, "Open")}</td></tr>`).join("")}
      </tbody></table></div></section>` : ""}`;
}

/* ------------------------------------------------------------------ page */

export function renderTimeline() {
  const list = filtered();
  const mode = S.tab || S.timeline.mode || "list";
  const views = { list: listView, calendar: calendarView, gantt: ganttView, escalations: escalationsView };
  const open = escalations().filter((e) => e.status !== "resolved").length;
  return `<div class="page">
    <div class="head"><div><h1>Project timeline</h1><div class="lede">What is due, when, what is escalated, and what is likely to slip. ${esc(scopeLine(list))}.</div></div>
      <div class="head-actions">
        <div class="seg" role="group" aria-label="View">
          ${[["list", "List"], ["calendar", "Calendar"], ["gantt", "Gantt"], ["escalations", `Escalations${open ? ` (${open})` : ""}`]].map(([k, l]) => `<button data-act="tl-mode" data-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join("")}
        </div>
        <button class="btn sm" data-act="export">Export</button>
      </div></div>
    ${filterBar({ keys: ["status", "priority", "dm", "sdm", "editor", "category", "client"] })}
    ${(views[mode] || listView)(list)}
  </div>`;
}
