/* The project slide-over: seven tabs over one row of the board. Overview and
   Scope carry the editable setup form; Milestones is where dates move, with
   the impact shown before anything is saved. */

import { S, esc, money, fmtDate, fmtDateFull, fmtDateTime, ago, avatar, TODAY, relDays, num, canEdit, isISO, hrs, dueIn } from "../core.js";
import {
  projectById, milestonesOf, assignmentsOf, forecastOf, deliveryOf, healthOf, updatesByProject, escalationsByProject,
  shareOf, isUnmapped, revenueUnknown, roster, allOf, editorNames, categoryNames, scopeCompletion, editorsOf, lastUpdate,
  risksOf, effortOf, EFFORT_LABELS, SCH, settings, resolvedAssignments, personByName, loadRollup, loadTotals, rolesOf,
  myProjects, statusKind, projects,
} from "../compute.js";
import { healthPill, prioBadge, statusPill, sevPill, escStatus, notSet, dateOr, deliveryCell, slipTag, msStatusLabel, people, utilPill } from "./shared.js";

const TABS = [["overview", "Overview"], ["scope", "Scope & deliverables"], ["milestones", "Milestones & timeline"], ["updates", "Daily updates"], ["team", "Team & allocation"], ["escalations", "Escalations"], ["history", "Activity"]];
const OWNER_TYPES = SCH.OWNER_TYPES;

export { projectById };

const field = (label, inner, { hint = "", cls = "" } = {}) => `<div class="field ${cls}"><label>${esc(label)}</label>${inner}${hint ? `<span class="muted" style="font-size:11px">${hint}</span>` : ""}</div>`;
const sel = (name, options, cur, { blank = "", attrs = "" } = {}) => `
  <select data-field="${name}" ${attrs}>${blank !== null ? `<option value="">${esc(blank)}</option>` : ""}${options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(cur ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`;
  }).join("")}</select>`;
const inp = (name, value, { type = "text", attrs = "", list = "" } = {}) => `<input type="${type}" data-field="${name}" value="${esc(value ?? "")}" ${list ? `list="${list}"` : ""} ${attrs}>`;
const datalist = (id, values) => `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;

export function renderProjectDrawer(id, tab = "overview", x = {}) {
  const p = projectById(id);
  if (!p) return "";
  const open = (escalationsByProject()[p.id] || []).filter((e) => e.status !== "resolved").length;
  const counts = { milestones: milestonesOf(p).length, updates: (updatesByProject()[p.id] || []).length, escalations: open, team: editorsOf(p).length };
  const render = { overview, scope, milestones, updates, team, escalations, history }[tab] || overview;
  const d = deliveryOf(p);

  return `
    <div class="scrim" data-act="close-drawer"></div>
    <aside class="drawer wide" role="dialog" aria-modal="true" aria-label="${esc(p.label)}">
      <header class="drawer-h">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <h2 style="margin-right:4px">${esc(p.client)}${p.projectName ? ` <span class="muted" style="font-weight:400">— ${esc(p.projectName)}</span>` : ""}</h2>
            ${healthPill(p)} ${prioBadge(p.priority)} ${statusPill(p.status)}
            ${(p.categories || []).map((c) => `<span class="chip">${esc(c)}</span>`).join("")}
          </div>
          <div class="muted small" style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">
            <span>DM <b>${esc(p.primaryDm || (p.dms || [])[0] || "—")}</b>${(p.dms || []).length > 1 ? ` +${(p.dms || []).filter((x) => x !== p.primaryDm).join(", ")}` : ""}</span>
            <span>SDM <b>${esc(p.sdm || "—")}</b></span>
            <span>Editors <b>${esc(editorsOf(p).join(", ") || "—")}</b></span>
            <span>Delivery ${deliveryCell(p, true)}${d.slipDays ? ` ${slipTag(d.slipDays)}` : ""}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex:none">
          ${canEdit() ? `<button class="btn sm primary" data-act="open-update" data-id="${esc(p.id)}">Add daily update</button>` : ""}
          <button class="btn sm ghost" data-act="close-drawer" aria-label="Close">✕</button>
        </div>
      </header>
      <nav class="tabs-in" role="tablist">
        ${TABS.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-act="drawer-tab" data-tab="${k}">${esc(l)}${counts[k] ? `<span class="n">${counts[k]}</span>` : ""}</button>`).join("")}
      </nav>
      <div class="drawer-b">${render(p, x)}</div>
      ${tab === "overview" || tab === "scope" ? `<footer class="drawer-f">
        ${canEdit() ? `<button class="btn primary" data-act="save-project" data-id="${esc(p.id)}">Save changes</button><button class="btn ghost" data-act="close-drawer">Cancel</button>
          <span class="muted small" style="margin-left:auto">${S.me ? `Saving as ${esc(S.me)}` : "Set your name first"}</span>`
          : `<button class="btn ghost" data-act="close-drawer">Close</button><span class="muted small" style="margin-left:auto">Read-only session</span>`}
      </footer>` : ""}
    </aside>`;
}

/* -------------------------------------------------------------- tabs */

function overview(p) {
  const h = healthOf(p);
  const d = deliveryOf(p);
  const f = forecastOf(p);
  const u = lastUpdate(p);
  const sc = scopeCompletion(p);
  const e = effortOf(p);
  const rev = shareOf(p);
  const risks = risksOf(p);

  return `
    ${h.reasons.length || h.missing?.length ? `<div class="callout ${h.key === "critical" ? "crit" : h.key === "at_risk" ? "warn" : ""}" style="margin-bottom:14px">
      <span>${h.key === "critical" ? "▲" : "●"}</span>
      <div><b>${esc(h.label)}.</b> ${h.reasons.map((r) => esc(r.label)).join(" · ")}${h.missing?.length ? `<div class="muted small">Missing: ${h.missing.map(esc).join(", ")}</div>` : ""}</div></div>` : ""}

    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <div class="kpi"><div class="k">Committed delivery</div><div class="v" style="font-size:16px">${d.baseline ? esc(fmtDateFull(d.baseline)) : d.ongoing ? "Ongoing" : notSet()}</div>
        ${d.baselineOriginal && d.baselineOriginal !== d.baseline ? `<div class="n">originally ${esc(fmtDateFull(d.baselineOriginal))}</div>` : d.baseline ? `<div class="n">${p.baselineLocked ? "locked" : "not locked"}</div>` : ""}</div>
      <div class="kpi ${d.forecastMiss || d.overdue ? "hot" : ""}"><div class="k">Forecast delivery</div><div class="v" style="font-size:16px">${d.forecast ? esc(fmtDateFull(d.forecast)) : d.ongoing ? "—" : notSet()}</div>
        <div class="n">${d.slipDays != null ? (d.slipDays > 0 ? `${d.slipDays}d late` : d.slipDays < 0 ? `${-d.slipDays}d early` : "on the commitment") : d.ongoing ? "no fixed end" : "no forecast"}${d.source === "override" ? " · override" : d.source === "milestones" ? " · from milestones" : ""}</div></div>
      <div class="kpi"><div class="k">${d.overdue ? "Overdue by" : "Days remaining"}</div><div class="v">${d.daysRemaining == null ? notSet() : Math.abs(d.daysRemaining)}<small>d</small></div></div>
      <div class="kpi"><div class="k">Revenue</div><div class="v" style="font-size:16px">${rev > 0 ? esc(money(rev)) : notSet()}</div><div class="n">${Number(p.revenue) > 0 ? "set on this row" : revenueUnknown(p) ? "nothing booked" : "share of the client booking"}${p.sheetRevenue ? ` · sheet: ${esc(money(p.sheetRevenue))}` : ""}</div></div>
      <div class="kpi"><div class="k">Scope done</div><div class="v">${sc.pct == null ? notSet("Not measurable") : `${Math.round(sc.pct)}<small>%</small>`}</div><div class="n">${esc(sc.label)}</div></div>
    </div>

    <div class="section-t">Current milestone</div>
    ${f.current ? `<div class="ms" style="border:0;padding:0"><span class="st ${f.milestones.get(f.current.id)?.overdue ? "late" : f.current.status}"></span>
      <span class="t">${esc(f.current.title)}<small>${esc(msStatusLabel[f.current.status] || "")}${f.current.owner ? " · " + esc(f.current.owner) : ""}${f.current.blocker ? " · blocked: " + esc(f.current.blocker) : ""}</small></span>
      <span class="d">${dateOr(f.milestones.get(f.current.id)?.baseline)}<small>committed</small></span>
      <span class="d">${dateOr(f.milestones.get(f.current.id)?.forecast)}<small>forecast</small></span>
      ${slipTag(f.milestones.get(f.current.id)?.slipDays)}<span></span></div>`
      : `<div class="muted small">No milestones on this project. <button class="btn xs" data-act="drawer-tab" data-tab="milestones">Add a chain</button></div>`}

    <div class="section-t">Latest update</div>
    ${u ? updateCard(u, p) : `<div class="muted small">Nothing logged yet.${canEdit() ? ` <button class="btn xs" data-act="open-update" data-id="${esc(p.id)}">Add the first one</button>` : ""}</div>`}

    <div class="section-t">Setup</div>
    <form id="proj-form" data-guard="project:${esc(p.id)}" data-submit="save-project" data-id="${esc(p.id)}">
      <div class="form-grid">
        ${field("Client", inp("client", p.client, { list: "dl-clients" }))}
        ${field("Project name", inp("projectName", p.projectName))}
        ${field("Primary DM", inp("primaryDm", p.primaryDm, { list: "dl-roster" }))}
        ${field("Additional DMs", inp("dms", (p.dms || []).filter((x) => x !== p.primaryDm).join(", "), { list: "dl-roster", attrs: 'placeholder="comma separated"' }))}
        ${field("SDM", inp("sdm", p.sdm, { list: "dl-roster" }))}
        ${field("Pod owner", inp("podOwner", p.podOwner, { list: "dl-roster" }))}
        ${field("Editors", inp("editorLeads", (p.editorLeads || []).join(", "), { list: "dl-editors", attrs: 'placeholder="comma separated"' }), { hint: "Assignments on the Team tab add editors here too." })}
        ${field("Status", sel("status", ["Active", "On Hold", "Upcoming", "Completed"], p.status, { blank: null }))}
        ${field("Priority", sel("priority", ["High", "Medium", "Low"], p.priority, { blank: "— not set —" }))}
        ${field("Categories", inp("categories", (p.categories || []).join(", "), { list: "dl-cats", attrs: 'placeholder="comma separated"' }))}
        ${field("Revenue for this row (₹)", inp("revenue", Number(p.revenue) > 0 ? p.revenue : "", { type: "number", attrs: 'min="0" step="1000"' }), { hint: "Blank = this row's share of the client booking." })}
        ${field("Delivery effort", sel("effort", Object.entries(EFFORT_LABELS).map(([v, l]) => [v, `${l} · ${v} pt${v === "1" ? "" : "s"}`]), p.effort || "", { blank: `Assume from service line${e.source === "assumed" ? ` (${EFFORT_LABELS[e.base]})` : ""}` }))}
        ${field("Tags", inp("tags", (p.tags || []).join(", "), { attrs: 'placeholder="comma separated"' }))}
      </div>
      <div class="section-t">Dates</div>
      <div class="form-grid">
        ${field("Start", inp("start", p.start, { type: "date" }))}
        ${field("Committed delivery", inp("end", p.end, { type: "date", attrs: p.openEnded ? "disabled" : "" }), { hint: p.history?.some((h) => h.field === "end") ? "Moved before — see Activity." : "The client's date. Moving it needs a reason." })}
        ${field("Reason for a date change", inp("reason", "", { attrs: 'placeholder="Required when the committed date moves"' }), { cls: "wide" })}
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
        <label class="check"><input type="checkbox" data-field="openEnded" ${p.openEnded ? "checked" : ""} data-change="toggle-open"> Open-ended / recurring</label>
        <label class="check"><input type="checkbox" data-field="baselineLocked" ${p.baselineLocked ? "checked" : ""}> Lock the committed date</label>
      </div>
      ${(p.startNote || p.endNote) ? `<div class="sheetnote" style="margin-top:8px">✎ the sheet said: ${esc([p.startNote, p.endNote].filter(Boolean).join(" → "))}</div>` : ""}
      <div class="section-t">Forecast override</div>
      <div class="form-grid">
        ${field("Override the forecast to", inp("overrideDate", p.deliveryOverride?.date || "", { type: "date" }), { hint: p.deliveryOverride ? `Set by ${esc(p.deliveryOverride.by)} ${esc(ago(p.deliveryOverride.at.slice(0, 10)))}: ${esc(p.deliveryOverride.reason)}` : "Only when you know better than the milestone arithmetic." })}
        ${field("Reason", inp("overrideReason", p.deliveryOverride?.reason || ""))}
      </div>
      ${datalist("dl-clients", allOf("client"))}${datalist("dl-roster", roster())}${datalist("dl-editors", editorNames())}${datalist("dl-cats", categoryNames())}
    </form>

    ${risks.length ? `<div class="section-t">Flags</div><div style="display:flex;flex-wrap:wrap;gap:5px">${risks.map((r) => `<span class="status ${r.sev === 2 ? "risk" : "watch"}"><span class="ic">${r.sev === 2 ? "▲" : "●"}</span>${esc(r.label)}</span>`).join("")}</div>` : ""}
    <div class="section-t">Reference</div>
    <dl class="kv">
      <dt>Sheet row</dt><dd class="num">${p.sourceRow || "—"}</dd>
      <dt>WhatsApp</dt><dd>${esc(p.waGroupLink || "—")}</dd>
      <dt>Effort</dt><dd>${esc(e.why)} (${num(e.points, 1)} pts)</dd>
      ${p.editedBy ? `<dt>Last edited</dt><dd>${esc(p.editedBy)} · ${esc(ago(String(p.editedAt).slice(0, 10)))}</dd>` : ""}
      ${p.importedAt ? `<dt>Last import</dt><dd>${esc(ago(String(p.importedAt).slice(0, 10)))}</dd>` : ""}
    </dl>`;
}

function scope(p) {
  const sc = scopeCompletion(p);
  const u = p.scopeUnits || {};
  return `
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <div class="kpi"><div class="k">Scope completion</div><div class="v">${sc.pct == null ? notSet("Not measurable") : `${Math.round(sc.pct)}<small>%</small>`}</div><div class="n">${esc(sc.label)}</div></div>
      <div class="kpi"><div class="k">Revenue</div><div class="v" style="font-size:16px">${shareOf(p) > 0 ? esc(money(shareOf(p))) : notSet()}</div></div>
    </div>
    ${sc.pct != null ? `<div class="progress" style="margin:4px 0 14px"><i class="${sc.measured ? "" : "est"}" style="width:${sc.pct}%"></i></div>` : ""}
    <form id="proj-form" data-guard="project:${esc(p.id)}" data-submit="save-project" data-id="${esc(p.id)}">
      ${field("Locked scope (as agreed on HubSpot)", `<textarea data-field="scopeLocked" rows="6">${esc(p.scopeLocked || p.scope || "")}</textarea>`)}
      ${field("Completed / delivered so far", `<textarea data-field="scopeCompleted" rows="3">${esc(p.scopeCompleted || p.completedFromScope || "")}</textarea>`, { hint: "Free text, as the DM reports it. Measurable units go below." })}
      <div class="section-t">Measurable units (optional)</div>
      <div class="form-grid">
        ${field("Locked quantity", inp("scopeLocked_n", u.locked ?? "", { type: "number", attrs: 'min="0" step="1"' }))}
        ${field("Completed quantity", inp("scopeCompleted_n", u.completed ?? "", { type: "number", attrs: 'min="0" step="1"' }))}
        ${field("Unit", inp("scopeUnit", u.unit || "", { attrs: 'placeholder="videos, minutes, adapts"' }))}
        ${field("DM progress estimate (%)", inp("progress", p.progress ?? "", { type: "number", attrs: 'min="0" max="100" step="5"' }), { hint: "Used only when there are no measurable units." })}
      </div>
    </form>
    <div class="section-t">Remaining</div>
    <div class="muted small">${u.locked > 0 && Number.isFinite(Number(u.completed)) ? `${Math.max(0, u.locked - u.completed)} ${esc(u.unit || "")} remaining of ${u.locked}` : "Set locked and completed quantities to see what remains."}</div>`;
}

function milestones(p, x) {
  const list = milestonesOf(p);
  const f = forecastOf(p);
  const d = deliveryOf(p);
  const editing = x.editMs;
  const impact = x.impact;

  const row = (m) => {
    const fm = f.milestones.get(m.id) || {};
    const deps = (m.dependsOn || []).map((id) => list.find((z) => z.id === id)?.title).filter(Boolean);
    if (editing === m.id) return msEditor(p, m, list, impact);
    return `
      <div class="ms">
        <span class="st ${fm.done ? "done" : fm.blocked ? "blocked" : fm.overdue ? "late" : m.status}" data-tip="${esc(fm.done ? "Done " + fmtDateFull(m.actualDone) : msStatusLabel[m.status] || "")}"></span>
        <span class="t"><span style="display:flex;gap:6px;align-items:center;min-width:0"><span class="ell">${esc(m.title)}</span>${m.locked ? `<span class="muted" data-tip="Baseline locked">🔒</span>` : ""}${m.external ? `<span class="chip" style="padding:0 6px">client</span>` : ""}${fm.cycle ? `<span class="status risk"><span class="ic">▲</span>cycle</span>` : ""}</span>
          <small>${esc(m.owner || m.ownerType || "")}${deps.length ? ` · after ${esc(deps.join(", "))}` : ""}${m.durationDays ? ` · ${m.durationDays}d` : fm.missing?.includes("duration") ? ` · <span style="color:var(--warn-ink)">no duration</span>` : ""}${m.blocker ? ` · <span style="color:var(--crit-ink)">${esc(m.blocker)}</span>` : ""}${fm.etaOptimisticBy ? ` · <span style="color:var(--warn-ink)">owner's date ${fm.etaOptimisticBy}d optimistic</span>` : ""}</small></span>
        <span class="d">${dateOr(fm.baseline, "no date")}<small>committed</small></span>
        <span class="d">${fm.done ? dateOr(m.actualDone) : dateOr(fm.forecast, "—")}<small>${fm.done ? "done" : fm.drivenBy === "override" ? "override" : fm.drivenBy === "eta" ? "owner's date" : fm.drivenBy === "dependency" ? "after deps" : fm.drivenBy === "progress" ? "remaining work" : "forecast"}</small></span>
        ${fm.done ? slipTag(fm.slipDays) : slipTag(fm.slipDays)}
        <span class="acts">${canEdit() ? `
          ${fm.done ? `<button class="btn xs ghost" data-act="ms-reopen" data-id="${esc(m.id)}" data-tip="Reopen">↺</button>` : `<button class="btn xs" data-act="ms-done" data-id="${esc(m.id)}" data-tip="Mark done today">✓</button>`}
          <button class="btn xs ghost" data-act="ms-edit" data-id="${esc(m.id)}">Edit</button>` : ""}</span>
      </div>`;
  };

  return `
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <div class="kpi"><div class="k">Committed</div><div class="v" style="font-size:15px">${d.baseline ? esc(fmtDateFull(d.baseline)) : notSet()}</div>${d.baselineOriginal && d.baselineOriginal !== d.baseline ? `<div class="n">originally ${esc(fmtDateFull(d.baselineOriginal))}</div>` : ""}</div>
      <div class="kpi ${d.forecastMiss ? "hot" : ""}"><div class="k">Forecast</div><div class="v" style="font-size:15px">${d.forecast ? esc(fmtDateFull(d.forecast)) : notSet()}</div><div class="n">${d.slipDays != null ? (d.slipDays > 0 ? `${d.slipDays}d late` : "on time") : ""}</div></div>
      <div class="kpi"><div class="k">Progress</div><div class="v">${f.doneCount}<small>/ ${f.total}</small></div><div class="n">milestones done</div></div>
      <div class="kpi ${f.overdueMilestones.length ? "warm" : ""}"><div class="k">Overdue</div><div class="v">${f.overdueMilestones.length}</div></div>
    </div>
    ${f.cycle ? `<div class="callout crit" style="margin-bottom:10px"><span>▲</span><div>There is a dependency loop in this chain. Forecasts ignore the looping links until it is fixed.</div></div>` : ""}
    <div class="section-t">Chain <span class="spacer"></span>
      ${canEdit() ? `${list.length ? "" : `<button class="btn xs primary" data-act="apply-template" data-id="${esc(p.id)}">Apply template chain</button>`}<button class="btn xs" data-act="ms-new" data-id="${esc(p.id)}">Add milestone</button>` : ""}</div>
    ${list.length ? `<div class="chain">${list.map(row).join("")}</div>` : `<div class="empty" style="padding:20px"><div class="big">No milestones yet</div>Apply the template chain (Brief → Script → Storyboard → Base video → Feedback → Revisions → Adaptations → QC → Final delivery) or add your own.</div>`}
    ${editing === "new" ? msEditor(p, null, list, impact) : ""}
    <div class="section-t">How forecasts work</div>
    <div class="muted small">A milestone's committed date never moves on its own. Its forecast is the latest of the owner's date, the working day after its dependencies finish plus its duration, and today. Moving a date shows what shifts downstream before you save; a conflict with another project's editor is a warning, never an automatic reschedule.</div>`;
}

function msEditor(p, m, list, impact) {
  const isNew = !m;
  const cur = m || { title: "", stage: "custom", owner: "", ownerType: "DM", startDate: "", baselineDue: "", ownerEta: "", durationDays: "", dependsOn: [], status: "planned", blocker: "", locked: false, external: false, override: null, actualDone: null };
  const others = list.filter((z) => !m || z.id !== m.id);
  return `
    <form class="ms editing" data-guard="ms:${esc(m?.id || "new")}" data-submit="ms-save" data-id="${esc(p.id)}" ${m ? `data-ms="${esc(m.id)}"` : ""}>
      <div class="form-grid">
        ${field("Title", `<input name="title" value="${esc(cur.title)}" required>`)}
        ${field("Stage", `<select name="stage">${Object.entries(SCH.STAGES).map(([k, l]) => `<option value="${k}" ${cur.stage === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`)}
        ${field("Owner", `<input name="owner" list="dl-roster" value="${esc(cur.owner || "")}">`)}
        ${field("Owner type", `<select name="ownerType">${OWNER_TYPES.map((o) => `<option ${cur.ownerType === o ? "selected" : ""}>${o}</option>`).join("")}</select>`)}
        ${field("Start", `<input type="date" name="startDate" value="${esc(cur.startDate || "")}">`)}
        ${field("Committed due", `<input type="date" name="baselineDue" value="${esc(cur.baselineDue || "")}" data-change="ms-touched">`)}
        ${field("Duration (working days)", `<input type="number" name="durationDays" min="0" value="${esc(cur.durationDays ?? "")}" data-change="ms-touched">`)}
        ${field("Owner's current date", `<input type="date" name="ownerEta" value="${esc(cur.ownerEta || "")}" data-change="ms-touched">`, { hint: "The promise, not the commitment." })}
        ${field("Depends on", `<select name="dependsOn" multiple size="${Math.min(5, Math.max(2, others.length))}" data-change="ms-touched">${others.map((z) => `<option value="${esc(z.id)}" ${(cur.dependsOn || []).includes(z.id) ? "selected" : ""}>${esc(z.title)}</option>`).join("")}</select>`, { hint: "Ctrl/⌘-click for several." })}
        ${field("Status", `<select name="status" data-change="ms-touched">${SCH.MILESTONE_STATUSES.map((s) => `<option value="${s}" ${cur.status === s ? "selected" : ""}>${msStatusLabel[s]}</option>`).join("")}</select>`)}
        ${field("Blocker", `<input name="blocker" value="${esc(cur.blocker || "")}">`)}
        ${field("Done on", `<input type="date" name="actualDone" value="${esc(cur.actualDone || "")}" data-change="ms-touched">`)}
        ${field("Override forecast to", `<input type="date" name="overrideDate" value="${esc(cur.override?.date || "")}" data-change="ms-touched">`, { hint: cur.override ? `by ${esc(cur.override.by)}: ${esc(cur.override.reason)}` : "" })}
        ${field("Override reason", `<input name="overrideReason" value="${esc(cur.override?.reason || "")}">`)}
        ${field("Reason for this change", `<input name="reason" placeholder="Required when a committed date moves">`, { cls: "wide" })}
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin:8px 0">
        <label class="check"><input type="checkbox" name="locked" ${cur.locked ? "checked" : ""}> Lock the committed date</label>
        <label class="check"><input type="checkbox" name="external" ${cur.external ? "checked" : ""}> External dependency (client-side)</label>
      </div>
      ${impact ? impactBox(impact, p) : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" type="submit">${isNew ? "Add milestone" : "Save"}</button>
        ${!isNew ? `<button class="btn" type="button" data-act="ms-preview" data-id="${esc(m.id)}">Preview impact</button><button class="btn danger" type="button" data-act="ms-delete" data-id="${esc(m.id)}">Delete</button>` : ""}
        <button class="btn ghost" type="button" data-act="ms-cancel">Cancel</button>
      </div>
      ${datalist("dl-roster", roster())}
    </form>`;
}

export function impactBox(im, p) {
  const dl = im.delivery;
  return `
    <div class="impact" style="margin-bottom:10px">
      <div class="row"><span>Final delivery</span><span class="num">${dl.before ? esc(fmtDateFull(dl.before)) : "—"} → <b>${dl.after ? esc(fmtDateFull(dl.after)) : "—"}</b>${dl.baseline ? ` <span class="muted">(committed ${esc(fmtDate(dl.baseline))})</span>` : ""}</span></div>
      ${dl.forecastMiss ? `<div class="warn">Forecast would pass the committed date by ${dl.slipDays} day${dl.slipDays === 1 ? "" : "s"}${im.affectsCommitment ? " — this is the change that breaks it" : ""}.</div>` : `<div style="color:var(--good-ink)">Still inside the commitment.</div>`}
      ${im.moved.length ? `<div><b>${im.moved.length} milestone${im.moved.length > 1 ? "s" : ""} move</b><ul>${im.moved.slice(0, 8).map((m) => `<li>${esc(m.title)}: ${m.from ? esc(fmtDate(m.from)) : "—"} → ${m.to ? esc(fmtDate(m.to)) : "—"}${m.days ? ` (${m.days > 0 ? "+" : ""}${m.days}d)` : ""}</li>`).join("")}${im.moved.length > 8 ? `<li>…and ${im.moved.length - 8} more</li>` : ""}</ul></div>` : `<div class="muted">No other milestone moves.</div>`}
      ${im.conflicts.length ? `<div class="warn"><b>Resource conflict</b><ul>${im.conflicts.map((c) => `<li>${esc(c.editor)} is also on ${esc(projectById(c.otherProjectId)?.label || c.otherProjectId)} for ${c.overlapWorkingDays} working day${c.overlapWorkingDays === 1 ? "" : "s"} of this window${c.hoursKnown ? ` — ${c.hoursOver}h over capacity` : " — hours unknown"}</li>`).join("")}</ul>That project is not rescheduled; someone decides.</div>` : ""}
      ${im.reschedule?.length ? `<div class="warn">Pinned assignments ending before the new date: ${im.reschedule.map((r) => esc(r.editor)).join(", ")} — reschedule on the Team tab.</div>` : ""}
    </div>`;
}

function updateCard(u, p) {
  const ms = u.milestoneId ? milestonesOf(p).find((m) => m.id === u.milestoneId) : null;
  return `
    <article class="post" style="padding:10px 0">
      ${avatar(u.author)}
      <div class="post-b">
        <div class="post-h"><span class="nm">${esc(u.author)}</span>${u.status ? `<span class="chip">${esc(u.status)}</span>` : ""}<span class="meta">${esc(fmtDateFull(u.date))} · ${esc(ago(u.date))}${u.imported || u.seeded ? " · from the sheet" : ""}${u.draft ? " · draft" : ""}</span>
          ${(u.author === S.me || u.seeded || u.imported) && canEdit() ? `<button class="btn xs ghost kill" style="margin-left:auto" data-act="del-update" data-id="${esc(u.id)}">Delete</button>` : ""}</div>
        <div class="post-txt">${esc(u.completed || u.text)}</div>
        ${u.planned ? `<div class="post-txt"><b>Next</b>${esc(u.planned)}</div>` : ""}
        ${u.progressNote ? `<div class="post-txt"><b>Scope</b>${esc(u.progressNote)}</div>` : ""}
        ${u.blockers ? `<div class="post-blocker"><span>▲</span><span>${esc(u.blockers)}${u.dependencyOwner ? ` <span class="muted">· on ${esc(u.dependencyOwner)}</span>` : ""}${u.expectedResolution ? ` <span class="muted">· expected ${esc(fmtDate(u.expectedResolution))}</span>` : ""}</span></div>` : ""}
        ${u.nextAction ? `<div class="post-next"><span>→</span><span>${esc(u.nextAction)}${u.nextActionOwner ? ` <span class="muted">· ${esc(u.nextActionOwner)}</span>` : ""}</span></div>` : ""}
        <div class="post-tags">
          ${ms ? `<span class="chip">on ${esc(ms.title)}</span>` : ""}
          ${u.nextMilestoneDate ? `<span class="chip ring">next milestone ${esc(fmtDate(u.nextMilestoneDate))}</span>` : u.eta ? `<span class="chip ring">next delivery ${esc(fmtDate(u.eta))}</span>` : ""}
          ${u.forecastDelivery ? `<span class="chip ring">DM forecast ${esc(fmtDate(u.forecastDelivery))}</span>` : ""}
          ${u.escalationRequired ? `<span class="sev ${esc(u.escalationSeverity || "medium")}">escalation</span>` : ""}
        </div>
      </div>
    </article>`;
}

function updates(p) {
  const list = (updatesByProject()[p.id] || []);
  const drafts = S.data.updates.filter((u) => u.draft && u.projectId === p.id && u.author === S.me);
  return `
    ${drafts.length ? `<div class="callout warn" style="margin-bottom:10px"><span>✎</span><div>You have ${drafts.length} draft${drafts.length > 1 ? "s" : ""} here. ${drafts.map((d) => `<button class="btn xs" data-act="open-update" data-id="${esc(p.id)}" data-draft="${esc(d.id)}">Continue ${esc(fmtDate(d.date))}</button>`).join(" ")}</div></div>` : ""}
    <div class="section-t">Chronological history <span class="chip ring">${list.length}</span><span class="spacer"></span>${canEdit() ? `<button class="btn xs primary" data-act="open-update" data-id="${esc(p.id)}">Add daily update</button>` : ""}</div>
    ${list.length ? `<div class="feed">${list.map((u) => updateCard(u, p)).join("")}</div>` : `<div class="muted small">Nothing logged yet.</div>`}`;
}

function team(p) {
  const as = assignmentsOf(p);
  const resolved = resolvedAssignments().filter((a) => a.projectId === p.id);
  const eds = editorsOf(p);
  return `
    <div class="section-t">Ownership</div>
    <dl class="kv">
      <dt>Primary DM</dt><dd>${p.primaryDm ? `${avatar(p.primaryDm, "sm")} ${esc(p.primaryDm)}` : notSet()}</dd>
      <dt>Additional DMs</dt><dd>${(p.dms || []).filter((x) => x !== p.primaryDm).map((n) => `${avatar(n, "sm")} ${esc(n)}`).join(" · ") || "—"}</dd>
      <dt>SDM</dt><dd>${p.sdm ? esc(p.sdm) : notSet()}</dd>
      <dt>Editors</dt><dd>${eds.map((n) => `<button class="chip ring" data-act="open-person" data-name="${esc(n)}">${avatar(n, "sm")} ${esc(n)}</button>`).join(" ") || notSet("No editor assigned")}</dd>
    </dl>
    <div class="section-t">Assignments <span class="chip ring">${as.length}</span><span class="spacer"></span>${canEdit() ? `<button class="btn xs primary" data-act="open-assign" data-id="${esc(p.id)}">Assign an editor</button>` : ""}</div>
    ${as.length ? `<div class="scroller"><table class="rows compact">
      <thead><tr><th>Editor</th><th>Work</th><th>Window</th><th class="r">Hours</th><th>Status</th><th></th></tr></thead>
      <tbody>${resolved.map((a) => {
        const m = a.milestoneId ? milestonesOf(p).find((z) => z.id === a.milestoneId) : null;
        return `<tr>
          <td><div class="cell-name">${avatar(a.editor, "sm")} ${esc(a.editor)}</div></td>
          <td>${m ? esc(m.title) : '<span class="muted">whole project</span>'}${a.note ? `<div class="cell-sub">${esc(a.note)}</div>` : ""}</td>
          <td class="num">${a.start ? `${esc(fmtDate(a.start))} → ${esc(fmtDate(a.end))}` : notSet("no window")}${a.derived ? `<div class="cell-sub">follows the milestone</div>` : ""}</td>
          <td class="r num">${a.estimatedHours > 0 ? hrs(a.estimatedHours) : `<span class="notset" data-tip="No estimate — shown as unestimated, never zero">unestimated</span>`}</td>
          <td><span class="status ${a.status === "done" ? "done" : a.status === "active" ? "active" : "upcoming"}"><span class="ic">●</span>${esc(a.status)}</span></td>
          <td class="r">${canEdit() ? `<button class="btn xs ghost" data-act="open-assign" data-id="${esc(p.id)}" data-assignment="${esc(a.id)}">Edit</button>` : ""}</td>
        </tr>`;
      }).join("")}</tbody></table></div>` : `<div class="muted small">No editor assignments yet. Assignments carry hours, which is what the Editor Allocation page measures capacity with.</div>`}`;
}

function escalations(p) {
  const list = escalationsByProject()[p.id] || [];
  return `
    <div class="section-t">Escalations <span class="chip ring">${list.length}</span><span class="spacer"></span>${canEdit() ? `<button class="btn xs primary" data-act="open-escalation" data-id="${esc(p.id)}">Raise an escalation</button>` : ""}</div>
    ${list.length ? `<div class="scroller"><table class="rows compact">
      <thead><tr><th>Reason</th><th>Severity</th><th>Owner</th><th>Raised</th><th>Deadline</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((e) => `<tr class="clickable" data-act="open-escalation" data-id="${esc(p.id)}" data-escalation="${esc(e.id)}">
        <td><div class="cell-name">${esc(e.reason)}</div>${e.nextAction ? `<div class="cell-sub">→ ${esc(e.nextAction)}${e.nextActionOwner ? ` · ${esc(e.nextActionOwner)}` : ""}</div>` : ""}</td>
        <td>${sevPill(e.severity)}</td><td>${esc(e.owner || "—")}</td>
        <td class="num">${esc(fmtDate(e.raisedOn))}<div class="cell-sub">${esc(ago(e.raisedOn))}</div></td>
        <td class="num ${e.resolutionTarget && e.status !== "resolved" && e.resolutionTarget < TODAY ? "" : "muted"}" style="${e.resolutionTarget && e.status !== "resolved" && e.resolutionTarget < TODAY ? "color:var(--crit-ink)" : ""}">${e.resolutionTarget ? esc(fmtDate(e.resolutionTarget)) : "—"}</td>
        <td>${escStatus(e.status)}</td><td class="r">${e.comments.length ? `<span class="chip">${e.comments.length} 💬</span>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="muted small">No escalations on this project.</div>`}`;
}

function history(p) {
  const items = [];
  (p.history || []).forEach((h) => items.push({ at: h.at, by: h.by, what: `<b>${esc(h.field === "end" ? "Committed delivery" : h.field === "deliveryOverride" ? "Forecast override" : h.field)}</b> ${h.from ? esc(fmtDateFull(h.from)) : "—"} → ${h.to ? esc(fmtDateFull(h.to)) : "—"}`, why: h.reason }));
  milestonesOf(p).forEach((m) => (m.history || []).forEach((h) => items.push({ at: h.at, by: h.by, what: `<b>${esc(m.title)}</b> · ${esc(h.field)}: ${fmtAny(h.from)} → ${fmtAny(h.to)}${h.delivery && h.delivery.before !== h.delivery.after ? ` <span class="muted">(delivery ${h.delivery.before ? esc(fmtDate(h.delivery.before)) : "—"} → ${h.delivery.after ? esc(fmtDate(h.delivery.after)) : "—"})</span>` : ""}`, why: h.reason })));
  (escalationsByProject()[p.id] || []).forEach((e) => {
    items.push({ at: e.raisedAt, by: e.raisedBy, what: `<b>Escalation raised</b> · ${esc(e.reason)} (${esc(e.severity)})` });
    (e.history || []).forEach((h) => items.push({ at: h.at, by: h.by, what: `<b>Escalation</b> ${esc(h.field)}: ${fmtAny(h.from)} → ${fmtAny(h.to)}` }));
    e.comments.forEach((c) => items.push({ at: c.at, by: c.by, what: `<b>Comment</b> ${esc(c.text)}` }));
  });
  assignmentsOf(p).forEach((a) => {
    items.push({ at: a.createdAt, by: a.createdBy, what: `<b>Assigned</b> ${esc(a.editor)}${a.estimatedHours ? ` · ${hrs(a.estimatedHours)}` : ""}` });
    (a.history || []).forEach((h) => items.push({ at: h.at, by: h.by, what: `<b>Assignment</b> ${esc(h.field)}: ${fmtAny(h.from)} → ${fmtAny(h.to)}`, why: h.reason }));
  });
  (updatesByProject()[p.id] || []).forEach((u) => items.push({ at: u.createdAt, by: u.author, what: `<b>Update</b> ${esc((u.completed || u.text || "").slice(0, 120))}` }));
  (S.data.audit || []).filter((a) => a.target === p.id && !/^(update|milestone|assignment|escalation)/.test(a.action)).forEach((a) => items.push({ at: a.ts, by: a.who, what: `<b>${esc(a.action)}</b> ${esc(a.detail || "")}` }));
  if (p.createdAt) items.push({ at: p.createdAt, by: p.createdBy || "system", what: "<b>Created</b>" });
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return `
    <div class="section-t">Everything that happened <span class="chip ring">${items.length}</span></div>
    ${items.length ? `<div class="hist">${items.slice(0, 200).map((i) => `<div><span class="when">${esc(fmtDateTime(i.at))}<br>${esc(i.by || "")}</span><span class="what">${i.what}${i.why ? `<div class="why">${esc(i.why)}</div>` : ""}</span></div>`).join("")}</div>` : `<div class="muted small">No history yet.</div>`}`;
}

const fmtAny = (v) => (v == null || v === "" ? "—" : Array.isArray(v) ? esc(v.join(", ")) : isISO(v) ? esc(fmtDateFull(v)) : typeof v === "boolean" ? (v ? "yes" : "no") : esc(String(v)));

/* ------------------------------------------------------------ person */

export function renderPersonDrawer(name) {
  const person = personByName(name);
  const hats = rolesOf(name);
  const mine = myProjects(name);
  const dmRows = loadRollup("dms").find((x) => x.name === name);
  const edRows = loadRollup("editorLeads").find((x) => x.name === name);
  const resolved = resolvedAssignments().filter((a) => a.editor === name && a.status !== "done");
  const set = settings();
  const from = TODAY, to = new Date(Date.parse(TODAY) + 13 * 864e5).toISOString().slice(0, 10);
  const u = person ? SCH.utilisation({ person, assignments: resolvedAssignments(), from, to, settings: set }) : null;
  const isEditor = hats.includes("Editor") || (person?.roles || []).some((r) => r === "editorLead" || r === "editor");

  return `
    <div class="scrim" data-act="close-drawer"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(name)}">
      <header class="drawer-h">
        ${avatar(name, "lg")}
        <div style="flex:1;min-width:0"><h2>${esc(name)}</h2><div class="muted small">${esc(hats.join(" · ") || (person?.roles || []).join(", ") || "Not named on any project")}</div></div>
        <button class="btn sm ghost" data-act="close-drawer" aria-label="Close">✕</button>
      </header>
      <div class="drawer-b">
        <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
          <div class="kpi"><div class="k">Projects</div><div class="v">${mine.length}</div><div class="n">${mine.filter((p) => statusKind(p.status) === "active").length} active</div></div>
          ${isEditor ? `<div class="kpi"><div class="k">Next 2 weeks</div><div class="v" style="font-size:16px">${utilPill(u)}</div><div class="n">${u ? `${u.scheduled}h of ${u.capacity}h` : ""}</div></div>` : ""}
          <div class="kpi"><div class="k">Revenue touched</div><div class="v" style="font-size:16px">${esc(money(mine.reduce((s, p) => s + shareOf(p), 0)))}</div></div>
          ${dmRows ? `<div class="kpi"><div class="k">Effort as DM</div><div class="v">${esc(num(dmRows.points, 1))}<small>pts</small></div><div class="n">assumed load</div></div>` : ""}
        </div>
        ${isEditor && person ? `
          <div class="section-t">Capacity</div>
          <form data-submit="save-person" data-id="${esc(person.id)}" data-guard="person:${esc(person.id)}" class="form-grid">
            ${field("Hours per week", `<input type="number" name="capacityHoursPerWeek" min="0" max="100" value="${esc(person.capacityHoursPerWeek ?? "")}" ${canEdit() ? "" : "disabled"}>`)}
            ${field("Availability", `<select name="availability" ${canEdit() ? "" : "disabled"}><option value="available" ${person.availability?.status === "available" ? "selected" : ""}>Available</option><option value="limited" ${person.availability?.status === "limited" ? "selected" : ""}>Limited (half)</option><option value="out" ${person.availability?.status === "out" ? "selected" : ""}>Out</option></select>`)}
            ${field("Until", `<input type="date" name="until" value="${esc(person.availability?.until || "")}" ${canEdit() ? "" : "disabled"}>`)}
            ${field("Skills", `<input name="skills" value="${esc((person.skills || []).join(", "))}" placeholder="cinematic, lipsync, motion" ${canEdit() ? "" : "disabled"}>`)}
            ${canEdit() ? `<div class="wide"><button class="btn sm primary" type="submit">Save</button></div>` : ""}
          </form>
          <div class="section-t">Scheduled work <span class="chip ring">${resolved.length}</span></div>
          ${resolved.length ? `<div class="scroller"><table class="rows compact"><thead><tr><th>Project</th><th>Work</th><th>Window</th><th class="r">Hours</th></tr></thead><tbody>
            ${resolved.sort((a, b) => String(a.end || "9").localeCompare(String(b.end || "9"))).map((a) => { const p = projectById(a.projectId); const m = a.milestoneId ? S.data.milestones.find((z) => z.id === a.milestoneId) : null;
              return `<tr class="clickable" data-act="open-project" data-id="${esc(a.projectId)}"><td>${esc(p?.label || a.projectId)}</td><td>${m ? esc(m.title) : "whole project"}</td><td class="num">${a.start ? `${esc(fmtDate(a.start))} → ${esc(fmtDate(a.end))}` : "—"}</td><td class="r num">${a.estimatedHours > 0 ? hrs(a.estimatedHours) : '<span class="notset">unestimated</span>'}</td></tr>`; }).join("")}
          </tbody></table></div>` : `<div class="muted small">No scheduled assignments.</div>`}` : ""}
        <div class="section-t">Projects</div>
        <div class="scroller"><table class="rows compact"><thead><tr><th>Project</th><th>Health</th><th>Delivery</th><th>Last update</th></tr></thead><tbody>
          ${mine.map((p) => `<tr class="clickable" data-act="open-project" data-id="${esc(p.id)}"><td>${esc(p.label)}</td><td>${healthPill(p, true)}</td><td>${deliveryCell(p)}</td><td class="muted">${lastUpdate(p) ? esc(ago(lastUpdate(p).date)) : "never"}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No projects name ${esc(name)}.</td></tr>`}
        </tbody></table></div>
      </div>
      <footer class="drawer-f">
        <button class="btn" data-act="filter-person" data-person="${esc(name)}">See in the register</button>
        <button class="btn ghost" data-act="close-drawer">Close</button>
      </footer>
    </aside>`;
}

/** Read the setup form back into a PATCH body. Only fields present on the
    current tab are sent, so a save from Scope never touches the dates. */
export function readProjectForm(root, p) {
  const get = (name) => root.querySelector(`[data-field="${name}"]`);
  const val = (name) => { const el = get(name); return el ? el.value.trim() : undefined; };
  const list = (name) => { const v = val(name); return v === undefined ? undefined : v.split(",").map((s) => s.trim()).filter(Boolean); };
  const out = {};
  const put = (k, v) => { if (v !== undefined) out[k] = v; };

  put("client", val("client")); put("projectName", val("projectName"));
  const primary = val("primaryDm");
  const extra = list("dms");
  if (primary !== undefined || extra !== undefined) {
    const all = [...new Set([primary, ...(extra || [])].filter(Boolean))];
    put("dms", all); put("primaryDm", primary || all[0] || "");
  }
  put("sdm", val("sdm")); put("podOwner", val("podOwner")); put("editorLeads", list("editorLeads"));
  put("status", val("status")); put("priority", val("priority")); put("categories", list("categories")); put("tags", list("tags"));
  const rev = val("revenue"); if (rev !== undefined) out.revenue = rev === "" ? null : Number(rev);
  const eff = val("effort"); if (eff !== undefined) out.effort = eff === "" ? null : Number(eff);
  if (get("start")) put("start", val("start") || null);
  const openEl = get("openEnded");
  if (openEl) { out.openEnded = !!openEl.checked; out.end = openEl.checked ? null : (val("end") || null); }
  const lockEl = get("baselineLocked"); if (lockEl) out.baselineLocked = !!lockEl.checked;
  const reason = val("reason"); if (reason) out.reason = reason;
  const od = val("overrideDate");
  if (od !== undefined) {
    if (od) out.deliveryOverride = { date: od, reason: val("overrideReason") || "" };
    else if (p.deliveryOverride) out.deliveryOverride = null;
  }
  put("scopeLocked", val("scopeLocked")); put("scopeCompleted", val("scopeCompleted"));
  const ln = val("scopeLocked_n"), cn = val("scopeCompleted_n"), un = val("scopeUnit");
  if (ln !== undefined) out.scopeUnits = ln !== "" ? { locked: Number(ln), completed: cn !== "" ? Number(cn) : null, unit: un || "" } : null;
  const pr = val("progress"); if (pr !== undefined) out.progress = pr === "" ? null : Number(pr);
  return out;
}
