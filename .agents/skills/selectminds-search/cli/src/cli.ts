#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Oracle SelectMinds career sites
// (<org>.referrals.selectminds.com). Server-rendered HTML, parsed with regex;
// no external CLI framework and zero runtime dependencies.
//
// Sites come from a personal registry, selectminds_sites.json at the repo root
// (gitignored). Keep volume low: a handful of requests per run.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { loadRegistry, registryPath, writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", s: "site" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `selectminds-search — search jobs on Oracle SelectMinds career sites

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <posting-url | job-id [--site <name>]> [--format json|plain]
  bun run src/cli.ts list [--format json|table]

SEARCH FLAGS
  --query, -q <text>      Keywords. Omit to list every posting.
  --site, -s <name>       One registry entry (case-insensitive). Default: every entry.
  --location, -l <text>   Location substring, filtered client-side on this page's results.
  --jobage <days>         Posted within N days. Result cards carry no date, so this fetches
                          each result's posting (up to 10 extra requests per site per page).
  --page <n>              1-indexed page, 10 results per site per page. Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "energy engineer" --format table
  bun run src/cli.ts search -q "energy efficiency" -l Texas --jobage 14 --format table
  bun run src/cli.ts detail 58033 --site "Tetra Tech" --format plain
  bun run src/cli.ts list --format table

Registry: selectminds_sites.json at the repo root ([{"name": "...", "url": "https://<org>.referrals.selectminds.com"}]).
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "site", "location", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["site", "format", "help", "h"]),
  list: new Set(["format", "help", "h"]),
}

function bad(error: string, code = "BAD_ARG"): number {
  writeError(error, code)
  return 1
}

function nonEmpty(flags: Flags, name: string): string | undefined | null {
  const v = flags[name]
  if (v === undefined) return undefined
  if (typeof v !== "string" || !v.trim()) return null
  return v.trim()
}

function wholeNumber(flags: Flags, name: string): number | undefined | null {
  const raw = flags[name]
  if (raw === undefined) return undefined
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) return null
  return val
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Unknown flags are rejected, never ignored: a discarded filter silently
  // changes what the search returns.
  const known = KNOWN_FLAGS[cmd]
  if (!known) return bad(`Unknown command "${cmd}"`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key !== "_" && !known.has(key)) {
      return bad(`unknown flag --${key} for '${cmd}' - see --help for the supported flags`, "UNKNOWN_FLAG")
    }
  }

  if (cmd === "list") {
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table"].includes(fmt)) return bad(`--format must be one of json|table, got "${fmt}"`)
    const sites = await loadRegistry()
    if (fmt === "table") {
      process.stdout.write(
        [`${"NAME".padEnd(24)} SITE`, "-".repeat(70), ...sites.map((s) => `${s.name.slice(0, 24).padEnd(24)} ${s.base}`)].join("\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify({ registry: registryPath().file, sites }, null, 2) + "\n")
    }
    return 0
  }

  if (cmd === "search") {
    const query = nonEmpty(flags, "query")
    if (query === null) return bad("--query requires a non-empty value")
    const site = nonEmpty(flags, "site")
    if (site === null) return bad("--site requires a registry name")
    const location = nonEmpty(flags, "location")
    if (location === null) return bad("--location requires a non-empty value")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return bad(`--format must be one of json|table|plain, got "${fmt}"`)
    const nums: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      const v = wholeNumber(flags, name)
      if (v === null) return bad(`--${name} must be a whole number of at least 1, got "${flags[name]}"`)
      nums[name] = v
    }
    const opts: SearchOpts = {
      query,
      site,
      location,
      jobage: nums.jobage,
      page: nums.page ?? 1,
      limit: nums.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  const id = (flags._ as string[])[1]
  if (!id) return bad("detail requires a posting URL or a job id", "NO_ID")
  const site = nonEmpty(flags, "site")
  if (site === null) return bad("--site requires a registry name")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) return bad(`--format must be one of json|plain, got "${fmt}"`)
  const opts: DetailOpts = { id, site, format: fmt as DetailOpts["format"] }
  return runDetail(opts)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
