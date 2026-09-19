/* Escalations — the board as browsable cards.

   Built for whoever owns the client relationship rather than the delivery
   detail: rails you scan left to right, worst first, where every card answers
   "what is wrong, how much is riding on it, and who do I call" without opening
   anything. Clicking still drops into the full project drawer. */

import {
  S, esc, money, num, avatar, fmtDate, fmtDateFull, ago, TODAY, relDays,
  seriesVar, slotFor, initials,
} from "../core.js";
import {
  filtered, shareOf, statusKind, risksOf, lastUpdate, staleDays, openBlocker,
  escalationScore, settings, allOf, projects,
} from "../compute.js";

/* A deterministic "poster" per client, so people learn to recognise tiles by
   sight the way they would cover art. Same client, same colour, always. */
function poster(p) {
  const c = seriesVar(slotFor(p.client));
  return `linear-gradient(145deg, ${c} 0%, color-mix(in srgb, ${c} 48%, #0d0d12) 100%)`;
}

const TONE = { 2: "risk", 1: "watch", 0: "ok" };

function severityOf(p) {
  const risks = risksOf(p);
  if (openBlocker(p) || risks.some((r) => r.sev === 2)) return 2;
  if (risks.length) return 1;
  return 0;
}

/** The single line that explains why this card is in front of you. */
function reason(p) {
  const blocker = openBlocker(p);
  if (blocker) return { text: blocker.blockers, kind: "Blocked" };
  const risks = risksOf(p);
  if (risks.length) return { text: risks[0].label, kind: risks[0].sev === 2 ? "Escalate" : "Watch" };
  const d = relDays(p.end);
  if (p.end && d >= 0 && d <= 14) return { text: `Delivers ${fmtDateFull(p.end)}`, kind: "Landing" };
  return { text: "Moving as expected", kind: "On track" };
}

function card(p) {
  const sev = severityOf(p);
  const why = reason(p);
  const u = lastUpdate(p);
  const stale = staleDays(p);
  const rev = shareOf(p);
  const owners = [...(p.dms || []), ...(p.editorLeads || [])].slice(0, 3);

  return `
    <article class="ncard sev-${sev}" data-act="open-project" data-id="${esc(p.id)}"
             tabindex="0" role="button" aria-label="${esc(p.client)} — ${esc(why.text)}">
      <div class="ncard-art" style="background:${poster(p)}">
        <span class="ncard-mono" aria-hidden="true">${esc(initials(p.client))}</span>
        <span class="ncard-ribbon ${TONE[sev]}">${esc(why.kind)}</span>
        <div class="ncard-title">
          <b>${esc(p.client)}</b>
          ${p.projectName ? `<span>${esc(p.projectName)}</span>` : ""}
        </div>
      </div>
      <div class="ncard-body">
        <div class="ncard-why ${TONE[sev]}">
          <span class="ic">${sev === 2 ? "▲" : sev === 1 ? "●" : "✓"}</span>
          <span>${esc(why.text)}</span>
        </div>
        <div class="ncard-meta">
          <span class="num">${esc(money(rev))}</span>
          <span class="sep">·</span>
          <span>${esc(p.status)}</span>
          ${p.end && !p.openEnded ? `<span class="sep">·</span><span>ends ${esc(fmtDate(p.end))}</span>` : ""}
        </div>
        <div class="ncard-foot">
          <span class="ncard-people">
            ${owners.map((o) => avatar(o, "sm")).join("") || `<span class="muted">unassigned</span>`}
          </span>
          <span class="ncard-when ${stale === null || stale > 14 ? "cold" : ""}">
            ${u ? esc(ago(u.date)) : "never updated"}
          </span>
        </div>
        ${u && !u.blockers ? `<div class="ncard-last">“${esc(u.text.slice(0, 110))}${u.text.length > 110 ? "…" : ""}”</div>` : ""}
      </div>
    </article>`;
}

function rail(title, hint, list, opts = {}) {
  if (!list.length && !opts.keepEmpty) return "";
  return `
    <section class="rail">
      <div class="rail-h">
        <h2>${esc(title)}</h2>
        <span class="chip ${opts.hot ? "on" : "ring"}">${list.length}</span>
        ${hint ? `<span class="rail-hint">${esc(hint)}</span>` : ""}
      </div>
      ${list.length
        ? `<div class="rail-track">${list.map(card).join("")}</div>`
        : `<div class="rail-empty">${esc(opts.emptyText || "Nothing here right now.")}</div>`}
    </section>`;
}

/* The one project that most deserves a phone call, shown Netflix-billboard style. */
function billboard(top) {
  if (!top) return "";
  const why = reason(top);
  const u = lastUpdate(top);
  const owners = [...(top.dms || []), ...(top.editorLeads || [])];
  const risks = risksOf(top);

  return `
    <section class="billboard" style="--art:${poster(top)}">
      <div class="bb-art" aria-hidden="true"><span>${esc(initials(top.client))}</span></div>
      <div class="bb-body">
        <span class="bb-kicker">Top of the escalation list</span>
        <h2>${esc(top.client)}</h2>
        ${top.projectName ? `<div class="bb-sub">${esc(top.projectName)}</div>` : ""}
        <div class="bb-why">${esc(why.text)}</div>
        <div class="bb-facts">
          <span><b class="num">${esc(money(shareOf(top)))}</b> attributed</span>
          <span><b>${esc(top.status)}</b></span>
          <span>last update <b>${u ? esc(ago(u.date)) : "never"}</b></span>
          ${top.podOwner ? `<span><b>${esc(top.podOwner)}</b> pod</span>` : ""}
        </div>
        ${risks.length > 1 ? `<div class="bb-flags">
          ${risks.slice(0, 4).map((r) => `<span class="status ${r.sev === 2 ? "risk" : "watch"}">
            <span class="ic">${r.sev === 2 ? "▲" : "●"}</span>${esc(r.label)}</span>`).join("")}
        </div>` : ""}
        <div class="bb-actions">
          <button class="btn primary" data-act="open-project" data-id="${esc(top.id)}">Open the project</button>
          <span class="bb-who">Talk to ${owners.length
            ? owners.slice(0, 3).map((o) => `${avatar(o, "sm")} ${esc(o)}`).join(" · ")
            : "<span class='muted'>nobody is assigned</span>"}</span>
        </div>
      </div>
    </section>`;
}

export function renderEscalations() {
  const list = filtered().filter((p) => statusKind(p.status) !== "done");
  const set = settings();

  const scored = list
    .map((p) => ({ p, s: escalationScore(p), sev: severityOf(p) }))
    .sort((a, b) => b.s - a.s);

  const used = new Set();
  const take = (fn, limit = 24) => {
    const out = [];
    for (const { p } of scored) {
      if (out.length >= limit) break;
      if (used.has(p.id) || !fn(p)) continue;
      used.add(p.id);
      out.push(p);
    }
    return out;
  };

  const blocked = take((p) => !!openBlocker(p));
  const escalate = take((p) => risksOf(p).some((r) => r.sev === 2));
  const dark = take((p) => statusKind(p.status) === "active" && (staleDays(p) === null || staleDays(p) > 14));
  const landing = take((p) => p.end && !p.openEnded && relDays(p.end) >= 0 && relDays(p.end) <= 14);
  const heldRev = take((p) => statusKind(p.status) === "hold" && shareOf(p) > 0);
  const fine = take((p) => !risksOf(p).length);

  const counts = {
    escalate: scored.filter((x) => x.sev === 2).length,
    watch: scored.filter((x) => x.sev === 1).length,
    ok: scored.filter((x) => x.sev === 0).length,
  };
  const exposed = scored.filter((x) => x.sev === 2).reduce((s, x) => s + shareOf(x.p), 0);

  return `
    <div class="head">
      <div>
        <h1>Escalations</h1>
        <div class="lede">Every live project as a card, worst first. Each one says what is wrong,
          what is riding on it and who to call. Click any card for the full history.</div>
      </div>
      <div class="head-actions">
        <select data-change="filter" data-key="pod" aria-label="Pod" style="width:auto">
          <option value="">All pods</option>
          ${allOf("podOwner").map((v) => `<option value="${esc(v)}" ${S.filters.pod === v ? "selected" : ""}>${esc(v)}</option>`).join("")}
        </select>
        <input type="search" placeholder="Find a client…" value="${esc(S.filters.q)}"
               data-input="filter-q" aria-label="Search" style="width:190px">
        ${Object.values(S.filters).some(Boolean) ? `<button class="btn sm ghost" data-act="clear-filters">Clear</button>` : ""}
      </div>
    </div>

    <div class="triage">
      <button class="triage-cell hot" data-act="goto" data-view="projects" data-risk="any">
        <span class="tc-n num">${counts.escalate}</span>
        <span class="tc-k">need a call now</span>
        <span class="tc-s">${esc(money(exposed))} riding on them</span>
      </button>
      <div class="triage-cell">
        <span class="tc-n num">${counts.watch}</span>
        <span class="tc-k">worth watching</span>
        <span class="tc-s">one advisory flag each</span>
      </div>
      <div class="triage-cell">
        <span class="tc-n num">${counts.ok}</span>
        <span class="tc-k">clean</span>
        <span class="tc-s">no flags, updated recently</span>
      </div>
    </div>

    ${billboard(scored[0]?.p)}

    ${rail("Blocked on someone", "A blocker was flagged in the latest update and has not been cleared.",
      blocked, { hot: true, keepEmpty: true,
      emptyText: "Nobody has flagged a blocker yet. They show up here the moment someone fills in the “Blocked on anything?” box in Standup." })}

    ${rail("Escalate now", "Red flags: past its end date, never updated, or nobody assigned.", escalate, { hot: true })}

    ${rail("Gone quiet", "Active work with nothing logged in more than a fortnight.", dark)}

    ${rail("Landing in the next two weeks", "Delivery dates coming up — worth a check-in before they arrive.", landing)}

    ${rail("On hold, still on the books", "Parked work that is still carrying revenue.", heldRev)}

    ${rail("Running clean", "No flags, recently updated. Nothing needed from you.", fine)}`;
}
