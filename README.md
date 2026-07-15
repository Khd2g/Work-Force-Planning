# Roster Tracker

A live, team-shared dashboard that ingests your staffing capacity roster (the
one with a tab per market — Akron, Cincinnati, Dallas, etc.), flags who's
new or departed since the last upload, and gives a first-pass alert when a
role's ratio is approaching or has been exceeded for a location's census.

Everything runs on Netlify: a static dashboard + one serverless function +
Netlify Blobs for shared storage. No database to provision, no extra
accounts to create.

## How it works

- **You upload the same Excel file you already maintain**, 2–3x/week, right
  from the dashboard. Parsing happens in the browser (via SheetJS) — the raw
  file itself is never sent anywhere, only the structured roster data.
- That structured data is POSTed to a Netlify Function, which compares it to
  the **last stored snapshot** (shared across your whole team via Netlify
  Blobs), figures out who's new, who dropped off, and who moved locations,
  and stores the new snapshot + a running history log.
- Anyone who opens the dashboard — on any device — sees the same live data,
  because they're all reading from the same backend snapshot, not a local
  file.
- A first-pass **ratio/census alert** panel flags locations where the RN
  Case Manager or Hospice Aide headcount (counted from your case-assignment
  grid) can't cover current census, using the ratio already written in your
  sheet (e.g. "1:10"). This is the seed for the bigger role-ratio /
  notification system you described — see "Where to take this next" below.

## What it expects from your Excel file

Each roster tab needs to keep the same layout your current file uses:
- Row 2: `Staffing Capacity Roster | Ratio: 1:XX ... ` — this is how the app
  recognizes a tab as a roster (tabs that don't match this text, like a
  blank template tab, are skipped automatically).
- Row 3: `Current Census` with the number a few columns over.
- Row 5/6: Administrative Roles headers + names.
- Row 11: Case-assignment grid headers (Patient Census bands + role columns).
- Rows 12–21: the census bands (1–10, 11–20, … 91–100) with names per role.
- Row 23/24: `PRN Staff` section with Role / Name / Type / Status.

If a market adds a column or shifts a row, the parser will likely need a
small tweak in `public/index.html` (`parseWorkbook`) — it's written to be
easy to adjust.

## Deploying it

The fastest reliable path (drag-and-drop deploys don't run serverless
functions properly, so use one of these):

### Option A — GitHub + Netlify (recommended)
1. Create a new GitHub repo and push this whole folder to it.
2. In Netlify: **Add new site → Import an existing project → GitHub** →
   pick the repo.
3. Netlify will read `netlify.toml` automatically (publish dir `public`,
   functions dir `netlify/functions`). Click **Deploy**.
4. Netlify Blobs works automatically on any deployed Netlify site — no
   extra setup, no keys to configure.

### Option B — Netlify CLI from your machine
```bash
npm install -g netlify-cli
cd roster-tracker
netlify deploy --prod
```
Follow the prompts to link/create a site. Same result as Option A.

Either way, once deployed you'll get a URL like
`https://your-site-name.netlify.app` — share that with your team.

## Using it day to day

1. Open the dashboard URL.
2. Type your name in "Uploaded by" (so the history log shows who ran each
   update).
3. Choose the latest roster `.xlsx` file.
4. The dashboard updates for everyone within a few seconds — new/departed
   staff show up in the Changes panel, alerts refresh, and the tracker view
   reflects the latest data.

## Where to take this next

You mentioned wanting these to eventually "talk to each other" for census
and ratio notifications — this build is set up to grow into that:

- **Email alerts**: add a Netlify **Scheduled Function** (cron-based) that
  calls the same alert logic in `roster.mjs` on a timer and sends email via
  a provider like Resend or SendGrid when something crosses a threshold.
  The alert-computation code is already isolated in `computeAlerts()`, so
  it can be reused as-is.
- **Per-location ratio rules**: right now the ratio is parsed straight from
  the sheet text (`1:10`) and applied to RN Case Manager / Hospice Aide.
  If different markets need different rules (e.g. On Call Nurse ratios,
  or different thresholds for "warning" vs "critical"), that's a small
  change to `computeAlerts()`.
- **Census trend history**: the history log already stores every upload's
  diff. Extending it to also snapshot each location's census over time
  would let you chart trends, not just point-in-time numbers.
- **2026 workforce-planning columns** (seen on the Dallas tab — planned vs.
  actual hiring, monthly census projections): not parsed yet in this first
  version, but the same pattern used for the case-assignment grid can be
  extended to pull those columns in once you're ready.

## Files

```
roster-tracker/
├─ netlify.toml                  # build + function config
├─ package.json                  # @netlify/blobs dependency
├─ netlify/functions/roster.mjs  # backend: diffing, storage, alerts
└─ public/index.html             # dashboard: upload, parsing, all rendering
```
