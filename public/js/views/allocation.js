/* Editor Allocation & capacity planning. Hours against available hours per
   editor, the week-by-week board, who has nothing on them, and the
   reallocation flow (the assignment form shows the impact before it saves).

   Three numbers stay separate on this page: scheduled HOURS (from
   assignments — the capacity model), assumed EFFORT points (from the service
   line) and observed ACTIVITY. None is folded into another. */

import { S, esc, money, fmtDate, fmtDateFull, ago, avatar, TODAY, relDays, num, canEdit, addDays, isISO, hrs, MONTHS } from "../core.js";
import {
  filtered, editorCapacity, unassignedQueue, upcomingDeliveries, resolvedAssignments, projectById, milestoneById, personByName,
  settings, SCH, loadRollup, loadTotals, statusKind, healthOf, deliveryOf, editorsOf, forecastOf, milestonesOf, people,
} from "../compute.js";
import { filterBar, healthPill, utilPill, utilMeterBar, projectCell, notSet, viewBtn, kpi, scopeLine, prioBadge } from "./shared.js";

const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
const monday = (iso) => addDays(iso, -((dow(iso) + 6) % 7));

function windowOf() {
  const mode = S.alloc.mode || "week";
  const from = isISO(S.alloc.from) ? S.alloc.from : monday(TODAY);
  const cols = [];
  if (mode === "day") {
    for (let i = 0; i < 14; i++) { const d = addDays(from, i); cols.push({ from: d, to: d, label: `${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][dow(d)]} ${Number(d.slice(8, 10))}`, today: d === TODAY }); }
  } else {
    const weeks = S.alloc.weeks || 8;
    for (let i = 0; i < weeks; i++) { const s = addDays(monday(from), i * 7); const e = addDays(s, 6); cols.push({ from: s, to: e, label: `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`, today: TODAY >= s && TODAY <= e }); }
  }
  return { mode, from: cols[0].from, to: cols[cols.length - 1].to, cols };
}

function kpis(rows, win) {
  const available = rows.filter((r) => r.availabilityKey !== "out" && (r.util.band === "green" || r.util.band === "incomplete")).length;
  const at = rows.filter((r) => r.util.band === "amber").length;
  const over = rows.filter((r) => r.util.band === "red").length;
  const un = unassignedQueue();
  const due = upcomingDeliveries(7, filtered()).length;
  return `
    <div class="kpis">
      ${kpi({ k: "Editors", v: rows.length, n: `${rows.filter((r) => r.availabilityKey === "out").length} out` })}
      ${kpi({ k: "Available", v: available, n: `below ${Math.round((settings().utilAmber || 0.8) * 100)}% in this window`, tip: "Scheduled hours below the amber threshold, or partly estimated. Never counted as available on missing hours alone." })}
      ${kpi({ k: "At capacity", v: at, tone: at ? "warm" : "", n: `${Math.round((settings().utilAmber || 0.8) * 100)}–${Math.round((settings().utilRed || 1) * 100)}%` })}
      ${kpi({ k: "Over-allocated", v: over, tone: over ? "hot" : "", n: `above ${Math.round((settings().utilRed || 1) * 100)}%` })}
      ${kpi({ k: "Unassigned active projects", v: un.projects.length, tone: un.projects.length ? "warm" : "", n: `${un.milestones.length} open editor milestones unassigned` })}
      ${kpi({ k: "Due in 7 days", v: due, n: "deliverables and milestones", act: "goto", attrs: 'data-page="timeline" data-tab="calendar"' })}
    </div>
    <div class="muted small" style="margin:-4px 0 12px">Window ${esc(fmtDateFull(win.from))} → ${esc(fmtDateFull(win.to))} · utilisation = scheduled hours ÷ available hours · thresholds are in Settings · a "≥" means some assignments have no estimate, so the number is a floor.</div>`;
}

function matrix(rows, win) {
  const sort = S.sort.editors;
  const keyOf = { name: (r) => r.name.toLowerCase(), active: (r) => r.active, due: (r) => r.dueWeek, hours: (r) => r.util.scheduled, free: (r) => r.util.free, util: (r) => r.util.ratio ?? -1, overdue: (r) => r.overdue, next: (r) => r.next || "9999", avail: (r) => r.availabilityKey };
  const sorted = rows.slice().sort((a, b) => { const ka = keyOf[sort.key]?.(a), kb = keyOf[sort.key]?.(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * sort.dir; });
  const th = (label, key, cls = "", tip = "") => `<th class="${cls}" data-act="sort" data-table="editors" data-key="${key}">${tip ? `<span class="th-help" data-tip="${esc(tip)}">${esc(label)}</span>` : esc(label)}${sort.key === key ? `<span class="arw">${sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`;
  return `
    <section class="card" style="margin-bottom:12px">
      <div class="card-h"><h2>Editor allocation matrix</h2><span class="spacer"></span>
        <div class="hint">Hours come from assignments (Project → Team → Assign). Capacity is each editor's hours per week × availability, set on their card.</div></div>
      <div class="scroller" style="max-height:52vh"><table class="rows compact">
        <thead><tr>${th("Editor", "name")}${th("Active projects", "active", "r")}<th>DMs</th>${th("Due this window", "due", "r", "Assignments whose window ends inside the selected weeks")}${th("Scheduled hours", "hours", "r", "Σ estimated hours of assignments overlapping the window, pro-rated by working days")}${th("Available hours", "free", "r", "Capacity minus scheduled; capacity = hours/week × working days × availability")}${th("Utilisation", "util", "", "Scheduled ÷ capacity. Green below amber, amber up to red, red above. Grey = some assignments have no estimate.")}${th("Overdue", "overdue", "r", "Assignments whose window ended before today and are not done")}${th("Next deadline", "next")}${th("Availability", "avail")}<th></th></tr></thead>
        <tbody>${sorted.map((r) => `
          <tr class="clickable ${r.util.band === "red" ? "crit" : r.util.band === "amber" ? "warn" : ""}" data-act="open-person" data-name="${esc(r.name)}">
            <td><div class="cell-name">${avatar(r.name, "sm")} ${esc(r.name)}</div>${!r.person.capacityHoursPerWeek ? `<div class="cell-sub" style="color:var(--warn-ink)">hours/week not set — using ${settings().capacityHoursPerWeek || 40}</div>` : ""}</td>
            <td class="r num">${r.active}</td>
            <td>${r.dms.length ? esc(r.dms.slice(0, 3).join(", ")) + (r.dms.length > 3 ? ` +${r.dms.length - 3}` : "") : '<span class="muted">—</span>'}</td>
            <td class="r num">${r.dueWeek}</td>
            <td class="r num">${r.util.scheduled}h${r.util.unestimated.length ? `<div class="cell-sub" style="color:var(--warn-ink)">${r.util.unestimated.length} unestimated</div>` : ""}</td>
            <td class="r num">${r.util.free}h<div class="cell-sub">of ${r.util.capacity}h</div></td>
            <td style="min-width:150px">${utilPill(r.util)}<div style="margin-top:4px">${utilMeterBar(r.util)}</div></td>
            <td class="r num ${r.overdue ? "" : "muted"}" style="${r.overdue ? "color:var(--crit-ink);font-weight:600" : ""}">${r.overdue}</td>
            <td class="num">${r.next ? esc(fmtDate(r.next)) : '<span class="muted">—</span>'}</td>
            <td><span class="status ${r.availabilityKey === "out" ? "hold" : r.availabilityKey === "limited" ? "watch" : "active"}"><span class="ic">●</span>${esc(r.availability)}</span><div class="cell-sub">${esc(r.status)}</div></td>
            <td class="r">${canEdit() ? `<button class="btn xs" data-act="open-assign-editor" data-editor="${esc(r.name)}" data-prevent>Assign</button>` : ""}</td>
          </tr>`).join("") || `<tr><td colspan="11"><div class="empty">No editors on the roster yet. Add one from a project's Team tab.</div></td></tr>`}</tbody>
      </table></div>
    </section>`;
}

function board(rows, win) {
  const resolved = resolvedAssignments().filter((a) => a.status !== "done");
  const set = settings();
  const cal = SCH.calendar(set);
  const list = filtered();
  const ids = new Set(list.map((p) => p.id));
  return `
    <section class="card" style="margin-bottom:12px">
      <div class="card-h">
        <h2>Assignment board</h2>
        <div class="seg"><button data-act="alloc-mode" data-mode="week" aria-pressed="${win.mode === "week"}">Weeks</button><button data-act="alloc-mode" data-mode="day" aria-pressed="${win.mode === "day"}">Days</button></div>
        <button class="btn sm ghost" data-act="alloc-nav" data-dir="-1">‹</button><button class="btn sm ghost" data-act="alloc-nav" data-dir="0">This week</button><button class="btn sm ghost" data-act="alloc-nav" data-dir="1">›</button>
        <span class="spacer"></span>
        <span class="legend" style="margin:0"><span><i class="dot" style="background:var(--accent)"></i>pinned dates</span><span><i class="dot" style="background:var(--accent);opacity:.5"></i>follows the milestone</span><span><i class="dot" style="background:var(--neutral)"></i>no hours</span></span>
        <div class="hint">A cell goes amber or red when the hours in it exceed that period's capacity. Click a block to reassign it.</div></div>
      <div class="card-b flush"><div class="scroller"><div class="board" style="--cols:${win.cols.length}">
        <div class="bh bl">Editor</div>${win.cols.map((c) => `<div class="bh ${c.today ? "today" : ""}">${esc(c.label)}</div>`).join("")}
        ${rows.map((r) => {
          const mine = resolved.filter((a) => a.editor === r.name && (ids.has(a.projectId) || !list.length));
          const perDay = (Number(r.person.capacityHoursPerWeek) > 0 ? Number(r.person.capacityHoursPerWeek) : (set.capacityHoursPerWeek || 40)) / cal.workingDays.length;
          return `<div class="bl">${avatar(r.name, "sm")} ${esc(r.name)}<small>${r.active} active · ${utilPill(r.util)}</small></div>` + win.cols.map((c) => {
            const inCol = mine.filter((a) => a.start && a.end && a.start <= c.to && a.end >= c.from);
            let hours = 0, cap = 0;
            for (let d = c.from; d <= c.to; d = addDays(d, 1)) { if (!SCH.isWorkingDay(d, cal)) continue; cap += perDay * (r.person.availability?.status === "out" && (!r.person.availability.until || d <= r.person.availability.until) ? 0 : r.person.availability?.status === "limited" && (!r.person.availability.until || d <= r.person.availability.until) ? (Number(r.person.availability.fraction) || 0.5) : 1); }
            inCol.forEach((a) => SCH.spreadHours(a, cal).forEach((h, d) => { if (d >= c.from && d <= c.to) hours += h; }));
            const unest = inCol.filter((a) => !(Number(a.estimatedHours) > 0)).length;
            const over = hours > cap + 1e-9, near = !over && cap > 0 && hours / cap >= (set.utilAmber || 0.8);
            return `<div class="bc ${over ? "over" : near ? "near" : ""}">
              ${inCol.map((a) => { const p = projectById(a.projectId); const m = a.milestoneId ? milestoneById(a.milestoneId) : null; return `
                <div class="blk ${a.derived ? "derived" : ""} ${!(Number(a.estimatedHours) > 0) ? "nohours" : ""}" data-act="open-assign" data-id="${esc(a.projectId)}" data-assignment="${esc(a.id)}" data-tip="${esc(`${p?.label || a.projectId}${m ? " · " + m.title : ""} · ${a.start ? fmtDate(a.start) + " → " + fmtDate(a.end) : "no window"} · ${a.estimatedHours > 0 ? a.estimatedHours + "h" : "no estimate"}`)}">
                  <b>${esc(p?.client || a.projectId)}</b><small>${esc(m ? m.title : "whole project")} · due ${esc(fmtDate(a.end))}</small></div>`; }).join("")}
              ${cap > 0 || hours > 0 ? `<div class="cap ${over ? "over" : ""}">${num(hours, 0)}/${num(cap, 0)}h${unest ? ` · ${unest}?` : ""}</div>` : ""}
            </div>`;
          }).join("");
        }).join("")}
      </div></div></div>
    </section>`;
}

function queue() {
  const un = unassignedQueue();
  const list = filtered();
  const ids = new Set(list.map((p) => p.id));
  const projs = un.projects.filter((p) => ids.has(p.id));
  const ms = un.milestones.filter((x) => ids.has(x.p.id));
  return `
    <section class="card" style="margin-bottom:12px">
      <div class="card-h"><h2>Unassigned work queue</h2><span class="chip ${projs.length + ms.length ? "on" : "ring"}">${projs.length + ms.length}</span>
        <div class="hint">Active projects with no editor, and open editor-owned milestones with nobody on them. Nothing here should sit for long.</div></div>
      ${projs.length || ms.length ? `<div class="scroller" style="max-height:40vh"><table class="rows compact"><thead><tr><th>Project</th><th>Work</th><th>DM</th><th>Due</th><th>Health</th><th></th></tr></thead><tbody>
        ${projs.map((p) => `<tr><td>${projectCell(p)}</td><td><span class="muted">whole project — no editor</span></td><td>${esc(p.primaryDm || "—")}</td><td class="num">${deliveryOf(p).forecast ? esc(fmtDate(deliveryOf(p).forecast)) : notSet()}</td><td>${healthPill(p, true)}</td><td class="r">${canEdit() ? `<button class="btn xs primary" data-act="open-assign" data-id="${esc(p.id)}">Assign</button>` : ""} ${viewBtn(p, "Open")}</td></tr>`).join("")}
        ${ms.map(({ m, p }) => { const fm = forecastOf(p).milestones.get(m.id); return `<tr><td>${projectCell(p)}</td><td>${esc(m.title)}<div class="cell-sub">${m.durationDays ? m.durationDays + " working days" : "duration not set"}</div></td><td>${esc(p.primaryDm || "—")}</td><td class="num">${fm?.forecast ? esc(fmtDate(fm.forecast)) : notSet()}</td><td>${healthPill(p, true)}</td><td class="r">${canEdit() ? `<button class="btn xs primary" data-act="open-assign" data-id="${esc(p.id)}" data-milestone="${esc(m.id)}">Assign</button>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty"><div class="big">✓ Everything active has someone on it</div></div>`}
    </section>`;
}

function assumedLoad() {
  const rows = loadRollup("editorLeads");
  const cap = settings().capacityPerEditor || 10;
  const t = loadTotals();
  return `
    <section class="card">
      <div class="card-h"><h2>Assumed load (project slots and effort points)</h2><span class="spacer"></span><span class="chip ring">${t.assumed} of ${t.assumed + t.set} projects on the default weight</span>
        <div class="hint">The older, hour-free view: live project count against the slot ceiling of ${cap}, and assumed effort points from the service line. Kept beside the hours, never blended into them — when the two disagree, that is the signal.</div></div>
      <div class="card-b"><div class="scroller"><table class="rows compact"><thead><tr><th>Editor</th><th class="r">Live projects</th><th>Against ${cap} slots</th><th class="r">Effort points</th><th class="r">Updates (60d)</th><th>Biggest project</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="clickable" data-act="open-person" data-name="${esc(r.name)}"><td>${avatar(r.name, "sm")} ${esc(r.name)}</td><td class="r num">${r.live}</td><td style="min-width:140px"><div class="meter"><i class="${r.live > cap ? "red" : r.live > cap * 0.85 ? "amber" : ""}" style="width:${Math.min(100, (r.live / cap) * 100)}%"></i></div></td><td class="r num">${num(r.points, 1)}</td><td class="r num">${num(r.activity, 0)}</td><td class="cell-sub">${r.top ? esc(r.top.p.label) : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No editors named on projects.</td></tr>`}
      </tbody></table></div></div>
    </section>`;
}

export function renderAllocation() {
  const win = windowOf();
  const rows = editorCapacity(win.from, win.to);
  return `<div class="page">
    <div class="head"><div><h1>Editor allocation</h1><div class="lede">Distribute work without overloading anyone, and see the bottleneck before it bites. ${esc(scopeLine(filtered()))}.</div></div>
      <div class="head-actions">${canEdit() ? `<button class="btn sm primary" data-act="open-assign-pick">Assign work</button>` : ""}<button class="btn sm" data-act="export">Export</button></div></div>
    ${filterBar({ keys: ["category", "dm", "client", "priority"] })}
    ${kpis(rows, win)}
    ${matrix(rows, win)}
    ${board(rows, win)}
    ${queue()}
    ${assumedLoad()}
  </div>`;
}
