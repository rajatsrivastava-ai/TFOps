/* Executive Overview — one screen for leadership: the portfolio, who owns
   what, what is at risk, and what lands this week. The old revenue what-if
   lives on in a collapsed card at the bottom. */

import { S, esc, money, fmtCr, num, pct, fmtDate, fmtDateFull, ago, avatar, seriesVar, canEdit, TODAY, relDays, recall, persist } from "../core.js";
import {
  filtered, totals, riskTable, dmPerformance, upcomingDeliveries, healthOf, deliveryOf, shareOf, riskReason,
  lastUpdate, settings, concentration, runScenario, defaultScenario, podRollup, HEALTH, HEALTH_ORDER, PRIO_ORDER,
  forecastOf, scopeCompletion, editorsOf,
} from "../compute.js";
import { hbar, bullet } from "../charts.js";
import { filterBar, healthPill, prioBadge, kpi, deliveryCell, daysCell, lastUpdateCell, projectCell, viewBtn, revCell, tipRows, scopeLine, people, escBadge } from "./shared.js";

const sc = () => (S.scenario ||= defaultScenario());

function kpis(list) {
  const t = totals(list);
  const revPerDM = t.activeDmCount ? t.rev / t.activeDmCount : null;
  return `
    <div class="kpis">
      ${kpi({ k: "Total projects", v: t.n, n: `${t.active} active · ${t.hold} on hold${t.upcoming ? ` · ${t.upcoming} upcoming` : ""}`, tip: "Every project row inside the current filters.", act: "goto", attrs: 'data-page="register"' })}
      ${kpi({ k: "Active DMs", v: t.activeDmCount, n: `${t.dmCount} named overall`, tip: "DMs with at least one Active project. A project with two DMs counts once for each." })}
      ${kpi({ k: "Revenue per DM", v: revPerDM == null ? "—" : esc(money(revPerDM)), n: `${esc(money(t.rev))} across ${t.activeDmCount} DMs`, tip: "Total attributed revenue ÷ distinct DMs on active projects. Shared ownership is split evenly, so revenue is counted once." })}
      ${kpi({ k: "Projects per DM", v: t.activeDmCount ? num(t.loadPerDM, 1) : "—", n: "active projects, shared ones split", tip: "Active project assignments ÷ distinct active DMs. A project with two DMs is half a project to each." })}
      ${kpi({ k: "Projects per editor", v: t.edCount ? num(t.active / t.edCount, 1) : "—", n: `${t.edCount} editors on active work`, tip: "Active projects ÷ distinct editors named on them or assigned. Counts, not hours — hours are on Editor Allocation." })}
      ${kpi({ k: "Projects at risk", v: t.projectsAtRisk, n: `${esc(money(t.revAtRisk))} riding on them`, tip: "Overdue, forecast to miss the committed date, blocked, or escalated.", tone: t.projectsAtRisk ? "hot" : "", act: "quick-go", attrs: 'data-key="atrisk"' })}
    </div>
    <div class="muted small" style="margin:-4px 0 12px">Reporting as of ${esc(fmtDateFull(TODAY))}${S.range.preset !== "all" ? " · date range applied" : ""} · ${esc(scopeLine(list))}</div>`;
}

function healthBar(list) {
  const t = totals(list);
  const order = ["on_track", "at_risk", "critical", "unknown", "upcoming", "on_hold", "completed"];
  const colour = { on_track: "var(--good)", at_risk: "var(--warn)", critical: "var(--crit)", unknown: "var(--neutral)", upcoming: "var(--s1)", on_hold: "var(--neutral)", completed: "var(--s7)" };
  const parts = order.map((k) => ({ k, n: t.health[k] || 0 })).filter((x) => x.n);
  const total = parts.reduce((s, x) => s + x.n, 0) || 1;
  const sel = S.filters.health || [];
  return `
    <section class="card" style="margin-bottom:12px">
      <div class="card-h"><h2>Delivery health</h2><span class="spacer"></span>${sel.length ? `<button class="btn xs ghost" data-act="fchip-clear" data-key="health">Clear</button>` : ""}
        <div class="hint">Click a segment to filter the whole page. "Not set" means no committed date or milestones — not on track, not known.</div></div>
      <div class="card-b">
        <div class="stackbar">${parts.map((x) => `<button style="flex:0 0 ${(x.n / total) * 100}%;background:${colour[x.k]}" data-act="health-filter" data-key="${x.k}" aria-pressed="${sel.includes(x.k)}" data-tip="${esc(`${HEALTH[x.k]}: ${x.n} (${Math.round((x.n / total) * 100)}%)`)}">${(x.n / total) > 0.07 ? x.n : ""}</button>`).join("")}</div>
        <div class="legend">${parts.map((x) => `<button data-act="health-filter" data-key="${x.k}" aria-pressed="${sel.includes(x.k)}"><i class="dot" style="background:${colour[x.k]}"></i>${esc(HEALTH[x.k])} <b class="num">${x.n}</b> <span class="muted">${Math.round((x.n / total) * 100)}%</span></button>`).join("")}</div>
      </div>
    </section>`;
}

function riskSection(list) {
  const rows = riskTable(list);
  const sort = S.sort.risk;
  const keyOf = {
    priority: (r) => PRIO_ORDER[r.p.priority || ""], project: (r) => r.p.label.toLowerCase(), dm: (r) => (r.p.primaryDm || "").toLowerCase(),
    next: (r) => (r.delivery.forecast || r.delivery.baseline || "9999"), days: (r) => r.delivery.daysRemaining ?? 9999, rev: (r) => r.rev, updated: (r) => r.last?.date || "",
  };
  const sorted = rows.slice().sort((a, b) => {
    if (sort.key === "priority") return 0;      // default order: critical first, then priority, then revenue
    const ka = keyOf[sort.key]?.(a), kb = keyOf[sort.key]?.(b);
    return (ka < kb ? -1 : ka > kb ? 1 : 0) * sort.dir;
  });
  const th = (label, key, cls = "", tip = "") => `<th class="${cls}" data-act="sort" data-table="risk" data-key="${key}">${tip ? `<span class="th-help" data-tip="${esc(tip)}">${esc(label)}</span>` : esc(label)}${sort.key === key ? `<span class="arw">${sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`;

  return `
    <section class="card" style="margin-bottom:12px">
      <div class="card-h"><h2>Projects at risk — priority actions</h2><span class="chip ${rows.length ? "on" : "ring"}">${rows.length}</span><span class="spacer"></span>
        <button class="btn xs" data-act="export">Export</button>
        <div class="hint">Overdue, forecast to miss, blocked or escalated. Critical first. Revenue at risk is this row's attributed revenue.</div></div>
      <div class="scroller" style="max-height:60vh">
        <table class="rows">
          <thead><tr>${th("Priority", "priority")}${th("Client / project", "project")}${th("DM", "dm")}<th>SDM</th><th>Current milestone</th>${th("Next date", "next", "", "Forecast date of the next open milestone, or the final delivery.")}<th>Final delivery</th>${th("Days", "days", "r", "Days to the forecast delivery, or days past the commitment.")}<th>Risk reason</th>${th("Revenue at risk", "rev", "r")}${th("Last update", "updated")}<th></th></tr></thead>
          <tbody>${sorted.map((r) => {
            const f = forecastOf(r.p);
            const cur = f.current;
            const nextDate = cur ? f.milestones.get(cur.id)?.forecast : (r.delivery.forecast || r.delivery.baseline);
            return `<tr class="clickable ${r.health.key === "critical" ? "crit" : "warn"}" data-act="open-project" data-id="${esc(r.p.id)}">
              <td>${prioBadge(r.p.priority)}</td>
              <td>${projectCell(r.p)}<div class="cell-sub">${healthPill(r.p, true)} ${escBadge(r.p)}</div></td>
              <td>${r.p.primaryDm ? `${avatar(r.p.primaryDm, "sm")} ${esc(r.p.primaryDm)}` : '<span class="muted">—</span>'}</td>
              <td>${esc(r.p.sdm || "—")}</td>
              <td>${cur ? `${esc(cur.title)}<div class="cell-sub">${esc(cur.status === "blocked" ? "blocked" : cur.status === "in_progress" ? "in progress" : "next")}</div>` : '<span class="notset">No milestones</span>'}</td>
              <td class="num">${nextDate ? esc(fmtDate(nextDate)) : '<span class="notset">Not set</span>'}</td>
              <td>${deliveryCell(r.p)}</td>
              <td class="r">${daysCell(r.p)}</td>
              <td><div class="cell-sub wrap" style="color:var(--ink)">${esc(r.reason)}</div></td>
              <td class="r">${revCell(r.p)}</td>
              <td>${lastUpdateCell(r.p)}</td>
              <td class="r">${viewBtn(r.p)}</td>
            </tr>`;
          }).join("") || `<tr><td colspan="12"><div class="empty"><div class="big">Nothing at risk inside these filters</div>Overdue, slipping, blocked and escalated projects land here.</div></td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

function dmSection(list) {
  const rows = dmPerformance(list);
  const sort = S.sort.dm;
  const keyOf = { name: (r) => r.name.toLowerCase(), active: (r) => r.active, high: (r) => r.high, risk: (r) => r.atRisk, rev: (r) => r.rev, perEditor: (r) => r.perEditor ?? -1, onTime: (r) => r.onTime ?? -1, overdue: (r) => r.overdueMs, compliance: (r) => r.compliance ?? -1, points: (r) => r.points };
  const sorted = rows.slice().sort((a, b) => { const ka = keyOf[sort.key]?.(a), kb = keyOf[sort.key]?.(b); return (ka < kb ? -1 : ka > kb ? 1 : 0) * sort.dir; });
  const th = (label, key, cls = "", tip = "") => `<th class="${cls}" data-act="sort" data-table="dm" data-key="${key}">${tip ? `<span class="th-help" data-tip="${esc(tip)}">${esc(label)}</span>` : esc(label)}${sort.key === key ? `<span class="arw">${sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`;
  const pctOr = (v) => v == null ? '<span class="notset">No data</span>' : `${Math.round(v * 100)}%`;

  return `
    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(300px,1fr);margin-bottom:12px">
      <section class="card">
        <div class="card-h"><h2>DM performance and workload</h2><span class="spacer"></span>
          <div class="hint">Shared projects split evenly between their DMs. Effort points show scope and complexity beside the counts — rank on those together, not on project count alone.</div></div>
        <div class="scroller" style="max-height:52vh">
          <table class="rows compact">
            <thead><tr>${th("DM", "name")}${th("Active", "active", "r")}${th("High", "high", "r", "Active projects marked High priority")}${th("At risk", "risk", "r")}${th("Effort", "points", "r", "Assumed effort points across their projects — the scope-and-complexity view")}${th("Revenue", "rev", "r", "Attributed revenue; also the revenue-per-DM figure for this person")}${th("Per editor", "perEditor", "r", "Active projects ÷ distinct editors on their projects")}${th("On time", "onTime", "r", "Milestones completed on or before their committed date, as a share of completed milestones")}${th("Overdue ms", "overdue", "r", "Open milestones past their committed date")}${th("Updates", "compliance", "r", "Active projects updated inside the stale window")}</tr></thead>
            <tbody>${sorted.map((r) => `<tr class="clickable" data-act="open-person" data-name="${esc(r.name)}">
              <td><div class="cell-name">${avatar(r.name, "sm")} ${esc(r.name)}</div><div class="cell-sub">${r.editorCount} editor${r.editorCount === 1 ? "" : "s"}</div></td>
              <td class="r num">${num(r.active, 1)}</td><td class="r num">${num(r.high, 1)}</td>
              <td class="r num ${r.atRisk ? "" : "muted"}" style="${r.atRisk >= 2 ? "color:var(--crit-ink);font-weight:600" : ""}">${num(r.atRisk, 1)}</td>
              <td class="r num">${num(r.points, 1)}</td>
              <td class="r num">${esc(money(r.rev))}</td>
              <td class="r num">${r.perEditor == null ? '<span class="notset">—</span>' : num(r.perEditor, 1)}</td>
              <td class="r num">${pctOr(r.onTime)}</td>
              <td class="r num ${r.overdueMs ? "" : "muted"}">${num(r.overdueMs, 0)}</td>
              <td class="r num">${pctOr(r.compliance)}</td>
            </tr>`).join("") || `<tr><td colspan="10" class="muted">No DMs inside these filters.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
      <div class="grid">
        <section class="card"><div class="card-h"><h2>Active projects per DM</h2></div>
          <div class="card-b">${hbar(rows.slice().sort((a, b) => b.active - a.active).slice(0, 12).map((r) => ({ label: r.name, value: r.active, r })), { aria: "Active projects per DM", fmt: (v) => num(v, 1), height: 16, gap: 5, labelWidth: 140, colour: () => "var(--s1)", tipRows: (x) => [["Active", num(x.r.active, 1)], ["Effort points", num(x.r.points, 1)], ["At risk", num(x.r.atRisk, 1)]] })}</div></section>
        <section class="card"><div class="card-h"><h2>Revenue per DM</h2></div>
          <div class="card-b">${hbar(rows.slice().sort((a, b) => b.rev - a.rev).slice(0, 12).map((r) => ({ label: r.name, value: r.rev, r })), { aria: "Revenue per DM", height: 16, gap: 5, labelWidth: 140, colour: () => "var(--s3)", tipRows: (x) => [["Revenue", money(x.r.rev)], ["Projects", String(x.r.projects)]] })}</div></section>
      </div>
    </div>`;
}

function upcoming(list) {
  const rows = upcomingDeliveries(7, list);
  return `
    <section class="card" style="margin-bottom:12px">
      <div class="card-h"><h2>Upcoming delivery commitments — next 7 days</h2><span class="chip ring">${rows.length}</span><span class="spacer"></span><button class="btn xs" data-act="goto" data-page="timeline" data-tab="calendar">Calendar</button>
        <div class="hint">Final deliveries and milestones forecast to land by ${esc(fmtDateFull(new Date(Date.parse(TODAY) + 7 * 864e5).toISOString().slice(0, 10)))}.</div></div>
      <div class="scroller" style="max-height:40vh">
        <table class="rows compact">
          <thead><tr><th>Date</th><th>Client / project</th><th>Deliverable</th><th>DM</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>${rows.map((r) => `<tr class="clickable" data-act="open-project" data-id="${esc(r.p.id)}">
            <td class="num"><b>${esc(fmtDate(r.date))}</b><div class="cell-sub">${esc(r.date === TODAY ? "today" : ago(r.date))}</div></td>
            <td>${projectCell(r.p)}</td>
            <td>${r.kind === "final" ? `<b>Final delivery</b>` : esc(r.title)}${r.baseline && r.baseline !== r.date ? `<div class="cell-sub">committed ${esc(fmtDate(r.baseline))}</div>` : ""}</td>
            <td>${r.p.primaryDm ? `${avatar(r.p.primaryDm, "sm")} ${esc(r.p.primaryDm)}` : "—"}</td>
            <td>${prioBadge(r.p.priority)}</td>
            <td>${healthPill(r.p, true)}</td>
          </tr>`).join("") || `<tr><td colspan="6"><div class="empty">Nothing is due in the next 7 days inside these filters.</div></td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

function scenario() {
  const open = recall("overview.scenario", false);
  const s = sc();
  const t = totals();
  const conc = concentration();
  const r = runScenario(s);
  const pctFmt = (v) => (v * 100).toFixed(0) + "%";
  const slider = (key, label, sub, min, max, step, value, fmt) => `
    <div class="scenario-row"><div class="lab">${esc(label)}<small>${esc(sub)}</small></div><div class="out">${esc(fmt(value))}</div>
      <input class="sl" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-input="lever" data-key="${key}" aria-label="${esc(label)}"></div>`;
  const row = (label, b, a, fmt) => `<tr><td>${esc(label)}</td><td class="r num muted">${esc(fmt(b))}</td><td class="r num"><b>${esc(fmt(a))}</b></td></tr>`;
  return `
    <section class="card ${open ? "" : "collapsed"}" id="scenario-card">
      <div class="card-h"><h2>Scenario — what if the book changes</h2><span class="spacer"></span>
        <button class="btn xs ghost" data-act="reset-scenario">Reset</button>
        <button class="toggle" data-act="toggle-card" data-key="overview.scenario" data-id="scenario-card">${open ? "Hide ▴" : "Show ▾"}</button>
        <div class="hint">A projection off today's ${esc(fmtCr(t.rev))}. Nothing here changes the board.</div></div>
      <div class="card-b">
        <div class="split">
          <div>
            ${slider("activateHold", "Unfreeze on-hold work", `${esc(fmtCr(t.holdRev))} parked across ${t.hold} projects`, 0, 1, 0.05, s.activateHold, (v) => (v * 100).toFixed(0) + "%")}
            ${slider("winNewCr", "New business won", "brand-new clients, in ₹ Cr", 0, 10, 0.25, s.winNewCr, (v) => "₹" + v.toFixed(2) + "Cr")}
            ${slider("priceUplift", "Rate change across the book", "repricing every retainer", -25, 50, 1, s.priceUplift, (v) => (v > 0 ? "+" : "") + v + "%")}
            <div class="muted small" style="margin:10px 0 6px">Assume we lose…</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${conc.list.slice(0, 12).map((c) => `<button class="chip ${s.churn.includes(c.key) ? "on" : "ring"}" data-act="toggle-churn" data-key="${esc(c.key)}">${esc(c.name)} <span class="num muted">${esc((c.rev / 1e7).toFixed(2))}Cr</span></button>`).join("")}</div>
          </div>
          <div>
            <table class="rows compact"><thead><tr><th>Measure</th><th class="r">Today</th><th class="r">Scenario</th></tr></thead><tbody>
              ${row("Book of business", r.before.rev, r.after.rev, money)}${row("Active revenue", r.before.activeRev, r.after.activeRev, money)}
              ${row("Contribution margin", r.before.margin, r.after.margin, pctFmt)}${row("Top client share", r.before.top1, r.after.top1, pctFmt)}${row("Top 3 share", r.before.top3, r.after.top3, pctFmt)}
            </tbody></table>
            ${settings().targetRevenueCr ? `<div style="margin-top:12px">${bullet(r.after.rev, settings().targetRevenueCr * 1e7, { label: "Scenario book against target" })}</div>` : ""}
          </div>
        </div>
      </div>
    </section>`;
}

export function renderOverview() {
  const list = filtered();
  return `<div class="page">
    <div class="head"><div><h1>Executive overview</h1><div class="lede">The delivery portfolio in one screen: exposure, ownership, what is at risk and what lands next.</div></div>
      <div class="head-actions"><button class="btn sm" data-act="export">Export to Excel</button></div></div>
    ${filterBar()}
    ${kpis(list)}
    ${healthBar(list)}
    ${riskSection(list)}
    ${dmSection(list)}
    ${upcoming(list)}
    ${scenario()}
  </div>`;
}
