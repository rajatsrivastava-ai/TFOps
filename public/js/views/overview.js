/* Overview — the money page, and the CEO's place to run the numbers.

   Scope is deliberately narrow: what the book is worth, where it is
   concentrated, and what happens if it changes. Anything about the delivery
   team's time lives on Delivery load; anything on fire lives on Escalations.
   Panels that duplicated those were removed rather than kept "just in case". */

import { S, esc, money, fmtCr, num, pct, avatar, seriesVar, canEdit } from "../core.js";
import {
  totals, podRollup, categoryRollup, concentration, settings,
  runScenario, defaultScenario,
} from "../compute.js";
import { hbar, stackBar, bullet } from "../charts.js";

const sc = () => (S.scenario ||= defaultScenario());

/* ---------------------------------------------------------------- top */

function statTiles() {
  const t = totals();
  const conc = concentration();
  return `
    <div class="stats">
      <div class="stat hero">
        <div class="k">Book of business</div>
        <div class="v num">₹${esc(num(t.rev / 1e7, 2))}<small>Cr</small></div>
        <div class="n">${t.clientCount} clients · ${t.n} project rows</div>
      </div>
      <div class="stat">
        <div class="k">Active revenue</div>
        <div class="v num">₹${esc((t.activeRev / 1e7).toFixed(2))}<small>Cr</small></div>
        <div class="n">${t.active} live · ${esc(pct(t.activeRev, t.rev).toFixed(0))}% of book</div>
      </div>
      <div class="stat">
        <div class="k">Parked on hold</div>
        <div class="v num">₹${esc((t.holdRev / 1e7).toFixed(2))}<small>Cr</small></div>
        <div class="n">${t.hold} projects · ${t.upcoming} upcoming</div>
      </div>
      <div class="stat ${t.seriousRev > t.rev * 0.2 ? "accent" : ""}">
        <div class="k">Revenue on serious flags</div>
        <div class="v num">₹${esc((t.seriousRev / 1e7).toFixed(2))}<small>Cr</small></div>
        <div class="n">${t.serious} projects ·
          <a href="#escalations" data-act="goto" data-view="escalations">see them</a></div>
      </div>
      <div class="stat">
        <div class="k">Top client dependency</div>
        <div class="v num">${esc((conc.top1 * 100).toFixed(0))}<small>%</small></div>
        <div class="n">${esc(conc.list[0]?.name || "—")} · top 3 = ${esc((conc.top3 * 100).toFixed(0))}%</div>
      </div>
    </div>`;
}

/* ------------------------------------------------------ run the numbers */

function levers() {
  const s = sc();
  const t = totals();
  const conc = concentration();

  const slider = (key, label, sub, min, max, step, value, fmt) => `
    <div class="scenario-row">
      <div class="lab">${esc(label)}<small>${esc(sub)}</small></div>
      <div class="out">${esc(fmt(value))}</div>
      <input class="sl" type="range" min="${min}" max="${max}" step="${step}" value="${value}"
             data-input="lever" data-key="${key}" aria-label="${esc(label)}">
    </div>`;

  return `
    <section class="card">
      <div class="card-h">
        <h2>Run the numbers</h2>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="reset-scenario">Reset</button>
        <div class="hint">Nothing here changes the board. It is a projection off today's ${esc(fmtCr(t.rev))}.
          For headcount and capacity, use Delivery load.</div>
      </div>
      <div class="card-b">
        ${slider("activateHold", "Unfreeze on-hold work", `${esc(fmtCr(t.holdRev))} parked across ${t.hold} projects`,
          0, 1, 0.05, s.activateHold, (v) => (v * 100).toFixed(0) + "%")}
        ${slider("winNewCr", "New business won", "brand-new clients, in ₹ Cr", 0, 10, 0.25, s.winNewCr,
          (v) => "₹" + v.toFixed(2) + "Cr")}
        ${slider("priceUplift", "Rate change across the book", "repricing every retainer", -25, 50, 1, s.priceUplift,
          (v) => (v > 0 ? "+" : "") + v + "%")}
      </div>

      <div class="card-h" style="border-top:1px solid var(--line)">
        <h2>Assume we lose…</h2>
        <span class="spacer"></span>
        ${s.churn.length ? `<span class="chip on">${s.churn.length} client${s.churn.length === 1 ? "" : "s"}</span>` : ""}
        <div class="hint">Click a client to model it walking away.</div>
      </div>
      <div class="card-b">
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${conc.list.slice(0, 12).map((c) => `
            <button class="chip ${s.churn.includes(c.key) ? "on" : "ring"}" data-act="toggle-churn" data-key="${esc(c.key)}">
              ${esc(c.name)} <span class="num muted">${esc((c.rev / 1e7).toFixed(2))}Cr</span>
            </button>`).join("")}
        </div>
      </div>
    </section>`;
}

function assumptions() {
  const set = settings();
  const field = (key, label, val, step = 1, suffix = "") => `
    <div class="field">
      <label for="as-${key}">${esc(label)}</label>
      <input id="as-${key}" type="number" step="${step}" value="${esc(val)}"
             data-change="assumption" data-key="${key}" ${canEdit() ? "" : "disabled"}>
      ${suffix ? `<span class="muted" style="font-size:11px">${esc(suffix)}</span>` : ""}
    </div>`;
  return `
    <section class="card">
      <div class="card-h"><h2>Assumptions</h2>
        <div class="hint">Shared with the whole board — Delivery load reads the same ceilings.</div>
      </div>
      <div class="card-b">
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
          ${field("targetRevenueCr", "Revenue target (₹ Cr)", set.targetRevenueCr, 0.5)}
          ${field("capacityPerDM", "Projects per DM", set.capacityPerDM, 1, "before over capacity")}
          ${field("capacityPerEditor", "Projects per editor lead", set.capacityPerEditor, 1)}
          ${field("costPerDM", "Cost per DM", set.costPerDM, 50000, "per year, ₹")}
          ${field("costPerEditor", "Cost per editor", set.costPerEditor, 50000, "per year, ₹")}
          ${field("staleUpdateDays", "Update goes stale after", set.staleUpdateDays, 1, "days")}
        </div>
      </div>
    </section>`;
}

function outcomes() {
  const r = runScenario(sc());
  const { before, after } = r;
  const set = settings();
  const target = (set.targetRevenueCr || 0) * 1e7;
  const pctFmt = (v) => (v * 100).toFixed(0) + "%";

  const deltaTag = (b, a, fmt, goodUp = true) => {
    const d = a - b;
    if (Math.abs(d) < (Math.abs(b) || 1) * 0.0005) return `<span class="delta muted">no change</span>`;
    const good = goodUp ? d > 0 : d < 0;
    return `<span class="delta ${good ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${esc(fmt(Math.abs(d)))}</span>`;
  };
  const row = (label, b, a, fmt, goodUp = true) => `
    <tr>
      <td><div class="cell-name">${esc(label)}</div></td>
      <td class="r num muted">${esc(fmt(b))}</td>
      <td class="r num"><b>${esc(fmt(a))}</b></td>
      <td class="r">${deltaTag(b, a, fmt, goodUp)}</td>
    </tr>`;

  const notes = [];
  if (target && after.rev >= target) {
    notes.push({ ok: true, text: `Clears the ₹${set.targetRevenueCr} Cr target with ${money(after.rev - target)} to spare.` });
  } else if (target) {
    notes.push({ ok: false, text: `Still ${money(target - after.rev)} short of the ₹${set.targetRevenueCr} Cr target.` });
  }
  if (after.top1 > 0.35) {
    notes.push({ ok: false, text: `One client would be ${pctFmt(after.top1)} of the book — a single conversation away from a bad quarter.` });
  }
  if (after.margin < before.margin - 0.01) {
    notes.push({ ok: false, text: `Contribution margin drops from ${pctFmt(before.margin)} to ${pctFmt(after.margin)}.` });
  }

  return `
    <section class="card">
      <div class="card-h"><h2>What that does</h2>
        <span class="spacer"></span><span class="chip ring">today → scenario</span></div>
      <div class="scroller">
        <table class="rows">
          <thead><tr><th>Measure</th><th class="r">Today</th><th class="r">Scenario</th><th class="r">Change</th></tr></thead>
          <tbody>
            ${row("Book of business", before.rev, after.rev, money)}
            ${row("Active revenue", before.activeRev, after.activeRev, money)}
            ${row("Contribution", before.contribution, after.contribution, money)}
            ${row("Contribution margin", before.margin, after.margin, pctFmt)}
            ${row("Top client share", before.top1, after.top1, pctFmt, false)}
            ${row("Top 3 share", before.top3, after.top3, pctFmt, false)}
          </tbody>
        </table>
      </div>
      ${notes.length ? `<div class="card-b" style="display:grid;gap:8px;border-top:1px solid var(--line)">
        ${notes.map((n) => `<div class="callout ${n.ok ? "" : "warn"}"
          style="${n.ok ? "background:var(--good-wash);border-color:color-mix(in srgb,var(--good) 30%,transparent)" : ""}">
          <span>${n.ok ? "✓" : "●"}</span><span>${esc(n.text)}</span></div>`).join("")}
      </div>` : ""}
      ${target ? `<div class="card-b" style="border-top:1px solid var(--line)">
        ${bullet(after.rev, target, { label: "Scenario book against target", sub: `Today it is ${money(before.rev)}` })}
      </div>` : ""}
    </section>`;
}

/* ------------------------------------------------------------ the book */

function podPanel() {
  const pods = podRollup();
  const t = totals();
  return `
    <section class="card">
      <div class="card-h">
        <h2>Revenue by pod</h2>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="goto" data-view="load">Load by pod →</button>
        <div class="hint">Client revenue is split across that client's project rows, so these
          add back up to ${esc(fmtCr(t.rev))}.</div>
      </div>
      <div class="card-b">
        ${hbar(pods.map((p) => ({ label: p.name, value: p.rev, p })), {
          aria: "Revenue by pod",
          labelWidth: 140,
          colour: (r, i) => seriesVar(i + 1),
          tipRows: (r) => [
            ["Revenue", money(r.p.rev)],
            ["Projects", String(r.p.load)],
            ["Clients", String(r.p.clientCount)],
          ],
        })}
      </div>
    </section>`;
}

function concentrationPanel() {
  const c = concentration();
  const top = c.list.slice(0, 10).map((x) => ({ label: x.name, value: x.rev, c: x }));
  const rest = c.list.slice(10).reduce((s, x) => s + x.rev, 0);
  const restCount = c.list.length - 10;

  return `
    <section class="card">
      <div class="card-h">
        <h2>Where the money comes from</h2>
        <span class="spacer"></span>
        <span class="chip ${c.top3 > 0.5 ? "on" : "ring"}">${esc((c.top3 * 100).toFixed(0))}% in the top 3</span>
        <div class="hint">${c.billing} clients are actually billing; the spread is worth about
          ${esc(c.effectiveClients.toFixed(1))} of them.</div>
      </div>
      <div class="card-b">
        ${hbar(top, {
          aria: "Revenue by client, top ten",
          labelWidth: 150,
          colour: () => "var(--s1)",
          tipRows: (r) => [
            ["Revenue", money(r.c.rev)],
            ["Share of book", ((r.c.rev / c.total) * 100).toFixed(1) + "%"],
            ["Project rows", String(r.c.load)],
          ],
          note: rest > 0 ? `Top 10 shown. The other ${restCount} billing clients add up to ${money(rest)}.` : null,
        })}
      </div>
    </section>`;
}

function mixPanel() {
  const cats = categoryRollup();
  const t = totals();
  return `
    <section class="card">
      <div class="card-h"><h2>What the book is made of</h2>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-act="goto" data-view="load">Effort by work type →</button>
        <div class="hint">Revenue by service line, and by whether it is actually moving.</div>
      </div>
      <div class="card-b">
        <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:6px">By service line</div>
        ${stackBar(cats.map((c, i) => ({ label: c.name, value: c.rev, colour: seriesVar(i + 1) })))}
        <div style="font-size:11.5px;color:var(--ink-3);margin:18px 0 6px">By state</div>
        ${stackBar([
          { label: "Active", value: t.activeRev, colour: "var(--good)" },
          { label: "On hold", value: t.holdRev, colour: "var(--warn)" },
          { label: "Upcoming", value: t.upcomingRev, colour: "var(--s1)" },
        ].filter((p) => p.value > 0))}
      </div>
    </section>`;
}

export function renderOverview() {
  return `
    <div class="head">
      <div>
        <h1>Overview</h1>
        <div class="lede">What the book is worth, where it is concentrated, and what happens if it
          changes. Team time is on Delivery load; anything on fire is on Escalations.</div>
      </div>
      <div class="head-actions">
        <button class="btn" data-act="export">Export to Excel</button>
      </div>
    </div>

    ${statTiles()}

    <div class="split" style="margin-top:14px">
      <div class="grid">${levers()}${assumptions()}</div>
      <div class="grid">${outcomes()}</div>
    </div>

    <div class="grid g2" style="margin-top:14px">
      ${podPanel()}
      ${concentrationPanel()}
    </div>

    <div style="margin-top:14px">${mixPanel()}</div>`;
}
