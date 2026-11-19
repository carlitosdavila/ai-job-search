import {
  PAGE_SIZE,
  jsonFetch,
  loadRegistry,
  parseDetail,
  parseSearch,
  parseSiteUrl,
  stripInvisible,
  writeError,
  type WorkdaySite,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  site?: string
  format: "json" | "plain"
}

/**
 * Split a public posting URL (https://<tenant>.wdN.myworkdayjobs.com/[en-US/]<site>/job/...)
 * into its site and the "/job/..." path. Any non-Workday host is rejected,
 * parsed through real URL parsing so look-alike hosts and userinfo tricks fail.
 */
export function splitPostingUrl(input: string): { site: WorkdaySite; jobPath: string } | null {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
  } catch {
    return null
  }
  const at = u.pathname.indexOf("/job/")
  if (at < 0) return null
  const site = parseSiteUrl("", `https://${u.hostname}${u.pathname.slice(0, at)}`)
  if (!site) return null
  const jobPath = u.pathname.slice(at)
  if (jobPath.length <= "/job/".length) return null
  return { site, jobPath }
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /myworkdayjobs\.com/i.test(s)
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  let sites: WorkdaySite[]
  try {
    sites = await loadRegistry()
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "BAD_REGISTRY")
    return 1
  }

  let site: WorkdaySite
  let jobPath: string
  if (looksLikeUrl(opts.id)) {
    const split = splitPostingUrl(opts.id)
    if (!split) {
      writeError(`"${opts.id}" is not a Workday posting URL (<tenant>.wdN.myworkdayjobs.com/<site>/job/...)`, "BAD_ID")
      return 1
    }
    // Use the registry name for the company when the site is registered.
    const known = sites.find((s) => s.host === split.site.host && s.site.toLowerCase() === split.site.site.toLowerCase())
    site = known ?? { ...split.site, name: split.site.tenant }
    jobPath = split.jobPath
  } else {
    // A requisition id (e.g. R4109): needs --site, then one search to find its path.
    if (!opts.site) {
      writeError("detail by requisition id needs --site <registry name>; or pass the posting URL instead", "NO_SITE")
      return 1
    }
    const found = sites.find((s) => s.name.toLowerCase() === opts.site!.toLowerCase())
    if (!found) {
      writeError(`No registry entry named "${opts.site}" (see the 'list' command)`, "UNKNOWN_SITE")
      return 1
    }
    site = found
    try {
      const data = await jsonFetch(`${site.api}/jobs`, { appliedFacets: {}, limit: PAGE_SIZE, offset: 0, searchText: opts.id })
      const hit = parseSearch(data, site).jobs.find((j) => j.id?.toLowerCase() === opts.id.trim().toLowerCase())
      if (!hit) {
        writeError(`No posting with requisition id "${opts.id}" on ${site.name}`, "NOT_FOUND")
        return 1
      }
      jobPath = new URL(hit.url).pathname.replace(/^\/[^/]+(?:\/[^/]+)?(?=\/job\/)/, "")
    } catch (e) {
      writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
      return 1
    }
  }

  try {
    const data = await jsonFetch(`${site.api}${jobPath}`)
    const job = data === null ? null : parseDetail(data, site, `${site.publicBase}${jobPath}`)
    if (!job) {
      writeError("Job not found (it may have closed)", "NOT_FOUND")
      return 1
    }
    const clean = stripInvisible(job)
    if (opts.format === "plain") {
      const lines = [
        clean.title,
        `${clean.company} · ${clean.location || "—"}${clean.additionalLocations.length ? ` (+ ${clean.additionalLocations.join("; ")})` : ""}`,
        clean.id ? `Requisition: ${clean.id}` : "",
        clean.employmentType ? `Employment: ${clean.employmentType}` : "",
        clean.date || clean.postedOn ? `Posted: ${clean.date ?? clean.postedOn}` : "",
        clean.isActive === false ? "Status: CLOSED (not accepting applications)" : "",
        "",
        clean.description || "(no description)",
        "",
        `URL: ${clean.url}`,
      ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(clean, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
