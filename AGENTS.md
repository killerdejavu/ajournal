# AGENTS.md

This file is for AI coding agents (and humans) working in this repo — especially
anyone trying to go from "fresh clone" to "a full set of monthly/quarterly/yearly
work reports" the way this project is actually meant to be used.

## What this repo is

AJournal syncs your own activity from Slack, GitHub, Google Calendar, and JIRA
into local per-day JSON, then turns that into readable journals and reports.
Everything is local — see **Data privacy** at the bottom.

## Setup

```bash
npm install
cp .env.example .env
cp config.example.json config.json
```

Fill in `.env`:

| Variable | How to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SLACK_USER_TOKEN` | A Slack **user** token (`xoxp-...`), not a bot token — needs `search:read` plus `channels:history`/`groups:history`/`im:history` for thread replies. Create/install an app at api.slack.com/apps. |
| `GITHUB_TOKEN` | A GitHub PAT, or just use `gh auth token` if the `gh` CLI is already logged in on this machine. |
| `GOOGLE_CREDENTIALS_PATH` | Path to an OAuth **Desktop app** client JSON from Google Cloud Console (enable the Calendar API first). |
| `JIRA_API_TOKEN` | id.atlassian.com → Security → API tokens. Optional — leave the integration disabled in `config.json` if you don't use JIRA. |

Google needs one extra interactive step the first time:

```bash
node setup-google-oauth.js
```

This opens a browser, you approve, and you paste back the `code=` value from the
resulting (broken-looking, that's expected) `localhost` redirect URL. It saves a
refresh token to `data/google-token.json` so you only do this once.

Edit `config.json` to point every integration at *your* identity (usernames,
Slack user ID, JIRA host/email, calendar ID) and to set your exclude
patterns (channels, repos, calendars you don't want tracked).

## Known limits worth knowing before a big backfill

- **Slack** search is day-by-day and rate-limited (~1.2s between requests by
  default) — backfilling a year takes real wall-clock time (tens of minutes),
  not because anything's broken.
- **GitHub** search (commits and PRs) caps at 1000 results per query. The
  `sync --from/--to` flags let you chunk a long backfill into smaller windows
  if any single window would blow past that.
- **JIRA** — this fork targets the current `/rest/api/3/search/jql` endpoint
  (Atlassian retired `/rest/api/2/search`) and matches your own activity by
  `accountId`, since Jira Cloud dropped `author.name` from comment payloads.
  If your instance differs, `src/integrations/jira.js` is the place to look.
- The default AI model in `config.example.json` is whatever's current at the
  time you read this — check it isn't retired before your first `generate`
  call fails with a 404.

## Recommended workflow: a full period of reports (monthly → quarterly → yearly)

### Step 1 — Backfill raw data, no AI involved yet

```bash
node src/cli.js sync -i github --from 2025-01-01 --to 2025-12-31
node src/cli.js sync -i gcal   --from 2025-01-01 --to 2025-12-31
node src/cli.js sync -i slack  --from 2025-01-01 --to 2025-12-31
node src/cli.js sync -i jira   --from 2025-01-01 --to 2025-12-31
```

Run these in parallel background jobs — Slack is the slow one, the rest finish
fast. This step is pure data collection: free, and bound by API rate limits,
not by anything else. It lands clean per-day JSON under
`data/raw-data/<integration>/<date>.json`.

### Step 2 — Skip the daily-journal step; go straight to monthly narrative reports

The built-in `generate` → `monthly-report` pipeline (mechanical, one Claude
call per day, then a rollup call) works, but for something you'll actually
want to read later — a self-review, a retro, "what did I even do this
year" — a much better result comes from having an agent read a whole month
of raw JSON directly and write a narrative, instead of summarizing day by day.

If you're working in an agent harness that supports parallel subagents (like
this one), the pattern that worked well:

1. Write one **brief** file once (template below) describing the data layout,
   the output structure you want, and the tone.
2. Launch one subagent per month, in parallel, each pointed at the brief and
   its own month. They don't share state, so they can all run concurrently.
3. Each agent aggregates first (counts per repo/channel, so it knows where the
   month's volume actually was), then reads the real content — commit/PR
   titles, meeting titles, a sample of the longest/most substantive Slack
   messages — and writes one narrative file per month.

#### Report brief template

Save this as e.g. `data/agent-brief.md` and hand it to each monthly subagent
along with "and your month is 2025-07":

```markdown
# Brief: monthly work summary generation

## Your context (optional, but recommended)
If you keep a personal context file — your role, your team, what "good"
looks like for you, ongoing initiatives — read it first. It lets you tell
which raw activities actually matter and write in a voice that fits your
real role, instead of generic corporate summary language.

## Data location & format
Raw per-day JSON under `data/raw-data/<vendor>/<YYYY-MM-DD>.json`.
Each file: `{"timestamp": ..., "data": [activity, ...]}`.

- `github/`: `type` (`commit` | `pr_created` | `pr_reviewed` | `issue_activity`),
  `repository`, `message`/`title`, `timestamp`.
- `slack/`: `type`, `channel`, `text`, `timestamp`, `intent`.
- `gcal/`: calendar events — title/summary, times, attendees.
- `jira/`: `type`, `ticketKey`, `summary`.

## How to work
1. Read your context file, if you have one.
2. Aggregate first — counts by repo/channel/day — to see where the month's
   volume actually was.
3. Read the real content. Don't just report counts.
4. Group into work arcs: consolidate a multi-week effort into one narrative
   item instead of listing every commit.

## Output style
Write for a reader who wants to know what happened and why it mattered, not
an activity log. Structure: Overview, Major initiatives (grouped by
project/team), Incidents & operations, Leadership/decisions/collaboration, a
small metrics table. Focus on problem → action → outcome, not exhaustive
lists. No ticket-ID dumps.

## Deliverable
Write to `data/journals/reports/monthly/<YYYY>/monthly-report-<YYYY-MM>.md`.
Return a short digest (5-8 sentences) as your final message.
```

### Step 3 — Quarterly and yearly synthesis

Once every monthly report exists, read them yourself (or point one agent at
all of them) and write the quarterly and yearly summaries directly — this
step never needs to touch raw data again, only the monthly narratives.
Group quarters to match whatever review cycle you're actually writing for
(calendar quarters, fiscal quarters, or your organization's real review
periods — these don't have to line up with the calendar).

The repo also ships a `yearly-report` CLI command that automates this same
synthesis in a single Claude call:

```bash
node src/cli.js yearly-report --from 2025-01 --to 2025-12
```

It's faster and cheaper. But if the output needs to be genuinely well
written and specific — the kind of thing a human will actually read — the
manual, agent-driven read-and-write approach from Steps 2–3 produces
noticeably better results. Treat the CLI command as the fast default and the
manual approach as the upgrade when it's worth the extra effort.

### Step 4 — Use the reports

Monthly/quarterly/yearly reports are good source material for performance
self-assessments, 1:1 prep, or any "what actually happened" retro — anywhere
you need concrete, dated evidence instead of reconstructing a year from
memory.

## Data privacy

`data/`, `config.json`, `.env`, and `creds/` are all gitignored. Nothing about
your activity ever leaves your machine except the Anthropic API calls needed
to generate summaries (if you use the AI-driven paths) — the repo itself
ships with no credentials, no config, and no data. `.sessions/` (a personal
Claude Code task-tracking convention, unrelated to this tool) is gitignored
too, for the same reason.

## File map

- `src/integrations/*.js` — one file per data source (github, gcal, jira, slack-search)
- `src/services/storage.js` — where raw data and reports get read/written
- `src/services/ai.js` — the Claude wrapper behind the built-in `generate`/`*-report` commands
- `src/services/journal.js` — daily journal assembly from raw data
- `src/cli.js` — every CLI command (`sync`, `generate`, `weekly-report`,
  `monthly-report`, `quarterly-report`, `yearly-report`, `status`, `config`, `migrate`)
