/* My work — the same board, narrowed to one person, with the things they owe
   the rest of the team put at the top. */

import { S, esc, money, num, avatar, fmtDate, fmtDateFull, ago, TODAY } from "../core.js";
import {
  myProjects, rolesOf, shareOf, statusKind, risksOf, lastUpdate, staleDays,
  settings, updatesByProject,
} from "../compute.js";
import { utilMeter } from "../charts.js";

function projectCard(p) {
  const risks = risksOf(p);
  const u = lastUpdate(p);
  const d = staleDays(p);
  const limit = settings().staleUpdateDays || 7;
  const needs = d === null || d > limit;

  return `
    <tr class="clickable" data-act="open-project" data-id="${esc(p.id)}">
      <td>
        <div class="cell-name">${esc(p.client)}</div>
        ${p.projectName ? `<div class="cell-sub">${esc(p.projectName)}</div>` : ""}
      </td>
      <td><span class="status ${statusKind(p.status)}"><span class="ic">●</span>${esc(p.status)}</span></td>
      <td class="num">${p.start || p.end
        ? `${esc(p.start ? fmtDate(p.start) : "—")} <span class="muted">→</span> ${esc(p.openEnded ? "open" : p.end ? fmtDate(p.end) : "—")}`
        : `<span class="sheetnote">✎ no dates</span>`}</td>
      <td>${u
        ? `<span class="${needs ? "" : "muted"}">${esc(ago(u.date))}</span>`
        : `<span class="status risk"><span class="ic">▲</span>never</span>`}</td>
      <td class="r num">${esc(money(shareOf(p)))}</td>
      <td>${risks.length ? `<span class="chip ${risks[0].sev === 2 ? "on" : "ring"}"
        data-tip="${esc(risks.map((r) => r.label).join(" · "))}">${risks.length}</span>` : `<span class="muted">—</span>`}</td>
    </tr>`;
}

function table(title, list, hint, flag) {
  if (!list.length) return "";
  return `
    <section class="card" style="margin-bottom:14px">
      <div class="card-h">
        <h2>${esc(title)}</h2>
        <span class="spacer"></span>
        <span class="chip ${flag ? "on" : "ring"}">${list.length}</span>
        ${hint ? `<div class="hint">${esc(hint)}</div>` : ""}
      </div>
      <div class="scroller">
        <table class="rows">
          <thead><tr><th>Project</th><th>Status</th><th>Timeline</th><th>Last update</th>
            <th class="r">Revenue</th><th>Flags</th></tr></thead>
          <tbody>${list.map(projectCard).join("")}</tbody>
        </table>
      </div>
    </section>`;
}

export function renderMine() {
  if (!S.me) {
    return `
      <div class="head"><div><h1>My work</h1>
        <div class="lede">Tell the board who you are and this fills in.</div></div></div>
      <section class="card"><div class="empty">
        <div class="big">Nobody selected</div>
        Use the button at the top right to pick your name. It is stored on this browser only.
        <div style="margin-top:14px"><button class="btn primary" data-act="pick-me">Choose your name</button></div>
      </div></section>`;
  }

  const mine = myProjects(S.me);
  const roles = rolesOf(S.me);
  const set = settings();
  const limit = set.staleUpdateDays || 7;

  const owed = mine.filter((p) => statusKind(p.status) === "active" &&
    (staleDays(p) === null || staleDays(p) > limit));
  const undated = mine.filter((p) => !p.start && !p.end && !p.openEnded && !owed.includes(p));
  const rest = mine.filter((p) => !owed.includes(p) && !undated.includes(p));

  const rev = mine.reduce((s, p) => s + shareOf(p), 0);
  const active = mine.filter((p) => statusKind(p.status) === "active");
  const mineUpdates = S.data.updates.filter((u) => u.author === S.me);
  const thisWeek = mineUpdates.filter((u) => u.date <= TODAY && u.date >= new Date(Date.parse(TODAY) - 6 * 864e5).toISOString().slice(0, 10));

  return `
    <div class="head">
      <div style="display:flex;gap:14px;align-items:center">
        ${avatar(S.me, "lg")}
        <div>
          <h1>${esc(S.me)}</h1>
          <div class="lede">${roles.length ? esc(roles.join(" · ")) : "Not named on any project yet"}</div>
        </div>
      </div>
      <div class="head-actions">
        <button class="btn" data-act="goto" data-view="standup">Post an update</button>
        <button class="btn ghost" data-act="pick-me">Not you?</button>
      </div>
    </div>

    <div class="stats" style="margin-bottom:14px">
      <div class="stat hero"><div class="k">Revenue you touch</div>
        <div class="v num">₹${esc((rev / 1e7).toFixed(2))}<small>Cr</small></div>
        <div class="n">${mine.length} projects · ${active.length} live</div></div>
      <div class="stat"><div class="k">Updates owed</div>
        <div class="v num">${owed.length}</div>
        <div class="n">${owed.length ? `nothing logged in ${limit}+ days` : "you are current"}</div></div>
      <div class="stat"><div class="k">You posted</div>
        <div class="v num">${thisWeek.length}<small>this week</small></div>
        <div class="n">${mineUpdates.length} all time</div></div>
      <div class="stat"><div class="k">Load</div>
        <div class="v num">${active.length}<small>/ ${set.capacityPerDM}</small></div>
        <div class="n" style="margin-top:8px">${utilMeter(active.length, set.capacityPerDM, { name: S.me })}</div></div>
    </div>

    ${table("Owe an update", owed, `Active work with nothing logged in ${limit} days. Clear these first.`, true)}
    ${table("Missing dates", undated, "These never make it onto the timeline until someone puts a date on them.", true)}
    ${table("Everything else", rest, "")}
    ${!mine.length ? `<section class="card"><div class="empty">
      <div class="big">No projects name you</div>
      If that is wrong, open a project and add yourself as DM or editor lead.</div></section>` : ""}`;
}
