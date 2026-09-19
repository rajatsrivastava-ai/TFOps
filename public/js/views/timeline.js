/* Project timeline sheet.

   Only 35 of the 97 rows arrived with a real date on them, so the undated ones
   are not hidden — they get their own bucket underneath with a prompt, because
   filling those in is the job this view exists to make easy. */

import { S, esc, money, fmtDateFull, fmtDate, num, TODAY, relDays, avatar, seriesVar } from "../core.js";
import {
  filtered, timelineRows, timelineExtent, statusKind, shareOf, risksOf,
  allOf, milestonesByProject, lastUpdate,
} from "../compute.js";

const DAY = 86400000;
const d2n = (iso) => Date.parse(iso + "T00:00:00Z");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const GROUPERS = {
  pod:    { label: "Pod", of: (p) => p.podOwner || "(no pod)" },
  client: { label: "Client", of: (p) => p.client },
  dm:     { label: "DM", of: (p) => (p.dms || [])[0] || "(no DM)" },
  editor: { label: "Editor lead", of: (p) => (p.editorLeads || [])[0] || "(no editor lead)" },
  status: { label: "Status", of: (p) => p.status || "Active" },
  none:   { label: "No grouping", of: () => "All projects" },
};

const STATUS_COLOUR = {
  active: "var(--s3)", hold: "var(--s4)", upcoming: "var(--s1)", done: "var(--track)",
};

const WINDOWS = { "3m": 3, "6m": 6, "12m": 12 };

/** The visible slice of time: a rolling window from last month, or everything. */
function windowFor(key, ext) {
  if (key === "all" || !WINDOWS[key]) return ext;
  const start = new Date(TODAY + "T00:00:00Z");
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + WINDOWS[key]);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** Does this project's span overlap the visible window at all? */
function intersects(row, from, to) {
  if (!row.start) return false;
  const s = d2n(row.start);
  const e = row.open ? Infinity : d2n(row.end || row.start) + DAY;
  return e > d2n(from) && s < d2n(to);
}

/** Month (and quarter) columns across the visible window. */
function axisMonths(from, to) {
  const out = [];
  const cur = new Date(from + "T00:00:00Z");
  cur.setUTCDate(1);
  const end = d2n(to);
  while (cur.getTime() <= end) {
    const startISO = cur.toISOString().slice(0, 10);
    const next = new Date(cur);
    next.setUTCMonth(next.getUTCMonth() + 1);
    out.push({
      iso: startISO,
      m: cur.getUTCMonth(),
      y: cur.getUTCFullYear(),
      quarterStart: cur.getUTCMonth() % 3 === 0,
      days: (Math.min(next.getTime(), end) - cur.getTime()) / DAY,
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

function bar(row, from, to, span) {
  const { p } = row;
  const kind = statusKind(p.status);
  const colour = STATUS_COLOUR[kind] || "var(--s1)";
  const risks = risksOf(p);
  const overdue = risks.some((r) => r.code === "overdue");

  if (!row.start) return "";
  if (!intersects(row, from, to)) return "";
  const s = Math.max(d2n(from), d2n(row.start));
  const e = row.open ? d2n(to) : Math.max(s + DAY * 2, d2n(row.end || row.start) + DAY);
  const left = ((s - d2n(from)) / span) * 100;
  const width = Math.max(0.6, ((Math.min(e, d2n(to)) - s) / span) * 100);

  const tipRows = [
    ["Status", p.status],
    ["Start", row.start ? fmtDateFull(row.start) : "—"],
    ["End", row.open ? "open-ended" : p.end ? fmtDateFull(p.end) : "—"],
    ["Revenue", money(shareOf(p))],
    ["DM", (p.dms || []).join(", ") || "—"],
    ["Editor lead", (p.editorLeads || []).join(", ") || "—"],
  ];
  if (row.inferred) tipRows.push(["Note", "One date was missing — inferred"]);
  if (overdue) tipRows.push(["Flag", "End date has passed"]);

  const tip = `<div class="t-t">${esc(p.label)}</div>` +
    tipRows.map((r) => `<div class="t-r"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("");

  const mstones = (row.milestones || []).map((m) => {
    if (!m.date) return "";
    const x = ((d2n(m.date) - d2n(from)) / span) * 100;
    if (x < 0 || x > 100) return "";
    const late = !m.done && d2n(m.date) < d2n(TODAY);
    return `<span class="gmile ${m.done ? "done" : late ? "late" : ""}" style="left:${x}%"
      data-tip="${esc(`<div class='t-t'>${m.title}</div><div class='t-r'><span>${fmtDateFull(m.date)}</span><b>${m.done ? "done" : late ? "late" : "planned"}</b></div>`)}"></span>`;
  }).join("");

  // A row with only one real date is a point in time, not a duration — drawing
  // it as a two-day bar would be a made-up schedule. Show a marker instead.
  if (row.inferred && !row.open) {
    return `
      <span class="gpoint" style="left:${left}%" data-act="open-project" data-id="${esc(p.id)}"
            data-tip="${esc(tip)}">
        <i style="background:${colour}"></i>
        <span class="glabel">${esc(p.projectName || p.client)}</span>
      </span>${mstones}`;
  }

  return `
    <span class="gbar ${row.open ? "open" : ""}"
          style="left:${left}%;width:${width}%;background:${colour};color:${colour}"
          data-act="open-project" data-id="${esc(p.id)}" data-tip="${esc(tip)}">
      <span class="glabel">${width > 8 ? esc(p.projectName || p.client) : ""}</span>
    </span>${mstones}`;
}

function laneCell(p) {
  const risks = risksOf(p);
  const worst = risks[0];
  return `
    <div class="lane" data-act="open-project" data-id="${esc(p.id)}" style="cursor:pointer">
      ${worst ? `<span class="dot" style="background:${worst.sev === 2 ? "var(--crit)" : "var(--warn)"}"
        data-tip="${esc(risks.map((r) => r.label).join(" · "))}"></span>`
        : `<span class="dot" style="background:var(--good);opacity:.5"></span>`}
      <span class="lane-txt" title="${esc(p.label)}">${esc(p.projectName || p.client)}</span>
    </div>`;
}

export function renderTimeline() {
  const list = filtered();
  const rows = timelineRows(list);
  const placed = rows.filter((r) => r.start);
  const undated = rows.filter((r) => !r.start);

  const ext = placed.length ? timelineExtent(placed) : { from: TODAY.slice(0, 8) + "01", to: TODAY.slice(0, 8) + "28" };
  // One 2025 project would otherwise stretch the axis across two years and
  // squash every bar, so the default window is focused on now.
  const { from, to } = windowFor(S.timeline.window, ext);
  const span = Math.max(DAY, d2n(to) - d2n(from));
  const months = axisMonths(from, to);
  const pxPerMonth = S.timeline.zoom === "month" ? 180 : S.timeline.zoom === "quarter" ? 96 : 54;
  const trackW = months.length * pxPerMonth;

  const visible = placed.filter((r) => intersects(r, from, to));
  const offWindow = placed.length - visible.length;

  const grouper = GROUPERS[S.timeline.group] || GROUPERS.pod;
  const groups = {};
  visible.forEach((r) => { (groups[grouper.of(r.p)] ||= []).push(r); });
  const ordered = Object.entries(groups)
    .map(([name, items]) => ({
      name, items: items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)),
      rev: items.reduce((s, r) => s + shareOf(r.p), 0),
    }))
    .sort((a, b) => b.rev - a.rev);

  const todayX = ((d2n(TODAY) - d2n(from)) / span) * 100;
  const inWindow = todayX >= 0 && todayX <= 100;

  // Year label only where it changes, so "Oct 26" can't be misread as a date.
  const monthHead = months.map((m, i) => `
    <div class="m ${m.quarterStart ? "q" : ""}" style="width:${pxPerMonth}px;flex:0 0 ${pxPerMonth}px">
      ${esc(MON[m.m])}${i === 0 || m.m === 0 ? ` <span class="muted">’${String(m.y).slice(2)}</span>` : ""}
    </div>`).join("");

  const vlines = months.map((m) => {
    const x = ((d2n(m.iso) - d2n(from)) / span) * 100;
    return x >= 0 && x <= 100 ? `<span class="vline ${m.quarterStart ? "q" : ""}" style="left:${x}%"></span>` : "";
  }).join("");

  const body = ordered.map((g) => `
    <div class="gantt-row group">
      <div class="lane"><span class="lane-txt">${esc(g.name)}</span>
        <span class="chip" style="margin-left:auto">${g.items.length}</span></div>
      <div class="gantt-track">${vlines}</div>
    </div>
    ${g.items.map((r) => `
      <div class="gantt-row">
        ${laneCell(r.p)}
        <div class="gantt-track">${vlines}${bar(r, from, to, span)}</div>
      </div>`).join("")}
  `).join("");

  const undatedCard = undated.length ? `
    <section class="card" style="margin-top:14px">
      <div class="card-h">
        <h2>Not on the timeline yet</h2>
        <span class="spacer"></span>
        <span class="chip on">${undated.length} projects</span>
        <div class="hint">These came off the sheet with no usable dates. Open one and put a start and end on it —
          it appears above the moment you save.</div>
      </div>
      <div class="scroller" style="max-height:340px">
        <table class="rows">
          <thead><tr><th>Project</th><th>Pod</th><th>Owner</th><th>What the sheet said</th><th class="r">Revenue</th></tr></thead>
          <tbody>
            ${undated.map((r) => {
              const p = r.p;
              const note = [p.startNote, p.endNote].filter(Boolean).join(" → ");
              return `<tr class="clickable" data-act="open-project" data-id="${esc(p.id)}">
                <td><div class="cell-name">${esc(p.label)}</div>
                    <div class="cell-sub">${esc(p.status)}${p.openEnded ? " · open-ended" : ""}</div></td>
                <td>${esc(p.podOwner || "—")}</td>
                <td>${(p.dms || []).slice(0, 2).map((d) => avatar(d, "sm")).join(" ") || "<span class='muted'>—</span>"}</td>
                <td>${note ? `<span class="sheetnote">✎ ${esc(note)}</span>` : "<span class='muted'>blank</span>"}</td>
                <td class="r num">${esc(money(shareOf(p)))}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>` : "";

  return `
    <div class="head">
      <div>
        <h1>Project timeline</h1>
        <div class="lede">${placed.length} of ${rows.length} projects are placed on dates.
          Bars are coloured by status; diamonds are milestones; the violet line is today.</div>
      </div>
      <div class="head-actions">
        <div class="seg" role="group" aria-label="Time window">
          ${[["3m", "3 mo"], ["6m", "6 mo"], ["12m", "12 mo"], ["all", "Fit all"]].map(([k, lab]) =>
            `<button data-act="tl-window" data-window="${k}" aria-pressed="${S.timeline.window === k}">${lab}</button>`).join("")}
        </div>
        <div class="seg" role="group" aria-label="Column width">
          ${["month", "quarter", "year"].map((z) =>
            `<button data-act="tl-zoom" data-zoom="${z}" aria-pressed="${S.timeline.zoom === z}">${z[0].toUpperCase() + z.slice(1)}</button>`).join("")}
        </div>
        <select data-change="tl-group" aria-label="Group by" style="width:auto">
          ${Object.entries(GROUPERS).map(([k, g]) =>
            `<option value="${k}" ${S.timeline.group === k ? "selected" : ""}>Group by ${esc(g.label.toLowerCase())}</option>`).join("")}
        </select>
      </div>
    </div>

    ${filterBar()}

    <section class="card">
      <div class="card-h">
        <h2>${esc(fmtDateFull(from))} → ${esc(fmtDateFull(to))}</h2>
        ${offWindow ? `<button class="btn sm ghost" data-act="tl-window" data-window="all"
          data-tip="Widen the window to include them">${offWindow} outside this window</button>` : ""}
        <span class="spacer"></span>
        <span class="legend" style="margin:0">
          <span><i class="dot" style="background:var(--s3)"></i>Active</span>
          <span><i class="dot" style="background:var(--s4)"></i>On hold</span>
          <span><i class="dot" style="background:var(--s1)"></i>Upcoming</span>
          <span><i class="dot" style="background:var(--track);box-shadow:0 0 0 1px var(--line-2)"></i>Date inferred</span>
        </span>
      </div>
      <div class="card-b flush">
        <div class="gantt" style="--lane:230px">
          <div class="gantt-scroll">
            <div class="gantt-grid" style="min-width:${trackW + 230}px">
              <div class="gantt-head">
                <div class="lane-h">${esc(grouper.label)} · project</div>
                <div class="gantt-months">${monthHead}</div>
              </div>
              <div style="position:relative">
                ${inWindow ? `<div class="today-line" style="left:calc(230px + (100% - 230px) * ${todayX / 100})"></div>` : ""}
                ${body || `<div class="empty">Nothing matches those filters.</div>`}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    ${undatedCard}`;
}

/* The filter row is shared with the Projects view. */
export function filterBar() {
  const f = S.filters;
  const opt = (v, cur) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(v)}</option>`;
  return `
    <div class="filters">
      <input class="grow" type="search" placeholder="Search client, scope, person…" value="${esc(f.q)}"
             data-input="filter-q" aria-label="Search projects">
      <select data-change="filter" data-key="pod" aria-label="Pod" style="width:auto">
        <option value="">All pods</option>${allOf("podOwner").map((v) => opt(v, f.pod)).join("")}
      </select>
      <select data-change="filter" data-key="status" aria-label="Status" style="width:auto">
        <option value="">Any status</option>
        <option value="active" ${f.status === "active" ? "selected" : ""}>Active</option>
        <option value="hold" ${f.status === "hold" ? "selected" : ""}>On hold</option>
        <option value="upcoming" ${f.status === "upcoming" ? "selected" : ""}>Upcoming</option>
      </select>
      <select data-change="filter" data-key="category" aria-label="Service line" style="width:auto">
        <option value="">All work types</option>${allOf("categories").map((v) => opt(v, f.category)).join("")}
      </select>
      <select data-change="filter" data-key="person" aria-label="Person" style="width:auto">
        <option value="">Anyone</option>${[...new Set([...allOf("dms"), ...allOf("editorLeads")])].sort().map((v) => opt(v, f.person)).join("")}
      </select>
      <select data-change="filter" data-key="risk" aria-label="Risk flag" style="width:auto">
        <option value="">No flag filter</option>
        <option value="any" ${f.risk === "any" ? "selected" : ""}>Any flag</option>
        <option value="overdue" ${f.risk === "overdue" ? "selected" : ""}>Overdue</option>
        <option value="stale" ${f.risk === "stale" ? "selected" : ""}>Stale update</option>
        <option value="nodates" ${f.risk === "nodates" ? "selected" : ""}>No dates</option>
        <option value="noupdate" ${f.risk === "noupdate" ? "selected" : ""}>Never updated</option>
        <option value="unmapped" ${f.risk === "unmapped" ? "selected" : ""}>Unmapped revenue</option>
      </select>
      ${Object.values(f).some(Boolean) ? `<button class="btn sm ghost" data-act="clear-filters">Clear</button>` : ""}
    </div>`;
}
