/* Small renderers every page shares: pills, badges, cells, the filter bar. */

import { S, esc, money, moneyOr, fmtDate, fmtDateFull, ago, dueIn, avatar, TODAY, relDays, num, isISO } from "../core.js";
import {
  healthOf, deliveryOf, statusKind, forecastOf, lastUpdate, staleDays, settings, shareOf, openEscalations,
  dmNames, sdmNames, clientNames, categoryNames, editorNames, allOf, activeFilterCount, QUICK_LABELS, filtered, HEALTH,
} from "../compute.js";

export const HEALTH_IC = { critical: "▲", at_risk: "●", on_track: "✓", unknown: "?", on_hold: "◷", completed: "✓", upcoming: "○" };

export const healthPill = (p, small = false) => {
  const h = healthOf(p);
  const tip = h.reasons.length ? h.reasons.map((r) => r.label).join(" · ") : h.missing?.length ? "Missing: " + h.missing.join(", ") : h.label;
  return `<span class="health ${h.key} ${small ? "small" : ""}" data-tip="${esc(tip)}"><span class="ic">${HEALTH_IC[h.key] || "●"}</span>${esc(h.label)}</span>`;
};
export const prioBadge = (prio) => prio ? `<span class="prio ${esc(prio)}">${esc(prio)}</span>` : `<span class="prio" data-tip="Priority not set">—</span>`;
export const statusPill = (status) => {
  const k = statusKind(status);
  const ic = { active: "●", hold: "◷", upcoming: "○", done: "✓" }[k];
  return `<span class="status ${k}"><span class="ic">${ic}</span>${esc(status || "Active")}</span>`;
};
export const sevPill = (sev) => `<span class="sev ${esc(sev || "medium")}">${esc(sev || "medium")}</span>`;
export const escStatus = (s) => `<span class="status ${s === "resolved" ? "done" : s === "in_progress" ? "upcoming" : "risk"}"><span class="ic">${s === "resolved" ? "✓" : "●"}</span>${esc(s === "in_progress" ? "In progress" : s === "resolved" ? "Resolved" : "Open")}</span>`;
export const msStatusLabel = { planned: "Planned", in_progress: "In progress", blocked: "Blocked", done: "Done" };

export const utilPill = (u) => {
  if (!u) return `<span class="util unknown">—</span>`;
  if (u.ratio === null) return `<span class="util unknown" data-tip="No capacity set for this person">No capacity</span>`;
  const pct = Math.round(u.ratio * 100);
  const tip = `${u.scheduled}h scheduled of ${u.capacity}h available` + (u.incomplete ? ` · ${u.unestimated.length} assignment${u.unestimated.length > 1 ? "s" : ""} without hours — this is a lower bound` : "");
  return `<span class="util ${u.band}" data-tip="${esc(tip)}">${u.incomplete ? "≥ " : ""}${pct}%</span>`;
};
export const utilMeterBar = (u) => {
  if (!u || u.ratio === null) return `<div class="meter"><i class="incomplete" style="width:100%"></i></div>`;
  return `<div class="meter"><i class="${u.band}" style="width:${Math.min(100, u.ratio * 100)}%"></i></div>`;
};

export const notSet = (label = "Not set") => `<span class="notset">${esc(label)}</span>`;
export const dateOr = (iso, blank = "Not set") => (iso ? `<span class="num">${esc(fmtDate(iso))}</span>` : notSet(blank));

/** "committed → forecast" with the slip, in one cell. */
export function deliveryCell(p, full = false) {
  const d = deliveryOf(p);
  const f = full ? fmtDateFull : fmtDate;
  if (d.ongoing) return `<span class="muted">Ongoing</span>`;
  if (!d.baseline && !d.forecast) return notSet();
  const base = d.baseline ? `<span class="num">${esc(f(d.baseline))}</span>` : notSet("no commitment");
  if (!d.forecast || d.forecast === d.baseline) return base;
  const late = d.forecast > d.baseline;
  return `${base} <span class="muted">→</span> <span class="num" style="color:${late ? "var(--crit-ink)" : "var(--good-ink)"};font-weight:500">${esc(f(d.forecast))}</span>`;
}
export function daysCell(p) {
  const d = deliveryOf(p);
  if (d.ongoing) return `<span class="muted">—</span>`;
  const ref = d.forecast || d.baseline;
  if (!ref) return notSet();
  const n = relDays(ref);
  if (d.overdue) return `<span class="status risk"><span class="ic">▲</span>${-relDays(d.baseline)}d overdue</span>`;
  if (n === 0) return `<span class="status watch"><span class="ic">●</span>due today</span>`;
  return `<span class="num ${n <= 3 ? "" : "muted"}">${n}d left</span>`;
}
export const slipTag = (days) => days == null ? "" : days > 0 ? `<span class="slip late">+${days}d</span>` : days < 0 ? `<span class="slip ok">${days}d</span>` : `<span class="slip ok">on time</span>`;

export function lastUpdateCell(p) {
  const u = lastUpdate(p);
  if (!u) return `<span class="status risk"><span class="ic">▲</span>never</span>`;
  const d = staleDays(p);
  const limit = settings().staleUpdateDays || 7;
  const cls = d > limit * 2 ? "risk" : d > limit ? "watch" : "active";
  return `<span class="status ${cls}"><span class="ic">${cls === "active" ? "●" : cls === "watch" ? "◷" : "▲"}</span>${esc(ago(u.date))}</span><div class="cell-sub" title="${esc(u.text)}">${esc(u.author)}</div>`;
}

export const projectCell = (p, sub = true) => `
  <div class="cell-name">${esc(p.client)}</div>
  ${sub && p.projectName ? `<div class="cell-sub">${esc(p.projectName)}</div>` : ""}`;

export const people = (names, max = 3) => `<span class="facepile">${(names || []).slice(0, max).map((n) => avatar(n, "sm")).join("")}${names && names.length > max ? `<span class="chip" style="padding:0 6px">+${names.length - max}</span>` : ""}</span>`;
export const nameList = (names) => (names || []).length ? esc(names.join(", ")) : `<span class="muted">—</span>`;

export const viewBtn = (p, label = "View project") => `<button class="btn xs" data-act="open-project" data-id="${esc(p.id)}">${esc(label)}</button>`;

export const kpi = ({ k, v, n = "", tip = "", tone = "", act = "", attrs = "" }) => `
  <${act ? "button" : "div"} class="kpi ${tone}" ${act ? `data-act="${esc(act)}" ${attrs}` : ""} ${tip ? `data-tip="${esc(tip)}"` : ""}>
    <div class="k">${esc(k)}${tip ? ` <span class="muted" style="font-size:10px">ⓘ</span>` : ""}</div>
    <div class="v num">${v}</div>
    ${n ? `<div class="n">${n}</div>` : ""}
  </${act ? "button" : "div"}>`;

export const tipRows = (title, rows) =>
  esc(`<div class="t-t">${esc(title)}</div>` + rows.map((r) => `<div class="t-r"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join(""));

/* ------------------------------------------------------------- filters */

const FILTER_DEFS = [
  { key: "status", label: "Status", options: () => [["active", "Active"], ["hold", "On hold"], ["upcoming", "Upcoming"], ["done", "Completed"]] },
  { key: "priority", label: "Priority", options: () => [["High", "High"], ["Medium", "Medium"], ["Low", "Low"], ["", "Not set"]] },
  { key: "dm", label: "DM", options: () => dmNames().map((n) => [n, n]) },
  { key: "sdm", label: "SDM", options: () => sdmNames().map((n) => [n, n]) },
  { key: "category", label: "Category", options: () => categoryNames().map((n) => [n, n]) },
  { key: "client", label: "Client", options: () => clientNames().map((n) => [n, n]) },
  { key: "editor", label: "Editor", options: () => editorNames().map((n) => [n, n]) },
  { key: "health", label: "Health", options: () => Object.entries(HEALTH).map(([k, v]) => [k, v]) },
];

/** The global filter row. Each chip opens a checklist; the chip shows the count. */
export function filterBar({ search = true, keys = ["status", "priority", "dm", "sdm", "category", "client"], extra = "" } = {}) {
  const f = S.filters;
  const chips = FILTER_DEFS.filter((d) => keys.includes(d.key)).map((d) => {
    const cur = f[d.key] || [];
    const open = S.ui.openChip === d.key;
    const opts = d.options();
    return `
      <span class="fchip">
        <button class="${cur.length ? "on" : ""}" data-act="fchip-toggle" data-key="${d.key}" aria-expanded="${open}">
          ${esc(d.label)}${cur.length ? ` <b>${cur.length}</b>` : ""} <span class="muted">▾</span>
        </button>
        ${open ? `<div class="pop" data-fchip-pop="${d.key}">
          ${opts.map(([v, lab]) => `<label><input type="checkbox" data-change="fchip-set" data-key="${d.key}" value="${esc(v)}" ${cur.includes(v) ? "checked" : ""}> ${esc(lab)}</label>`).join("") || `<div class="muted" style="padding:6px 8px">Nothing to pick</div>`}
          <div class="pop-f"><button class="btn xs ghost" data-act="fchip-clear" data-key="${d.key}">Clear</button><button class="btn xs" data-act="fchip-close" style="margin-left:auto">Done</button></div>
        </div>` : ""}
      </span>`;
  }).join("");
  const n = activeFilterCount();
  return `
    <div class="filters">
      ${search ? `<input class="grow" type="search" placeholder="Search client, project, scope, person…" value="${esc(f.q)}" data-input="filter-q" aria-label="Search projects">` : ""}
      ${chips}
      ${extra}
      ${f.mine ? `<span class="chip on">Mine <button data-act="toggle-mine" aria-label="Clear">✕</button></span>` : ""}
      ${f.person ? `<span class="chip on">${esc(f.person)} <button data-act="clear-person" aria-label="Clear">✕</button></span>` : ""}
      ${f.risk ? `<span class="chip on">flag: ${esc(f.risk)} <button data-act="clear-risk" aria-label="Clear">✕</button></span>` : ""}
      ${n ? `<button class="btn sm ghost" data-act="clear-filters">Clear ${n} filter${n > 1 ? "s" : ""}</button>` : ""}
    </div>`;
}

export function quickChips(keys = Object.keys(QUICK_LABELS), counts = null) {
  return `<div class="quick">${keys.map((k) => `
    <button data-act="quick" data-key="${k}" aria-pressed="${S.filters.quick === k}">${esc(QUICK_LABELS[k])}${counts && counts[k] != null ? `<span class="n">${counts[k]}</span>` : ""}</button>`).join("")}</div>`;
}

export function rangeBox() {
  const r = S.range;
  const opt = (v, l) => `<option value="${v}" ${r.preset === v ? "selected" : ""}>${l}</option>`;
  return `
    <select data-change="range-preset" aria-label="Date range">
      ${opt("all", "All dates")}${opt("7d", "Next 7 days")}${opt("30d", "Next 30 days")}${opt("month", "This month")}${opt("quarter", "This quarter")}${opt("custom", "Custom…")}
    </select>
    ${r.preset === "custom" ? `<input type="date" value="${esc(r.from)}" data-change="range-from" aria-label="From"><input type="date" value="${esc(r.to)}" data-change="range-to" aria-label="To">` : ""}`;
}

/** Everything the current filters leave, plus the count line for a page head. */
export function scopeLine(list = filtered()) {
  const t = list.length, all = S.data.projects.length;
  const n = activeFilterCount();
  return `${t === all ? `${all} projects` : `${t} of ${all} projects`}${n ? ` · ${n} filter${n > 1 ? "s" : ""} on` : ""}`;
}

export const escBadge = (p) => {
  const open = openEscalations(p);
  if (!open.length) return "";
  const worst = open.slice().sort((a, b) => ({ low: 0, medium: 1, high: 2, critical: 3 }[b.severity] - { low: 0, medium: 1, high: 2, critical: 3 }[a.severity]))[0];
  return `<span class="sev ${esc(worst.severity)}" data-tip="${esc(open.map((e) => e.reason).join(" · "))}">⚑ ${open.length > 1 ? open.length + " " : ""}escalat${open.length > 1 ? "ions" : "ed"}</span>`;
};

export const revCell = (p) => {
  const v = shareOf(p);
  if (v > 0) return `<span class="num">${esc(money(v))}</span>`;
  return `<span class="notset" data-tip="No revenue booked against this client or row">Not set</span>`;
};
