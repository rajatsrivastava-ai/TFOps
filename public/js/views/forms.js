/* Slide-over forms: the daily update, an assignment, an escalation, the sheet
   import, a new project, and the name picker. Each is a render function; the
   handlers live in app.js. Every form carries data-guard so a poll cannot
   repaint it while someone is typing. */

import { S, esc, money, fmtDate, fmtDateFull, ago, avatar, TODAY, hrs, num, canEdit, isISO, addDays } from "../core.js";
import {
  projects, projectById, milestonesOf, assignmentsOf, forecastOf, people, personByName, editorNames, roster, allOf,
  myProjects, SCH, settings, resolvedAssignments, escalationsByProject, categoryNames, dmNames, sdmNames,
} from "../compute.js";
import { healthPill, utilPill, utilMeterBar, sevPill, notSet, msStatusLabel } from "./shared.js";

const OWNER_TYPES = SCH.OWNER_TYPES;
const SEVS = SCH.SEVERITIES;

const shell = (title, sub, body, foot, cls = "", closeAct = "close-drawer") => `
  <div class="scrim" data-act="${closeAct}"></div>
  <aside class="drawer ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="drawer-h">
      <div style="flex:1;min-width:0"><h2>${esc(title)}</h2>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>
      <button class="btn sm ghost" data-act="${closeAct}" aria-label="Close">✕</button>
    </header>
    <div class="drawer-b">${body}</div>
    ${foot ? `<footer class="drawer-f">${foot}</footer>` : ""}
  </aside>`;

const field = (label, inner, { req = false, hint = "", cls = "" } = {}) => `
  <div class="field ${cls}"><label>${esc(label)}${req ? ' <span class="req">*</span>' : ""}</label>${inner}${hint ? `<span class="muted" style="font-size:11px">${hint}</span>` : ""}</div>`;
const sel = (name, options, cur, { blank = "", attrs = "" } = {}) => `
  <select name="${name}" ${attrs}>${blank !== null ? `<option value="">${esc(blank)}</option>` : ""}${options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(l)}</option>`;
  }).join("")}</select>`;
const datalist = (id, values) => `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;

/* ------------------------------------------------------ daily update */

export function renderUpdateForm(projectId, draftId = null) {
  const p = projectById(projectId);
  if (!p) return "";
  const d = draftId ? S.data.updates.find((u) => u.id === draftId) : null;
  const ms = milestonesOf(p);
  const f = forecastOf(p);
  const cur = d?.milestoneId || f.current?.id || "";
  const next = d?.nextMilestoneId || f.next?.id || "";
  const nextDate = d?.nextMilestoneDate || (f.next ? f.milestones.get(f.next.id)?.forecast : "") || "";
  const esc0 = d?.escalationRequired;

  const body = `
    <form id="update-form" data-guard="update:${esc(p.id)}" data-submit="submit-update" data-id="${esc(p.id)}" ${d ? `data-draft="${esc(d.id)}"` : ""} class="stack">
      <div class="form-grid">
        ${field("Update date", `<input type="date" name="date" value="${esc(d?.date || TODAY)}" max="${TODAY}" required>`, { req: true })}
        ${field("Current milestone", sel("milestoneId", ms.map((m) => [m.id, m.title + (f.milestones.get(m.id)?.done ? " ✓" : "")]), cur, { blank: ms.length ? "— pick —" : "No milestones yet" }))}
      </div>
      ${field("What was completed today?", `<textarea name="completed" rows="3" required placeholder="2 base videos delivered, 3 in edit. Client review call moved to Thursday.">${esc(d?.completed || d?.text || "")}</textarea>`, { req: true, cls: "wide" })}
      ${field("What is planned next?", `<textarea name="planned" rows="2" placeholder="Share storyboard v2 by Friday.">${esc(d?.planned || "")}</textarea>`)}
      <div class="form-grid">
        ${field("Progress against scope", `<input type="text" name="progressNote" value="${esc(d?.progressNote || "")}" placeholder="e.g. 7 of 20 videos delivered">`)}
        ${field("Completed from scope (updates the card)", `<input type="text" name="scopeCompleted" value="${esc(d?.scopeCompleted || p.scopeCompleted || "")}" placeholder="${esc(p.scopeCompleted || "Ongoing")}">`)}
      </div>
      <div class="section-t">Blockers and dependencies</div>
      <div class="form-grid">
        ${field("Blocker / dependency", `<input type="text" name="blockers" value="${esc(d?.blockers || "")}" placeholder="Waiting on brand kit since Monday">`, { cls: "wide" })}
        ${field("Dependency owner", sel("dependencyOwner", OWNER_TYPES, d?.dependencyOwner || "", { blank: "— none —" }))}
        ${field("Expected resolution", `<input type="date" name="expectedResolution" value="${esc(d?.expectedResolution || "")}">`)}
        ${field("Next action", `<input type="text" name="nextAction" value="${esc(d?.nextAction || "")}" placeholder="Chase brand kit on the client call">`)}
        ${field("Action owner", `<input type="text" name="nextActionOwner" list="dl-roster" value="${esc(d?.nextActionOwner || "")}">`)}
      </div>
      <div class="section-t">Dates</div>
      <div class="form-grid">
        ${field("Next milestone", sel("nextMilestoneId", ms.filter((m) => !m.actualDone).map((m) => [m.id, m.title]), next, { blank: "— pick —" }))}
        ${field("Next milestone date", `<input type="date" name="nextMilestoneDate" value="${esc(nextDate)}">`, { hint: "Recorded as the owner's promise for that milestone; the committed date does not move." })}
        ${field("Forecast final delivery", `<input type="date" name="forecastDelivery" value="${esc(d?.forecastDelivery || f.forecast || "")}">`, { hint: f.baseline ? `Committed: ${esc(fmtDateFull(f.baseline))}` : "No committed date on this project yet." })}
      </div>
      <div class="section-t">Escalation</div>
      <label class="check"><input type="checkbox" name="escalationRequired" ${esc0 ? "checked" : ""} data-change="toggle-esc"> Escalation required</label>
      <div id="esc-fields" class="form-grid ${esc0 ? "" : "hide"}" style="margin-top:8px">
        ${field("Escalation reason", `<input type="text" name="escalationReason" value="${esc(d?.escalationReason || "")}">`, { cls: "wide" })}
        ${field("Severity", sel("escalationSeverity", SEVS, d?.escalationSeverity || "medium", { blank: null }))}
      </div>
      ${datalist("dl-roster", roster())}
    </form>`;

  const foot = canEdit() && S.me ? `
    <button class="btn primary" data-act="submit-update-btn" data-mode="submit">Submit update</button>
    <button class="btn" data-act="submit-update-btn" data-mode="draft">Save draft</button>
    <button class="btn ghost" data-act="close-drawer">Cancel</button>
    <span class="muted small" style="margin-left:auto">Posting as ${esc(S.me)}</span>`
    : `<button class="btn ghost" data-act="close-drawer">Close</button><span class="muted small" style="margin-left:auto">${S.me ? "Read-only session" : "Set your name to post"}</span>`;

  return shell("Daily update", `${esc(p.client)}${p.projectName ? " — " + esc(p.projectName) : ""} ${healthPill(p, true)}`, body, foot);
}

/* ------------------------------------------------------- assignment */

export function renderAssignForm({ projectId, milestoneId = "", assignmentId = "", preview = null, editor = "", form = null }) {
  const a = assignmentId ? S.data.assignments.find((x) => x.id === assignmentId) : null;
  const p = projectById(a?.projectId || projectId);
  if (!p) return "";
  const ms = milestonesOf(p).filter((m) => !m.actualDone);
  // `form` is what was typed before an impact check repainted the drawer.
  const cur = { ...(a || { editor, milestoneId, estimatedHours: "", scheduledStart: "", scheduledEnd: "", status: "planned", note: "" }), ...(form || {}) };
  const editors = editorNames();
  const f = forecastOf(p);
  const msForecast = (id) => f.milestones.get(id)?.forecast || "";

  const body = `
    <form id="assign-form" data-guard="assign:${esc(p.id)}" data-submit="save-assignment" data-id="${esc(p.id)}" ${a ? `data-assignment="${esc(a.id)}"` : ""} class="stack">
      <div class="form-grid">
        ${field("Editor", `<input type="text" name="editor" list="dl-editors" value="${esc(cur.editor || "")}" required data-input="assign-changed">`, { req: true })}
        ${field("Milestone", sel("milestoneId", ms.map((m) => [m.id, `${m.title}${msForecast(m.id) ? " · due " + fmtDate(msForecast(m.id)) : ""}`]), cur.milestoneId || "", { blank: "Whole project", attrs: 'data-change="assign-changed"' }), { hint: "With a milestone and no dates below, the work follows the milestone when it moves." })}
        ${field("Estimated effort (hours)", `<input type="number" name="estimatedHours" min="0" step="0.5" value="${esc(cur.estimatedHours ?? "")}" data-input="assign-changed">`, { hint: "Leave blank if unknown — it is shown as unestimated, never as zero." })}
        ${field("Status", sel("status", [["planned", "Planned"], ["active", "Active"], ["done", "Done"], ["cancelled", "Cancelled"]], cur.status, { blank: null }))}
        ${field("Start", `<input type="date" name="scheduledStart" value="${esc(cur.scheduledStart || "")}" data-change="assign-changed">`)}
        ${field("End", `<input type="date" name="scheduledEnd" value="${esc(cur.scheduledEnd || "")}" data-change="assign-changed">`)}
        ${field("Note", `<input type="text" name="note" value="${esc(cur.note || "")}" placeholder="What exactly, for whom">`, { cls: "wide" })}
        ${a ? field("Reason for the change", `<input type="text" name="reason" placeholder="Why this is moving">`, { cls: "wide" }) : ""}
      </div>
      ${datalist("dl-editors", editors)}
    </form>
    <div class="section-t">Impact <span class="spacer"></span><button class="btn xs" data-act="preview-assignment">Check impact</button></div>
    <div id="assign-impact">${preview ? assignImpact(preview, cur.editor) : `<div class="muted small">Check impact to see this editor's load over the window, the best alternatives, and whether a committed delivery is affected.</div>`}</div>`;

  const foot = canEdit() ? `
    <button class="btn primary" data-act="save-assignment-btn">${a ? "Save changes" : "Assign"}</button>
    ${a ? `<button class="btn danger" data-act="delete-assignment" data-id="${esc(a.id)}">Remove</button>` : ""}
    <button class="btn ghost" data-act="close-drawer">Cancel</button>`
    : `<button class="btn ghost" data-act="close-drawer">Close</button>`;

  return shell(a ? "Reassign work" : "Assign an editor", `${esc(p.client)}${p.projectName ? " — " + esc(p.projectName) : ""}`, body, foot);
}

function assignImpact(pv, editor) {
  const row = (label, u) => `<div class="row"><span>${esc(label)}</span><span>${utilPill(u)} <span class="muted small">${u.scheduled}h / ${u.capacity}h</span></span></div>`;
  return `
    <div class="impact">
      <div class="row"><span>Window</span><span class="num">${esc(fmtDateFull(pv.window.from))} → ${esc(fmtDateFull(pv.window.to))}${pv.window.derived ? ' <span class="muted small">(from the milestone)</span>' : ""}</span></div>
      ${row(`${editor || "Editor"} before`, pv.before)}
      ${row(`${editor || "Editor"} after`, pv.after)}
      ${pv.overloaded.length ? `<div class="warn">Over capacity on ${pv.overloaded.length} day${pv.overloaded.length > 1 ? "s" : ""}: ${pv.overloaded.slice(0, 4).map((d) => `${fmtDate(d.day)} (${d.hours}h / ${d.capacity}h)`).join(", ")}${pv.overloaded.length > 4 ? "…" : ""}</div>` : ""}
      ${pv.delivery ? `<div class="row"><span>Committed delivery</span><span class="num">${pv.delivery.baseline ? esc(fmtDateFull(pv.delivery.baseline)) : "not set"}${pv.delivery.forecastMiss ? ` <span class="warn">forecast ${esc(fmtDate(pv.delivery.forecast))}</span>` : ""}</span></div>` : ""}
      ${pv.suggestions?.length ? `<div><b>Best available in this window</b><ul>${pv.suggestions.slice(0, 5).map((s) => `<li><button class="btn xs ghost" data-act="pick-editor" data-name="${esc(s.name)}">${esc(s.name)}</button> ${s.free}h free · ${utilPill({ ...s, unestimated: new Array(s.unestimated), incomplete: s.unestimated > 0, scheduled: "?", capacity: "?" })}${s.skillMatch != null ? ` · skills ${Math.round(s.skillMatch * 100)}%` : ""}${s.unestimated ? ` · ${s.unestimated} unestimated` : ""}</li>`).join("")}</ul></div>` : ""}
    </div>`;
}

/* ------------------------------------------------------- escalation */

export function renderEscalationForm({ projectId, escalationId = "" }) {
  const e = escalationId ? S.data.escalations.find((x) => x.id === escalationId) : null;
  const p = projectById(e?.projectId || projectId);
  if (!p) return "";
  const cur = e || { reason: "", severity: "medium", owner: p.primaryDm || "", resolutionTarget: "", blocker: "", nextAction: "", nextActionOwner: "", status: "open" };
  const age = e?.raisedOn ? -(Math.round((Date.parse(TODAY) - Date.parse(e.raisedOn)) / 864e5)) : null;

  const body = `
    <form id="esc-form" data-guard="esc:${esc(p.id)}" data-submit="save-escalation" data-id="${esc(p.id)}" ${e ? `data-escalation="${esc(e.id)}"` : ""} class="stack">
      <div class="form-grid">
        ${field("Reason", `<input type="text" name="reason" value="${esc(cur.reason)}" required placeholder="Client rejected the batch; no approval for 9 days">`, { req: true, cls: "wide" })}
        ${field("Severity", sel("severity", SEVS, cur.severity, { blank: null }))}
        ${field("Owner", `<input type="text" name="owner" list="dl-roster" value="${esc(cur.owner)}">`)}
        ${field("Resolution deadline", `<input type="date" name="resolutionTarget" value="${esc(cur.resolutionTarget || "")}">`)}
        ${e ? field("Status", sel("status", [["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"]], cur.status, { blank: null })) : ""}
        ${field("Current blocker", `<input type="text" name="blocker" value="${esc(cur.blocker)}">`, { cls: "wide" })}
        ${field("Next action", `<input type="text" name="nextAction" value="${esc(cur.nextAction)}">`)}
        ${field("Action owner", `<input type="text" name="nextActionOwner" list="dl-roster" value="${esc(cur.nextActionOwner || "")}">`)}
        ${e ? field("Resolution note", `<textarea name="resolution" rows="2">${esc(cur.resolution || "")}</textarea>`, { cls: "wide" }) : ""}
      </div>
      ${datalist("dl-roster", roster())}
    </form>
    ${e ? `
      <div class="section-t">Comments <span class="chip ring">${e.comments.length}</span></div>
      <div class="feed" style="margin:0 -18px">
        ${e.comments.length ? e.comments.slice().reverse().map((c) => `<article class="post">${avatar(c.by)}<div class="post-b"><div class="post-h"><span class="nm">${esc(c.by)}</span><span class="meta">${esc(ago(c.at.slice(0, 10)))}</span></div><div class="post-txt">${esc(c.text)}</div></div></article>`).join("") : `<div class="muted small" style="padding:6px 18px">No comments yet.</div>`}
      </div>
      ${canEdit() && S.me ? `<form data-submit="comment-escalation" data-id="${esc(e.id)}" data-guard="esc-comment" style="display:flex;gap:8px;margin-top:10px">
        <input type="text" name="text" placeholder="Add a comment" required style="flex:1"><button class="btn sm" type="submit">Post</button></form>` : ""}
      <div class="section-t">Raised</div>
      <div class="muted small">${esc(e.raisedBy)} · ${esc(fmtDateFull(e.raisedOn))}${age != null ? ` · ${age} day${age === 1 ? "" : "s"} old` : ""}${e.resolvedAt ? ` · resolved by ${esc(e.resolvedBy || "")} ${esc(ago(e.resolvedAt.slice(0, 10)))}` : ""}</div>` : ""}`;

  const foot = canEdit() ? `
    <button class="btn primary" data-act="save-escalation-btn">${e ? "Save" : "Raise escalation"}</button>
    ${e && e.status !== "resolved" ? `<button class="btn" data-act="resolve-escalation" data-id="${esc(e.id)}">Mark resolved</button>` : ""}
    <button class="btn ghost" data-act="close-drawer">Cancel</button>`
    : `<button class="btn ghost" data-act="close-drawer">Close</button>`;

  return shell(e ? "Escalation" : "Raise an escalation", `${esc(p.client)}${p.projectName ? " — " + esc(p.projectName) : ""} ${e ? sevPill(e.severity) : ""}`, body, foot);
}

/* ------------------------------------------------------------ import */

export function renderImportDrawer(x = {}) {
  const pv = x.preview;
  const last = settings().lastImport;
  const intro = `
    <div class="callout" style="margin-bottom:12px">
      <span>⇪</span>
      <div>Open the DM sheet, select the header row and every project row, copy, and paste below.
      Nothing changes until you confirm the preview. ${last ? `Last import: ${esc(fmtDateFull(last.at.slice(0, 10)))} by ${esc(last.by)}.` : "No import has run yet."}</div>
    </div>
    <form data-submit="import-preview" data-guard="import">
      <textarea class="paste" name="tsv" placeholder="Priority	Status	Client Name (Brand)	DM	SDM	Revenue	…" ${x.busy ? "disabled" : ""}>${esc(x.tsv || "")}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <button class="btn primary" type="submit" ${x.busy ? "disabled" : ""}>${x.busy ? "Reading…" : "Preview changes"}</button>
        ${x.error ? `<span class="form-err">${esc(x.error)}</span>` : ""}
      </div>
    </form>`;

  let preview = "";
  if (pv) {
    const s = pv.summary;
    const matchSel = (r) => {
      const opts = [["", "— skip this row —"], ["new", "Create as a new project"], ...projects().map((p) => [p.id, p.label])];
      const cur = r.action === "skip" ? "" : r.action === "create" ? "new" : r.match.projectId;
      return `<select data-change="import-match" data-row="${r.row.rowIndex}" style="width:auto;max-width:260px;font-size:11.5px;padding:3px 24px 3px 8px">${opts.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    };
    const changeLine = (r, c) => {
      const fmt = (v) => Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "—" : typeof v === "number" ? money(v) : String(v);
      return `<div class="diff"><span><b>${esc(c.field)}</b></span><span class="del">${esc(fmt(c.from))}</span><span class="${c.apply ? "add" : "keep"}">${esc(fmt(c.to))}${c.apply ? "" : ` <span class="muted">(kept — ${esc(c.reason)})</span>`}</span>
        ${c.apply ? "" : `<label class="check small"><input type="checkbox" data-change="import-field" data-key="${esc(r.match.projectId)}:${c.field}"> take the sheet's value</label>`}</div>`;
    };
    preview = `
      <div class="section-t">What would change</div>
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
        ${[["Rows", s.rows], ["Update", s.update], ["Create", s.create], ["Field changes", s.fieldChanges], ["Kept (app edits)", s.fieldConflicts], ["New updates", s.updatesAdd], ["Re-dated", s.updatesRedate], ["Duplicates skipped", s.updatesDup]]
          .map(([k, v]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}
      </div>
      <div class="muted small" style="margin-bottom:10px">${s.dateColumns} day columns${s.dateRange ? ` (${esc(fmtDate(s.dateRange[0]))} → ${esc(fmtDate(s.dateRange[1]))})` : ""}${s.guessedDates ? ` · ${s.guessedDates} bare weekday header${s.guessedDates > 1 ? "s" : ""} placed between dated ones` : ""}${s.ambiguous ? ` · <b style="color:var(--crit-ink)">${s.ambiguous} row${s.ambiguous > 1 ? "s" : ""} need a match picked</b>` : ""}</div>
      <div class="scroller" style="max-height:40vh;border:1px solid var(--line);border-radius:var(--r-lg)">
        <table class="rows compact preview-table">
          <thead><tr><th>Sheet row</th><th>Board project</th><th>Changes</th><th class="r">Updates</th></tr></thead>
          <tbody>
            ${pv.rows.map((r) => `<tr class="${r.match.confidence === "ambiguous" ? "warn" : ""}">
              <td><div class="cell-name">${esc(r.row.clientRaw)}</div><div class="cell-sub">${esc([r.row.priority, r.row.status, r.row.primaryDm].filter(Boolean).join(" · "))}</div></td>
              <td>${matchSel(r)}<div class="cell-sub">${esc(r.match.confidence === "exact" ? "exact id match" : r.match.confidence === "name" ? "matched on project words" : r.match.confidence === "client" ? "only row for this client" : r.match.confidence === "ambiguous" ? "several rows — pick one" : r.match.confidence === "new" ? "not on the board" : r.match.confidence)}</div></td>
              <td>${r.action === "create" ? `<span class="add small">new project</span>` : r.changes.length ? r.changes.map((c) => changeLine(r, c)).join("") : `<span class="muted small">no field changes</span>`}</td>
              <td class="r num">${r.updates.add.length ? `+${r.updates.add.length}` : ""}${r.updates.redate.length ? ` <span class="muted">↻${r.updates.redate.length}</span>` : ""}${r.updates.dup.length ? ` <span class="muted">=${r.updates.dup.length}</span>` : ""}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      ${pv.revenue.length ? `
        <div class="section-t">Revenue</div>
        <div class="muted small" style="margin-bottom:6px">The sheet's figures are kept beside the booked revenue. Clients with nothing booked take the sheet's number; for the rest, choose.</div>
        <table class="rows compact"><thead><tr><th>Client</th><th class="r">Booked</th><th class="r">Sheet</th><th>Action</th></tr></thead><tbody>
          ${pv.revenue.map((e) => `<tr><td>${esc(e.client)}</td><td class="r num">${e.booked == null ? '<span class="muted">none</span>' : esc(money(e.booked))}</td><td class="r num">${esc(money(e.sheetSum))}${e.rows > 1 ? `<div class="cell-sub">${e.rows} rows</div>` : ""}</td>
            <td>${e.action === "same" ? '<span class="muted small">same</span>' : `<select data-change="import-revenue" data-key="${esc(e.clientKey)}" style="width:auto;font-size:11.5px;padding:3px 24px 3px 8px"><option value="keep" ${e.action === "keep" ? "selected" : ""}>Keep booked</option><option value="adopt" ${e.action === "adopt" ? "selected" : ""}>Use the sheet's</option></select>`}</td></tr>`).join("")}
        </tbody></table>` : ""}
      ${pv.newPeople.length ? `<div class="section-t">New people</div><div class="muted small">${pv.newPeople.map((n) => `${esc(n.name)} (${n.roles.join(", ")})`).join(" · ")} — added to the roster.</div>` : ""}
      ${pv.notInSheet.length ? `<div class="section-t">On the board, not in the sheet <span class="chip ring">${pv.notInSheet.length}</span></div><div class="muted small">${pv.notInSheet.slice(0, 12).map((x) => esc(x.label)).join(" · ")}${pv.notInSheet.length > 12 ? " …" : ""}. These are kept as they are.</div>` : ""}`;
  }

  const foot = pv ? `
    <button class="btn primary" data-act="import-commit" ${x.busy ? "disabled" : ""}>${x.busy ? "Importing…" : `Import ${pv.summary.update + pv.summary.create} rows`}</button>
    <button class="btn" data-act="import-preview-btn">Re-check</button>
    <button class="btn ghost" data-act="close-drawer">Cancel</button>`
    : `<button class="btn ghost" data-act="close-drawer">Close</button>`;

  return shell("Import the DM sheet", "Paste from Google Sheets. Matched by client + project; updates are deduplicated by their text.", intro + preview, foot, "wide");
}

/* ------------------------------------------------------- new project */

export function renderNewProject() {
  const body = `
    <form data-submit="create-project" data-guard="new-project" class="stack">
      <div class="form-grid">
        ${field("Client", `<input name="client" list="dl-clients" required>`, { req: true })}
        ${field("Project name", `<input name="projectName" placeholder="e.g. Diwali DVC">`)}
        ${field("Primary DM", `<input name="primaryDm" list="dl-roster">`)}
        ${field("Additional DMs", `<input name="dms" placeholder="comma separated" list="dl-roster">`)}
        ${field("SDM", `<input name="sdm" list="dl-roster">`)}
        ${field("Editors", `<input name="editorLeads" placeholder="comma separated" list="dl-editors">`)}
        ${field("Priority", sel("priority", ["High", "Medium", "Low"], "", { blank: "— not set —" }))}
        ${field("Status", sel("status", ["Upcoming", "Active", "On Hold"], "Upcoming", { blank: null }))}
        ${field("Categories", `<input name="categories" placeholder="comma separated" list="dl-cats">`)}
        ${field("Revenue (₹)", `<input type="number" name="revenue" min="0" step="1000">`, { hint: "Leave blank if not agreed." })}
        ${field("Start", `<input type="date" name="start">`)}
        ${field("Committed delivery", `<input type="date" name="end">`)}
        ${field("Locked scope", `<textarea name="scopeLocked" rows="3"></textarea>`, { cls: "wide" })}
      </div>
      ${datalist("dl-clients", allOf("client"))}${datalist("dl-roster", roster())}${datalist("dl-editors", editorNames())}${datalist("dl-cats", categoryNames())}
      <label class="check" style="margin-top:8px"><input type="checkbox" name="withChain" checked> Create the default milestone chain from the start date</label>
    </form>`;
  const foot = `<button class="btn primary" data-act="create-project-btn">Create project</button><button class="btn ghost" data-act="close-drawer">Cancel</button>`;
  return shell("New project", "It lands on the board for everyone.", body, foot, "narrow");
}

/* -------------------------------------------------------- name picker */

export function renderNamePicker() {
  const names = roster();
  const body = `
    <form data-submit="set-me" style="display:flex;gap:8px;margin-bottom:14px">
      <input type="text" name="name" list="dl-roster" placeholder="Type your name" value="${esc(S.me)}" autofocus style="flex:1">
      ${datalist("dl-roster", names)}
      <button class="btn primary" type="submit">Set</button>
    </form>
    <div class="section-t">On the board</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${names.map((n) => `<button class="chip ${n === S.me ? "on" : "ring"}" data-act="set-me-quick" data-name="${esc(n)}">${avatar(n, "sm")} ${esc(n)}</button>`).join("")}
    </div>`;
  return shell("Who are you?", "Stored on this browser so your posts are signed. No password — this board is for the team.", body, "", "narrow", "close-picker");
}

/* ---------------------------------------------------------- settings */

export function renderSettings() {
  const set = settings();
  const f = (key, label, val, step = 1, hint = "") => field(label, `<input type="number" name="${key}" step="${step}" value="${esc(val)}" ${canEdit() ? "" : "disabled"}>`, { hint });
  const body = `
    <form data-submit="save-settings" data-guard="settings" class="stack">
      <div class="section-t">Capacity and thresholds</div>
      <div class="form-grid">
        ${f("utilAmber", "Amber from (utilisation)", set.utilAmber, 0.05, "0.8 = 80%")}
        ${f("utilRed", "Red above", set.utilRed, 0.05, "1.0 = 100%")}
        ${f("capacityHoursPerWeek", "Default editor hours / week", set.capacityHoursPerWeek, 1)}
        ${f("staleUpdateDays", "Update goes stale after (days)", set.staleUpdateDays, 1)}
        ${f("capacityPerDM", "Project slots per DM", set.capacityPerDM, 1, "used by the scenario levers")}
        ${f("capacityPerEditor", "Project slots per editor", set.capacityPerEditor, 1)}
      </div>
      <div class="section-t">Working week</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => `<label class="check"><input type="checkbox" name="wd${i}" ${(set.workingDays || []).includes(i) ? "checked" : ""} ${canEdit() ? "" : "disabled"}> ${d}</label>`).join("")}
      </div>
      ${field("Holidays (one date per line)", `<textarea name="holidays" rows="3" ${canEdit() ? "" : "disabled"}>${esc((set.holidays || []).join("\n"))}</textarea>`, { cls: "wide" })}
      <div class="section-t">Milestone template</div>
      <div class="muted small" style="margin-bottom:6px">Applied to a project with "Apply template chain". Durations are working days.</div>
      <table class="rows compact"><thead><tr><th>Stage</th><th>Title</th><th>Owner</th><th class="r">Days</th></tr></thead><tbody>
        ${(set.milestoneTemplate || []).map((t, i) => `<tr><td class="mono">${esc(t.stage)}<input type="hidden" name="t${i}_stage" value="${esc(t.stage)}"></td>
          <td><input name="t${i}_title" value="${esc(t.title)}" ${canEdit() ? "" : "disabled"}></td>
          <td>${sel(`t${i}_ownerType`, OWNER_TYPES, t.ownerType, { blank: null, attrs: canEdit() ? "" : "disabled" })}</td>
          <td class="r"><input type="number" name="t${i}_durationDays" min="1" value="${esc(t.durationDays)}" style="width:70px" ${canEdit() ? "" : "disabled"}></td></tr>`).join("")}
      </tbody></table>
    </form>`;
  const foot = canEdit() ? `<button class="btn primary" data-act="save-settings-btn">Save</button><button class="btn ghost" data-act="close-drawer">Cancel</button>` : `<button class="btn ghost" data-act="close-drawer">Close</button>`;
  return shell("Settings", "Shared with everyone on the board.", body, foot);
}
