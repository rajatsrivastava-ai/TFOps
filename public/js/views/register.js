/* Project Register — the single source of truth for each project, as cards
   or a table, with the daily DM update a click away. */

import { S, esc, money, fmtDate, fmtDateFull, ago, avatar, TODAY, relDays, num, canEdit, recall, persist } from "../core.js";
import {
  filtered, healthOf, deliveryOf, forecastOf, shareOf, lastUpdate, staleDays, settings, scopeCompletion, editorsOf,
  updatesOwed, myDrafts, statusKind, PRIO_ORDER, HEALTH_ORDER, openEscalations, milestonesOf, riskReason, revenueUnknown,
} from "../compute.js";
import { filterBar, quickChips, healthPill, prioBadge, statusPill, deliveryCell, daysCell, lastUpdateCell, projectCell, people, notSet, viewBtn, revCell, scopeLine, escBadge, slipTag } from "./shared.js";

function tlMini(p) {
  const f = forecastOf(p);
  const ms = milestonesOf(p);
  if (!ms.length) return "";
  return `<div class="tl-mini" data-tip="${esc(`${f.doneCount} of ${f.total} milestones done`)}">${ms.map((m) => { const fm = f.milestones.get(m.id); return `<i class="${fm?.done ? "done" : fm?.overdue ? "late" : f.current?.id === m.id ? "cur" : ""}"></i>`; }).join("")}</div>`;
}

function card(p) {
  const h = healthOf(p);
  const d = deliveryOf(p);
  const f = forecastOf(p);
  const u = lastUpdate(p);
  const sc = scopeCompletion(p);
  const stale = staleDays(p);
  const limit = settings().staleUpdateDays || 7;
  const rev = shareOf(p);
  const owed = statusKind(p.status) === "active" && (stale === null || stale > limit);
  return `
    <article class="pcard ${h.key}" data-act="open-project" data-id="${esc(p.id)}" role="button" tabindex="0">
      <div class="pc-top">
        <div class="pc-title"><b>${esc(p.client)}</b><span>${esc(p.projectName || (p.categories || []).join(", ") || "—")}</span></div>
        ${healthPill(p, true)}
      </div>
      <div class="pc-tags">${prioBadge(p.priority)} ${statusPill(p.status)} ${(p.categories || []).slice(0, 2).map((c) => `<span class="chip">${esc(c)}</span>`).join("")} ${escBadge(p)}</div>
      <div class="pc-people">
        <span data-tip="DM">${p.primaryDm ? `${avatar(p.primaryDm, "sm")} ${esc(p.primaryDm)}` : '<span class="notset">No DM</span>'}${(p.dms || []).length > 1 ? ` <span class="muted">+${(p.dms || []).length - 1}</span>` : ""}</span>
        <span class="muted">·</span><span data-tip="SDM">SDM ${esc(p.sdm || "—")}</span>
        <span class="muted">·</span><span data-tip="Editors">${editorsOf(p).length ? people(editorsOf(p)) : '<span class="notset">No editor</span>'}</span>
      </div>
      <div class="pc-row">
        <span class="k">Revenue</span><span class="v">${rev > 0 ? esc(money(rev)) : notSet()}</span>
        <span class="k">Scope done</span><span class="v">${sc.pct == null ? notSet("Not measurable") : `${Math.round(sc.pct)}%`}</span>
        ${sc.pct != null ? `<span class="v wide"><div class="progress"><i class="${sc.measured ? "" : "est"}" style="width:${sc.pct}%"></i></div></span>` : ""}
        <span class="k">Locked scope</span><span class="v wide ell" title="${esc(p.scopeLocked || p.scope || "")}">${esc((p.scopeLocked || p.scope || "").split("\n")[0]) || notSet()}</span>
        <span class="k">Current milestone</span><span class="v">${f.current ? esc(f.current.title) : notSet("No milestones")}</span>
        <span class="k">Next date</span><span class="v">${f.next && f.milestones.get(f.next.id)?.forecast ? esc(fmtDate(f.milestones.get(f.next.id).forecast)) : notSet()}</span>
        <span class="k">Delivery</span><span class="v">${deliveryCell(p)} ${d.slipDays ? slipTag(d.slipDays) : ""}</span>
        <span class="k">Days</span><span class="v">${daysCell(p)}</span>
      </div>
      ${tlMini(p)}
      <div class="pc-last">
        ${u ? `<span><b style="font-weight:500">${esc(u.author)}</b> <span class="${owed ? "cold" : "muted"}">${esc(ago(u.date))}</span>${owed ? ' <span class="cold">· update owed</span>' : ""}</span>
          <span class="q">${esc(u.completed || u.text)}</span>
          ${u.blockers ? `<span style="color:var(--crit-ink)">▲ ${esc(u.blockers)}${u.dependencyOwner ? ` (${esc(u.dependencyOwner)})` : ""}${u.expectedResolution ? ` · by ${esc(fmtDate(u.expectedResolution))}` : ""}</span>` : ""}
          ${u.nextAction ? `<span class="muted">→ ${esc(u.nextAction)}${u.nextActionOwner ? ` · ${esc(u.nextActionOwner)}` : ""}</span>` : ""}`
          : `<span class="cold">No update yet</span>`}
      </div>
      <div class="pc-foot">
        <span class="muted small">${h.reasons.length ? esc(h.reasons[0].label) : h.missing?.length ? "Missing: " + esc(h.missing.join(", ")) : ""}</span>
        ${canEdit() ? `<button class="btn xs primary" data-act="open-update" data-id="${esc(p.id)}">Add daily update</button>` : ""}
      </div>
    </article>`;
}

const COLS = [
  { key: "health", label: "Health", get: (p) => HEALTH_ORDER[healthOf(p).key] },
  { key: "priority", label: "Priority", get: (p) => PRIO_ORDER[p.priority || ""] },
  { key: "project", label: "Client / project", get: (p) => p.label.toLowerCase() },
  { key: "dm", label: "DM / SDM", get: (p) => (p.primaryDm || "").toLowerCase() },
  { key: "editors", label: "Editors", sort: false },
  { key: "status", label: "Status", get: (p) => statusKind(p.status) },
  { key: "milestone", label: "Current milestone", sort: false },
  { key: "delivery", label: "Delivery (committed → forecast)", get: (p) => deliveryOf(p).forecast || deliveryOf(p).baseline || "9999" },
  { key: "days", label: "Days", get: (p) => deliveryOf(p).daysRemaining ?? 9999, right: true },
  { key: "scope", label: "Scope", get: (p) => scopeCompletion(p).pct ?? -1, right: true },
  { key: "rev", label: "Revenue", get: (p) => shareOf(p), right: true },
  { key: "update", label: "Last update", get: (p) => lastUpdate(p)?.date || "" },
];

function table(list) {
  const sort = S.sort.register;
  const col = COLS.find((c) => c.key === sort.key) || COLS[0];
  const rows = list.slice().sort((a, b) => { const va = col.get ? col.get(a) : 0, vb = col.get ? col.get(b) : 0; if (va < vb) return -sort.dir; if (va > vb) return sort.dir; return a.label.localeCompare(b.label); });
  const head = COLS.map((c) => c.sort === false ? `<th>${esc(c.label)}</th>` : `<th data-act="sort" data-table="register" data-key="${c.key}" class="${c.right ? "r" : ""}">${esc(c.label)}${sort.key === c.key ? `<span class="arw">${sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("");
  return `
    <section class="card"><div class="scroller" style="max-height:72vh"><table class="rows">
      <thead><tr>${head}<th></th></tr></thead>
      <tbody>${rows.map((p) => { const f = forecastOf(p); const sc = scopeCompletion(p); const h = healthOf(p).key; return `
        <tr class="clickable ${h === "critical" ? "crit" : h === "at_risk" ? "warn" : ""}" data-act="open-project" data-id="${esc(p.id)}">
          <td>${healthPill(p, true)}</td><td>${prioBadge(p.priority)}</td>
          <td>${projectCell(p)}</td>
          <td>${p.primaryDm ? `${avatar(p.primaryDm, "sm")} ${esc(p.primaryDm)}` : '<span class="notset">No DM</span>'}<div class="cell-sub">SDM ${esc(p.sdm || "—")}</div></td>
          <td>${editorsOf(p).length ? people(editorsOf(p)) : '<span class="notset">None</span>'}</td>
          <td>${statusPill(p.status)}</td>
          <td>${f.current ? `${esc(f.current.title)}<div class="cell-sub">${f.next && f.milestones.get(f.next.id)?.forecast ? "next " + esc(fmtDate(f.milestones.get(f.next.id).forecast)) : ""}</div>` : '<span class="notset">No milestones</span>'}</td>
          <td>${deliveryCell(p)}</td>
          <td class="r">${daysCell(p)}</td>
          <td class="r num">${sc.pct == null ? '<span class="notset">—</span>' : `${Math.round(sc.pct)}%`}</td>
          <td class="r">${revCell(p)}</td>
          <td>${lastUpdateCell(p)}</td>
          <td class="r">${canEdit() ? `<button class="btn xs" data-act="open-update" data-id="${esc(p.id)}">Update</button>` : ""}</td>
        </tr>`; }).join("") || `<tr><td colspan="13"><div class="empty">Nothing matches those filters.</div></td></tr>`}</tbody>
    </table></div></section>`;
}

function owedRail() {
  const rows = updatesOwed();
  const limit = settings().staleUpdateDays || 7;
  if (!rows.length) return `<section class="card"><div class="card-h"><h2>Updates owed</h2></div><div class="empty"><div class="big">✓ Everyone is current</div>Every active project has an update inside ${limit} days.</div></section>`;
  return `
    <section class="card">
      <div class="card-h"><h2>Updates owed</h2><span class="spacer"></span><span class="chip on">${rows.reduce((s, r) => s + r.items.length, 0)}</span>
        <div class="hint">Active projects with nothing logged in ${limit} days, by the DM on the hook.</div></div>
      <div class="scroller" style="max-height:50vh"><table class="rows compact"><thead><tr><th>DM</th><th class="r">Owed</th><th>Oldest</th></tr></thead><tbody>
        ${rows.map((r) => { const oldest = r.items.slice().sort((a, b) => (b.days ?? 999) - (a.days ?? 999))[0]; return `
          <tr class="clickable" data-act="filter-person" data-person="${esc(r.name)}">
            <td><div class="cell-name">${avatar(r.name, "sm")} ${esc(r.name)}</div><div class="cell-sub">${esc(money(r.rev))} riding on them</div></td>
            <td class="r num"><b>${r.items.length}</b></td>
            <td><span class="status ${(oldest.days ?? 999) > limit * 2 ? "risk" : "watch"}"><span class="ic">${(oldest.days ?? 999) > limit * 2 ? "▲" : "●"}</span>${oldest.days === null ? "never" : `${oldest.days}d`}</span><div class="cell-sub">${esc(oldest.p.projectName || oldest.p.client)}</div></td>
          </tr>`; }).join("")}
      </tbody></table></div>
    </section>`;
}

export function renderRegister() {
  const list = filtered();
  const mode = S.register.mode;
  const drafts = myDrafts();
  const sorted = mode === "cards" ? list.slice().sort((a, b) => HEALTH_ORDER[healthOf(a).key] - HEALTH_ORDER[healthOf(b).key] || PRIO_ORDER[a.priority || ""] - PRIO_ORDER[b.priority || ""] || a.label.localeCompare(b.label)) : list;
  return `<div class="page">
    <div class="head"><div><h1>Project register</h1><div class="lede">Every project: scope, ownership, delivery status and the latest DM update. ${esc(scopeLine(list))}.</div></div>
      <div class="head-actions">
        <div class="seg" role="group" aria-label="Layout"><button data-act="register-mode" data-mode="cards" aria-pressed="${mode === "cards"}">Cards</button><button data-act="register-mode" data-mode="table" aria-pressed="${mode === "table"}">Table</button></div>
        <button class="btn sm ${S.filters.mine ? "primary" : ""}" data-act="toggle-mine">${S.filters.mine ? "Showing mine" : "Mine"}</button>
        ${canEdit() ? `<button class="btn sm" data-act="open-import">Import sheet</button><button class="btn sm" data-act="new-project">New project</button>` : ""}
        <button class="btn sm" data-act="export">Export</button>
      </div></div>
    ${drafts.length ? `<div class="callout warn" style="margin-bottom:12px"><span>✎</span><div>You have ${drafts.length} unsent draft update${drafts.length > 1 ? "s" : ""}: ${drafts.map((d) => `<button class="btn xs" data-act="open-update" data-id="${esc(d.projectId)}" data-draft="${esc(d.id)}">${esc(S.data.projects.find((p) => p.id === d.projectId)?.client || d.projectId)} · ${esc(fmtDate(d.date))}</button>`).join(" ")}</div></div>` : ""}
    ${filterBar()}
    ${quickChips(["today", "next7", "overdue", "atrisk", "escalated", "waitclient", "waitinternal", "hold", "notset"])}
    <div class="split" style="grid-template-columns:minmax(0,1fr) 300px">
      <div>${mode === "cards" ? `<div class="pcards">${sorted.map(card).join("") || `<div class="empty" style="grid-column:1/-1"><div class="big">Nothing matches those filters</div></div>`}</div>` : table(list)}</div>
      <div>${owedRail()}</div>
    </div>
  </div>`;
}
