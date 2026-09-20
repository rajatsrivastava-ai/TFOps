"use strict";
/* The board, kept in Upstash Redis instead of on a disk.

   Vercel gives a function a read-only /var/task and throws the instance away
   afterwards, so the file store in store.js has nowhere to live there. This is
   the same board — one JSON document — parked behind a network call instead.

   Upstash was picked because it speaks plain HTTPS: no client library, so the
   "no dependencies" promise survives the move. Credentials arrive as env vars
   the moment you attach the store to the project; both namings are accepted
   because the Vercel integration and the Upstash one disagree about the prefix.

   Two keys:
     tfops:store   the whole board, gzipped and base64'd (~27 KB, not 220)
     tfops:meta    {"v":<version>,"t":<updatedAt>} — what the 12s poll reads,
                   and the token every write compares against so two people
                   saving at once cannot silently overwrite each other.

   Writes are a compare-and-set in Lua, which is the one thing a file rename
   gave us for free and a network store does not. */

const crypto = require("crypto");
const zlib = require("zlib");

const URL_ = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

const STORE = "tfops:store";
const META = "tfops:meta";
const SECRET = "tfops:secret";
const BACKUP_DAYS = 30;

const enabled = () => !!(URL_ && TOKEN);

/* --------------------------------------------------------------- transport */

async function send(body, at = "") {
  const res = await fetch(URL_ + at, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) {
    throw new Error(`the data store answered with something that is not JSON (${res.status})`);
  }
  if (!res.ok) throw new Error("data store: " + (parsed.error || res.status));
  return parsed;
}

/** One command. `["GET","tfops:store"]` → the value. */
async function command(...args) {
  const out = await send(args.map(String));
  if (out.error) throw new Error("data store: " + out.error);
  return out.result;
}

/** Several commands, one round trip. Returns their results in order.
    Upstash keeps this on its own path — the root takes a single command. */
async function pipeline(...commands) {
  const out = await send(commands.map((c) => c.map(String)), "/pipeline");
  return out.map((r) => {
    if (r.error) throw new Error("data store: " + r.error);
    return r.result;
  });
}

/* ------------------------------------------------------------- the payload */

/* Redis holds strings, so the board is gzipped and base64'd — a tenth of the
   bytes over the wire, and well clear of any per-value size ceiling. The
   prefix is there so a value written as plain JSON still reads back. */
const GZ = "gz:";
const pack = (data) => GZ + zlib.gzipSync(Buffer.from(JSON.stringify(data))).toString("base64");

function unpack(raw) {
  if (typeof raw !== "string") return null;
  const json = raw.startsWith(GZ)
    ? zlib.gunzipSync(Buffer.from(raw.slice(GZ.length), "base64")).toString("utf8")
    : raw;
  return JSON.parse(json);
}

const metaOf = (data) => JSON.stringify({ v: data.version || 0, t: data.updatedAt || "" });

/* ------------------------------------------------------------------ reading */

/** The whole board plus the meta string a later write must match.
    @returns {Promise<{data:object, meta:string}|null>} null when nothing is stored yet. */
async function read() {
  const [raw, meta] = await pipeline(["GET", STORE], ["GET", META]);
  if (raw == null) return null;
  const data = unpack(raw);
  // A board written before its meta, or by hand, still has the truth inside it.
  return { data, meta: meta == null ? metaOf(data) : meta };
}

/** Just the version counter — what the browsers poll. One small key, not 27 KB. */
async function version() {
  const meta = await command("GET", META);
  if (meta == null) return { version: 0, updatedAt: "" };
  try {
    const m = JSON.parse(meta);
    return { version: m.v || 0, updatedAt: m.t || "" };
  } catch (_) {
    return { version: 0, updatedAt: "" };
  }
}

/* ------------------------------------------------------------------ writing */

/* Set the board only if the meta key still reads what we saw when we loaded it.
   Redis runs this whole script alone, so the check and the write cannot be
   split by another instance landing between them. */
const CAS = `
if redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('SET', KEYS[2], ARGV[3])
  return 1
end
return 0`;

/** @returns {Promise<boolean>} false when someone else wrote first — caller re-reads and retries. */
async function commit(expectedMeta, data) {
  const applied = await command("EVAL", CAS, 2, STORE, META, expectedMeta, pack(data), metaOf(data));
  return applied === 1;
}

/** First write, or a deliberate overwrite from the laptop. No check. */
async function put(data) {
  await pipeline(["SET", STORE, pack(data)], ["SET", META, metaOf(data)]);
}

/** One snapshot a day, self-expiring after a month. NX so the first write wins. */
async function backup(day, data) {
  await command("SET", `tfops:backup:${day}`, pack(data), "NX", "EX", BACKUP_DAYS * 86400);
}

async function backups() {
  const keys = await command("KEYS", "tfops:backup:*");
  return (keys || []).map((k) => k.replace("tfops:backup:", "")).sort();
}

/** One day's snapshot, for getting a bad edit back. */
async function readBackup(day) {
  const raw = await command("GET", `tfops:backup:${day}`);
  return raw == null ? null : unpack(raw);
}

/* ------------------------------------------------------------------ secrets */

/* The session key cannot live on a read-only disk, and a per-instance random
   one would sign people out whenever Vercel started a second copy. Keep it
   next to the board, generated once, by whichever instance gets there first. */
async function sessionSecret() {
  const existing = await command("GET", SECRET);
  if (existing) return Buffer.from(existing, "base64");
  const fresh = crypto.randomBytes(32);
  await command("SET", SECRET, fresh.toString("base64"), "NX");
  const settled = await command("GET", SECRET);
  return Buffer.from(settled, "base64");
}

module.exports = { enabled, read, version, commit, put, backup, backups, readBackup, sessionSecret, command };
