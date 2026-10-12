"use strict";
/* TFOps dashboard server — no dependencies, `node server.js` and you are up.
   Serves public/ and a small JSON API over the board.

   The same file runs two ways. On a machine with a disk it listens on a port
   and keeps the board in data/store.json. On Vercel it is imported by
   api/index.js and handles one request at a time, with the board in Upstash
   (lib/store.js picks the backend from the environment). Nothing below cares
   which, beyond waiting for `store.ready()` before it reads anything.

   Env:
     PORT                 (default 8848)
     HOST                 (default 0.0.0.0 — so the team can reach it on the LAN)
     DATA_DIR             where store.json lives (default ./data)
     TFOPS_PASSWORD       full-access password; setting it turns on the login
     TFOPS_VIEW_PASSWORD  read-only password for leadership
     TFOPS_SECRET         session signing key (otherwise kept by the store)
     TRUST_PROXY=1        behind an HTTPS proxy — issue Secure cookies
     KV_REST_API_URL      \ set these two and the board moves to Upstash Redis
     KV_REST_API_TOKEN    / (the Vercel integration adds them for you)

   With no password set the board runs open, which is fine on a LAN and not
   fine on the internet; the server says so loudly at startup, and refuses to
   serve at all on a host that is public by definition. */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./lib/store");
const auth = require("./lib/auth");
const loginPage = require("./lib/login-page");
const noticePage = require("./lib/notice-page");
const sheet = require("./lib/import-sheet");
const { engine } = require("./lib/schedule");
const { todayIST } = require("./lib/dates");

const PORT = Number(process.env.PORT || 8848);
const HOST = process.env.HOST || "0.0.0.0";
// Vercel is always HTTPS and always public — take both as given.
const SERVERLESS = !!process.env.VERCEL;
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || SERVERLESS;
const PUBLIC = path.join(__dirname, "public");
const MAX_BODY = 1_000_000;
const MAX_IMPORT = 6_000_000;      // a pasted sheet with a few weeks of columns

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const uid = (p) => p + "-" + crypto.randomBytes(5).toString("hex");
const nowISO = () => new Date().toISOString();

/* ------------------------------------------------------------ http helpers */

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "cache-control": "no-store", ...headers });
  res.end(body);
}

function json(res, code, obj, headers = {}) {
  send(res, code, JSON.stringify(obj), { "content-type": "application/json; charset=utf-8", ...headers });
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setCookie(name, value, days = 365, httpOnly = false) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${days * 86400}; SameSite=Lax`
    + (httpOnly ? "; HttpOnly" : "")
    + (TRUST_PROXY ? "; Secure" : "");
}

/** The session on this request: {role} when logins are on, full access when off. */
function session(req) {
  if (!auth.isEnabled()) return { role: "edit", open: true };
  return auth.verify(cookies(req)[auth.COOKIE], store.DATA_DIR);
}

const MUTATING = new Set(["POST", "PATCH", "DELETE", "PUT"]);

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function who(req) {
  return (cookies(req)["tfops_user"] || "").slice(0, 60) || "";
}

/* ------------------------------------------------------------ static files */

async function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = decodeURIComponent(rel).replace(/\\/g, "/");
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "forbidden");
  let st;
  try {
    st = await fs.promises.stat(file);
    if (!st.isFile()) throw new Error("not a file");
  } catch (_) {
    // Unknown path inside the app → let the client router handle it.
    if (!path.extname(rel)) return serveStatic(req, res, "/");
    return send(res, 404, "not found");
  }
  const etag = `"${st.size}-${st.mtimeMs}"`;
  if (req.headers["if-none-match"] === etag) return send(res, 304, "");
  send(res, 200, await fs.promises.readFile(file), {
    "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    etag,
  });
}

/* ------------------------------------------------------------- validation
   Every write is typed here, once. A field that fails its check is dropped
   with a 400, never coerced into something that looks saved. */

const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const V = {
  str: (max = 400) => (v) => (v == null ? "" : typeof v === "string" ? v.trim().slice(0, max) : undefined),
  text: (max = 4000) => (v) => (v == null ? "" : typeof v === "string" ? v.slice(0, max) : undefined),
  iso: () => (v) => (v == null || v === "" ? null : isISO(v) ? v : undefined),
  bool: () => (v) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined),
  num: (min = -Infinity, max = Infinity) => (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  },
  list: (max = 60) => (v) => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, max)).filter(Boolean) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined),
  oneOf: (opts, blank = true) => (v) => (v == null || v === "" ? (blank ? "" : undefined) : opts.includes(v) ? v : undefined),
};

/** Apply `spec` ({field: checker}) to `body`; returns {patch, bad}. */
function validate(body, spec) {
  const patch = {}, bad = [];
  for (const [k, check] of Object.entries(spec)) {
    if (!(k in body)) continue;
    const v = check(body[k]);
    if (v === undefined) bad.push(k); else patch[k] = v;
  }
  return { patch, bad };
}

const PROJECT_SPEC = {
  client: V.str(120), projectName: V.str(200), dms: V.list(), primaryDm: V.str(60), editorLeads: V.list(),
  editorTagging: V.str(400), podOwner: V.str(60), sdm: V.str(60),
  priority: V.oneOf(["High", "Medium", "Low"]), status: V.oneOf(["Active", "On Hold", "Upcoming", "Completed"], false),
  categories: V.list(), scope: V.text(4000), scopeLocked: V.text(4000), completedFromScope: V.text(2000), scopeCompleted: V.text(2000),
  waGroupLink: V.str(400), start: V.iso(), end: V.iso(), startNote: V.str(200), endNote: V.str(200),
  openEnded: V.bool(), progress: V.num(0, 100), datesUnknown: V.bool(), effort: V.num(1, 5),
  revenue: V.num(0), baselineLocked: V.bool(), tags: V.list(40),
};

const OWNER_TYPES = ["Client", "DM", "Editor", "AI/Tech", "Creative", "Other"];
const MS_STATUSES = ["planned", "in_progress", "blocked", "done"];
const SEVERITIES = ["low", "medium", "high", "critical"];

const MILESTONE_SPEC = {
  title: V.str(160), stage: V.str(40), owner: V.str(60), ownerType: V.oneOf(OWNER_TYPES),
  startDate: V.iso(), baselineDue: V.iso(), ownerEta: V.iso(), durationDays: V.num(0, 365), lagDays: V.num(0, 90),
  dependsOn: V.list(80), actualStart: V.iso(), actualDone: V.iso(), status: V.oneOf(MS_STATUSES, false),
  blocker: V.str(400), locked: V.bool(), external: V.bool(), order: V.num(0, 999),
};

const ASSIGNMENT_SPEC = {
  projectId: V.str(80), milestoneId: V.str(80), editor: V.str(60), dm: V.str(60),
  estimatedHours: V.num(0, 2000), scheduledStart: V.iso(), scheduledEnd: V.iso(), actualHours: V.num(0, 5000),
  status: V.oneOf(["planned", "active", "done", "cancelled"], false), note: V.str(400),
};

const ESCALATION_SPEC = {
  reason: V.str(400), severity: V.oneOf(SEVERITIES, false), owner: V.str(60), resolutionTarget: V.iso(),
  status: V.oneOf(["open", "in_progress", "resolved"], false), blocker: V.str(400), nextAction: V.str(400),
  nextActionOwner: V.str(60), resolution: V.str(1000),
};

const UPDATE_SPEC = {
  projectId: V.str(80), date: V.iso(), text: V.text(4000), completed: V.text(4000), planned: V.text(2000),
  status: V.str(30), milestoneId: V.str(80), progressNote: V.str(400), scopeCompleted: V.str(2000),
  blockers: V.text(2000), dependencyOwner: V.oneOf(OWNER_TYPES), nextAction: V.str(400), nextActionOwner: V.str(60),
  expectedResolution: V.iso(), nextMilestoneId: V.str(80), nextMilestoneDate: V.iso(), forecastDelivery: V.iso(),
  escalationRequired: V.bool(), escalationReason: V.str(400), escalationSeverity: V.oneOf(SEVERITIES), eta: V.iso(),
  draft: V.bool(),
};

/* -------------------------------------------------------------------- api */

const ok = (res, extra = {}) =>
  json(res, 200, { ok: true, version: store.snapshot().version, ...extra });

const bad = (res, msg, extra = {}) => json(res, 400, { error: msg, ...extra });

/** Record who changed which project field, so a later sheet import knows the
    board was edited on purpose and keeps that value. */
function touch(p, fields, me) {
  const at = nowISO();
  p.touched = p.touched || {};
  fields.forEach((k) => { p.touched[k] = at; });
  p.editedBy = me;
  p.editedAt = at;
}

function pushHistory(target, entry) {
  target.history = target.history || [];
  target.history.unshift(entry);
  if (target.history.length > 200) target.history.length = 200;
}

async function api(req, res, url, sess = { role: "edit" }) {
  const seg = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  const me = who(req);
  const today = todayIST();

  /* Everything below reads the board, so it has to be current first. The two
     exceptions matter: /api/version is the poll every open tab runs every 12
     seconds, and it only needs the counter. */
  if (seg[0] !== "version" && seg[0] !== "me") await store.ready();

  /* --- identity ------------------------------------------------------- */
  if (seg[0] === "me") {
    if (method === "GET") return json(res, 200, { name: me });
    if (method === "POST") {
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 60);
      return json(res, 200, { name }, { "set-cookie": setCookie("tfops_user", name) });
    }
  }

  /* --- whole board ---------------------------------------------------- */
  if (seg[0] === "state" && method === "GET") {
    const data = store.snapshot();
    const since = Number(url.searchParams.get("since") || 0);
    if (since && since === data.version) return json(res, 200, { version: data.version, unchanged: true });
    return json(res, 200, { ...data, me, role: sess.role, openAccess: !!sess.open, today });
  }

  if (seg[0] === "version" && method === "GET") {
    return json(res, 200, await store.version());
  }

  if (method === "GET") return json(res, 404, { error: "unknown endpoint: " + url.pathname });
  if (!me) return json(res, 401, { error: "Pick who you are first." });

  /* --- projects ------------------------------------------------------- */
  if (seg[0] === "projects" && seg[1] && method === "PATCH") {
    const body = await readBody(req);
    const { patch, bad: badFields } = validate(body, PROJECT_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    if ("deliveryOverride" in body) {
      const o = body.deliveryOverride;
      if (o === null) patch.deliveryOverride = null;
      else if (o && isISO(o.date) && String(o.reason || "").trim()) patch.deliveryOverride = { date: o.date, reason: String(o.reason).trim().slice(0, 400), by: me, at: nowISO() };
      else return bad(res, "A forecast override needs a date and a reason.");
    }
    const reason = String(body.reason || "").trim().slice(0, 400);
    const changed = [];
    let refused = null;
    const result = await store.mutate((d) => {
      const p = d.projects.find((x) => x.id === seg[1]);
      if (!p) return null;
      // Moving a committed delivery date is a decision, not a correction.
      if ("end" in patch && p.end && patch.end !== p.end && !reason) { refused = "Changing the committed delivery date needs a reason."; return null; }
      if ("end" in patch && p.baselineLocked && patch.end !== p.end && !reason) { refused = "The committed date is locked; give a reason to move it."; return null; }
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(p[k]) === JSON.stringify(v)) continue;
        if (k === "end") pushHistory(p, { at: nowISO(), by: me, field: "end", from: p.end, to: v, reason });
        if (k === "deliveryOverride") pushHistory(p, { at: nowISO(), by: me, field: "deliveryOverride", from: p.deliveryOverride?.date || null, to: v?.date || null, reason: v?.reason || reason || "cleared" });
        p[k] = v;
        changed.push(k);
        if (k === "scopeLocked") p.scope = v;
        if (k === "scope") p.scopeLocked = v;
        if (k === "scopeCompleted") p.completedFromScope = v;
        if (k === "completedFromScope") p.scopeCompleted = v;
        if (k === "dms" && !v.includes(p.primaryDm)) p.primaryDm = v[0] || "";
        if (k === "primaryDm" && v && !(p.dms || []).includes(v)) p.dms = [v, ...(p.dms || [])];
        if (k === "client") { p.clientKey = v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
        if (k === "client" || k === "projectName") p.label = [p.client, p.projectName].filter(Boolean).join(" — ");
        if (k === "baselineLocked" && v && !p.baselineOriginal && isISO(p.end)) p.baselineOriginal = p.end;
      }
      if (changed.length) touch(p, changed, me);
      return p;
    }, () => ({ who: me, action: "project.update", target: seg[1], detail: changed.join(", ") }));
    if (refused) return bad(res, refused);
    if (!result) return json(res, 404, { error: "no such project" });
    return ok(res, { project: result, changed });
  }

  if (seg[0] === "projects" && !seg[1] && method === "POST") {
    const body = await readBody(req);
    const { patch, bad: badFields } = validate(body, PROJECT_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    const client = patch.client || "";
    if (!client) return bad(res, "client is required");
    const created = await store.mutate((d) => {
      const dms = patch.dms || [];
      const p = {
        id: uid("proj"),
        client,
        clientKey: client.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        projectName: patch.projectName || "",
        label: [client, patch.projectName].filter(Boolean).join(" — "),
        dms, primaryDm: patch.primaryDm && dms.includes(patch.primaryDm) ? patch.primaryDm : (dms[0] || ""),
        editorLeads: patch.editorLeads || [], editorTagging: "",
        podOwner: patch.podOwner || "", sdm: patch.sdm || "",
        priority: patch.priority || "", status: patch.status || "Upcoming",
        categories: patch.categories || [],
        scope: patch.scopeLocked || patch.scope || "", scopeLocked: patch.scopeLocked || patch.scope || "",
        completedFromScope: patch.scopeCompleted || "", scopeCompleted: patch.scopeCompleted || "", scopeUnits: null,
        waGroupLink: "", start: patch.start || null, end: patch.end || null,
        startNote: "", endNote: "", endInferred: false, openEnded: !!patch.openEnded, datesUnknown: false,
        progress: null, revenue: patch.revenue ?? null, sheetRevenue: null,
        baselineOriginal: patch.end || null, baselineLocked: false, deliveryOverride: null,
        touched: {}, history: [], tags: patch.tags || [],
        createdBy: me, createdAt: nowISO(),
      };
      d.projects.push(p);
      return p;
    }, { who: me, action: "project.create", target: client });
    return ok(res, { project: created });
  }

  /* --- the template chain ---------------------------------------------- */
  if (seg[0] === "projects" && seg[1] && seg[2] === "milestones" && seg[3] === "template" && method === "POST") {
    const body = await readBody(req);
    const start = isISO(body.startDate) ? body.startDate : today;
    const sched = await engine();
    let error = null;
    const created = await store.mutate((d) => {
      const p = d.projects.find((x) => x.id === seg[1]);
      if (!p) { error = 404; return null; }
      const template = Array.isArray(body.template) && body.template.length ? body.template : d.settings.milestoneTemplate;
      const existing = d.milestones.filter((m) => m.projectId === p.id);
      if (existing.length && !body.append) { error = "This project already has milestones. Remove them first, or append."; return null; }
      const chain = sched.templateChain(template, start, d.settings);
      const ids = chain.map(() => uid("ms"));
      const base = existing.length;
      const out = chain.map((m, i) => {
        const { dependsOnIndex, ...rest } = m;
        return { id: ids[i], projectId: p.id, ...rest, dependsOn: dependsOnIndex.map((k) => ids[k]), order: base + i, createdBy: me, createdAt: nowISO() };
      });
      d.milestones.push(...out);
      return out;
    }, { who: me, action: "milestone.template", target: seg[1] });
    if (error === 404) return json(res, 404, { error: "no such project" });
    if (error) return bad(res, error);
    return ok(res, { milestones: created });
  }

  /* --- milestones ------------------------------------------------------ */
  if (seg[0] === "milestones" && !seg[1] && method === "POST") {
    const body = await readBody(req);
    const { patch, bad: badFields } = validate(body, MILESTONE_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    const projectId = String(body.projectId || "");
    if (!patch.title) return bad(res, "A milestone needs a title.");
    let error = null;
    const created = await store.mutate((d) => {
      if (!d.projects.some((p) => p.id === projectId)) { error = "no such project"; return null; }
      const deps = (patch.dependsOn || []).filter((id) => d.milestones.some((m) => m.id === id && m.projectId === projectId));
      const m = {
        id: uid("ms"), projectId, title: patch.title, stage: patch.stage || "custom",
        owner: patch.owner || "", ownerType: patch.ownerType || "DM",
        startDate: patch.startDate || null, baselineDue: patch.baselineDue || null, ownerEta: patch.ownerEta || null,
        durationDays: patch.durationDays ?? null, lagDays: patch.lagDays ?? 0, dependsOn: deps,
        actualStart: patch.actualStart || null, actualDone: patch.actualDone || null,
        status: patch.actualDone ? "done" : (patch.status || "planned"), blocker: patch.blocker || "",
        locked: !!patch.locked, external: patch.external ?? (patch.ownerType === "Client"), override: null, history: [],
        order: patch.order ?? d.milestones.filter((x) => x.projectId === projectId).length,
        createdBy: me, createdAt: nowISO(),
      };
      d.milestones.push(m);
      return m;
    }, { who: me, action: "milestone.create", target: projectId });
    if (error) return json(res, 404, { error });
    return ok(res, { milestone: created });
  }

  if (seg[0] === "milestones" && seg[1] && (method === "PATCH" || method === "DELETE")) {
    const body = method === "PATCH" ? await readBody(req) : {};
    const previewOnly = url.searchParams.get("preview") === "1";
    const sched = await engine();

    if (method === "DELETE") {
      const removed = await store.mutate((d) => {
        const i = d.milestones.findIndex((m) => m.id === seg[1]);
        if (i < 0) return null;
        const [m] = d.milestones.splice(i, 1);
        d.milestones.forEach((x) => { if (x.dependsOn?.includes(m.id)) x.dependsOn = x.dependsOn.filter((id) => id !== m.id); });
        d.assignments.forEach((a) => { if (a.milestoneId === m.id) a.milestoneId = null; });
        return m;
      }, { who: me, action: "milestone.delete", target: seg[1] });
      if (!removed) return json(res, 404, { error: "no such milestone" });
      return ok(res);
    }

    const { patch, bad: badFields } = validate(body, MILESTONE_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    if ("override" in body) {
      const o = body.override;
      if (o === null) patch.override = null;
      else if (o && isISO(o.date) && String(o.reason || "").trim()) patch.override = { date: o.date, reason: String(o.reason).trim().slice(0, 400), by: me, at: nowISO() };
      else return bad(res, "An override needs a date and a reason.");
    }
    const reason = String(body.reason || "").trim().slice(0, 400);

    /* The same function runs for the dry run and the real thing, so the impact
       the reviewer approved is the impact that gets recorded. */
    const applyPatch = (d) => {
      const m = d.milestones.find((x) => x.id === seg[1]);
      if (!m) return { error: 404 };
      const p = d.projects.find((x) => x.id === m.projectId);
      if (!p) return { error: 404 };
      if ("baselineDue" in patch && patch.baselineDue !== m.baselineDue && !reason) return { error: "Changing a committed milestone date needs a reason." };
      if ("baselineDue" in patch && m.locked && patch.baselineDue !== m.baselineDue && !reason) return { error: "This milestone's baseline is locked; give a reason to move it." };
      if ("dependsOn" in patch) {
        patch.dependsOn = patch.dependsOn.filter((id) => id !== m.id && d.milestones.some((x) => x.id === id && x.projectId === m.projectId));
      }
      if ("actualDone" in patch && patch.actualDone) patch.status = "done";
      if ("status" in patch && patch.status !== "done" && !("actualDone" in patch) && m.actualDone) patch.actualDone = null;
      if ("status" in patch && patch.status === "in_progress" && !m.actualStart && !("actualStart" in patch)) patch.actualStart = today;

      const im = sched.impact({ project: p, milestones: d.milestones, assignments: d.assignments, people: d.people, change: { id: m.id, patch }, today, settings: d.settings });
      return { m, p, impact: im };
    };

    if (previewOnly) {
      const r = applyPatch(structuredClone(store.snapshot()));
      if (r.error === 404) return json(res, 404, { error: "no such milestone" });
      if (r.error) return bad(res, r.error);
      return json(res, 200, { ok: true, preview: true, impact: r.impact });
    }

    let outcome = null;
    const result = await store.mutate((d) => {
      const r = applyPatch(d);
      outcome = r;
      if (r.error) return null;
      const { m, p } = r;
      const before = sched.projectForecast(p, d.milestones, today, d.settings);
      const TRACKED = ["baselineDue", "ownerEta", "override", "locked", "actualDone", "dependsOn", "durationDays", "status", "startDate", "owner", "external"];
      const changedKeys = [];
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(m[k]) === JSON.stringify(v)) continue;
        if (TRACKED.includes(k)) {
          pushHistory(m, { at: nowISO(), by: me, field: k, from: k === "override" ? (m.override?.date || null) : m[k], to: k === "override" ? (v?.date || null) : v, reason: k === "override" ? (v?.reason || reason || "cleared") : reason, today });
        }
        m[k] = v;
        changedKeys.push(k);
      }
      const after = sched.projectForecast(p, d.milestones, today, d.settings);
      if (m.history[0] && changedKeys.some((k) => TRACKED.includes(k))) {
        m.history[0].forecast = { before: before.milestones.get(m.id)?.forecast || null, after: after.milestones.get(m.id)?.forecast || null };
        m.history[0].delivery = { before: before.forecast, after: after.forecast, baseline: after.baseline };
      }
      m.editedBy = me; m.editedAt = nowISO();
      r.changed = changedKeys;
      return m;
    }, (m) => ({ who: me, action: "milestone.update", target: seg[1], detail: outcome?.changed?.join(", ") || "" }));
    if (outcome?.error === 404) return json(res, 404, { error: "no such milestone" });
    if (outcome?.error) return bad(res, outcome.error);
    return ok(res, { milestone: result, impact: outcome.impact, changed: outcome.changed });
  }

  /* --- assignments ----------------------------------------------------- */
  if (seg[0] === "assignments" && seg[1] === "preview" && method === "POST") {
    const body = await readBody(req);
    const { patch, bad: badFields } = validate(body, ASSIGNMENT_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    const sched = await engine();
    const d = store.snapshot();
    const excludeId = String(body.excludeId || "");
    const live = d.assignments.filter((a) => a.id !== excludeId);
    const draft = { id: "draft", status: "planned", ...patch };
    const resolved = sched.resolveAssignments([...live, draft], d.milestones, today, d.settings);
    const mine = resolved.find((a) => a.id === "draft");
    const from = mine?.start || patch.scheduledStart || today;
    const to = mine?.end || patch.scheduledEnd || from;
    const person = d.people.find((x) => x.name === patch.editor) || { name: patch.editor, roles: ["editorLead"] };
    const without = sched.resolveAssignments(live, d.milestones, today, d.settings);
    const before = sched.utilisation({ person, assignments: without, from, to, settings: d.settings });
    const after = sched.utilisation({ person, assignments: resolved, from, to, settings: d.settings });
    const overloaded = sched.overloadedDays({ person, assignments: resolved, from, to, settings: d.settings });
    const suggestions = sched.bestEditor({ people: d.people, assignments: without, from, to, skills: body.skills || [], settings: d.settings });
    const project = d.projects.find((p) => p.id === patch.projectId);
    const pf = project ? sched.projectForecast(project, d.milestones, today, d.settings) : null;
    return json(res, 200, { ok: true, window: { from, to, derived: !!mine?.derived }, before, after, overloaded, suggestions: suggestions.slice(0, 6),
      delivery: pf ? { baseline: pf.baseline, forecast: pf.forecast, forecastMiss: pf.forecastMiss } : null });
  }

  if (seg[0] === "assignments" && !seg[1] && method === "POST") {
    const body = await readBody(req);
    const { patch, bad: badFields } = validate(body, ASSIGNMENT_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    if (!patch.editor || !patch.projectId) return bad(res, "An assignment needs an editor and a project.");
    if (patch.scheduledStart && patch.scheduledEnd && patch.scheduledEnd < patch.scheduledStart) return bad(res, "The end is before the start.");
    let error = null;
    const created = await store.mutate((d) => {
      const p = d.projects.find((x) => x.id === patch.projectId);
      if (!p) { error = "no such project"; return null; }
      if (patch.milestoneId && !d.milestones.some((m) => m.id === patch.milestoneId && m.projectId === p.id)) patch.milestoneId = null;
      const a = {
        id: uid("as"), projectId: p.id, milestoneId: patch.milestoneId || null, editor: patch.editor,
        dm: patch.dm || p.primaryDm || "", estimatedHours: patch.estimatedHours ?? null,
        scheduledStart: patch.scheduledStart || null, scheduledEnd: patch.scheduledEnd || null, actualHours: null,
        status: patch.status || "planned", note: patch.note || "", history: [],
        createdBy: me, createdAt: nowISO(),
      };
      d.assignments.push(a);
      if (!(p.editorLeads || []).includes(a.editor)) { p.editorLeads = [...(p.editorLeads || []), a.editor]; touch(p, ["editorLeads"], me); }
      return a;
    }, { who: me, action: "assignment.create", target: patch.projectId, detail: patch.editor });
    if (error) return json(res, 404, { error });
    return ok(res, { assignment: created });
  }

  if (seg[0] === "assignments" && seg[1] && (method === "PATCH" || method === "DELETE")) {
    const body = method === "PATCH" ? await readBody(req) : {};
    const { patch, bad: badFields } = validate(body, ASSIGNMENT_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    const reason = String(body.reason || "").trim().slice(0, 400);
    let changed = [];
    const result = await store.mutate((d) => {
      const i = d.assignments.findIndex((a) => a.id === seg[1]);
      if (i < 0) return null;
      if (method === "DELETE") return d.assignments.splice(i, 1)[0];
      const a = d.assignments[i];
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(a[k]) === JSON.stringify(v)) continue;
        if (["editor", "estimatedHours", "scheduledStart", "scheduledEnd", "status", "milestoneId"].includes(k)) {
          pushHistory(a, { at: nowISO(), by: me, field: k, from: a[k], to: v, reason });
        }
        a[k] = v; changed.push(k);
      }
      a.editedBy = me; a.editedAt = nowISO();
      return a;
    }, { who: me, action: "assignment." + method.toLowerCase(), target: seg[1], detail: changed.join(", ") });
    if (!result) return json(res, 404, { error: "no such assignment" });
    return ok(res, { assignment: result, changed });
  }

  /* --- escalations ----------------------------------------------------- */
  if (seg[0] === "escalations" && !seg[1] && method === "POST") {
    const body = await readBody(req);
    const { patch, bad: badFields } = validate(body, ESCALATION_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    const projectId = String(body.projectId || "");
    if (!patch.reason) return bad(res, "An escalation needs a reason.");
    let error = null;
    const created = await store.mutate((d) => {
      const p = d.projects.find((x) => x.id === projectId);
      if (!p) { error = "no such project"; return null; }
      const e = {
        id: uid("esc"), projectId, reason: patch.reason, severity: patch.severity || "medium",
        owner: patch.owner || p.primaryDm || "", raisedBy: me, raisedAt: nowISO(), raisedOn: today,
        resolutionTarget: patch.resolutionTarget || null, status: "open",
        blocker: patch.blocker || "", nextAction: patch.nextAction || "", nextActionOwner: patch.nextActionOwner || "",
        comments: [], resolvedAt: null, resolution: "", history: [],
      };
      d.escalations.push(e);
      return e;
    }, { who: me, action: "escalation.raise", target: projectId, detail: patch.severity || "medium" });
    if (error) return json(res, 404, { error });
    return ok(res, { escalation: created });
  }

  if (seg[0] === "escalations" && seg[1] && seg[2] === "comments" && method === "POST") {
    const body = await readBody(req);
    const text = String(body.text || "").trim().slice(0, 2000);
    if (!text) return bad(res, "An empty comment is not a comment.");
    const result = await store.mutate((d) => {
      const e = d.escalations.find((x) => x.id === seg[1]);
      if (!e) return null;
      e.comments.push({ id: uid("c"), at: nowISO(), by: me, text });
      return e;
    }, { who: me, action: "escalation.comment", target: seg[1] });
    if (!result) return json(res, 404, { error: "no such escalation" });
    return ok(res, { escalation: result });
  }

  if (seg[0] === "escalations" && seg[1] && method === "PATCH") {
    const body = await readBody(req);
    const { patch, bad: badFields } = validate(body, ESCALATION_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    const changed = [];
    const result = await store.mutate((d) => {
      const e = d.escalations.find((x) => x.id === seg[1]);
      if (!e) return null;
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(e[k]) === JSON.stringify(v)) continue;
        pushHistory(e, { at: nowISO(), by: me, field: k, from: e[k], to: v });
        e[k] = v; changed.push(k);
      }
      if (patch.status === "resolved" && !e.resolvedAt) { e.resolvedAt = nowISO(); e.resolvedBy = me; }
      if (patch.status && patch.status !== "resolved") { e.resolvedAt = null; e.resolvedBy = null; }
      return e;
    }, { who: me, action: "escalation.update", target: seg[1], detail: changed.join(", ") });
    if (!result) return json(res, 404, { error: "no such escalation" });
    return ok(res, { escalation: result, changed });
  }

  /* --- status updates -------------------------------------------------- */
  if (seg[0] === "updates" && !seg[1] && method === "POST") {
    const body = await readBody(req);
    const { patch, bad: badFields } = validate(body, UPDATE_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    const text = (patch.completed || patch.text || "").trim();
    if (!text && !patch.draft) return bad(res, "An update needs to say what was completed.");
    if (!patch.projectId) return bad(res, "Pick a project.");
    let error = null;
    const created = await store.mutate((d) => {
      const p = d.projects.find((x) => x.id === patch.projectId);
      if (!p) { error = "no such project"; return null; }
      const u = {
        id: uid("upd"), projectId: p.id, author: me, role: "",
        date: patch.date || today, dateLabel: "", status: patch.status || "",
        text: text.slice(0, 4000), completed: text.slice(0, 4000), planned: patch.planned || "",
        milestoneId: patch.milestoneId || "", progressNote: patch.progressNote || "", scopeCompleted: patch.scopeCompleted || "",
        blockers: patch.blockers || "", dependencyOwner: patch.dependencyOwner || "",
        nextAction: patch.nextAction || "", nextActionOwner: patch.nextActionOwner || "",
        expectedResolution: patch.expectedResolution || null,
        nextMilestoneId: patch.nextMilestoneId || "", nextMilestoneDate: patch.nextMilestoneDate || null,
        forecastDelivery: patch.forecastDelivery || null, eta: patch.eta || patch.nextMilestoneDate || "",
        escalationRequired: !!patch.escalationRequired, escalationReason: patch.escalationReason || "", escalationSeverity: patch.escalationSeverity || "",
        draft: !!patch.draft, createdAt: nowISO(), seeded: false,
      };
      d.updates.unshift(u);
      if (!u.draft) applyUpdateSideEffects(d, p, u, me, today);
      return u;
    }, { who: me, action: patch.draft ? "update.draft" : "update.post", target: patch.projectId });
    if (error) return json(res, 404, { error });
    return ok(res, { update: created });
  }

  if (seg[0] === "updates" && seg[1] && method === "PATCH") {
    const body = await readBody(req);
    const { patch, bad: badFields } = validate(body, UPDATE_SPEC);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    let error = null;
    const result = await store.mutate((d) => {
      const u = d.updates.find((x) => x.id === seg[1]);
      if (!u) { error = 404; return null; }
      if (u.author !== me) { error = "that is someone else's update"; return null; }
      if (!u.draft && "draft" in patch) { error = "a submitted update cannot go back to draft"; return null; }
      const wasDraft = u.draft;
      for (const [k, v] of Object.entries(patch)) {
        if (k === "projectId") continue;
        if (k === "completed" || k === "text") { u.text = v; u.completed = v; continue; }
        u[k] = v;
      }
      if ("nextMilestoneDate" in patch) u.eta = patch.nextMilestoneDate || "";
      u.editedAt = nowISO();
      if (wasDraft && u.draft === false) {
        if (!u.text) { error = "Say what was completed before submitting."; u.draft = true; return null; }
        const p = d.projects.find((x) => x.id === u.projectId);
        if (p) applyUpdateSideEffects(d, p, u, me, today);
      }
      return u;
    }, { who: me, action: "update.edit", target: seg[1] });
    if (error === 404) return json(res, 404, { error: "no such update" });
    if (error) return json(res, 403, { error });
    return ok(res, { update: result });
  }

  if (seg[0] === "updates" && seg[1] && method === "DELETE") {
    const removed = await store.mutate((d) => {
      const i = d.updates.findIndex((u) => u.id === seg[1]);
      if (i < 0) return null;
      const u = d.updates[i];
      if (u.author !== me && !u.seeded && !u.imported) return "forbidden";
      return d.updates.splice(i, 1)[0];
    }, { who: me, action: "update.delete", target: seg[1] });
    if (removed === "forbidden") return json(res, 403, { error: "that is someone else's update" });
    if (!removed) return json(res, 404, { error: "no such update" });
    return ok(res);
  }

  /* --- the sheet ------------------------------------------------------- */
  if (seg[0] === "import" && seg[1] === "sheet" && method === "POST") {
    const body = await readBody(req, MAX_IMPORT);
    const tsv = String(body.tsv || "");
    if (!tsv.trim()) return bad(res, "Paste the sheet first.");
    const decisions = body.decisions && typeof body.decisions === "object" ? body.decisions : {};
    try {
      if (!body.commit) {
        return json(res, 200, { ok: true, preview: sheet.preview(store.snapshot(), tsv, decisions, today) });
      }
      let outcome = null;
      await store.mutate((d) => { outcome = sheet.apply(d, tsv, decisions, me, today, uid); return outcome; },
        (r) => ({ who: me, action: "import.sheet", detail: r ? JSON.stringify(r.counts) : "" }));
      return ok(res, { result: outcome });
    } catch (err) {
      return json(res, err.code === 409 ? 409 : 400, { error: err.message });
    }
  }

  /* --- settings, people, revenue --------------------------------------- */
  if (seg[0] === "settings" && method === "PATCH") {
    const body = await readBody(req);
    const saved = await store.mutate((d) => {
      Object.entries(body).forEach(([k, v]) => {
        if (k === "lastImport") return;
        if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") d.settings[k] = v;
        else if (k === "workingDays" && Array.isArray(v)) d.settings.workingDays = v.map(Number).filter((n) => n >= 0 && n <= 6);
        else if (k === "holidays" && Array.isArray(v)) d.settings.holidays = v.filter(isISO);
        else if (k === "milestoneTemplate" && Array.isArray(v)) {
          d.settings.milestoneTemplate = v
            .map((t) => ({ stage: String(t.stage || "custom").slice(0, 40), title: String(t.title || "").slice(0, 120),
              durationDays: Math.max(1, Number(t.durationDays) || 1), ownerType: OWNER_TYPES.includes(t.ownerType) ? t.ownerType : "DM" }))
            .filter((t) => t.title);
        }
      });
      return d.settings;
    }, { who: me, action: "settings.update", detail: Object.keys(body).join(", ") });
    return ok(res, { settings: saved });
  }

  if (seg[0] === "people" && method === "PATCH") {
    const body = await readBody(req);
    const spec = { title: V.str(80), active: V.bool(), capacityHoursPerWeek: V.num(0, 100), skills: V.list(40), roles: V.list(20) };
    const { patch, bad: badFields } = validate(body, spec);
    if (badFields.length) return bad(res, `These fields did not validate: ${badFields.join(", ")}`, { fields: badFields });
    if ("availability" in body) {
      const a = body.availability || {};
      if (!["available", "limited", "out"].includes(a.status)) return bad(res, "availability.status must be available, limited or out");
      patch.availability = { status: a.status, fraction: a.status === "limited" ? Math.min(0.95, Math.max(0.05, Number(a.fraction) || 0.5)) : null, until: isISO(a.until) ? a.until : null };
    }
    const saved = await store.mutate((d) => {
      let p = d.people.find((x) => x.id === body.id);
      if (!p && body.name) {
        const id = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        p = d.people.find((x) => x.id === id);
        if (!p) { p = { id, name: String(body.name).trim().slice(0, 60), roles: patch.roles || ["editor"], pods: [], active: true, title: "", capacityHoursPerWeek: null, skills: [], availability: { status: "available", fraction: null, until: null } }; d.people.push(p); }
      }
      if (!p) return null;
      Object.assign(p, patch);
      return p;
    }, { who: me, action: "people.update", target: body.id || body.name });
    if (!saved) return json(res, 404, { error: "no such person" });
    return ok(res, { person: saved });
  }

  if (seg[0] === "revenue" && method === "PATCH") {
    const body = await readBody(req);
    const saved = await store.mutate((d) => {
      const r = d.revenue.find((x) => x.clientKey === body.clientKey || x.id === body.id);
      if (!r) return null;
      if ("amount" in body) r.amount = Number(body.amount) || 0;
      if ("unmapped" in body) r.unmapped = !!body.unmapped;
      r.editedBy = me;
      return r;
    }, { who: me, action: "revenue.update", target: body.clientKey || body.id });
    if (!saved) return json(res, 404, { error: "no such client" });
    return ok(res, { revenue: saved });
  }

  return json(res, 404, { error: "unknown endpoint: " + url.pathname });
}

/** What a submitted update changes beyond the feed: milestone progress, the
    next-milestone promise, and an escalation if the DM asked for one. */
function applyUpdateSideEffects(d, p, u, me, today) {
  if (u.milestoneId) {
    const m = d.milestones.find((x) => x.id === u.milestoneId && x.projectId === p.id);
    if (m && m.status === "planned" && !m.actualDone) { m.status = "in_progress"; m.actualStart = m.actualStart || u.date || today; }
  }
  if (u.nextMilestoneId && u.nextMilestoneDate) {
    const m = d.milestones.find((x) => x.id === u.nextMilestoneId && x.projectId === p.id);
    if (m && !m.actualDone && m.ownerEta !== u.nextMilestoneDate) {
      pushHistory(m, { at: nowISO(), by: me, field: "ownerEta", from: m.ownerEta, to: u.nextMilestoneDate, reason: "from the daily update", today });
      m.ownerEta = u.nextMilestoneDate;
    }
  }
  if (u.forecastDelivery && !p.openEnded) {
    // A DM's forecast for the whole project is recorded as a note on the
    // latest update; the committed date is never moved by an update.
    p.lastForecastByDm = { date: u.forecastDelivery, by: me, at: nowISO() };
  }
  if (u.escalationRequired && u.escalationReason) {
    const open = d.escalations.find((e) => e.projectId === p.id && e.status !== "resolved" && e.reason === u.escalationReason);
    if (!open) {
      d.escalations.push({
        id: uid("esc"), projectId: p.id, reason: u.escalationReason, severity: u.escalationSeverity || "medium",
        owner: u.nextActionOwner || p.primaryDm || me, raisedBy: me, raisedAt: nowISO(), raisedOn: today,
        resolutionTarget: u.expectedResolution || null, status: "open", blocker: u.blockers || "",
        nextAction: u.nextAction || "", nextActionOwner: u.nextActionOwner || "", comments: [], resolvedAt: null, resolution: "", history: [],
        fromUpdate: u.id,
      });
    }
  }
}

/* ------------------------------------------------------------------ serve */

/** Read an application/x-www-form-urlencoded body (the login form posts one). */
function readForm(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 4096) { reject(new Error("too large")); req.destroy(); }
    });
    req.on("end", () => resolve(new URLSearchParams(raw)));
    req.on("error", reject);
  });
}

/* Once per instance: take the session key the store keeps for us, so a second
   copy of this process signs the same cookies. On a disk-backed run there is
   nothing to fetch and auth falls back to DATA_DIR exactly as before. */
let prepared = null;
function prepare() {
  if (!prepared) {
    prepared = store.sessionSecret()
      .then((key) => { if (key) auth.useSecret(key); })
      .catch((err) => { prepared = null; throw err; });
  }
  return prepared;
}

/* Two ways a deploy on a public host is not finished, both of which we can
   name exactly: no password, which would hand the client book to anyone who
   found the URL, and no store, which leaves the board nowhere to live. Saying
   which beats a warning in a log nobody is watching. */
function deployGaps() {
  const gaps = [];
  if (!auth.isEnabled()) {
    gaps.push({
      text: "Settings → Environment Variables: set the full-access password.",
      code: "TFOPS_PASSWORD = a long phrase only the delivery team knows",
    }, {
      text: "Optionally, the read-only one for leadership:",
      code: "TFOPS_VIEW_PASSWORD = a different phrase",
    });
  }
  if (store.backend !== "redis") {
    gaps.push({
      text: "Storage → Create Database → Upstash Redis, connected to this project. "
          + "That sets the two credentials the board reads:",
      code: "KV_REST_API_URL\nKV_REST_API_TOKEN",
    });
  }
  if (gaps.length) {
    gaps.push("Redeploy. Environment variables only reach a new deployment.");
    gaps.push({
      text: "Then send the board up, from the machine that has data/store.json:",
      code: "node tools/remote.js push",
    });
  }
  return gaps;
}

const setupNotice = (gaps) => noticePage({
  title: "This deploy is not finished yet",
  lead: !auth.isEnabled()
    ? "It is on the public internet with no password set, so the board is not being served."
    : "There is nowhere for the board to live on this host yet, so it is not being served.",
  tone: "stop",
  steps: gaps,
});

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const html = { "content-type": "text/html; charset=utf-8" };

  await prepare();

  if (SERVERLESS) {
    const gaps = deployGaps();
    if (gaps.length) {
      if (url.pathname.startsWith("/api/")) {
        return json(res, 503, {
          error: !auth.isEnabled()
            ? "No password is set on this deploy, so the board is not being served."
            : "This deploy has no store attached, so there is no board to read.",
        });
      }
      return send(res, 503, setupNotice(gaps), html);
    }
  }

  /* --- login, logout ---------------------------------------------------- */
  if (url.pathname === "/login") {
    if (!auth.isEnabled()) return send(res, 302, "", { location: "/" });
    await store.ready();
    const data = store.snapshot();
    const page = (extra) => loginPage({
      orgName: data.settings.orgName,
      admin: data.settings.adminName || "your admin",
      names: data.people.map((p) => p.name),
      ...extra,
    });

    if (req.method === "GET") {
      if (session(req)) return send(res, 302, "", { location: "/" });
      return send(res, 200, page({ name: who(req) }), html);
    }
    if (req.method === "POST") {
      return readForm(req)
        .then((form) => {
          const name = String(form.get("name") || "").trim().slice(0, 60);
          const role = auth.roleFor(form.get("password") || "");
          if (name.length < 2) {
            return send(res, 400, page({ error: "Put your name in so your posts are signed.", name }), html);
          }
          if (!role) {
            return send(res, 401, page({ error: "That password is not right. Check with your admin.", name }), html);
          }
          // Two cookies: the signed session grants access, the name only signs posts.
          send(res, 302, "", {
            location: "/",
            "set-cookie": [
              setCookie(auth.COOKIE, auth.issue(role, store.DATA_DIR), auth.TTL_DAYS, true),
              setCookie("tfops_user", name),
            ],
          });
        })
        .catch(() => send(res, 400, "bad request"));
    }
  }

  if (url.pathname === "/logout") {
    return send(res, 302, "", {
      location: "/login",
      "set-cookie": `${auth.COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`,
    });
  }

  /* --- everything else needs a session ---------------------------------- */
  const sess = session(req);
  if (!sess) {
    if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "Signed out", login: true });
    return send(res, 302, "", { location: "/login" });
  }
  // Read-only sessions may still say who they are — it only sets a display-name
  // cookie, and it makes their presence legible if they do escalate something.
  if (sess.role === "view" && MUTATING.has(req.method) && url.pathname !== "/api/me") {
    return json(res, 403, { error: "You are signed in with the read-only password." });
  }

  if (url.pathname.startsWith("/api/")) {
    // Awaited, not fired off: on a serverless host the request is not finished
    // until this is, and the wrapper below owns the failure case.
    return api(req, res, url, sess);
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
  return serveStatic(req, res, url.pathname);
}

/** What both hosts call. Anything thrown above lands here, once, as a page or
    as JSON — never as a dead socket and never as a stack trace in the body. */
function handler(req, res) {
  handle(req, res).catch((err) => {
    console.error("request failed:", err.message);
    if (res.headersSent) return res.end();
    const message = err.message || "server error";
    if ((req.url || "").startsWith("/api/")) return json(res, 500, { error: message });
    send(res, 500, noticePage({
      title: "The board is not there",
      lead: message,
      tone: "stop",
      steps: store.backend === "redis"
        ? [{ text: "If the store is empty, push the board up from the machine that has it:",
             code: "node tools/remote.js push" }]
        : [{ text: "Build the board from the sheet export:", code: "node lib/seed.js" }],
    }), { "content-type": "text/html; charset=utf-8" });
  });
}

module.exports = handler;

/* Run directly — a laptop, a VPS, a container. Under Vercel this file is only
   ever imported, so nothing below runs there. */
if (require.main === module) {
  const server = http.createServer(handler);

  server.listen(PORT, HOST, async () => {
    const nets = require("os").networkInterfaces();
    const lan = Object.values(nets).flat()
      .filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);
    console.log(`\n  TFOps dashboard`);
    try {
      const data = await store.ready();
      console.log(`  ${data.projects.length} projects · ${data.revenue.length} clients`
        + ` · ${data.people.length} people · v${data.version} · schema ${data.schema}`);
    } catch (err) {
      console.log(`  ⚠  ${err.message}`);
    }
    console.log(`  Data      ${store.describe()}`);
    console.log(`\n  Local     http://localhost:${PORT}`);
    lan.forEach((ip) => console.log(`  Team      http://${ip}:${PORT}`));

    if (auth.isEnabled()) {
      console.log(`\n  Login is ON`
        + (process.env.TFOPS_PASSWORD ? " · full-access password set" : "")
        + (process.env.TFOPS_VIEW_PASSWORD ? " · read-only password set" : ""));
      if (!TRUST_PROXY) {
        console.log(`  Set TRUST_PROXY=1 when you put this behind HTTPS, so cookies are marked Secure.`);
      }
    } else {
      console.log(`\n  ⚠  NO PASSWORD SET — anyone who can reach this port can read and edit`);
      console.log(`     the whole board, revenue included. Fine on your own machine or a`);
      console.log(`     trusted LAN. Before putting it on the internet, set:`);
      console.log(`       TFOPS_PASSWORD=...  and optionally  TFOPS_VIEW_PASSWORD=...`);
    }
    console.log("");
  });

  /* Finish in-flight writes before the process goes away. */
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`\n  ${sig} — shutting down.`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}
