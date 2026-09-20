# TFOps

The TrueFan operations board: one place for the project timeline, everyone's
status updates, escalations, and the company overview.

A small self-hosted web app — a Node server with no dependencies and a plain-JS
front end. Nothing to install, nothing to build.

> **This repo is code only.** The board's data (`data/`), the original sheet
> export and the revenue spreadsheet are all gitignored, because they contain a
> real client book. Clone this and you get an empty app; see
> [Where the data lives](#where-the-data-lives) for how to seed your own.

## Run it locally

```bash
node server.js
```

Open <http://localhost:8848>. On Windows, double-click `start-dashboard.cmd`.

## The views

Seven tabs, in the order they load. **Delivery load is the landing page.**

| View | For | Owns |
|---|---|---|
| **Delivery load** | The CEO, on open. A one-line verdict, five KPIs, live levers, and a ranked table of who takes the most team time. | capacity, headcount, team time |
| **Overview** | The money page. Book of business, concentration, service mix, plus the what-if levers and the shared assumptions. | revenue, scenarios |
| **Escalations** | Whoever owns the client relationship. Every live project as a card, worst first, saying what is wrong and who to call. | risk, what is on fire |
| **Timeline** | The Gantt sheet, grouped by pod / client / DM / editor lead. Undated projects sit in a bucket underneath. | dates |
| **Standup** | Where DMs and editor leads post status. A post can set the project's dates in the same submit. | updates |
| **Projects** | The sheet, sortable. Click any row to edit it. | the raw rows |
| **My work** | One person's slate, with what they owe the team on top. | the individual |

Each page owns exactly one question, and links to the page that owns the next
one rather than repeating it. The old CEO studio is now the **Run the numbers**
section of Overview — same levers, one fewer tab. Panels that said the same
thing twice (a duplicate capacity table, three separate service-line breakdowns,
two risk tables) were removed, not hidden.

## Sign-in and roles

People sign in with **their name and a password**. The name signs everything they
post; the password decides what they can do.

| Env var | Who it is for | What it allows |
|---|---|---|
| `TFOPS_PASSWORD` | the delivery team | read and edit everything |
| `TFOPS_VIEW_PASSWORD` | leadership | read everything, change nothing |

Set neither and the board runs **open** — no login at all. That is fine on your
own machine or a trusted office LAN, and the server prints a warning at startup
so it is never a surprise. Set at least `TFOPS_PASSWORD` before the board is
reachable from outside the office.

The read-only role is enforced on the server, not just hidden in the UI: a
read-only session gets `403` on every write even if someone crafts the request
by hand.

Sessions are signed cookies valid for 30 days. The signing key is generated into
the data directory on first run — or, where there is no disk to keep it on, into
the store next to the board, so every copy of the process signs the same
cookies. Set it yourself with `TFOPS_SECRET` if you would rather.

**Its limits, plainly:** this is one shared password per role. It does not give
you per-person accounts, and it cannot tell you *which* teammate used the team
password — only the name they typed. That is the right trade for an internal
board; it is not enough if this ever holds anything regulated, in which case put
it behind SSO.

## Putting it online

**GitHub Pages cannot host this.** Pages serves static files only — there is no
Node process, so `/api/*` never answers and nothing can be saved. And a Pages
site built from a public repo is public to the world, which is the last place
this board belongs. The options below all keep the repo as the source of truth
and deploy *from* it.

Pick by how permanent you want it.

### 1. Office LAN — nothing to set up

Already works. `node server.js` prints a `http://192.168.x.x:8848` address;
anyone on the same Wi-Fi can open it. Your laptop has to be awake, and nobody
works from home on it.

### 2. A public HTTPS link from this same machine — 5 minutes, free

Good for getting the team on it this week without deciding on hosting.

```bash
winget install --id Cloudflare.cloudflared
```

```bash
cloudflared tunnel --url http://localhost:8848
```

That prints a `https://something.trycloudflare.com` URL that works from
anywhere. Two things before you share it:

- Set the passwords first. This URL is on the public internet.
- Start the server with `TRUST_PROXY=1` so session cookies are marked `Secure`.

The quick-tunnel URL changes each time you restart it. For a stable address,
`cloudflared tunnel create tfops` against a domain you own. The machine still
has to stay on.

### 3. Always-on hosting, deployed from GitHub — the real answer

`Dockerfile` and `render.yaml` are in the repo, so Render can read the whole
setup from the repo itself:

1. **render.com → New → Blueprint → pick `TFOPS`.** It reads `render.yaml`.
2. Set `TFOPS_PASSWORD` and `TFOPS_VIEW_PASSWORD` in the dashboard (the
   blueprint marks them `sync: false`, so they never live in git).
3. Every `git push` to `main` redeploys automatically.

The board starts **empty**, because the data files are gitignored. To bring your
own sheet across, open a shell on the service and copy an export to
`/data`, then run `node lib/seed.js --force`. After that the disk is the source
of truth and deploys never touch it.

**Do not use a free plan.** Free tiers have no persistent disk, so the board
resets to the seed data on every restart and you lose everything the team typed.
The blueprint asks for a 1 GB disk mounted at `/data`; that is what makes it
durable. Railway and Fly.io work the same way — Docker plus a mounted volume at
`DATA_DIR`.

### 4. Vercel — nothing to keep awake, and the board moves off the disk

Vercel gives a function a read-only disk and throws the instance away between
requests, so the file store has nowhere to live there. The board goes to Upstash
Redis instead — one document, same shape, behind a network call. `lib/store.js`
switches backends by itself the moment the credentials are in the environment;
the login, the roles, the audit trail and the daily snapshot all work the same.

1. **Import the repo** — vercel.com → Add New → Project. Leave the build
   settings alone; `vercel.json` already says what to do with them.
2. **Add the store** — Storage → Create Database → Upstash Redis, connected to
   this project. That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
3. **Set the passwords** — Settings → Environment Variables: `TFOPS_PASSWORD`,
   and `TFOPS_VIEW_PASSWORD` if leadership should be read-only. Until one is
   set the deploy refuses to serve the board at all and says so on the page: a
   public URL with no password is the client book on the open internet.
4. **Redeploy.** Environment variables only reach a new deployment.
5. **Send the board up** from the machine that has it. Put the two credentials
   in a `.env` at the repo root — gitignored, so the token stays off GitHub —
   then:

```bash
node tools/remote.js push
```

`info` says what is up there, `pull` brings it back down, and
`pull --day=2026-09-20` fetches one of the daily snapshots. Restoring is a
`pull --day=...` followed by a `push --force`.

Two things worth knowing before you settle on it:

- **Vercel's free plan is for personal use.** The Hobby terms exclude commercial
  work, and this is a company's operations board. Budget for Pro.
- **Every open tab polls every 12 seconds** — around 25,000 reads a day across
  ten people, past Upstash's free daily allowance and into a couple of dollars a
  month on pay-as-you-go. The poll reads one small counter key rather than the
  whole board, which is what keeps that number that low.

### 5. Your own VPS

```bash
docker build -t tfops .
```

```bash
docker run -d --restart unless-stopped -p 8848:8848 -v /srv/tfops:/data -e TFOPS_PASSWORD=... -e TFOPS_VIEW_PASSWORD=... -e TRUST_PROXY=1 tfops
```

Put Caddy or nginx in front for TLS.

### Backups, wherever it ends up

The board is one file. Copy `store.json` off the box on a schedule:

```bash
scp server:/srv/tfops/store.json ./tfops-$(date +%F).json
```

The server also keeps its own daily snapshot in `<DATA_DIR>/backups/` for 30 days,
but that is on the same disk — it protects against a bad edit, not a dead volume.

On a hosted store the same snapshot goes to a dated key beside the board, and
the way off the platform is a pull:

```bash
node tools/remote.js pull --force
```

## Where the data lives

`data/store.json` (or `$DATA_DIR/store.json`) — one file, the whole board. Writes
are atomic: written to a temp file, then renamed.

Where there is no disk worth writing to — a serverless host — the same document
lives in Upstash Redis instead, gzipped, with writes guarded by a compare-and-set
so two people saving at once cannot overwrite each other. That backend turns on
by itself when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set, and nothing
above the store knows the difference.

**The repo ships no data.** Our own board was imported from a single-file HTML
export (`PodLoadBoard.html`) that is gitignored, because it carries the client
book inline. To stand up your own copy, put an equivalent export next to
`lib/seed.js` and run:

```bash
node lib/seed.js
```

```bash
node lib/seed.js --force
```

Plain `seed.js` leaves an existing store alone, which is why it is safe in the
Docker start command. `--force` **throws away everything the team has typed
since**. It is for setup, not maintenance.

### What the importer had to guess

The source sheet mixed formats in the date columns. `lib/dates.js` reads
`2026-06-22`, `07.08.2026` (day first) and `7-Sept`; anything else is kept
verbatim as a note and shown with a ✎ marker, so nobody mistakes a guess for a
date. In our own import, about a third of the rows arrived with a usable date.
`Recurring` and `Ongoing`
become open-ended; `TBD` stays unknown, which is a different thing.

## How delivery load is counted

There are no timesheets behind this board, so load is estimated rather than
measured, and the page is explicit about that.

Each project is scored for how much work it is — Content @ Scale 5,
Personalisation 4, Cinematic 3, Avatar Creative 2, Avatar Simple 1, plus one
where the scope names a four-figure volume. On-hold work counts at a quarter,
upcoming at a half. The score is split between everyone named in that role, so a
project with two DMs weighs half as much on each.

The page never shows that raw score. It shows **two percentages of the same
100%**, which need no unit to understand:

- **Share of team** — how much of the delivery team's total time a client or
  project uses.
- **Share of the book** — how much of the revenue it brings in.

They should roughly match. **Balance** states the verdict in words — *Pays well*,
*Balanced*, *Light on revenue*, *Costs more than it earns* — so nobody has to do
the division. A client on 6% of the team for 0.5% of the book is the thing to
find, and the table is sorted to put it near the top.

Clients whose revenue was never mapped in the source sheet show **✎ not mapped**
rather than ₹0, because ₹0 reads as "free work" when it is really a gap in the
data.

**Capacity is counted against live projects only**, not the whole book — on-hold
work is reported separately and only lands on someone's plate when the "restart
on-hold work" lever moves. Parked projects are real, but they are not what the
team is doing this week, so counting them would overstate the load.

Every project starts on the assumed figure. Open it and set **Delivery effort**
to replace the guess with what it really costs — the view shows at a glance how
many rows are still assumed, and hand-weighted bars are drawn solid against pale
ones for the guesses.

## How revenue is attributed

The revenue sheet books a number once per **client**, but a client can have
several project rows. So a client's amount is split evenly across its projects,
and then again across the people named on each project. That is why every
breakdown — by pod, by DM, by service line — adds back up to the same total. It
also means a per-project revenue figure is an attribution, not an invoice.

## Layout

```
server.js            HTTP + JSON API, no dependencies
lib/auth.js          session cookies, the two passwords
lib/login-page.js    the sign-in screen
lib/dates.js         date parsing for the messy sheet formats
lib/seed.js          one-time import from PodLoadBoard.html
lib/store.js         atomic JSON store, versioning, daily backups
public/
  index.html
  app.css            design tokens and components
  js/core.js         state, API client, formatting, polling
  js/compute.js      all derived numbers — rollups, risk, escalation, scenarios
  js/charts.js       SVG chart primitives
  js/views/*.js      one file per view
Dockerfile           for any container host
render.yaml          one-click Render blueprint, with the disk configured
```

Browsers poll `/api/version` every 12 seconds and pull the board when it moves,
so two people editing at once see each other within a few seconds.

## Notes

- The categorical chart palette is validated for colour-blind separation in both
  light and dark mode. If you re-order or replace the `--s1…--s8` tokens in
  `app.css`, re-run the check rather than eyeballing it.
- Escalation card colours are derived from the client name, so a client always
  looks the same and becomes recognisable at a glance.
- Excel export uses SheetJS from a CDN; with no internet it falls back to CSV.
- `capacityPerDM`, `costPerDM`, the revenue target and the staleness window live
  in the CEO studio's Assumptions block and are shared across everyone.
