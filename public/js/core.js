/* Shared state, server talk, formatting and the small DOM helpers every view
   leans on. Views render HTML strings and declare behaviour with data-act
   attributes; one delegated listener at the root dispatches them. */

export const S = {
  data: null,
  me: "",
  role: "edit",          // "edit" | "view" — set by the server from the session
  openAccess: false,     // true when no password is configured at all
  view: "overview",
  drawer: null,
  person: null,        // {name, role} when the person drawer is open
  polling: "idle",       // idle | busy | off
  filters: { q: "", pod: "", status: "", category: "", person: "", risk: "" },
  sort: { projects: { key: "client", dir: 1 }, people: { key: "rev", dir: -1 } },
  timeline: { zoom: "quarter", group: "pod", window: "6m" },
  scenario: null,
  loadScenario: null,  // {dmDelta, edDelta, unfreeze} for the Delivery load levers
  loadBy: "client",    // Delivery load ranking: "client" | "project"
  loadAll: false,      // show every row in that ranking, not just the top 15
};

export const TODAY = new Date().toISOString().slice(0, 10);

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

export const num = (v, d = 1) => (Math.abs(v % 1) < 0.05 ? v.toFixed(0) : v.toFixed(d));
export const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
export function relDays(iso, from = TODAY) {
  if (!iso) return null;
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}
export function ago(iso) {
  const d = relDays(iso);
  if (d === null) return "";
  if (d === 0) return "today";
  if (d === -1) return "yesterday";
  if (d === 1) return "tomorrow";
  if (d < 0) return `${-d}d ago`;
  return `in ${d}d`;
}
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

let toastTimer = null;
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
    throw new Error("Signed out");
  }
  if (!res.ok) throw new Error(payload.error || `${method} ${path} failed (${res.status})`);
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
    await fn();
    await refresh(true);
    if (okMsg) toast(okMsg);
    return true;
  } catch (err) {
    toast(err.message || "That did not save", true);
    return false;
  }
}

let onRender = () => {};
export function setRenderer(fn) { onRender = fn; }

export async function refresh(force = false) {
  const data = await api.get("/api/state" + (force ? "" : `?since=${S.data?.version || 0}`));
  if (data.unchanged) return false;
  S.data = data;
  if (typeof data.me === "string") S.me = data.me;
  if (data.role) S.role = data.role;
  S.openAccess = !!data.openAccess;
  onRender();
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
        await refresh(true);
        toast("Board updated");
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

/* -------------------------------------------------------------- actions */

const handlers = new Map();
export function act(name, fn) { handlers.set(name, fn); }

export function initActions(root = document) {
  root.addEventListener("click", (e) => {
    const el = e.target.closest?.("[data-act]");
    if (!el) return;
    const fn = handlers.get(el.getAttribute("data-act"));
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });
  root.addEventListener("change", (e) => {
    const el = e.target.closest?.("[data-change]");
    if (!el) return;
    const fn = handlers.get(el.getAttribute("data-change"));
    if (fn) fn(el, e);
  });
  root.addEventListener("input", (e) => {
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
