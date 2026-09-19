"use strict";
/* Single-file JSON store with atomic writes and a serialised write queue.
   Sized for a few dozen people on one board — everything lives in memory and
   the file on disk is the durable copy. Every mutation bumps `version`, which
   is what the browsers poll on to know they are stale. */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// DATA_DIR lets a hosted deploy point at a mounted volume instead of the repo.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
const FILE = path.join(DATA_DIR, "store.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const MAX_AUDIT = 2000;

let cache = null;
let writing = Promise.resolve();
let lastBackupDay = "";

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

/** Apply `fn` to the store, persist, and resolve with whatever `fn` returns.
    `audit` may be a function, so callers can describe what actually changed
    rather than what they intended to change. */
function mutate(fn, audit) {
  const run = writing.then(() => {
    const data = load();
    const result = fn(data);
    data.version = (data.version || 0) + 1;
    data.updatedAt = new Date().toISOString();
    const entry = typeof audit === "function" ? audit(result) : audit;
    if (entry) {
      data.audit = data.audit || [];
      data.audit.unshift({ ts: data.updatedAt, v: data.version, ...entry });
      if (data.audit.length > MAX_AUDIT) data.audit.length = MAX_AUDIT;
    }
    writeNow(data);
    return result;
  });
  writing = run.catch(() => {});
  return run;
}

function snapshot() {
  return load();
}

module.exports = { load, mutate, snapshot, FILE, DATA_DIR };
