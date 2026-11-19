---
name: selectminds-search
version: 1.0.0
description: >
  Search job openings on employers' Oracle SelectMinds career sites
  (<org>.referrals.selectminds.com), such as Tetra Tech. These are often employers whose
  backend is Oracle Taleo. Works for any employer and country on SelectMinds; the sites
  searched come from a personal registry (selectminds_sites.json). Postings are mostly in
  English, with some in French or Spanish. Trigger phrases: Tetra Tech jobs, openings at
  Tetra Tech, SelectMinds, check <company> careers, search employer career sites,
  vacantes en Tetra Tech, ofertas de empleo en <empresa>, offres d'emploi.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/selectminds-search/cli/src/cli.ts *)
---

# SelectMinds Search Skill

Searches the public job listings on **Oracle SelectMinds career sites**
(`<org>.referrals.selectminds.com`). Some employers whose hiring runs on Oracle Taleo
(e.g. Tetra Tech, which applies through `tetratech.taleo.net`) publish their openings
through one. The pages are server-rendered HTML. No authentication, no API key, and
**zero runtime dependencies**: it runs with just `bun`.

Keep volume low. A plain search is one request per registry entry. `--jobage` adds one
request per result (see below).

## The registry

Sites live in **`selectminds_sites.json` at the repo root**. It's personal and gitignored.
Without it, the CLI uses `.agents/skills/selectminds-search/selectminds_sites.example.json`
(Tetra Tech only) and prints a stderr warning.

```json
[ { "name": "Tetra Tech", "url": "https://tetratech.referrals.selectminds.com" } ]
```

Only `*.selectminds.com` hosts are accepted. Run `list` to check the registry parses.

## Commands

### Search

```bash
bun run .agents/skills/selectminds-search/cli/src/cli.ts search -q "<keywords>" [flags]
```

Query syntax: double quotes make an exact phrase, and word order counts. Bare words
match postings containing any of them, which is very broad. Single quotes have no
effect, and `OR` behaves like the default any-word match. Quote multi-word titles.
These were verified on Tetra Tech's site on 2026-11-18: bare 1034, double-quoted 4,
single-quoted 1034, reversed and quoted 2, and `commissioning OR efficiency` 256
(alone: 125 and 152).

Flags:
- `--query <text>` / `-q <text>`: keywords. Omit to list every posting.
- `--site <name>` / `-s <name>`: one registry entry. Omit to search all.
- `--location <text>` / `-l <text>`: location substring, filtered client-side on the
  page's results. Multi-location postings read "Quebec, Canada and 2 additional
  locations"; only the first location is matched.
- `--jobage <days>`: posted within N days. **Result cards carry no date**, so this
  fetches each result's posting page to read its "N days ago" label: up to 10 extra
  requests per site per page. Postings whose age can't be read are kept.
- `--page <n>`: 1-indexed, 10 results per site per page. Page 2+ costs one extra request.
- `--limit <n>` / `-n <n>`: cap total results emitted (client-side).
- `--format json|table|plain`: default `json`.

### Detail

```bash
bun run .agents/skills/selectminds-search/cli/src/cli.ts detail <job-id | posting-url> [--site <name>] [--format json|plain]
```

A bare numeric id (e.g. `58033`) needs `--site` when the registry has more than one
entry. Returns title, location, requisition number, the relative post date (plus an
approximate calendar date) and the full description.

### List the registry

```bash
bun run .agents/skills/selectminds-search/cli/src/cli.ts list [--format json|table]
```

## Usage examples

```bash
# Energy-efficiency roles at Tetra Tech
bun run .agents/skills/selectminds-search/cli/src/cli.ts search -q '"energy efficiency"' --format table

# Commissioning roles in Texas posted in the last 14 days
bun run .agents/skills/selectminds-search/cli/src/cli.ts search -q commissioning -l Texas --jobage 14 --format table

# Measurement and verification, second page
bun run .agents/skills/selectminds-search/cli/src/cli.ts search -q '"measurement and verification"' --page 2 --format table

# Energy roles in Houston
bun run .agents/skills/selectminds-search/cli/src/cli.ts search -q energy -l Houston --format table

# Full posting
bun run .agents/skills/selectminds-search/cli/src/cli.ts detail 58033 --site "Tetra Tech" --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default. Programmatic use; `meta.total` is the portal's own match count |
| `table` | Quick scanning; DATE shows `new` for the site's "New" flag when no date was resolved |
| `plain` | Reading a single job's full detail (`detail` command) |

Each search result has `id`, `title`, `company` (registry name), `location`, `date`
(`null` unless `--jobage` resolved it), `postedAgo`, `isNew`, `category`, `snippet`,
`url` and `site`.

All errors go to **stderr** as `{ "error": "...", "code": "..." }`, exit code `1`. A failing
site is reported in `meta.errors` without aborting the others.

## Notes

- **Dates:** search results have no date. Use `--jobage`, or `detail`, to get one. Dates
  are derived from labels like "5 days ago", so they're approximate. Week and month
  labels are rounded (a "month" counts as 30 days).
- **Applying** happens on the employer's Taleo site (`tetratech.taleo.net`), not here.
- **Mixed languages:** Tetra Tech's Canadian postings are often in French.
- Endpoints and HTML anchors are documented in `url-reference.md`.
