/* Shared state, server talk, formatting and the small DOM helpers every view
   leans on. Views render HTML strings and declare behaviour with data-act
   attributes; one delegated listener at the root dispatches them. */

export const S = {
  data: null,
  me: "",
  role: "edit",          // "edit" | "view" — set by the server from the session
  openAccess: false,     // true when no password is configured at all
  page: "overview",
  tab: "",               // a page's inner tab (timeline: list/calendar/gantt/escalations)
  drawer: null,          // {kind:"project"|"person"|"update"|"assign"|"escalation"|"import"|"pick-me"|"new-project", id, tab, extra}
  polling: "idle",       // idle | busy | off
  ui: { dirty: new Set(), pendingRender: false, dialog: null, navOpen: false },
  range: { preset: "all", from: "", to: "" },
  filters: {
    q: "", status: [], priority: [], dm: [], sdm: [], category: [], client: [], pod: [], health: [], editor: [],
    person: "", risk: "", quick: "", mine: false,
  },
  sort: { register: { key: "health", dir: 1 }, risk: { key: "priority", dir: 1 }, dm: { key: "risk", dir: -1 }, list: { key: "forecast", dir: 1 }, editors: { key: "util", dir: -1 } },
  register: { mode: "cards" },
  timeline: { mode: "list", zoom: "quarter", group: "dm", window: "6m", cal: "month", calFrom: "", expanded: new Set() },
  alloc: { mode: "week", weeks: 8, from: "" },
  scenario: null,
  scroll: {},
};

/* The team works in IST. A live binding, refreshed on every render, so a tab
   left open overnight does not keep yesterday's "today". The server also sends
   its idea of today with the board; when present that wins. */
export let TODAY = istToday();
export function istToday() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch (_) { return new Date().toISOString().slice(0, 10); }
}
export function tickToday() { TODAY = S.data?.today || istToday(); return TODAY; }

/* ------------------------------------------------------------------ fmt */

export const esc = (x) =>
  String(x == null ? "" : x).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const cr = (v) => (v / 1e7);
export const fmtCr = (v, d = 2) => "₹" + cr(v).toFixed(d) + " Cr";

export function money(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e7) return "₹" + (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return "₹" + (n / 1e5).toFixed(2) + " L";
  if (Math.abs(n) >= 1e3) return "₹" + Math.round(n / 1e3) + "k";
  return "₹" + Math.round(n);
}
/** Money, or an honest blank. */
export const moneyOr = (v, blank = "Not set") => (v == null || !(Number(v) > 0) ? `<span class="muted">${esc(blank)}</span>` : esc(money(v)));

export const num = (v, d = 1) => (Math.abs(v % 1) < 0.05 ? v.toFixed(0) : v.toFixed(d));
export const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const hrs = (h) => (h == null ? "—" : `${num(Number(h), 1)}h`);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS = MON;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]}`;
}
export function fmtDateFull(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}
export function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function relDays(iso, from = TODAY) {
  if (!iso) return null;
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}
export function ago(iso) {
  const d = relDays(String(iso || "").slice(0, 10));
  if (d === null) return "";
  if (d === 0) return "today";
  if (d === -1) return "yesterday";
  if (d === 1) return "tomorrow";
  if (d < 0) return `${-d}d ago`;
  return `in ${d}d`;
}
/** "3d left" / "5d overdue" / "due today" for a date against today. */
export function dueIn(iso) {
  const d = relDays(iso);
  if (d === null) return "";
  if (d === 0) return "due today";
  if (d < 0) return `${-d}d overdue`;
  return `${d}d left`;
}
export const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const initials = (name) =>
  String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export const slug = (x) =>
  String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Deterministic series slot for a name, so a colour follows the entity. */
export function slotFor(name, pool = 8) {
  let h = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % pool) + 1;
}
export const seriesVar = (i) => `var(--s${((i - 1) % 8) + 1})`;

/* ------------------------------------------------------------------ dom */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function avatar(name, cls = "") {
  const slot = slotFor(name);
  return `<span class="avatar ${cls}" style="background:${seriesVar(slot)}" title="${esc(name)}">${esc(initials(name))}</span>`;
}

export function toast(msg, bad = false) {
  let box = $(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), bad ? 5200 : 2600);
}

/* One shared tooltip element, positioned on hover of [data-tip]. */
let tipEl = null;
export function initTooltips(root = document.body) {
  tipEl = document.createElement("div");
  tipEl.className = "tip";
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);

  const show = (target, ev) => {
    const html = target.getAttribute("data-tip");
    if (!html) return;
    tipEl.innerHTML = html;
    tipEl.classList.add("show");
    place(ev);
  };
  const place = (ev) => {
    const pad = 12, r = tipEl.getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
    tipEl.style.left = Math.max(8, x) + "px";
    tipEl.style.top = Math.max(8, y) + "px";
  };
  root.addEventListener("mouseover", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (t) show(t, e);
  });
  root.addEventListener("mousemove", (e) => {
    if (tipEl.classList.contains("show")) place(e);
  });
  root.addEventListener("mouseout", (e) => {
    if (e.target.closest?.("[data-tip]")) tipEl.classList.remove("show");
  });
  window.addEventListener("scroll", () => tipEl.classList.remove("show"), true);
}
export const hideTip = () => tipEl && tipEl.classList.remove("show");

/** A header cell that explains itself on hover. */
export const th = (label, tip, cls = "", sortKey = "", sortName = "") => {
  const sortable = sortKey ? ` data-act="sort" data-table="${esc(sortName)}" data-key="${esc(sortKey)}"` : "";
  const cur = sortName && S.sort[sortName];
  const arrow = cur && cur.key === sortKey ? `<span class="arw">${cur.dir > 0 ? "▲" : "▼"}</span>` : "";
  return `<th class="${cls}"${sortable}>${tip ? `<span class="th-help" data-tip="${esc(tip)}">${esc(label)}</span>` : esc(label)}${arrow}</th>`;
};

/* ------------------------------------------------------------- storage */

export function recall(key, fallback) {
  try { const v = localStorage.getItem("tfops." + key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
}
export function persist(key, value) {
  try { localStorage.setItem("tfops." + key, JSON.stringify(value)); } catch (_) {}
}

/* ------------------------------------------------------------------ api */

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = {};
  try { payload = await res.json(); } catch (_) {}
  if (res.status === 401 && payload.login) {
    location.href = "/login";
    throw Object.assign(new Error("Signed out"), { redirecting: true });
  }
  if (!res.ok) throw Object.assign(new Error(payload.error || `${method} ${path} failed (${res.status})`), { status: res.status, payload });
  return payload;
}

/** Read-only sessions can look at everything and change nothing. */
export const canEdit = () => S.role !== "view";

export const api = {
  get:    (p) => req("GET", p),
  post:   (p, b) => req("POST", p, b),
  patch:  (p, b) => req("PATCH", p, b),
  delete: (p) => req("DELETE", p),
};

/** Wrap a mutating call: refresh state, re-render, surface failures. */
export async function mutate(fn, okMsg) {
  if (!canEdit()) {
    toast(`You are signed in read-only — ask ${S.data?.settings?.adminName || "your admin"} for the editing password`, true);
    return false;
  }
  try {
    const out = await fn();
    await refresh(true, "user");
    if (okMsg) toast(okMsg);
    return out === undefined ? true : out;
  } catch (err) {
    toast(err.message || "That did not save", true);
    return false;
  }
}

let onRender = () => {};
export function setRenderer(fn) { onRender = fn; }

export async function refresh(force = false, reason = "poll") {
  const data = await api.get("/api/state" + (force ? "" : `?since=${S.data?.version || 0}`));
  if (data.unchanged) return false;
  // A host that routes /api to the page shell answers 200 with HTML, which
  // parses to nothing; say so rather than fail on the first missing list.
  if (!Array.isArray(data.projects)) throw new Error("The server answered with a page instead of the board — its API is not being served.");
  S.data = data;
  if (typeof data.me === "string") S.me = data.me;
  if (data.role) S.role = data.role;
  S.openAccess = !!data.openAccess;
  tickToday();
  onRender(reason);
  return true;
}

/* Cheap change detection: poll the version counter, pull the board when it moves. */
export function startPolling(ms = 12000) {
  let stop = false;
  const tick = async () => {
    if (stop || document.hidden) return;
    try {
      const { version } = await api.get("/api/version");
      if (version !== S.data?.version) {
        S.polling = "busy"; paintSync();
        await refresh(true, "poll");
      }
      S.polling = "idle";
    } catch (_) {
      S.polling = "off";
    }
    paintSync();
  };
  setInterval(tick, ms);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  return () => { stop = true; };
}

export function paintSync() {
  const pip = $("#syncpip"), txt = $("#synctxt");
  if (!pip) return;
  pip.className = "pip " + (S.polling === "off" ? "off" : S.polling === "busy" ? "busy" : "on");
  txt.textContent = S.polling === "off" ? "Offline" : S.polling === "busy" ? "Syncing" : "Live";
}

/* ------------------------------------------------------- dirty forms
   A poll must never wipe a form someone is typing in. Forms declare
   data-guard="key"; any input in them marks the key dirty until the form is
   submitted, reset or closed. The renderer checks `isDirty()` before it
   repaints and shows an "updates available" chip instead. */

export const isDirty = () => S.ui.dirty.size > 0 || !!S.ui.dialog;
export const markClean = (key) => { if (key) S.ui.dirty.delete(key); else S.ui.dirty.clear(); };

/* -------------------------------------------------------------- actions */

const handlers = new Map();
export function act(name, fn) { handlers.set(name, fn); }

export function initActions(root = document) {
  root.addEventListener("click", (e) => {
    const el = e.target.closest?.("[data-act]");
    if (!el) return;
    const fn = handlers.get(el.getAttribute("data-act"));
    if (!fn) return;
    // Links and buttons are ours to handle; a checkbox must keep its tick.
    if (el.tagName === "A" || el.tagName === "BUTTON" || el.hasAttribute("data-prevent")) e.preventDefault();
    fn(el, e);
  });
  root.addEventListener("change", (e) => {
    const guard = e.target.closest?.("form[data-guard]");
    if (guard) S.ui.dirty.add(guard.getAttribute("data-guard"));
    const el = e.target.closest?.("[data-change]");
    if (!el) return;
    const fn = handlers.get(el.getAttribute("data-change"));
    if (fn) fn(el, e);
  });
  root.addEventListener("input", (e) => {
    const guard = e.target.closest?.("form[data-guard]");
    if (guard) S.ui.dirty.add(guard.getAttribute("data-guard"));
    const el = e.target.closest?.("[data-input]");
    if (!el) return;
    const fn = handlers.get(el.getAttribute("data-input"));
    if (fn) fn(el, e);
  });
  root.addEventListener("submit", (e) => {
    const el = e.target.closest?.("[data-submit]");
    if (!el) return;
    e.preventDefault();
    const fn = handlers.get(el.getAttribute("data-submit"));
    if (fn) fn(el, e);
  });
}

/* Debounce for search boxes and sliders. */
export function debounce(fn, ms = 180) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* --------------------------------------------------------------- dialog
   One confirmation dialog at a time, promise-based, so a handler reads
   `if (!(await confirmDialog({...}))) return;` and nothing else changes. */

export function confirmDialog({ title, body = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  const host = $("#dialog-host");
  if (!host) return Promise.resolve(window.confirm(title));
  return new Promise((resolve) => {
    // Resolves false on cancel, or an object of the dialog's named inputs on
    // confirm (always truthy), so a dialog can ask for a date or a reason.
    const done = (v) => {
      let out = false;
      if (v) {
        out = {};
        host.querySelectorAll("[name]").forEach((el) => { out[el.name] = el.type === "checkbox" ? el.checked : el.value; });
        const req = [...host.querySelectorAll("[name][required]")].find((el) => !String(el.value || "").trim());
        if (req) { req.focus(); req.classList.add("bad"); return; }
      }
      host.innerHTML = ""; S.ui.dialog = null; document.removeEventListener("keydown", onKey); resolve(out);
    };
    const onKey = (e) => { if (e.key === "Escape") done(false); };
    S.ui.dialog = { title };
    host.innerHTML = `
      <div class="scrim" data-dialog="cancel"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        <div class="dialog-b">${body}</div>
        <div class="dialog-f">
          <button class="btn ghost" data-dialog="cancel">${esc(cancelLabel)}</button>
          <button class="btn ${danger ? "danger" : "primary"}" data-dialog="ok" autofocus>${esc(confirmLabel)}</button>
        </div>
      </div>`;
    host.querySelectorAll("[data-dialog]").forEach((el) => el.addEventListener("click", () => done(el.getAttribute("data-dialog") === "ok")));
    document.addEventListener("keydown", onKey);
    host.querySelector("[data-dialog=ok]")?.focus();
  });
}
