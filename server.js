"use strict";
/* TFOps dashboard server — no dependencies, `node server.js` and you are up.
   Serves public/ and a small JSON API over data/store.json.

   Env:
     PORT                 (default 8848)
     HOST                 (default 0.0.0.0 — so the team can reach it on the LAN)
     DATA_DIR             where store.json lives (default ./data)
     TFOPS_PASSWORD       full-access password; setting it turns on the login
     TFOPS_VIEW_PASSWORD  read-only password for leadership
     TFOPS_SECRET         session signing key (otherwise generated into DATA_DIR)
     TRUST_PROXY=1        behind an HTTPS proxy — issue Secure cookies

   With no password set the board runs open, which is fine on a LAN and not
   fine on the internet; the server says so loudly at startup. */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./lib/store");
const auth = require("./lib/auth");
const loginPage = require("./lib/login-page");

const PORT = Number(process.env.PORT || 8848);
const HOST = process.env.HOST || "0.0.0.0";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const PUBLIC = path.join(__dirname, "public");
const MAX_BODY = 1_000_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
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

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = decodeURIComponent(rel).replace(/\\/g, "/");
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // Unknown path inside the app → let the client router handle it.
      if (!path.extname(rel)) return serveStatic(req, res, "/");
      return send(res, 404, "not found");
    }
    const etag = `"${st.size}-${st.mtimeMs}"`;
    if (req.headers["if-none-match"] === etag) return send(res, 304, "");
    send(res, 200, fs.readFileSync(file), {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      etag,
    });
  });
}

/* -------------------------------------------------------------------- api */

const ok = (res, extra = {}) =>
  json(res, 200, { ok: true, version: store.snapshot().version, ...extra });

const PROJECT_FIELDS = [
  "client", "projectName", "label", "dms", "editorLeads", "editorTagging",
  "podOwner", "sdm", "priority", "status", "categories", "scope",
  "completedFromScope", "waGroupLink", "start", "end", "startNote", "endNote",
  "openEnded", "progress", "health", "datesUnknown", "effort",
];

async function api(req, res, url, sess = { role: "edit" }) {
  const seg = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method.toUpperCase();
  const me = who(req);

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
    return json(res, 200, { ...data, me, role: sess.role, openAccess: !!sess.open });
  }

  if (seg[0] === "version" && method === "GET") {
    return json(res, 200, { version: store.snapshot().version, updatedAt: store.snapshot().updatedAt });
  }

  if (!me) return json(res, 401, { error: "Pick who you are first." });

  /* --- projects ------------------------------------------------------- */
  if (seg[0] === "projects" && seg[1] && method === "PATCH") {
    const body = await readBody(req);
    const changed = [];
    const result = await store.mutate((d) => {
      const p = d.projects.find((x) => x.id === seg[1]);
      if (!p) return null;
      for (const k of PROJECT_FIELDS) {
        if (!(k in body)) continue;
        const before = JSON.stringify(p[k]);
        const after = JSON.stringify(body[k]);
        if (before === after) continue;
        p[k] = body[k];
        changed.push(k);
      }
      p.editedBy = me;
      p.editedAt = new Date().toISOString();
      return p;
    }, () => ({ who: me, action: "project.update", target: seg[1], detail: changed.join(", ") }));
    if (!result) return json(res, 404, { error: "no such project" });
    return ok(res, { project: result });
  }

  if (seg[0] === "projects" && method === "POST") {
    const body = await readBody(req);
    const client = String(body.client || "").trim();
    if (!client) return json(res, 400, { error: "client is required" });
    const created = await store.mutate((d) => {
      const p = {
        id: uid("proj"),
        client,
        clientKey: client.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        projectName: String(body.projectName || "").trim(),
        label: [client, body.projectName].filter(Boolean).join(" — "),
        dms: body.dms || [], editorLeads: body.editorLeads || [], editorTagging: "",
        podOwner: body.podOwner || "", sdm: body.sdm || "",
        priority: body.priority || "", status: body.status || "Upcoming",
        categories: body.categories || [], scope: body.scope || "",
        completedFromScope: "", waGroupLink: "",
        start: body.start || null, end: body.end || null,
        startNote: "", endNote: "", openEnded: false, datesUnknown: false,
        progress: null, health: "", createdBy: me, createdAt: new Date().toISOString(),
      };
      d.projects.push(p);
      return p;
    }, { who: me, action: "project.create", target: client });
    return ok(res, { project: created });
  }

  /* --- status updates -------------------------------------------------- */
  if (seg[0] === "updates" && method === "POST") {
    const body = await readBody(req);
    const text = String(body.text || "").trim();
    if (!text) return json(res, 400, { error: "an update needs some text" });
    const created = await store.mutate((d) => {
      const u = {
        id: uid("upd"),
        projectId: String(body.projectId || ""),
        author: me,
        role: String(body.role || "").slice(0, 30),
        date: String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
        dateLabel: "",
        status: String(body.status || "").slice(0, 30),
        text: text.slice(0, 4000),
        blockers: String(body.blockers || "").slice(0, 2000),
        eta: String(body.eta || "").slice(0, 10),
        createdAt: new Date().toISOString(),
        seeded: false,
      };
      d.updates.unshift(u);
      return u;
    }, { who: me, action: "update.post", target: body.projectId || "(general)" });
    return ok(res, { update: created });
  }

  if (seg[0] === "updates" && seg[1] && method === "DELETE") {
    const removed = await store.mutate((d) => {
      const i = d.updates.findIndex((u) => u.id === seg[1]);
      if (i < 0) return null;
      if (d.updates[i].author !== me && !d.updates[i].seeded) return "forbidden";
      return d.updates.splice(i, 1)[0];
    }, { who: me, action: "update.delete", target: seg[1] });
    if (removed === "forbidden") return json(res, 403, { error: "that is someone else's update" });
    if (!removed) return json(res, 404, { error: "no such update" });
    return ok(res);
  }

  /* --- milestones ------------------------------------------------------ */
  if (seg[0] === "milestones" && method === "POST") {
    const body = await readBody(req);
    const created = await store.mutate((d) => {
      const m = {
        id: uid("ms"),
        projectId: String(body.projectId || ""),
        title: String(body.title || "Milestone").slice(0, 160),
        date: String(body.date || "").slice(0, 10),
        done: !!body.done,
        owner: String(body.owner || me).slice(0, 60),
        createdBy: me,
      };
      d.milestones.push(m);
      return m;
    }, { who: me, action: "milestone.create", target: body.projectId });
    return ok(res, { milestone: created });
  }

  if (seg[0] === "milestones" && seg[1] && (method === "PATCH" || method === "DELETE")) {
    const body = method === "PATCH" ? await readBody(req) : {};
    const result = await store.mutate((d) => {
      const i = d.milestones.findIndex((m) => m.id === seg[1]);
      if (i < 0) return null;
      if (method === "DELETE") return d.milestones.splice(i, 1)[0];
      const m = d.milestones[i];
      ["title", "date", "done", "owner"].forEach((k) => { if (k in body) m[k] = body[k]; });
      return m;
    }, { who: me, action: "milestone." + method.toLowerCase(), target: seg[1] });
    if (!result) return json(res, 404, { error: "no such milestone" });
    return ok(res, { milestone: result });
  }

  /* --- settings, people, revenue --------------------------------------- */
  if (seg[0] === "settings" && method === "PATCH") {
    const body = await readBody(req);
    const saved = await store.mutate((d) => {
      Object.entries(body).forEach(([k, v]) => {
        if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") d.settings[k] = v;
      });
      return d.settings;
    }, { who: me, action: "settings.update", detail: Object.keys(body).join(", ") });
    return ok(res, { settings: saved });
  }

  if (seg[0] === "people" && method === "PATCH") {
    const body = await readBody(req);
    const saved = await store.mutate((d) => {
      const p = d.people.find((x) => x.id === body.id);
      if (!p) return null;
      ["capacity", "active", "title"].forEach((k) => { if (k in body) p[k] = body[k]; });
      return p;
    }, { who: me, action: "people.update", target: body.id });
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const html = { "content-type": "text/html; charset=utf-8" };

  /* --- login, logout ---------------------------------------------------- */
  if (url.pathname === "/login") {
    if (!auth.isEnabled()) return send(res, 302, "", { location: "/" });
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
    Promise.resolve()
      .then(() => api(req, res, url, sess))
      .catch((err) => {
        console.error("api error:", err);
        if (!res.headersSent) json(res, 500, { error: err.message || "server error" });
      });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const data = store.snapshot();
  const nets = require("os").networkInterfaces();
  const lan = Object.values(nets).flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);
  console.log(`\n  TFOps dashboard`);
  console.log(`  ${data.projects.length} projects · ${data.revenue.length} clients · ${data.people.length} people · v${data.version}`);
  console.log(`  Data      ${store.FILE}`);
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
