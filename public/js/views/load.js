/* Delivery load — the landing page, written for the CEO.

   The order is deliberate: one plain-English verdict, five numbers, the levers,
   then where the time actually goes. Every metric is defined on the page itself,
   in the two percentages anyone can compare without learning a unit. */

import {
  S, esc, money, num, pct, avatar, ago, seriesVar, canEdit,
} from "../core.js";
import {
  loadRollup, loadTotals, bandwidthRanking, bandwidthByClient, balanceOf,
  totals, loadByGroup, settings,
} from "../compute.js";
import { hbar, utilMeter } from "../charts.js";

const sc = () => (S.loadScenario ||= { dmDelta: 0, edDelta: 0, unfreeze: 0 });

/* ----------------------------------------------------------- the maths */

function model() {
  const t = loadTotals();
  const set = settings();
  const s = sc();

  const liveAfter = t.liveProjects + Math.round(t.heldProjects * s.unfreeze);
  const dmsAfter = Math.max(1, t.dmCount + s.dmDelta);
  const edsAfter = Math.max(1, t.edCount + s.edDelta);

  const pointsAfter = t.totalPoints + t.heldUpside * s.unfreeze;
  const scale = t.totalPoints > 0 ? pointsAfter / t.totalPoints : 1;

  const capDM = set.capacityPerDM || 8;
  const capEd = set.capacityPerEditor || 10;

  return {
    t, set, capDM, capEd,
    now: {
      dmPer: t.liveProjects / Math.max(1, t.dmCount),
      edPer: t.liveProjects / Math.max(1, t.edCount),
      dmPts: t.dmPoints / Math.max(1, t.dmCount),
      edPts: t.edPoints / Math.max(1, t.edCount),
      dms: t.dmCount, eds: t.edCount, live: t.liveProjects,
    },
    after: {
      dmPer: liveAfter / dmsAfter,
      edPer: liveAfter / edsAfter,
      dmPts: (t.dmPoints * scale) / dmsAfter,
      edPts: (t.edPoints * scale) / edsAfter,
      dms: dmsAfter, eds: edsAfter, live: liveAfter,
    },
    need: {
      dms: Math.ceil(liveAfter / capDM),
      eds: Math.ceil(liveAfter / capEd),
    },
    touched: !!(s.dmDelta || s.edDelta || s.unfreeze),
  };
}

const overBadge = (per, cap) => {
  const r = per / cap;
  if (r > 1) return `<span class="status risk"><span class="ic">▲</span>${num(r, 1)}× over</span>`;
  if (r > 0.85) return `<span class="status watch"><span class="ic">●</span>at the limit</span>`;
  return `<span class="status active"><span class="ic">✓</span>has room</span>`;
};

/* --------------------------------------------------------------- pieces */

function verdict() {
  const m = model();
  const dmR = m.now.dmPer / m.capDM;
  const edR = m.now.edPer / m.capEd;
  const worst = edR >= dmR
    ? { who: "Editor leads", n: m.now.eds, per: m.now.edPer, cap: m.capEd, r: edR, need: m.need.eds }
    : { who: "DMs", n: m.now.dms, per: m.now.dmPer, cap: m.capDM, r: dmR, need: m.need.dms };

  const ok = worst.r <= 1;
  return `
    <section class="verdict ${ok ? "ok" : "hot"}">
      <span class="v-ic">${ok ? "✓" : "▲"}</span>
      <div>
        <b>${ok
          ? "Delivery has room."
          : `${esc(worst.who)} are the constraint.`}</b>
        ${ok
          ? `Every role is inside its ceiling. The heaviest is ${esc(worst.who.toLowerCase())} at
             ${esc(num(worst.per, 1))} live projects each against a ceiling of ${worst.cap}.`
          : `${worst.n} ${esc(worst.who.toLowerCase())} are carrying ${esc(num(worst.per, 1))} live projects each
             against a ceiling of ${worst.cap}. Clearing that needs ${worst.need} — ${worst.need - worst.n} more than today.`}
      </div>
    </section>`;
}

function kpis() {
  const m = model();
  const t = m.t;
  const byType = loadByGroup((p) => p.categories);
  const topType = byType[0];
  const people = [...loadRollup("dms"), ...loadRollup("editorLeads")]
    .sort((a, b) => b.points - a.points);
  const busiest = people[0];

  return `
    <div class="stats">
      <div class="stat hero">
        <div class="k">Live projects</div>
        <div class="v num">${t.liveProjects}</div>
        <div class="n">${t.heldProjects} parked on hold</div>
      </div>
      <div class="stat">
        <div class="k">Projects per DM</div>
        <div class="v num">${esc(num(m.now.dmPer, 1))}<small>/ ${m.capDM}</small></div>
        <div class="n">${overBadge(m.now.dmPer, m.capDM)}</div>
      </div>
      <div class="stat ${m.now.edPer > m.capEd ? "accent" : ""}">
        <div class="k">Projects per editor lead</div>
        <div class="v num">${esc(num(m.now.edPer, 1))}<small>/ ${m.capEd}</small></div>
        <div class="n">${overBadge(m.now.edPer, m.capEd)}</div>
      </div>
      <div class="stat">
        <div class="k">Most of the team’s time goes to</div>
        <div class="v" style="font-size:20px;letter-spacing:-.02em">${esc(topType?.name || "—")}</div>
        <div class="n">${esc(num(pct(topType?.points || 0, t.totalPoints), 0))}% of all team time</div>
      </div>
      <div class="stat">
        <div class="k">Busiest person</div>
        <div class="v" style="font-size:20px;letter-spacing:-.02em">${esc(busiest?.name || "—")}</div>
        <div class="n">${busiest ? `${busiest.live} live · ${busiest.clientCount} clients` : ""}</div>
      </div>
    </div>`;
}

function levers() {
  const m = model();
  const s = sc();

  const slider = (key, label, min, max, value, readout) => `
    <div class="lever">
      <div class="lever-h">
        <span>${esc(label)}</span>
        <b class="num">${esc(readout)}</b>
      </div>
      <input type="range" min="${min}" max="${max}" step="${key === "unfreeze" ? 0.1 : 1}"
             value="${value}" data-input="load-lever" data-key="${key}" aria-label="${esc(label)}">
    </div>`;

  const cell = (label, now, after, cap) => {
    const moved = Math.abs(after - now) > 0.05;
    return `
      <div>
        <div class="ch">${esc(label)}</div>
        <div class="cv num">${esc(num(after, 1))}<span class="muted" style="font-size:13px">/ ${cap}</span></div>
        <div class="cd">${moved
          ? `<span class="delta ${after < now ? "up" : "down"}">${after < now ? "▼" : "▲"} from ${num(now, 1)}</span>`
          : overBadge(after, cap)}</div>
      </div>`;
  };

  return `
    <section class="card">
      <div class="card-h">
        <h2>What if we…</h2>
        <span class="spacer"></span>
        ${m.touched ? `<button class="btn sm ghost" data-act="reset-load">Reset</button>` : ""}
        <div class="hint">Nothing here changes the board. Drag and watch the numbers move.</div>
      </div>
      <div class="card-b">
        <div class="levers">
          ${slider("dmDelta", "Delivery managers", -6, 12, s.dmDelta,
            `${m.now.dms} → ${m.after.dms}`)}
          ${slider("edDelta", "Editor leads", -2, 20, s.edDelta,
            `${m.now.eds} → ${m.after.eds}`)}
          ${slider("unfreeze", "Restart on-hold work", 0, 1, s.unfreeze,
            `${Math.round(s.unfreeze * 100)}% of ${m.t.heldProjects}`)}
        </div>

        <div class="compare" style="margin-top:16px">
          ${cell("Projects per DM", m.now.dmPer, m.after.dmPer, m.capDM)}
          ${cell("Projects per editor lead", m.now.edPer, m.after.edPer, m.capEd)}
          <div>
            <div class="ch">Live projects</div>
            <div class="cv num">${m.after.live}</div>
            <div class="cd muted">${m.after.live === m.now.live ? "unchanged" : `from ${m.now.live}`}</div>
          </div>
        </div>

        <div class="callout ${m.after.edPer > m.capEd || m.after.dmPer > m.capDM ? "warn" : ""}" style="margin-top:14px">
          <span>${m.after.edPer > m.capEd || m.after.dmPer > m.capDM ? "▲" : "✓"}</span>
          <span>${m.after.edPer > m.capEd
            ? `Still short: ${m.after.live} live projects needs ${m.need.eds} editor leads, not ${m.after.eds}.`
            : m.after.dmPer > m.capDM
              ? `DMs tip over: ${m.after.live} live projects needs ${m.need.dms} DMs, not ${m.after.dms}.`
              : `Everyone lands inside their ceiling — ${m.need.eds} editor leads and ${m.need.dms} DMs covers it.`}</span>
        </div>
      </div>
    </section>`;
}

function whereItGoes() {
  const t = loadTotals();
  const byPod = loadByGroup((p) => p.podOwner || "(no pod)");
  const byType = loadByGroup((p) => p.categories);

  const share = (rows) => rows.map((r) => ({
    label: r.name, value: r.points, r,
  }));

  const opts = (aria) => ({
    aria, labelWidth: 132, height: 20, gap: 7,
    fmt: (v) => num(pct(v, t.totalPoints), 0) + "%",
    colour: (row, i) => seriesVar(i + 1),
    tipRows: (row) => [
      ["Share of effort", num(pct(row.value, t.totalPoints), 1) + "%"],
      ["Projects", num(row.r.projects, 0)],
      ["Revenue", money(row.r.rev)],
      ["Updates in 60d", num(row.r.activity, 0)],
    ],
  });

  return `
    <div class="grid g2">
      <section class="card">
        <div class="card-h"><h2>Where the load sits</h2>
          <div class="hint">Share of the delivery team’s total time, by pod. Adds up to 100%.</div></div>
        <div class="card-b">${hbar(share(byPod), opts("Delivery effort by pod"))}</div>
      </section>
      <section class="card">
        <div class="card-h"><h2>What kind of work it is</h2>
          <div class="hint">Share of the delivery team’s total time, by type of work. Adds up to 100%.</div></div>
        <div class="card-b">${hbar(share(byType), opts("Delivery effort by service line"))}</div>
      </section>
    </div>`;
}

/* The CEO's ranked table. Two percentages of the same 100% — how much of the
   team a client uses, and how much of the book it is — so "is this worth it"
   is a comparison of two numbers on the same scale, not a unit conversion. */
function bandwidthTable() {
  const byProject = S.loadBy === "project";
  const clients = bandwidthByClient();
  const projRows = bandwidthRanking();
  const rows = byProject ? projRows : clients;
  const max = rows.length ? rows[0].points : 1;
  const shown = rows.slice(0, S.loadAll ? rows.length : 15);
  const t = loadTotals();
  const bookRev = totals().rev || 1;

  const people = (names, count) => `
    <span class="peoplecell">
      <b class="num">${count}</b>
      <span class="facepile">${names.slice(0, 4).map((n) => avatar(n, "sm")).join("")}${
        names.length > 4 ? `<span class="chip" style="padding:1px 6px">+${names.length - 4}</span>` : ""}</span>
    </span>`;

  const shareCell = (share, points) => `
    <td style="min-width:130px">
      <div class="sharecell">
        <div class="bar" style="--pct:${pct(points, max)}%"><i></i></div>
        <b class="num">${esc(num(share, 1))}%</b>
      </div>
    </td>`;

  const balanceCell = (c) => {
    const b = balanceOf(c);
    return `<td><span class="status ${b.tone}"><span class="ic">${b.ic}</span>${esc(b.label)}</span></td>`;
  };

  const revCell = (rev, share) => rev > 0
    ? `<td class="r num">${esc(money(rev))}<div class="cell-sub">${esc(num(share, 1))}% of the book</div></td>`
    : `<td class="r"><span class="sheetnote" data-tip="This client has no revenue mapped in the sheet, so
         there is nothing to weigh the team time against. It is a gap in the data, not free work."
         >✎ not mapped</span></td>`;

  const clientRow = (c) => `
    <tr class="clickable" data-act="filter-client" data-client="${esc(c.name)}">
      <td>
        <div class="cell-name">${esc(c.name)}</div>
        <div class="cell-sub">${c.projects} project${c.projects === 1 ? "" : "s"}
          · ${c.live} live${c.held ? ` · ${c.held} on hold` : ""}</div>
      </td>
      ${revCell(c.rev, c.revShare)}
      <td>${people([...c.dms], c.dmCount)}</td>
      <td>${people([...c.eds], c.edCount)}</td>
      ${shareCell(c.teamShare, c.points)}
      ${balanceCell(c)}
    </tr>`;

  const projectRow = (x) => {
    const teamShare = pct(x.points, t.totalPoints);
    const revShare = pct(x.rev, bookRev);
    const asClient = { unmapped: x.rev <= 0, rev: x.rev, teamShare, revShare };
    return `
    <tr class="clickable" data-act="open-project" data-id="${esc(x.p.id)}">
      <td>
        <div class="cell-name">${esc(x.p.client)}</div>
        <div class="cell-sub">${esc(x.p.projectName || x.p.status)}</div>
      </td>
      ${revCell(x.rev, revShare)}
      <td>${people(x.p.dms || [], x.dms)}</td>
      <td>${people(x.p.editorLeads || [], x.eds)}</td>
      ${shareCell(teamShare, x.points)}
      ${balanceCell(asClient)}
    </tr>`;
  };

  const th = (label, tip, cls = "") =>
    `<th class="${cls}"><span data-tip="${esc(tip)}" class="th-help">${esc(label)}</span></th>`;

  return `
    <section class="card">
      <div class="card-h">
        <h2>Who is taking the most team time</h2>
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="Group by">
          <button data-act="load-by" data-by="client" aria-pressed="${!byProject}">By client</button>
          <button data-act="load-by" data-by="project" aria-pressed="${byProject}">By project</button>
        </div>
      </div>

      <div class="card-b" style="padding-bottom:6px">
        <div class="defs">
          <div><b>Share of team</b> How much of the delivery team's total time this
            ${byProject ? "project" : "client"} uses. Every row adds up to 100%.</div>
          <div><b>Share of the book</b> How much of the ₹${esc(num(bookRev / 1e7, 2))} Cr revenue it brings in.
            Also adds up to 100%.</div>
          <div><b>Balance</b> The two should roughly match. Using 6% of the team for 1% of the
            revenue is expensive work.</div>
        </div>
      </div>

      <div class="scroller">
        <table class="rows">
          <thead><tr>
            ${th(byProject ? "Project" : "Client", "Heaviest first — the ones using the most team time.")}
            ${th("Revenue", "What this brings in, and what share of the whole book that is.", "r")}
            ${th("DMs", "How many delivery managers are named on it.")}
            ${th("Editors", "How many editor leads are named on it.")}
            ${th("Share of team", "Its slice of the delivery team's total time. All rows sum to 100%.")}
            ${th("Balance", "Whether the revenue share keeps up with the team share.")}
          </tr></thead>
          <tbody>${shown.map(byProject ? projectRow : clientRow).join("")}</tbody>
        </table>
      </div>
      ${rows.length > 15 ? `
        <div class="card-b" style="text-align:center;border-top:1px solid var(--line)">
          <button class="btn sm" data-act="load-all">
            ${S.loadAll ? `Show top 15` : `Show all ${rows.length}`}
          </button>
        </div>` : ""}
    </section>`;
}

function peopleStrip(field, title, cap) {
  const rows = loadRollup(field);
  if (!rows.length) return "";
  const worst = rows.filter((r) => r.live > cap).length;

  return `
    <section class="card">
      <div class="card-h">
        <h2>${esc(title)}</h2>
        <span class="spacer"></span>
        ${worst ? `<span class="status risk"><span class="ic">▲</span>${worst} over ${cap}</span>`
                : `<span class="chip ring">${rows.length} people</span>`}
        <div class="hint">Live projects each, against the ceiling. Click anyone for their full slate.</div>
      </div>
      <div class="card-b" style="display:grid;gap:2px">
        ${rows.map((r) => `
          <button class="loadrow" data-act="open-person" data-name="${esc(r.name)}" data-role="${field}">
            ${avatar(r.name, "sm")}
            <span class="lr-name">${esc(r.name)}</span>
            <span class="lr-meter">${utilMeter(r.live, cap, { name: r.name })}</span>
            <span class="lr-top">${r.top ? esc(r.top.p.projectName || r.top.p.client) : ""}</span>
          </button>`).join("")}
      </div>
    </section>`;
}

export function renderLoad() {
  const set = settings();
  const t = loadTotals();

  return `
    <div class="head">
      <div>
        <h1>Delivery load</h1>
        <div class="lede">Where the delivery team's time is going, and what happens if you change
          the shape of it.</div>
      </div>
      <div class="head-actions">
        <button class="btn" data-act="export">Export to Excel</button>
      </div>
    </div>

    ${verdict()}
    ${kpis()}

    <div class="grid" style="margin-top:14px">
      ${levers()}
    </div>

    <div style="margin-top:14px">${whereItGoes()}</div>

    <div style="margin-top:14px">${bandwidthTable()}</div>

    <div class="grid g2" style="margin-top:14px">
      ${peopleStrip("dms", "Delivery by DM", set.capacityPerDM)}
      ${peopleStrip("editorLeads", "Delivery by editor lead", set.capacityPerEditor)}
    </div>


    <div class="loadnote">
      <b>How team time is measured.</b> There are no timesheets, so each project is scored for how
      much work it is: Content @ Scale counts as 5, Personalisation 4, Cinematic 3, Avatar Creative 2,
      Avatar Simple 1, plus one more where the scope names a bulk volume. Work on hold counts as a
      quarter. That score is split between everyone named on the project, then every share is
      expressed as a percentage of the team. ${t.assumed} of ${t.assumed + t.set} projects are still
      on the default score${canEdit() ? " — open a project and set Delivery effort to correct it" : ""}.
    </div>`;
}
