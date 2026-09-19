/* SVG chart primitives.

   House rules these follow, so don't "simplify" them away:
   thin marks with 4px rounded data-ends anchored to the baseline; a 2px surface
   gap between adjacent fills; recessive grid and axes; values in ink tokens,
   never in the series colour; a hover tooltip on every mark; a legend whenever
   two or more series share a frame; and one axis per chart — never two scales. */

import { esc, seriesVar, money, num, pct } from "./core.js";

const R = 4; // rounded data-end radius

/** Bar with only the far end rounded, anchored flat on the baseline. */
function barPath(x, y, w, h, r = R, horizontal = true) {
  if (horizontal) {
    const rr = Math.min(r, w, h / 2);
    if (w <= rr) return `M${x} ${y}h${w}v${h}h${-w}z`;
    return `M${x} ${y}h${w - rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${h - 2 * rr}a${rr} ${rr} 0 0 1 ${-rr} ${rr}h${-(w - rr)}z`;
  }
  const rr = Math.min(r, h, w / 2);
  if (h <= rr) return `M${x} ${y + h}h${w}v${-h}h${-w}z`;
  return `M${x} ${y + rr}a${rr} ${rr} 0 0 1 ${rr} ${-rr}h${w - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${h - rr}h${-w}z`;
}

const tip = (title, rows) =>
  esc(`<div class="t-t">${title}</div>` + rows.map((r) => `<div class="t-r"><span>${r[0]}</span><b>${r[1]}</b></div>`).join(""))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/* ------------------------------------------------------------ horizontal
   Magnitude by category. The default for "who / what is biggest". */

export function hbar(rows, opts = {}) {
  const {
    valueKey = "value", labelKey = "label", fmt = money,
    colour = () => "var(--s1)", max = null, height = 22, gap = 8,
    labelWidth = 128, valueWidth = 82, tipRows = null, note = null,
  } = opts;

  if (!rows.length) return `<div class="empty">Nothing to show yet.</div>`;

  const top = max ?? Math.max(...rows.map((r) => Math.abs(r[valueKey])), 1);
  const plotL = labelWidth, plotR = valueWidth;
  const W = 700;
  const plotW = W - plotL - plotR;
  const H = rows.length * (height + gap) - gap;

  const marks = rows.map((r, i) => {
    const y = i * (height + gap);
    const v = Math.abs(r[valueKey]);
    const w = Math.max(v > 0 ? 2 : 0, (v / top) * plotW);
    const c = colour(r, i);
    const rowTip = tipRows
      ? tip(r[labelKey], tipRows(r))
      : tip(r[labelKey], [["Value", fmt(r[valueKey])]]);
    return `
      <g data-tip="${esc(rowTip)}">
        <rect x="0" y="${y}" width="${W}" height="${height}" class="hit"></rect>
        <text x="${plotL - 10}" y="${y + height / 2}" text-anchor="end" dominant-baseline="central"
              class="lbl">${esc(String(r[labelKey]).slice(0, 22))}</text>
        <path d="${barPath(plotL, y, w, height)}" fill="${c}" class="mark"></path>
        <text x="${plotL + w + 8}" y="${y + height / 2}" dominant-baseline="central"
              class="val">${esc(fmt(r[valueKey]))}</text>
      </g>`;
  }).join("");

  return `
    <svg class="svg-chart" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMinYMin meet"
         aria-label="${esc(opts.aria || "Bar chart")}">
      <line class="axis" x1="${plotL}" y1="0" x2="${plotL}" y2="${H}"></line>
      ${marks}
    </svg>${note ? `<div class="legend"><span>${esc(note)}</span></div>` : ""}`;
}

/* ---------------------------------------------------------------- stack
   One bar, parts of a whole. Segments carry a 2px surface gap. */

export function stackBar(parts, opts = {}) {
  const { fmt = money, minLabel = 7 } = opts;
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const cells = parts.map((p, i) => {
    const share = (p.value / total) * 100;
    const c = p.colour || seriesVar(i + 1);
    return `<span style="flex:0 0 ${share}%;background:${c}"
      data-tip="${esc(tip(p.label, [["Revenue", fmt(p.value)], ["Share", share.toFixed(1) + "%"]]))}"
      >${share >= minLabel ? share.toFixed(0) + "%" : ""}</span>`;
  }).join("");

  const legend = parts.map((p, i) =>
    `<span><i class="dot" style="background:${p.colour || seriesVar(i + 1)}"></i>${esc(p.label)}
      <b class="num" style="font-weight:500">${esc(fmt(p.value))}</b></span>`).join("");

  return `<div class="stackbar">${cells}</div><div class="legend">${legend}</div>`;
}

/* --------------------------------------------------------------- scatter
   Two measures, one entity per dot. Single hue + direct labels on the
   outliers — no hue cycling, so the all-pairs CVD cap never bites. */

export function scatter(points, opts = {}) {
  const {
    xKey = "x", yKey = "y", labelKey = "label",
    xLabel = "", yLabel = "", fmtX = (v) => num(v), fmtY = money,
    labelTop = 6, guides = null, tipRows = null,
  } = opts;
  if (!points.length) return `<div class="empty">Nothing to plot yet.</div>`;

  const W = 700, H = 320, m = { t: 14, r: 18, b: 38, l: 62 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const xs = points.map((p) => p[xKey]), ys = points.map((p) => p[yKey]);
  const xMax = Math.max(...xs, 1) * 1.08, yMax = Math.max(...ys, 1) * 1.1;
  const X = (v) => m.l + (v / xMax) * pw;
  const Y = (v) => m.t + ph - (v / yMax) * ph;

  const ticksY = 4, ticksX = 5;
  const gridY = Array.from({ length: ticksY + 1 }, (_, i) => {
    const v = (yMax / ticksY) * i, y = Y(v);
    return `<line class="gridline" x1="${m.l}" y1="${y}" x2="${W - m.r}" y2="${y}"></line>
            <text x="${m.l - 9}" y="${y}" text-anchor="end" dominant-baseline="central">${esc(fmtY(v))}</text>`;
  }).join("");
  const gridX = Array.from({ length: ticksX + 1 }, (_, i) => {
    const v = (xMax / ticksX) * i, x = X(v);
    return `<text x="${x}" y="${m.t + ph + 16}" text-anchor="middle">${esc(fmtX(v))}</text>`;
  }).join("");

  // Guide lines (e.g. average load / average revenue) split the frame into quadrants.
  const guideMarks = guides ? `
    ${guides.x != null ? `<line class="gridline" stroke-dasharray="3 3" x1="${X(guides.x)}" y1="${m.t}" x2="${X(guides.x)}" y2="${m.t + ph}"></line>
      <text x="${X(guides.x) + 5}" y="${m.t + 10}" class="lbl">${esc(guides.xLabel || "avg")}</text>` : ""}
    ${guides.y != null ? `<line class="gridline" stroke-dasharray="3 3" x1="${m.l}" y1="${Y(guides.y)}" x2="${W - m.r}" y2="${Y(guides.y)}"></line>
      <text x="${W - m.r - 4}" y="${Y(guides.y) - 6}" text-anchor="end" class="lbl">${esc(guides.yLabel || "avg")}</text>` : ""}` : "";

  // Label only the extremes, never every point.
  const ranked = [...points].sort((a, b) => (b[yKey] + b[xKey] / (xMax || 1) * yMax) - (a[yKey] + a[xKey] / (xMax || 1) * yMax));
  const labelled = new Set(ranked.slice(0, labelTop).map((p) => p[labelKey]));

  const dots = points.map((p) => {
    const x = X(p[xKey]), y = Y(p[yKey]);
    const rows = tipRows ? tipRows(p) : [[xLabel, fmtX(p[xKey])], [yLabel, fmtY(p[yKey])]];
    return `<g data-tip="${esc(tip(p[labelKey], rows))}">
      <circle cx="${x}" cy="${y}" r="13" class="hit"></circle>
      <circle cx="${x}" cy="${y}" r="5.5" fill="var(--s1)" stroke="var(--surface)" stroke-width="2" class="mark"></circle>
      ${labelled.has(p[labelKey])
        ? `<text x="${x + 9}" y="${y - 7}" class="lbl">${esc(String(p[labelKey]).slice(0, 16))}</text>` : ""}
    </g>`;
  }).join("");

  return `
    <svg class="svg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || "Scatter plot")}">
      ${gridY}${gridX}${guideMarks}
      <line class="axis" x1="${m.l}" y1="${m.t + ph}" x2="${W - m.r}" y2="${m.t + ph}"></line>
      ${dots}
      <text x="${m.l + pw / 2}" y="${H - 2}" text-anchor="middle" class="lbl">${esc(xLabel)}</text>
      <text x="12" y="${m.t + ph / 2}" text-anchor="middle" class="lbl"
            transform="rotate(-90 12 ${m.t + ph / 2})">${esc(yLabel)}</text>
    </svg>`;
}

/* ------------------------------------------------------------ area/line
   Change over time. One measure, crosshair tooltip per column. */

export function lineChart(series, opts = {}) {
  const { fmtY = (v) => num(v, 0), fmtX = (v) => v, aria = "Line chart", fill = true } = opts;
  if (!series.length) return `<div class="empty">No activity yet.</div>`;

  const W = 700, H = 200, m = { t: 12, r: 14, b: 26, l: 40 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const yMax = Math.max(...series.map((d) => d.value), 1) * 1.15;
  const X = (i) => m.l + (series.length === 1 ? pw / 2 : (i / (series.length - 1)) * pw);
  const Y = (v) => m.t + ph - (v / yMax) * ph;

  const pts = series.map((d, i) => `${X(i)},${Y(d.value)}`).join(" ");
  const area = fill
    ? `<polygon points="${m.l},${m.t + ph} ${pts} ${X(series.length - 1)},${m.t + ph}"
         fill="var(--s1)" opacity=".10"></polygon>` : "";

  const grid = Array.from({ length: 4 }, (_, i) => {
    const v = (yMax / 3) * i, y = Y(v);
    return `<line class="gridline" x1="${m.l}" y1="${y}" x2="${W - m.r}" y2="${y}"></line>
            <text x="${m.l - 8}" y="${y}" text-anchor="end" dominant-baseline="central">${esc(fmtY(v))}</text>`;
  }).join("");

  const step = Math.max(1, Math.ceil(series.length / 8));
  const xlabels = series.map((d, i) =>
    i % step === 0 || i === series.length - 1
      ? `<text x="${X(i)}" y="${m.t + ph + 15}" text-anchor="middle">${esc(fmtX(d.label))}</text>` : "").join("");

  const hits = series.map((d, i) => {
    const w = pw / Math.max(1, series.length - 1);
    return `<g data-tip="${esc(tip(d.label, [[opts.valueLabel || "Updates", fmtY(d.value)]]))}">
      <rect x="${X(i) - w / 2}" y="${m.t}" width="${w}" height="${ph}" class="hit"></rect>
      <circle cx="${X(i)}" cy="${Y(d.value)}" r="3.5" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"></circle>
    </g>`;
  }).join("");

  return `
    <svg class="svg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
      ${grid}${area}
      <polyline points="${pts}" fill="none" stroke="var(--s1)" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round"></polyline>
      ${xlabels}${hits}
    </svg>`;
}

/* ---------------------------------------------------------------- bullet
   One number against its target. Reads in a glance, no axis needed. */

export function bullet(value, target, opts = {}) {
  const { fmt = money, label = "", sub = "" } = opts;
  const max = Math.max(value, target) * 1.05 || 1;
  const vw = pct(value, max), tw = pct(target, max);
  const hit = target > 0 ? value / target : 0;
  const tone = hit >= 1 ? "var(--good)" : hit >= 0.8 ? "var(--s1)" : "var(--warn)";
  return `
    <div data-tip="${esc(tip(label || "Against target", [
      ["Now", fmt(value)], ["Target", fmt(target)], ["Attainment", (hit * 100).toFixed(0) + "%"],
    ]))}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
        <span style="font-size:12px;color:var(--ink-3)">${esc(label)}</span>
        <span class="num" style="font-size:12.5px;font-weight:500">${esc((hit * 100).toFixed(0))}% of target</span>
      </div>
      <div style="position:relative;height:12px;margin-top:7px">
        <div style="position:absolute;inset:3px 0;background:var(--track);border-radius:99px"></div>
        <div style="position:absolute;left:0;top:3px;bottom:3px;width:${vw}%;background:${tone};border-radius:99px"></div>
        <div style="position:absolute;left:${tw}%;top:0;bottom:0;width:2px;background:var(--ink);border-radius:2px"
             title="target"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11.5px;color:var(--ink-3)">
        <span class="num">${esc(fmt(value))}</span><span class="num">target ${esc(fmt(target))}</span>
      </div>
      ${sub ? `<div style="font-size:11.5px;color:var(--ink-3);margin-top:4px">${esc(sub)}</div>` : ""}
    </div>`;
}

/* -------------------------------------------------------------- sparkbar
   Tiny in-tile distribution. Decorative scale, so no axis. */

export function sparkbar(values, opts = {}) {
  const { colour = "var(--s1)", height = 26 } = opts;
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const W = 120, gap = 2;
  const bw = (W - gap * (values.length - 1)) / values.length;
  const bars = values.map((v, i) => {
    const h = Math.max(1.5, (v / max) * height);
    return `<path d="${barPath(i * (bw + gap), height - h, bw, h, 2, false)}" fill="${colour}" opacity="${0.35 + 0.65 * (v / max)}"></path>`;
  }).join("");
  return `<svg class="svg-chart spark" viewBox="0 0 ${W} ${height}" style="width:${W}px" aria-hidden="true">${bars}</svg>`;
}

/* -------------------------------------------------------------- utilisation
   A load meter against a capacity line — used all over the pod views. */

export function utilMeter(load, capacity, opts = {}) {
  const u = capacity > 0 ? load / capacity : 0;
  const cls = u > 1 ? "over" : u > 0.85 ? "near" : "";
  const label = u > 1 ? "Over capacity" : u > 0.85 ? "At capacity" : "Has room";
  const icon = u > 1 ? "▲" : u > 0.85 ? "●" : "○";
  return `
    <div data-tip="${esc(tip(opts.name || "Utilisation", [
      ["Live projects", num(load)], ["Capacity", String(capacity)], ["Utilisation", (u * 100).toFixed(0) + "%"],
    ]))}">
      <div class="meter"><i class="${cls}" style="width:${Math.min(100, u * 100)}%"></i></div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--ink-3)">
        <span>${icon} ${esc(label)}</span><span class="num">${esc(num(load))}/${capacity}</span>
      </div>
    </div>`;
}
