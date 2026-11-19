import {
  dateFromDaysAgo,
  daysAgo,
  htmlFetch,
  loadRegistry,
  parseDetail,
  parseSearch,
  stripInvisible,
  writeError,
  type JobCard,
  type Site,
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

export function firstPageUrl(site: Site, query?: string): string {
  return query ? `${site.base}/jobs/search?keywords=${encodeURIComponent(query)}` : `${site.base}/jobs/search?all`
}

/**
 * Fetch one results page. Page 1 is the search URL itself (the site answers
 * with a redirect to /jobs/search/<searchId>); page N appends /page<N> to that
 * numbered URL, so pages beyond the first cost one extra request.
 */
async function fetchPage(site: Site, query: string | undefined, page: number) {
  const first = await htmlFetch(firstPageUrl(site, query))
  if (!first) throw new Error(`search page not found (404) - check the registry URL for "${site.name}"`)
  if (page === 1) return parseSearch(first.html, site)
  const m = new URL(first.url).pathname.match(/^\/jobs\/search\/(\d+)/)
  if (!m) throw new Error(`${site.name}: search did not redirect to a numbered results page, cannot paginate`)
  const next = await htmlFetch(`${site.base}/jobs/search/${m[1]}/page${page}`)
  if (!next) return { total: null, pages: null, jobs: [] }
  return parseSearch(next.html, site)
}

function locationOk(job: JobCard, want?: string): boolean {
  if (!want) return true
  if (!job.location) return true
  return job.location.toLowerCase().includes(want.toLowerCase())
}

/**
 * Result cards carry no posting date. With --jobage, each remaining card's
 * posting is fetched (one request per result, at most one page's worth) to read
 * its "N days ago" label; postings whose age cannot be read are kept.
 */
async function resolveDates(jobs: JobCard[], site: Site): Promise<void> {
  for (const job of jobs) {
    try {
      const page = await htmlFetch(`${site.base}/jobs/x-${job.id}`)
      const d = page ? parseDetail(page.html, site, job.id) : null
      if (d) {
        job.postedAgo = d.postedAgo
        job.date = dateFromDaysAgo(daysAgo(d.postedAgo))
      }
    } catch {
      // keep the card undated rather than failing the whole search
    }
  }
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header = `${"ID".padEnd(7)} ${"TITLE".padEnd(52)} ${"COMPANY".padEnd(12)} ${"LOCATION".padEnd(30)} DATE`
  const rows = cards.map(
    (c) =>
      `${c.id.padEnd(7)} ${c.title.slice(0, 52).padEnd(52)} ${c.company.slice(0, 12).padEnd(12)} ${(c.location || "—").slice(0, 30).padEnd(30)} ${c.date || (c.isNew ? "new" : "—")}`,
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let sites: Site[]
  try {
    sites = await loadRegistry()
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "BAD_REGISTRY")
    return 1
  }
  if (opts.site) {
    sites = sites.filter((s) => s.name.toLowerCase() === opts.site!.toLowerCase())
    if (!sites.length) {
      writeError(`No registry entry named "${opts.site}" (see the 'list' command)`, "UNKNOWN_SITE")
      return 1
    }
  }

  const totals: Record<string, number | null> = {}
  const errors: { site: string; error: string }[] = []
  let cards: JobCard[] = []
  for (const site of sites) {
    try {
      const { total, jobs } = await fetchPage(site, opts.query, opts.page)
      totals[site.name] = total
      let kept = jobs.filter((j) => locationOk(j, opts.location))
      if (opts.jobage !== undefined) {
        await resolveDates(kept, site)
        kept = kept.filter((j) => {
          const d = daysAgo(j.postedAgo)
          return d === null || d <= opts.jobage!
        })
      }
      cards.push(...kept)
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
  const known = Object.values(totals).filter((t): t is number => typeof t === "number")
  const total = known.length ? known.reduce((a, b) => a + b, 0) : null

  if (errors.length && opts.format !== "json") process.stderr.write(JSON.stringify({ warnings: errors }) + "\n")
  if (opts.format === "table") {
    process.stdout.write(renderTable(cards) + "\n")
  } else if (opts.format === "plain") {
    process.stdout.write(
      (cards.length
        ? cards
            .map((c) => `${c.title}\n  ${c.company} · ${c.location || "—"} · ${c.date || (c.isNew ? "new" : "date unknown")}\n  id: ${c.id}\n  ${c.url}`)
            .join("\n\n")
        : "No results.") + "\n",
    )
  } else {
    process.stdout.write(
      JSON.stringify({ meta: { count: cards.length, page: opts.page, total, totals, errors }, results: cards }, null, 2) + "\n",
    )
  }
  return 0
}
