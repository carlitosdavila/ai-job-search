import {
  PAGE_SIZE,
  jsonFetch,
  loadRegistry,
  parseSearch,
  postedDaysAgo,
  stripInvisible,
  writeError,
  type JobCard,
  type WorkdaySite,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  site?: string
  location?: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function searchBody(opts: Pick<SearchOpts, "query" | "page">): Record<string, unknown> {
  return {
    appliedFacets: {},
    limit: PAGE_SIZE,
    offset: (opts.page - 1) * PAGE_SIZE,
    searchText: opts.query ?? "",
  }
}

/**
 * Client-side location filter. Workday collapses multi-location postings to
 * "N Locations", which cannot be matched, so those are kept rather than
 * silently dropped (check them with `detail`).
 */
function locationOk(job: JobCard, want?: string): boolean {
  if (!want) return true
  if (!job.location || /^\d+\s+locations?$/i.test(job.location)) return true
  return job.location.toLowerCase().includes(want.toLowerCase())
}

/** Client-side age filter from Workday's relative label; an unparseable label is kept. */
function ageOk(job: JobCard, maxDays?: number): boolean {
  if (maxDays === undefined) return true
  const p = postedDaysAgo(job.postedOn)
  if (!p) return true
  // "30+ Days Ago": at least 30 days old, true age unknown. Drop it for any
  // window shorter than that; keep it (unverifiable) for a window of 30+.
  if (p.plus) return maxDays >= p.days
  return p.days <= maxDays
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header = `${"ID".padEnd(9)} ${"TITLE".padEnd(46)} ${"COMPANY".padEnd(18)} ${"LOCATION".padEnd(30)} DATE`
  const rows = cards.map(
    (c) =>
      `${(c.id || "—").slice(0, 9).padEnd(9)} ${c.title.slice(0, 46).padEnd(46)} ${c.company.slice(0, 18).padEnd(18)} ${(c.location || "—").slice(0, 30).padEnd(30)} ${c.date || c.postedOn || "—"}`,
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let sites: WorkdaySite[]
  try {
    sites = await loadRegistry()
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "BAD_REGISTRY")
    return 1
  }
  if (opts.site) {
    sites = sites.filter((s) => s.name.toLowerCase() === opts.site!.toLowerCase())
    if (sites.length === 0) {
      writeError(`No registry entry named "${opts.site}" (see the 'list' command)`, "UNKNOWN_SITE")
      return 1
    }
  }

  const totals: Record<string, number | null> = {}
  const errors: { site: string; error: string }[] = []
  let cards: JobCard[] = []
  for (const site of sites) {
    try {
      const data = await jsonFetch(`${site.api}/jobs`, searchBody(opts))
      if (data === null) throw new Error(`careers site not found (404) - check the registry URL for "${site.name}"`)
      const { total, jobs } = parseSearch(data, site)
      totals[site.name] = total
      cards.push(...jobs.filter((j) => locationOk(j, opts.location) && ageOk(j, opts.jobage)))
    } catch (e) {
      errors.push({ site: site.name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  if (errors.length === sites.length) {
    writeError(errors.map((e) => `${e.site}: ${e.error}`).join("; "), "SEARCH_FAILED")
    return 1
  }

  cards = stripInvisible(cards)
  if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)
  const knownTotals = Object.values(totals).filter((t): t is number => typeof t === "number")
  const total = knownTotals.length ? knownTotals.reduce((a, b) => a + b, 0) : null

  if (errors.length && opts.format !== "json") {
    process.stderr.write(JSON.stringify({ warnings: errors }) + "\n")
  }
  if (opts.format === "table") {
    process.stdout.write(renderTable(cards) + "\n")
  } else if (opts.format === "plain") {
    process.stdout.write(
      (cards.length
        ? cards
            .map((c) => `${c.title}\n  ${c.company} · ${c.location || "—"} · ${c.date || c.postedOn || "—"}\n  id: ${c.id || "—"}\n  ${c.url}`)
            .join("\n\n")
        : "No results.") + "\n",
    )
  } else {
    process.stdout.write(
      JSON.stringify(
        { meta: { count: cards.length, page: opts.page, total, totals, errors }, results: cards },
        null,
        2,
      ) + "\n",
    )
  }
  return 0
}
