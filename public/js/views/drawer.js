/* Project drawer — read the row, then fix it.
   Dates, owners, status, milestones and this project's update thread all live
   here, because that is where someone actually has the context to correct them. */

import {
  S, esc, money, num, avatar, fmtDateFull, ago, TODAY, initials, canEdit,
} from "../core.js";
import {
  projects, shareOf, statusKind, risksOf, updatesByProject, milestonesByProject,
  isUnmapped, roster, allOf, lastUpdate, loadRollup, loadTotals, rolesOf,
  effortOf, EFFORT_LABELS,
} from "../compute.js";

const STATUSES = ["Active", "On Hold", "Upcoming", "Completed"];
const PRIORITIES = ["", "High", "Medium", "Low"];

export function projectById(id) {
  return projects().find((p) => p.id === id) || null;
}

function listInput(id, label, value, listId, hint) {
  return `
    <div class="field">
      <label for="${id}">${esc(label)}</label>
      <input id="${id}" type="text" value="${esc((value || []).join(", "))}" list="${listId}"
             data-field="${id.replace("f-", "")}" placeholder="comma separated">
      ${hint ? `<span class="muted" style="font-size:11px">${esc(hint)}</span>` : ""}
    </div>`;
}

export function renderDrawer(id) {
  const p = projectById(id);
  if (!p) return "";
  const risks = risksOf(p);
  const ups = (updatesByProject()[p.id] || []);
  const miles = milestonesByProject()[p.id] || [];
  const rev = shareOf(p);

  const people = roster();
  const cats = allOf("categories");

  return `
    <div class="scrim" data-act="close-drawer"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(p.label)}">
      <header class="drawer-h">
        <div style="flex:1;min-width:0">
          <h2>${esc(p.client)}</h2>
          ${p.projectName ? `<div class="muted" style="font-size:13px">${esc(p.projectName)}</div>` : ""}
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">
            <span class="status ${statusKind(p.status)}"><span class="ic">●</span>${esc(p.status)}</span>
            ${(p.categories || []).map((c) => `<span class="chip">${esc(c)}</span>`).join("")}
            <span class="chip ring num">${esc(money(rev))}${isUnmapped(p) ? " · unmapped" : ""}</span>
          </div>
        </div>
        <button class="btn sm ghost" data-act="close-drawer" aria-label="Close">✕</button>
      </header>

      <div class="drawer-b">
        ${risks.length ? `
          <div class="callout ${risks[0].sev === 2 ? "warn" : ""}" style="margin-bottom:18px">
            <span>${risks[0].sev === 2 ? "▲" : "●"}</span>
            <div>${risks.map((r) => esc(r.label)).join("<br>")}</div>
          </div>` : ""}

        <form id="proj-form" data-submit="save-project" data-id="${esc(p.id)}">
          <div class="section-t">Timeline</div>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label for="f-start">Start</label>
              <input id="f-start" type="date" value="${esc(p.start || "")}" data-field="start"></div>
            <div class="field"><label for="f-end">End</label>
              <input id="f-end" type="date" value="${esc(p.end || "")}" data-field="end"
                     ${p.openEnded ? "disabled" : ""}></div>
          </div>
          <label style="display:flex;align-items:center;gap:7px;margin-top:10px;font-size:12.5px;color:var(--ink-2)">
            <input type="checkbox" ${p.openEnded ? "checked" : ""} data-field="openEnded" data-act="toggle-open">
            Open-ended — runs until further notice
          </label>
          ${(p.startNote || p.endNote) ? `
            <div class="sheetnote" style="margin-top:10px">✎ the sheet said:
              ${esc([p.startNote, p.endNote].filter(Boolean).join(" → "))}</div>` : ""}

          <div class="field" style="margin-top:14px">
            <label for="f-progress" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
              <span>Progress — <span id="prog-txt">${p.progress == null ? "not set" : p.progress + "%"}</span></span>
              ${p.progress == null ? "" : `<button type="button" class="btn sm ghost" data-act="clear-progress"
                style="padding:1px 8px;font-size:11px">Clear</button>`}
            </label>
            <!-- data-touched keeps "not set" distinct from 0%: an untouched slider
                 must not turn a blank into a hard zero just because someone saved. -->
            <input id="f-progress" type="range" min="0" max="100" step="5"
                   value="${p.progress == null ? 0 : p.progress}" data-field="progress"
                   data-initial="${p.progress == null ? "" : p.progress}" data-touched="0"
                   data-input="progress-label">
          </div>

          <div class="section-t">Who is on it</div>
          <datalist id="dl-people">${people.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
          <datalist id="dl-cats">${cats.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
            ${listInput("f-dms", "DMs", p.dms, "dl-people")}
            ${listInput("f-editorLeads", "Editor leads", p.editorLeads, "dl-people")}
            <div class="field"><label for="f-podOwner">Pod owner</label>
              <input id="f-podOwner" type="text" value="${esc(p.podOwner || "")}" list="dl-people" data-field="podOwner"></div>
            <div class="field"><label for="f-sdm">SDM</label>
              <input id="f-sdm" type="text" value="${esc(p.sdm || "")}" list="dl-people" data-field="sdm"></div>
          </div>
          ${p.editorTagging ? `<div class="muted" style="font-size:12px;margin-top:8px">Editors tagged in the sheet: ${esc(p.editorTagging)}</div>` : ""}

          <div class="section-t">Classification</div>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label for="f-status">Status</label>
              <select id="f-status" data-field="status">
                ${STATUSES.map((s) => `<option ${p.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
              </select></div>
            <div class="field"><label for="f-priority">Priority</label>
              <select id="f-priority" data-field="priority">
                ${PRIORITIES.map((s) => `<option value="${esc(s)}" ${p.priority === s ? "selected" : ""}>${esc(s || "—")}</option>`).join("")}
              </select></div>
          </div>
          ${listInput("f-categories", "Service lines", p.categories, "dl-cats")}

          ${(() => {
            const e = effortOf(p);
            return `
            <div class="field" style="margin-top:12px">
              <label for="f-effort">Delivery effort</label>
              <select id="f-effort" data-field="effort">
                <option value="">Work it out from the service line${
                  e.source === "assumed" ? ` — currently ${EFFORT_LABELS[e.base]}` : ""}</option>
                ${Object.entries(EFFORT_LABELS).map(([v, lab]) =>
                  `<option value="${v}" ${String(p.effort) === v ? "selected" : ""}>${esc(lab)} · ${v} pt${v === "1" ? "" : "s"}</option>`).join("")}
              </select>
              <span class="muted" style="font-size:11px">${esc(e.why)}. This drives the Delivery load view.</span>
            </div>`;
          })()}

          <div class="field" style="margin-top:12px"><label for="f-scope">Scope</label>
            <textarea id="f-scope" data-field="scope" rows="4">${esc(p.scope || "")}</textarea></div>
          <div class="field" style="margin-top:12px"><label for="f-completedFromScope">Completed from scope</label>
            <input id="f-completedFromScope" type="text" value="${esc(p.completedFromScope || "")}" data-field="completedFromScope"></div>
        </form>

        <div class="section-t">Milestones</div>
        ${miles.length ? `<div style="display:grid;gap:7px;margin-bottom:12px">
          ${miles.map((m) => {
            const late = !m.done && m.date && m.date < TODAY;
            return `<div style="display:flex;align-items:center;gap:9px;font-size:13px">
              <input type="checkbox" ${m.done ? "checked" : ""} data-act="toggle-milestone" data-id="${esc(m.id)}"
                     aria-label="Mark ${esc(m.title)} done">
              <span style="${m.done ? "text-decoration:line-through;color:var(--ink-3)" : ""};flex:1">${esc(m.title)}</span>
              <span class="num ${late ? "" : "muted"}" style="font-size:12px;${late ? "color:var(--crit-ink)" : ""}">
                ${esc(m.date ? fmtDateFull(m.date) : "no date")}${late ? " · late" : ""}</span>
              <button class="btn sm ghost" data-act="del-milestone" data-id="${esc(m.id)}" aria-label="Delete">✕</button>
            </div>`;
          }).join("")}
        </div>` : `<div class="muted" style="font-size:12.5px;margin-bottom:12px">None yet — add the next delivery date.</div>`}
        <form data-submit="add-milestone" data-id="${esc(p.id)}" style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" name="title" placeholder="Milestone, e.g. first cut to client" required style="flex:2 1 180px">
          <input type="date" name="date" required style="flex:1 1 130px">
          <button class="btn sm" type="submit">Add</button>
        </form>

        <div class="section-t">Updates on this project</div>
        ${canEdit() && S.me ? `
          <form data-submit="quick-update" data-id="${esc(p.id)}" style="display:grid;gap:8px;margin-bottom:14px">
            <textarea name="text" rows="2" placeholder="What moved on this today?" required></textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn sm primary" type="submit">Post as ${esc(S.me)}</button>
            </div>
          </form>`
          : canEdit() ? `<div class="muted" style="font-size:12.5px">Set your name to post.</div>` : ""}

        ${ups.length ? `<div class="feed" style="margin:0 -20px">
          ${ups.slice(0, 20).map((u) => `
            <article class="post">
              ${avatar(u.author)}
              <div class="post-b">
                <div class="post-h"><span class="nm">${esc(u.author)}</span>
                  <span class="meta">${esc(ago(u.date))}${u.seeded ? " · from the sheet" : ""}</span></div>
                <div class="post-txt">${esc(u.text)}</div>
                ${u.blockers ? `<div class="post-blocker"><span>▲</span><span>${esc(u.blockers)}</span></div>` : ""}
              </div>
            </article>`).join("")}
        </div>` : `<div class="muted" style="font-size:12.5px">Nothing logged yet.</div>`}

        <div class="section-t">Reference</div>
        <dl class="kv">
          <dt>Sheet row</dt><dd class="num">${p.sourceRow || "—"}</dd>
          <dt>WhatsApp</dt><dd>${esc(p.waGroupLink || "—")}</dd>
          <dt>Revenue basis</dt><dd>${esc(money(rev))} — this client's booking split across its ${
            projects().filter((x) => x.clientKey === p.clientKey).length} project row(s)</dd>
          ${p.editedBy ? `<dt>Last edited</dt><dd>${esc(p.editedBy)} · ${esc(ago(String(p.editedAt).slice(0, 10)))}</dd>` : ""}
        </dl>
      </div>

      <footer class="drawer-f">
        ${canEdit()
          ? `<button class="btn primary" data-act="submit-project" data-id="${esc(p.id)}">Save changes</button>
             <button class="btn ghost" data-act="close-drawer">Cancel</button>
             <span style="margin-left:auto;align-self:center;font-size:11.5px;color:var(--ink-3)">
               ${S.me ? `Saving as ${esc(S.me)}` : "Set your name first"}</span>`
          : `<button class="btn ghost" data-act="close-drawer">Close</button>
             <span style="margin-left:auto;align-self:center;font-size:11.5px;color:var(--ink-3)">
               Read-only session</span>`}
      </footer>
    </aside>`;
}

/* ------------------------------------------------------------ person view
   Everything one DM or editor lead is carrying, heaviest first. */

export function renderPersonDrawer(name, role) {
  const rows = loadRollup(role);
  const r = rows.find((x) => x.name === name);
  if (!r) return "";

  const set = S.data.settings;
  const cap = role === "dms" ? set.capacityPerDM : set.capacityPerEditor;
  const t = loadTotals();
  const avg = role === "dms" ? t.dmAvg : t.edAvg;
  const roleLabel = role === "dms" ? "DM" : "Editor lead";
  const hats = rolesOf(name);

  return `
    <div class="scrim" data-act="close-drawer"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(name)}">
      <header class="drawer-h">
        ${avatar(name, "lg")}
        <div style="flex:1;min-width:0">
          <h2>${esc(name)}</h2>
          <div class="muted" style="font-size:12.5px">${esc(hats.join(" · ") || roleLabel)}</div>
        </div>
        <button class="btn sm ghost" data-act="close-drawer" aria-label="Close">✕</button>
      </header>

      <div class="drawer-b">
        <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
          <div class="stat"><div class="k">Load as ${esc(roleLabel)}</div>
            <div class="v num">${esc(num(r.points, 1))}<small>pts</small></div>
            <div class="n">team average ${esc(num(avg, 1))}</div></div>
          <div class="stat"><div class="k">Live projects</div>
            <div class="v num">${r.live}<small>/ ${cap}</small></div>
            <div class="n">${r.held} on hold · ${r.upcoming} upcoming</div></div>
          <div class="stat"><div class="k">Revenue touched</div>
            <div class="v num">₹${esc((r.rev / 1e7).toFixed(2))}<small>Cr</small></div>
            <div class="n">${r.clientCount} clients</div></div>
        </div>

        <div class="section-t">The slate, heaviest first</div>
        <div class="scroller">
          <table class="rows">
            <thead><tr><th>Project</th><th class="r">Their share</th><th class="r">Activity</th><th>Status</th></tr></thead>
            <tbody>
              ${r.items.map((it) => `
                <tr class="clickable" data-act="open-project" data-id="${esc(it.p.id)}">
                  <td>
                    <div class="cell-name">${esc(it.p.client)}</div>
                    ${it.p.projectName ? `<div class="cell-sub">${esc(it.p.projectName)}</div>` : ""}
                    ${it.shared > 1 ? `<div class="cell-sub">shared with ${it.shared - 1} other</div>` : ""}
                  </td>
                  <td class="r num"><b>${esc(num(it.share, 1))}</b>
                    <div class="cell-sub">${esc(it.effort.source === "set" ? "weighted" : "assumed")}</div></td>
                  <td class="r num">${it.activity}
                    <div class="cell-sub">${esc(lastUpdate(it.p) ? ago(lastUpdate(it.p).date) : "never")}</div></td>
                  <td><span class="status ${statusKind(it.p.status)}"><span class="ic">●</span>${esc(it.p.status)}</span></td>
                </tr>`).join("")}
            </tbody>
            <tfoot><tr>
              <td>${r.items.length} projects</td>
              <td class="r num">${esc(num(r.points, 1))}</td>
              <td class="r num">${esc(num(r.activity, 0))}</td><td></td>
            </tr></tfoot>
          </table>
        </div>
      </div>

      <footer class="drawer-f">
        <button class="btn" data-act="filter-person" data-person="${esc(name)}">See in Projects</button>
        <button class="btn ghost" data-act="close-drawer">Close</button>
      </footer>
    </aside>`;
}

/** Read the drawer form back into a patch object. */
export function readDrawerForm(root) {
  const get = (name) => root.querySelector(`[data-field="${name}"]`);
  const val = (name) => { const el = get(name); return el ? el.value.trim() : undefined; };
  const list = (name) => {
    const v = val(name);
    return v === undefined ? undefined : v.split(",").map((s) => s.trim()).filter(Boolean);
  };
  const openEnded = !!get("openEnded")?.checked;
  const progressEl = get("progress");
  const effortRaw = val("effort");

  // Only send progress if someone actually moved it; otherwise keep whatever
  // the row already had, including "never set".
  let progress = null;
  if (progressEl) {
    if (progressEl.dataset.touched === "1") progress = Number(progressEl.value);
    else if (progressEl.dataset.initial !== "") progress = Number(progressEl.dataset.initial);
  }

  return {
    // "" means fall back to the service-line guess, so null it rather than 0.
    effort: effortRaw ? Number(effortRaw) : null,
    progress,
    start: val("start") || null,
    end: openEnded ? null : (val("end") || null),
    openEnded,
    dms: list("dms"),
    editorLeads: list("editorLeads"),
    podOwner: val("podOwner"),
    sdm: val("sdm"),
    status: val("status"),
    priority: val("priority"),
    categories: list("categories"),
    scope: val("scope"),
    completedFromScope: val("completedFromScope"),
  };
}
