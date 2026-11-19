---
name: workday-search
version: 1.0.0
description: >
  Search job openings directly on employers' own Workday careers sites
  (<company>.wdN.myworkdayjobs.com) - ESCOs, OEMs, engineering consultancies and
  other employers that run their hiring on Workday, such as Ameresco. Works for
  any employer and country on Workday; the employers searched come from a personal
  registry (workday_sites.json). Postings are mostly in English. Trigger phrases:
  Workday jobs, openings at <company>, check <company> careers, any new roles at
  Ameresco, search employer career sites, myworkdayjobs, vacantes en <empresa>,
  ofertas de empleo en <empresa>, buscar empleo en el portal de <empresa>.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/workday-search/cli/src/cli.ts *)
---

# Workday Search Skill

Searches the job listings on **employers' own Workday-hosted careers sites** through the
public JSON API every Workday careers site runs on. No authentication, no API key, and
**zero runtime dependencies**: it runs with just `bun`.

Many large employers (ESCOs, OEMs, consultancies) post everything on their Workday site
but only some roles to LinkedIn. One skill covers all of them: each employer is a
one-line entry in a personal registry.

Keep volume low. Each search sends one request per registry entry, and that is all the
contact a run needs. This is personal job hunting, not bulk collection.

## The registry

The employer list lives in **`workday_sites.json` at the repo root**. It's personal and
gitignored. If it doesn't exist, the CLI falls back to
`.agents/skills/workday-search/workday_sites.example.json` (Ameresco only) and prints a
stderr warning.

```bash
cp .agents/skills/workday-search/workday_sites.example.json workday_sites.json
```

```json
[
  { "name": "Ameresco", "url": "https://ameresco.wd5.myworkdayjobs.com/Ameresco", "notes": "free text" }
]
```

- `name`: display name, used as `company` in results and as the `--site` key.
- `url`: the careers site exactly as the browser shows it. A locale segment
  (`/en-US/`) and anything after the site name are fine. Only
  `<tenant>.wdN.myworkdayjobs.com` hosts are accepted.

To find an employer's URL, open their careers page and follow "Search jobs". If you land
on a `myworkdayjobs.com` address, copy it up to and including the site name.

Run `list` to check the registry parses.

## Commands

### Search

```bash
bun run .agents/skills/workday-search/cli/src/cli.ts search -q "<keywords>" [flags]
```

Query syntax: bare words match postings containing any of them (broad). Double quotes
narrow to postings containing all the quoted words, but word order is not enforced.
Single quotes have no effect, and `OR` behaves like the default any-word match. Quote
multi-word titles for precise results. These were verified on Ameresco's site on
2026-11-18: bare 76, double-quoted 17, single-quoted 76, reversed and quoted 17.

Flags:
- `--query <text>` / `-q <text>`: keyword search. Recommended.
- `--site <name>` / `-s <name>`: one registry entry (case-insensitive). Omit to search every entry.
- `--location <text>` / `-l <text>`: location substring, filtered client-side. Postings
  that Workday shows as "N Locations" are always kept; their locations only appear in `detail`.
- `--jobage <days>`: posted within N days, filtered client-side from Workday's
  "Posted N Days Ago" label. Postings labelled "30+ Days Ago" are dropped when N < 30.
- `--page <n>`: 1-indexed page, 20 results per site per page.
- `--limit <n>` / `-n <n>`: cap total results emitted (client-side).
- `--format json|table|plain`: default `json`.

### Detail

```bash
bun run .agents/skills/workday-search/cli/src/cli.ts detail <posting-url> [--format json|plain]
bun run .agents/skills/workday-search/cli/src/cli.ts detail <requisition-id> --site <name> [--format json|plain]
```

Pass the `url` from a search result, or the requisition `id` (e.g. `R4109`) with
`--site`. The requisition form costs one extra search request. Detail returns the full
description, the legal employer name, employment type, extra locations, the exact
posting date and whether the posting still accepts applications (`isActive`).

### List the registry

```bash
bun run .agents/skills/workday-search/cli/src/cli.ts list [--format json|table]
```

## Usage examples

```bash
# Energy-engineering roles across every registered employer
bun run .agents/skills/workday-search/cli/src/cli.ts search -q '"energy engineer"' --format table

# Commissioning roles at Ameresco in Texas, last 14 days
bun run .agents/skills/workday-search/cli/src/cli.ts search -q commissioning -s Ameresco -l Texas --jobage 14 --format table

# Measurement and verification roles, remote
bun run .agents/skills/workday-search/cli/src/cli.ts search -q '"measurement and verification"' -l Remote --format table

# Energy auditor roles in Houston or anywhere listing several locations
bun run .agents/skills/workday-search/cli/src/cli.ts search -q '"energy auditor"' -l Houston --format table

# Full posting by requisition id
bun run .agents/skills/workday-search/cli/src/cli.ts detail R4109 --site Ameresco --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default. Programmatic use; `meta.total` is the sum of the totals each site reports, and `meta.errors` lists any site that failed |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Each search result has `id` (the requisition id), `title`, `company` (registry name),
`location`, `date` (YYYY-MM-DD derived from the relative label, `null` for "30+ Days
Ago"), `postedOn` (the raw label), `url` and `site`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1`. A failure on one registry entry is reported in `meta.errors` (or a
stderr `warnings` line) without aborting the others. The run fails only when every site fails.

## Notes

- **Dates are approximate in search.** Workday's list API gives only "Posted Today",
  "Yesterday", "N Days Ago" or "30+ Days Ago". `detail` returns the exact date (`startDate`).
- **Search ranks loosely.** Bare multi-word queries pull in unrelated roles (an "energy
  engineer" search at Ameresco returned project administrators). Quote the phrase.
- **No company field in search results.** `company` is the registry name; `detail`
  returns the legal name (e.g. "Ameresco Inc").
- **Location filtering is client-side**, and "N Locations" postings can't be filtered
  until you fetch their detail.
- **Watch for clearance language.** Some postings (e.g. Ameresco R4109) require the
  "ability to review confidential US security information". Read `detail` before
  ranking a federal-adjacent role.
- The CLI retries 429/5xx with exponential backoff and returns `NOT_FOUND` on a 404
  (a closed posting or a wrong registry URL).
- Endpoints, request bodies and response fields are documented in `url-reference.md`.
