"use strict";
/* Session auth with no dependencies.

   Two passwords, because they are two different jobs:
     TFOPS_PASSWORD       full access — the delivery team, who edit
     TFOPS_VIEW_PASSWORD  read-only — leadership who should never fat-finger a date

   A session is `base64url(payload).hmac`. The secret lives in the data dir and
   is generated once, so sessions survive a restart but not a re-deploy onto a
   fresh disk. Passwords are compared in constant time.

   This is a small internal-tool auth layer: one shared secret per role, no user
   accounts. Good enough behind a login for a 40-person team; not a substitute
   for SSO if this ever holds anything regulated. */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TTL_DAYS = 30;
const COOKIE = "tfops_session";

let secret = null;

function getSecret(dataDir) {
  if (secret) return secret;
  if (process.env.TFOPS_SECRET) {
    secret = Buffer.from(process.env.TFOPS_SECRET);
    return secret;
  }
  const file = path.join(dataDir, ".session-secret");
  try {
    secret = fs.readFileSync(file);
  } catch (_) {
    secret = crypto.randomBytes(32);
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, secret, { mode: 0o600 });
    } catch (e) {
      console.warn("could not persist session secret — logins will drop on restart:", e.message);
    }
  }
  return secret;
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (data, key) => crypto.createHmac("sha256", key).update(data).digest("base64url");

function equal(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch, so hash first to fix the length.
  const ha = crypto.createHash("sha256").update(A).digest();
  const hb = crypto.createHash("sha256").update(B).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function issue(role, dataDir) {
  const payload = b64(JSON.stringify({ role, exp: Date.now() + TTL_DAYS * 86400000 }));
  return `${payload}.${sign(payload, getSecret(dataDir))}`;
}

/** @returns {{role:"edit"|"view"}|null} */
function verify(token, dataDir) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot), mac = token.slice(dot + 1);
  const expected = sign(payload, getSecret(dataDir));
  if (mac.length !== expected.length || !equal(mac, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Date.now()) return null;
    if (data.role !== "edit" && data.role !== "view") return null;
    return { role: data.role };
  } catch (_) {
    return null;
  }
}

/** Which role, if any, this password unlocks. */
function roleFor(password) {
  const edit = process.env.TFOPS_PASSWORD || "";
  const view = process.env.TFOPS_VIEW_PASSWORD || "";
  if (edit && equal(password, edit)) return "edit";
  if (view && equal(password, view)) return "view";
  return null;
}

const isEnabled = () => !!(process.env.TFOPS_PASSWORD || process.env.TFOPS_VIEW_PASSWORD);

module.exports = { issue, verify, roleFor, isEnabled, COOKIE, TTL_DAYS };
