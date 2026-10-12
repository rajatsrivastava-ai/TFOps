/* Router, action handlers and boot.

   Three render layers: the chrome (sidebar, top bar), the page, and the
   slide-over. A poll repaints only the page — and not even that while a form
   is dirty; it shows an "updates available" chip instead. */

import {
  S, $, $$, esc, api, act, initActions, initTooltips, toast, mutate, refresh, startPolling, paintSync, setRenderer,
  avatar, debounce, hideTip, TODAY, tickToday, money, num, canEdit, confirmDialog, isDirty, markClean, recall, persist, fmtDate, fmtDateFull, isISO,
} from "./core.js";
import {
  projects, projectById, roster, shareOf, statusKind, lastUpdate, risksOf, healthOf, deliveryOf, forecastOf, milestonesOf,
  escalations, escalationQueue, riskTable, defaultScenario, settings, effortOf, activityOf, loadRollup, podRollup, clientRollup,
  dmPerformance, editorCapacity, assignments, resolvedAssignments, scopeCompletion, editorsOf, myDrafts,
} from "./compute.js";
import { renderOverview } from "./views/overview.js";
import { renderTimeline } from "./views/timeline.js";
import { renderRegister } from "./views/register.js";
import { renderAllocation } from "./views/allocation.js";
import { renderProjectDrawer, renderPersonDrawer, readProjectForm, impactBox } from "./views/project.js";
import { renderUpdateForm, renderAssignForm, renderEscalationForm, renderImportDrawer, renderNewProject, renderNamePicker, renderSettings } from "./views/forms.js";
import { rangeBox } from "./views/shared.js";

const PAGES = {
  overview:   { label: "Executive overview", ic: "◫", render: renderOverview, crumb: "Portfolio, risk and ownership" },
  timeline:   { label: "Project timeline",   ic: "▤", render: renderTimeline, crumb: "Deliveries, milestones and escalations" },
  register:   { label: "Project register",   ic: "☰", render: renderRegister, crumb: "Projects and daily DM updates" },
  allocation: { label: "Editor allocation",  ic: "⚒", render: renderAllocation, crumb: "Capacity and assignment planning" },
};
const HOME = "overview";

/* ------------------------------------------------------------------ render */

function renderChrome() {
  const open = escalations().filter((e) => e.status !== "resolved").length;
  const atRisk = riskTable(projects()).length;
  const counts = { timeline: open, overview: atRisk };
  $("#sidenav").innerHTML = Object.entries(PAGES).map(([k, v]) =>
    `<button class="navitem" data-act="goto" data-page="${k}" ${k === S.page ? 'aria-current="page"' : ""}>
      <span class="ic">${v.ic}</span><span>${esc(v.label)}</span>${counts[k] ? `<span class="cnt ${k === "overview" && !atRisk ? "ok" : ""}">${counts[k]}</span>` : ""}</button>`).join("");

  $("#sidefoot").innerHTML = `
    <div class="row">${S.me ? `${avatar(S.me, "sm")}<b style="color:var(--ink)">${esc(S.me)}</b>` : `<span>Not signed in</span>`}
      <span style="margin-left:auto">${S.role === "view" ? `<span class="chip ring" data-tip="Read-only password">👁 view</span>` : S.openAccess ? `<span class="chip" data-tip="No password configured on this server">open</span>` : ""}</span></div>
    <div class="row"><button class="btn xs ghost" data-act="open-settings">Settings</button>${!S.openAccess ? `<a class="btn xs ghost" href="/logout">Sign out</a>` : ""}<span style="margin-left:auto" class="num">v${S.data.version}</span></div>`;

  const page = PAGES[S.page] || PAGES[HOME];
  $("#crumbs").innerHTML = `<span class="muted">TrueFan AI</span><span class="sep">›</span><b>${esc(page.label)}</b><span class="sep muted">·</span><span class="muted small">${esc(page.crumb)}</span>`;
  $("#rangebox").innerHTML = rangeBox();
  const bell = $("#bell");
  bell.innerHTML = `🔔${open ? `<span class="cnt">${open}</span>` : ""}`;
  bell.setAttribute("data-tip", open ? `${open} open escalation${open > 1 ? "s" : ""}` : "No open escalations");
  $("#who").innerHTML = S.me ? `${avatar(S.me, "sm")}<span>${esc(S.me)}</span>` : `<span class="avatar sm" style="background:var(--track);color:var(--ink-3)">?</span><span>Who are you?</span>`;
  const gs = $("#gsearch");
  if (gs && document.activeElement !== gs) gs.value = S.filters.q;
  document.title = `${page.label} · TFOps`;
}

function renderMain() {
  const page = PAGES[S.page] || PAGES[HOME];
  const main = $("#main");
  const keep = main.scrollTop;
  main.innerHTML = page.render();
  main.scrollTop = Math.min(keep, main.scrollHeight - main.clientHeight);
}

function renderDrawer() {
  const d = S.drawer;
  const host = $("#drawer-host");
  if (!d) { host.innerHTML = ""; return; }
  const x = d.extra || {};
  const html = d.kind === "project" ? renderProjectDrawer(d.id, d.tab, x)
    : d.kind === "person" ? renderPersonDrawer(d.id)
    : d.kind === "update" ? renderUpdateForm(d.id, x.draftId)
    : d.kind === "assign" ? renderAssignForm({ projectId: d.id, milestoneId: x.milestoneId, assignmentId: x.assignmentId, preview: x.preview, editor: x.editor, form: x.form })
    : d.kind === "escalation" ? renderEscalationForm({ projectId: d.id, escalationId: x.escalationId })
    : d.kind === "import" ? renderImportDrawer(x)
    : d.kind === "new-project" ? renderNewProject()
    : d.kind === "pick-me" ? renderNamePicker()
    : d.kind === "settings" ? renderSettings()
    : "";
  host.innerHTML = html;
  if (!html) S.drawer = null;
}

function paintPending() {
  const el = $("#pending");
  if (!el) return;
  el.classList.toggle("hide", !S.ui.pendingRender);
  el.innerHTML = S.ui.pendingRender ? `<span data-act="apply-pending">Board changed — refresh</span>` : "";
}

/** reason: "user" (an action of ours), "poll" (someone else's change), "nav". */
function render(reason = "user") {
  if (!S.data) return;
  tickToday();
  if (reason === "poll" && isDirty()) { S.ui.pendingRender = true; paintPending(); paintSync(); renderChrome(); return; }
  S.ui.pendingRender = false;
  paintPending();
  renderChrome();
  renderMain();
  if (reason !== "poll" || !S.drawer) renderDrawer();
  paintSync();
}
const rerender = () => render("user");
const repaintDrawer = () => { renderDrawer(); };

/* ----------------------------------------------------------- navigation */

function setPage(page, tab = "") {
  if (!PAGES[page]) page = HOME;
  if (S.page !== page) S.scroll[S.page] = $("#main").scrollTop;
  S.page = page; S.tab = tab;
  S.drawer = null; S.ui.openChip = null; S.ui.navOpen = false; $(".shell").classList.remove("nav-open");
  history.replaceState(null, "", "#" + page + (tab ? "/" + tab : ""));
  render("nav");
  $("#main").scrollTop = S.scroll[page] || 0;
}
act("goto", (el) => {
  const page = el.getAttribute("data-page");
  const tab = el.getAttribute("data-tab") || "";
  if (el.hasAttribute("data-risk")) S.filters.risk = el.getAttribute("data-risk");
  setPage(page, tab);
});
act("quick-go", (el) => { S.filters.quick = el.getAttribute("data-key"); setPage("register"); });
act("toggle-nav", () => { S.ui.navOpen = !S.ui.navOpen; $(".shell").classList.toggle("nav-open", S.ui.navOpen); });
act("apply-pending", () => { markClean(); S.drawer = null; render("user"); });
act("toggle-card", (el) => {
  const key = el.getAttribute("data-key"), card = $("#" + el.getAttribute("data-id"));
  const open = !recall(key, false);
  persist(key, open);
  if (card) { card.classList.toggle("collapsed", !open); el.textContent = open ? "Hide ▴" : "Show ▾"; }
});

window.addEventListener("hashchange", () => {
  const [page, tab] = location.hash.slice(1).split("/");
  if (PAGES[page] && (page !== S.page || (tab || "") !== S.tab)) { S.page = page; S.tab = tab || ""; S.drawer = null; render("nav"); }
});

/* -------------------------------------------------------------- filters */

const closeChips = () => { S.ui.openChip = null; };
act("filter-q", debounce((el) => { S.filters.q = el.value; rerender(); }, 200));
act("global-q", debounce((el) => { S.filters.q = el.value; if (S.page !== "register" && S.page !== "overview" && S.page !== "timeline") S.page = "register"; render("user"); const gs = $("#gsearch"); if (gs) { gs.focus(); gs.setSelectionRange(gs.value.length, gs.value.length); } }, 220));
act("fchip-toggle", (el) => { const k = el.getAttribute("data-key"); S.ui.openChip = S.ui.openChip === k ? null : k; rerender(); });
act("fchip-set", (el) => {
  const k = el.getAttribute("data-key"), v = el.value;
  const cur = new Set(S.filters[k] || []);
  if (el.checked) cur.add(v); else cur.delete(v);
  S.filters[k] = [...cur];
  rerender();
});
act("fchip-clear", (el) => { S.filters[el.getAttribute("data-key")] = []; rerender(); });
act("fchip-close", () => { closeChips(); rerender(); });
act("health-filter", (el) => {
  const k = el.getAttribute("data-key");
  const cur = new Set(S.filters.health || []);
  if (cur.has(k)) cur.delete(k); else cur.add(k);
  S.filters.health = [...cur];
  rerender();
});
act("quick", (el) => { const k = el.getAttribute("data-key"); S.filters.quick = S.filters.quick === k ? "" : k; rerender(); });
act("clear-filters", () => {
  S.filters = { q: "", status: [], priority: [], dm: [], sdm: [], category: [], client: [], pod: [], health: [], editor: [], person: "", risk: "", quick: "", mine: false };
  S.range = { preset: "all", from: "", to: "" };
  rerender();
});
act("toggle-mine", () => { S.filters.mine = !S.filters.mine; rerender(); });
act("clear-person", () => { S.filters.person = ""; rerender(); });
act("clear-risk", () => { S.filters.risk = ""; rerender(); });
act("filter-person", (el) => { S.filters.person = el.getAttribute("data-person"); setPage("register"); });
act("range-preset", (el) => { S.range.preset = el.value; if (el.value === "custom" && !S.range.from) { S.range.from = TODAY; S.range.to = TODAY; } rerender(); });
act("range-from", (el) => { S.range.from = el.value; rerender(); });
act("range-to", (el) => { S.range.to = el.value; rerender(); });
act("sort", (el) => {
  const t = el.getAttribute("data-table"), key = el.getAttribute("data-key");
  const s = S.sort[t] || (S.sort[t] = { key, dir: 1 });
  s.dir = s.key === key ? -s.dir : (["rev", "risk", "points", "util"].includes(key) ? -1 : 1);
  s.key = key;
  rerender();
});
act("register-mode", (el) => { S.register.mode = el.getAttribute("data-mode"); persist("register.mode", S.register.mode); rerender(); });

document.addEventListener("click", (e) => {
  if (S.ui.openChip && !e.target.closest?.(".fchip")) { closeChips(); rerender(); }
});

/* --------------------------------------------------------------- drawers */

function openDrawer(kind, id = "", tab = "", extra = {}) {
  hideTip();
  S.drawer = { kind, id, tab, extra };
  renderDrawer();
}
export function closeDrawer() { markClean(); S.drawer = null; renderDrawer(); if (S.ui.pendingRender) render("user"); }

act("open-project", (el) => openDrawer("project", el.getAttribute("data-id"), el.getAttribute("data-tab") || "overview"));
act("open-person", (el) => openDrawer("person", el.getAttribute("data-name")));
act("close-drawer", () => closeDrawer());
act("close-picker", () => closeDrawer());
act("drawer-tab", (el) => { if (!S.drawer) return; S.drawer.tab = el.getAttribute("data-tab"); S.drawer.extra = {}; markClean(); renderDrawer(); });
act("open-settings", () => openDrawer("settings"));
act("open-update", (el) => openDrawer("update", el.getAttribute("data-id"), "", { draftId: el.getAttribute("data-draft") || null }));
act("open-assign", (el) => openDrawer("assign", el.getAttribute("data-id"), "", { assignmentId: el.getAttribute("data-assignment") || "", milestoneId: el.getAttribute("data-milestone") || "", editor: el.getAttribute("data-editor") || "" }));
act("open-escalation", (el) => openDrawer("escalation", el.getAttribute("data-id"), "", { escalationId: el.getAttribute("data-escalation") || "" }));
act("open-import", () => openDrawer("import", "", "", { tsv: "", decisions: {} }));
act("new-project", () => openDrawer("new-project"));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.drawer && !S.ui.dialog) { closeDrawer(); }
  if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); $("#gsearch")?.focus(); }
});

/* ------------------------------------------------------------- identity */

function requireMe() {
  if (S.me) return true;
  toast("Pick who you are first — top right", true);
  openDrawer("pick-me");
  return false;
}
act("pick-me", () => { if (!S.openAccess) { location.href = "/logout"; return; } openDrawer("pick-me"); });
act("set-me", async (el) => setMe(new FormData(el).get("name").toString().trim()));
act("set-me-quick", async (el) => setMe(el.getAttribute("data-name")));
async function setMe(name) {
  if (!name) return;
  try { await api.post("/api/me", { name }); S.me = name; S.drawer = null; toast(`Signed in as ${name}`); render("user"); }
  catch (e) { toast(e.message, true); }
}

/* --------------------------------------------------------------- forms */

const formData = (form) => {
  const out = {};
  new FormData(form).forEach((v, k) => { if (k in out) out[k] = [].concat(out[k], v); else out[k] = v; });
  form.querySelectorAll("select[multiple]").forEach((s) => { out[s.name] = [...s.selectedOptions].map((o) => o.value); });
  form.querySelectorAll('input[type="checkbox"]').forEach((c) => { out[c.name] = c.checked; });
  return out;
};
const numOrNull = (v) => (v === "" || v == null ? null : Number(v));

/* projects */
async function saveProject(id) {
  if (!requireMe()) return;
  const form = $("#proj-form");
  if (!form) return;
  const p = projectById(id);
  const patch = readProjectForm(form, p);
  if ("end" in patch && p.end && patch.end !== p.end && !patch.reason) {
    const r = await confirmDialog({ title: "Move the committed delivery date?", body: `<p>${esc(fmtDateFull(p.end))} → <b>${esc(fmtDateFull(patch.end || "—"))}</b>. The original commitment stays on record.</p><div class="field"><label>Reason</label><input name="reason" required placeholder="Why the client's date is moving"></div>`, confirmLabel: "Move it" });
    if (!r) return;
    patch.reason = r.reason;
  }
  const ok = await mutate(() => api.patch(`/api/projects/${encodeURIComponent(id)}`, patch), "Saved");
  if (ok) { markClean(); renderDrawer(); }
}
act("save-project", (el) => saveProject(el.getAttribute("data-id")));
act("toggle-open", (el) => { const end = el.closest("form")?.querySelector('[data-field="end"]'); if (end) { end.disabled = el.checked; } });

act("create-project-btn", (el) => $("form[data-submit='create-project']")?.requestSubmit());
act("create-project", async (el) => {
  if (!requireMe()) return;
  const f = formData(el);
  const split = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
  const dms = [...new Set([f.primaryDm, ...split(f.dms)].filter(Boolean))];
  let created = null;
  const ok = await mutate(async () => {
    const r = await api.post("/api/projects", {
      client: f.client, projectName: f.projectName, primaryDm: f.primaryDm, dms, sdm: f.sdm, editorLeads: split(f.editorLeads),
      priority: f.priority, status: f.status, categories: split(f.categories), revenue: numOrNull(f.revenue),
      start: f.start || null, end: f.end || null, scopeLocked: f.scopeLocked,
    });
    created = r.project;
    if (f.withChain && (f.start || f.end)) await api.post(`/api/projects/${encodeURIComponent(created.id)}/milestones/template`, { startDate: f.start || TODAY });
  }, "Project created");
  if (ok && created) { markClean(); openDrawer("project", created.id, "milestones"); }
});

/* milestones */
act("apply-template", async (el) => {
  if (!requireMe()) return;
  const id = el.getAttribute("data-id");
  const p = projectById(id);
  const r = await confirmDialog({ title: "Apply the template chain", body: `<p>Brief → Script → Storyboard → Base video → Client feedback → Revisions → Adaptations → QC → Final delivery, laid end to end in working days from the start date.</p><div class="field"><label>Start date</label><input type="date" name="startDate" value="${esc(p?.start || TODAY)}" required></div>`, confirmLabel: "Create milestones" });
  if (!r) return;
  const ok = await mutate(() => api.post(`/api/projects/${encodeURIComponent(id)}/milestones/template`, { startDate: r.startDate }), "Milestone chain created");
  if (ok) renderDrawer();
});
act("ms-new", () => { if (!S.drawer) return; S.drawer.extra = { editMs: "new" }; renderDrawer(); });
act("ms-edit", (el) => { if (!S.drawer) return; S.drawer.extra = { editMs: el.getAttribute("data-id") }; renderDrawer(); });
act("ms-cancel", () => { if (!S.drawer) return; markClean(); S.drawer.extra = {}; renderDrawer(); });
act("ms-touched", () => { if (S.drawer?.extra?.impact) { S.drawer.extra.impact = null; } });

function msPatchFrom(form, existing) {
  const f = formData(form);
  const patch = {
    title: f.title, stage: f.stage, owner: f.owner, ownerType: f.ownerType,
    startDate: f.startDate || null, baselineDue: f.baselineDue || null, ownerEta: f.ownerEta || null,
    durationDays: numOrNull(f.durationDays), dependsOn: f.dependsOn || [], status: f.status, blocker: f.blocker,
    actualDone: f.actualDone || null, locked: !!f.locked, external: !!f.external,
  };
  if (f.overrideDate) patch.override = { date: f.overrideDate, reason: f.overrideReason || "" };
  else if (existing?.override) patch.override = null;
  if (f.reason) patch.reason = f.reason;
  if (existing) {
    // Send only what changed, so an untouched committed date needs no reason.
    Object.keys(patch).forEach((k) => { if (k !== "reason" && JSON.stringify(patch[k]) === JSON.stringify(existing[k] ?? (Array.isArray(patch[k]) ? [] : null)) && !(k === "override")) delete patch[k]; });
    if ("override" in patch && JSON.stringify(patch.override?.date || null) === JSON.stringify(existing.override?.date || null) && (patch.override?.reason || "") === (existing.override?.reason || "")) delete patch.override;
  }
  return patch;
}

act("ms-preview", async (el) => {
  const id = el.getAttribute("data-id");
  const form = el.closest("form");
  const m = S.data.milestones.find((x) => x.id === id);
  const patch = msPatchFrom(form, m);
  try {
    const r = await api.patch(`/api/milestones/${id}?preview=1`, patch);
    S.drawer.extra.impact = r.impact;
    // Keep what was typed: swap only the impact box.
    const box = form.querySelector(".impact");
    const html = impactBox(r.impact, projectById(m.projectId));
    if (box) box.outerHTML = html; else form.querySelector("div[style*='display:flex']")?.insertAdjacentHTML("beforebegin", html);
  } catch (e) { toast(e.message, true); }
});

act("ms-save", async (form) => {
  if (!requireMe()) return;
  const pid = form.getAttribute("data-id");
  const msId = form.getAttribute("data-ms");
  const existing = msId ? S.data.milestones.find((x) => x.id === msId) : null;
  const patch = msPatchFrom(form, existing);
  if (!existing) {
    const ok = await mutate(() => api.post("/api/milestones", { projectId: pid, ...patch }), "Milestone added");
    if (ok) { markClean(); S.drawer.extra = {}; renderDrawer(); }
    return;
  }
  if (!Object.keys(patch).filter((k) => k !== "reason").length) { S.drawer.extra = {}; markClean(); renderDrawer(); return; }
  let impact = null;
  try { impact = (await api.patch(`/api/milestones/${msId}?preview=1`, patch)).impact; }
  catch (e) { toast(e.message, true); return; }
  if (impact.affectsCommitment || impact.conflicts.length || (impact.delivery.forecastMiss && impact.moved.length > 1)) {
    const r = await confirmDialog({
      title: impact.affectsCommitment ? "This change breaks the committed delivery date" : impact.conflicts.length ? "This change creates a resource conflict" : "Confirm the downstream changes",
      body: impactBox(impact, projectById(pid)), confirmLabel: "Save anyway", danger: impact.affectsCommitment,
    });
    if (!r) return;
  }
  const ok = await mutate(() => api.patch(`/api/milestones/${msId}`, patch), "Milestone saved");
  if (ok) { markClean(); S.drawer.extra = {}; renderDrawer(); }
});

act("ms-done", async (el) => {
  if (!requireMe()) return;
  const ok = await mutate(() => api.patch(`/api/milestones/${el.getAttribute("data-id")}`, { actualDone: TODAY, status: "done" }), "Marked done");
  if (ok) renderDrawer();
});
act("ms-reopen", async (el) => {
  if (!requireMe()) return;
  const ok = await mutate(() => api.patch(`/api/milestones/${el.getAttribute("data-id")}`, { actualDone: null, status: "in_progress" }), "Reopened");
  if (ok) renderDrawer();
});
act("ms-delete", async (el) => {
  if (!requireMe()) return;
  const m = S.data.milestones.find((x) => x.id === el.getAttribute("data-id"));
  if (!(await confirmDialog({ title: `Delete "${m?.title || "this milestone"}"?`, body: "Milestones that depended on it are unlinked, not deleted. Assignments on it stay on the project.", confirmLabel: "Delete", danger: true }))) return;
  const ok = await mutate(() => api.delete(`/api/milestones/${el.getAttribute("data-id")}`), "Milestone removed");
  if (ok) { S.drawer.extra = {}; renderDrawer(); }
});

/* daily updates */
act("toggle-esc", (el) => { $("#esc-fields")?.classList.toggle("hide", !el.checked); });
act("submit-update-btn", (el) => { const f = $("#update-form"); if (!f) return; f.dataset.mode = el.getAttribute("data-mode"); f.requestSubmit(); });
act("submit-update", async (form) => {
  if (!requireMe()) return;
  const mode = form.dataset.mode || "submit";
  const draftId = form.getAttribute("data-draft");
  const pid = form.getAttribute("data-id");
  const f = formData(form);
  const body = {
    projectId: pid, date: f.date, completed: f.completed, planned: f.planned, milestoneId: f.milestoneId, progressNote: f.progressNote,
    scopeCompleted: f.scopeCompleted, blockers: f.blockers, dependencyOwner: f.dependencyOwner, nextAction: f.nextAction, nextActionOwner: f.nextActionOwner,
    expectedResolution: f.expectedResolution || null, nextMilestoneId: f.nextMilestoneId, nextMilestoneDate: f.nextMilestoneDate || null,
    forecastDelivery: f.forecastDelivery || null, escalationRequired: !!f.escalationRequired, escalationReason: f.escalationReason, escalationSeverity: f.escalationSeverity,
    draft: mode === "draft",
  };
  if (mode === "submit" && !String(f.completed || "").trim()) { toast("Say what was completed before submitting", true); return; }
  if (body.escalationRequired && !body.escalationReason) { toast("Give the escalation a reason", true); return; }
  const p = projectById(pid);
  const ok = await mutate(async () => {
    if (draftId) await api.patch(`/api/updates/${draftId}`, body); else await api.post("/api/updates", body);
    if (mode === "submit" && p && f.scopeCompleted !== undefined && f.scopeCompleted !== (p.scopeCompleted || "")) {
      await api.patch(`/api/projects/${encodeURIComponent(pid)}`, { scopeCompleted: f.scopeCompleted });
    }
  }, mode === "draft" ? "Draft saved" : body.escalationRequired ? "Update posted and escalation raised" : "Update posted");
  if (ok) { markClean(); openDrawer("project", pid, "updates"); }
});
act("del-update", async (el) => {
  if (!requireMe()) return;
  if (!(await confirmDialog({ title: "Delete this update?", body: "It disappears for everyone.", confirmLabel: "Delete", danger: true }))) return;
  const ok = await mutate(() => api.delete(`/api/updates/${el.getAttribute("data-id")}`), "Deleted");
  if (ok) renderDrawer();
});

/* assignments */
function assignBody(form) {
  const f = formData(form);
  return { editor: f.editor, milestoneId: f.milestoneId || null, estimatedHours: numOrNull(f.estimatedHours), scheduledStart: f.scheduledStart || null, scheduledEnd: f.scheduledEnd || null, status: f.status, note: f.note, reason: f.reason };
}
act("assign-changed", () => { if (S.drawer?.extra) S.drawer.extra.preview = null; });
act("preview-assignment", async () => {
  const form = $("#assign-form");
  if (!form) return;
  const body = { projectId: form.getAttribute("data-id"), excludeId: form.getAttribute("data-assignment") || "", ...assignBody(form) };
  if (!body.editor) { toast("Pick an editor first", true); return; }
  try {
    const r = await api.post("/api/assignments/preview", body);
    // Keep every typed value across the repaint, not just the editor.
    Object.assign(S.drawer.extra, { preview: r, form: body, editor: body.editor, milestoneId: body.milestoneId || "" });
    renderDrawer();
  } catch (e) { toast(e.message, true); }
});
act("pick-editor", (el) => { const inp = $('#assign-form [name="editor"]'); if (inp) { inp.value = el.getAttribute("data-name"); $("[data-act='preview-assignment']")?.click(); } });
act("save-assignment-btn", () => $("#assign-form")?.requestSubmit());
act("save-assignment", async (form) => {
  if (!requireMe()) return;
  const pid = form.getAttribute("data-id");
  const aid = form.getAttribute("data-assignment");
  const body = assignBody(form);
  if (!body.editor) { toast("Pick an editor", true); return; }
  let pv = null;
  try { pv = await api.post("/api/assignments/preview", { projectId: pid, excludeId: aid || "", ...body }); } catch (_) {}
  if (pv && (pv.after.band === "red" || pv.overloaded.length)) {
    const r = await confirmDialog({ title: `${body.editor} would be over capacity`, body: `<p>${pv.after.scheduled}h scheduled against ${pv.after.capacity}h available in ${esc(fmtDate(pv.window.from))} → ${esc(fmtDate(pv.window.to))}${pv.overloaded.length ? `, over on ${pv.overloaded.length} day${pv.overloaded.length > 1 ? "s" : ""}` : ""}.</p>${pv.suggestions?.length ? `<p class="muted small">Freer: ${pv.suggestions.slice(0, 3).map((s) => `${esc(s.name)} (${s.free}h free)`).join(", ")}.</p>` : ""}`, confirmLabel: "Assign anyway", danger: true });
    if (!r) return;
  }
  if (pv?.delivery?.forecastMiss && !aid) {
    const r = await confirmDialog({ title: "This project is already forecast to miss its committed date", body: `<p>Committed ${esc(fmtDateFull(pv.delivery.baseline))}, forecast ${esc(fmtDateFull(pv.delivery.forecast))}. Assigning does not move either date.</p>`, confirmLabel: "Continue" });
    if (!r) return;
  }
  const ok = await mutate(() => aid ? api.patch(`/api/assignments/${aid}`, body) : api.post("/api/assignments", { projectId: pid, ...body }), aid ? "Assignment updated" : "Editor assigned");
  if (ok) { markClean(); openDrawer("project", pid, "team"); }
});
act("delete-assignment", async (el) => {
  if (!requireMe()) return;
  if (!(await confirmDialog({ title: "Remove this assignment?", confirmLabel: "Remove", danger: true }))) return;
  const pid = S.drawer?.id;
  const ok = await mutate(() => api.delete(`/api/assignments/${el.getAttribute("data-id")}`), "Assignment removed");
  if (ok) { markClean(); openDrawer("project", pid, "team"); }
});

/* escalations */
act("save-escalation-btn", () => $("#esc-form")?.requestSubmit());
act("save-escalation", async (form) => {
  if (!requireMe()) return;
  const pid = form.getAttribute("data-id");
  const eid = form.getAttribute("data-escalation");
  const f = formData(form);
  const body = { reason: f.reason, severity: f.severity, owner: f.owner, resolutionTarget: f.resolutionTarget || null, blocker: f.blocker, nextAction: f.nextAction, nextActionOwner: f.nextActionOwner };
  if (eid) { body.status = f.status; body.resolution = f.resolution; }
  const ok = await mutate(() => eid ? api.patch(`/api/escalations/${eid}`, body) : api.post("/api/escalations", { projectId: pid, ...body }), eid ? "Escalation saved" : "Escalation raised");
  if (ok) { markClean(); openDrawer("project", pid, "escalations"); }
});
act("resolve-escalation", async (el) => {
  if (!requireMe()) return;
  const r = await confirmDialog({ title: "Mark this escalation resolved?", body: `<div class="field"><label>Resolution</label><input name="resolution" placeholder="What settled it"></div>`, confirmLabel: "Resolve" });
  if (!r) return;
  const pid = S.drawer?.id;
  const ok = await mutate(() => api.patch(`/api/escalations/${el.getAttribute("data-id")}`, { status: "resolved", resolution: r.resolution || "" }), "Resolved");
  if (ok) { markClean(); openDrawer("project", pid, "escalations"); }
});
act("comment-escalation", async (form) => {
  if (!requireMe()) return;
  const text = new FormData(form).get("text");
  const ok = await mutate(() => api.post(`/api/escalations/${form.getAttribute("data-id")}/comments`, { text }), "Comment posted");
  if (ok) { markClean("esc-comment"); renderDrawer(); }
});

/* import */
async function runImportPreview() {
  const x = S.drawer?.extra;
  if (!x || !x.tsv.trim()) { toast("Paste the sheet first", true); return; }
  x.busy = true; x.error = ""; renderDrawer();
  try {
    const r = await api.post("/api/import/sheet", { tsv: x.tsv, decisions: x.decisions });
    x.preview = r.preview; x.decisions.hash = r.preview.hash;
  } catch (e) { x.error = e.message; x.preview = null; }
  x.busy = false; renderDrawer();
}
act("import-preview", (form) => { S.drawer.extra.tsv = new FormData(form).get("tsv"); runImportPreview(); });
act("import-preview-btn", () => { const ta = $("textarea[name='tsv']"); if (ta) S.drawer.extra.tsv = ta.value; runImportPreview(); });
act("import-match", (el) => { const x = S.drawer.extra; x.decisions.matches ||= {}; const v = el.value; x.decisions.matches[el.getAttribute("data-row")] = v === "" ? "skip" : v; runImportPreview(); });
act("import-field", (el) => { const x = S.drawer.extra; x.decisions.fields ||= {}; x.decisions.fields[el.getAttribute("data-key")] = el.checked ? "sheet" : "app"; runImportPreview(); });
act("import-revenue", (el) => { const x = S.drawer.extra; x.decisions.revenue ||= {}; x.decisions.revenue[el.getAttribute("data-key")] = el.value; runImportPreview(); });
act("import-commit", async () => {
  if (!requireMe()) return;
  const x = S.drawer.extra;
  const s = x.preview.summary;
  if (s.ambiguous) { toast(`${s.ambiguous} row${s.ambiguous > 1 ? "s" : ""} still need a match picked`, true); return; }
  const r = await confirmDialog({ title: "Import the sheet?", body: `<p>${s.update} projects updated, ${s.create} created, ${s.fieldChanges} field changes, ${s.updatesAdd} new updates, ${s.updatesRedate} re-dated. ${s.fieldConflicts ? `${s.fieldConflicts} app edits kept.` : ""}</p><p class="muted small">Nothing is deleted. A backup of today's board is kept.</p>`, confirmLabel: "Import" });
  if (!r) return;
  x.busy = true; renderDrawer();
  const ok = await mutate(() => api.post("/api/import/sheet", { tsv: x.tsv, decisions: x.decisions, commit: true }), "Sheet imported");
  x.busy = false;
  if (ok) { markClean(); S.drawer = null; render("user"); } else renderDrawer();
});

/* settings, people */
act("save-settings-btn", () => $("form[data-submit='save-settings']")?.requestSubmit());
act("save-settings", async (form) => {
  if (!requireMe()) return;
  const f = formData(form);
  const body = {};
  ["utilAmber", "utilRed", "capacityHoursPerWeek", "staleUpdateDays", "capacityPerDM", "capacityPerEditor"].forEach((k) => { if (f[k] !== "" && f[k] != null) body[k] = Number(f[k]); });
  body.workingDays = [0, 1, 2, 3, 4, 5, 6].filter((i) => f["wd" + i]);
  body.holidays = String(f.holidays || "").split(/\n/).map((s) => s.trim()).filter(isISO);
  const tpl = [];
  for (let i = 0; i < 40; i++) { if (f[`t${i}_title`] === undefined) break; tpl.push({ stage: f[`t${i}_stage`], title: f[`t${i}_title`], ownerType: f[`t${i}_ownerType`], durationDays: Number(f[`t${i}_durationDays`]) || 1 }); }
  if (tpl.length) body.milestoneTemplate = tpl;
  const ok = await mutate(() => api.patch("/api/settings", body), "Settings saved for everyone");
  if (ok) { markClean(); closeDrawer(); }
});
act("save-person", async (form) => {
  if (!requireMe()) return;
  const f = formData(form);
  const body = { id: form.getAttribute("data-id"), capacityHoursPerWeek: numOrNull(f.capacityHoursPerWeek), availability: { status: f.availability, until: f.until || null }, skills: String(f.skills || "").split(",").map((s) => s.trim()).filter(Boolean) };
  const ok = await mutate(() => api.patch("/api/people", body), "Saved");
  if (ok) { markClean(); renderDrawer(); }
});
act("assumption", async (el) => { if (!requireMe()) return; await mutate(() => api.patch("/api/settings", { [el.getAttribute("data-key")]: Number(el.value) }), "Saved"); });

/* scenario levers (Executive overview) */
act("lever", (el) => {
  S.scenario ||= defaultScenario();
  S.scenario[el.getAttribute("data-key")] = Number(el.value);
  const card = $("#scenario-card");
  if (!card) return;
  const main = $("#main"); const keep = main.scrollTop;
  const tmp = document.createElement("div"); tmp.innerHTML = renderOverview();
  const fresh = tmp.querySelector("#scenario-card");
  if (fresh) card.replaceWith(fresh);
  main.scrollTop = keep;
  $(`[data-key="${el.getAttribute("data-key")}"][data-input="lever"]`)?.focus();
});
act("toggle-churn", (el) => { S.scenario ||= defaultScenario(); const k = el.getAttribute("data-key"); const i = S.scenario.churn.indexOf(k); if (i < 0) S.scenario.churn.push(k); else S.scenario.churn.splice(i, 1); rerender(); });
act("reset-scenario", () => { S.scenario = defaultScenario(); rerender(); });

/* --------------------------------------------------------------- export */

act("export", () => exportWorkbook());
function sheetData() {
  const byId = Object.fromEntries(projects().map((p) => [p.id, p]));
  const msById = Object.fromEntries(S.data.milestones.map((m) => [m.id, m]));
  return {
    Projects: projects().map((p) => { const d = deliveryOf(p), h = healthOf(p), f = forecastOf(p), sc = scopeCompletion(p); return {
      Client: p.client, Project: p.projectName, Priority: p.priority, Status: p.status, Health: h.label, "Risk reason": h.reasons[0]?.label || "",
      "Primary DM": p.primaryDm, "Other DMs": (p.dms || []).filter((x) => x !== p.primaryDm).join(", "), SDM: p.sdm, Editors: editorsOf(p).join(", "),
      Category: (p.categories || []).join(", "), "Revenue (INR)": Math.round(shareOf(p)), "Locked scope": p.scopeLocked || p.scope, "Completed scope": p.scopeCompleted || p.completedFromScope,
      "Scope %": sc.pct == null ? "" : Math.round(sc.pct), "Current milestone": f.current?.title || "", "Committed delivery": d.baseline || "", "Original commitment": d.baselineOriginal || "",
      "Forecast delivery": d.forecast || "", "Slip (days)": d.slipDays ?? "", "Days remaining": d.daysRemaining ?? "", "Last update": lastUpdate(p)?.date || "", "Last update by": lastUpdate(p)?.author || "",
      "Effort points": Number(effortOf(p).points.toFixed(2)), "Updates (60d)": activityOf(p), Flags: risksOf(p).map((r) => r.label).join(" · "),
    }; }),
    Milestones: S.data.milestones.map((m) => { const p = byId[m.projectId]; const fm = p ? forecastOf(p).milestones.get(m.id) : null; return {
      Project: p?.label || m.projectId, Milestone: m.title, Stage: m.stage, Owner: m.owner, "Owner type": m.ownerType, Status: m.status, Start: m.startDate || "", "Committed due": m.baselineDue || "",
      "Owner's date": m.ownerEta || "", Forecast: fm?.forecast || "", "Slip (days)": fm?.slipDays ?? "", "Done on": m.actualDone || "", "Duration (wd)": m.durationDays ?? "", "Depends on": (m.dependsOn || []).map((id) => msById[id]?.title || id).join(", "), Locked: m.locked ? "Yes" : "", Blocker: m.blocker,
    }; }),
    Assignments: resolvedAssignments().map((a) => ({ Editor: a.editor, Project: byId[a.projectId]?.label || a.projectId, Milestone: msById[a.milestoneId]?.title || "", "Hours (est.)": a.estimatedHours ?? "", Start: a.start || "", End: a.end || "", Status: a.status, "Window from": a.derived ? "milestone" : "pinned" })),
    Escalations: S.data.escalations.map((e) => ({ Project: byId[e.projectId]?.label || e.projectId, Reason: e.reason, Severity: e.severity, Owner: e.owner, Raised: e.raisedOn, "Raised by": e.raisedBy, Deadline: e.resolutionTarget || "", Status: e.status, Blocker: e.blocker, "Next action": e.nextAction, Resolved: e.resolvedAt ? e.resolvedAt.slice(0, 10) : "", Resolution: e.resolution })),
    Updates: S.data.updates.filter((u) => !u.draft).map((u) => ({ Date: u.date, Author: u.author, Project: byId[u.projectId]?.label || u.projectId, Completed: u.completed || u.text, Planned: u.planned || "", Blockers: u.blockers, "Dependency owner": u.dependencyOwner || "", "Next action": u.nextAction || "", "Action owner": u.nextActionOwner || "", "Expected resolution": u.expectedResolution || "", "Next milestone date": u.nextMilestoneDate || u.eta || "", "DM forecast": u.forecastDelivery || "" })),
    DMs: dmPerformance(projects()).map((r) => ({ DM: r.name, Projects: r.projects, Active: Number(r.active.toFixed(2)), "High priority": Number(r.high.toFixed(2)), "At risk": Number(r.atRisk.toFixed(2)), "Effort points": Number(r.points.toFixed(2)), "Revenue (INR)": Math.round(r.rev), Editors: r.editorCount, "On-time rate": r.onTime == null ? "" : Math.round(r.onTime * 100), "Overdue milestones": Number(r.overdueMs.toFixed(1)), "Update compliance": r.compliance == null ? "" : Math.round(r.compliance * 100) })),
    Editors: editorCapacity(TODAY, new Date(Date.parse(TODAY) + 6 * 864e5).toISOString().slice(0, 10)).map((r) => ({ Editor: r.name, "Active projects": r.active, DMs: r.dms.join(", "), "Due this week": r.dueWeek, "Scheduled hours": r.util.scheduled, "Available hours": r.util.capacity, "Utilisation %": r.util.ratio == null ? "" : Math.round(r.util.ratio * 100), Unestimated: r.util.unestimated.length, Overdue: r.overdue, "Next deadline": r.next || "", Availability: r.availability })),
  };
}
function exportWorkbook() {
  const data = sheetData();
  const stamp = TODAY.replace(/-/g, "");
  if (window.XLSX) {
    const wb = XLSX.utils.book_new();
    Object.entries(data).forEach(([name, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name));
    XLSX.writeFile(wb, `TFOps_${stamp}.xlsx`);
    toast("Workbook downloaded");
    return;
  }
  const rows = data.Projects;
  const cols = Object.keys(rows[0] || {});
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = `TFOps_${stamp}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast("Excel library unavailable — exported CSV instead");
}

/* ------------------------------------------------- timeline & allocation */

const saveTimeline = () => persist("timeline", { mode: S.timeline.mode, zoom: S.timeline.zoom, group: S.timeline.group, window: S.timeline.window, cal: S.timeline.cal });
act("tl-mode", (el) => { S.timeline.mode = el.getAttribute("data-mode"); S.tab = S.timeline.mode; saveTimeline(); history.replaceState(null, "", "#timeline/" + S.tab); rerender(); });
act("tl-expand", (el) => { const id = el.getAttribute("data-id"); const set = S.timeline.expanded; if (set.has(id)) set.delete(id); else set.add(id); rerender(); });
act("tl-zoom", (el) => { S.timeline.zoom = el.getAttribute("data-zoom"); saveTimeline(); rerender(); });
act("tl-window", (el) => { S.timeline.window = el.getAttribute("data-window"); saveTimeline(); rerender(); });
act("tl-group", (el) => { S.timeline.group = el.value; saveTimeline(); rerender(); });
act("cal-mode", (el) => { S.timeline.cal = el.getAttribute("data-mode"); saveTimeline(); rerender(); });
act("cal-nav", (el) => {
  const dir = Number(el.getAttribute("data-dir"));
  const mode = S.timeline.cal || "month";
  if (dir === 0) { S.timeline.calFrom = ""; rerender(); return; }
  const cur = S.timeline.calFrom || TODAY;
  if (mode === "week") S.timeline.calFrom = new Date(Date.parse(cur) + dir * 7 * 864e5).toISOString().slice(0, 10);
  else { const d = new Date(cur.slice(0, 8) + "01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + dir); S.timeline.calFrom = d.toISOString().slice(0, 10); }
  rerender();
});
act("cal-day", (el) => { S.timeline.cal = "week"; S.timeline.calFrom = el.getAttribute("data-day"); rerender(); });
act("alloc-mode", (el) => { S.alloc.mode = el.getAttribute("data-mode"); rerender(); });
act("alloc-nav", (el) => {
  const dir = Number(el.getAttribute("data-dir"));
  if (dir === 0) { S.alloc.from = ""; rerender(); return; }
  const cur = S.alloc.from || TODAY;
  const step = S.alloc.mode === "day" ? 14 : 7 * Math.max(1, Math.floor((S.alloc.weeks || 8) / 2));
  S.alloc.from = new Date(Date.parse(cur) + dir * step * 864e5).toISOString().slice(0, 10);
  rerender();
});
act("open-assign-editor", (el) => {
  const editor = el.getAttribute("data-editor");
  const first = projects().filter((p) => statusKind(p.status) === "active" && !editorsOf(p).length)[0] || projects().find((p) => statusKind(p.status) === "active");
  if (!first) { toast("No active project to assign to", true); return; }
  openDrawer("assign", first.id, "", { editor });
});
act("open-assign-pick", async () => {
  const opts = projects().filter((p) => statusKind(p.status) !== "done").sort((a, b) => a.label.localeCompare(b.label));
  const r = await confirmDialog({ title: "Assign work", body: `<div class="field"><label>Project</label><select name="projectId" required>${opts.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("")}</select></div>`, confirmLabel: "Next" });
  if (!r) return;
  openDrawer("assign", r.projectId);
});
act("resolve-escalation-row", async (el) => {
  if (!requireMe()) return;
  const r = await confirmDialog({ title: "Mark this escalation resolved?", body: `<div class="field"><label>Resolution</label><input name="resolution" placeholder="What settled it"></div>`, confirmLabel: "Resolve" });
  if (!r) return;
  await mutate(() => api.patch(`/api/escalations/${el.getAttribute("data-id")}`, { status: "resolved", resolution: r.resolution || "" }), "Resolved");
});

/* Calendar drag-and-drop: a milestone dropped on a day becomes a proposed
   owner's date; the impact is shown and nothing saves without a yes. */
let dragging = null;
document.addEventListener("dragstart", (e) => {
  const ev = e.target.closest?.("[data-ev]");
  if (!ev || !canEdit()) return;
  dragging = ev.getAttribute("data-ev");
  ev.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", dragging); } catch (_) {}
});
document.addEventListener("dragend", () => { dragging = null; $$(".ev.dragging").forEach((el) => el.classList.remove("dragging")); $$(".day.drop").forEach((el) => el.classList.remove("drop")); });
document.addEventListener("dragover", (e) => {
  const day = e.target.closest?.(".day[data-day]");
  if (!day || !dragging) return;
  e.preventDefault();
  $$(".day.drop").forEach((el) => { if (el !== day) el.classList.remove("drop"); });
  day.classList.add("drop");
});
document.addEventListener("drop", async (e) => {
  const day = e.target.closest?.(".day[data-day]");
  if (!day || !dragging) return;
  e.preventDefault();
  const id = dragging; dragging = null;
  const date = day.getAttribute("data-day");
  if (!requireMe()) return;
  if (id.startsWith("ms:")) {
    const msId = id.slice(3);
    const m = S.data.milestones.find((x) => x.id === msId);
    if (!m) return;
    const p = projectById(m.projectId);
    let impact = null;
    try { impact = (await api.patch(`/api/milestones/${msId}?preview=1`, { ownerEta: date })).impact; } catch (err) { toast(err.message, true); return; }
    const r = await confirmDialog({ title: `Move "${m.title}" to ${fmtDateFull(date)}?`, body: `<p class="muted small">This sets the owner's date; the committed date stays ${m.baselineDue ? esc(fmtDateFull(m.baselineDue)) : "unset"}.</p>${impactBox(impact, p)}`, confirmLabel: impact.affectsCommitment ? "Move anyway" : "Move", danger: impact.affectsCommitment });
    if (!r) return;
    await mutate(() => api.patch(`/api/milestones/${msId}`, { ownerEta: date }), "Milestone moved");
  } else if (id.startsWith("final:")) {
    const pid = id.slice(6);
    const p = projectById(pid);
    const fin = milestonesOf(p).find((x) => x.stage === "final_delivery");
    if (fin) {
      let impact = null;
      try { impact = (await api.patch(`/api/milestones/${fin.id}?preview=1`, { ownerEta: date })).impact; } catch (err) { toast(err.message, true); return; }
      const r = await confirmDialog({ title: `Move the final delivery to ${fmtDateFull(date)}?`, body: impactBox(impact, p), confirmLabel: impact.affectsCommitment ? "Move anyway" : "Move", danger: impact.affectsCommitment });
      if (!r) return;
      await mutate(() => api.patch(`/api/milestones/${fin.id}`, { ownerEta: date }), "Final delivery moved");
    } else {
      const r = await confirmDialog({ title: `Forecast ${p.client}'s delivery for ${fmtDateFull(date)}?`, body: `<p class="muted small">There is no milestone chain, so this records a forecast override. The committed date ${p.end ? esc(fmtDateFull(p.end)) : "is not set and"} does not move.</p><div class="field"><label>Reason</label><input name="reason" required placeholder="Why"></div>`, confirmLabel: "Set forecast" });
      if (!r) return;
      await mutate(() => api.patch(`/api/projects/${encodeURIComponent(pid)}`, { deliveryOverride: { date, reason: r.reason } }), "Forecast recorded");
    }
  }
});

/* ---------------------------------------------------------------- theme */

act("theme", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : cur === "light" ? "" : "dark";
  if (next) document.documentElement.setAttribute("data-theme", next); else document.documentElement.removeAttribute("data-theme");
  persist("theme", next);
  $("#themebtn").textContent = next === "dark" ? "☾" : next === "light" ? "☀" : "◐";
});

/* ----------------------------------------------------------------- boot */

async function boot() {
  const t = recall("theme", "");
  if (t) { document.documentElement.setAttribute("data-theme", t); $("#themebtn").textContent = t === "dark" ? "☾" : "☀"; }
  S.register.mode = recall("register.mode", "cards");
  S.timeline = { ...S.timeline, ...recall("timeline", {}), expanded: new Set() };

  initActions();
  initTooltips();
  setRenderer(render);

  const [page, tab] = (location.hash || "#" + HOME).slice(1).split("/");
  S.page = PAGES[page] ? page : HOME;
  S.tab = tab || "";

  try {
    await refresh(true, "user");
  } catch (err) {
    if (err.redirecting) return;
    $("#main").innerHTML = `<section class="card"><div class="empty"><div class="big">Could not reach the board</div>${esc(err.message)}</div></section>`;
    return;
  }
  if (!S.me && canEdit() && S.openAccess) openDrawer("pick-me");
  startPolling();
}

boot();
