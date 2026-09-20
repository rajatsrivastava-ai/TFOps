"use strict";
/* The board, and the two places it can live.

   On a machine with a disk — your laptop, a VPS, Render — it is a single JSON
   file with atomic writes and a serialised write queue. Everything lives in
   memory and the file is the durable copy.

   On a serverless host there is no disk worth writing to and no single process,
   so the same document goes to Upstash Redis instead (lib/remote.js). That
   backend turns on by itself when its credentials are in the environment.

   Either way the shape is the same: `ready()` makes the board current,
   `snapshot()` hands it over, `mutate()` changes it. Every mutation bumps
   `version`, which is what the browsers poll on to know they are stale. */

const fs = require("fs");
const path = require("path");
const remote = require("./remote");

const ROOT = path.join(__dirname, "..");
// DATA_DIR lets a hosted deploy point at a mounted volume instead of the repo.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
const FILE = path.join(DATA_DIR, "store.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const MAX_AUDIT = 2000;
const RETRIES = 6;

const backend = remote.enabled() ? "redis" : "file";

const EMPTY_REMOTE =
  "the remote board is empty. From the machine that has data/store.json, run:  node tools/remote.js push";

let cache = null;
let writing = Promise.resolve();
let lastBackupDay = "";

/* ------------------------------------------------------------------- file */

function load() {
  if (cache) return cache;
  if (!fs.existsSync(FILE)) {
    throw new Error(`${FILE} is missing. Run:  node lib/seed.js`);
  }
  cache = JSON.parse(fs.readFileSync(FILE, "utf8"));
  return cache;
}

function writeNow(data) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
  dailyBackup(data);
}

/* One snapshot per day, keep the last 30. Cheap insurance against a bad edit. */
function dailyBackup(data) {
  const day = new Date().toISOString().slice(0, 10);
  if (day === lastBackupDay) return;
  lastBackupDay = day;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(path.join(BACKUP_DIR, `store-${day}.json`), JSON.stringify(data));
    const keep = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json")).sort();
    keep.slice(0, Math.max(0, keep.length - 30))
      .forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch (e) {
    console.warn("backup skipped:", e.message);
  }
}

/* ----------------------------------------------------------------- shared */

/** Stamp a finished mutation: new version, new timestamp, one audit line. */
function stamp(data, result, audit) {
  data.version = (data.version || 0) + 1;
  data.updatedAt = new Date().toISOString();
  const entry = typeof audit === "function" ? audit(result) : audit;
  if (entry) {
    data.audit = data.audit || [];
    data.audit.unshift({ ts: data.updatedAt, v: data.version, ...entry });
    if (data.audit.length > MAX_AUDIT) data.audit.length = MAX_AUDIT;
  }
}

/** Make the in-memory board current. Sync-cheap on a disk; one read on Redis. */
async function ready() {
  if (backend === "file") return load();
  const got = await remote.read();
  if (!got) throw new Error(EMPTY_REMOTE);
  cache = got.data;
  return cache;
}

/** The board as of the last `ready()`. Sync, because every view wants it inline. */
function snapshot() {
  if (backend === "file") return load();
  if (!cache) throw new Error("the board has not been loaded yet");
  return cache;
}

/** Just the counter the browsers poll on — on Redis this reads one tiny key. */
async function version() {
  if (backend === "file") {
    const d = load();
    return { version: d.version, updatedAt: d.updatedAt };
  }
  return remote.version();
}

/** Apply `fn` to the store, persist, and resolve with whatever `fn` returns.
    `audit` may be a function, so callers can describe what actually changed
    rather than what they intended to change. */
function mutate(fn, audit) {
  const run = writing.then(() => (backend === "file" ? mutateFile(fn, audit) : mutateRemote(fn, audit)));
  writing = run.catch(() => {});
  return run;
}

function mutateFile(fn, audit) {
  const data = load();
  const result = fn(data);
  stamp(data, result, audit);
  writeNow(data);
  return result;
}

/* Read, apply, write-if-unchanged. Another instance committing between our read
   and our write costs a retry, not someone's edit. */
async function mutateRemote(fn, audit) {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const got = await remote.read();
    if (!got) throw new Error(EMPTY_REMOTE);
    const result = fn(got.data);
    stamp(got.data, result, audit);
    if (await remote.commit(got.meta, got.data)) {
      cache = got.data;
      await dailyBackupRemote(got.data);
      return result;
    }
  }
  throw new Error("the board is being edited from several places at once — try that again");
}

async function dailyBackupRemote(data) {
  const day = new Date().toISOString().slice(0, 10);
  if (day === lastBackupDay) return;
  lastBackupDay = day;
  try {
    await remote.backup(day, data);
  } catch (e) {
    console.warn("backup skipped:", e.message);
  }
}

/** The session signing key, when the backend has somewhere safe to keep one. */
async function sessionSecret() {
  return backend === "redis" ? remote.sessionSecret() : null;
}

/** For the startup banner and the error pages: where the board actually is. */
const describe = () => (backend === "file" ? FILE : "Upstash Redis");

module.exports = {
  load, ready, mutate, snapshot, version, sessionSecret,
  backend, describe, FILE, DATA_DIR,
};
