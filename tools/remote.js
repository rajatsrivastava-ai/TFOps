"use strict";
/* Move the board between this machine and the hosted store.

     node tools/remote.js info                 what is up there
     node tools/remote.js push                 send data/store.json up
     node tools/remote.js pull                 bring it back down
     node tools/remote.js pull --day=2026-09-20   bring back a daily snapshot

   Restoring is a pull of the day you want followed by `push --force`.

   Credentials come from the environment, or from a .env file next to this
   repo — which is gitignored, so the token stays off GitHub:

     KV_REST_API_URL=https://....upstash.io
     KV_REST_API_TOKEN=....

   Vercel prints both under Storage → your database → .env.local. */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const FILE = path.join(DATA_DIR, "store.json");

/* A five-line .env reader. Enough for two keys; not a config system. */
function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m || line.trim().startsWith("#")) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();
const remote = require("../lib/remote");

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("-")) || "info";
const has = (flag) => args.includes("--" + flag);
const value = (flag) => (args.find((a) => a.startsWith(`--${flag}=`)) || "").split("=")[1] || "";

const size = (n) => (n > 1024 * 1024 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");
const count = (d) => `${d.projects.length} projects · ${d.revenue.length} clients`
  + ` · ${d.updates.length} updates · v${d.version}`;

function die(message) {
  console.error("\n  " + message + "\n");
  process.exit(1);
}

async function main() {
  if (!remote.enabled()) {
    die("No store credentials. Put KV_REST_API_URL and KV_REST_API_TOKEN in .env,\n"
      + "  or run this with them set in the environment.");
  }

  if (cmd === "info") {
    const got = await remote.read();
    if (!got) return console.log("\n  The remote board is empty. `node tools/remote.js push` fills it.\n");
    const days = await remote.backups().catch(() => []);
    console.log(`\n  Remote board   ${count(got.data)}`);
    console.log(`  Last write     ${got.data.updatedAt}`);
    console.log(`  Snapshots      ${days.length ? days.join(", ") : "none yet"}`);
    console.log(`  Local copy     ${fs.existsSync(FILE) ? `v${JSON.parse(fs.readFileSync(FILE, "utf8")).version}` : "none"}\n`);
    return;
  }

  if (cmd === "push") {
    if (!fs.existsSync(FILE)) die(`${FILE} does not exist. Nothing to send.`);
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const existing = await remote.read();
    if (existing && !has("force")) {
      die(`The remote board already holds ${count(existing.data)}.\n`
        + "  Sending this one over it would drop whatever the team typed there.\n"
        + "  Take a copy first (`node tools/remote.js pull --day=...`), then add --force.");
    }
    await remote.put(data);
    console.log(`\n  Sent up: ${count(data)}  (${size(fs.statSync(FILE).size)} on disk)\n`);
    return;
  }

  if (cmd === "pull") {
    const day = value("day");
    const data = day ? await remote.readBackup(day) : (await remote.read() || {}).data;
    if (!data) die(day ? `No snapshot for ${day}.` : "The remote board is empty.");
    if (fs.existsSync(FILE) && !has("force")) {
      die(`${FILE} already exists. Move it aside, or add --force to overwrite it.`);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    console.log(`\n  Wrote ${FILE}: ${count(data)}${day ? `  (snapshot of ${day})` : ""}\n`);
    return;
  }

  die(`Unknown command "${cmd}". Try: info | push | pull`);
}

main().catch((err) => die(err.message));
