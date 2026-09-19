/* Projects — the sheet, but sortable and clickable.
   This is the closest thing to the original spreadsheet; everything is one
   click from the editor drawer. */

import { S, esc, money, num, avatar, fmtDate, fmtDateFull, ago, TODAY, canEdit } from "../core.js";
import {
  filtered, shareOf, statusKind, risksOf, lastUpdate, staleDays, isUnmapped,
} from "../compute.js";
import { filterBar } from "./timeline.js";

const COLS = [
  { key: "client",  label: "Project",     get: (p) => p.label.toLowerCase() },
  { key: "pod",     label: "Pod",         get: (p) => (p.podOwner || "").toLowerCase() },
  { key: "people",  label: "DM / editor lead", sort: false },
  { key: "status",  label: "Status",      get: (p) => statusKind(p.status) },
  { key: "dates",   label: "Timeline",    get: (p) => p.start || p.end || "￿" },
  { key: "update",  label: "Last update", get: (p) => (lastUpdate(p)?.date || "") },
  { key: "rev",     label: "Revenue",     get: (p) => shareOf(p), right: true },
  { key: "flags",   label: "Flags",       get: (p) => -risksOf(p).reduce((n, r) => n + r.sev, 0) },
];

function statusCell(p) {
  const k = statusKind(p.status);
  const ic = { active: "●", hold: "◷", upcoming: "○", done: "✓" }[k];
  return `<span class="status ${k}"><span class="ic">${ic}</span>${esc(p.status)}</span>`;
}

function datesCell(p) {
  if (!p.start && !p.end) {
    const note = [p.startNote, p.endNote].filter(Boolean).join(" → ");
    return note
      ? `<span class="sheetnote" title="${esc(note)}">✎ ${esc(note.slice(0, 28))}${note.length > 28 ? "…" : ""}</span>`
      : `<span class="muted">not set</span>`;
  }
  const end = p.openEnded ? "open-ended" : p.end ? fmtDate(p.end) : "—";
  return `<span class="num">${esc(p.start ? fmtDate(p.start) : "—")} <span class="muted">→</span> ${esc(end)}</span>
    ${p.endInferred ? `<div class="cell-sub">end inferred from the sheet</div>` : ""}`;
}

function updateCell(p) {
  const u = lastUpdate(p);
  if (!u) return `<span class="status risk"><span class="ic">▲</span>never</span>`;
  const d = staleDays(p);
  const limit = S.data.settings.staleUpdateDays || 7;
  const cls = d > limit * 2 ? "risk" : d > limit ? "watch" : "active";
  return `<span class="status ${cls}"><span class="ic">${cls === "active" ? "●" : cls === "watch" ? "◷" : "▲"}</span>${esc(ago(u.date))}</span>
    <div class="cell-sub" title="${esc(u.text)}">${esc(u.author)}</div>`;
}

export function renderProjects() {
  const list = filtered();
  const sort = S.sort.projects;
  const col = COLS.find((c) => c.key === sort.key) || COLS[0];
  const rows = list.slice().sort((a, b) => {
    const va = col.get ? col.get(a) : 0, vb = col.get ? col.get(b) : 0;
    if (va < vb) return -sort.dir;
    if (va > vb) return sort.dir;
    return a.label.localeCompare(b.label);
  });

  const total = rows.reduce((s, p) => s + shareOf(p), 0);

  const head = COLS.map((c) => c.sort === false
    ? `<th>${esc(c.label)}</th>`
    : `<th data-act="sort-projects" data-key="${c.key}" class="${c.right ? "r" : ""}">
        ${esc(c.label)}${sort.key === c.key ? `<span class="arw">${sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("");

  const body = rows.map((p) => {
    const risks = risksOf(p);
    return `
      <tr class="clickable" data-act="open-project" data-id="${esc(p.id)}">
        <td>
          <div class="cell-name">${esc(p.client)}</div>
          ${p.projectName ? `<div class="cell-sub">${esc(p.projectName)}</div>` : ""}
        </td>
        <td>${p.podOwner ? esc(p.podOwner) : "<span class='muted'>—</span>"}
          ${p.sdm ? `<div class="cell-sub">SDM ${esc(p.sdm)}</div>` : ""}</td>
        <td>
          <div style="display:flex;gap:3px;align-items:center;flex-wrap:wrap">
            ${(p.dms || []).map((d) => avatar(d, "sm")).join("") || "<span class='muted'>no DM</span>"}
            <span class="muted" style="margin:0 2px">/</span>
            ${(p.editorLeads || []).map((d) => avatar(d, "sm")).join("") || "<span class='muted'>none</span>"}
          </div>
        </td>
        <td>${statusCell(p)}</td>
        <td>${datesCell(p)}</td>
        <td>${updateCell(p)}</td>
        <td class="r num">${esc(money(shareOf(p)))}${isUnmapped(p) ? `<div class="cell-sub">unmapped</div>` : ""}</td>
        <td>${risks.length
          ? `<span class="chip ${risks[0].sev === 2 ? "on" : "ring"}"
               data-tip="${esc(risks.map((r) => r.label).join(" · "))}">${risks.length}</span>`
          : `<span class="muted">—</span>`}</td>
      </tr>`;
  }).join("");

  return `
    <div class="head">
      <div>
        <h1>Projects</h1>
        <div class="lede">${rows.length} of ${S.data.projects.length} rows · ${esc(money(total))} attributed.
          Click any row to edit it.</div>
      </div>
      <div class="head-actions">
        ${canEdit() ? `<button class="btn" data-act="new-project">New project</button>` : ""}
        <button class="btn" data-act="export">Export to Excel</button>
      </div>
    </div>

    ${filterBar()}

    <section class="card">
      <div class="scroller" style="max-height:74vh">
        <table class="rows">
          <thead><tr>${head}</tr></thead>
          <tbody>${body || `<tr><td colspan="8"><div class="empty">Nothing matches those filters.</div></td></tr>`}</tbody>
          ${rows.length ? `<tfoot><tr>
            <td colspan="6">${rows.length} projects</td>
            <td class="r num">${esc(money(total))}</td><td></td>
          </tr></tfoot>` : ""}
        </table>
      </div>
    </section>`;
}
