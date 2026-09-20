/* Router, action handlers and boot. */

import {
  S, $, $$, esc, api, act, initActions, initTooltips, toast, mutate, refresh,
  startPolling, paintSync, setRenderer, avatar, debounce, hideTip, TODAY, money, num,
  canEdit,
} from "./core.js";
import {
  projects, roster, allOf, shareOf, statusKind, risksOf, lastUpdate,
  defaultScenario, settings, podRollup, rollup, clientRollup,
  effortOf, activityOf, loadRollup,
} from "./compute.js";
import { renderOverview } from "./views/overview.js";
import { renderEscalations } from "./views/escalations.js";
import { renderLoad } from "./views/load.js";
import { renderTimeline } from "./views/timeline.js";
import { renderStandup } from "./views/standup.js";
import { renderProjects } from "./views/projects.js";
import { renderMine } from "./views/mine.js";
import { renderDrawer, renderPersonDrawer, readDrawerForm, projectById } from "./views/drawer.js";

const VIEWS = {
  load:     { label: "Delivery load", render: renderLoad },
  overview: { label: "Overview", render: renderOverview },
  escalations: { label: "Escalations", render: renderEscalations },
  timeline: { label: "Timeline", render: renderTimeline },
  standup:  { label: "Standup",  render: renderStandup },
  projects: { label: "Projects", render: renderProjects },
  mine:     { label: "My work",  render: renderMine },
};

const HOME = "load";

/* ------------------------------------------------------------------ render */

let pendingScroll = null;

function render() {
  if (!S.data) return;
  const view = VIEWS[S.view] ? S.view : HOME;

  $("#tabs").innerHTML = Object.entries(VIEWS).map(([k, v]) =>
    `<button class="tab" data-act="goto" data-view="${k}" ${k === view ? 'aria-current="page"' : ""}>${esc(v.label)}</button>`
  ).join("");

  $("#who").innerHTML = S.me
    ? `${avatar(S.me, "sm")}<span>${esc(S.me)}</span>`
    : `<span class="avatar sm" style="background:var(--track);color:var(--ink-3)">?</span><span>Who are you?</span>`;

  $("#rolebox").innerHTML = S.role === "view"
    ? `<span class="chip ring" data-tip="Signed in with the read-only password. You can see everything and change nothing.">👁 View only</span>
       <a class="btn sm ghost" href="/logout">Sign out</a>`
    : S.openAccess
      ? `<span class="chip on" data-tip="No password is configured on this server. Fine on a LAN; set TFOPS_PASSWORD before exposing it.">Open access</span>`
      : `<a class="btn sm ghost" href="/logout">Sign out</a>`;

  const keep = pendingScroll ?? window.scrollY;
  pendingScroll = null;

  $("#main").innerHTML = VIEWS[view].render();
  $("#drawer-host").innerHTML = S.person
    ? renderPersonDrawer(S.person.name, S.person.role)
    : S.drawer ? renderDrawer(S.drawer) : "";
  document.title = `${VIEWS[view].label} · TFOps`;
  paintSync();
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({ top: Math.min(keep, maxScroll), behavior: "instant" });
}

function rerender() { pendingScroll = window.scrollY; render(); }

/* ----------------------------------------------------------- navigation */

act("goto", (el) => {
  const v = el.getAttribute("data-view");
  if (el.hasAttribute("data-risk")) S.filters.risk = el.getAttribute("data-risk");
  setView(v);
});

function setView(v) {
  S.view = v;
  S.drawer = null;
  S.person = null;
  history.replaceState(null, "", "#" + v);
  window.scrollTo({ top: 0, behavior: "instant" });
  render();
}

/* -------------------------------------------------------------- filters */

act("filter", (el) => {
  S.filters[el.getAttribute("data-key")] = el.value;
  rerender();
});
act("filter-q", debounce((el) => { S.filters.q = el.value; rerender(); }, 200));
act("clear-filters", () => {
  S.filters = { q: "", pod: "", status: "", category: "", person: "", risk: "" };
  rerender();
});
act("filter-pod", (el) => {
  S.filters.pod = el.getAttribute("data-pod");
  setView("projects");
});
act("filter-person", (el) => {
  S.filters.person = el.getAttribute("data-person");
  setView("projects");
});
act("sort-projects", (el) => {
  const key = el.getAttribute("data-key");
  const s = S.sort.projects;
  s.dir = s.key === key ? -s.dir : (key === "rev" || key === "flags" ? -1 : 1);
  s.key = key;
  rerender();
});
act("tl-zoom", (el) => { S.timeline.zoom = el.getAttribute("data-zoom"); rerender(); });
act("tl-window", (el) => { S.timeline.window = el.getAttribute("data-window"); rerender(); });
act("tl-group", (el) => { S.timeline.group = el.value; rerender(); });

/* --------------------------------------------------------------- drawer */

act("open-project", (el) => {
  S.drawer = el.getAttribute("data-id");
  S.person = null;
  hideTip();
  render();
});
act("open-person", (el) => {
  S.person = { name: el.getAttribute("data-name"), role: el.getAttribute("data-role") };
  S.drawer = null;
  hideTip();
  render();
});
act("close-drawer", () => { S.drawer = null; S.person = null; render(); });

act("toggle-open", (el) => {
  const end = $("#f-end");
  if (end) { end.disabled = el.checked; if (el.checked) end.value = ""; }
});
act("progress-label", (el) => {
  el.dataset.touched = "1";
  const txt = $("#prog-txt");
  if (txt) txt.textContent = `${el.value}%`;
});
act("clear-progress", () => {
  const el = $("#f-progress");
  if (!el) return;
  el.value = 0;
  el.dataset.touched = "0";
  el.dataset.initial = "";
  const txt = $("#prog-txt");
  if (txt) txt.textContent = "not set";
});

act("submit-project", (el) => saveProject(el.getAttribute("data-id")));
act("save-project", (el) => saveProject(el.getAttribute("data-id")));

async function saveProject(id) {
  if (!requireMe()) return;
  const form = $("#proj-form");
  if (!form) return;
  const patch = readDrawerForm(form);
  await mutate(() => api.patch(`/api/projects/${encodeURIComponent(id)}`, patch), "Saved");
}

act("add-milestone", async (el) => {
  if (!requireMe()) return;
  const fd = new FormData(el);
  await mutate(() => api.post("/api/milestones", {
    projectId: el.getAttribute("data-id"),
    title: fd.get("title"),
    date: fd.get("date"),
  }), "Milestone added");
});
act("toggle-milestone", async (el) => {
  if (!requireMe()) return;
  await mutate(() => api.patch(`/api/milestones/${el.getAttribute("data-id")}`, { done: el.checked }));
});
act("del-milestone", async (el) => {
  if (!requireMe()) return;
  await mutate(() => api.delete(`/api/milestones/${el.getAttribute("data-id")}`), "Milestone removed");
});

/* -------------------------------------------------------------- updates */

act("composer-project", (el) => {
  const p = projectById(el.value);
  const box = $("#timeline-inline");
  if (!box) return;
  const needsDates = p && !p.start && !p.end && !p.openEnded;
  box.classList.toggle("hide", !needsDates);
});

act("post-update", async (el) => {
  if (!requireMe()) return;
  const fd = new FormData(el);
  const projectId = fd.get("projectId");
  const start = fd.get("start"), end = fd.get("end"), openEnded = fd.get("openEnded") === "on";

  const ok = await mutate(async () => {
    await api.post("/api/updates", {
      projectId,
      text: fd.get("text"),
      status: fd.get("status"),
      date: fd.get("date") || TODAY,
      blockers: fd.get("blockers"),
      eta: fd.get("eta"),
    });
    if (projectId && (start || end || openEnded)) {
      await api.patch(`/api/projects/${encodeURIComponent(projectId)}`, {
        start: start || null, end: openEnded ? null : (end || null), openEnded,
      });
    }
  }, start || end || openEnded ? "Posted — and the timeline moved" : "Posted");
  if (ok) el.reset?.();
});

act("quick-update", async (el) => {
  if (!requireMe()) return;
  const fd = new FormData(el);
  await mutate(() => api.post("/api/updates", {
    projectId: el.getAttribute("data-id"),
    text: fd.get("text"),
    date: TODAY,
  }), "Posted");
});

act("del-update", async (el) => {
  if (!requireMe()) return;
  if (!confirm("Delete this update? It disappears for everyone.")) return;
  await mutate(() => api.delete(`/api/updates/${el.getAttribute("data-id")}`), "Deleted");
});

/* ------------------------------------------------------------- scenario */

act("lever", (el) => {
  const key = el.getAttribute("data-key");
  S.scenario ||= defaultScenario();
  S.scenario[key] = Number(el.value);
  // Repaint only the studio so the slider keeps focus and the drag stays smooth.
  paintScenario();
});
act("toggle-churn", (el) => {
  const key = el.getAttribute("data-key");
  S.scenario ||= defaultScenario();
  const i = S.scenario.churn.indexOf(key);
  if (i < 0) S.scenario.churn.push(key); else S.scenario.churn.splice(i, 1);
  rerender();
});
act("reset-scenario", () => { S.scenario = defaultScenario(); rerender(); });

/* Delivery-load levers. Repaint in place so a drag stays smooth. */
act("load-lever", (el) => {
  S.loadScenario ||= { dmDelta: 0, edDelta: 0, unfreeze: 0 };
  S.loadScenario[el.getAttribute("data-key")] = Number(el.value);
  paintInPlace(renderLoad, el.getAttribute("data-key"), "load-lever");
});
act("reset-load", () => { S.loadScenario = { dmDelta: 0, edDelta: 0, unfreeze: 0 }; rerender(); });
act("load-by", (el) => { S.loadBy = el.getAttribute("data-by"); S.loadAll = false; rerender(); });
act("load-all", () => { S.loadAll = !S.loadAll; rerender(); });
act("filter-client", (el) => {
  S.filters.q = el.getAttribute("data-client");
  setView("projects");
});

/** Re-render one view in place and hand focus back to the control being dragged,
    so a slider keeps the pointer instead of dying under the cursor. */
function paintInPlace(renderFn, activeKey, inputName) {
  const pos = window.scrollY;
  $("#main").innerHTML = renderFn();
  window.scrollTo({ top: pos, behavior: "instant" });
  if (!activeKey) return;
  const el = $(`[data-key="${activeKey}"][data-input="${inputName}"]`);
  if (el) el.focus();
}

function paintScenario() {
  paintInPlace(renderOverview, document.activeElement?.getAttribute?.("data-key"), "lever");
}

act("assumption", async (el) => {
  if (!requireMe()) return;
  const key = el.getAttribute("data-key");
  await mutate(() => api.patch("/api/settings", { [key]: Number(el.value) }), "Assumption saved for everyone");
});

/* ------------------------------------------------------------ identity */

function requireMe() {
  if (S.me) return true;
  toast("Pick who you are first — top right", true);
  openNamePicker();
  return false;
}

act("pick-me", () => {
  // With logins on, the name comes from the sign-in form — changing it means
  // signing in again, rather than keeping two ideas of who you are.
  if (!S.openAccess) { location.href = "/logout"; return; }
  openNamePicker();
});

function openNamePicker() {
  const names = roster();
  const host = $("#drawer-host");
  host.innerHTML = `
    <div class="scrim" data-act="close-picker"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Who are you"
           style="width:min(440px,calc(100vw - 20px))">
      <header class="drawer-h">
        <div style="flex:1"><h2>Who are you?</h2>
          <div class="muted" style="font-size:12.5px">Stored on this browser so your posts are signed.
            No password — this board is for the team.</div></div>
        <button class="btn sm ghost" data-act="close-picker" aria-label="Close">✕</button>
      </header>
      <div class="drawer-b">
        <form data-submit="set-me" style="display:flex;gap:8px;margin-bottom:16px">
          <input type="text" name="name" list="dl-roster" placeholder="Type your name" value="${esc(S.me)}"
                 autofocus style="flex:1">
          <datalist id="dl-roster">${names.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
          <button class="btn primary" type="submit">Set</button>
        </form>
        <div class="section-t">On the board</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${names.map((n) => `<button class="chip ${n === S.me ? "on" : "ring"}" data-act="set-me-quick" data-name="${esc(n)}">
            ${avatar(n, "sm")} ${esc(n)}</button>`).join("")}
        </div>
      </div>
    </aside>`;
}

act("close-picker", () => { $("#drawer-host").innerHTML = ""; });

act("set-me", async (el) => {
  const name = new FormData(el).get("name").toString().trim();
  await setMe(name);
});
act("set-me-quick", async (el) => setMe(el.getAttribute("data-name")));

async function setMe(name) {
  if (!name) return;
  try {
    await api.post("/api/me", { name });
    S.me = name;
    $("#drawer-host").innerHTML = "";
    toast(`Signed in as ${name}`);
    render();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------------------------------------------------- new project */

act("new-project", () => {
  const host = $("#drawer-host");
  host.innerHTML = `
    <div class="scrim" data-act="close-picker"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="New project" style="width:min(460px,calc(100vw - 20px))">
      <header class="drawer-h"><div style="flex:1"><h2>New project</h2>
        <div class="muted" style="font-size:12.5px">It lands on the board for everyone.</div></div>
        <button class="btn sm ghost" data-act="close-picker">✕</button></header>
      <div class="drawer-b">
        <form data-submit="create-project" style="display:grid;gap:12px">
          <div class="field"><label for="np-client">Client</label>
            <input id="np-client" name="client" list="dl-clients" required></div>
          <datalist id="dl-clients">${allOf("client").map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>
          <div class="field"><label for="np-name">Project name</label><input id="np-name" name="projectName"></div>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label for="np-pod">Pod owner</label>
              <input id="np-pod" name="podOwner" list="dl-roster2"></div>
            <div class="field"><label for="np-sdm">SDM</label><input id="np-sdm" name="sdm" list="dl-roster2"></div>
            <div class="field"><label for="np-dm">DMs</label><input id="np-dm" name="dms" placeholder="comma separated" list="dl-roster2"></div>
            <div class="field"><label for="np-ed">Editor leads</label><input id="np-ed" name="editorLeads" placeholder="comma separated" list="dl-roster2"></div>
            <div class="field"><label for="np-start">Start</label><input id="np-start" type="date" name="start"></div>
            <div class="field"><label for="np-end">End</label><input id="np-end" type="date" name="end"></div>
          </div>
          <datalist id="dl-roster2">${roster().map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
          <div class="field"><label for="np-status">Status</label>
            <select id="np-status" name="status"><option>Upcoming</option><option>Active</option><option>On Hold</option></select></div>
          <div class="field"><label for="np-scope">Scope</label><textarea id="np-scope" name="scope" rows="3"></textarea></div>
          <button class="btn primary" type="submit">Create</button>
        </form>
      </div>
    </aside>`;
});

act("create-project", async (el) => {
  if (!requireMe()) return;
  const fd = new FormData(el);
  const split = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = await mutate(() => api.post("/api/projects", {
    client: fd.get("client"),
    projectName: fd.get("projectName"),
    podOwner: fd.get("podOwner"),
    sdm: fd.get("sdm"),
    dms: split(fd.get("dms")),
    editorLeads: split(fd.get("editorLeads")),
    start: fd.get("start") || null,
    end: fd.get("end") || null,
    status: fd.get("status"),
    scope: fd.get("scope"),
  }), "Project created");
  if (ok) $("#drawer-host").innerHTML = "";
});

/* --------------------------------------------------------------- export */

act("export", () => exportWorkbook());

function sheetData() {
  const ups = S.data.updates;
  const byId = Object.fromEntries(projects().map((p) => [p.id, p]));
  return {
    Projects: projects().map((p) => ({
      Client: p.client, Project: p.projectName, Pod: p.podOwner, SDM: p.sdm,
      DMs: (p.dms || []).join(", "), "Editor leads": (p.editorLeads || []).join(", "),
      Status: p.status, Priority: p.priority, "Service lines": (p.categories || []).join(", "),
      Start: p.start || p.startNote, End: p.openEnded ? "Open-ended" : (p.end || p.endNote),
      Progress: p.progress, "Revenue (INR)": Math.round(shareOf(p)),
      "Effort points": Number(effortOf(p).points.toFixed(2)),
      "Effort source": effortOf(p).source,
      "Updates (60d)": activityOf(p),
      "Last update": lastUpdate(p)?.date || "", Flags: risksOf(p).map((r) => r.label).join(" · "),
      Scope: p.scope,
    })),
    Timeline: projects().filter((p) => p.start || p.end).map((p) => ({
      Project: p.label, Pod: p.podOwner, Start: p.start, End: p.end,
      "Open ended": p.openEnded ? "Yes" : "", Status: p.status,
    })),
    Updates: ups.map((u) => ({
      Date: u.date, Author: u.author, Project: byId[u.projectId]?.label || u.projectId,
      Status: u.status, Update: u.text, Blockers: u.blockers, "Next delivery": u.eta,
    })),
    Pods: podRollup().map((p) => ({
      Pod: p.name, "Revenue (INR)": Math.round(p.rev), Projects: p.load, Active: p.active,
      DMs: p.dmCount, "Editor leads": p.edCount, "Revenue per DM": Math.round(p.revPerDM),
    })),
    "Load by DM": loadRollup("dms").map((r) => ({
      DM: r.name, "Effort points": Number(r.points.toFixed(1)), Live: r.live,
      "On hold": r.held, Clients: r.clientCount, "Revenue (INR)": Math.round(r.rev),
      "Updates (60d)": Math.round(r.activity), "Biggest project": r.top?.p.label || "",
    })),
    "Load by editor": loadRollup("editorLeads").map((r) => ({
      "Editor lead": r.name, "Effort points": Number(r.points.toFixed(1)), Live: r.live,
      "On hold": r.held, Clients: r.clientCount, "Revenue (INR)": Math.round(r.rev),
      "Updates (60d)": Math.round(r.activity), "Biggest project": r.top?.p.label || "",
    })),
    Clients: clientRollup().map((c) => ({
      Client: c.name, "Revenue (INR)": Math.round(c.rev), "Project rows": c.load,
      Active: c.active, "On hold": c.hold, Unmapped: c.unmapped ? "Yes" : "",
    })),
  };
}

function exportWorkbook() {
  const data = sheetData();
  const stamp = TODAY.replace(/-/g, "");
  if (window.XLSX) {
    const wb = XLSX.utils.book_new();
    Object.entries(data).forEach(([name, rows]) => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    });
    XLSX.writeFile(wb, `TFOps_${stamp}.xlsx`);
    toast("Workbook downloaded");
    return;
  }
  // No CDN (offline) — CSV of the main sheet still gets the job done.
  const rows = data.Projects;
  const cols = Object.keys(rows[0] || {});
  const csv = [cols.join(","), ...rows.map((r) =>
    cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `TFOps_${stamp}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast("Excel library unavailable — exported CSV instead");
}

/* ---------------------------------------------------------------- theme */

act("theme", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : cur === "light" ? "" : "dark";
  if (next) document.documentElement.setAttribute("data-theme", next);
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("tfops.theme", next); } catch (_) {}
  $("#themebtn").textContent = next === "dark" ? "☾" : next === "light" ? "☀" : "◐";
});

/* ----------------------------------------------------------------- boot */

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("#drawer-host").innerHTML) { S.drawer = null; S.person = null; $("#drawer-host").innerHTML = ""; render(); }
  }
  if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) {
    const box = $('input[type="search"]');
    if (box) { e.preventDefault(); box.focus(); }
  }
});

async function boot() {
  // We restore scroll ourselves around re-renders; the browser's own guess
  // lands on the wrong place when a view swaps for a shorter one.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  try { const t = localStorage.getItem("tfops.theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (_) {}

  initActions();
  initTooltips();
  setRenderer(render);

  S.view = (location.hash || "#" + HOME).slice(1);
  if (!VIEWS[S.view]) S.view = HOME;

  try {
    await refresh(true);
  } catch (err) {
    if (err.redirecting) return;   // on the way to the login page
    $("#main").innerHTML = `<section class="card"><div class="empty">
      <div class="big">Could not reach the board</div>${esc(err.message)}</div></section>`;
    return;
  }
  // Only nag for a name when there is no login to have supplied one.
  if (!S.me && canEdit() && S.openAccess) openNamePicker();
  startPolling();
}

window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (VIEWS[v] && v !== S.view) { S.view = v; S.drawer = null; S.person = null; render(); }
});

boot();
