/* Standup — the shared wall.

   Anyone on the board posts here against one of their projects. A post can also
   move that project's dates in the same submit, which is the only way the
   timeline ever gets accurate: the person who knows the date is the person
   writing the update. */

import {
  S, esc, avatar, fmtDate, fmtDateFull, ago, TODAY, relDays, money, num, canEdit,
} from "../core.js";
import {
  projects, myProjects, rolesOf, roster, statusKind, lastUpdate, staleDays,
  settings, shareOf, allOf, podRollup,
} from "../compute.js";

const adminName = () => S.data?.settings?.adminName || "your admin";

const STATUS_WORDS = ["On track", "At risk", "Blocked", "Delivered", "Waiting on client", "Waiting on edit"];

function statusPill(word) {
  const w = String(word || "").toLowerCase();
  const cls = w.includes("block") || w.includes("risk") ? "risk"
    : w.includes("deliver") ? "active"
    : w.includes("wait") ? "hold" : "upcoming";
  const ic = cls === "risk" ? "▲" : cls === "active" ? "✓" : cls === "hold" ? "◷" : "●";
  return `<span class="status ${cls}"><span class="ic">${ic}</span>${esc(word)}</span>`;
}

function composer() {
  if (!canEdit()) {
    return `<div class="callout">
      <span>👁</span>
      <div><b>You are signed in read-only.</b> You can read every update and open every
      project — posting is turned off. Ask ${adminName()} for the editing password if you need it.</div>
    </div>`;
  }
  if (!S.me) {
    return `<div class="callout">
      <span>◷</span>
      <div><b>Tell the board who you are</b> and the composer opens up.
      Use the button at the top right — it only sets a name on this browser, there is no password.</div>
    </div>`;
  }
  const mine = myProjects(S.me);
  const others = projects().filter((p) => !mine.includes(p));
  const roles = rolesOf(S.me);

  const optionsFor = (list) => list
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("");

  return `
    <form class="composer" data-submit="post-update">
      <div class="row">
        <div class="field" style="flex:2 1 260px">
          <label for="up-proj">Project</label>
          <select id="up-proj" name="projectId" required data-change="composer-project">
            <option value="">Pick a project…</option>
            ${mine.length ? `<optgroup label="Yours (${mine.length})">${optionsFor(mine)}</optgroup>` : ""}
            <optgroup label="Everything else">${optionsFor(others)}</optgroup>
          </select>
        </div>
        <div class="field fit" style="min-width:150px">
          <label for="up-status">Where it stands</label>
          <select id="up-status" name="status">
            <option value="">—</option>
            ${STATUS_WORDS.map((w) => `<option>${esc(w)}</option>`).join("")}
          </select>
        </div>
        <div class="field fit" style="min-width:140px">
          <label for="up-date">Date</label>
          <input id="up-date" type="date" name="date" value="${TODAY}" max="${TODAY}">
        </div>
      </div>

      <div class="field">
        <label for="up-text">What moved${roles.length ? ` — posting as ${esc(roles.join(" / "))}` : ""}</label>
        <textarea id="up-text" name="text" required
          placeholder="2 base videos delivered, 3 in edit. Client review call moved to Thursday."></textarea>
      </div>

      <div class="row">
        <div class="field" style="flex:2 1 240px">
          <label for="up-block">Blocked on anything? <span class="muted">(optional — this is what surfaces on the CEO view)</span></label>
          <input id="up-block" type="text" name="blockers" placeholder="Waiting on brand approval since Monday">
        </div>
        <div class="field fit" style="min-width:150px">
          <label for="up-eta">Next delivery</label>
          <input id="up-eta" type="date" name="eta">
        </div>
      </div>

      <div id="timeline-inline" class="hide">
        <div class="callout" style="align-items:center">
          <span>◱</span>
          <div style="flex:1">
            <b>This project has no dates on the timeline.</b>
            <div class="row" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              <div class="field" style="flex:1 1 130px"><label for="up-start">Start</label>
                <input id="up-start" type="date" name="start"></div>
              <div class="field" style="flex:1 1 130px"><label for="up-end">End</label>
                <input id="up-end" type="date" name="end"></div>
              <div class="field fit" style="align-self:flex-end">
                <label style="display:flex;align-items:center;gap:6px;color:var(--ink-2);font-size:12px">
                  <input type="checkbox" name="openEnded"> Open-ended
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="row" style="justify-content:flex-end">
        <div class="fit" style="margin-right:auto;font-size:11.5px;color:var(--ink-3)">
          Posting as ${avatar(S.me, "sm")} <b style="font-weight:500">${esc(S.me)}</b>
        </div>
        <button class="btn primary fit" type="submit">Post update</button>
      </div>
    </form>`;
}

function nudgePanel() {
  const limit = settings().staleUpdateDays || 7;
  const owed = {};
  projects()
    .filter((p) => statusKind(p.status) === "active")
    .forEach((p) => {
      const d = staleDays(p);
      if (d !== null && d <= limit) return;
      const owners = [...new Set([...(p.dms || []), ...(p.editorLeads || [])])];
      (owners.length ? owners : ["(nobody assigned)"]).forEach((o) => {
        (owed[o] ||= []).push({ p, days: d });
      });
    });

  const people = Object.entries(owed)
    .map(([name, items]) => ({ name, items, rev: items.reduce((s, i) => s + shareOf(i.p), 0) }))
    .sort((a, b) => b.items.length - a.items.length);

  if (!people.length) {
    return `<section class="card"><div class="card-h"><h2>Everyone is current</h2></div>
      <div class="empty"><div class="big">✓ No updates owed</div>Every active project has been touched in the last ${limit} days.</div></section>`;
  }

  return `
    <section class="card">
      <div class="card-h">
        <h2>Updates owed</h2>
        <span class="spacer"></span>
        <span class="chip on">${people.reduce((s, p) => s + p.items.length, 0)} projects</span>
        <div class="hint">Active projects with nothing logged in ${limit} days, by the person on the hook.</div>
      </div>
      <div class="scroller" style="max-height:420px">
        <table class="rows">
          <thead><tr><th>Person</th><th class="r">Owed</th><th>Oldest</th></tr></thead>
          <tbody>
            ${people.map((p) => {
              const oldest = p.items.slice().sort((a, b) => (b.days ?? 999) - (a.days ?? 999))[0];
              return `<tr class="clickable" data-act="filter-person" data-person="${esc(p.name)}">
                <td><div class="cell-name">${avatar(p.name, "sm")} ${esc(p.name)}</div>
                    <div class="cell-sub">${esc(money(p.rev))} riding on them</div></td>
                <td class="r num"><b>${p.items.length}</b></td>
                <td><span class="status ${(oldest.days ?? 999) > limit * 2 ? "risk" : "watch"}">
                  <span class="ic">${(oldest.days ?? 999) > limit * 2 ? "▲" : "●"}</span>
                  ${oldest.days === null ? "never updated" : `${oldest.days}d`}</span>
                  <div class="cell-sub">${esc(oldest.p.projectName || oldest.p.client)}</div></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
}

function feed() {
  const f = S.filters;
  const byId = Object.fromEntries(projects().map((p) => [p.id, p]));
  let list = S.data.updates.slice();

  if (f.person) list = list.filter((u) => u.author === f.person);
  if (f.pod) list = list.filter((u) => byId[u.projectId]?.podOwner === f.pod);
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter((u) =>
      (u.text + " " + u.author + " " + (byId[u.projectId]?.label || "")).toLowerCase().includes(q));
  }

  const planned = list.filter((u) => u.date > TODAY).sort((a, b) => (a.date < b.date ? -1 : 1));
  const logged = list.filter((u) => u.date <= TODAY);

  const days = {};
  logged.forEach((u) => { (days[u.date || "undated"] ||= []).push(u); });
  const ordered = Object.entries(days).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14);

  const post = (u) => {
    const p = byId[u.projectId];
    return `
      <article class="post">
        ${avatar(u.author)}
        <div class="post-b">
          <div class="post-h">
            <span class="nm">${esc(u.author)}</span>
            ${u.status ? statusPill(u.status) : ""}
            <span class="meta">${esc(ago(u.date))}${u.seeded ? " · from the sheet" : ""}</span>
            ${u.author === S.me || u.seeded
              ? `<button class="btn sm ghost kill" style="margin-left:auto" data-act="del-update" data-id="${esc(u.id)}"
                   aria-label="Delete this update">Delete</button>` : ""}
          </div>
          ${p ? `<div class="meta" style="font-size:11.5px;color:var(--ink-3)">
            <a href="#" data-act="open-project" data-id="${esc(p.id)}">${esc(p.label)}</a>
            ${p.podOwner ? ` · ${esc(p.podOwner)} pod` : ""}</div>` : ""}
          <div class="post-txt">${esc(u.text)}</div>
          ${u.blockers ? `<div class="post-blocker"><span>▲</span><span>${esc(u.blockers)}</span></div>` : ""}
          ${u.eta ? `<div class="post-tags"><span class="chip ring">Next delivery ${esc(fmtDateFull(u.eta))}</span></div>` : ""}
        </div>
      </article>`;
  };

  return `
    ${planned.length ? `
      <section class="card" style="margin-bottom:14px">
        <div class="card-h"><h2>Planned ahead</h2>
          <span class="spacer"></span><span class="chip ring">${planned.length}</span>
          <div class="hint">Rows dated after today — what people have said they will do next.</div>
        </div>
        <div class="feed">${planned.slice(0, 8).map(post).join("")}</div>
      </section>` : ""}

    ${ordered.length ? ordered.map(([date, items]) => `
      <section class="card" style="margin-bottom:14px">
        <div class="card-h">
          <h2>${esc(date === TODAY ? "Today" : fmtDateFull(date))}</h2>
          <span class="spacer"></span>
          <span class="chip ring">${items.length} update${items.length === 1 ? "" : "s"}</span>
        </div>
        <div class="feed">${items.map(post).join("")}</div>
      </section>`).join("")
      : `<section class="card"><div class="empty"><div class="big">No updates match that.</div>
         Clear the filters, or post the first one.</div></section>`}`;
}

export function renderStandup() {
  const f = S.filters;
  return `
    <div class="head">
      <div>
        <h1>Standup</h1>
        <div class="lede">Everyone's status updates in one place. Post against a project, flag what you are
          blocked on, and fix the dates while you are there.</div>
      </div>
      <div class="head-actions">
        <select data-change="filter" data-key="person" aria-label="Filter by person" style="width:auto">
          <option value="">Everyone</option>
          ${roster().map((p) => `<option value="${esc(p)}" ${f.person === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
        </select>
        <select data-change="filter" data-key="pod" aria-label="Filter by pod" style="width:auto">
          <option value="">All pods</option>
          ${allOf("podOwner").map((p) => `<option value="${esc(p)}" ${f.pod === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
        </select>
        ${f.person || f.pod || f.q ? `<button class="btn sm ghost" data-act="clear-filters">Clear</button>` : ""}
      </div>
    </div>

    <div class="split">
      <div>
        <section class="card" style="margin-bottom:14px">
          <div class="card-h"><h2>Post an update</h2>
            <div class="hint">It lands on the wall for everyone and counts as that project's latest status.</div>
          </div>
          <div class="card-b">${composer()}</div>
        </section>
        ${feed()}
      </div>
      <div>${nudgePanel()}</div>
    </div>`;
}
